// Pure helpers for the "Website Black Room" agent: HTML link extraction, event-date detection
// and report building. No fs, no network, no clock: everything is passed in, so it is testable offline.

export type BlackRoomWebsiteSeverity = "critical" | "high" | "medium" | "low" | "info";

export const BLACKROOM_WEBSITE_SEVERITIES: readonly BlackRoomWebsiteSeverity[] = ["critical", "high", "medium", "low", "info"];

export type BlackRoomWebsiteIssue = {
  severity: BlackRoomWebsiteSeverity;
  code: string;
  title: string;
  detail: string;
  url?: string;
  fix: string;
};

/** A calendar day, without time zone ambiguity: "YYYY-MM-DD". */
export type IsoDay = string;

export type PageDates = {
  /** Dates with an explicit year. */
  fullDays: IsoDay[];
  /** Month-day pairs without a year ("MM-DD"). */
  monthDays: string[];
};

export type JsonLdEvent = { name: string; startDay: IsoDay | null; endDay: IsoDay | null };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};
const MONTH_PATTERN = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const UPCOMING_PATTERN = /\b(upcoming|next event|coming soon|pr[oó]xim[oa]s?|tickets?|boletos?|entradas?|rsvp)\b/i;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function validDay(year: number, month: number, day: number): IsoDay | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function validMonthDay(month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${pad(month)}-${pad(day)}`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Visible text of an HTML page (scripts, styles and tags removed). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

export function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
  return title ? title.slice(0, 160) : null;
}

/** href/src targets of a page, resolved against the page URL; only http(s), fragments dropped. */
export function extractLinks(html: string, pageUrl: string): string[] {
  const found = new Set<string>();
  const pattern = /<(a|link)\b([^>]*?)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    // <link rel="preconnect|dns-prefetch|preload|..."> are browser hints to an origin, not links a
    // visitor follows: their bare origins (fonts.googleapis.com/) answer 404 by design.
    if (match[1].toLowerCase() === "link" && /\brel\s*=\s*["']?[^"'>]*\b(preconnect|dns-prefetch|preload|prefetch|modulepreload|manifest|icon|apple-touch-icon|mask-icon|stylesheet|alternate|canonical)\b/i.test(`${match[2]} ${match[6]}`)) continue;
    const raw = decodeEntities((match[3] ?? match[4] ?? match[5] ?? "").trim());
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript|data|sms|whatsapp):/i.test(raw)) continue;
    try {
      const url = new URL(raw, pageUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      found.add(url.href);
    } catch {
      // ignore malformed hrefs
    }
  }
  return [...found];
}

/** Whether a link points to something worth crawling as a page (not an asset). */
export function looksLikePage(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return !/\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|pdf|zip|mp4|mov|mp3|wav|woff2?|ttf|xml|json|txt)$/.test(pathname);
  } catch {
    return false;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    const strip = (host: string) => host.replace(/^www\./i, "").toLowerCase();
    return strip(left.hostname) === strip(right.hostname);
  } catch {
    return false;
  }
}

/** Dates written on a page: ISO, "Nov 15, 2026", "15 de noviembre de 2026", "11/15/2026" and year-less "Nov 15". */
export function extractDates(text: string): PageDates {
  const fullDays = new Set<IsoDay>();
  const monthDays = new Set<string>();
  const lower = text.toLowerCase();
  let match: RegExpExecArray | null;

  const iso = /\b(20\d{2})-(\d{2})-(\d{2})/g;
  while ((match = iso.exec(lower))) {
    const day = validDay(Number(match[1]), Number(match[2]), Number(match[3]));
    if (day) fullDays.add(day);
  }

  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/g;
  while ((match = numeric.exec(lower))) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const day = validDay(year, Number(match[1]), Number(match[2]));
    if (day) fullDays.add(day);
  }

  // "nov 15, 2026" / "november 15th 2026" / "nov 15"
  const monthFirst = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "g");
  while ((match = monthFirst.exec(lower))) {
    const month = MONTHS[match[1]];
    const dayNumber = Number(match[2]);
    const monthDay = validMonthDay(month, dayNumber);
    if (monthDay) monthDays.add(monthDay);
    if (match[3]) {
      const day = validDay(Number(match[3]), month, dayNumber);
      if (day) fullDays.add(day);
    }
  }

  // "15 de noviembre de 2026" / "15 noviembre 2026" / "15 nov"
  const dayFirst = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_PATTERN})\\.?(?:,?\\s+(?:de(?:l)?\\s+)?(20\\d{2}))?\\b`, "g");
  while ((match = dayFirst.exec(lower))) {
    const month = MONTHS[match[2]];
    const dayNumber = Number(match[1]);
    const monthDay = validMonthDay(month, dayNumber);
    if (monthDay) monthDays.add(monthDay);
    if (match[3]) {
      const day = validDay(Number(match[3]), month, dayNumber);
      if (day) fullDays.add(day);
    }
  }

  for (const day of fullDays) monthDays.add(day.slice(5));
  return { fullDays: [...fullDays].sort(), monthDays: [...monthDays].sort() };
}

export function mentionsUpcoming(text: string): boolean {
  return UPCOMING_PATTERN.test(text);
}

function isoDayFromValue(value: unknown): IsoDay | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? validDay(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/** schema.org Event entries from the page's JSON-LD blocks (malformed blocks are ignored). */
export function extractJsonLdEvents(html: string): JsonLdEvent[] {
  const events: JsonLdEvent[] = [];
  const pattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || events.length >= 100 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    if (types.some((type) => typeof type === "string" && /event$/i.test(type))) {
      events.push({
        name: typeof record.name === "string" ? record.name.slice(0, 120) : "Evento",
        startDay: isoDayFromValue(record.startDate),
        endDay: isoDayFromValue(record.endDate),
      });
    }
    for (const key of ["@graph", "itemListElement", "item", "event", "events", "subEvent"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };
  while ((match = pattern.exec(html))) {
    try {
      visit(JSON.parse(match[1]), 0);
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return events;
}

/** Calendar day of an instant in a time zone (falls back to UTC when the zone is invalid). */
export function isoDayInZone(date: Date, timeZone: string): IsoDay {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDays(day: IsoDay, days: number): IsoDay {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const SEVERITY_RANK: Record<BlackRoomWebsiteSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function sortIssues(issues: BlackRoomWebsiteIssue[]): BlackRoomWebsiteIssue[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code));
}

export function countBySeverity(issues: BlackRoomWebsiteIssue[]): Record<BlackRoomWebsiteSeverity, number> {
  const counts: Record<BlackRoomWebsiteSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

/** Stable fingerprint of the actionable issues, used to avoid duplicate draft tasks. */
export function issuesFingerprint(issues: BlackRoomWebsiteIssue[]): string {
  return issues
    .filter((issue) => issue.severity === "critical" || issue.severity === "high")
    .map((issue) => `${issue.code}|${issue.url ?? ""}`)
    .sort()
    .join(";");
}
