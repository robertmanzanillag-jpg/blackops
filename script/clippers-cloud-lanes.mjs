#!/usr/bin/env node
// Cloud replacements for the Clippers Mac LaunchAgents + the Mac/cloud lane lock + Mac retirement.
//
//   node --import tsx script/clippers-cloud-lanes.mjs --job owned_content [--dry-run]   (GitHub Actions)
//   node --import tsx script/clippers-cloud-lanes.mjs --job marketplace [--dry-run]     (GitHub Actions)
//   node script/clippers-cloud-lanes.mjs --mac-gate content                             (Mac workers, exit 75 = refused)
//   node script/clippers-cloud-lanes.mjs --seed-workspace <mac workspace> [--content-config f] [--delivery-config f]
//   node script/clippers-cloud-lanes.mjs --retire-mac content,youtube_delivery,marketplace,watchdog [--force]
//   node script/clippers-cloud-lanes.mjs --unretire-mac <lanes> | --status
//
// Jobs (see docs/clippers-cloud-lanes.md):
//   owned_content = Mac 04:00 content worker + 06:30 YouTube delivery worker (same runner, same workspace)
//   marketplace   = Mac 07:00 free worker minus the logged-in marketplace refresh (owner snapshots via Drive)
// A job never runs a lane whose Mac heartbeat is fresh (lease, shared/clippers-cloud-lanes.mjs), records every
// missing secret as `missing_secret:<NAME>` for the office and exits 0, and never prints secret values.

import { mkdir, mkdtemp, readFile, rm, writeFile, chmod, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CLOUD_JOBS, CLOUD_LANES_NAMESPACE, CLOUD_WORKSPACE_NAMESPACE, LANE_IDS, MAC_LANE_IDS, MAC_LANES, laneKind, acquireLane, emptyLanesState, laneCloudQa,
  isInformational, parseLanesState, recordLaneRun, retireMacLanes, unretireMacLanes,
} from '../shared/clippers-cloud-lanes.mjs';
import {
  createDriveClient, detokenize, driveCredentials, isTextPath, mergeTextFiles, missingDriveSecrets, planHydration, planPersist,
  seedAllowed, snapshotTree, textOverlay, tokenize, writeOverlay, MAX_TEXT_FILE_BYTES,
} from './clippers-drive-workspace.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_CONFIG = 'config/clippers-content-worker.json';
export const DELIVERY_CONFIG = 'config/clippers-youtube-upload-packager.json';
export const MAC_GATE_REFUSED_EXIT = 75;
const YT_LANES = ['ES', 'EN', 'SLEEP'];
const YT_KEYS = ['CHANNEL_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'];
export const errorCode = e => { const m = String(e?.message ?? ''); return /^[a-z][a-z0-9_]{2,60}$/.test(m) ? m : 'internal_error'; };
const has = (env, k) => typeof env[k] === 'string' && env[k].trim() !== '';

/** Exact YouTube env the publish worker may see (same allowlist as the Mac zsh wrapper). */
export function youtubeEnv(env) {
  const out = {};
  for (const lane of YT_LANES) for (const k of YT_KEYS) { const name = `CLIPPERS_YOUTUBE_${lane}_${k}`; if (has(env, name)) out[name] = env[name]; }
  for (const k of ['CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED', 'CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED']) if (has(env, k)) out[k] = env[k];
  return out;
}
/** Missing secrets per lane ([] = can run). YouTube needs at least one complete channel lane. */
export function missingSecrets(lane, env) {
  const drive = missingDriveSecrets(env);
  if (lane === 'content') return drive;
  if (lane === 'youtube_delivery') {
    const complete = YT_LANES.some(l => YT_KEYS.every(k => has(env, `CLIPPERS_YOUTUBE_${l}_${k}`)));
    return [...drive, ...(complete ? [] : YT_KEYS.map(k => `CLIPPERS_YOUTUBE_ES_${k}`).filter(k => !has(env, k)))];
  }
  if (lane === 'marketplace') {
    const pub = env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED === 'true';
    return [...drive, ...(pub ? ['METRICOOL_USER_TOKEN', 'METRICOOL_USER_ID', 'CLIPPERS_METRICOOL_BLOG_ID'].filter(k => !has(env, k)) : [])];
  }
  return [];
}

async function laneTransact(store, owner, fn) {
  let out;
  await store.transact(CLOUD_LANES_NAMESPACE(owner), async raw => { const s = parseLanesState(raw); out = await fn(s); return JSON.stringify(s); });
  return out;
}

/** Per-lane time limits (minutes), always below the 340 min job limit so a hung lane is still recorded. */
export const LANE_TIMEOUT_MINUTES = Object.freeze({ content: 60, youtube_delivery: 45, marketplace: 60, sleep_content: 240 });
export function laneTimeoutMs(lane, job, env = process.env) {
  const base = lane === 'sleep_content' ? LANE_TIMEOUT_MINUTES.sleep_content : LANE_TIMEOUT_MINUTES[laneKind(lane)] ?? 60;
  const override = Number(env.CLIPPERS_CLOUD_LANE_TIMEOUT_MINUTES);
  return Math.min(Number.isFinite(override) && override > 0 ? override : base, 280) * 60_000;
}
export async function withLaneTimeout(task, ms) {
  let timer;
  try { return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('lane_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}

/** Default lane runners (real scripts). Tests inject fakes. */
export const defaultRunners = {
  async content({ workspaceRoot, mode = 'motivation' }) {
    const { runContentLocalWorker } = await import('./clippers-content-local-worker.mjs');
    // owned_content renders motivation only; the `sleep` job (flag, default off) renders only the sleep video.
    const cfg = JSON.parse(await readFile(path.join(workspaceRoot, CONTENT_CONFIG), 'utf8'));
    if (mode === 'sleep') for (const l of ['es', 'en']) { if (cfg.motivation?.[l]) cfg.motivation[l].manifestFiles = []; }
    else cfg.sleep = { ...(cfg.sleep ?? {}), enabled: false };
    cfg.workspaceRoot = '..';
    const tmpConfig = path.join(workspaceRoot, 'tmp', `content-${mode}.json`);
    await mkdir(path.dirname(tmpConfig), { recursive: true, mode: 0o700 });
    await writeFile(tmpConfig, JSON.stringify(cfg), { mode: 0o600 });
    const r = await runContentLocalWorker({ configPath: tmpConfig });
    const rendered = ['es', 'en'].reduce((n, l) => n + Number(r.motivation?.[l]?.rendered ?? 0), 0);
    return { status: 'completed', heldReasons: r.status === 'completed_with_shortfall' ? ['content_shortfall'] : [], errors: [],
      counts: { motivation_rendered: rendered, sleep_generated: Number(r.sleep?.generated ?? 0) } };
  },
  async youtube_delivery({ workspaceRoot, env }) {
    const { runYouTubeDeliveryWorker } = await import('./clippers-youtube-delivery-worker.mjs');
    const cfg = path.join(workspaceRoot, DELIVERY_CONFIG);
    await chmod(cfg, 0o600);
    const r = await runYouTubeDeliveryWorker({ configPath: cfg, env: youtubeEnv(env) });
    const blockers = (r.blockers ?? []).map(String).filter(b => /^[a-z0-9_:.-]{3,80}$/.test(b));
    return { status: r.status === 'blocked' || r.status === 'completed_with_uncertain_outcomes' ? 'held' : 'completed',
      heldReasons: [...blockers, ...(r.status === 'completed_with_uncertain_outcomes' ? ['youtube_upload_outcome_uncertain'] : [])], errors: [],
      counts: { youtube_uploaded: Number(r.publishing?.uploaded ?? 0), youtube_packaged: Number(r.packaging?.packaged ?? 0) } };
  },
  async marketplace({ workspaceRoot, env, dryRun }) {
    const { runClipperFreeLocalWorker } = await import('./clippers-free-local-worker.mjs');
    // Selected-env file (0600) in a private temp config root: the same contract the Mac uses, so child scripts
    // (Drive upload, Metricool autopilot + its cross-account ledger guard) get exactly the allowlisted keys.
    const configRoot = await mkdtemp(path.join(os.tmpdir(), 'clippers-cfg-'));
    try {
      const keys = ['OFFICE_DATABASE_URL', 'OFFICE_OWNER_ID', 'METRICOOL_USER_TOKEN', 'METRICOOL_USER_ID', 'CLIPPERS_METRICOOL_BLOG_ID', 'CLIPPERS_TIKTOK_ACCOUNT',
        'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'CLIPPERS_TARGET_DAILY_CLIPS'];
      const lines = keys.filter(k => has(env, k) && !/[\r\n]/.test(env[k])).map(k => `${k}=${env[k]}`);
      lines.push(`CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED=${!dryRun && env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED === 'true'}`);
      lines.push(`CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED=${!dryRun && env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED === 'true'}`);
      await writeFile(path.join(configRoot, '.env'), `${lines.join('\n')}\n`, { mode: 0o600 });
      const scrub = Object.fromEntries(Object.keys(env).filter(k => /^(OFFICE_|METRICOOL_|GOOGLE_|CLIPPERS_)/.test(k)).map(k => [k, '']));
      const r = await runClipperFreeLocalWorker({ projectRoot: REPO_ROOT, workspaceRoot, configRoot, env: { ...scrub, CLIPPERS_CONFIG_ROOT: configRoot },
        childEnv: { CLIPPERS_CONFIG_ROOT: configRoot, ...(has(env, 'CLIPPERS_MARKETPLACE_SNAPSHOT_MAX_AGE_HOURS') ? { CLIPPERS_MARKETPLACE_SNAPSHOT_MAX_AGE_HOURS: env.CLIPPERS_MARKETPLACE_SNAPSHOT_MAX_AGE_HOURS } : {}) } });
      const blockers = r.configurationBlockers ?? [];
      // Metricool off by design (owner flag) stops the chain at "delivery": informational, not a block.
      const byDesign = r.failedStage === 'delivery' && blockers.length > 0 && blockers.every(isInformational);
      const held = [...blockers, ...(r.failedStage && !byDesign ? [`stage_${r.failedStage}`] : [])];
      return { status: r.status === 'blocked' && !byDesign ? 'held' : 'completed', heldReasons: held, errors: [],
        counts: { rendered: Number(r.renderingReport?.summary?.rendered ?? 0) } };
    } finally { await rm(configRoot, { recursive: true, force: true }); }
  },
};

async function hydrate({ drive, folderId, root, stored, now, env }) {
  const { files, folders } = await drive.walk(folderId);
  const chosen = planHydration(files, { now, mediaMaxAgeDays: Number(env.CLIPPERS_CLOUD_MEDIA_HYDRATE_DAYS) || 3 });
  for (const f of chosen) {
    const dest = path.join(root, f.rel);
    await drive.download(f.id, dest);
    if (isTextPath(f.rel) && f.size <= MAX_TEXT_FILE_BYTES) await writeFile(dest, detokenize(await readFile(dest, 'utf8'), root), { mode: 0o600 });
  }
  await writeOverlay(root, textOverlay(stored, files));
  return { files, folders, downloaded: chosen.length };
}

async function persistMedia({ drive, folderId, root, rels, driveIndex }) {
  const byRel = new Map(driveIndex.files.map(f => [f.rel, f.id]));
  for (const rel of rels) {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const parentId = dir ? await drive.ensureFolder(driveIndex.folders, dir) : folderId;
    await drive.upload(path.join(root, rel), { name: path.posix.basename(rel), parentId, existingId: byRel.get(rel) ?? null });
  }
}

/**
 * One cloud job run. deps: store (council store), owner, env, now, drive (client or null), runners, workspaceRoot, dryRun.
 * Returns { lanes: { [lane]: run } }. Never throws for expected holds; a runner exception is a 'failed' run.
 */
export async function runCloudJob({ job, store, owner, env = process.env, now = Date.now(), drive = null, runners = defaultRunners, workspaceRoot, dryRun = false, host = 'github-actions' }) {
  const lanes = CLOUD_JOBS[job];
  if (!lanes) throw new Error('unknown_job');
  const at = new Date(now).toISOString();
  const results = {}, recorded = new Set();
  const runnable = [];
  for (const lane of lanes) {
    const missing = missingSecrets(laneKind(lane), env);
    if (missing.length) results[lane] = { at, status: 'held', heldReasons: missing.map(k => `missing_secret:${k}`), errors: [], counts: {}, dryRun };
    else runnable.push(lane);
  }
  // Lane lock: refused while the Mac lane heartbeat is fresh (dry runs render only and take no lease).
  const acquired = dryRun ? [...runnable] : await laneTransact(store, owner, s => runnable.filter(lane => {
    const r = acquireLane(s, lane, 'cloud', now, { host });
    if (!r.ok) results[lane] = { at, status: 'held', heldReasons: [r.reason], errors: [], counts: {}, dryRun };
    return r.ok;
  }));
  if (acquired.length) {
    const { folderId } = driveCredentials(env);
    const client = drive ?? createDriveClient(driveCredentials(env));
    const stored = JSON.parse((await store.read(CLOUD_WORKSPACE_NAMESPACE(owner))) ?? '{"version":1,"files":{}}');
    let index, before;
    try {
      await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
      index = await withLaneTimeout(() => hydrate({ drive: client, folderId, root: workspaceRoot, stored, now, env }), 30 * 60_000);
      before = await snapshotTree(workspaceRoot);
    } catch (e) {
      for (const lane of acquired) results[lane] = { at, status: errorCode(e).startsWith('drive_') ? 'held' : 'failed', heldReasons: [], errors: [errorCode(e)], counts: {}, dryRun };
      acquired.length = 0;
    }
    // One lane at a time; each lane's text ledgers and media are persisted and its run recorded right after it, so a
    // later lane (or the job limit) can never lose what an earlier lane uploaded.
    let snapshot = before;
    const quarantined = new Set(); // media written by a timed-out lane: never uploaded in this run
    const contentLane = lanes.find(l => laneKind(l) === 'content');
    for (const lane of acquired) {
      const kind = laneKind(lane);
      if (kind === 'youtube_delivery' && dryRun) results[lane] = { at, status: 'completed', heldReasons: ['dry_run_no_upload'], errors: [], counts: {}, dryRun };
      else if (kind === 'youtube_delivery' && contentLane && results[contentLane] && results[contentLane].status !== 'completed') results[lane] = { at, status: 'held', heldReasons: ['content_lane_not_completed'], errors: [], counts: {}, dryRun };
      else if (kind === 'youtube_delivery' && env.CLIPPERS_YOUTUBE_CLOUD_UPLOAD_ENABLED !== 'true') results[lane] = { at, status: 'completed', heldReasons: ['youtube_cloud_upload_disabled'], errors: [], counts: {}, dryRun };
      else {
        const cfg = kind === 'content' ? CONTENT_CONFIG : kind === 'youtube_delivery' ? DELIVERY_CONFIG : null;
        if (cfg && !(await stat(path.join(workspaceRoot, cfg)).catch(() => null))) results[lane] = { at, status: 'held', heldReasons: [`workspace_config_missing:${lane}`], errors: [], counts: {}, dryRun };
        else {
          const limitMs = laneTimeoutMs(lane, job, env);
          try { results[lane] = { at, dryRun, ...(await withLaneTimeout(() => runners[kind]({ workspaceRoot, env, dryRun, now, mode: job === 'sleep' ? 'sleep' : 'motivation' }), limitMs)) }; }
          catch (e) { results[lane] = { at, status: 'failed', heldReasons: [], errors: [errorCode(e)], counts: {}, dryRun }; }
        }
      }
      if (!dryRun && index) {
        const after = await snapshotTree(workspaceRoot);
        const planned = planPersist(snapshot, after);
        // After a timeout the renderer may still be writing: keep its text state, never upload half-written media.
        const timedOut = results[lane].errors.includes('lane_timeout');
        if (timedOut) for (const rel of planned.media) quarantined.add(rel);
        const { text } = planned, media = planned.media.filter(rel => !quarantined.has(rel));
        try {
          await store.transact(CLOUD_WORKSPACE_NAMESPACE(owner), async raw => JSON.stringify(await mergeTextFiles(raw ? JSON.parse(raw) : null, workspaceRoot, text, now)));
          await persistMedia({ drive: client, folderId, root: workspaceRoot, rels: media, driveIndex: index });
          snapshot = after;
          results[lane].counts = { ...results[lane].counts, persisted_text: text.length, persisted_media: media.length };
        } catch (e) {
          results[lane] = { ...results[lane], status: 'failed', errors: [...(results[lane].errors ?? []), `persist_${errorCode(e)}`.slice(0, 60)] };
        }
      }
      await laneTransact(store, owner, st => { recordLaneRun(st, lane, results[lane]); });
      // A failed persist stops the job: the next lane must not act on state the cloud could not save.
      if (results[lane].errors.some(e => e.startsWith('persist_'))) {
        for (const rest of acquired.slice(acquired.indexOf(lane) + 1)) results[rest] = { at, status: 'held', heldReasons: ['previous_lane_persist_failed'], errors: [], counts: {}, dryRun };
        break;
      }
    }
    for (const lane of acquired) recorded.add(lane);
  }
  await laneTransact(store, owner, s => { for (const [lane, run] of Object.entries(results)) if (!recorded.has(lane) || run.heldReasons.includes('previous_lane_persist_failed')) recordLaneRun(s, lane, run); });
  return { lanes: results };
}

/** Mac side of the lock. true = the Mac may run the lane. Fail-open (logged) without a database or on DB errors. */
export async function macLaneGate(lane, { env = process.env, store = null, now = Date.now(), log = console.error } = {}) {
  const { macLedgerEnv, createPgCouncilStore, safeCode } = await import('./clippers-mac-ledger-guard.mjs');
  const e = macLedgerEnv(env);
  const owner = String(e.OFFICE_OWNER_ID ?? '').trim(), url = String(e.OFFICE_DATABASE_URL ?? '').trim();
  if (!store && (!owner || !url)) { log(`clippers mac gate: no office database configured; ${lane} runs on the Mac (retire it with script/clippers-mac-retire.sh once the cloud runs it).`); return true; }
  const s = store ?? createPgCouncilStore(url);
  try {
    const r = await laneTransact(s, owner || 'test-owner', state => acquireLane(state, lane, 'mac', now, { host: 'mac' }));
    if (!r.ok) log(`clippers mac gate: ${lane} refused (${r.reason}); the cloud runs this lane.`);
    return r.ok;
  } catch (err) { log(`clippers mac gate: database ${safeCode(err)}; ${lane} runs on the Mac.`); return true; }
  finally { if (!store) await s.close?.(); }
}

/** Upload the Mac workspace: text (<= 1 MB) into Postgres with the Mac root tokenized, media (<= maxBytes) into Drive. */
export async function seedWorkspace({ macRoot, store, owner, drive, folderId, now = Date.now(), contentConfig = null, deliveryConfig = null, maxMediaBytes = 300 * 1024 ** 2, log = console.log }) {
  const root = path.resolve(macRoot);
  // Allowlist only (SEED_PREFIXES + text/media extensions); credential-like names and dot-dirs are always skipped.
  const tree = new Map([...(await snapshotTree(root))].filter(([rel]) => seedAllowed(rel)));
  const text = [...tree].filter(([rel, f]) => isTextPath(rel) && f.size <= MAX_TEXT_FILE_BYTES).map(([rel]) => rel);
  const media = [...tree].filter(([rel, f]) => !(isTextPath(rel) && f.size <= MAX_TEXT_FILE_BYTES) && f.size <= maxMediaBytes).map(([rel]) => rel);
  await store.transact(CLOUD_WORKSPACE_NAMESPACE(owner), async raw => {
    const doc = await mergeTextFiles(raw ? JSON.parse(raw) : null, root, text, now);
    for (const [rel, file] of [[CONTENT_CONFIG, contentConfig], [DELIVERY_CONFIG, deliveryConfig]]) {
      if (!file) continue;
      const cfg = JSON.parse(await readFile(file, 'utf8'));
      cfg.workspaceRoot = '..';
      const content = tokenize(JSON.stringify(cfg, null, 2), root);
      doc.files[rel] = { content, sha256: '', updatedAt: new Date(now).toISOString() };
    }
    return JSON.stringify(doc);
  });
  const index = await drive.walk(folderId);
  const remote = new Map(index.files.map(f => [f.rel, f]));
  let uploaded = 0;
  for (const rel of media) {
    if (remote.get(rel)?.size === tree.get(rel).size) continue;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const parentId = dir ? await drive.ensureFolder(index.folders, dir) : folderId;
    await drive.upload(path.join(root, rel), { name: path.posix.basename(rel), parentId, existingId: remote.get(rel)?.id ?? null });
    uploaded++;
  }
  log(JSON.stringify({ seeded: true, textFiles: text.length, mediaUploaded: uploaded, mediaSkippedLarge: [...tree].filter(([, f]) => f.size > maxMediaBytes).length }));
  return { text: text.length, uploaded };
}

/** Retirement: every lane needs cloud QA (a completed cloud run or dry run in 7 days) unless forced. */
export async function retireMac({ lanes, store, owner, now = Date.now(), force = false }) {
  const streamerRaw = await store.read(`clippers-streamers:${owner}`).catch(() => null);
  let streamerAt = null; try { streamerAt = JSON.parse(streamerRaw ?? 'null')?.cloudPublish?.lastRun?.at ?? JSON.parse(streamerRaw ?? 'null')?.lastRun?.at ?? null; } catch { /* none */ }
  return laneTransact(store, owner, s => {
    const failures = [];
    for (const lane of lanes) {
      if (!MAC_LANE_IDS.includes(lane)) { failures.push(`${lane}:unknown_lane`); continue; }
      const qa = MAC_LANES[lane].coveredOnly ? { ok: !!streamerAt && now - Date.parse(streamerAt) < 7 * 86400_000 } : laneCloudQa(s, lane, now);
      if (!qa.ok && !force) failures.push(`${lane}:cloud_qa_missing`);
    }
    if (failures.length) return { ok: false, failures };
    retireMacLanes(s, lanes, now, force ? 'owner_forced' : 'owner');
    return { ok: true, failures: [] };
  });
}

/** Scheduled runs skip a lane that already ran (not failed, not waiting on the Mac / a secret) within `hours`. */
export function skipByInterval(run, now, hours) {
  if (!run || run.status === 'failed') return false;
  if (run.heldReasons.some(r => r === 'mac_lane_active' || r === 'mac_lane_not_retired' || r.startsWith('missing_secret:'))) return false;
  return now - Date.parse(run.at) < hours * 3600_000;
}

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const lanesArg = v => String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function main() {
  if (arg('mac-gate')) { process.exitCode = (await macLaneGate(arg('mac-gate'))) ? 0 : MAC_GATE_REFUSED_EXIT; return; }
  const env = process.env.CLIPPERS_CONFIG_ROOT ? (await import('./clippers-mac-ledger-guard.mjs')).macLedgerEnv(process.env) : process.env;
  const owner = String(env.OFFICE_OWNER_ID || env.DEFAULT_USER_ID || '').trim();
  const url = String(env.OFFICE_DATABASE_URL || env.DATABASE_URL || '').trim();
  if (!owner || !url) { console.log('::notice::Clippers cloud lanes skipped: OFFICE_DATABASE_URL / OFFICE_OWNER_ID not available.'); return; }
  const { createPgCouncilStore } = await import('./clippers-mac-ledger-guard.mjs');
  const store = createPgCouncilStore(url);
  try {
    if (process.argv.includes('--status')) {
      const s = parseLanesState(await store.read(CLOUD_LANES_NAMESPACE(owner)));
      console.log(JSON.stringify({ lanes: s.lanes, leases: Object.fromEntries(Object.entries(s.leases).map(([k, v]) => [k, { holder: v.holder, at: v.at }])), retired: s.retired }, null, 2));
      return;
    }
    if (arg('seed-workspace')) {
      const missing = missingDriveSecrets(env);
      if (missing.length) { console.error(`Missing ${missing.join(', ')} (Mac selected env or environment).`); process.exitCode = 1; return; }
      await seedWorkspace({ macRoot: arg('seed-workspace'), store, owner, drive: createDriveClient(driveCredentials(env)), folderId: driveCredentials(env).folderId,
        contentConfig: arg('content-config') || env.CLIPPERS_CONTENT_WORKER_CONFIG || null, deliveryConfig: arg('delivery-config') || env.CLIPPERS_YOUTUBE_DELIVERY_CONFIG || null });
      return;
    }
    if (arg('retire-mac')) {
      const r = await retireMac({ lanes: lanesArg(arg('retire-mac')), store, owner, force: process.argv.includes('--force') });
      console.log(JSON.stringify(r));
      if (!r.ok) process.exitCode = 3;
      return;
    }
    if (arg('unretire-mac')) {
      // Rollback hands the lanes back to the Mac: only once the owner paused the cloud lanes (no overlap).
      if (!process.argv.includes('--cloud-paused')) { console.error('Refused: pause the cloud lanes first (CLIPPERS_CLOUD_LANES_ENABLED=false), then pass --cloud-paused.'); process.exitCode = 3; return; }
      await laneTransact(store, owner, s => unretireMacLanes(s, lanesArg(arg('unretire-mac')), Date.now()));
      console.log(JSON.stringify({ ok: true })); return;
    }
    const job = arg('job');
    if (!CLOUD_JOBS[job]) throw new Error('unknown_job');
    if (env.CLIPPERS_CLOUD_LANES_KILL_SWITCH === 'true') { console.log('::notice::Clippers cloud lanes kill switch is on.'); return; }
    if (process.argv.includes('--respect-interval')) {
      const s = parseLanesState(await store.read(CLOUD_LANES_NAMESPACE(owner)));
      const hours = Math.min(72, Math.max(1, Number(env.CLIPPERS_CLOUD_LANES_MIN_INTERVAL_HOURS) || 20));
      if (CLOUD_JOBS[job].every(lane => skipByInterval(s.lanes[lane]?.lastRun, Date.now(), hours))) { console.log(`::notice::Clippers ${job} ran within the last ${hours} h; skipping.`); return; }
    }
    const workspaceRoot = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'clippers-workspace');
    const { lanes } = await runCloudJob({ job, store, owner, env, workspaceRoot, dryRun: process.argv.includes('--dry-run') });
    for (const [lane, run] of Object.entries(lanes)) {
      const missing = run.heldReasons.filter(r => r.startsWith('missing_secret:'));
      if (missing.length) console.log(`::notice::Clippers ${lane}: add Actions secrets ${missing.map(r => r.slice(15)).join(', ')} (see docs/clippers-cloud-lanes.md).`);
    }
    console.log(JSON.stringify(Object.fromEntries(Object.entries(lanes).map(([k, r]) => [k, { status: r.status, heldReasons: r.heldReasons, errors: r.errors, counts: r.counts }]))));
    if (Object.values(lanes).some(r => r.status === 'failed')) process.exitCode = 1;
    // A timed-out lane may still have a child process running: everything is recorded, so stop here.
    if (Object.values(lanes).some(r => r.errors.includes('lane_timeout'))) { await store.close?.(); process.exit(1); }
  } finally { await store.close?.(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(JSON.stringify({ error: 'CLIPPERS_CLOUD_LANES_FAILED', code: errorCode(e) })); process.exitCode = 1; });
}
