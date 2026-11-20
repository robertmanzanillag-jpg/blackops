import type { Express, Request } from 'express';
import { createHash } from 'node:crypto';
import { parseClippersOrchestraStatus, type ClippersOrchestraStatus } from '../shared/clippers-orchestra';
import { LEGACY_DISCOVERY_CREATORS as LEGACY_SOURCES } from '../shared/clippers-priority-creators.mjs';
import type { SelfHealObservedAudit } from './office-self-heal';
import { parseTakedown, DEFAULT_CITY_PAGE_NAMES } from '../shared/clippers-streamer-policy.mjs';
import { STREAMER_STATE_NAMESPACE, parseStreamerState, parseStreamerStateStrict, localWorkQueue, createPendingActionsQueue } from '../script/clippers-streamer-discovery.mjs';
import { getCurrentUserId, getSystemUserId } from './user-context';
import { growthOutputs, growthDecisionLines } from '../shared/clippers-growth-view';

/** Store shape shared with the orchestra state (agent_council_state via the council store). */
interface Store { read(owner: string): Promise<string | null>; transact(owner: string, update: (raw: string | null) => Promise<string>): Promise<string> }
const CODE = /^[a-zA-Z0-9_.:-]{1,200}$/;
const STALE_MS = 3 * 3600_000;

/**
 * The cloud streamer job reports into the existing orchestra "Streamers" role, so the office shows
 * its real state (working / completed / held with reason, e.g. missing_secret:TWITCH_CLIENT_ID).
 */
export function applyStreamerOverlay(report: ClippersOrchestraStatus, raw: string | null, at: number): ClippersOrchestraStatus {
  const state = parseStreamerState(raw), run = state.lastRun;
  const role = report.roles.find(r => r.stage === 'streamers');
  if (!role) return report;
  // Owner-action holds (Facebook identity check) are an owner note, not a failure and never a self-heal order.
  const holds = ownerHoldsOf((state as any).cloudPublish);
  if (holds.length) role.ownerNotes = [...new Set([...(role.ownerNotes ?? []), ...holds.map(h => h.note)])].slice(0, 5);
  if (!run) return report;
  const held = [...(run.heldReasons ?? []), ...(run.errors ?? []).map((e: string) => `streamer_cloud_error:${e}`)].filter(c => CODE.test(c));
  const age = at - Date.parse(run.at);
  role.lastRunAt = run.at;

  role.heldReasons = [...new Set([...role.heldReasons, ...held, ...(age > STALE_MS ? ['streamer_cloud_run_stale'] : [])])].slice(0, 100);
  role.state = run.status === 'failed' || run.status === 'skipped_missing_secrets' ? 'held' : age > STALE_MS ? 'stale' : run.status === 'completed' && !held.length ? 'completed' : 'held';
  for (const [k, v] of Object.entries(run.counts ?? {})) if (CODE.test(`cloud_${k}`) && Number.isSafeInteger(v) && (v as number) >= 0 && Object.keys(role.outputs).length < 20) role.outputs[`cloud_${k}`] = v as number;
  applyGrowthOverlay(report, (state as any).cloudPublish?.growth);
  return report;
}

/** Per-account weekly views, median, auto-publish flag and decision count on the Clippers "learning" role. */
export function applyGrowthOverlay(report: ClippersOrchestraStatus, growth: unknown): ClippersOrchestraStatus {
  const role = report.roles.find(r => r.stage === 'learning');
  if (!role) return report;
  for (const [k, v] of Object.entries(growthOutputs(growth))) if (CODE.test(k) && (Object.hasOwn(role.outputs, k) || Object.keys(role.outputs).length < 20)) role.outputs[k] = v;
  return report;
}

/** Owner-only summary of the streamer-pages lane (counts, top candidates, policies, takedowns). */
export function streamerStatusView(raw: string | null, at = Date.now()) {
  const s = parseStreamerState(raw);
  return {
    lastRun: s.lastRun, cityPages: s.cityPages ?? [],
    candidates: s.candidates.slice(0, 30).map((c: any) => ({ id: c.id, platform: c.platform, handle: c.handle, title: c.title, sourceUrl: c.sourceUrl, score: c.score,
      durationSec: c.durationSec ?? null, clipPolicy: c.clipPolicy?.status, policySource: c.clipPolicy?.source, approval: c.approval?.status, pendingActionId: c.approval?.pendingActionId ?? null, download: c.download?.mode })),
    prohibitedCreators: Object.values(s.creators).filter((c: any) => c.policy?.status === 'prohibited').map((c: any) => ({ key: c.key, handle: c.handle, source: c.policy.source, evidence: c.policy.evidence })),
    liveSignals: s.signals.slice(0, 10).map((x: any) => ({ handle: x.handle, platform: x.platform, title: x.title, views: x.views, sourceUrl: x.sourceUrl })),
    takedowns: s.takedowns.map((t: any) => ({ ...t, overdue: !t.removedAt && Date.parse(t.removeBy) < at })),
    macQueue: localWorkQueue(s).length,
    cloudPublish: cloudPublishSummary((s as any).cloudPublish),
    safety: { publishesHere: false, requiresOwnerApproval: true, creditRequired: true, maxClipSeconds: 60, takedownSlaHours: 24 },
  };
}

export const FACEBOOK_HOLD_NOTE = 'Facebook pide verificar identidad en la app';
/** Active per-brand per-network owner-action holds from the cloud ledger. */
export function ownerHoldsOf(c: any): Array<{ destination: string; reason: string; since: string; note: string; queued: number }> {
  if (!c || typeof c.holds !== 'object' || !c.holds) return [];
  const queue = Array.isArray(c.heldQueue) ? c.heldQueue : [];
  return Object.entries(c.holds as Record<string, any>).filter(([k, h]) => CODE.test(k) && h?.status === 'held_owner_action')
    .map(([destination, h]) => ({ destination, reason: CODE.test(String(h.reason)) ? h.reason : 'facebook_account_action_required', since: String(h.since ?? ''),
      note: FACEBOOK_HOLD_NOTE, queued: queue.filter((q: any) => q?.destinationKey === destination).length }));
}

/** Cloud publisher (GitHub Actions) ledger: last run, recent posts (to remove on a takedown) and learning. */
export function cloudPublishSummary(c: any) {
  if (!c || c.version !== 1 || !Array.isArray(c.posts)) return null;
  return {
    lastRun: c.lastRun ? { at: c.lastRun.at, status: c.lastRun.status, counts: c.lastRun.counts, heldReasons: c.lastRun.heldReasons, errors: c.lastRun.errors } : null,
    posts: c.posts.slice(-30).reverse().map((p: any) => ({ id: p.id, candidateId: p.candidateId, creatorKey: p.creatorKey, destination: p.destinationKey, scheduledAt: p.scheduledAt,
      status: p.status, metricoolId: p.metricoolId ?? null, hookVariant: p.hookVariant, views: p.observation?.views ?? null })),
    ownerHolds: ownerHoldsOf(c),
    learning: c.learning ? { evaluatedAt: c.learning.evaluatedAt, samples: c.learning.samples, hookPreference: c.learning.hookPreference, creatorBoost: c.learning.creatorBoost } : null,
    growth: c.growth?.evaluatedAt ? { evaluatedAt: c.growth.evaluatedAt, accounts: c.growth.accounts ?? {}, decisions: growthDecisionLines(c.growth, 30) } : null,
  };
}

type RejectPending = (owner: string, candidateIds: string[], reason: string) => Promise<number>;
// One shared pool for the process: a takedown must not open a new pool each time.
let rejectPool: Promise<Awaited<ReturnType<typeof import('./agent-council-store')['createCouncilPool']>>> | undefined;
async function defaultRejectPending(owner: string, candidateIds: string[], reason: string) {
  const pool = await (rejectPool ??= import('./agent-council-store').then(m => m.createCouncilPool('streamers-takedown')).catch(e => { rejectPool = undefined; throw e; }));
  const query = async (sql: string, values?: unknown[]) => { const c = await pool.connect(); try { return await c.query(sql, values) as { rows: any[] }; } finally { c.release(); } };
  return createPendingActionsQueue(query).rejectCandidates(owner, candidateIds, reason);
}

export function registerClippersStreamerRoutes(app: Pick<Express, 'get' | 'post'>, options: { isOwner?: (req: Request) => boolean; store?: () => Promise<Store>; owner?: () => string; now?: () => number; rejectPending?: RejectPending } = {}) {
  const isOwner = options.isOwner ?? ((req: Request) => getCurrentUserId(req) === getSystemUserId());
  const store = options.store ?? (async () => (await import('./agent-council-store')).getCouncilStore());
  const owner = options.owner ?? getSystemUserId;
  const now = options.now ?? Date.now;
  const rejectPending = options.rejectPending ?? defaultRejectPending;
  const guard = (req: Request, res: any) => { res.set('Cache-Control', 'private, no-store, max-age=0'); try { if (!isOwner(req)) { res.status(403).json({ error: 'CLIPPERS_OWNER_REQUIRED' }); return false; } } catch { res.status(401).json({ error: 'CLIPPERS_AUTH_REQUIRED' }); return false; } return true; };
  /** Runs `change` on a valid v1 state; an existing but invalid state is never overwritten. */
  const update = async <T>(change: (s: any) => T): Promise<T> => {
    let out!: T;
    await (await store()).transact(STREAMER_STATE_NAMESPACE(owner()), async raw => {
      const s = parseStreamerStateStrict(raw);
      if (!s) throw new Error('CLIPPERS_STREAMERS_STATE_INVALID');
      out = change(s);
      return JSON.stringify(s);
    });
    return out;
  };
  app.get('/api/clippers/streamers/status', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const raw = await (await store()).read(STREAMER_STATE_NAMESPACE(owner()));
      if (!parseStreamerStateStrict(raw)) return res.status(503).json({ error: 'CLIPPERS_STREAMERS_STATE_INVALID' });
      res.json(streamerStatusView(raw, now()));
    } catch { res.status(503).json({ error: 'CLIPPERS_STREAMERS_UNAVAILABLE' }); }
  });
  // Takedown: blocks a creator or clip forever, rejects its open approval rows; the owner removes any live
  // post within 24h (Metricool UI) and then marks it removed below.
  app.post('/api/clippers/streamers/takedown', async (req, res) => {
    if (!guard(req, res)) return;
    const at = now();
    const body = req.body ?? {};
    const id = createHash('sha256').update(JSON.stringify([body.creatorKey ?? null, body.creatorGroupId ?? null, body.candidateId ?? null, at])).digest('hex').slice(0, 16);
    const entry = parseTakedown({ id, creatorKey: body.creatorKey ?? null, creatorGroupId: body.creatorGroupId ?? null, candidateId: body.candidateId ?? null, reason: body.reason,
      receivedAt: new Date(at).toISOString(), removedAt: null }, at);
    if (!entry) return res.status(400).json({ error: 'CLIPPERS_TAKEDOWN_INVALID' });
    let affected: string[];
    try {
      affected = await update(s => {
        s.takedowns = [...s.takedowns, entry].slice(-500);
        const hit: string[] = [];
        for (const c of s.candidates) if ((entry.candidateId && c.id === entry.candidateId) || (entry.creatorKey && c.creatorKey === entry.creatorKey) ||
          (entry.creatorGroupId && s.creators[c.creatorKey]?.creatorGroupId === entry.creatorGroupId)) {
          c.clipPolicy = { status: 'prohibited', source: 'takedown', evidence: { reason: entry.reason, receivedAt: entry.receivedAt }, checkedAt: entry.receivedAt };
          if (c.approval && c.approval.status !== 'not_requested') c.approval.status = 'rejected';
          hit.push(c.id);
        }
        if (entry.candidateId && !hit.includes(entry.candidateId)) hit.push(entry.candidateId);
        return hit;
      });
    } catch { return res.status(503).json({ error: 'CLIPPERS_STREAMERS_UNAVAILABLE' }); }
    let rejectedApprovals: number | null = null;
    try { rejectedApprovals = await rejectPending(owner(), affected, 'takedown'); } catch { /* the block already holds: Mac queue and approval sync skip prohibited clips */ }
    res.json({ recorded: true, id: entry.id, removeBy: entry.removeBy, rejectedApprovals });
  });
  // Owner confirms the Facebook identity check was completed: the next cloud run clears the hold and releases
  // the queued Facebook copies gradually. Failed posts are never retried.
  app.post('/api/clippers/streamers/holds/resolved', async (req, res) => {
    if (!guard(req, res)) return;
    const destination = req.body?.destination;
    if (typeof destination !== 'string' || !/^\d+:facebook:\d+$/.test(destination)) return res.status(400).json({ error: 'CLIPPERS_HOLD_DESTINATION_INVALID' });
    const at = new Date(now()).toISOString();
    try {
      const found = await update(s => { const h = s.cloudPublish?.holds?.[destination]; if (h?.status !== 'held_owner_action') return false; h.ownerResolvedAt = at; return true; });
      return found ? res.json({ ownerResolvedAt: at }) : res.status(404).json({ error: 'CLIPPERS_HOLD_NOT_FOUND' });
    } catch { return res.status(503).json({ error: 'CLIPPERS_STREAMERS_UNAVAILABLE' }); }
  });
  // Owner confirms the live post was removed: clears takedown_overdue. The block itself stays forever.
  app.post('/api/clippers/streamers/takedown/removed', async (req, res) => {
    if (!guard(req, res)) return;
    const id = req.body?.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'CLIPPERS_TAKEDOWN_ID_INVALID' });
    const at = new Date(now()).toISOString();
    try {
      const found = await update(s => { const t = s.takedowns.find((x: any) => x.id === id); if (t && !t.removedAt) t.removedAt = at; return !!t; });
      return found ? res.json({ removedAt: at }) : res.status(404).json({ error: 'CLIPPERS_TAKEDOWN_NOT_FOUND' });
    } catch { return res.status(503).json({ error: 'CLIPPERS_STREAMERS_UNAVAILABLE' }); }
  });
}

// ---------- Mac-off fallback: a valid orchestra view built only from the cloud job state ----------
const FALLBACK_ACCOUNTS: Array<[string, 'tiktok' | 'facebook', string, string]> = [
  ['6431685', 'tiktok', 'streamersus', 'TikTok @streamersus'], ['6431687', 'tiktok', 'streamersclipusa', 'TikTok @streamersclipusa'],
  ['6591612', 'tiktok', 'news305miami', 'Miami · TikTok @news305miami'], ['6591612', 'facebook', '1193011863901514', 'Miami · Facebook'],
];
const STAGES = ['supervisor', 'analytics', 'trends', 'streamers', 'editor', 'checker', 'publisher', 'learning', 'health'] as const;

/** Returns null when the cloud job never ran. Mac-only roles are shown as disconnected (Mac off). */
export function cloudFallbackReport(raw: string | null, at: number): ClippersOrchestraStatus | null {
  const state = parseStreamerState(raw);
  if (!state.lastRun) return null;
  const generatedAt = new Date(at).toISOString();
  const cityName = (brandId: string) => (state.cityPages ?? []).find((p: any) => p.brandId === brandId && p.name)?.name as string | undefined
    ?? DEFAULT_CITY_PAGE_NAMES[brandId]?.name;
  const role = (stage: typeof STAGES[number]) => ({ id: `clippers-${stage}` as const, stage, state: 'disconnected' as const, evidenceAt: null, activeUntil: null, lastRunAt: null,
    heartbeatAt: null, nextDueAt: null, runId: null, evidenceIds: [], outputs: {}, heldReasons: ['mac_worker_offline'], lifePenaltyExempt: true,
    career: { registered: false, generation: null, points: null, battery: null, inTraining: false, hiredAt: null, skillIds: [], lastEvidenceId: null } });
  const report: any = {
    version: 1, generatedAt, evidenceAt: null,
    sourceFreshness: { state: 'disconnected', transport: 'unavailable', receivedAt: null, reportedAt: null, ageMinutes: null, staleAfterMinutes: 1560, heldReasons: ['mac_worker_offline', 'cloud_streamer_fallback'] },
    transport: { state: 'disconnected', lastIngestAt: null, maxAgeMs: 90_000 },
    disconnectedDestinations: [{ brandId: '6595747', label: cityName('6595747') ?? 'New York (página de clips, sin red conectada)', reason: 'destination_not_connected' }],
    accounts: FALLBACK_ACCOUNTS.map(([brandId, network, account, label]) => ({ key: `${brandId}:${network}:${account}`, brandId, network, account,
      label: brandId === '6591612' && cityName(brandId) ? `${cityName(brandId)} · ${network === 'tiktok' ? 'TikTok' : 'Facebook'}` : label,
      connection: 'unverified', observedAt: null, dailyTarget: 5, eligibleAssets: null, confirmedScheduledOrPublished: null, shortfall: null,
      heldReasons: ['mac_worker_offline'], activeVersion: null, policyStatus: 'unavailable', metricAgeBuckets: [] })),
    roles: STAGES.map(role),
    discovery: { sources: LEGACY_SOURCES.map(c => ({ creatorId: c.id, channelId: c.channelId, observedAt: null, status: 'not_observed', heldReasons: ['mac_worker_offline'], observations: 0 })),
      observations: null, eligibleAssets: null, rotationSize: 4, rotationDays: 2, signals: [], rightsPolicy: 'owner_review_required' },
    learning: { comparisons: [], eligibleComparisons: null, promotions: null, requiredComparisons: 3, minimumPerArm: 5, improvementThreshold: 0.2, automaticPromotion: false, heldReasons: ['mac_worker_offline'] },
    safety: { paidSpendUsd: 0, deniedBrandIds: ['6431692', '6475033', '6585226'], metadataDoesNotGrantRights: true, publicUploadRequiresReviewedPacket: true, publicationClaimsRequireProviderReceipt: true },
  };
  applyStreamerOverlay(report, raw, at);
  const streamers = report.roles.find((r: any) => r.stage === 'streamers');
  streamers.heldReasons = streamers.heldReasons.filter((r: string) => r !== 'mac_worker_offline');
  streamers.lifePenaltyExempt = false;
  return parseClippersOrchestraStatus(report, at);
}

// ---------- Self-heal: cloud job code failures become an allowlisted office finding ----------
export const STREAMER_FAILURE_STREAK_THRESHOLD = 3;
export const STREAMER_SELF_HEAL_RECORD = createHash('sha256').update(JSON.stringify(['clippers-streamers', 'discovery', 'robertmanzanillag-jpg/blackops'])).digest('hex');
/** One normalized audit per cloud run state. Missing keys -> data-absence note (never an order). */
export function streamerSelfHealAudits(raw: string | null): SelfHealObservedAudit[] {
  const run = parseStreamerState(raw).lastRun, streak = Number(parseStreamerState(raw).failureStreak ?? 0);
  if (!run || !Number.isFinite(Date.parse(run.at))) return [];
  const findings: SelfHealObservedAudit['findings'] = [];
  if (run.status === 'skipped_missing_secrets' || (run.heldReasons ?? []).some((r: string) => r.startsWith('missing_secret:') || r.startsWith('credential_invalid:'))) findings.push({ code: 'CAPABILITY_UNAVAILABLE', recordId: null });
  if (streak >= STREAMER_FAILURE_STREAK_THRESHOLD) findings.push({ code: 'STREAMER_DISCOVERY_FAILING', recordId: STREAMER_SELF_HEAL_RECORD });
  return [{ role: 'clippers-streamers', jobId: `clippers-streamers:${run.at}`, completedAt: run.at, status: 'completed', completeCoverage: true,
    artifactId: createHash('sha256').update(JSON.stringify(run)).digest('hex').slice(0, 64), findings,
    records: { [STREAMER_SELF_HEAL_RECORD]: { repo: 'robertmanzanillag-jpg/blackops' } } }];
}
export async function readStreamerSelfHealAudits(owner: string): Promise<SelfHealObservedAudit[]> {
  const store = await (await import('./agent-council-store')).getCouncilStore();
  return streamerSelfHealAudits(await store.read(STREAMER_STATE_NAMESPACE(owner)));
}
