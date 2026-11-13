// Pure parsers for the Black Room competitor watch: config seeds, URL safety, robots.txt,
// YouTube public RSS feeds and schema.org events (JSON-LD) on public pages.
// No IO here: everything is deterministic and unit-testable offline.

export type CompetitorConfig = {
  id: string;
  name: string;
  /** Public YouTube channel id (UC + 22 chars); read through the public RSS feed only. */
  youtubeChannelId: string | null;
  /** Public website (home page). */
  websiteUrl: string | null;
  /** Public events/agenda page, when different from the home page. */
  eventsUrl: string | null;
  source: "env" | "manual";
  addedAt: string | null;
};

export type FeedVideo = {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string;
  /** Public view count from media:statistics; null when the feed does not show it. */
  views: number | null;
  likes: number | null;
};

export type PublicEvent = {
  name: string;
  startDate: string;
  url: string | null;
  location: string | null;
};

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isYoutubeChannelId(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_ID.test(value);
}

export function competitorSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "competidor";
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return name || null;
}

/**
 * Only public https pages on a named host: no credentials, no custom ports, no IP literals,
 * no localhost/intranet names, no query strings that look like session tokens.
 */
export function safePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)) return null;
  if (/[?&](token|key|session|sid|auth|access_token|password)=/i.test(url.search)) return null;
  if (/\/(login|signin|sign-in|account|accounts|admin|wp-admin|checkout)(\/|$)/i.test(url.pathname)) return null;
  url.hash = "";
  return url.toString();
}

/** Builds a competitor from loose input (action body or a parsed seed). Returns null when unusable. */
export function normalizeCompetitor(raw: Record<string, unknown>, source: CompetitorConfig["source"], addedAt: string | null): CompetitorConfig | null {
  const youtubeChannelId = isYoutubeChannelId(raw.youtubeChannelId) ? raw.youtubeChannelId : null;
  const websiteUrl = raw.websiteUrl === undefined || raw.websiteUrl === null || raw.websiteUrl === "" ? null : safePublicUrl(raw.websiteUrl);
  const eventsUrl = raw.eventsUrl === undefined || raw.eventsUrl === null || raw.eventsUrl === "" ? null : safePublicUrl(raw.eventsUrl);
  if (raw.websiteUrl && !websiteUrl) return null;
  if (raw.eventsUrl && !eventsUrl) return null;
  if (raw.youtubeChannelId && !youtubeChannelId) return null;
  const name = cleanName(raw.name) || (websiteUrl ? new URL(websiteUrl).hostname.replace(/^www\./, "") : null) || youtubeChannelId;
  if (!name) return null;
  return { id: competitorSlug(name), name, youtubeChannelId, websiteUrl, eventsUrl, source, addedAt };
}

/**
 * BLACKROOM_COMPETITORS: comma-separated entries; each entry is pipe-separated tokens in any order:
 * a name, a YouTube channel id (UC...), a website URL and optionally a second URL for the events page.
 * Example: "Club Rival|UCxxxxxxxxxxxxxxxxxxxxxx|https://clubrival.com|https://clubrival.com/eventos, Otra Fiesta"
 */
export function parseCompetitorSeeds(value: string | undefined): CompetitorConfig[] {
  if (!value) return [];
  const out: CompetitorConfig[] = [];
  const seen = new Set<string>();
  for (const entry of value.split(",").slice(0, 30)) {
    const tokens = entry.split("|").map((token) => token.trim()).filter(Boolean);
    if (!tokens.length) continue;
    const raw: Record<string, unknown> = {};
    const urls: string[] = [];
    for (const token of tokens) {
      if (isYoutubeChannelId(token)) raw.youtubeChannelId = token;
      else if (/^https?:\/\//i.test(token)) urls.push(token);
      else if (!raw.name) raw.name = token;
    }
    if (urls[0]) raw.websiteUrl = urls[0];
    if (urls[1]) raw.eventsUrl = urls[1];
    const competitor = normalizeCompetitor(raw, "env", null);
    if (competitor && !seen.has(competitor.id)) {
      seen.add(competitor.id);
      out.push(competitor);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// robots.txt (user-agent * group, longest match wins, Allow beats Disallow on ties)
// ---------------------------------------------------------------------------

export type RobotsRules = { allow: string[]; disallow: string[] };

export function parseRobotsTxt(body: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let agents: string[] = [];
  let inRules = false;
  for (const rawLine of body.split(/\r?\n/).slice(0, 2000)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (inRules) { agents = []; inRules = false; }
      agents.push(value.toLowerCase());
      continue;
    }
    if (field !== "allow" && field !== "disallow") continue;
    inRules = true;
    if (!agents.includes("*") && !agents.some((agent) => agent.startsWith("blackroomcompetitionwatch"))) continue;
    if (!value) continue;
    (field === "allow" ? rules.allow : rules.disallow).push(value);
  }
  return rules;
}

function robotsPatternMatches(pattern: string, pathWithQuery: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(`^${body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return regex.test(pathWithQuery);
}

export function isAllowedByRobots(rules: RobotsRules, url: string): boolean {
  const parsed = new URL(url);
  const target = `${parsed.pathname}${parsed.search}`;
  let best = { length: -1, allow: true };
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]] as const) {
    for (const pattern of list) {
      if (!robotsPatternMatches(pattern, target)) continue;
      if (pattern.length > best.length || (pattern.length === best.length && allow)) best = { length: pattern.length, allow };
    }
  }
  return best.allow;
}

// ---------------------------------------------------------------------------
// YouTube public RSS
// ---------------------------------------------------------------------------

export function youtubeFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? decodeXml(match[1]) : null;
}

function attr(block: string, name: string, attribute: string): string | null {
  const match = new RegExp(`<${name}\\s[^>]*\\b${attribute}="([^"]*)"`).exec(block);
  return match ? decodeXml(match[1]) : null;
}

export function parseYoutubeFeed(xml: string): { channelTitle: string | null; channelId: string | null; videos: FeedVideo[] } {
  const head = xml.split("<entry>")[0] || "";
  const channelTitle = tag(head, "title");
  const channelId = tag(head, "yt:channelId");
  const videos: FeedVideo[] = [];
  for (const block of xml.split("<entry>").slice(1, 31)) {
    const videoId = tag(block, "yt:videoId");
    const publishedAt = tag(block, "published");
    if (!videoId || !VIDEO_ID.test(videoId) || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) continue;
    const viewsRaw = attr(block, "media:statistics", "views");
    const likesRaw = attr(block, "media:starRating", "count");
    const link = attr(block, "link", "href");
    const views = viewsRaw !== null && /^\d+$/.test(viewsRaw) ? Number(viewsRaw) : null;
    const likes = likesRaw !== null && /^\d+$/.test(likesRaw) ? Number(likesRaw) : null;
    const url = link && /^https:\/\/www\.youtube\.com\/(watch\?v=|shorts\/)[A-Za-z0-9_-]{11}$/.test(link) ? link : `https://www.youtube.com/watch?v=${videoId}`;
    videos.push({ videoId, title: (tag(block, "title") || "(sin titulo)").slice(0, 200), url, publishedAt: new Date(publishedAt).toISOString(), views, likes });
  }
  return { channelTitle, channelId: channelId && isYoutubeChannelId(channelId) ? channelId : null, videos };
}

// ---------------------------------------------------------------------------
// schema.org events in JSON-LD
// ---------------------------------------------------------------------------

function isEventType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => typeof type === "string" && /Event$/.test(type));
}

function locationName(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 120);
  if (Array.isArray(value)) return locationName(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") return record.name.slice(0, 120);
    if (typeof record.address === "string") return record.address.slice(0, 120);
  }
  return null;
}

export function parseJsonLdEvents(html: string, baseUrl: string): PublicEvent[] {
  const events: PublicEvent[] = [];
  const seen = new Set<string>();
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || events.length >= 50 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node.slice(0, 200)) visit(item, depth + 1); return; }
    const record = node as Record<string, unknown>;
    if (isEventType(record["@type"]) && typeof record.name === "string" && typeof record.startDate === "string" && Number.isFinite(Date.parse(record.startDate))) {
      let url: string | null = null;
      if (typeof record.url === "string") {
        try { url = safePublicUrl(new URL(record.url, baseUrl).toString()); } catch { url = null; }
      }
      const event: PublicEvent = { name: decodeXml(record.name).slice(0, 160), startDate: new Date(record.startDate).toISOString(), url, location: locationName(record.location) };
      const key = `${event.name}|${event.startDate}`;
      if (!seen.has(key)) { seen.add(key); events.push(event); }
    }
    for (const key of ["@graph", "itemListElement", "item", "subEvent", "event", "events"]) visit(record[key], depth + 1);
  };
  for (const match of scripts) {
    try { visit(JSON.parse(match[1].trim()), 0); } catch { /* invalid JSON-LD block: ignore */ }
  }
  return events;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
