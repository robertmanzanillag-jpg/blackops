// Streamer-pages clip policy (owner decision 2026-11-19). Pure helpers shared by the cloud discovery
// job, the server status/takedown routes and tests. No network, no secrets.
//
// Rule: a creator may be clipped UNLESS they explicitly prohibit clipping somewhere we can check
// (Twitch user description, YouTube channel description, KNOWN_PROHIBITED_CREATORS, takedown list).
// Always: credit @handle + source link, short edited clips only (never a full stream/VOD), and honour
// takedowns within 24h (a takedown blocks that creator or clip forever).
import { KNOWN_PROHIBITED_CREATORS } from './clippers-priority-creators.mjs';

export const STREAMER_CLIP_MAX_SECONDS = 60;
export const TAKEDOWN_SLA_HOURS = 24;

const fold = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ');

// Explicit no-clip / no-reupload language only. Generic words ("clips", "copyright") never match alone.
export const PROHIBITION_PATTERNS = Object.freeze([
  // English
  /\bno (?:clips?|clipping|clippers|re-?uploads?|re-?posts?|reposting|re-?uploading)\b/,
  /\b(?:do not|don'?t|please don'?t|please do not) (?:clip|re-?upload|re-?post|repost|steal) (?:my|our|this|any)?\s?(?:content|videos?|streams?|clips?)?/,
  /\b(?:clipping|clips?|re-?uploads?|re-?uploading|re-?posting|reposts?) (?:is |are )?(?:not allowed|not permitted|prohibited|forbidden|banned)\b/,
  /\bnot (?:allowed|permitted) to (?:clip|re-?upload|re-?post|repost)\b/,
  /\bclipping (?:of )?(?:my|our) (?:content|streams?|videos?) is (?:not allowed|prohibited|forbidden)\b/,
  // Spanish (accents folded)
  /\bprohibido (?:clipear|clippear|hacer clips?|sacar clips?|resubir|re-?subir|republicar|subir (?:mi|mis|nuestro|nuestros) (?:contenido|videos?|directos?))\b/,
  /\b(?:esta|queda) prohibido (?:clipear|clippear|hacer clips?|resubir|republicar)\b/,
  /\bno (?:se permite[n]? |permito |autorizo )(?:clips?|clipear|clippear|resubir|republicar|re-?subidas?)\b/,
  /\bno (?:clipear|clippear|resubir|republicar|re-?subir)\b/,
  /\bno (?:hagan|hagais|hagas) clips?\b/,
  /\bno (?:quiero|acepto) (?:clips?|clippers|resubidas?)\b/,
  /\b(?:clips?|resubidas?|re-?uploads?) (?:no )?(?:estan |esta )?(?:prohibid[oa]s?|no permitid[oa]s?)\b/,
]);

/** Returns the first explicit prohibition found in `text`, with a short evidence excerpt. */
export function detectClipProhibition(text) {
  const folded = fold(text);
  if (!folded.trim()) return { prohibited: false, matched: null, excerpt: null };
  for (const pattern of PROHIBITION_PATTERNS) {
    const match = folded.match(pattern);
    if (!match) continue;
    // "clips (no) permitidos" must actually be negative.
    if (/permitid/.test(match[0]) && !/no permitid|prohibid/.test(match[0])) continue;
    const start = Math.max(0, match.index - 60), end = Math.min(folded.length, match.index + match[0].length + 60);
    return { prohibited: true, matched: match[0], excerpt: folded.slice(start, end).trim().slice(0, 240) };
  }
  return { prohibited: false, matched: null, excerpt: null };
}

const KEY = /^(twitch|youtube):[A-Za-z0-9_-]{1,64}$/;
export const creatorKey = (platform, id) => `${platform}:${id}`;
export const isCreatorKey = value => typeof value === 'string' && KEY.test(value);

/** Validated takedown entry. Blocks a whole creator (creatorKey) or one clip (candidateId) forever. */
export function parseTakedown(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id = null, creatorKey: ck = null, creatorGroupId = null, candidateId = null, reason, receivedAt, removedAt = null } = value;
  if (id !== null && !/^[a-f0-9]{16}$/.test(id)) return null;
  if (ck !== null && !isCreatorKey(ck)) return null;
  if (creatorGroupId !== null && !/^[a-z0-9-]{1,64}$/.test(creatorGroupId)) return null;
  if (candidateId !== null && !/^[a-z-]{2,20}:[A-Za-z0-9:_-]{1,120}$/.test(candidateId)) return null;
  if (ck === null && candidateId === null && creatorGroupId === null) return null;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 300 || /[\x00-\x1f]/.test(reason)) return null;
  const at = Date.parse(receivedAt);
  if (!Number.isFinite(at) || at > now + 60_000) return null;
  if (removedAt !== null && !Number.isFinite(Date.parse(removedAt))) return null;
  return { id, creatorKey: ck, creatorGroupId, candidateId, reason: reason.trim(), receivedAt: new Date(at).toISOString(),
    removeBy: new Date(at + TAKEDOWN_SLA_HOURS * 3600_000).toISOString(), removedAt };
}

export function takedownBlocks(takedowns, { creatorKey: ck, creatorGroupId, candidateId }) {
  return (takedowns ?? []).find(t => (t.creatorKey && t.creatorKey === ck) || (t.creatorGroupId && creatorGroupId && t.creatorGroupId === creatorGroupId) ||
    (t.candidateId && t.candidateId === candidateId)) ?? null;
}

/**
 * Resolve the effective clip policy for one creator.
 * Order: takedown > known prohibited > description prohibition > allowed_unless_prohibited.
 */
export function resolveClipPolicy({ creatorKey: ck, creatorGroupId = null, candidateId = null, description = '', descriptionSource = null,
  takedowns = [], knownProhibited = KNOWN_PROHIBITED_CREATORS, checkedAt = new Date().toISOString() }) {
  const takedown = takedownBlocks(takedowns, { creatorKey: ck, creatorGroupId, candidateId });
  if (takedown) return { status: 'prohibited', source: 'takedown', evidence: { reason: takedown.reason, receivedAt: takedown.receivedAt }, checkedAt };
  const known = (knownProhibited ?? []).find(k => (creatorGroupId && k.creatorGroupId === creatorGroupId) || (k.creatorKey && k.creatorKey === ck));
  if (known) return { status: 'prohibited', source: 'known_prohibited_list', evidence: { url: known.evidenceUrl ?? null, text: known.evidenceText ?? null }, checkedAt };
  const hit = detectClipProhibition(description);
  if (hit.prohibited) return { status: 'prohibited', source: 'channel_description', evidence: { url: descriptionSource, matched: hit.matched, excerpt: hit.excerpt }, checkedAt };
  return { status: 'allowed_unless_prohibited', source: descriptionSource ? 'channel_description_checked' : 'not_checked', evidence: null, checkedAt };
}

const clean = (value, max) => String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const handleText = handle => '@' + clean(handle, 60).replace(/^@+/, '').replace(/[^A-Za-z0-9_.]/g, '');

/** Caption that always credits the creator and links the source. */
export function buildCreditCaption({ handle, platform, sourceUrl, title, language = 'es' }) {
  const url = new URL(sourceUrl);
  if (url.protocol !== 'https:') throw new Error('CLIPPERS_SOURCE_URL_INVALID');
  const credit = language === 'en' ? `Credit: ${handleText(handle)} on ${platform === 'twitch' ? 'Twitch' : 'YouTube'}` : `Créditos: ${handleText(handle)} en ${platform === 'twitch' ? 'Twitch' : 'YouTube'}`;
  const hook = clean(title, 120);
  return `${hook ? hook + '\n\n' : ''}${credit}\nFuente: ${url.toString()}\n#streamers #clips`;
}

export function captionHasCredit(caption, handle, sourceUrl) {
  return typeof caption === 'string' && caption.includes(handleText(handle)) && caption.includes(new URL(sourceUrl).toString());
}

/**
 * CLIPPERS_CITY_PAGE_NAMES: JSON {"<metricoolBrandId>": {"name": "...", "city": "miami"|"new-york"}}.
 * When unset, the Clipwave defaults below are used; the env var overrides them per brand. Unknown brand ids are rejected.
 */
export const CITY_PAGE_BRANDS = Object.freeze({ '6591612': 'miami', '6595747': 'new-york' });
export const DEFAULT_CITY_PAGE_NAMES = Object.freeze({
  '6591612': Object.freeze({ name: 'Clipwave Miami', handle: '@clipwave.mia' }),
  '6595747': Object.freeze({ name: 'Clipwave NYC', handle: '@clipwave.nyc' }),
});
export function parseCityPageNames(raw) {
  const out = Object.fromEntries(Object.entries(CITY_PAGE_BRANDS).map(([brandId, city]) => [brandId,
    { brandId, city, name: DEFAULT_CITY_PAGE_NAMES[brandId].name, handle: DEFAULT_CITY_PAGE_NAMES[brandId].handle, status: 'named', source: 'default' }]));
  if (!raw || !String(raw).trim()) return { pages: Object.values(out), heldReasons: [] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { pages: Object.values(out), heldReasons: ['city_page_names_invalid_json'] }; }
  const held = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { pages: Object.values(out), heldReasons: ['city_page_names_invalid_json'] };
  for (const [brandId, value] of Object.entries(parsed)) {
    if (!out[brandId]) { held.push(`city_page_brand_not_allowed:${brandId.replace(/[^0-9]/g, '').slice(0, 12)}`); continue; }
    const name = clean(value?.name, 60);
    if (!name) { held.push(`city_page_name_missing:${brandId}`); continue; }
    const handle = clean(value?.handle, 40);
    out[brandId] = { ...out[brandId], name, ...(handle ? { handle } : {}), status: 'named', source: 'env' };
  }
  return { pages: Object.values(out), heldReasons: held };
}

/** Clips only: never a full stream or VOD. */
export function clipLengthAllowed(seconds) {
  return Number.isFinite(seconds) && seconds > 0 && seconds <= STREAMER_CLIP_MAX_SECONDS;
}
