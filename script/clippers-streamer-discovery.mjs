// Cloud streamer discovery for the streamer clip pages (formerly NY/Miami News brands).
//
// Extends the existing Clippers discovery (shared/clippers-priority-creators.mjs catalogue, the
// public-RSS portfolio discovery and the orchestra "Streamers" role) with official, $0 APIs:
//   Twitch Helix (app token, client credentials): resolve catalogue logins, top live streams,
//     top clips (last 24h) for priority creators, top categories.
//   YouTube Data API v3 (API key): channel descriptions, recent uploads/lives of priority creators,
//     trending gaming (mostPopular, category 20). search.list (100 units) is never used.
// Then: explicit no-clip check per creator (description + known-prohibited + takedowns), ranking,
// download plan (Twitch clips: cloud probe only when opted in; YouTube: Mac yt-dlp), and one owner
// approval row per shortlisted clip in the existing `pending_actions` queue (office approvals).
//
// State lives in PostgreSQL in the existing council store (agent_council_state) under the owner
// namespace `clippers-streamers:<owner>`: no new table, no disk state. Publication never happens here.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ALL_DISCOVERY_CREATORS, PRIORITY_CREATORS, TWITCH_LOGIN_CANDIDATES, KNOWN_PROHIBITED_CREATORS } from '../shared/clippers-priority-creators.mjs';
import { routeCandidate, parseAutopublishOverride, overrideLaneIds } from '../shared/clippers-account-lanes.mjs';
import { resolveClipPolicy, buildCreditCaption, parseCityPageNames, parseTakedown, takedownBlocks, clipLengthAllowed, creatorKey } from '../shared/clippers-streamer-policy.mjs';

export const STREAMER_SECRET_NAMES = Object.freeze(['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'YOUTUBE_API_KEY']);
export const STREAMER_STATE_NAMESPACE = owner => `clippers-streamers:${owner}`;
export const STREAMER_APPROVAL_ACTION = 'clippers.streamer_clip_publish';
const HOUR = 3600_000;
const MAX_CANDIDATES = 200;
const real = v => typeof v === 'string' && v.trim().length > 0 && !/^(replace|paste|your-|<)/i.test(v.trim());
const int = (v, d, min, max) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const iso = ms => new Date(ms).toISOString();

export function streamerConfig(env = process.env) {
  const twitch = real(env.TWITCH_CLIENT_ID) && real(env.TWITCH_CLIENT_SECRET);
  const youtube = real(env.YOUTUBE_API_KEY);
  const missing = STREAMER_SECRET_NAMES.filter(name => !real(env[name]));
  const city = parseCityPageNames(env.CLIPPERS_CITY_PAGE_NAMES);
  return {
    twitch, youtube, missing, city,
    autoPublish: env.CLIPPERS_STREAMER_AUTO_PUBLISH === 'true',
    // Owner override lanes: with CLIPPERS_STREAMER_AUTO_PUBLISH unset (or 'lanes'), clips routed to an
    // overridden lane skip the BlackOps owner approval; every other gate (policy, takedown, length) still applies.
    // 'false' puts every clip back on owner approval; CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE="" does the same.
    autoPublishLanes: env.CLIPPERS_STREAMER_AUTO_PUBLISH === 'false' ? new Set() : overrideLaneIds(parseAutopublishOverride(env.CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE)),
    maxApprovalsPerRun: int(env.CLIPPERS_STREAMER_APPROVALS_PER_RUN, 5, 0, 20),
    maxOpenApprovals: int(env.CLIPPERS_STREAMER_MAX_OPEN_APPROVALS, 25, 0, 100),
    youtubeUnitBudget: int(env.CLIPPERS_YOUTUBE_UNITS_PER_RUN, 60, 0, 400),
    youtubeRegions: String(env.CLIPPERS_YOUTUBE_TRENDING_REGIONS || 'US,ES,MX').split(',').map(r => r.trim().toUpperCase()).filter(r => /^[A-Z]{2}$/.test(r)).slice(0, 4),
    twitchCloudDownload: env.CLIPPERS_TWITCH_CLOUD_DOWNLOAD === 'probe',
    // With the cloud publisher on, only platforms it can download get approval rows (and count as open),
    // so unpublishable YouTube approvals never fill the open-approval budget.
    approvalPlatforms: env.CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED === 'true'
      ? [...new Set(String(env.CLIPPERS_STREAMER_CLOUD_PLATFORMS || 'twitch').split(',').map(p => p.trim().toLowerCase()).filter(p => ['twitch', 'youtube'].includes(p)))]
      : ['twitch', 'youtube'],
  };
}

// ---------- HTTP clients (fetch injected for tests) ----------
async function json(fetchImpl, url, init, code) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Object.assign(new Error(code), { status: response.status });
  return response.json();
}

export function createTwitchClient({ fetch: fetchImpl, clientId, clientSecret }) {
  let token = null, requests = 0;
  async function auth() {
    if (token) return token;
    const url = new URL('https://id.twitch.tv/oauth2/token');
    url.search = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString();
    requests++;
    const body = await json(fetchImpl, url, { method: 'POST' }, 'TWITCH_TOKEN_FAILED');
    if (typeof body?.access_token !== 'string') throw new Error('TWITCH_TOKEN_FAILED');
    return token = body.access_token;
  }
  async function helix(path, params) {
    const url = new URL(`https://api.twitch.tv/helix/${path}`);
    for (const [k, v] of params) url.searchParams.append(k, String(v));
    requests++;
    const body = await json(fetchImpl, url, { headers: { 'Client-Id': clientId, Authorization: `Bearer ${await auth()}` } }, 'TWITCH_HELIX_FAILED');
    return Array.isArray(body?.data) ? body.data : [];
  }
  return { helix, get requests() { return requests; } };
}

export function createYoutubeClient({ fetch: fetchImpl, apiKey, unitBudget }) {
  let units = 0;
  async function api(path, params, cost = 1) {
    if (units + cost > unitBudget) throw new Error('YOUTUBE_UNIT_BUDGET_REACHED');
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set('key', apiKey);
    units += cost;
    const body = await json(fetchImpl, url, {}, 'YOUTUBE_API_FAILED');
    return Array.isArray(body?.items) ? body.items : [];
  }
  return { api, get units() { return units; } };
}

// ---------- ISO-8601 duration (YouTube contentDetails.duration) ----------
export function isoDurationSeconds(value) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(value ?? ''));
  if (!m) return null;
  return ((+m[1] || 0) * 86400) + ((+m[2] || 0) * 3600) + ((+m[3] || 0) * 60) + (+m[4] || 0);
}

// ---------- Ranking ----------
/** "Popping" score: log views-per-hour, plus a catalogue bonus. Deterministic and explainable. */
export function popScore({ views, publishedAt, observedAt, priority, live = false }) {
  const ageH = Math.max(0.5, (Date.parse(observedAt) - Date.parse(publishedAt)) / HOUR);
  const velocity = live ? views : views / ageH;
  return { velocity: Math.round(velocity), score: Math.round((Math.log10(1 + Math.max(0, velocity)) + (priority ? 1 : 0)) * 1000) / 1000 };
}

// ---------- Discovery ----------
async function discoverTwitch(client, now, catalogue) {
  const observedAt = iso(now), out = { creators: [], streams: [], clips: [] };
  const logins = [...new Set(Object.values(TWITCH_LOGIN_CANDIDATES).flat())].slice(0, 100);
  const users = logins.length ? await client.helix('users', logins.map(l => ['login', l])) : [];
  const byLogin = new Map(users.map(u => [String(u.login).toLowerCase(), u]));
  const known = new Map();
  for (const [creatorId, list] of Object.entries(TWITCH_LOGIN_CANDIDATES)) {
    for (const login of list) { const u = byLogin.get(login); if (u) known.set(u.id, { creatorId, groupId: catalogue.get(creatorId)?.creatorGroupId ?? creatorId, user: u }); }
  }
  // Top live streams (global) and top categories' streams.
  const top = await client.helix('streams', [['first', 20]]);
  const games = await client.helix('games/top', [['first', 3]]);
  const gameStreams = [];
  for (const g of games) gameStreams.push(...await client.helix('streams', [['game_id', g.id], ['first', 5]]));
  const priorityLive = known.size ? await client.helix('streams', [...known.keys()].slice(0, 100).map(id => ['user_id', id])) : [];
  const streams = [...new Map([...priorityLive, ...top, ...gameStreams].map(s => [s.user_id, s])).values()];
  // Unknown live broadcasters need their description for the prohibition check.
  const unknownIds = streams.map(s => s.user_id).filter(id => !known.has(id)).slice(0, 100);
  const extra = unknownIds.length ? await client.helix('users', unknownIds.map(id => ['id', id])) : [];
  const describe = new Map([...[...known.values()].map(k => [k.user.id, k.user]), ...extra.map(u => [u.id, u])]);
  for (const [id, u] of describe) out.creators.push({ key: creatorKey('twitch', id), platform: 'twitch', handle: u.login, displayName: u.display_name ?? u.login,
    creatorGroupId: known.get(id)?.groupId ?? null, description: String(u.description ?? ''), descriptionSource: `https://www.twitch.tv/${u.login}/about`, priority: known.has(id) });
  for (const s of streams) out.streams.push({ id: `twitch-live:${s.user_id}:${Date.parse(s.started_at) || 0}`, platform: 'twitch', kind: 'live', creatorKey: creatorKey('twitch', s.user_id),
    handle: s.user_login, title: String(s.title ?? '').slice(0, 200), sourceUrl: `https://www.twitch.tv/${s.user_login}`, views: Number(s.viewer_count) || 0,
    publishedAt: s.started_at, observedAt, gameName: s.game_name ?? null, priority: known.has(s.user_id) });
  // Top clips in the last 24h for priority creators plus the five biggest live channels.
  const since = iso(now - 24 * HOUR);
  const gameNames = new Map([...games.map(g => [g.id, g.name]), ...streams.map(s => [s.game_id, s.game_name])].filter(([id, name]) => id && name));
  const clipTargets = [...new Set([...known.keys(), ...streams.slice(0, 5).map(s => s.user_id)])].slice(0, 32);
  for (const id of clipTargets) {
    for (const c of await client.helix('clips', [['broadcaster_id', id], ['started_at', since], ['first', 5]])) {
      out.clips.push({ id: `twitch-clip:${c.id}`, platform: 'twitch', kind: 'clip', creatorKey: creatorKey('twitch', c.broadcaster_id), handle: describe.get(c.broadcaster_id)?.login ?? c.broadcaster_name,
        title: String(c.title ?? '').slice(0, 200), sourceUrl: c.url, durationSec: Number(c.duration) || null, views: Number(c.view_count) || 0,
        publishedAt: c.created_at, observedAt, thumbnailUrl: c.thumbnail_url ?? null, priority: known.has(c.broadcaster_id),
        // Lane routing + cross-account dedupe: language, game and the VOD segment the clip came from.
        language: typeof c.language === 'string' ? c.language.slice(0, 8) : null, gameName: gameNames.get(c.game_id) ?? null,
        vodId: /^\d{1,20}$/.test(String(c.video_id ?? '')) ? String(c.video_id) : null, vodOffset: Number.isFinite(c.vod_offset) ? c.vod_offset : null });
    }
  }
  return out;
}

async function discoverYoutube(client, now, regions) {
  const observedAt = iso(now), out = { creators: [], videos: [], heldReasons: [] };
  const channels = [...new Map(PRIORITY_CREATORS.map(c => [c.channelId, c])).values()];
  try {
    const items = await client.api('channels', { part: 'snippet', id: channels.map(c => c.channelId).join(','), maxResults: 50 });
    for (const ch of items) {
      const c = channels.find(x => x.channelId === ch.id);
      out.creators.push({ key: creatorKey('youtube', ch.id), platform: 'youtube', handle: c?.handle ?? ch.snippet?.customUrl ?? ch.id, displayName: ch.snippet?.title ?? c?.name,
        creatorGroupId: c?.creatorGroupId ?? null, description: String(ch.snippet?.description ?? ''), descriptionSource: `https://www.youtube.com/channel/${ch.id}/about`, priority: !!c });
    }
    const ids = [];
    for (const c of channels) {
      const uploads = await client.api('playlistItems', { part: 'contentDetails', playlistId: 'UU' + c.channelId.slice(2), maxResults: 3 });
      ids.push(...uploads.map(u => u.contentDetails?.videoId).filter(Boolean));
    }
    const trending = [];
    for (const regionCode of regions) trending.push(...await client.api('videos', { part: 'id', chart: 'mostPopular', videoCategoryId: 20, regionCode, maxResults: 10 }));
    const all = [...new Set([...ids, ...trending.map(t => t.id)])];
    for (let i = 0; i < all.length; i += 50) {
      for (const v of await client.api('videos', { part: 'snippet,statistics,contentDetails,liveStreamingDetails', id: all.slice(i, i + 50).join(',') })) {
        const c = channels.find(x => x.channelId === v.snippet?.channelId);
        out.videos.push({ id: `youtube:${v.id}`, platform: 'youtube', kind: v.snippet?.liveBroadcastContent === 'live' ? 'live' : 'video', creatorKey: creatorKey('youtube', v.snippet?.channelId),
          handle: c?.handle ?? v.snippet?.channelTitle, title: String(v.snippet?.title ?? '').slice(0, 200), sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
          durationSec: isoDurationSeconds(v.contentDetails?.duration), views: Number(v.statistics?.viewCount) || 0,
          publishedAt: v.liveStreamingDetails?.actualStartTime ?? v.snippet?.publishedAt, observedAt, priority: !!c });
      }
    }
    // Trending channels outside the catalogue need their description too.
    const outside = [...new Set(out.videos.filter(v => !v.priority).map(v => v.creatorKey.slice(8)))].slice(0, 50);
    if (outside.length) for (const ch of await client.api('channels', { part: 'snippet', id: outside.join(','), maxResults: 50 })) {
      out.creators.push({ key: creatorKey('youtube', ch.id), platform: 'youtube', handle: ch.snippet?.customUrl ?? ch.id, displayName: ch.snippet?.title, creatorGroupId: null,
        description: String(ch.snippet?.description ?? ''), descriptionSource: `https://www.youtube.com/channel/${ch.id}/about`, priority: false });
    }
  } catch (error) {
    if (error?.message !== 'YOUTUBE_UNIT_BUDGET_REACHED') throw error;
    out.heldReasons.push('youtube_unit_budget_reached');
  }
  return out;
}

/** Twitch exposes no official third-party clip download. The cloud only PROBES the unofficial
 * thumbnail-derived mp4 URL (opt-in), never downloads; real downloads stay on the Mac (yt-dlp). */
export function twitchClipMp4Guess(thumbnailUrl) {
  const m = /^https:\/\/clips-media-assets2\.twitch\.tv\/([^?#]+)-preview-\d+x\d+\.jpg$/.exec(String(thumbnailUrl ?? ''));
  return m ? `https://clips-media-assets2.twitch.tv/${m[1]}.mp4` : null;
}

function downloadPlan(candidate) {
  if (candidate.kind === 'live') return { mode: 'not_applicable_live', status: 'watch_only' };
  if (candidate.platform === 'twitch') return { mode: 'needs_local_download', status: 'queued_for_mac', tool: 'yt-dlp', cloudProbe: null };
  return { mode: 'needs_local_download', status: 'queued_for_mac', tool: 'yt-dlp', needsCutSelection: !clipLengthAllowed(candidate.durationSec) };
}

// ---------- State ----------
export function emptyStreamerState() {
  return { version: 1, updatedAt: null, lastRun: null, creators: {}, takedowns: [], candidates: [], signals: [] };
}
/** null when a stored state exists but is not a valid v1 state (callers must not overwrite it). */
export function parseStreamerStateStrict(raw) {
  if (!raw) return emptyStreamerState();
  try { const s = JSON.parse(raw); return s?.version === 1 && Array.isArray(s.candidates) && Array.isArray(s.takedowns ?? []) && s.creators && typeof s.creators === 'object' ? { ...emptyStreamerState(), ...s } : null; }
  catch { return null; }
}
export function parseStreamerState(raw) {
  if (!raw) return emptyStreamerState();
  try { const s = JSON.parse(raw); return s?.version === 1 && Array.isArray(s.candidates) ? { ...emptyStreamerState(), ...s } : emptyStreamerState(); }
  catch { return emptyStreamerState(); }
}

/** Pure merge of one discovery pass into state. */
export function applyDiscovery(state, { now, twitch, youtube, config }) {
  const next = structuredClone(state), checkedAt = iso(now);
  next.takedowns = (next.takedowns ?? []).map(t => parseTakedown(t, now)).filter(Boolean);
  for (const c of [...(twitch?.creators ?? []), ...(youtube?.creators ?? [])]) {
    const policy = resolveClipPolicy({ creatorKey: c.key, creatorGroupId: c.creatorGroupId, description: c.description, descriptionSource: c.descriptionSource,
      takedowns: next.takedowns, knownProhibited: KNOWN_PROHIBITED_CREATORS, checkedAt });
    next.creators[c.key] = { key: c.key, platform: c.platform, handle: c.handle, displayName: c.displayName ?? c.handle, creatorGroupId: c.creatorGroupId, priority: c.priority, policy,
      descriptionSha256: sha(c.description) };
  }
  const byId = new Map(next.candidates.map(c => [c.id, c]));
  const fresh = [...(twitch?.clips ?? []), ...(youtube?.videos ?? []).filter(v => v.kind !== 'live')];
  for (const raw of fresh) {
    if (!raw.publishedAt || !raw.sourceUrl) continue;
    const creator = next.creators[raw.creatorKey];
    const policy = resolveClipPolicy({ creatorKey: raw.creatorKey, creatorGroupId: creator?.creatorGroupId ?? null, candidateId: raw.id, description: '', descriptionSource: null,
      takedowns: next.takedowns, checkedAt });
    const effective = policy.status === 'prohibited' ? policy : creator?.policy ?? { status: 'allowed_unless_prohibited', source: 'not_checked', evidence: null, checkedAt };
    const { velocity, score } = popScore({ ...raw, priority: raw.priority });
    const prior = byId.get(raw.id);
    byId.set(raw.id, { ...prior, ...raw, thumbnailUrl: undefined, velocity, score, clipPolicy: effective,
      download: prior?.download ?? downloadPlan(raw), approval: prior?.approval ?? { status: 'not_requested', pendingActionId: null },
      caption: buildCreditCaption({ handle: raw.handle, platform: raw.platform, sourceUrl: raw.sourceUrl, title: raw.title }),
      firstSeenAt: prior?.firstSeenAt ?? checkedAt, mp4Guess: raw.platform === 'twitch' ? twitchClipMp4Guess(raw.thumbnailUrl) : null });
  }
  // Keep only the newest/highest; prohibited ones stay visible (with evidence) but are never queued.
  next.candidates = [...byId.values()].filter(c => now - Date.parse(c.observedAt) <= 7 * 24 * HOUR)
    .sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
  next.signals = [...(twitch?.streams ?? []), ...(youtube?.videos ?? []).filter(v => v.kind === 'live')]
    .map(s => ({ ...s, ...popScore({ ...s, live: true }), clipPolicy: next.creators[s.creatorKey]?.policy?.status ?? 'allowed_unless_prohibited' }))
    .sort((a, b) => b.score - a.score).slice(0, 30);
  next.updatedAt = checkedAt;
  next.cityPages = config.city.pages;
  return next;
}

/** True only when the creator's own channel description was actually checked this lane. */
export function creatorPolicyChecked(state, candidate) {
  const creator = state.creators?.[candidate.creatorKey];
  return !!creator && !!creator.policy && creator.policy.source !== 'not_checked';
}

/** Candidates eligible for an owner approval row now. */
export function selectForApproval(state, config) {
  const platforms = config.approvalPlatforms?.length ? config.approvalPlatforms : ['twitch', 'youtube'];
  const open = state.candidates.filter(c => platforms.includes(c.platform) && ['pending', 'approved'].includes(c.approval?.status)).length;
  const room = Math.max(0, Math.min(config.maxApprovalsPerRun, config.maxOpenApprovals - open));
  return state.candidates.filter(c => platforms.includes(c.platform) && c.approval?.status === 'not_requested' && c.clipPolicy?.status === 'allowed_unless_prohibited' && creatorPolicyChecked(state, c) &&
    !takedownBlocks(state.takedowns, { creatorKey: c.creatorKey, creatorGroupId: state.creators[c.creatorKey]?.creatorGroupId, candidateId: c.id }) &&
    (c.platform === 'twitch' ? clipLengthAllowed(c.durationSec) : true)).slice(0, room);
}

// ---------- Approval queue (existing pending_actions table; owner-only via user_id) ----------
/** 'auto_publish_flag' (global flag), 'lane_owner_override' (overridden lane) or 'owner_approval'. */
export function approvalModeFor(candidate, config, creator = null) {
  if (config.autoPublish) return 'auto_publish_flag';
  const lane = config.autoPublishLanes?.size ? routeCandidate(candidate, { creator }).lane : null;
  return lane && config.autoPublishLanes.has(lane) ? 'lane_owner_override' : 'owner_approval';
}

export function approvalRow(candidate, owner, config, creator = null) {
  const mode = approvalModeFor(candidate, config, creator);
  const auto = mode !== 'owner_approval';
  return {
    userId: owner, actionType: STREAMER_APPROVAL_ACTION, resourceType: 'clippers_streamer_candidate', resourceId: candidate.id,
    title: `Clip de @${String(candidate.handle).slice(0, 40)}: ${String(candidate.title).slice(0, 80)}`,
    description: `Aprobar para recortar (máx. 60 s, editado), acreditar y programar en las páginas de clips. Fuente: ${candidate.sourceUrl}. Descarga: ${candidate.download.mode}. Publicación sólo por la ruta Metricool existente tras la aprobación.`,
    riskLevel: 'medium', status: auto ? 'approved' : 'pending',
    input: { candidateId: candidate.id, platform: candidate.platform, sourceUrl: candidate.sourceUrl, handle: candidate.handle, caption: candidate.caption,
      durationSec: candidate.durationSec ?? null, download: candidate.download, clipPolicy: candidate.clipPolicy.status, destinations: config.city.pages.map(p => p.brandId),
      approvalMode: mode },
  };
}

/** Advisory key serializing approval inserts per owner/action/candidate (concurrent runs never duplicate a live row). */
export const approvalInsertLockKey = row => JSON.stringify(['clippers-streamer-approval-v1', row.userId, row.actionType, row.resourceId]);

/** transaction(fn): runs fn(query) inside BEGIN/COMMIT on one connection. Without it inserts are only
 * idempotent sequentially (unit tests); production always passes one. */
export function createPendingActionsQueue(query, { transaction } = {}) {
  const insertOnce = async (q, row) => {
      // Idempotent: a live row (any status but rejected/failed) for the same owner/action/candidate is reused.
      const result = await q(`WITH existing AS (
          SELECT id FROM pending_actions WHERE user_id=$1 AND action_type=$2 AND resource_id=$4 AND status NOT IN ('rejected','failed') ORDER BY created_at LIMIT 1
        ), inserted AS (
          INSERT INTO pending_actions (user_id, created_by_actor_type, created_by_actor_id, origin, action_type, resource_type, resource_id, title, description, risk_level, permission_level_required, status, input, approved_by, approved_at, approval_reason)
          SELECT $1,'scheduler','clippers-streamers','scheduler',$2,$3,$4,$5,$6,$7,'execute_after_approval',$8,$9::jsonb,$10,$11,$12
          WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id
        ) SELECT id FROM inserted UNION ALL SELECT id FROM existing LIMIT 1`,
        [row.userId, row.actionType, row.resourceType, row.resourceId, row.title, row.description, row.riskLevel, row.status, JSON.stringify(row.input),
          row.status === 'approved' ? 'clippers-auto-publish-flag' : null, row.status === 'approved' ? new Date() : null, row.status === 'approved' ? (row.input.approvalMode === 'lane_owner_override' ? 'CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE (owner decision)' : 'CLIPPERS_STREAMER_AUTO_PUBLISH=true') : null]);
      if (!result.rows[0]) throw new Error('PENDING_ACTION_INSERT_FAILED');
      return String(result.rows[0].id);
  };
  return {
    async insert(row) {
      if (!transaction) return insertOnce(query, row);
      // Lock first, then check-and-insert in a NEW statement: its snapshot sees any row a concurrent
      // run committed while this one waited, so two runs can never both insert a live row.
      return transaction(async q => {
        await q('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [approvalInsertLockKey(row)]);
        return insertOnce(q, row);
      });
    },
    /** Takedown: reject every still-open approval row for these candidates. */
    async rejectCandidates(owner, candidateIds, reason) {
      if (!candidateIds.length) return 0;
      const result = await query(`UPDATE pending_actions SET status='rejected', rejection_reason=$4, updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1 AND action_type=$2 AND resource_id = ANY($3::text[]) AND status IN ('pending','edited','snoozed','approved') RETURNING id`, [owner, STREAMER_APPROVAL_ACTION, candidateIds, reason]);
      return result.rows.length;
    },
    async statuses(owner, ids) {
      if (!ids.length) return new Map();
      const result = await query('SELECT id, status FROM pending_actions WHERE user_id=$1 AND action_type=$2 AND id = ANY($3::varchar[])', [owner, STREAMER_APPROVAL_ACTION, ids]);
      return new Map(result.rows.map(r => [String(r.id), String(r.status)]));
    },
  };
}

/** Owner decisions from the approval queue onto local candidates (pure; no IO). */
export function syncApprovals(state, statuses) {
  // Prohibited / taken-down clips stay rejected locally even if the row was approved before the takedown.
  for (const c of state.candidates) if (c.clipPolicy?.status === 'prohibited' && c.approval && c.approval.status !== 'not_requested') c.approval.status = 'rejected';
  for (const c of state.candidates) if (c.clipPolicy?.status !== 'prohibited' && c.approval?.pendingActionId && statuses.has(c.approval.pendingActionId)) c.approval.status = statuses.get(c.approval.pendingActionId) === 'executed' ? 'approved' : statuses.get(c.approval.pendingActionId);
  return state;
}

// ---------- One run ----------
export async function runStreamerDiscovery({ env = process.env, now = Date.now(), fetch: fetchImpl = globalThis.fetch, store, queue, owner, minIntervalMs = 0 }) {
  const config = streamerConfig(env);
  const heldReasons = [...config.missing.map(n => `missing_secret:${n}`), ...config.city.heldReasons];
  const catalogue = new Map(ALL_DISCOVERY_CREATORS.map(c => [c.id, c]));
  const report = { at: iso(now), status: 'completed', heldReasons, errors: [], counts: {}, twitchRequests: 0, youtubeUnits: 0, paidSpendUsd: 0, published: 0 };
  if (!config.twitch && !config.youtube) { report.status = 'skipped_missing_secrets'; }
  // Hourly cadence even when several triggers fire: skip (without writing) if the last run is recent.
  if (minIntervalMs > 0) {
    const last = parseStreamerState(await store.read(STREAMER_STATE_NAMESPACE(owner))).lastRun;
    if (last && now - Date.parse(last.at) >= 0 && now - Date.parse(last.at) < minIntervalMs) return { report: { ...last, status: 'skipped_recent_run', skippedAt: iso(now) }, state: null, skipped: true };
  }
  // Rejected keys (401/403) are an owner action, like missing keys: held reason, never a code failure.
  let credentialFailures = 0;
  const failure = (e, platform) => {
    if ([401, 403].includes(e?.status)) { heldReasons.push(`credential_invalid:${platform}`); credentialFailures++; return; }
    report.errors.push(String(e?.message ?? `${platform}_FAILED`).slice(0, 60));
  };
  let twitch = null, youtube = null;
  if (config.twitch) {
    const client = createTwitchClient({ fetch: fetchImpl, clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET });
    try { twitch = await discoverTwitch(client, now, catalogue); } catch (e) { failure(e, 'TWITCH'); }
    report.twitchRequests = client.requests;
  }
  if (config.youtube) {
    const client = createYoutubeClient({ fetch: fetchImpl, apiKey: env.YOUTUBE_API_KEY, unitBudget: config.youtubeUnitBudget });
    try { youtube = await discoverYoutube(client, now, config.youtubeRegions); heldReasons.push(...youtube.heldReasons); } catch (e) { failure(e, 'YOUTUBE'); }
    report.youtubeUnits = client.units;
  }
  if (config.twitchCloudDownload && twitch) {
    for (const clip of twitch.clips.slice(0, 5)) {
      const guess = twitchClipMp4Guess(clip.thumbnailUrl);
      clip.cloudProbe = guess ? await fetchImpl(guess, { method: 'HEAD', signal: AbortSignal.timeout(10_000) }).then(r => ({ ok: r.ok, bytes: Number(r.headers.get('content-length')) || null })).catch(() => ({ ok: false, bytes: null })) : { ok: false, bytes: null };
    }
  }
  if (report.errors.length) report.status = twitch || youtube ? 'partial' : 'failed';
  else if (credentialFailures) report.status = twitch || youtube ? 'partial' : 'held_credentials';
  let queued = 0;
  // Never hold the council owner lock across IO on another pool: read the approval queue and insert
  // (idempotent per candidate) BEFORE the transaction; the transaction itself only applies results.
  const ns = STREAMER_STATE_NAMESPACE(owner);
  const preview = parseStreamerStateStrict(await store.read(ns));
  if (!preview) throw new Error('STREAMER_STATE_INVALID');
  const draft = twitch || youtube ? applyDiscovery(preview, { now, twitch, youtube, config }) : preview;
  const draftIds = draft.candidates.map(c => c.approval?.pendingActionId).filter(Boolean);
  const statuses = queue ? await queue.statuses(owner, draftIds) : new Map();
  syncApprovals(draft, statuses);
  const requested = new Map();
  if (queue && config.city.pages.length) {
    for (const c of selectForApproval(draft, config)) {
      const row = approvalRow(c, owner, config, draft.creators?.[c.creatorKey] ?? null);
      requested.set(c.id, { status: row.status, pendingActionId: await queue.insert(row), requestedAt: report.at, mode: row.input.approvalMode });
    }
  }
  const saved = await store.transact(ns, async raw => {
    let state = parseStreamerStateStrict(raw);
    if (!state) throw new Error('STREAMER_STATE_INVALID');
    if (twitch || youtube) state = applyDiscovery(state, { now, twitch, youtube, config });
    syncApprovals(state, statuses);
    queued = 0;
    for (const c of state.candidates) {
      const approval = requested.get(c.id);
      if (approval && c.approval?.status === 'not_requested') { c.approval = approval; queued++; }
    }
    const overdue = state.takedowns.filter(t => !t.removedAt && Date.parse(t.removeBy) < now);
    if (overdue.length) heldReasons.push('takedown_overdue');
    report.counts = { candidates: state.candidates.length, allowed: state.candidates.filter(c => c.clipPolicy?.status === 'allowed_unless_prohibited').length,
      prohibitedCreators: Object.values(state.creators).filter(c => c.policy?.status === 'prohibited').length, liveSignals: state.signals.length,
      queuedForApproval: queued, awaitingApproval: state.candidates.filter(c => c.approval?.status === 'pending').length,
      approved: state.candidates.filter(c => c.approval?.status === 'approved').length,
      needsLocalDownload: state.candidates.filter(c => c.download?.mode === 'needs_local_download' && c.approval?.status === 'approved').length,
      takedownsOpen: state.takedowns.filter(t => !t.removedAt).length };
    report.heldReasons = [...new Set(heldReasons)];
    // Code failures only (API/parse errors). Missing secrets are an owner action, never a code failure.
    state.failureStreak = report.errors.length && report.status !== 'skipped_missing_secrets' ? (state.failureStreak ?? 0) + 1 : 0;
    report.failureStreak = state.failureStreak;
    state.lastRun = report;
    return JSON.stringify(state);
  });
  return { report, state: JSON.parse(saved) };
}

/** Mac worker input: approved candidates that still need yt-dlp download + render. */
export function localWorkQueue(state) {
  return state.candidates.filter(c => c.approval?.status === 'approved' && c.download?.mode === 'needs_local_download' && c.clipPolicy?.status === 'allowed_unless_prohibited' && creatorPolicyChecked(state, c) &&
    !takedownBlocks(state.takedowns, { creatorKey: c.creatorKey, creatorGroupId: state.creators?.[c.creatorKey]?.creatorGroupId, candidateId: c.id }))
    .map(c => ({ candidateId: c.id, platform: c.platform, sourceUrl: c.sourceUrl, handle: c.handle, caption: c.caption, maxSeconds: 60, needsCutSelection: !!c.download.needsCutSelection, pendingActionId: c.approval.pendingActionId }));
}

async function main() {
  const args = process.argv.slice(2);
  const config = streamerConfig(process.env);
  if (!config.twitch && !config.youtube) {
    console.log(`::notice::Streamer discovery skipped: missing secrets ${config.missing.join(', ')}. Add them as repository Actions secrets.`);
  }
  if (!process.env.DATABASE_URL?.trim() || !process.env.DEFAULT_USER_ID?.trim()) {
    console.log('::notice::Streamer discovery skipped: OFFICE_DATABASE_URL / OFFICE_OWNER_ID not available.');
    return;
  }
  const { getCouncilStore, createCouncilPool } = await import('../server/agent-council-store.ts');
  const store = await getCouncilStore();
  const pool = await createCouncilPool('streamers');
  const query = async (sql, values) => { const client = await pool.connect(); try { return await client.query(sql, values); } finally { client.release(); } };
  const transaction = async fn => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      const out = await fn((sql, values) => client.query(sql, values));
      await client.query('COMMIT');
      return out;
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  };
  const owner = process.env.DEFAULT_USER_ID.trim();
  if (args.includes('--export-local-queue')) {
    console.log(JSON.stringify({ version: 1, items: localWorkQueue(parseStreamerState(await store.read(STREAMER_STATE_NAMESPACE(owner)))) }));
    return;
  }
  const minIntervalMs = args.includes('--respect-interval') ? int(process.env.CLIPPERS_STREAMERS_MIN_INTERVAL_MINUTES, 45, 1, 720) * 60_000 : 0;
  const { report, skipped } = await runStreamerDiscovery({ env: process.env, store, queue: createPendingActionsQueue(query, { transaction }), owner, minIntervalMs });
  if (skipped) { console.log(`::notice::Streamer discovery skipped: last run at ${report.at} is within the minimum interval.`); return; }
  // Static summary only: counts, codes. No URLs with keys, no tokens.
  console.log(JSON.stringify({ status: report.status, heldReasons: report.heldReasons, errors: report.errors, counts: report.counts, twitchRequests: report.twitchRequests, youtubeUnits: report.youtubeUnits }));
  if (report.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ error: 'STREAMER_DISCOVERY_FAILED', code: /^[A-Z_]{3,60}$/.test(error?.message ?? '') ? error.message : 'UNKNOWN' })); process.exitCode = 1; });
}
