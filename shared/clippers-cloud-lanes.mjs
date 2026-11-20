// Clippers lanes that used to run only on the operator Mac (macOS LaunchAgents) and their cloud replacements.
//
// State lives in PostgreSQL in the council store (agent_council_state) under `clippers-cloud-lanes:<owner>`:
//   lanes[lane]   last cloud run (status, held reasons, counts) + consecutive failure streak + last dry run
//   leases[lane]  who ran the lane last ('mac' | 'cloud') and when. A lane is single-holder: the cloud refuses a lane
//                 while the Mac heartbeat is fresh (< LANE_LEASE_MS) and the Mac refuses it while the cloud holds it,
//                 so nothing is rendered/uploaded twice during the transition.
//   retired[lane] set by the Mac retirement step (script/clippers-mac-retire.sh): the Mac never runs that lane again
//                 (until --unretire) and the cloud may take it over at once.
// Pure functions only (no I/O): the CLI (script/clippers-cloud-lanes.mjs) and the office overlay share them.

export const CLOUD_LANES_NAMESPACE = owner => `clippers-cloud-lanes:${owner}`;
export const CLOUD_WORKSPACE_NAMESPACE = owner => `clippers-cloud-workspace:${owner}`;
export const LANE_LEASE_MS = 26 * 3600_000;
export const CLOUD_LANE_STALE_MS = 30 * 3600_000;
export const CLOUD_LANE_FAILURE_STREAK_THRESHOLD = 3;

/** Every Mac LaunchAgent of the Clippers factory, what replaces it in the cloud and the office roles it feeds. */
export const MAC_LANES = Object.freeze({
  content: {
    label: 'com.blackops.clippers-content-worker', macTime: '04:00', roles: ['editor', 'checker'],
    cloud: 'clippers-cloud-lanes.yml (owned_content): Drive workspace -> motivation ES/EN + weekly sleep render -> Drive media + Postgres ledgers',
  },
  youtube_delivery: {
    label: 'com.blackops.clippers-youtube-delivery-worker', macTime: '06:30', roles: ['publisher'],
    cloud: 'clippers-cloud-lanes.yml (owned_content, after content): packager + YouTube Data API uploads with Actions secrets',
  },
  marketplace: {
    label: 'com.blackops.clippers-free-worker', macTime: '07:00', roles: ['trends', 'publisher'],
    cloud: 'clippers-cloud-lanes.yml (marketplace): snapshot intake -> render -> Drive -> CEO -> Metricool -> reconcile (no logged-in refresh)',
  },
  watchdog: {
    label: 'com.blackops.clippers-daily-watchdog', macTime: '10:00', roles: ['health', 'learning'],
    // Covered, not re-implemented: discovery = clippers-streamers.yml, publish + learning loop = clippers-streamers-publish.yml
    // (#463/#467/#479), freshness = this overlay (stale lanes) + office self-heal.
    cloud: 'covered by clippers-streamers.yml + clippers-streamers-publish.yml (#479 learning loop) and the office lane overlay',
    coveredOnly: true,
  },
  // Cloud-only lanes of the weekly `sleep` job: own records, leases and interval, handed over by the retirement of
  // the Mac lane they replace (macLane). They are never retired or gated on their own.
  sleep_content: {
    label: 'com.blackops.clippers-content-worker', macTime: 'weekly', roles: ['editor', 'checker'], macLane: 'content', cloudOnly: true,
    cloud: 'clippers-cloud-lanes.yml (sleep, flag CLIPPERS_CLOUD_SLEEP_ENABLED): 8 h sleep render',
  },
  sleep_delivery: {
    label: 'com.blackops.clippers-youtube-delivery-worker', macTime: 'weekly', roles: ['publisher'], macLane: 'youtube_delivery', cloudOnly: true,
    cloud: 'clippers-cloud-lanes.yml (sleep): YouTube delivery of the sleep video',
  },
});
export const LANE_IDS = Object.freeze(Object.keys(MAC_LANES));
/** Lanes that exist on the Mac (retire / Mac gate); cloud-only lanes follow their macLane. */
export const MAC_LANE_IDS = Object.freeze(LANE_IDS.filter(id => !MAC_LANES[id].cloudOnly));
export const macLaneOf = lane => MAC_LANES[lane]?.macLane ?? lane;
/** Which runner a lane uses. */
export const laneKind = lane => (lane === 'sleep_content' ? 'content' : lane === 'sleep_delivery' ? 'youtube_delivery' : lane);
/** Lanes a cloud job actually holds (watchdog is covered by the streamer jobs and is only retired). */
export const CLOUD_LEASED_LANES = Object.freeze(LANE_IDS.filter(id => !MAC_LANES[id].coveredOnly));
/** Lanes per cloud workflow job. */
// `sleep` = the weekly 8 h sleep render + its delivery, a separate job behind CLIPPERS_CLOUD_SLEEP_ENABLED (default off)
// until its runtime is measured; owned_content renders motivation only.
export const CLOUD_JOBS = Object.freeze({ owned_content: ['content', 'youtube_delivery'], sleep: ['sleep_content', 'sleep_delivery'], marketplace: ['marketplace'] });
/** Reasons that only say a flag is off by design (owner decision): shown, never a block. */
export const INFORMATIONAL_REASONS = Object.freeze(new Set(['metricool_autopublish_not_authorized', 'youtube_cloud_upload_disabled', 'dry_run_no_upload',
  'content_shortfall', 'global_public_publish_authorization_missing', 'youtube_api_project_audit_required']));
export const isInformational = r => INFORMATIONAL_REASONS.has(r);

const CODE = /^[a-zA-Z0-9_.:-]{1,120}$/;
const iso = v => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const safeCodes = list => [...new Set((Array.isArray(list) ? list : []).map(String).filter(c => CODE.test(c)))].slice(0, 30);

export function emptyLanesState() { return { version: 1, lanes: {}, leases: {}, retired: {} }; }

/** Tolerant parse (office reads): unknown lanes and malformed entries are dropped, never thrown. */
export function parseLanesState(raw) {
  let s;
  try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return emptyLanesState(); }
  const out = emptyLanesState();
  if (!isObj(s) || s.version !== 1) return out;
  for (const id of LANE_IDS) {
    const lane = s.lanes?.[id];
    if (isObj(lane)) out.lanes[id] = { lastRun: runOf(lane.lastRun), lastDryRun: runOf(lane.lastDryRun), failureStreak: Number.isSafeInteger(lane.failureStreak) && lane.failureStreak >= 0 ? lane.failureStreak : 0 };
    const lease = s.leases?.[id];
    if (isObj(lease) && ['mac', 'cloud'].includes(lease.holder) && iso(lease.at)) out.leases[id] = { holder: lease.holder, at: iso(lease.at), host: CODE.test(String(lease.host ?? '')) ? lease.host : null };
    const retired = s.retired?.[id];
    if (isObj(retired) && iso(retired.at)) out.retired[id] = { at: iso(retired.at), by: CODE.test(String(retired.by ?? '')) ? retired.by : 'owner' };
  }
  return out;
}

function runOf(run) {
  if (!isObj(run) || !iso(run.at)) return null;
  const counts = {};
  for (const [k, v] of Object.entries(isObj(run.counts) ? run.counts : {})) if (CODE.test(k) && Number.isSafeInteger(v) && v >= 0 && Object.keys(counts).length < 15) counts[k] = v;
  return { at: iso(run.at), status: CODE.test(String(run.status)) ? run.status : 'unknown', heldReasons: safeCodes(run.heldReasons), errors: safeCodes(run.errors), counts, dryRun: run.dryRun === true };
}

/**
 * Single-holder lease. Retirement is the only handover: holder 'cloud' is refused (mac_lane_not_retired) until the
 * owner retired the Mac lane; holder 'mac' is refused when the lane is retired or the cloud holds a fresh lease.
 * Dry runs never call this. On success the lease is renewed.
 * Mutates `state`; returns { ok, reason }.
 */
export function acquireLane(state, lane, holder, now, { host = null } = {}) {
  if (!LANE_IDS.includes(lane)) return { ok: false, reason: 'unknown_lane' };
  if (!['mac', 'cloud'].includes(holder)) return { ok: false, reason: 'unknown_holder' };
  if (holder === 'mac' && MAC_LANES[lane].cloudOnly) return { ok: false, reason: 'unknown_lane' };
  const retired = state.retired?.[macLaneOf(lane)];
  if (holder === 'mac' && retired) return { ok: false, reason: 'mac_lane_retired' };
  if (holder === 'cloud' && !retired) return { ok: false, reason: 'mac_lane_not_retired' };
  const lease = state.leases?.[lane];
  const fresh = lease && now - Date.parse(lease.at) < LANE_LEASE_MS && Date.parse(lease.at) <= now + 5 * 60_000;
  if (lease && lease.holder !== holder && fresh && !(holder === 'cloud' && retired)) {
    return { ok: false, reason: holder === 'cloud' ? 'mac_lane_active' : 'cloud_lane_active', since: lease.at };
  }
  state.leases ??= {};
  state.leases[lane] = { holder, at: new Date(now).toISOString(), host: host && CODE.test(host) ? host : null };
  return { ok: true, reason: null };
}

/** Record a cloud run (or dry run) and keep the failure streak (code failures only, not held/missing secrets). */
export function recordLaneRun(state, lane, run) {
  state.lanes ??= {};
  const prev = state.lanes[lane] ?? { lastRun: null, lastDryRun: null, failureStreak: 0 };
  const clean = runOf(run);
  if (!clean) return state;
  if (clean.dryRun) { state.lanes[lane] = { ...prev, lastDryRun: clean }; return state; }
  const streak = clean.status === 'failed' ? (prev.failureStreak ?? 0) + 1 : clean.status === 'held' ? (prev.failureStreak ?? 0) : 0;
  state.lanes[lane] = { ...prev, lastRun: clean, failureStreak: streak };
  return state;
}

/** Mac retirement: the lane is marked retired and the lease handed to the cloud. */
export function retireMacLanes(state, lanes, now, by = 'owner') {
  for (const lane of lanes) {
    if (!MAC_LANE_IDS.includes(lane)) throw new Error('unknown_lane');
    state.retired ??= {};
    state.retired[lane] = { at: new Date(now).toISOString(), by };
    if (!MAC_LANES[lane].coveredOnly) { state.leases ??= {}; state.leases[lane] = { holder: 'cloud', at: new Date(now).toISOString(), host: null }; }
  }
  return state;
}

/** Rollback to the Mac: the Mac takes the lease at once, so the cloud cannot run the lane again until re-retired. */
export function unretireMacLanes(state, lanes, now = Date.now()) {
  for (const lane of lanes) {
    if (!MAC_LANE_IDS.includes(lane)) throw new Error('unknown_lane');
    if (state.retired) delete state.retired[lane];
    state.leases ??= {};
    state.leases[lane] = { holder: 'mac', at: new Date(now).toISOString(), host: 'mac' };
  }
  return state;
}

/**
 * Cloud QA before retiring a Mac lane: a completed cloud run or dry run in the last 7 days.
 * Covered-only lanes (watchdog) need the streamer jobs instead, checked by the caller.
 */
export function laneCloudQa(state, lane, now) {
  const l = state.lanes?.[lane];
  // A dry run of the delivery lane uploads nothing, so it is never QA evidence for that lane.
  const ok = r => r && ['completed', 'completed_with_shortfall'].includes(r.status) && now - Date.parse(r.at) < 7 * 86400_000
    && !r.heldReasons.includes('dry_run_no_upload') && !r.heldReasons.includes('youtube_cloud_upload_disabled');
  if (ok(l?.lastRun)) return { ok: true, evidence: `cloud_run:${l.lastRun.at}` };
  if (ok(l?.lastDryRun)) return { ok: true, evidence: `cloud_dry_run:${l.lastDryRun.at}` };
  return { ok: false, evidence: null };
}

/**
 * Office view of one lane: state (completed | idle | held | stale | disconnected), reasons and owner note.
 * Mac off is never a failure on its own once the lane runs in the cloud.
 */
export function laneView(state, lane, now) {
  const l = state.lanes?.[lane], lease = state.leases?.[macLaneOf(lane)], retired = state.retired?.[macLaneOf(lane)] ?? null;
  const run = l?.lastRun ?? null;
  const macActive = lease?.holder === 'mac' && now - Date.parse(lease.at) < LANE_LEASE_MS && !retired;
  const reasons = [];
  let roleState;
  if (MAC_LANES[lane].coveredOnly) {
    roleState = retired ? 'completed' : 'idle';
    reasons.push(retired ? `mac_lane_retired:${lane}` : `mac_lane_not_retired:${lane}`);
  } else if (!run && MAC_LANES[lane].cloudOnly) {
    roleState = 'idle'; // weekly cloud-only lane that has not run yet: on duty, nothing to report
  } else if (!run) {
    roleState = macActive ? 'idle' : 'disconnected';
    reasons.push(macActive ? `mac_lane_active:${lane}` : `cloud_lane_never_ran:${lane}`);
  } else {
    const age = now - Date.parse(run.at);
    reasons.push(...run.heldReasons.map(r => `cloud_${lane}:${r}`), ...run.errors.map(e => `cloud_${lane}_error:${e}`));
    if (age > (MAC_LANES[lane].cloudOnly ? 8 * 86400_000 : CLOUD_LANE_STALE_MS)) { roleState = 'stale'; reasons.push(`cloud_lane_stale:${lane}`); }
    else if (run.status === 'failed') roleState = 'held';
    else if (run.status === 'held') roleState = macActive || run.heldReasons.some(r => r === 'mac_lane_active' || r === 'mac_lane_not_retired') ? 'idle' : 'held';
    else roleState = run.errors.length || run.heldReasons.some(r => !isInformational(r)) ? 'held' : 'completed';
    if (retired) reasons.push(`mac_lane_retired:${lane}`);
  }
  const missing = (run?.heldReasons ?? []).filter(r => r.startsWith('missing_secret:')).map(r => r.slice('missing_secret:'.length));
  const note = missing.length ? `Clippers nube (${lane}): faltan secretos ${missing.slice(0, 4).join(', ')}`.slice(0, 160)
    : macActive && !MAC_LANES[lane].coveredOnly ? `Clippers ${lane}: aún corre en el Mac; retíralo con script/clippers-mac-retire.sh`.slice(0, 160) : null;
  return { lane, state: roleState, reasons: safeCodes(reasons), counts: run?.counts ?? {}, lastRunAt: run?.at ?? null, retiredAt: retired?.at ?? null, macActive, note, failureStreak: l?.failureStreak ?? 0 };
}
