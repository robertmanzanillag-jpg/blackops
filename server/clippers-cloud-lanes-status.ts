import { createHash } from 'node:crypto';
import type { ClippersOrchestraStatus } from '../shared/clippers-orchestra';
import type { SelfHealObservedAudit } from './office-self-heal';
import { CLOUD_LANES_NAMESPACE, CLOUD_LANE_FAILURE_STREAK_THRESHOLD, CLOUD_LEASED_LANES, LANE_IDS, MAC_LANES, laneView, parseLanesState } from '../shared/clippers-cloud-lanes.mjs';

const CODE = /^[a-zA-Z0-9_.:-]{1,200}$/;
type RoleState = ClippersOrchestraStatus['roles'][number]['state'];
/** Most informative state wins when two lanes feed one role: a block beats a stale lane beats success. */
const RANK: Record<RoleState, number> = { held: 5, stale: 4, working: 3, completed: 2, idle: 1, disconnected: 0 };

/**
 * Cloud lanes (former Mac LaunchAgents) report into their orchestra roles, so every Clippers role shows a real
 * cloud status with the Mac off: completed / idle (on duty, waiting for its window or the Mac lane) / held with
 * reason (missing_secret:<NAME>, mac_lane_active, ...) / stale. With the Mac telemetry still connected, the Mac
 * state stays authoritative for lanes it still runs; retired lanes always show the cloud.
 */
export function applyCloudLanesOverlay(report: ClippersOrchestraStatus, raw: string | null, at: number): ClippersOrchestraStatus {
  const state = parseLanesState(raw);
  const macConnected = report.transport.state === 'connected';
  const byRole = new Map<string, ReturnType<typeof laneView>[]>();
  for (const lane of LANE_IDS) {
    const view = laneView(state, lane, at);
    for (const stage of MAC_LANES[lane].roles) byRole.set(stage, [...(byRole.get(stage) ?? []), view]);
  }
  for (const role of report.roles) {
    const views = byRole.get(role.stage);
    if (!views) continue;
    // Only lanes with evidence (a cloud run, a retirement or a Mac heartbeat) change a role.
    const relevant = views.filter(v => v.lastRunAt || v.retiredAt || v.macActive);
    if (!relevant.length) continue;
    const cloudOwned = relevant.some(v => v.retiredAt || (v.lastRunAt && !v.macActive));
    if (cloudOwned || !macConnected) {
      const best = relevant.reduce((s, v) => (RANK[v.state as RoleState] > RANK[s] ? v.state as RoleState : s), 'disconnected' as RoleState);
      if (!macConnected || RANK[best] >= RANK[role.state]) role.state = best;
      role.heldReasons = role.heldReasons.filter(r => r !== 'mac_worker_offline' && r !== 'mac_status_ingest_stale');
      role.lifePenaltyExempt = false;
      const last = relevant.map(v => v.lastRunAt).filter(Boolean).sort().at(-1);
      if (last && (!role.lastRunAt || Date.parse(last) > Date.parse(role.lastRunAt))) role.lastRunAt = last;
    }
    role.heldReasons = [...new Set([...role.heldReasons, ...relevant.flatMap(v => v.reasons)])].filter(c => CODE.test(c)).slice(0, 100);
    for (const v of relevant) for (const [k, n] of Object.entries(v.counts)) {
      const key = `cloud_${v.lane}_${k}`.slice(0, 60);
      if (CODE.test(key) && (Object.hasOwn(role.outputs, key) || Object.keys(role.outputs).length < 20)) role.outputs[key] = n;
    }
    const notes = relevant.map(v => v.note).filter((n): n is string => !!n);
    if (notes.length) role.ownerNotes = [...new Set([...(role.ownerNotes ?? []), ...notes])].slice(0, 5);
  }
  return report;
}

// ---------- Self-heal: a cloud lane failing on code 3+ consecutive runs becomes an allowlisted office finding ----------
export const CLOUD_LANES_SELF_HEAL_RECORD = (lane: string) => createHash('sha256').update(JSON.stringify(['clippers-cloud-lanes', lane, 'robertmanzanillag-jpg/blackops'])).digest('hex');
export function cloudLanesSelfHealAudits(raw: string | null): SelfHealObservedAudit[] {
  const state = parseLanesState(raw);
  const findings: SelfHealObservedAudit['findings'] = [], records: SelfHealObservedAudit['records'] = {};
  let latest: string | null = null;
  for (const lane of CLOUD_LEASED_LANES) {
    const l = state.lanes[lane], run = l?.lastRun;
    if (!run) continue;
    if (!latest || Date.parse(run.at) > Date.parse(latest)) latest = run.at;
    if (run.heldReasons.some(r => r.startsWith('missing_secret:'))) findings.push({ code: 'CAPABILITY_UNAVAILABLE', recordId: null });
    if ((l.failureStreak ?? 0) >= CLOUD_LANE_FAILURE_STREAK_THRESHOLD) {
      const id = CLOUD_LANES_SELF_HEAL_RECORD(lane);
      findings.push({ code: 'CLOUD_LANE_FAILING', recordId: id });
      records[id] = { repo: 'robertmanzanillag-jpg/blackops' } as SelfHealObservedAudit['records'][string];
    }
  }
  if (!latest) return [];
  const dedup = findings.filter((f, i) => f.recordId !== null || findings.findIndex(g => g.code === f.code && g.recordId === null) === i);
  return [{ role: 'clippers-cloud-lanes', jobId: `clippers-cloud-lanes:${latest}`, completedAt: latest, status: 'completed', completeCoverage: true,
    artifactId: createHash('sha256').update(JSON.stringify(state.lanes)).digest('hex').slice(0, 64), findings: dedup, records }];
}
export async function readCloudLanesState(owner: string): Promise<string | null> {
  const store = await (await import('./agent-council-store')).getCouncilStore();
  return store.read(CLOUD_LANES_NAMESPACE(owner));
}
export async function readCloudLanesSelfHealAudits(owner: string): Promise<SelfHealObservedAudit[]> {
  return cloudLanesSelfHealAudits(await readCloudLanesState(owner));
}
