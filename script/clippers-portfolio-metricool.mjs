import { createHash, randomUUID } from 'node:crypto';

const API = 'https://app.metricool.com';
const MCP = 'https://ai.metricool.com/mcp';
export const TIME_ZONE = 'America/New_York';
export const DAILY_LIMIT = 5;
// Per-account scale-up ceiling (cloud streamer lanes, weekly median >= 1k views). Callers opt in per item.
export const SCALED_DAILY_LIMIT = 8;
// Live Metricool identities (getBrandSettings, 2026-11-19): 6431685 "memes" TikTok @streamersus,
// 6431687 "SPORT" TikTok @streamersclipusa, 6591612 TikTok @news305miami + Facebook page 1193011863901514.
export const DESTINATIONS = Object.freeze([
  Object.freeze({ brandId: 6431685, network: 'tiktok', account: 'streamersus' }),
  Object.freeze({ brandId: 6431687, network: 'tiktok', account: 'streamersclipusa' }),
  Object.freeze({ brandId: 6591612, network: 'tiktok', account: 'news305miami' }),
  Object.freeze({ brandId: 6591612, network: 'facebook', account: '1193011863901514' }),
]);
// Earlier account names of the same brand+network. Ledger rows written with them still resolve to (and
// count against the caps/duplicate checks of) the current destination; they are never targeted.
export const LEGACY_ACCOUNT_ALIASES = Object.freeze({
  '6431685:tiktok': Object.freeze(['streamersclips']),
  '6591612:tiktok': Object.freeze(['ynb4b6r6']),
});
export const DISCONNECTED_BRAND = 6595747;
export const localHour = time => new Intl.DateTimeFormat('en-US', {timeZone: TIME_ZONE, hour:'2-digit', hourCycle:'h23'}).format(new Date(time));
function accountAliases(destination) {
  return [destination.account, ...(LEGACY_ACCOUNT_ALIASES[`${destination.brandId}:${destination.network}`] ?? [])];
}
export function findDestination(value) {
  return DESTINATIONS.find(d => d.brandId === value?.brandId && d.network === value.network && accountAliases(d).includes(value.account));
}
/** Canonical key: a legacy account alias maps to the current destination's key. */
export const destinationKey = (value) => {
  const { brandId, network, account } = findDestination(value) ?? value;
  return [brandId, network, account].join(':');
};
/** Canonical form of a stored "brandId:network:account" key (legacy account aliases map to the current one). */
export function canonicalDestinationKey(key) {
  const m = /^(\d+):([a-z]+):(.+)$/.exec(String(key ?? ''));
  if (!m) return key;
  return destinationKey({ brandId: Number(m[1]), network: m[2], account: m[3] });
}
/** Current account for a stored brand/network/account triple (legacy alias -> current; anything else unchanged). */
export function canonicalAccount(brandId, network, account) {
  const value = String(account ?? '').replace(/^@/, '').toLowerCase();
  return findDestination({ brandId: Number(brandId), network, account: value })?.account ?? value;
}
/** state.versions-style lookup by destination key; the exact canonical key wins over a legacy alias key. */
export function valueForDestination(map, key) {
  if (!map || typeof map !== 'object') return undefined;
  const canonical = canonicalDestinationKey(key);
  if (Object.hasOwn(map, canonical)) return map[canonical];
  const legacy = Object.keys(map).find(k => k !== canonical && canonicalDestinationKey(k) === canonical);
  return legacy === undefined ? undefined : map[legacy];
}
export function localDay(time) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(time);
}
export function exactPost(value, destination) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const { network } = destination;
    const current = findDestination(destination);
    const account = '(?:' + (current ? accountAliases(current) : [destination.account]).map(a => String(a).replace(/[^A-Za-z0-9_.]/g, '').replace(/\./g, '\\.')).join('|') + ')';
    const match = network === 'tiktok' && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname)
      ? new RegExp('^/@' + account + '/video/(\\d+)/?$').exec(url.pathname)
      : network === 'facebook' && ['www.facebook.com', 'facebook.com'].includes(url.hostname)
        ? new RegExp('^/' + account + '/(?:videos|posts)/(\\d+)/?$').exec(url.pathname) : null;
    if (!match) return null;
    const canonicalPath = url.pathname.replace(/\/$/, '');
    return { id: match[1], url: 'https://www.' + (network === 'tiktok' ? 'tiktok.com' : 'facebook.com') + canonicalPath };
  } catch { return null; }
}
export function providerTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date.toISOString() : null;
}
function list(value) {
  if (value?.hasMore || value?.next || value?.page?.next || value?.metadata?.next || value?.metadata?.hasMore || value?.pagination?.next || value?.meta?.next || value?.paging?.next ||
      (Number.isInteger(value?.total) && value.total > (value.data?.length ?? -1))) throw new Error('metricool_pagination_unverified');
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  throw new Error('metricool_list_unrecognized');
}
function accountEvidence(row, destination) {
  const field = destination.network === 'tiktok' ? 'tiktok' : 'facebook';
  const root = row[field] ?? row[field + 'Data'] ?? row.networksData?.[field + 'Data'] ?? row.networks?.[field + 'Data'];
  if (root === false || root === '' || root?.connected === false || root?.enabled === false) return 'conflict';
  const identity = field === 'tiktok'
    ? (row.tiktokUsername ?? root?.username ?? root?.handle ?? (typeof root === 'string' ? root : null))
    : (row.facebookPageId ?? root?.pageId ?? root?.id ?? (typeof root === 'string' && /^\d+$/.test(root) ? root : null));
  if (identity == null) return Object.hasOwn(row, field) && row[field] === null ? 'conflict' : 'missing';
  return String(identity).toLowerCase().replace(/^@/, '') === destination.account ? 'match' : 'conflict';
}
function provider(row, destination) {
  return Array.isArray(row?.providers) && row.providers.some(p => p?.network === destination.network);
}
function scheduledTime(row) {
  const when = row.publicationDate;
  if (!when?.dateTime) return providerTimestamp(when);
  const withOffset = providerTimestamp(when.dateTime);
  if (withOffset) return withOffset;
  const local = providerTimestamp(when.dateTime + 'Z');
  if (!local) return null;
  if (when.timezone === 'UTC') return local;
  if (when.timezone !== TIME_ZONE) return null;
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const target = Date.parse(local);
  const wallClock = stamp => Date.parse(formatter.format(new Date(stamp)).replace(' ', 'T') + 'Z');
  let stamp = target;
  for (let attempt = 0; attempt < 3; attempt++) stamp += target - wallClock(stamp);
  return wallClock(stamp) === target ? new Date(stamp).toISOString() : null;
}
function providerMedia(row) {
  const first = Array.isArray(row.media) && row.media.length === 1 ? row.media[0] : null;
  return typeof first === 'string' ? first : first?.downloadUrl ?? first?.url ?? row.mediaUrl;
}
function matchingContent(row, item, destination) {
  return row.providers.length === 1 && (row.blogId == null || String(row.blogId) === String(destination.brandId)) &&
    row.text === item.caption && scheduledTime(row) === item.scheduledAt && Boolean(providerMedia(row));
}
async function verifiedMedia(fetcher, row, item) {
  const media = providerMedia(row);
  if (media === item.mediaUrl || media === item.verifiedSchedulerMediaUrl) return media;
  if (!item.mediaSha256 || typeof media !== 'string') return null;
  const url = new URL(media);
  if (url.origin !== 'https://static.metricool.com' || url.username || url.password || url.search || url.hash) return null;
  const response = await fetcher(url, { headers: { accept: 'video/mp4, application/octet-stream' },
    redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) return null;
  const hash = createHash('sha256');
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 250_000_000) return null;
    hash.update(chunk);
  }
  return length > 0 && hash.digest('hex') === item.mediaSha256 ? media : null;
}
function analyticsPost(row, destination, id) {
  const url = row.publicUrl ?? row.permalink ?? row.shareUrl ?? row.url;
  const post = url ? exactPost(url, destination) : null;
  return url ? post?.id === id : String(row.postId ?? row.videoId ?? '') === id;
}
function analyticsPublicationTime(row) {
  if (Number.isSafeInteger(row.createTime) && row.createTime >= 1_000_000_000 && row.createTime < 10_000_000_000) {
    return new Date(row.createTime * 1000).toISOString();
  }
  return providerTimestamp(row.publishedAt ?? row.createTime);
}
function statusOf(row, destination) {
  return row.providers?.find(p => p.network === destination.network)?.status ?? row.status;
}
function metricsFrom(row, destination) {
  const metrics = row.providers?.find(p => p.network === destination.network)?.metrics ?? row.metrics ?? row;
  const views = metrics.views ?? metrics.videoViews ?? metrics.viewCount;
  const completionRate = metrics.completionRate;
  if (!Number.isSafeInteger(views) || views < 0 || (completionRate != null &&
      (!Number.isFinite(completionRate) || completionRate < 0 || completionRate > 1))) return null;
  return { views, completionRate: completionRate ?? null };
}
const schedulerId = row => String(row?.id ?? row?.uuid ?? '');

// Facebook account-action errors: the Page cannot publish until the person does something in the Facebook
// app (identity confirmation, security checkpoint, re-login). Not a code failure and never retried.
const FACEBOOK_OWNER_ACTION = /confirm your identity|verify your identity|identity (?:confirmation|verification)|checkpoint|security check|open the facebook app|log ?in again|session has (?:been invalidated|expired)|account (?:is )?(?:restricted|disabled|locked)|verifica(?:r)? tu identidad|confirma(?:r)? tu identidad/i;
/** Owner-action reason code for a Facebook provider detailedStatus, or null. */
export function facebookOwnerActionReason(detailedStatus) {
  const text = String(detailedStatus ?? '');
  if (!FACEBOOK_OWNER_ACTION.test(text)) return null;
  return /identi/i.test(text) ? 'facebook_identity_confirmation_required' : 'facebook_account_action_required';
}
/**
 * Provider health for one destination from raw scheduler rows (any status, including ERROR):
 * the latest owner-action error and the latest PUBLISHED row for that network.
 */
export function providerHealthFromRows(rows, destination) {
  let ownerAction = null, published = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.blogId != null && String(row.blogId) !== String(destination.brandId)) continue;
    const target = Array.isArray(row?.providers) ? row.providers.find(p => p?.network === destination.network) : null;
    if (!target) continue;
    const status = String(target.status ?? row.status ?? '').toLowerCase();
    const at = scheduledTime(row) ?? providerTimestamp(target.publishedAt ?? row.publishedAt);
    if (!at) continue;
    if (status === 'error' || status === 'failed') {
      const reason = destination.network === 'facebook' ? facebookOwnerActionReason(target.detailedStatus ?? row.detailedStatus) : null;
      if (reason && (!ownerAction || at > ownerAction.at)) ownerAction = { reason, at, id: schedulerId(row) };
    } else if (['published', 'posted'].includes(status) && (!published || at > published.at)) published = { at, id: schedulerId(row) };
  }
  return { ownerAction, published };
}

export function createPortfolioMetricool({ token, userId, fetcher = fetch }) {
  if (typeof token !== 'string' || token.length < 12 || !/^\d+$/.test(String(userId))) throw new Error('metricool_credentials_unavailable');
  const headers = { 'X-Mc-Auth': token, accept: 'application/json' };
  let profiles;
  async function get(endpoint, params = {}) {
    const url = new URL(endpoint, API);
    for (const [key, value] of Object.entries({ ...params, userId })) url.searchParams.set(key, String(value));
    const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(endpoint.startsWith('/api/v2/analytics/') ? `analytics_http_${response.status}` : 'metricool_read_failed');
    if (endpoint.startsWith('/api/v2/analytics/') && !/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(response.headers?.get('content-type') ?? '')) {
      throw new Error('analytics_json_response_required');
    }
    try { return await response.json(); }
    catch { throw new Error(endpoint.startsWith('/api/v2/analytics/') ? 'analytics_json_invalid' : 'metricool_read_failed'); }
  }
  async function mcp(name, args, id = randomUUID()) {
    const response = await fetcher(MCP, {
      method: 'POST', redirect: 'error',
      headers: { ...headers, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('metricool_request_outcome_uncertain');
    const raw = await response.text();
    const envelope = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))).find(event => event.id === id)
      : JSON.parse(raw);
    if (!envelope?.result || envelope.error || envelope.result.isError) throw new Error('metricool_request_outcome_uncertain');
    return envelope.result;
  }
  let settings;
  async function connectionSettings() {
    if (settings) return settings;
    const result = await mcp('getBrandSettings', {});
    const entries = result.structuredContent ?? (result.content?.length === 1 && JSON.parse(result.content[0].text));
    settings = list(entries?.brands ?? entries?.profiles ?? entries);
    return settings;
  }
  async function destinationSettings(value) {
    const destination = findDestination(value);
    if (!destination) throw new Error('destination_not_allowlisted');
    profiles ??= list(await get('/api/admin/simpleProfiles'));
    const matches = profiles.filter(row => String(row.blogId ?? row.id ?? '') === String(destination.brandId));
    const profile = matches.length === 1 && matches[0];
    if (!profile || profile.deleted === true) throw new Error('destination_identity_unverified');
    const connection = accountEvidence(profile, destination);
    if (connection === 'conflict') throw new Error('destination_identity_unverified');
    if (connection === 'missing') {
      const brands = (await connectionSettings()).filter(row => String(row.blogId ?? row.id ?? '') === String(destination.brandId));
      if (brands.length !== 1 || accountEvidence(brands[0], destination) !== 'match') throw new Error('destination_identity_unverified');
    }
    const owned = profile.isShared === false && String(profile.ownerUserId ?? '') === String(userId);
    return { canPublish: profile.isWhiteLabelOnlyRead !== true && profile.canPublish !== false &&
      (profile.canPublish === true || owned) };
  }
  async function schedule(destination, day, strict=false, includeDrafts=false) {
    await destinationSettings(destination);
    const rows=list(await get('/api/v2/scheduler/posts', {
      blogId: destination.brandId, integrationSource: 'MCP',
      start: day + 'T00:00:00', end: day + 'T23:59:59', timezone: TIME_ZONE, extendedRange: false,
    }));
    if(strict){
      const networks=new Set(['tiktok','facebook','instagram','youtube','twitter','linkedin','pinterest','gmb','threads','bluesky','twitch']);
      if(rows.length>500)throw Error('weekly_provider_schedule_unverified');
      for(const row of rows)if(!row||typeof row!=='object'||Array.isArray(row)||
          (row.blogId!=null&&String(row.blogId)!==String(destination.brandId))||!Array.isArray(row.providers)||!row.providers.length||row.providers.length>20||
          row.providers.some(p=>!p||typeof p!=='object'||Array.isArray(p)||typeof p.network!=='string'||!networks.has(p.network))||
          new Set(row.providers.map(p=>p.network)).size!==row.providers.length)throw Error('weekly_provider_schedule_unverified');
    }
    return rows.filter(row=>provider(row,destination)&&(includeDrafts||row.draft!==true)&&!['deleted','cancelled','canceled','failed'].includes(String(statusOf(row,destination)).toLowerCase()));
  }
  async function postAnalytics(destination, from, now) {
    await destinationSettings(destination);
    return list(await get('/api/v2/analytics/posts/' + destination.network, {
      blogId: destination.brandId, integrationSource: 'MCP',
      // Official Swagger uses local date-time plus an explicit IANA timezone.
      // Preserve UTC boundaries while avoiding the rejected fractional/Z form.
      from: new Date(from).toISOString().slice(0, 19), to: now.toISOString().slice(0, 19), timezone: 'UTC',
    }));
  }
  return {
    destinationSettings,
    /** Read-only: raw scheduler rows for the given local days -> providerHealthFromRows. */
    async providerHealth(destination, days) {
      if (!findDestination(destination)) throw new Error('destination_not_allowlisted');
      const rows = [];
      for (const day of days) rows.push(...list(await get('/api/v2/scheduler/posts', {
        blogId: destination.brandId, integrationSource: 'MCP',
        start: day + 'T00:00:00', end: day + 'T23:59:59', timezone: TIME_ZONE, extendedRange: false,
      })));
      return providerHealthFromRows(rows, destination);
    },
    // Read-only whole-account analysis. These observations never become controlled experiments.
    async accountAnalytics(destination, now = new Date()) {
      if (!findDestination(destination)) throw new Error('destination_not_allowlisted');
      const rows = await postAnalytics(destination, new Date(+now - 7 * 86400000).toISOString(), now);
      const posts = rows.slice(0, 200).flatMap(row => {
        const post = exactPost(row.publicUrl ?? row.permalink ?? row.shareUrl ?? row.url, destination);
        const publishedAt = analyticsPublicationTime(row);
        const metric = metricsFrom(row, destination);
        const reported = row.observedAt ?? row.updatedAt;
        const providerAt = providerTimestamp(reported);
        if (!post || !publishedAt || !metric || Date.parse(publishedAt) > +now ||
            +now - Date.parse(publishedAt) > 7 * 86400000 || (reported != null && !providerAt) || (providerAt && Date.parse(providerAt) > +now)) return [];
        return [{ ...post, publishedAt, ...metric, observedAt: providerAt ?? now.toISOString(),
          timing: providerAt ? 'provider_observation_time' : 'retrieved_at_only',
          actualAgeHours: ((providerAt ? Date.parse(providerAt) : +now) - Date.parse(publishedAt)) / 3600000 }];
      }).filter(row => row.actualAgeHours >= 0);
      return { posts, receivedRows: rows.length, rejectedRows: rows.length-posts.length };
    },
    async preflight(destination, item) {
      if (!(await destinationSettings(destination)).canPublish) throw new Error('destination_publish_permission_missing');
      // Drafts count too: a draft waiting for owner approval holds its slot, caption and media.
      const rows = await schedule(destination, localDay(new Date(item.scheduledAt)), false, item.countDrafts === true);
      if (rows.some(row => !scheduledTime(row))) throw Error('metricool_schedule_time_unverified');
      const duplicate = rows.some(row => {
        return localHour(scheduledTime(row)) === localHour(item.scheduledAt) || row.text === item.caption ||
          providerMedia(row) === item.mediaUrl;
      });
      const limit = Number.isSafeInteger(item.dailyLimit) ? Math.max(1, Math.min(SCALED_DAILY_LIMIT, item.dailyLimit)) : DAILY_LIMIT;
      if (duplicate || rows.length >= limit) throw new Error('metricool_slot_duplicate_or_daily_cap');
    },
    /**
     * Read-only cross-account guard: the same caption or media must not be scheduled, drafted or published on any
     * other allowlisted account on the slot's day or the day either side. One video file -> one account.
     */
    async crossAccountPreflight(destination, item) {
      const day = localDay(new Date(item.scheduledAt));
      const days = [-1, 0, 1].map(offset => localDay(new Date(Date.parse(item.scheduledAt) + offset * 86400000))).filter((d, i, a) => a.indexOf(d) === i);
      const head = text => String(text ?? '').split('\n')[0].trim().toLowerCase().slice(0, 80);
      // Brand-wide calendars (every network, drafts included); on this brand only the other networks count.
      for (const brandId of [...new Set(DESTINATIONS.map(d => d.brandId))]) {
        for (const d of days) {
          const rows = list(await get('/api/v2/scheduler/posts', { blogId: brandId, integrationSource: 'MCP', start: d + 'T00:00:00', end: d + 'T23:59:59', timezone: TIME_ZONE, extendedRange: false }));
          const others = rows.filter(row => row && !['deleted', 'cancelled', 'canceled'].includes(String(row.status ?? '').toLowerCase()) &&
            (brandId !== destination.brandId || (Array.isArray(row.providers) && row.providers.some(p => p?.network && p.network !== destination.network))));
          if (others.some(row => row.text === item.caption || (head(row.text) && head(row.text) === head(item.caption)) || (item.mediaUrl && providerMedia(row) === item.mediaUrl))) {
            throw new Error('cross_account_duplicate');
          }
        }
      }
      return { checkedDays: days, day };
    },
    /** Read-only Metricool best-time-to-post (last 4 weeks) for one destination; raw rows for parseBestTimes. */
    async bestTimes(destination, now = new Date()) {
      if (!findDestination(destination)) throw new Error('destination_not_allowlisted');
      const to = new Date(+now), from = new Date(+now - 28 * 86400000);
      const fmt = d => d.toISOString().slice(0, 19) + '+00:00';
      const result = await mcp('getBestTimeToPostByNetwork', { brandId: String(destination.brandId), socialNetwork: destination.network, timezone: TIME_ZONE, fromDate: fmt(from), toDate: fmt(to) });
      const body = result.structuredContent ?? (result.content?.length === 1 ? JSON.parse(result.content[0].text) : null);
      return body?.data ?? body?.bestTimes ?? body ?? [];
    },
    async weeklyPreflight(destination, item, { now } = {}) {
      if (!(now instanceof Date) || !Number.isFinite(+now)) throw Error('weekly_now_required');
      const day = localDay(new Date(item.scheduledAt));
      if (Date.parse(item.scheduledAt) < +now + 300000) throw Error('weekly_schedule_expired');
      profiles = settings = undefined;
      if (!(await destinationSettings(destination)).canPublish) throw Error('destination_publish_permission_missing');
      const rows = await schedule(destination, day, true);
      const pending = new Map();
      const published = new Map();
      const calendarIds=new Set(),calendarPublished=new Map(),untimedPublished=new Map();
      if (day === localDay(now)) {
        // Fresh published-post read, not the connector's pending-only list or a fabricated completeness flag.
        let start = new Date(day+'T05:00:00Z');
        if (localHour(start)==='01') start=new Date(day+'T04:00:00Z');
        const analytics = await postAnalytics(destination,start.toISOString(),now);
        for (const post of analytics) {
          const when=analyticsPublicationTime(post);
          if(!when || Date.parse(when)>+now || (post.blogId!=null && String(post.blogId)!==String(destination.brandId)))throw Error('today_publication_coverage_unverified');
          if(localDay(new Date(when))!==day)continue;
          const url=post.publicUrl??post.permalink??post.shareUrl??post.url;
          const exact=url?exactPost(url,destination):null;
          const id=exact?.id??(!url?String(post.postId??post.videoId??''):null);
          if(!id || !/^\d+$/.test(id))throw Error('today_publication_coverage_unverified');
          const old=published.get(id);
          if(old && old.publishedAt!==when)throw Error('today_publication_identity_conflict');
          published.set(id,{id,publishedAt:when});
        }
      }
      for (const row of rows) {
        const when = scheduledTime(row), status = String(statusOf(row,destination)).toLowerCase();
        if (!when || localDay(new Date(when))!==day || !schedulerId(row) || !['scheduled','pending','publishing','published','posted'].includes(status)) throw Error('weekly_provider_schedule_unverified');
        calendarIds.add(schedulerId(row));
        if (['published','posted'].includes(status)) {
          const target = row.providers.find(p=>p.network===destination.network);
          const exact = exactPost(target.publicUrl ?? row.publicUrl ?? row.publishedPostUrl,destination);
          if (day!==localDay(now) || !exact) throw Error('weekly_published_row_unreconciled');
          if(calendarPublished.has(exact.id)&&calendarPublished.get(exact.id)!==schedulerId(row))throw Error('weekly_provider_identity_conflict');
          calendarPublished.set(exact.id,schedulerId(row));
          if(published.has(exact.id))continue;
          // Provider PUBLISHED is authoritative existence, even while analytics has not supplied a timestamp.
          // Reserve its original calendar slot; never invent publishedAt or metric completeness.
          untimedPublished.set(schedulerId(row),exact.id);
        }
        if (['scheduled','pending'].includes(status)&&Date.parse(when)<=+now) throw Error('past_schedule_requires_publication_confirmation');
        const key = String(row.uuid ?? schedulerId(row));
        if (pending.has(key) && JSON.stringify(pending.get(key))!==JSON.stringify(row)) throw Error('weekly_provider_identity_conflict');
        pending.set(key,row);
      }
      const hours = [...pending.values()].map(row=>localHour(scheduledTime(row))).concat([...published.values()].map(post=>localHour(post.publishedAt)));
      if (hours.length>=DAILY_LIMIT || new Set(hours).size!==hours.length || hours.includes(localHour(item.scheduledAt)) ||
          [...pending.values()].some(row=>row.text===item.caption || providerMedia(row)===item.mediaUrl)) throw Error('metricool_slot_duplicate_or_daily_cap');
      const evidence={destination,day,observedAt:now.toISOString(),source:'fresh_rest_calendar_and_account_analytics',calendarPublished:[...calendarPublished].map(([platformPostId,id])=>({id,platformPostId})),
        scheduled:[...pending.values()].map(row=>({id:schedulerId(row),scheduledAt:scheduledTime(row),status:String(statusOf(row,destination)).toLowerCase(),...(untimedPublished.has(schedulerId(row))?{platformPostId:untimedPublished.get(schedulerId(row)),publicationTimeVerified:false}:{})})),published:[...published.values()]};
      return { day, observedAt:evidence.observedAt, coverageSource:evidence.source, confirmedCount:hours.length, scheduledIds:evidence.scheduled.map(row=>row.id), publishedIds:[...new Set([...evidence.published.map(row=>row.id),...calendarPublished.keys()])],calendarIds:[...calendarIds],reservedPublishing:[...pending.values()].filter(row=>String(statusOf(row,destination)).toLowerCase()==='publishing').length,publicationTimesUnverified:untimedPublished.size,evidence,
        evidenceSha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex') };
    },
    async schedule(destination, item) {
      profiles = settings = undefined;
      if (!(await destinationSettings(destination)).canPublish) throw new Error('destination_publish_permission_missing');
      const networkOptions = destination.network === 'facebook'
        ? { facebookData: { type: 'REEL' } }
        : { tiktokData: { privacyOption: 'PUBLIC_TO_EVERYONE', autoAddMusic: false,
          commercialContentThirdParty: item.thirdPartyCommercial === true,
          ...(item.allowDuetStitch === true ? { disableComment: false, disableDuet: false, disableStitch: false } : {}) } };
      // Draft mode: the post waits in Metricool for owner approval (no auto-publish).
      const asDraft = item.draft === true;
      const post = {
        autoPublish: !asDraft, draft: asDraft, providers: [{ network: destination.network }],
        publicationDate: { dateTime: item.scheduledAt.slice(0, 19), timezone: 'UTC' },
        text: item.caption, media: [item.mediaUrl], ...networkOptions,
      };
      await mcp('createScheduledPost', {
        blogId: String(destination.brandId), date: item.scheduledAt,
        info: JSON.stringify(post),
      }, item.id);
      return this.confirmSchedule(destination, item);
    },
    async confirmSchedule(destination, item) {
      const asDraft = item.draft === true;
      const matches = (await schedule(destination, localDay(new Date(item.scheduledAt)), false, asDraft)).filter(row =>
        (asDraft ? row.draft === true : row.autoPublish === true && row.draft === false) &&
        ['scheduled', 'pending', 'published', 'posted'].includes(String(statusOf(row, destination)).toLowerCase()) &&
        matchingContent(row, item, destination));
      const row = matches.length === 1 ? matches[0] : null;
      if (!row || !schedulerId(row)) return null;
      const media = await verifiedMedia(fetcher, row, item);
      return media ? { id: schedulerId(row), mediaUrl: media } : null;
    },
    async publication(destination, item, now = new Date()) {
      const rows = await schedule(destination, localDay(new Date(item.scheduledAt)));
      const matches = rows.filter(row => schedulerId(row) === item.metricoolId);
      if (matches.length !== 1 || !matchingContent(matches[0], item, destination)) return null;
      const row = matches[0];
      const target = row.providers.find(p => p.network === destination.network);
      if (!['published', 'posted'].includes(String(statusOf(row, destination)).toLowerCase()) ||
          !await verifiedMedia(fetcher, row, item)) return null;
      const post = exactPost(target.publicUrl ?? row.publicUrl ?? row.publishedPostUrl, destination);
      if (!post) return null;
      let publishedAt = providerTimestamp(target.publishedAt ?? row.publishedAt);
      if (!publishedAt) {
        const analytics = await postAnalytics(destination, new Date(Date.parse(item.scheduledAt) - 3_600_000).toISOString(), now);
        const matches = analytics.filter(row => analyticsPost(row, destination, post.id));
        if (matches.length === 1) publishedAt = analyticsPublicationTime(matches[0]);
      }
      return publishedAt ? { ...post, publishedAt, source: 'metricool_scheduler' } : null;
    },
    async metrics(destination, publication, now) {
      const rows = await postAnalytics(destination, publication.publishedAt, now);
      const matches = rows.filter(row => analyticsPost(row, destination, publication.id));
      if (matches.length !== 1) return null;
      const metric = metricsFrom(matches[0], destination);
      const reportedAt = matches[0].observedAt ?? matches[0].updatedAt;
      const providerObservedAt = providerTimestamp(reportedAt);
      if (reportedAt != null && !providerObservedAt) return null;
      return metric ? { ...metric, observedAt: providerObservedAt ?? now.toISOString(),
        timing: providerObservedAt ? 'provider_observation_time' : 'retrieved_at_only', source: 'metricool_post_analytics' } : null;
    },
  };
}
