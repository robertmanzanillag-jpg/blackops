import { hasRealValue } from "./ceo-doctor-cli";

type JsonRecord = Record<string, any>;

export interface BlackRoomLinkInput {
  title: string;
  subtitle?: string | null;
  url: string;
  icon?: string | null;
  display_order?: number | null;
  builderStyle?: string | null;
  builderColor?: string | null;
}

export interface BlackRoomLinkTarget {
  id?: string | number | null;
  title?: string | null;
  url?: string | null;
}

export interface BlackRoomLinkUpdateInput extends BlackRoomLinkInput {
  matchId?: string | number | null;
  matchTitle?: string | null;
  matchUrl?: string | null;
}

export interface BlackRoomLinkDeactivateInput extends BlackRoomLinkTarget {
  reason?: string | null;
}

export interface BlackRoomLinkPerformanceInput extends BlackRoomLinkTarget {
  limit?: number | null;
}

export interface BlackRoomCountdownInput {
  title?: string | null;
  partyTitle?: string | null;
  date?: string | null;
  targetDate?: string | null;
  url?: string | null;
}

const DEFAULT_BLACKROOM_BASE_URL = "https://blackroomus.com";
const MONTH_ALIASES: Record<string, number> = {
  jan: 0,
  january: 0,
  ene: 0,
  enero: 0,
  feb: 1,
  february: 1,
  febrero: 1,
  mar: 2,
  march: 2,
  marzo: 2,
  apr: 3,
  april: 3,
  abr: 3,
  abril: 3,
  may: 4,
  mayo: 4,
  jun: 5,
  june: 5,
  junio: 5,
  jul: 6,
  july: 6,
  julio: 6,
  aug: 7,
  august: 7,
  ago: 7,
  agosto: 7,
  sep: 8,
  sept: 8,
  september: 8,
  septiembre: 8,
  oct: 9,
  october: 9,
  octubre: 9,
  nov: 10,
  november: 10,
  noviembre: 10,
  dec: 11,
  december: 11,
  dic: 11,
  diciembre: 11,
};

function getBlackRoomBaseUrl(): string {
  const configuredBaseUrl = process.env.BLACKROOM_ADMIN_BASE_URL;
  if (configuredBaseUrl !== undefined && !hasRealValue(configuredBaseUrl)) {
    throw new Error("BLACKROOM_ADMIN_BASE_URL must be a real admin URL, not a placeholder.");
  }

  return (configuredBaseUrl || DEFAULT_BLACKROOM_BASE_URL).replace(/\/$/, "");
}

function getBlackRoomHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (hasBody) headers["Content-Type"] = "application/json";
  if (hasRealValue(process.env.BLACKROOM_ADMIN_COOKIE)) headers.Cookie = process.env.BLACKROOM_ADMIN_COOKIE;
  if (hasRealValue(process.env.BLACKROOM_ADMIN_BEARER_TOKEN)) {
    headers.Authorization = `Bearer ${process.env.BLACKROOM_ADMIN_BEARER_TOKEN}`;
  }
  if (hasRealValue(process.env.BLACKROOM_ADMIN_API_KEY)) {
    headers["X-API-Key"] = process.env.BLACKROOM_ADMIN_API_KEY;
  }

  return headers;
}

async function blackRoomAdminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(`${getBlackRoomBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...getBlackRoomHeaders(hasBody),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data
      ? String((data as JsonRecord).error)
      : text.slice(0, 500);
    throw new Error(`Black Room admin request failed (${response.status}). ${message}`.trim());
  }

  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeMatch(value?: string | number | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value?: string | number | null): string {
  return normalizeMatch(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIcon(icon?: string | null): string {
  const value = normalizeMatch(icon).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const aliases: Record<string, string> = {
    bag: "shopping-bag",
    merch: "shopping-bag",
    shop: "shopping-bag",
    shopping: "shopping-bag",
    ticket: "ticket",
    tickets: "ticket",
    event: "ticket",
    events: "ticket",
    calendar: "calendar",
    instagram: "instagram",
    ig: "instagram",
    tiktok: "tiktok",
    youtube: "youtube",
    music: "music",
    email: "envelope",
    mail: "envelope",
    link: "link",
  };

  return aliases[value] || value || "link";
}

function buildBioLinkPayload(input: BlackRoomLinkInput): JsonRecord {
  return {
    title: input.title,
    subtitle: input.subtitle || null,
    url: input.url,
    icon: normalizeIcon(input.icon),
    ...(input.display_order !== undefined && input.display_order !== null
      ? { display_order: Number(input.display_order) }
      : {}),
    is_active: true,
  };
}

function buildBioElementPayload(input: BlackRoomLinkInput): JsonRecord {
  return {
    element_type: "link",
    title: input.title,
    subtitle: input.subtitle || null,
    url: input.url,
    icon: normalizeIcon(input.icon),
    metadata: {
      style: input.builderStyle || "filled",
      color: input.builderColor || "#1a1a1a",
    },
    ...(input.display_order !== undefined && input.display_order !== null
      ? { position: Number(input.display_order) + 1 }
      : {}),
    is_active: true,
  };
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateTimeLocal(date: Date): string {
  return [
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
    `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`,
  ].join("T");
}

function normalizeCountdownDate(value?: string | null): string | null {
  if (!value || !String(value).trim()) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
  if (!/\d{4}/.test(raw) && !/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(raw)) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateTimeLocal(parsed);
  }

  return null;
}

function parsePartyDate(value?: string | null, referenceDate = new Date()): string | null {
  if (!value || !String(value).trim()) return null;
  const normalized = normalizeCountdownDate(value);
  if (normalized) return normalized;

  const text = normalizeMatch(value).replace(/[,]+/g, " ");
  const numericMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numericMatch) {
    const month = Number(numericMatch[1]) - 1;
    const day = Number(numericMatch[2]);
    const yearText = numericMatch[3];
    let year = yearText ? Number(yearText) : referenceDate.getFullYear();
    if (year < 100) year += 2000;
    const date = new Date(year, month, day, 12, 0, 0, 0);
    if (!yearText && date.getTime() < referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000) {
      date.setFullYear(date.getFullYear() + 1);
    }
    if (!Number.isNaN(date.getTime())) return formatDateTimeLocal(date);
  }

  const monthNames = Object.keys(MONTH_ALIASES).join("|");
  const monthDayMatch = text.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:\\s+(\\d{4}))?\\b`, "i"));
  if (!monthDayMatch) return null;

  const month = MONTH_ALIASES[monthDayMatch[1]];
  const day = Number(monthDayMatch[2]);
  const year = monthDayMatch[3] ? Number(monthDayMatch[3]) : referenceDate.getFullYear();
  const date = new Date(year, month, day, 12, 0, 0, 0);
  if (!monthDayMatch[3] && date.getTime() < referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000) {
    date.setFullYear(date.getFullYear() + 1);
  }
  return Number.isNaN(date.getTime()) ? null : formatDateTimeLocal(date);
}

function buildCountdownPayload(input: { title: string; url?: string | null; countdownDate: string }): JsonRecord {
  return {
    element_type: "countdown",
    title: input.title,
    url: input.url || null,
    metadata: {
      countdown_date: input.countdownDate,
    },
    is_active: true,
  };
}

function findMatchingItem<T extends JsonRecord>(items: T[], target: BlackRoomLinkTarget): T | null {
  const targetId = target.id !== undefined && target.id !== null ? String(target.id) : null;
  const targetTitle = normalizeMatch(target.title);
  const targetUrl = normalizeMatch(target.url);

  return items.find((item) => {
    if (targetId && String(item.id) === targetId) return true;
    if (targetUrl && normalizeMatch(item.url) === targetUrl) return true;
    if (targetTitle && normalizeMatch(item.title) === targetTitle) return true;
    return false;
  }) || null;
}

function findMatchingParty<T extends JsonRecord>(items: T[], partyTitle?: string | null): T | null {
  const targetTitle = normalizeSearchText(partyTitle);
  if (!targetTitle) return null;
  const targetTokens = targetTitle.split(" ").filter(Boolean);

  return items.find((item) => {
    const title = normalizeSearchText(item.title);
    if (title === targetTitle || title.includes(targetTitle) || targetTitle.includes(title)) return true;
    return targetTokens.length > 0 && targetTokens.every((token) => title.includes(token));
  }) || null;
}

export async function listBlackRoomBioLinks(): Promise<JsonRecord[]> {
  const stats = await blackRoomAdminRequest<any>("/api/admin/link-stats", {
    method: "GET",
  });
  if (Array.isArray(stats)) return stats;
  if (Array.isArray(stats?.links)) return stats.links;

  const links = await blackRoomAdminRequest<any>("/api/admin/bio-links", {
    method: "GET",
  });
  return Array.isArray(links) ? links : links?.links || [];
}

export async function getBlackRoomLinkStats(): Promise<{ links: JsonRecord[]; totals: JsonRecord }> {
  const stats = await blackRoomAdminRequest<any>("/api/admin/link-stats", {
    method: "GET",
  });

  return {
    links: Array.isArray(stats) ? stats : stats?.links || [],
    totals: Array.isArray(stats) ? {} : stats?.totals || {},
  };
}

export async function listBlackRoomBioElements(): Promise<JsonRecord[]> {
  const elements = await blackRoomAdminRequest<any>("/api/admin/bio-elements", {
    method: "GET",
  });
  return Array.isArray(elements) ? elements : elements?.elements || [];
}

export async function addBlackRoomLink(input: BlackRoomLinkInput) {
  const bioLink = await blackRoomAdminRequest<JsonRecord>("/api/admin/bio-links", {
    method: "POST",
    body: JSON.stringify(buildBioLinkPayload(input)),
  });

  const bioElement = await blackRoomAdminRequest<JsonRecord>("/api/admin/bio-elements", {
    method: "POST",
    body: JSON.stringify(buildBioElementPayload(input)),
  });

  return { bioLink, bioElement, action: "added" };
}

export async function addBlackRoomCountdown(input: BlackRoomCountdownInput) {
  const explicitDate = normalizeCountdownDate(input.date || input.targetDate || null);
  let title = input.title?.trim() || null;
  let url = input.url?.trim() || null;
  let countdownDate = explicitDate;
  let source: "manual" | "existing_party" = "manual";

  if (input.partyTitle && (!title || !url || !countdownDate)) {
    const [links, elements] = await Promise.all([
      listBlackRoomBioLinks().catch(() => []),
      listBlackRoomBioElements().catch(() => []),
    ]);
    const party = findMatchingParty([...links, ...elements], input.partyTitle);
    if (party) {
      title ||= typeof party.title === "string" ? party.title : null;
      url ||= typeof party.url === "string" ? party.url : null;
      countdownDate ||= parsePartyDate(party.date || party.event_date || party.subtitle || party.metadata?.date || party.metadata?.countdown_date);
      source = "existing_party";
    }
  }

  if (!title) {
    throw new Error("Falta el nombre de la fiesta para crear el timer de Black Room.");
  }
  if (!countdownDate) {
    throw new Error("Falta la fecha del timer. Dame una fecha o dime una fiesta que ya tenga fecha en Black Room.");
  }

  const bioElement = await blackRoomAdminRequest<JsonRecord>("/api/admin/bio-elements", {
    method: "POST",
    body: JSON.stringify(buildCountdownPayload({ title, url, countdownDate })),
  });

  return {
    bioElement,
    action: "countdown_added",
    source,
    title,
    url,
    countdownDate,
  };
}

export async function updateBlackRoomLink(input: BlackRoomLinkUpdateInput) {
  const target = {
    id: input.matchId,
    title: input.matchTitle || input.title,
    url: input.matchUrl,
  };
  const links = await listBlackRoomBioLinks();
  const elements = await listBlackRoomBioElements();
  const existingLink = findMatchingItem(links, target);
  const existingElement = findMatchingItem(elements, target);

  if (!existingLink && !existingElement) {
    throw new Error("No matching Black Room link was found to update.");
  }

  const bioLink = existingLink
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-links/${existingLink.id}`, {
        method: "PUT",
        body: JSON.stringify(buildBioLinkPayload(input)),
      })
    : null;

  const bioElement = existingElement
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-elements/${existingElement.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...existingElement,
          ...buildBioElementPayload(input),
          id: existingElement.id,
        }),
      })
    : null;

  return { bioLink, bioElement, action: "updated" };
}

export async function deactivateBlackRoomLink(input: BlackRoomLinkDeactivateInput) {
  const links = await listBlackRoomBioLinks();
  const elements = await listBlackRoomBioElements();
  const existingLink = findMatchingItem(links, input);
  const existingElement = findMatchingItem(elements, input);

  if (!existingLink && !existingElement) {
    throw new Error("No matching Black Room link was found to deactivate.");
  }

  const bioLink = existingLink
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-links/${existingLink.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: false }),
      })
    : null;

  const bioElement = existingElement
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-elements/${existingElement.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...existingElement, is_active: false }),
      })
    : null;

  return {
    bioLink,
    bioElement,
    action: "deactivated",
    preservedData: true,
    note: "The link was deactivated instead of deleted so historical analytics remain available.",
  };
}

export async function getBlackRoomLinkPerformance(input: BlackRoomLinkPerformanceInput = {}) {
  const { links, totals } = await getBlackRoomLinkStats();
  const matchingLink = input.id || input.title || input.url
    ? findMatchingItem(links, input)
    : null;
  const selectedLinks = matchingLink ? [matchingLink] : links;
  const limit = Math.max(1, Math.min(Number(input.limit || 10), 25));
  const rankedLinks = selectedLinks
    .slice()
    .sort((a, b) => Number(b.total_clicks || 0) - Number(a.total_clicks || 0))
    .slice(0, limit);

  return {
    totals,
    links: rankedLinks.map((link) => ({
      id: link.id,
      title: link.title,
      subtitle: link.subtitle || null,
      url: link.url,
      isActive: link.is_active !== false,
      clicksToday: Number(link.clicks_today || 0),
      clicksWeek: Number(link.clicks_week || 0),
      clicksMonth: Number(link.clicks_month || 0),
      totalClicks: Number(link.total_clicks || 0),
      displayOrder: link.display_order ?? null,
    })),
  };
}

export function formatBlackRoomLinkPerformance(performance: Awaited<ReturnType<typeof getBlackRoomLinkPerformance>>): string {
  const totals = performance.totals || {};
  const header = [
    "Rendimiento de links Black Room",
    `Total clicks: ${Number(totals.total_clicks || 0)}`,
    `Hoy: ${Number(totals.clicks_today || 0)} | Semana: ${Number(totals.clicks_week || 0)}`,
  ].join("\n");

  if (performance.links.length === 0) {
    return `${header}\n\nNo encontré links para ese filtro.`;
  }

  const rows = performance.links.map((link, index) => {
    const status = link.isActive ? "activo" : "desactivado";
    return `${index + 1}. ${link.title} (${status}) - hoy ${link.clicksToday}, semana ${link.clicksWeek}, mes ${link.clicksMonth}, total ${link.totalClicks}`;
  });

  return `${header}\n\n${rows.join("\n")}`;
}
