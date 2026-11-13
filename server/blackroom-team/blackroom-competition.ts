// Competencia Black Room: competitor watch from PUBLIC data only (no login, no API keys).
//
// Sources per competitor:
// - YouTube public RSS feed (https://www.youtube.com/feeds/videos.xml?channel_id=...): latest videos,
//   posting frequency and public view counts (media:statistics).
// - Public website / events page: schema.org Event JSON-LD for upcoming events. robots.txt is checked
//   first (user-agent *), and a disallowed or unreachable robots.txt means the page is skipped.
// - The organic peer scout report (script/organic-peer-scout.mjs writes
//   clippers_workspace/blackroom/agent/organic-peer-hypotheses.json) is read as extra evidence when present.
//
// Safety: read-only GETs with timeouts, a request budget and a gap between requests; never sends
// cookies or credentials, follows at most 3 redirects by hand (each hop re-checked: public https
// host, public DNS answer, robots.txt of the new origin), never follows a redirect to a login page,
// reads at most 1.5 MB per page, never posts or contacts anyone.
// This agent produces reports only, so it has nothing outward-facing to approve.
// Deterministic: no LLM is used (cheap-first rule).
import { promises as dns } from "node:dns";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import type {
  BlackRoomTeamAgentModule,
  BlackRoomTeamContext,
  BlackRoomTeamRunResult,
  BlackRoomTeamStatus,
} from "@shared/blackroom-team";
import { BLACKROOM_TEAM_WORKING_FRESH_MS } from "@shared/blackroom-team";
import {
  isAllowedByRobots,
  isYoutubeChannelId,
  median,
  normalizeCompetitor,
  parseCompetitorSeeds,
  parseJsonLdEvents,
  parseRobotsTxt,
  parseYoutubeFeed,
  safePublicUrl,
  youtubeFeedUrl,
  type CompetitorConfig,
  type FeedVideo,
  type PublicEvent,
  type RobotsRules,
} from "./blackroom-competition/parsers";

const ID = "blackroom-competition" as const;

export const COMPETITION_USER_AGENT = "BlackRoomCompetitionWatch/1.0 (datos publicos; sin login)";
export const COMPETITION_REQUEST_TIMEOUT_MS = 10_000;
export const COMPETITION_MAX_REQUESTS_PER_RUN = 40;
export const COMPETITION_MAX_COMPETITORS = 12;
export const COMPETITION_MIN_RUN_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_REQUEST_GAP_MS = 1_500;
const MAX_BODY_CHARS = 1_500_000;
const DAY_MS = 86_400_000;

export type CompetitorSourceResult = { kind: "youtube" | "website" | "events"; url: string; status: "ok" | "skipped" | "error"; detail: string };

export type CompetitorReport = {
  id: string;
  name: string;
  youtube: {
    channelTitle: string | null;
    videosInFeed: number;
    postsLast30Days: number;
    postsPerWeek: number | null;
    medianViews: number | null;
    lastPostAt: string | null;
    topVideos: FeedVideo[];
  } | null;
  upcomingEvents: PublicEvent[];
  sources: CompetitorSourceResult[];
};

export type CompetitionReport = {
  generatedAt: string;
  mode: "public_observation";
  mayPublish: false;
  competitors: CompetitorReport[];
  blackroom: {
    youtube: CompetitorReport["youtube"];
    upcomingEvents: PublicEvent[];
    sources: CompetitorSourceResult[];
    notes: string[];
  };
  bestContent: Array<{ competitor: string; title: string; url: string; views: number; publishedAt: string }>;
  takeaways: string[];
  peerScout: { evaluatedAt: string | null; brands: number; note: string } | null;
  requestsUsed: number;
  okSources: number;
  failedSources: number;
};

export type CompetitionState = {
  version: 1;
  competitors: CompetitorConfig[];
  removedSeedIds: string[];
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null;
  lastReport: CompetitionReport | null;
};

const EMPTY_STATE: CompetitionState = { version: 1, competitors: [], removedSeedIds: [], lastRunAt: null, lastRunOk: null, lastError: null, lastReport: null };

async function loadState(ctx: BlackRoomTeamContext): Promise<CompetitionState> {
  let raw: unknown;
  try {
    raw = await ctx.state.load<unknown>(EMPTY_STATE);
  } catch {
    raw = EMPTY_STATE;
  }
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<CompetitionState>) : {};
  const competitors = Array.isArray(body.competitors)
    ? body.competitors.flatMap((item) => {
        const competitor = item && typeof item === "object" ? normalizeCompetitor(item as Record<string, unknown>, "manual", typeof (item as CompetitorConfig).addedAt === "string" ? (item as CompetitorConfig).addedAt : null) : null;
        return competitor ? [competitor] : [];
      })
    : [];
  return {
    version: 1,
    competitors,
    removedSeedIds: Array.isArray(body.removedSeedIds) ? body.removedSeedIds.filter((id): id is string => typeof id === "string").slice(0, 100) : [],
    lastRunAt: typeof body.lastRunAt === "string" && Number.isFinite(Date.parse(body.lastRunAt)) ? body.lastRunAt : null,
    lastRunOk: typeof body.lastRunOk === "boolean" ? body.lastRunOk : null,
    lastError: typeof body.lastError === "string" ? body.lastError : null,
    lastReport: body.lastReport && typeof body.lastReport === "object" ? (body.lastReport as CompetitionReport) : null,
  };
}

/** Env seeds (minus the ones Robert removed) merged with manual entries; manual wins on the same id. */
export function effectiveCompetitors(ctx: BlackRoomTeamContext, state: CompetitionState): CompetitorConfig[] {
  const byId = new Map<string, CompetitorConfig>();
  for (const seed of parseCompetitorSeeds(ctx.env.BLACKROOM_COMPETITORS)) if (!state.removedSeedIds.includes(seed.id)) byId.set(seed.id, seed);
  for (const manual of state.competitors) byId.set(manual.id, manual);
  return [...byId.values()].slice(0, COMPETITION_MAX_COMPETITORS);
}

function hasSource(competitor: CompetitorConfig): boolean {
  return Boolean(competitor.youtubeChannelId || competitor.websiteUrl || competitor.eventsUrl);
}

// ---------------------------------------------------------------------------
// Polite public fetcher
// ---------------------------------------------------------------------------

type Fetcher = {
  get(url: string): Promise<{ ok: true; body: string } | { ok: false; detail: string }>;
  allowedByRobots(url: string): Promise<{ ok: true } | { ok: false; detail: string }>;
  used(): number;
};

type DnsLookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

const COMPETITION_MAX_REDIRECTS = 3;
const LOGIN_PATH = /\/(login|signin|sign-in|accounts|auth)(\/|\?|$)/i;
const DNS_TIMEOUT_MS = 5_000;

async function defaultDnsLookup(host: string): Promise<Array<{ address: string; family: number }>> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// DNS checks run against the real network. With an injected fetch (tests) there is no real
// network, so no lookup runs unless a test installs one here.
let competitionDnsLookupOverride: DnsLookup | null = null;
export function setCompetitionDnsLookupForTests(lookup: DnsLookup | null): void {
  competitionDnsLookupOverride = lookup;
}

/** False for loopback, private, link-local, CGNAT, ULA, multicast and other non-public ranges. */
export function isPublicIpAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIpAddress(mapped[1]);
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false; // ULA
    if (/^fe[89ab]/.test(lower)) return false; // link-local
    if (/^ff/.test(lower)) return false; // multicast
    if (lower.startsWith("::ffff:") || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8")) return false;
    return true;
  }
  return false;
}

/** Reads at most maxBytes of the body, then cancels the stream (never buffers a huge page). */
async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.byteLength + received > maxBytes ? value.subarray(0, maxBytes - received) : value;
      received += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

function createFetcher(ctx: BlackRoomTeamContext): Fetcher {
  const gapRaw = Number(ctx.env.BLACKROOM_COMPETITION_REQUEST_GAP_MS);
  const gapMs = Number.isFinite(gapRaw) && gapRaw >= 0 ? Math.min(gapRaw, 10_000) : DEFAULT_REQUEST_GAP_MS;
  const robotsCache = new Map<string, RobotsRules | "unreachable">();
  const lookup = competitionDnsLookupOverride ?? (ctx.fetch === globalThis.fetch ? defaultDnsLookup : null);
  let requests = 0;
  let lastAt = 0;

  async function hostAllowed(url: string): Promise<boolean> {
    if (!safePublicUrl(url)) return false;
    if (!lookup) return true;
    try {
      const records = await lookup(new URL(url).hostname);
      return records.length > 0 && records.every((record) => isPublicIpAddress(record.address));
    } catch {
      return false;
    }
  }

  async function raw(url: string): Promise<{ status: number; body: string; finalUrl: string } | { error: string }> {
    let current = url;
    for (let hop = 0; hop <= COMPETITION_MAX_REDIRECTS; hop++) {
      if (!(await hostAllowed(current))) return { error: hop === 0 ? "destino no permitido (solo paginas publicas https)" : "redireccion a un destino no permitido" };
      if (hop > 0) {
        // Every redirect target must also be allowed by its own origin's robots.txt.
        if (new URL(current).pathname !== "/robots.txt") {
          const robots = await allowedByRobots(current);
          if (!robots.ok) return { error: "redireccion a un destino no permitido" };
        }
      }
      if (requests >= COMPETITION_MAX_REQUESTS_PER_RUN) return { error: "limite de solicitudes de esta corrida alcanzado" };
      const wait = lastAt + gapMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      requests++;
      lastAt = Date.now();
      let response: Response;
      try {
        response = await ctx.fetch(current, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: { "user-agent": COMPETITION_USER_AGENT, accept: "text/html,application/xml,application/atom+xml,text/plain;q=0.8" },
          signal: AbortSignal.timeout(COMPETITION_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        return { error: error instanceof Error && error.name === "TimeoutError" ? "sin respuesta a tiempo" : "no se pudo conectar" };
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) return { error: "redireccion sin destino; no se sigue" };
        try {
          current = new URL(location, current).toString();
        } catch {
          return { error: "redireccion a un destino no permitido" };
        }
        if (LOGIN_PATH.test(new URL(current).pathname)) return { error: "la pagina pide iniciar sesion; no se lee" };
        continue;
      }
      try {
        const body = response.ok ? await readCappedText(response, MAX_BODY_CHARS) : "";
        if (!response.ok) await response.body?.cancel().catch(() => undefined);
        return { status: response.status, body, finalUrl: current };
      } catch (error) {
        return { error: error instanceof Error && error.name === "TimeoutError" ? "sin respuesta a tiempo" : "no se pudo conectar" };
      }
    }
    return { error: "demasiadas redirecciones; no se sigue" };
  }

  async function allowedByRobots(url: string): Promise<{ ok: true } | { ok: false; detail: string }> {
    const origin = new URL(url).origin;
    if (!robotsCache.has(origin)) {
      robotsCache.set(origin, "unreachable"); // guards against redirect recursion while loading
      const result = await raw(`${origin}/robots.txt`);
      if ("error" in result) robotsCache.set(origin, "unreachable");
      else if (result.status >= 200 && result.status < 300) robotsCache.set(origin, parseRobotsTxt(result.body));
      else if (result.status >= 400 && result.status < 500) robotsCache.set(origin, { allow: [], disallow: [] });
      else robotsCache.set(origin, "unreachable");
    }
    const rules = robotsCache.get(origin)!;
    if (rules === "unreachable") return { ok: false, detail: "robots.txt no respondio; se omite por precaucion" };
    return isAllowedByRobots(rules, url) ? { ok: true } : { ok: false, detail: "robots.txt no permite leer esta pagina" };
  }

  return {
    used: () => requests,
    allowedByRobots,
    async get(url) {
      const result = await raw(url);
      if ("error" in result) return { ok: false, detail: result.error };
      if (result.status < 200 || result.status >= 300) return { ok: false, detail: `respuesta HTTP ${result.status}` };
      if (LOGIN_PATH.test(new URL(result.finalUrl, url).pathname)) return { ok: false, detail: "la pagina pide iniciar sesion; no se lee" };
      return { ok: true, body: result.body };
    },
  };
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function summarizeVideos(channelTitle: string | null, videos: FeedVideo[], now: Date): NonNullable<CompetitorReport["youtube"]> {
  const nowMs = now.getTime();
  const recent = videos.filter((video) => {
    const age = nowMs - Date.parse(video.publishedAt);
    return age >= 0 && age <= 30 * DAY_MS;
  });
  const last28 = videos.filter((video) => {
    const age = nowMs - Date.parse(video.publishedAt);
    return age >= 0 && age <= 28 * DAY_MS;
  }).length;
  // The feed lists only the latest ~15 videos, so a very active channel reads as a lower bound.
  const postsPerWeek = videos.length ? Math.round((last28 / 4) * 10) / 10 : null;
  const views = videos.map((video) => video.views).filter((value): value is number => value !== null);
  const lastPostAt = videos.map((video) => video.publishedAt).sort().at(-1) ?? null;
  return {
    channelTitle,
    videosInFeed: videos.length,
    postsLast30Days: recent.length,
    postsPerWeek,
    medianViews: median(views),
    lastPostAt,
    topVideos: [...videos].filter((video) => video.views !== null).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 3),
  };
}

async function collectYoutube(fetcher: Fetcher, channelId: string, now: Date, sources: CompetitorSourceResult[]): Promise<CompetitorReport["youtube"]> {
  const url = youtubeFeedUrl(channelId);
  // Official public syndication feed: no login, no API key.
  const response = await fetcher.get(url);
  if (!response.ok) { sources.push({ kind: "youtube", url, status: "error", detail: response.detail }); return null; }
  const feed = parseYoutubeFeed(response.body);
  if (feed.channelId && feed.channelId !== channelId) { sources.push({ kind: "youtube", url, status: "error", detail: "el feed no corresponde al canal configurado" }); return null; }
  sources.push({ kind: "youtube", url, status: "ok", detail: `${feed.videos.length} videos en el feed publico` });
  return summarizeVideos(feed.channelTitle, feed.videos, now);
}

async function collectEvents(fetcher: Fetcher, pages: Array<{ kind: "website" | "events"; url: string }>, now: Date, sources: CompetitorSourceResult[]): Promise<PublicEvent[]> {
  const events = new Map<string, PublicEvent>();
  for (const page of pages) {
    const robots = await fetcher.allowedByRobots(page.url);
    if (!robots.ok) { sources.push({ kind: page.kind, url: page.url, status: "skipped", detail: robots.detail }); continue; }
    const response = await fetcher.get(page.url);
    if (!response.ok) { sources.push({ kind: page.kind, url: page.url, status: "error", detail: response.detail }); continue; }
    const found = parseJsonLdEvents(response.body, page.url);
    sources.push({ kind: page.kind, url: page.url, status: "ok", detail: found.length ? `${found.length} eventos publicados (schema.org)` : "pagina leida; sin eventos estructurados (schema.org)" });
    for (const event of found) events.set(`${event.name}|${event.startDate}`, event);
  }
  return [...events.values()]
    .filter((event) => Date.parse(event.startDate) >= now.getTime() - DAY_MS / 2)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))
    .slice(0, 10);
}

function eventPages(websiteUrl: string | null, eventsUrl: string | null): Array<{ kind: "website" | "events"; url: string }> {
  const pages: Array<{ kind: "website" | "events"; url: string }> = [];
  if (eventsUrl) pages.push({ kind: "events", url: eventsUrl });
  if (websiteUrl && websiteUrl !== eventsUrl) pages.push({ kind: "website", url: websiteUrl });
  return pages;
}

async function readPeerScout(ctx: BlackRoomTeamContext): Promise<CompetitionReport["peerScout"]> {
  try {
    const file = path.join(ctx.dataDir, "..", "agent", "organic-peer-hypotheses.json");
    const body = JSON.parse(await readFile(file, "utf8")) as { evaluatedAt?: unknown; brands?: unknown };
    const brands = Array.isArray(body.brands) ? body.brands : [];
    const blackroom = brands.find((brand) => brand && typeof brand === "object" && (brand as { brand?: unknown }).brand === "blackroom") as { status?: string; proposal?: string | null } | undefined;
    return {
      evaluatedAt: typeof body.evaluatedAt === "string" ? body.evaluatedAt : null,
      brands: brands.length,
      note: blackroom?.status === "hypothesis" && blackroom.proposal ? `Scout organico: ${blackroom.proposal}` : "Scout organico: evidencia insuficiente todavia.",
    };
  } catch {
    return null;
  }
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function buildTakeaways(report: Omit<CompetitionReport, "takeaways">): string[] {
  const takeaways: string[] = [];
  const withYoutube = report.competitors.filter((competitor) => competitor.youtube);
  const own = report.blackroom.youtube;

  const ranked = withYoutube.filter((competitor) => competitor.youtube!.medianViews !== null).sort((a, b) => b.youtube!.medianViews! - a.youtube!.medianViews!);
  if (ranked.length) {
    const leader = ranked[0];
    const ownMedian = own?.medianViews ?? null;
    takeaways.push(
      ownMedian !== null
        ? `${leader.name} tiene la mediana de vistas mas alta en YouTube (${leader.youtube!.medianViews}) vs ${ownMedian} de Black Room.`
        : `${leader.name} tiene la mediana de vistas mas alta en YouTube (${leader.youtube!.medianViews}).`,
    );
  }
  const best = report.bestContent[0];
  if (best) takeaways.push(`Lo que mejor le funciona a la competencia: "${best.title}" de ${best.competitor} (${best.views} vistas). Revisa el gancho, el formato y el titulo para probar algo parecido con contenido propio.`);

  const rates = withYoutube.map((competitor) => competitor.youtube!.postsPerWeek).filter((value): value is number => value !== null);
  if (rates.length) {
    const avg = Math.round((rates.reduce((sum, value) => sum + value, 0) / rates.length) * 10) / 10;
    if (own?.postsPerWeek !== null && own?.postsPerWeek !== undefined) {
      if (avg > own.postsPerWeek) takeaways.push(`La competencia publica en promedio ${avg} videos/semana en YouTube y Black Room ${own.postsPerWeek}: hay espacio para subir la frecuencia.`);
      else takeaways.push(`Black Room publica ${own.postsPerWeek} videos/semana en YouTube, igual o mas que el promedio de la competencia (${avg}).`);
    } else {
      takeaways.push(`La competencia publica en promedio ${avg} videos/semana en YouTube.`);
    }
  }

  const ownDates = new Set(report.blackroom.upcomingEvents.map((event) => fmtDate(event.startDate)));
  for (const competitor of report.competitors) {
    const next = competitor.upcomingEvents[0];
    if (!next) continue;
    takeaways.push(`${competitor.name} tiene ${competitor.upcomingEvents.length} evento(s) proximo(s); el siguiente: "${next.name}" el ${fmtDate(next.startDate)}${next.location ? ` en ${next.location}` : ""}.`);
    const clashes = competitor.upcomingEvents.filter((event) => ownDates.has(fmtDate(event.startDate)));
    if (clashes.length) takeaways.push(`Choque de fechas con ${competitor.name}: ${clashes.map((event) => fmtDate(event.startDate)).join(", ")}. Conviene reforzar la promocion de esas noches.`);
  }

  if (report.peerScout) takeaways.push(report.peerScout.note);
  if (ranked.length || report.bestContent.length) takeaways.push("Nota: las vistas publicas no estan ajustadas por antiguedad del video ni por audiencia; son ideas para probar, no un ganador.");
  if (!takeaways.length) takeaways.push("Todavia no hay datos publicos suficientes para comparar; revisa las fuentes con error.");
  return takeaways.slice(0, 12);
}

export async function collectCompetitionReport(ctx: BlackRoomTeamContext, competitors: CompetitorConfig[]): Promise<CompetitionReport> {
  const now = ctx.now();
  const fetcher = createFetcher(ctx);
  const reports: CompetitorReport[] = [];
  for (const competitor of competitors) {
    const sources: CompetitorSourceResult[] = [];
    const youtube = competitor.youtubeChannelId ? await collectYoutube(fetcher, competitor.youtubeChannelId, now, sources) : null;
    const upcomingEvents = await collectEvents(fetcher, eventPages(competitor.websiteUrl, competitor.eventsUrl), now, sources);
    reports.push({ id: competitor.id, name: competitor.name, youtube, upcomingEvents, sources });
  }

  const ownSources: CompetitorSourceResult[] = [];
  const notes: string[] = [];
  const ownChannel = ctx.env.BLACKROOM_YOUTUBE_CHANNEL_ID?.trim();
  let ownYoutube: CompetitorReport["youtube"] = null;
  if (ownChannel && isYoutubeChannelId(ownChannel)) ownYoutube = await collectYoutube(fetcher, ownChannel, now, ownSources);
  else notes.push("Sin BLACKROOM_YOUTUBE_CHANNEL_ID: la comparacion de YouTube no incluye a Black Room.");
  const ownWebsite = normalizeCompetitor({ name: "Black Room", websiteUrl: ctx.env.BLACKROOM_WEBSITE_URL || null, eventsUrl: ctx.env.BLACKROOM_EVENTS_URL || null }, "env", null);
  const ownEvents = ownWebsite ? await collectEvents(fetcher, eventPages(ownWebsite.websiteUrl, ownWebsite.eventsUrl), now, ownSources) : [];
  if (!ctx.env.BLACKROOM_WEBSITE_URL && !ctx.env.BLACKROOM_EVENTS_URL) notes.push("Sin BLACKROOM_WEBSITE_URL / BLACKROOM_EVENTS_URL: no se detectan choques de fechas con los eventos de Black Room.");

  const bestContent = reports
    .flatMap((competitor) => (competitor.youtube?.topVideos ?? []).map((video) => ({ competitor: competitor.name, title: video.title, url: video.url, views: video.views ?? 0, publishedAt: video.publishedAt })))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  const allSources = [...reports.flatMap((competitor) => competitor.sources), ...ownSources];
  const base: Omit<CompetitionReport, "takeaways"> = {
    generatedAt: now.toISOString(),
    mode: "public_observation",
    mayPublish: false,
    competitors: reports,
    blackroom: { youtube: ownYoutube, upcomingEvents: ownEvents, sources: ownSources, notes },
    bestContent,
    peerScout: await readPeerScout(ctx),
    requestsUsed: fetcher.used(),
    okSources: allSources.filter((source) => source.status === "ok").length,
    failedSources: allSources.filter((source) => source.status === "error").length,
  };
  return { ...base, takeaways: buildTakeaways(base) };
}

export function formatCompetitionReportText(report: CompetitionReport): string {
  const lines = [`Reporte de competencia Black Room (${report.generatedAt.slice(0, 16).replace("T", " ")} UTC)`];
  for (const competitor of report.competitors) {
    const yt = competitor.youtube;
    lines.push(`- ${competitor.name}: ${yt ? `${yt.postsPerWeek ?? "?"} videos/semana, mediana ${yt.medianViews ?? "?"} vistas` : "sin datos de YouTube"}; ${competitor.upcomingEvents.length} evento(s) proximo(s).`);
  }
  lines.push("Conclusiones:");
  for (const takeaway of report.takeaways) lines.push(`* ${takeaway}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const NEED_COMPETITORS = "Agregar competidores en BLACKROOM_COMPETITORS (ej. 'Club Rival|UCxxxxxxxxxxxxxxxxxxxxxx|https://clubrival.com') o con la accion add-competitor";

async function getStatus(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamStatus> {
  const state = await loadState(ctx);
  const competitors = effectiveCompetitors(ctx, state);
  const base = { id: ID, lastRunAt: state.lastRunAt } as const;
  if (!competitors.length) {
    return { ...base, state: "blocked", label: "Faltan competidores", summary: "No hay competidores configurados para vigilar.", needs: [NEED_COMPETITORS] };
  }
  const withoutSource = competitors.filter((competitor) => !hasSource(competitor));
  if (withoutSource.length === competitors.length) {
    return {
      ...base,
      state: "blocked",
      label: "Faltan fuentes publicas",
      summary: "Los competidores no tienen canal de YouTube ni pagina web publica.",
      needs: withoutSource.slice(0, 5).map((competitor) => `Agregar canal de YouTube (UC...) o sitio web publico para ${competitor.name}`),
    };
  }
  const report = state.lastReport;
  const metrics: Record<string, number | string> = { competidores: competitors.length };
  if (report) {
    metrics.fuentesOk = report.okSources;
    metrics.fuentesConError = report.failedSources;
    metrics.eventosProximos = report.competitors.reduce((sum, competitor) => sum + competitor.upcomingEvents.length, 0);
    if (report.bestContent[0]) metrics.mejorVideoVistas = report.bestContent[0].views;
  }
  if (state.lastRunAt && state.lastRunOk === false) {
    return {
      ...base,
      state: "blocked",
      label: "Fuentes sin respuesta",
      summary: state.lastError || "Ninguna fuente publica respondio en la ultima corrida.",
      needs: ["Revisar la red o las URLs/canales de los competidores: ninguna fuente publica respondio en la ultima corrida"],
      metrics,
    };
  }
  const age = state.lastRunAt ? ctx.now().getTime() - Date.parse(state.lastRunAt) : Number.POSITIVE_INFINITY;
  if (state.lastRunOk && age >= 0 && age <= BLACKROOM_TEAM_WORKING_FRESH_MS && report) {
    return {
      ...base,
      state: "working",
      label: `Vigilando ${competitors.length} competidor(es)`,
      summary: report.takeaways[0] || "Reporte de competencia actualizado.",
      needs: [],
      metrics,
    };
  }
  return {
    ...base,
    state: "available",
    label: "Listo para revisar la competencia",
    summary: report ? "El ultimo reporte ya no es reciente; corre el agente para actualizarlo." : `${competitors.length} competidor(es) configurado(s); todavia no hay reporte.`,
    needs: [],
    metrics,
  };
}

async function run(ctx: BlackRoomTeamContext, input: Record<string, unknown> = {}): Promise<BlackRoomTeamRunResult> {
  const state = await loadState(ctx);
  const competitors = effectiveCompetitors(ctx, state).filter(hasSource);
  if (!competitors.length) return { ok: false, summary: "No hay competidores con fuentes publicas para revisar.", error: "blocked_no_competitors" };

  const nowMs = ctx.now().getTime();
  const lastMs = state.lastRunAt ? Date.parse(state.lastRunAt) : NaN;
  if (input.force !== true && state.lastRunOk && state.lastReport && Number.isFinite(lastMs) && nowMs - lastMs >= 0 && nowMs - lastMs < COMPETITION_MIN_RUN_INTERVAL_MS) {
    return {
      ok: true,
      summary: `Reporte reciente (${Math.round((nowMs - lastMs) / 60_000)} min); no se vuelve a consultar para no saturar las fuentes. Usa force: true para forzar.`,
      report: state.lastReport,
    };
  }

  const report = await collectCompetitionReport(ctx, competitors);
  const ok = report.okSources > 0;
  const next: CompetitionState = {
    ...state,
    lastRunAt: report.generatedAt,
    lastRunOk: ok,
    lastError: ok ? null : "Ninguna fuente publica respondio (red, timeout o robots.txt).",
    lastReport: ok ? report : state.lastReport,
  };
  await ctx.state.save(next);
  if (!ok) return { ok: false, summary: next.lastError!, report, error: "no_public_sources_responded" };
  return { ok: true, summary: formatCompetitionReportText(report), report };
}

async function listCompetitors(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamRunResult> {
  const state = await loadState(ctx);
  const competitors = effectiveCompetitors(ctx, state);
  return { ok: true, summary: competitors.length ? `${competitors.length} competidor(es): ${competitors.map((competitor) => competitor.name).join(", ")}.` : "No hay competidores configurados.", report: { competitors } };
}

async function addCompetitor(ctx: BlackRoomTeamContext, input: Record<string, unknown>): Promise<BlackRoomTeamRunResult> {
  const competitor = normalizeCompetitor(input, "manual", ctx.now().toISOString());
  if (!competitor) return { ok: false, summary: "Datos invalidos: usa un nombre, un canal de YouTube (UC...) y/o una URL https publica (sin login).", error: "invalid_competitor" };
  if (!hasSource(competitor)) return { ok: false, summary: "Agrega al menos un canal de YouTube (UC...) o una URL https publica.", error: "missing_source" };
  const state = await loadState(ctx);
  const current = effectiveCompetitors(ctx, state);
  if (!current.some((item) => item.id === competitor.id) && current.length >= COMPETITION_MAX_COMPETITORS) {
    return { ok: false, summary: `Maximo ${COMPETITION_MAX_COMPETITORS} competidores; quita uno antes de agregar otro.`, error: "too_many_competitors" };
  }
  const next: CompetitionState = {
    ...state,
    competitors: [...state.competitors.filter((item) => item.id !== competitor.id), competitor],
    removedSeedIds: state.removedSeedIds.filter((id) => id !== competitor.id),
  };
  await ctx.state.save(next);
  return { ok: true, summary: `Competidor agregado: ${competitor.name}.`, report: { competitor } };
}

async function removeCompetitor(ctx: BlackRoomTeamContext, input: Record<string, unknown>): Promise<BlackRoomTeamRunResult> {
  const id = typeof input.id === "string" ? input.id : typeof input.name === "string" ? normalizeCompetitor({ name: input.name, websiteUrl: null }, "manual", null)?.id : undefined;
  const state = await loadState(ctx);
  const current = effectiveCompetitors(ctx, state);
  const target = current.find((competitor) => competitor.id === id);
  if (!target) return { ok: false, summary: "Ese competidor no esta en la lista.", error: "not_found" };
  const isSeed = parseCompetitorSeeds(ctx.env.BLACKROOM_COMPETITORS).some((seed) => seed.id === target.id);
  const next: CompetitionState = {
    ...state,
    competitors: state.competitors.filter((competitor) => competitor.id !== target.id),
    removedSeedIds: isSeed ? [...new Set([...state.removedSeedIds, target.id])] : state.removedSeedIds,
  };
  await ctx.state.save(next);
  return { ok: true, summary: `Competidor quitado: ${target.name}.` };
}

async function lastReport(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamRunResult> {
  const state = await loadState(ctx);
  if (!state.lastReport) return { ok: false, summary: "Todavia no hay reporte de competencia.", error: "no_report" };
  return { ok: true, summary: formatCompetitionReportText(state.lastReport), report: state.lastReport };
}

const agent: BlackRoomTeamAgentModule = {
  id: ID,
  getStatus,
  run,
  actions: {
    "list-competitors": (ctx) => listCompetitors(ctx),
    "add-competitor": addCompetitor,
    "remove-competitor": removeCompetitor,
    report: (ctx) => lastReport(ctx),
  },
};

export default agent;
