// Clippers account lanes (owner decisions 2026-11-20, 2-week test). Pure helpers, no network, no secrets.
//
// - Each account has its own niche, creator allowlist, language and hashtags.
// - A clip goes to exactly ONE account: routing picks one lane, and the media ledger refuses a second
//   account for the same source segment (same Twitch VOD +-60 s, same source clip id, same YouTube cut) or
//   the same rendered file hash. Follow-up clips of a stream stay on the account that first used the stream.
// - Spanish only for Clipwave Miami; English for the others.
// - Posting: 10/12/16/18/20 ET (weekends -30 %); 6-8 a day once the account's weekly median passes 1k views.
//   Metricool best-time hours (read-only) reorder the slots when available.
// - Auto-publish per account only once its weekly median is >= 1k views; until then Metricool drafts for
//   owner approval.
// - Clipping rule: clip unless the creator explicitly prohibits it (shared/clippers-streamer-policy.mjs).

import { TWITCH_LOGIN_CANDIDATES } from './clippers-priority-creators.mjs';

const freeze = value => Object.freeze(value);
const fold = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clean = (value, max) => String(value ?? '').normalize('NFC').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const AUTOPUBLISH_MEDIAN_VIEWS = 1000;
export const KILL_MEDIAN_VIEWS = 300;
export const KILL_MIN_POSTS = 6;
export const BREAKOUT_VIEWS_24H = 10_000;
export const BREAKOUT_FOLLOWUP_CLIPS = 3;
export const MEGA_VIEWS = 100_000;
export const SEGMENT_OVERLAP_SECONDS = 60;
export const BASE_SLOT_HOURS = freeze([10, 12, 16, 18, 20]);
export const SCALED_SLOT_HOURS = freeze([10, 12, 13, 15, 16, 18, 20, 21]);
export const SPARE_HOURS = freeze([13, 15, 14, 11, 21, 17, 19, 9, 22]);
export const BASE_DAILY = 5;
export const SCALED_DAILY = 8;
export const WEEKEND_FACTOR = 0.7;
export const CLIP_SECONDS = freeze({ min: 15, target: 28, max: 35 });

// Creator groups -> Twitch logins: the shared creator catalogue (resolved through Helix /users; unresolved logins are skipped).
export const LANE_TWITCH_LOGINS = TWITCH_LOGIN_CANDIDATES;

export const LANES = freeze([
  freeze({ id: 'memes', label: 'memes · @streamersus', brandId: 6431685, language: 'en', niche: 'funny_chaotic',
    destinations: freeze([freeze({ brandId: 6431685, network: 'tiktok', account: 'streamersus' })]),
    creators: freeze(['kai-cenat', 'ishowspeed', 'adin-ross', 'jynxzi', 'duke-dennis', 'xqc', 'agent00']),
    hashtags: freeze(['#streamer', '#funny', '#fyp']), keywords: null }),
  freeze({ id: 'sports', label: 'SPORT · @streamersclipusa', brandId: 6431687, language: 'en', niche: 'sports_streamers',
    destinations: freeze([freeze({ brandId: 6431687, network: 'tiktok', account: 'streamersclipusa' })]),
    creators: freeze(['plaqueboymax', 'castro']),
    hashtags: freeze(['#sports', '#streamer', '#fyp']),
    keywords: /\b(nba|nfl|mlb|nhl|ufc|wwe|fifa|ea ?fc|madden|2k\d*|football|soccer|futbol|basketball|baseball|dunk|touchdown|goal|stadium|1v1|hoop|hoops|super bowl|world cup)\b/ }),
  freeze({ id: 'miami', label: 'Clipwave Miami', brandId: 6591612, language: 'es', niche: 'latin_miami',
    destinations: freeze([freeze({ brandId: 6591612, network: 'tiktok', account: 'news305miami' }), freeze({ brandId: 6591612, network: 'facebook', account: '1193011863901514' })]),
    creators: freeze(['westcol', 'elmariana', 'juansguarnizo', 'rivers', 'spreen', 'ibai', 'auronplay', 'thegrefg', 'rubius', 'vegetta777', 'juega-german']),
    hashtags: freeze(['#miami', '#streamers', '#parati']),
    keywords: /\b(miami|305|wynwood|south beach|hialeah|little havana)\b/ }),
  // Facebook Reels lane. Brand 6595747 has no connected Facebook Page in the adapter allowlist yet:
  // clips routed here wait (never re-routed to another account) until the owner connects it.
  freeze({ id: 'nyc', label: 'Clipwave NYC', brandId: 6595747, language: 'en', niche: 'nyc_street',
    destinations: freeze([]), creators: freeze(['fanum']),
    hashtags: freeze(['#nyc', '#newyork', '#streamer']),
    keywords: /\b(nyc|new york|bronx|brooklyn|harlem|queens|manhattan|times square|subway)\b/ }),
]);

export const laneById = id => LANES.find(l => l.id === id) ?? null;
export const laneDestinationKey = d => `${d.brandId}:${d.network}:${d.account}`;
export function laneForDestinationKey(key) {
  return LANES.find(l => l.destinations.some(d => laneDestinationKey(d) === key)) ?? null;
}

/** Creator group id for a candidate: discovery's group id, else the Twitch login map. */
export function creatorGroupOf(candidate, creator = null) {
  if (creator?.creatorGroupId) return creator.creatorGroupId;
  const handle = fold(candidate?.handle).replace(/^@/, '');
  for (const [group, logins] of Object.entries(LANE_TWITCH_LOGINS)) if (logins.includes(handle)) return group;
  return null;
}

/** 'en' | 'es' | other two-letter code | null. Region and script suffixes are dropped (es-419 -> es). */
export function normalizeLanguage(value) {
  const code = fold(value).trim().split(/[-_ ]/)[0];
  return /^[a-z]{2,3}$/.test(code) ? code : null;
}
export const SERVED_LANGUAGES = freeze(['en', 'es']);

/**
 * Pick exactly one lane for a candidate. Only clips whose language is known and exactly 'en' or 'es' are routed,
 * and only to a lane with that language (Spanish only for Clipwave Miami, English for the others).
 * Order inside the language: stream already owned by a lane > creator allowlist > sports content > city content > default.
 */
export function routeCandidate(candidate, { creator = null, streamOwner = null } = {}) {
  const language = normalizeLanguage(candidate?.language);
  if (!language) return { lane: null, reason: 'language_unknown' };
  if (!SERVED_LANGUAGES.includes(language)) return { lane: null, reason: `language_not_served:${language}` };
  const eligible = LANES.filter(l => l.language === language);
  const owner = streamOwner ? laneById(streamOwner) : null;
  if (owner) return owner.language === language ? { lane: owner.id, reason: 'stream_owner' } : { lane: null, reason: 'stream_owner_language_mismatch' };
  const group = creatorGroupOf(candidate, creator);
  const byCreator = group ? eligible.find(l => l.creators.includes(group)) : null;
  if (byCreator) return { lane: byCreator.id, reason: 'creator_allowlist', group };
  const text = fold(`${candidate?.title ?? ''} ${candidate?.gameName ?? ''}`);
  const sports = laneById('sports').keywords.test(text) || /^sports$/.test(fold(candidate?.gameName));
  if (language === 'es') return { lane: 'miami', reason: sports ? 'sports_content_es' : laneById('miami').keywords.test(text) ? 'miami_content' : 'spanish_default' };
  if (sports) return { lane: 'sports', reason: 'sports_content' };
  if (laneById('nyc').keywords.test(text)) return { lane: 'nyc', reason: 'nyc_content' };
  return { lane: 'memes', reason: 'english_default' };
}

// ---------- Cross-account media ledger ----------
/** Source segment of a clip: the Twitch VOD + offset when known, else the source clip/video id + cut start. */
export function sourceSegment(candidate, cut = null) {
  if (candidate?.vodId && Number.isFinite(candidate.vodOffset)) {
    return { key: `twitch-vod:${String(candidate.vodId).replace(/[^0-9A-Za-z_-]/g, '')}`, start: Math.round(candidate.vodOffset + (cut?.start ?? 0)) };
  }
  // Twitch clip without a VOD: the broadcaster + clip creation time (+-60 s) identifies the moment.
  if (candidate?.platform === 'twitch' && candidate?.creatorKey && Number.isFinite(Date.parse(candidate?.publishedAt))) {
    return { key: `twitch-moment:${String(candidate.creatorKey).replace(/[^0-9A-Za-z:_-]/g, '')}`, start: Math.round(Date.parse(candidate.publishedAt) / 1000 + (cut?.start ?? 0)) };
  }
  return { key: String(candidate?.id ?? '').slice(0, 140), start: Math.round(cut?.start ?? 0) };
}
export function streamKeyOf(candidate) {
  return candidate?.vodId ? `twitch-vod:${String(candidate.vodId).replace(/[^0-9A-Za-z_-]/g, '')}` : String(candidate?.id ?? '').slice(0, 140);
}
// A segment with an unknown start (start == null, e.g. a Mac render whose cut offset was not recorded) overlaps
// every segment of the same source: the conservative reading for "one source clip -> one account".
const overlaps = (a, b) => a.key === b.key && (a.start == null || b.start == null || Math.abs(a.start - b.start) < SEGMENT_OVERLAP_SECONDS);

/**
 * Conflict for a new post: an existing ledger entry with the same file hash or an overlapping source segment.
 * Same destination -> 'already_posted'; another destination -> 'cross_account_duplicate'. null = free.
 */
export function mediaConflict(entries, { segment, mediaSha256 = null, destinationKey, candidateId = null, sourceId = null }) {
  // Source identity: the cloud candidate id (youtube:<id>, twitch-clip:<slug>) and the Mac sourceId share one key
  // space, so a candidateId on one side matches a sourceId on the other.
  const ids = new Set([candidateId, sourceId].filter(Boolean));
  for (const e of entries ?? []) {
    if (!e) continue;
    const same = (mediaSha256 && e.mediaSha256 === mediaSha256) || (segment && e.segment && overlaps(segment, e.segment)) ||
      (ids.size && (ids.has(e.candidateId) || ids.has(e.sourceId)));
    if (!same) continue;
    return { reason: e.destinationKey === destinationKey ? 'already_posted' : 'cross_account_duplicate', entry: e };
  }
  return null;
}
export function mediaEntry({ candidate, segment, mediaSha256, destinationKey, at }) {
  return { candidateId: candidate.id, sourceId: candidate.id, streamKey: streamKeyOf(candidate), segment, mediaSha256: mediaSha256 ?? null, destinationKey, lane: laneForDestinationKey(destinationKey)?.id ?? null, at };
}
/** Lane that already used this stream (so follow-up clips stay on the same account). */
export function streamOwnerLane(entries, candidate) {
  const key = streamKeyOf(candidate);
  return (entries ?? []).find(e => e?.streamKey === key && e.lane)?.lane ?? null;
}

// ---------- Hooks and captions ----------
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'el', 'la', 'los', 'las', 'de', 'y', 'en', 'un', 'una']);
/** 3-6 word, upper-case, top-third hook. 'title' compresses the clip title; 'teaser' is a curiosity template. */
export function laneHook({ variant, title, name, language = 'en' }) {
  const who = clean(name, 30).replace(/^@+/, '').toUpperCase() || (language === 'es' ? 'ÉL' : 'HE');
  if (variant !== 'teaser') {
    const words = clean(title, 140).replace(/https?:\/\/\S+/g, '').replace(/[#@]\S+/g, '').replace(/[^\p{L}\p{N}$%!?'’ -]+/gu, ' ').split(' ').filter(Boolean);
    const kept = words.length > 6 ? words.filter((w, i) => i < 2 || !STOP.has(fold(w))).slice(0, 6) : words;
    if (kept.length >= 3) return kept.slice(0, 6).join(' ').toUpperCase();
  }
  return language === 'es' ? `${who} NO SE LO ESPERABA` : `${who} DIDN'T SEE THIS COMING`;
}

const tag = value => '#' + fold(value).replace(/[^a-z0-9]/g, '').slice(0, 30);
/**
 * Caption: one curiosity line + creator name (search) + the credit/source the clip policy requires + 3-5 hashtags.
 * No hedges or disclaimers.
 */
export function laneCaption({ lane, title, name, handle, platform, sourceUrl }) {
  const l = typeof lane === 'string' ? laneById(lane) : lane;
  const es = l?.language === 'es';
  const display = clean(name || handle, 40).replace(/^@+/, '');
  const h = '@' + clean(handle, 60).replace(/^@+/, '').replace(/[^A-Za-z0-9_.]/g, '');
  const subject = clean(title, 90).replace(/[.!?]+$/, '');
  const curiosity = subject ? (es ? `¿Qué acaba de pasar? ${subject} 👀` : `Wait for it… ${subject} 👀`) : (es ? `${display} no se lo esperaba 👀` : `${display} did NOT see this coming 👀`);
  const question = es ? '¿Tú qué habrías hecho?' : 'What would you have done?';
  const url = new URL(sourceUrl);
  if (url.protocol !== 'https:') throw new Error('CLIPPERS_SOURCE_URL_INVALID');
  const where = platform === 'twitch' ? 'Twitch' : 'YouTube';
  const credit = es ? `${display} (${h} en ${where}) · Fuente: ${url}` : `${display} (${h} on ${where}) · Source: ${url}`;
  const tags = [...new Set([tag(display), ...(l?.hashtags ?? ['#streamer', '#fyp'])].filter(t => t.length > 2))].slice(0, 5);
  return `${curiosity}\n${question}\n${credit}\n${tags.join(' ')}`;
}

// ---------- Scheduling ----------
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
export const isWeekend = day => ['Sat', 'Sun'].includes(WEEKDAY.format(new Date(`${day}T17:00:00Z`)));

/**
 * Slots for one account on one local day.
 * bestTimes: [{ weekday: 0-6 (Sun=0) | null, hour: 0-23, value }] from Metricool (read-only); used to reorder
 * and pick hours between 9 and 22 when it has data for that weekday.
 */
export function laneSchedule({ day, scaled = false, bestTimes = null, killedHours = [] }) {
  const weekend = isWeekend(day);
  const full = scaled ? SCALED_DAILY : BASE_DAILY;
  const cap = Math.max(1, Math.round(full * (weekend ? WEEKEND_FACTOR : 1)));
  const defaults = scaled ? SCALED_SLOT_HOURS : BASE_SLOT_HOURS;
  const killed = new Set(killedHours);
  const weekday = new Date(`${day}T17:00:00Z`).getUTCDay();
  const rows = (bestTimes ?? []).filter(r => Number.isInteger(r?.hour) && r.hour >= 9 && r.hour <= 22 && Number.isFinite(r.value) && (r.weekday == null || r.weekday === weekday));
  let hours;
  if (rows.length >= 5) {
    const score = new Map();
    for (const r of rows) score.set(r.hour, Math.max(score.get(r.hour) ?? -Infinity, r.value));
    hours = [...score.entries()].sort((a, b) => b[1] - a[1] || defaults.indexOf(a[0]) - defaults.indexOf(b[0])).map(([h]) => h);
    hours = [...new Set([...hours, ...defaults])];
  } else hours = [...defaults];
  // Killed hours are replaced by spare hours (13, 15, 14, 11, 21, ...), never re-used while killed.
  const live = [...new Set([...hours, ...SPARE_HOURS])].filter(h => !killed.has(h));
  const pick = live.slice(0, cap).sort((a, b) => a - b);
  return { cap, slots: pick.map(h => `${String(h).padStart(2, '0')}:00`), source: rows.length >= 5 ? 'metricool_best_time' : 'default', weekend };
}

/** Parse Metricool best-time rows defensively ({dayOfWeek|day|weekday, hour, value}). */
export function parseBestTimes(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.bestTimes) ? raw.bestTimes : [];
  const days = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const out = [];
  for (const r of list.slice(0, 500)) {
    const hour = Number.isInteger(r?.hour) ? r.hour : Number.parseInt(String(r?.hour ?? '').slice(0, 2), 10);
    const value = Number(r?.value ?? r?.score ?? r?.engagement);
    const rawDay = r?.dayOfWeek ?? r?.weekday ?? r?.day;
    const weekday = Number.isInteger(rawDay) ? rawDay % 7 : typeof rawDay === 'string' ? days[fold(rawDay).slice(0, 3)] ?? null : null;
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isFinite(value)) out.push({ weekday, hour, value });
  }
  return out;
}

/** Auto-publish flag for one account: weekly median >= 1k with at least 5 posts in the week. */
export const GROWTH_MAX_AGE_HOURS = 36;
/**
 * Auto-publish flag for one account: weekly median >= 1k over >= 5 posts, computed from Metricool account
 * analytics (not our own ledger) by a growth pass less than 36 h old. Anything else -> drafts.
 */
export function autoPublishAllowed(account, { evaluatedAt = null, now = null, override = false } = {}) {
  // Owner override (CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE): bypasses ONLY the median/analytics-age gate.
  if (override === true) return true;
  if (!account || account.source !== 'metricool_account_analytics') return false;
  if (!(Number.isSafeInteger(account.weeklyPosts) && account.weeklyPosts >= 5 && Number.isFinite(account.weeklyMedian) && account.weeklyMedian >= AUTOPUBLISH_MEDIAN_VIEWS)) return false;
  if (now !== null) {
    const at = Date.parse(evaluatedAt ?? '');
    if (!Number.isFinite(at) || now - at > GROWTH_MAX_AGE_HOURS * 3_600_000 || at > now + 60_000) return false;
  }
  return true;
}

/**
 * Owner override (2026-11, explicit Robert decision): auto-publish these TikTok lanes now, without waiting
 * for the 1k weekly-median gate. Only the median/analytics-age gate is bypassed; one-account-per-clip,
 * language, prohibition/takedown checks, daily caps and slots stay enforced. Facebook and NYC can never be
 * overridden. Kill switch: set CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE="" (or "off") -> back to drafts.
 */
export const DEFAULT_LANES_AUTOPUBLISH_OVERRIDE = 'memes:tiktok,sport:tiktok,miami:tiktok';
const OVERRIDE_LANE_ALIASES = freeze({ sport: 'sports' });
const OVERRIDE_EXCLUDED_LANES = freeze(['nyc']);
const OVERRIDE_NETWORKS = freeze(['tiktok']);
/** env value -> Set of destination keys. undefined / 'default' -> owner default; '' / off / none / false -> empty. */
export function parseAutopublishOverride(raw) {
  const value = raw === undefined || raw === null || String(raw).trim().toLowerCase() === 'default' ? DEFAULT_LANES_AUTOPUBLISH_OVERRIDE : String(raw);
  const out = new Set();
  if (['', 'off', 'none', 'false'].includes(value.trim().toLowerCase())) return out;
  for (const part of value.split(',')) {
    const [laneRaw, networkRaw] = part.trim().toLowerCase().split(':');
    const lane = laneById(OVERRIDE_LANE_ALIASES[laneRaw] ?? laneRaw);
    if (!lane || OVERRIDE_EXCLUDED_LANES.includes(lane.id) || !OVERRIDE_NETWORKS.includes(networkRaw)) continue;
    for (const d of lane.destinations) if (d.network === networkRaw) out.add(laneDestinationKey(d));
  }
  return out;
}
/** Lane ids with at least one overridden destination. */
export const overrideLaneIds = keys => new Set([...keys].map(k => laneForDestinationKey(k)?.id).filter(Boolean));
export const PAUSE_DAYS = 14;
