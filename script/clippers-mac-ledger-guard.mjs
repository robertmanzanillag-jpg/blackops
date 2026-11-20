// Mac clipping lanes -> the same cross-account media ledger as the cloud streamer publisher.
//
// Every Mac script that schedules to Metricool (clippers-metricool-autopilot.mjs, clippers-daily-learning.mjs,
// clippers-weekly-scheduler.mjs) calls reserve() right before its write. reserve() refuses (fail closed) unless:
//   1. the per-account routing/language rules of shared/clippers-account-lanes.mjs hold for the destination
//      (language of the account, creator allowlist lane, stream already owned by another account);
//   2. the Metricool cross-brand calendar check (read-only GETs) finds no same caption/media on another account
//      -- mandatory, always runs;
//   3. no entry of the shared ledger gives the same source segment / file hash / source to another account.
//      Shared ledger = Postgres (agent_council_state, the cloud streamer namespace, same row and lock as the cloud
//      worker) when OFFICE_DATABASE_URL + OFFICE_OWNER_ID are available on the Mac, plus a local mirror file
//      (<workspace>/reports/clippers-media-ledger.json). Without the database the calendar check + local mirror
//      are the guard, and unmirrored entries are pushed to Postgres on the next run that has it.
// Any error -> { ok: false }: the caller must not schedule. No Metricool writes happen here.

import { createHash } from 'node:crypto';
import { link, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STREAMER_STATE_NAMESPACE, parseStreamerStateStrict, emptyStreamerState } from './clippers-streamer-discovery.mjs';
import { canonicalDestinationKey, destinationKey } from './clippers-portfolio-metricool.mjs';
import { cloudPublishOf, mediaEntriesOf } from '../shared/clippers-media-ledger.mjs';
import { loadClipperSelectedEnv } from './clippers-selected-env.mjs';
import { laneForDestinationKey, mediaConflict, routeCandidate } from '../shared/clippers-account-lanes.mjs';

export const MAC_LEDGER_FILE = path.join('reports', 'clippers-media-ledger.json');
const MAX_LOCAL = 5000;
const KNOWN_CODES = new Set(['STREAMER_STATE_INVALID', 'local_ledger_invalid', 'ledger_lock_busy']);
/** Fixed reason codes only: never hostnames, URLs or driver messages (reasons land in reports and logs). */
export function safeCode(e) {
  const msg = String(e?.message ?? ''), c = String(e?.code ?? '');
  if (KNOWN_CODES.has(msg)) return msg;
  if (/^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$/.test(c) || /timeout|terminated|connect/i.test(msg)) return 'database_unreachable';
  if (c === '28P01' || c === '28000') return 'database_auth_failed';
  if (c === '55P03') return 'database_lock_timeout';
  if (/^[0-9A-Z]{5}$/.test(c)) return 'database_error';
  if (e instanceof SyntaxError) return 'local_ledger_invalid';
  return 'internal_error';
}
const providerCode = e => { const m = String(e?.message ?? ''); return /^[a-z][a-z0-9_]{2,59}$/.test(m) ? m : 'provider_error'; };
export const LEDGER_LOCK_STALE_MS = 120_000;
export const LEDGER_LOCK_HEARTBEAT_MS = 30_000;
/** Break a stale lock safely: rename to a unique name, unlink only if it is the inode judged stale. */
export async function breakStaleLock(lockPath, staleInfo) {
  const moved = `${lockPath}.stale-${process.pid}-${createHash('sha256').update(String(Math.random()) + Date.now()).digest('hex').slice(0, 12)}`;
  try { await rename(lockPath, moved); } catch { return false; }
  const info = await stat(moved).catch(() => null);
  if (info && info.ino === staleInfo.ino && info.dev === staleInfo.dev) { await unlink(moved).catch(() => undefined); return true; }
  // Someone else's fresh lock: put it back unless a new one already exists (link fails on EEXIST).
  await link(moved, lockPath).catch(() => undefined);
  await unlink(moved).catch(() => undefined);
  return false;
}

/** Canonical source identity, in the same key space the cloud worker uses for candidate ids / VOD segments. */
export function sourceIdentity(sourceUrl) {
  let url;
  try { url = new URL(String(sourceUrl ?? '').trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const id = v => String(v ?? '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 100);
  if (host === 'youtu.be' && parts[0]) return `youtube:${id(parts[0])}`;
  if (host === 'youtube.com') {
    if (url.searchParams.get('v')) return `youtube:${id(url.searchParams.get('v'))}`;
    if (['shorts', 'live', 'embed'].includes(parts[0]) && parts[1]) return `youtube:${id(parts[1])}`;
  }
  if (host === 'clips.twitch.tv' && parts[0]) return `twitch-clip:${id(parts[0])}`;
  if (host === 'twitch.tv') {
    if (parts[0] === 'videos' && parts[1]) return `twitch-vod:${id(parts[1])}`;
    if (parts[1] === 'clip' && parts[2]) return `twitch-clip:${id(parts[2])}`;
  }
  url.hash = ''; for (const k of [...url.searchParams.keys()]) if (/^utm_|^si$|^feature$/.test(k)) url.searchParams.delete(k);
  return `url:${host}${url.pathname.replace(/\/+$/, '')}${url.search}`.slice(0, 200);
}

/** Source segment of a Mac item. Unknown cut offset -> start null (overlaps every cut of that source). */
export function macSegment(item) {
  const id = sourceIdentity(item?.sourceUrl);
  if (!id) return null;
  const raw = item?.sourceStartSec ?? item?.cutStartSec ?? item?.cut?.start;
  const cut = Number.isFinite(Number(raw)) && raw !== null && raw !== '' ? Number(raw) : 0;
  // Twitch clip without a VOD offset: same moment key as the cloud (broadcaster + clip creation time, +-60 s).
  if (id.startsWith('twitch-clip:') && !Number.isFinite(Number(item?.vodOffsetSec)) && item?.creatorKey && Number.isFinite(Date.parse(item?.sourcePublishedAt))) {
    return { key: `twitch-moment:${String(item.creatorKey).replace(/[^0-9A-Za-z:_-]/g, '')}`, start: Math.round(Date.parse(item.sourcePublishedAt) / 1000 + cut) };
  }
  if (id.startsWith('twitch-clip:') && item?.vodId && Number.isFinite(Number(item?.vodOffsetSec))) {
    return { key: `twitch-vod:${String(item.vodId).replace(/[^0-9A-Za-z_-]/g, '')}`, start: Math.round(Number(item.vodOffsetSec) + cut) };
  }
  const key = id;
  const vod = Number(item?.vodOffsetSec);
  const start = Number.isFinite(Number(raw)) && raw !== null && raw !== '' ? Math.round(Number(raw) + (Number.isFinite(vod) ? vod : 0)) : null;
  return { key, start };
}

const ES = new Set(['que', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una', 'no', 'se', 'lo', 'por', 'con', 'para', 'pero', 'esto', 'esta', 'qué', 'cómo', 'tú', 'él', 'muy', 'nadie', 'fuente']);
const EN = new Set(['the', 'and', 'of', 'to', 'in', 'is', 'it', 'you', 'this', 'that', 'what', 'with', 'for', 'was', 'he', 'she', 'his', 'did', 'not', 'wait', 'would', 'have', 'source', 'on']);
/** Confident caption language ('es' | 'en') or null. Hashtags, mentions and URLs are ignored. */
export function captionLanguage(text) {
  const words = String(text ?? '').toLowerCase().replace(/https?:\/\/\S+|[#@]\S+/g, ' ').normalize('NFC').split(/[^\p{L}]+/u).filter(Boolean);
  let es = 0, en = 0;
  for (const w of words) { if (ES.has(w)) es++; if (EN.has(w)) en++; }
  if (es >= 3 && es >= 2 * en) return 'es';
  if (en >= 3 && en >= 2 * es) return 'en';
  return null;
}

/**
 * Per-account routing/language rules for a Mac item -> null (ok) or a refusal reason.
 * Applies only to lane accounts (shared/clippers-account-lanes.mjs); other destinations only get the dedupe.
 */
export function macRoutingRefusal({ destination, item, entries }) {
  const key = canonicalDestinationKey(destinationKey(destination));
  const lane = laneForDestinationKey(key);
  const segment = macSegment(item);
  // Follow-up clips of a stream stay on the account that first used it.
  const owner = segment ? (entries ?? []).find(e => e?.lane && (e.streamKey === segment.key || e.segment?.key === segment.key) && canonicalDestinationKey(e.destinationKey) !== key) : null;
  if (owner && owner.lane !== lane?.id) return 'stream_owned_by_other_account';
  if (!lane) return null;
  const declared = typeof item?.language === 'string' ? item.language.toLowerCase().slice(0, 2) : null;
  const language = declared || captionLanguage(item?.caption);
  if (language && language !== lane.language) return `language_mismatch:${language}_on_${lane.language}`;
  const handle = item?.creatorHandle ?? item?.creator?.handle ?? null;
  if (handle || item?.creatorGroupId) {
    const route = routeCandidate({ handle, title: '', language: language ?? lane.language }, { creator: item?.creatorGroupId ? { creatorGroupId: item.creatorGroupId } : null });
    if (route.reason === 'creator_allowlist' && route.lane !== lane.id) return `creator_routed_to_other_account:${route.lane}`;
  }
  return null;
}

/** Ledger entry for a Mac delivery (same shape the cloud worker's mediaEntriesOf() reads). */
export function macEntry({ destination, item, at }) {
  const key = canonicalDestinationKey(destinationKey(destination));
  const segment = macSegment(item);
  const itemId = String(item?.id ?? item?.itemId ?? createHash('sha256').update(`${key}|${item?.mediaSha256 ?? ''}|${item?.sourceUrl ?? ''}`).digest('hex').slice(0, 24)).slice(0, 100);
  return { candidateId: `mac:${itemId}`, sourceId: sourceIdentity(item?.sourceUrl), streamKey: segment?.key ?? null, segment, mediaSha256: item?.mediaSha256 || item?.sha256 || null,
    destinationKey: key, lane: laneForDestinationKey(key)?.id ?? null, at, origin: 'mac' };
}

/** Guard env: process env first, then the allowlisted keys of the Mac config root's env files (OFFICE_DATABASE_URL, OFFICE_OWNER_ID). */
export function macLedgerEnv(env = process.env) {
  const out = { ...env };
  if (env.CLIPPERS_CONFIG_ROOT && !(out.OFFICE_DATABASE_URL && out.OFFICE_OWNER_ID)) { try { loadClipperSelectedEnv(env.CLIPPERS_CONFIG_ROOT, out); } catch { /* guard falls back to calendar + local */ } }
  return out;
}

/** Same row, same advisory lock and owner_key hashing as server/agent-council-store.ts (plain pg; Mac runs without tsx). */
export function createPgCouncilStore(connectionString, { Pool } = {}) {
  let pool;
  const key = owner => createHash('sha256').update(owner).digest('hex');
  const connect = async () => {
    if (!pool) { const Ctor = Pool ?? (await import('pg')).default.Pool; pool = new Ctor({ connectionString, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 10000, statement_timeout: 30000, application_name: 'blackops-council:clippers-mac' }); }
    return pool.connect();
  };
  return {
    async read(owner) {
      const client = await connect();
      try { const r = await client.query('SELECT state FROM agent_council_state WHERE owner_key = $1', [key(owner)]); return r.rows[0] ? JSON.stringify(r.rows[0].state) : null; }
      finally { client.release(); }
    },
    async transact(owner, update) {
      const client = await connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key(owner)]);
        const r = await client.query('SELECT state FROM agent_council_state WHERE owner_key = $1 FOR UPDATE', [key(owner)]);
        const raw = await update(r.rows[0] ? JSON.stringify(r.rows[0].state) : null);
        JSON.parse(raw);
        await client.query('INSERT INTO agent_council_state(owner_key, state) VALUES ($1, $2::jsonb) ON CONFLICT(owner_key) DO UPDATE SET state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP', [key(owner), raw]);
        await client.query('COMMIT');
        return raw;
      } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; }
      finally { client.release(); }
    },
    async close() { await pool?.end?.().catch(() => undefined); },
  };
}

/**
 * deps: env (OFFICE_DATABASE_URL, OFFICE_OWNER_ID, CLIPPERS_LEDGER_REQUIRE_DATABASE), workspaceRoot,
 * metricool (createPortfolioMetricool-like; only crossAccountPreflight is used), store (optional, tests), now.
 */
export function createMacLedgerGuard({ env = process.env, workspaceRoot, metricool, store = null, now = () => new Date() } = {}) {
  const file = path.join(path.resolve(workspaceRoot ?? 'clippers_workspace'), MAC_LEDGER_FILE);
  const dbUrl = String(env.OFFICE_DATABASE_URL ?? '').trim();
  const owner = String(env.OFFICE_OWNER_ID ?? '').trim();
  const db = store ?? (dbUrl && owner ? createPgCouncilStore(dbUrl) : null);
  const requireDb = env.CLIPPERS_LEDGER_REQUIRE_DATABASE === 'true';
  const ns = owner ? STREAMER_STATE_NAMESPACE(owner) : null;

  async function readLocal() {
    let raw;
    try { raw = await readFile(file, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return { version: 1, entries: [] }; throw e; }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('local_ledger_invalid');
    return parsed;
  }
  async function writeLocal(value) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, entries: value.entries.slice(-MAX_LOCAL) }, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  }
  const strip = ({ mirrored, ...e }) => e;
  // Only other accounts count here: same-account repeats are each Mac script's own dedupe/cap responsibility.
  const conflictOf = (entries, entry) => mediaConflict(entries.filter(e => canonicalDestinationKey(e?.destinationKey) !== entry.destinationKey),
    { segment: entry.segment, mediaSha256: entry.mediaSha256, destinationKey: entry.destinationKey, candidateId: entry.candidateId, sourceId: entry.sourceId });

  /**
   * Exclusive lock around read -> check -> write of the local ledger. The holder refreshes the lock's mtime every
   * 30 s; a lock untouched for > 2 min is stale. Breaking a stale lock renames it to a unique name first and unlinks
   * it only if it is still the same inode that was judged stale (a fresh lock that raced in is put back).
   */
  async function withLock(fn) {
    const lockPath = `${file}.lock`;
    await mkdir(path.dirname(file), { recursive: true });
    let handle = null;
    for (let i = 0; i < 50 && !handle; i++) {
      try { handle = await open(lockPath, 'wx', 0o600); await handle.writeFile(`${process.pid} ${now().toISOString()}`); }
      catch (e) {
        if (e?.code !== 'EEXIST') throw e;
        const info = await stat(lockPath).catch(() => null);
        if (info && Date.now() - info.mtimeMs > LEDGER_LOCK_STALE_MS) { await breakStaleLock(lockPath, info); continue; }
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (!handle) throw new Error('ledger_lock_busy');
    const mine = await handle.stat();
    const beat = setInterval(() => { const t = new Date(); handle.utimes(t, t).catch(() => undefined); }, LEDGER_LOCK_HEARTBEAT_MS);
    beat.unref?.();
    try { return await fn(); }
    finally {
      clearInterval(beat);
      await handle.close().catch(() => undefined);
      const cur = await stat(lockPath).catch(() => null);
      if (cur && cur.ino === mine.ino && cur.dev === mine.dev) await unlink(lockPath).catch(() => undefined);
    }
  }

 

  /**
   * Check + claim one Mac delivery. Call immediately before the Metricool write.
   * -> { ok: true, evidence } | { ok: false, reason }
   */
  async function reserve(destination, item) {
    const evidence = { ledger: db ? 'postgres' : 'local_plus_calendar', calendarCheck: null, at: now().toISOString() };
    if (!destination || !item) return { ok: false, reason: 'ledger_item_invalid' };
    if (!item.mediaSha256 && !item.sha256 && !macSegment(item)) return { ok: false, reason: 'ledger_identity_missing' };
    if (requireDb && !db) return { ok: false, reason: 'ledger_database_required_unavailable' };
    if (!metricool?.crossAccountPreflight) return { ok: false, reason: 'calendar_check_unavailable' };
    try {
      return await withLock(async () => {
        const local = await readLocal();
        const entry = macEntry({ destination, item, at: evidence.at });
        const firstLocal = local.entries.map(strip);
        let refusal = macRoutingRefusal({ destination, item, entries: firstLocal }) ?? conflictOf(firstLocal, entry)?.reason ?? null;
        if (!refusal) {
          // Mandatory cross-brand calendar check (read-only).
          try { evidence.calendarCheck = (await metricool.crossAccountPreflight(destination, item)) ?? { ok: true }; }
          catch (e) { const c = providerCode(e); refusal = c === 'cross_account_duplicate' ? c : `calendar_check_failed:${c}`; }
        }
        let mirrored = false;
        if (db) {
          // Always push unmirrored local entries; claim this one only when nothing refused it.
          await db.transact(ns, async raw => {
            const s = raw ? parseStreamerStateStrict(raw) : emptyStreamerState();
            if (!s) throw new Error('STREAMER_STATE_INVALID');
            s.cloudPublish = cloudPublishOf(s);
            const shared = [...mediaEntriesOf(s.cloudPublish), ...firstLocal];
            if (!refusal) refusal = macRoutingRefusal({ destination, item, entries: shared }) ?? conflictOf(shared, entry)?.reason ?? null;
            const existing = Array.isArray(s.cloudPublish.mediaLedger) ? s.cloudPublish.mediaLedger : [];
            const known = new Set(existing.map(e => `${e.candidateId}|${e.destinationKey}`));
            const pending = local.entries.filter(e => !e.mirrored && !known.has(`${e.candidateId}|${e.destinationKey}`)).map(strip);
            if (refusal && !pending.length) return raw ?? JSON.stringify(s);
            s.cloudPublish.mediaLedger = [...existing.filter(e => refusal || !(e.candidateId === entry.candidateId && e.destinationKey === entry.destinationKey)), ...pending, ...(refusal ? [] : [entry])].slice(-5000);
            return JSON.stringify(s);
          });
          mirrored = true;
          for (const e of local.entries) e.mirrored = true;
        }
        if (!refusal) local.entries = [...local.entries.filter(e => !(e.candidateId === entry.candidateId && e.destinationKey === entry.destinationKey)), { ...entry, mirrored }];
        if (!refusal || mirrored) await writeLocal(local);
        if (refusal) return { ok: false, reason: refusal, evidence };
        return { ok: true, evidence: { ...evidence, mirrored, entry: { streamKey: entry.streamKey, sourceId: entry.sourceId, lane: entry.lane, destinationKey: entry.destinationKey } } };
      });
    } catch (e) {
      return { ok: false, reason: `ledger_check_unavailable:${safeCode(e)}`, evidence };
    }
  }
  return { reserve, file, mode: db ? 'postgres' : 'local_plus_calendar', close: async () => { if (!store) await db?.close?.(); } };
}
