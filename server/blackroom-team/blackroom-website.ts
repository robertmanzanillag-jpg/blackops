// "Website Black Room": read-only watcher for the Black Room website.
//
// What one run checks (deterministic code, no LLM, no new dependency):
// - Uptime and response time of the home page (history kept in ctx.state for an uptime %).
// - HTTPS and the TLS certificate (validity and days to expiry).
// - Broken links: bounded same-origin crawl plus a bounded check of external links, with timeouts.
// - Stale content: schema.org events already past, past dates shown next to "upcoming/tickets" text,
//   and (with read-only admin credentials) active bio links / countdowns whose date already passed.
// - That upcoming Black Room / radio events in the app (radio agent calendar) show up on the site.
//
// Safety: it only sends GET/HEAD requests (a guard refuses anything else), admin credentials are only
// sent to the admin origin (admin calls never follow redirects), and it never edits the live site. When it finds critical/high problems it
// leaves a draft task as a pending approval (dryRun) for Robert; approving it only records the decision.
import tls from "node:tls";
import {
  BLACKROOM_TEAM_WORKING_FRESH_MS,
  type BlackRoomTeamAgentModule,
  type BlackRoomTeamApproval,
  type BlackRoomTeamContext,
  type BlackRoomTeamEnv,
  type BlackRoomTeamRunResult,
  type BlackRoomTeamStatus,
} from "@shared/blackroom-team";
import { hasRealValue } from "../ceo-doctor-cli";
import {
  addDays,
  countBySeverity,
  extractDates,
  extractJsonLdEvents,
  extractLinks,
  htmlToText,
  isoDayInZone,
  issuesFingerprint,
  looksLikePage,
  mentionsUpcoming,
  pageTitle,
  sameOrigin,
  sortIssues,
  type BlackRoomWebsiteIssue,
  type BlackRoomWebsiteSeverity,
  type IsoDay,
} from "./blackroom-website/analyze";

const ID = "blackroom-website" as const;

/** Known Black Room site (server/blackroom-links.ts and the developer-health inventory use it too). */
export const BLACKROOM_WEBSITE_DEFAULT_URL = "https://blackroomus.com";
export const BLACKROOM_WEBSITE_URL_NEED = "BLACKROOM_WEBSITE_URL con una URL valida (https://...) del website de Black Room";
export const BLACKROOM_WEBSITE_ADMIN_NEED =
  "BLACKROOM_ADMIN_COOKIE, BLACKROOM_ADMIN_BEARER_TOKEN o BLACKROOM_ADMIN_API_KEY (acceso de lectura al admin) para revisar los links de la bio y los contadores";

const PAGE_TIMEOUT_MS = 10_000;
const LINK_TIMEOUT_MS = 8_000;
const TLS_TIMEOUT_MS = 8_000;
const RUN_BUDGET_MS = 90_000;
const DEFAULT_MAX_PAGES = 15;
const MAX_PAGES_LIMIT = 40;
const MAX_EXTRA_LINK_CHECKS = 20;
const MAX_BIO_LINK_CHECKS = 15;
const MAX_CRAWL_DEPTH = 2;
const MAX_BODY_CHARS = 1_500_000;
const HISTORY_LIMIT = 60;
const APPROVALS_LIMIT = 20;
const APP_EVENT_HORIZON_DAYS = 45;
const STALE_LOOKBACK_DAYS = 400;
const SLOW_MEDIUM_MS = 3_000;
const SLOW_HIGH_MS = 8_000;

export type BlackRoomWebsiteTlsResult = {
  /** Certificate expiry as ISO, when it could be read. */
  validTo: string | null;
  /** Whether the certificate chain and host name validate. */
  authorized: boolean;
  error?: string;
  /** The TLS connection itself could not be made (network, proxy): the certificate was not checked. */
  connectFailed?: boolean;
};

export type BlackRoomWebsiteAppEvent = { title: string; date: string };

export type BlackRoomWebsiteDeps = {
  checkTls?: (host: string, timeoutMs: number) => Promise<BlackRoomWebsiteTlsResult>;
  /** Upcoming Black Room / radio events in the app. null = not available (no user, no data source). */
  readAppEvents?: (ctx: BlackRoomTeamContext) => Promise<BlackRoomWebsiteAppEvent[] | null>;
  /** Called only for a draft task Robert approved. Without it, approving just records the decision. */
  createDraftTask?: (ctx: BlackRoomTeamContext, approval: BlackRoomTeamApproval) => Promise<{ id: string } | null>;
};

export type BlackRoomWebsiteReport = {
  checkedAt: string;
  url: string;
  reachable: boolean;
  statusCode: number | null;
  responseMs: number | null;
  title: string | null;
  tls: { https: boolean; checked: boolean; authorized: boolean | null; validTo: string | null; daysLeft: number | null; error?: string };
  pagesCrawled: number;
  linksChecked: number;
  brokenLinks: Array<{ url: string; status: number | null; error?: string; foundOn: string }>;
  bioLinks: { checked: boolean; total: number; active: number; inactive: number; expired: number };
  appEvents: { checked: boolean; upcoming: number; missingOnSite: number };
  uptime: { checks: number; ok: number; percent: number | null };
  issues: BlackRoomWebsiteIssue[];
  counts: Record<BlackRoomWebsiteSeverity, number>;
  skipped: string[];
};

type HistoryEntry = { at: string; ok: boolean; status: number | null; ms: number | null };

export type BlackRoomWebsiteState = {
  version: 1;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastReport: BlackRoomWebsiteReport | null;
  history: HistoryEntry[];
  approvals: BlackRoomTeamApproval[];
};

const EMPTY_STATE: BlackRoomWebsiteState = {
  version: 1,
  lastRunAt: null,
  lastOkAt: null,
  lastError: null,
  lastReport: null,
  history: [],
  approvals: [],
};

async function loadState(ctx: BlackRoomTeamContext): Promise<BlackRoomWebsiteState> {
  const raw = await ctx.state.load<Partial<BlackRoomWebsiteState> | null>(null);
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE, history: [], approvals: [] };
  return {
    ...EMPTY_STATE,
    ...raw,
    history: Array.isArray(raw.history) ? raw.history.slice(-HISTORY_LIMIT) : [],
    approvals: Array.isArray(raw.approvals) ? raw.approvals.slice(-APPROVALS_LIMIT) : [],
  };
}

/** Site URL from BLACKROOM_WEBSITE_URL (or the known default). null when the configured value is not usable. */
export function resolveBlackRoomWebsiteUrl(env: BlackRoomTeamEnv): string | null {
  const configured = env.BLACKROOM_WEBSITE_URL;
  const raw = configured === undefined || configured.trim() === "" ? BLACKROOM_WEBSITE_DEFAULT_URL : configured.trim();
  if (!hasRealValue(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function adminHeaders(env: BlackRoomTeamEnv): Record<string, string> | null {
  const headers: Record<string, string> = { Accept: "application/json" };
  let has = false;
  if (hasRealValue(env.BLACKROOM_ADMIN_COOKIE)) { headers.Cookie = env.BLACKROOM_ADMIN_COOKIE; has = true; }
  if (hasRealValue(env.BLACKROOM_ADMIN_BEARER_TOKEN)) { headers.Authorization = `Bearer ${env.BLACKROOM_ADMIN_BEARER_TOKEN}`; has = true; }
  if (hasRealValue(env.BLACKROOM_ADMIN_API_KEY)) { headers["X-API-Key"] = env.BLACKROOM_ADMIN_API_KEY; has = true; }
  return has ? headers : null;
}

function adminBaseUrl(env: BlackRoomTeamEnv): string | null {
  const raw = env.BLACKROOM_ADMIN_BASE_URL;
  if (raw !== undefined && !hasRealValue(raw)) return null;
  try {
    const url = new URL(raw || BLACKROOM_WEBSITE_DEFAULT_URL);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Only GET and HEAD leave the server; anything else is refused before the network. */
export function createReadOnlyWebsiteFetch(inner: typeof fetch): typeof fetch {
  const guarded = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const method = String(init?.method || (typeof input === "object" && "method" in (input as Request) ? (input as Request).method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw new Error(`Website Black Room es solo lectura; bloqueado: ${method}`);
    if (init?.body !== undefined && init.body !== null) throw new Error("Website Black Room es solo lectura; no envia cuerpo.");
    return inner(input, init);
  };
  return guarded as typeof fetch;
}

type FetchOutcome = {
  ok: boolean;
  status: number | null;
  ms: number;
  finalUrl: string;
  contentType: string;
  text: string | null;
  error?: string;
  errorCode?: string;
};

function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = (cause && typeof cause.code === "string" ? cause.code : undefined) ?? (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** A manual-redirect response: a 3xx, or the opaque status 0 some fetch implementations return. */
function isRedirectOutcome(outcome: FetchOutcome): boolean {
  return outcome.status !== null && (outcome.status === 0 || (outcome.status >= 300 && outcome.status < 400));
}

async function timedFetch(
  ctx: BlackRoomTeamContext,
  safeFetch: typeof fetch,
  url: string,
  options: { method: "GET" | "HEAD"; timeoutMs: number; readBody: boolean; headers?: Record<string, string>; redirect?: "follow" | "manual" },
): Promise<FetchOutcome> {
  const started = ctx.now().getTime();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const response = await Promise.race([
      safeFetch(url, {
        method: options.method,
        redirect: options.redirect ?? "follow",
        signal: controller.signal,
        headers: { "User-Agent": "BlackRoomWebsiteWatcher/1.0", ...(options.headers ?? {}) },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error(`sin respuesta en ${Math.round(options.timeoutMs / 1000)}s`), { code: "TIMEOUT" }));
        }, options.timeoutMs);
      }),
    ]);
    const contentType = response.headers?.get?.("content-type") ?? "";
    let text: string | null = null;
    if (options.readBody && /html|json|text/i.test(contentType || "text/html")) {
      text = (await response.text()).slice(0, MAX_BODY_CHARS);
    }
    return {
      ok: response.ok,
      status: response.status,
      ms: Math.max(0, ctx.now().getTime() - started),
      finalUrl: response.url || url,
      contentType,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      ms: Math.max(0, ctx.now().getTime() - started),
      finalUrl: url,
      contentType: "",
      text: null,
      error: error instanceof Error ? error.message.slice(0, 160) : "sin detalle",
      errorCode: errorCode(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const TLS_ERROR_PATTERN = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|DEPTH_ZERO/i;

const defaultCheckTls: NonNullable<BlackRoomWebsiteDeps["checkTls"]> = (host, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (result: BlackRoomWebsiteTlsResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    // rejectUnauthorized: false only so an invalid certificate can still be read and reported; nothing is sent.
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert && cert.valid_to ? new Date(cert.valid_to) : null;
      done({
        validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null,
        authorized: socket.authorized,
        error: socket.authorized ? undefined : String(socket.authorizationError || "certificado no valido"),
      });
    });
    socket.on("error", (error: NodeJS.ErrnoException) => done({ validTo: null, authorized: false, error: error.code || error.message, connectFailed: true }));
    socket.on("timeout", () => done({ validTo: null, authorized: false, error: "sin respuesta TLS a tiempo", connectFailed: true }));
  });

const defaultReadAppEvents: NonNullable<BlackRoomWebsiteDeps["readAppEvents"]> = async (ctx) => {
  if (!ctx.userId) return null;
  const { getRadioSlotsForMonth } = await import("../radio-agent");
  const slots = await getRadioSlotsForMonth(ctx.userId);
  return slots.map((slot) => ({ title: slot.eventTitle || "Black Room", date: new Date(slot.date).toISOString() }));
};

function issue(severity: BlackRoomWebsiteSeverity, code: string, title: string, detail: string, fix: string, url?: string): BlackRoomWebsiteIssue {
  return { severity, code, title, detail, fix, ...(url ? { url } : {}) };
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 86_400_000);
}

function parseMaxPages(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return DEFAULT_MAX_PAGES;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_PAGES_LIMIT) return null;
  return number;
}

function textField(record: Record<string, unknown>, ...keys: string[]): string {
  return keys.map((key) => record[key]).filter((value): value is string => typeof value === "string").join(" ");
}

function asRecordList(value: unknown, key: string): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key]) ? (value as Record<string, unknown>)[key] : [];
  return (list as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
}

function isActive(record: Record<string, unknown>): boolean {
  return record.is_active !== false && record.is_active !== 0 && record.active !== false;
}

function buildSummary(report: BlackRoomWebsiteReport): string {
  if (!report.reachable) return `La web ${report.url} no responde${report.statusCode ? ` (HTTP ${report.statusCode})` : ""}. Revisa el hosting.`;
  const c = report.counts;
  const parts = [`Web en linea (HTTP ${report.statusCode}, ${report.responseMs} ms)`, `${report.pagesCrawled} paginas y ${report.linksChecked} links revisados`];
  if (c.critical + c.high + c.medium + c.low === 0) parts.push("sin problemas");
  else parts.push(`problemas: ${c.critical} criticos, ${c.high} altos, ${c.medium} medios, ${c.low} bajos`);
  return `${parts.join("; ")}.`;
}

export function createBlackRoomWebsiteAgent(deps: BlackRoomWebsiteDeps = {}): BlackRoomTeamAgentModule {
  const checkTls = deps.checkTls ?? defaultCheckTls;
  const readAppEvents = deps.readAppEvents ?? defaultReadAppEvents;

  async function inspect(ctx: BlackRoomTeamContext, siteUrl: string, maxPages: number, state: BlackRoomWebsiteState): Promise<BlackRoomWebsiteReport> {
    const now = ctx.now();
    const nowMs = now.getTime();
    const deadline = nowMs + RUN_BUDGET_MS;
    const timeZone = ctx.env.BLACKROOM_TIMEZONE || "America/New_York";
    const today = isoDayInZone(now, timeZone);
    const safeFetch = createReadOnlyWebsiteFetch(ctx.fetch);
    const issues: BlackRoomWebsiteIssue[] = [];
    const skipped: string[] = [];
    const outOfTime = () => ctx.now().getTime() > deadline;

    // 1. Home page: uptime, response time.
    const home = await timedFetch(ctx, safeFetch, siteUrl, { method: "GET", timeoutMs: PAGE_TIMEOUT_MS, readBody: true });
    const reachable = home.status !== null && home.status < 500;
    const homeIsTlsError = !home.status && (TLS_ERROR_PATTERN.test(home.errorCode ?? "") || TLS_ERROR_PATTERN.test(home.error ?? ""));
    if (home.status === null) {
      issues.push(homeIsTlsError
        ? issue("critical", "tls_invalid", "Certificado HTTPS no valido", `El navegador rechaza la conexion: ${home.errorCode || home.error}.`, "Renovar o reinstalar el certificado SSL en el hosting/dominio.", siteUrl)
        : issue("critical", "site_down", "La web no responde", `No hubo respuesta: ${home.error || "sin detalle"}.`, "Revisar el hosting, el DNS y que el deploy este arriba.", siteUrl));
    } else if (home.status >= 500) {
      issues.push(issue("critical", "site_error", "La web devuelve error del servidor", `HTTP ${home.status}.`, "Revisar los logs del servidor y el ultimo deploy.", siteUrl));
    } else if (home.status >= 400) {
      issues.push(issue("high", "home_not_found", "La pagina principal da error", `HTTP ${home.status}.`, "Verificar que la ruta principal exista y que el dominio apunte al sitio correcto.", siteUrl));
    } else if (home.ms > SLOW_HIGH_MS) {
      issues.push(issue("high", "slow", "La web carga muy lenta", `Respondio en ${home.ms} ms.`, "Optimizar imagenes/videos pesados y revisar el plan del hosting o un CDN.", siteUrl));
    } else if (home.ms > SLOW_MEDIUM_MS) {
      issues.push(issue("medium", "slow", "La web carga lenta", `Respondio en ${home.ms} ms.`, "Comprimir imagenes y revisar scripts pesados en la portada.", siteUrl));
    }

    // 2. HTTPS / TLS.
    const parsedUrl = new URL(siteUrl);
    const tlsReport: BlackRoomWebsiteReport["tls"] = { https: parsedUrl.protocol === "https:", checked: false, authorized: null, validTo: null, daysLeft: null };
    if (!tlsReport.https) {
      issues.push(issue("high", "no_https", "La web no usa HTTPS", "La URL configurada es http://.", "Activar HTTPS (certificado SSL) y redirigir http a https.", siteUrl));
    } else if (!homeIsTlsError) {
      try {
        const result = await checkTls(parsedUrl.hostname, TLS_TIMEOUT_MS);
        if (result.connectFailed) {
          skipped.push(`No pude verificar el certificado TLS (${result.error || "sin conexion"}).`);
        } else {
          tlsReport.checked = true;
          tlsReport.authorized = result.authorized;
          tlsReport.validTo = result.validTo;
          if (result.error) tlsReport.error = result.error;
          if (result.validTo) tlsReport.daysLeft = daysBetween(nowMs, Date.parse(result.validTo));
          if (!result.authorized || (tlsReport.daysLeft !== null && tlsReport.daysLeft < 0)) {
            issues.push(issue("critical", "tls_invalid", "Certificado HTTPS no valido", `Detalle: ${result.error || "expirado"}.`, "Renovar o reinstalar el certificado SSL en el hosting/dominio.", siteUrl));
          } else if (tlsReport.daysLeft !== null && tlsReport.daysLeft < 14) {
            issues.push(issue("high", "tls_expiring", "El certificado HTTPS vence pronto", `Vence en ${tlsReport.daysLeft} dias (${result.validTo}).`, "Renovar el certificado o confirmar que la renovacion automatica funciona.", siteUrl));
          } else if (tlsReport.daysLeft !== null && tlsReport.daysLeft < 30) {
            issues.push(issue("medium", "tls_expiring", "El certificado HTTPS vence este mes", `Vence en ${tlsReport.daysLeft} dias (${result.validTo}).`, "Confirmar la renovacion automatica del certificado.", siteUrl));
          }
        }
      } catch (error) {
        skipped.push(`No pude verificar el certificado TLS (${error instanceof Error ? error.message.slice(0, 120) : "sin detalle"}).`);
      }
    }

    // 3. Same-origin crawl + link checks.
    const brokenLinks: BlackRoomWebsiteReport["brokenLinks"] = [];
    const siteFullDays = new Set<IsoDay>();
    const siteMonthDays = new Set<string>();
    let pagesCrawled = 0;
    let linksChecked = 0;
    const checkedLinks = new Set<string>();
    const foundOn = new Map<string, string>();
    const externalLinks: string[] = [];
    const queue: Array<{ url: string; depth: number }> = [];
    const queued = new Set<string>([siteUrl]);

    const analyzePage = (pageUrl: string, html: string, depth: number) => {
      pagesCrawled += 1;
      const text = htmlToText(html);
      const dates = extractDates(text);
      for (const day of dates.fullDays) siteFullDays.add(day);
      for (const monthDay of dates.monthDays) siteMonthDays.add(monthDay);

      for (const event of extractJsonLdEvents(html)) {
        const lastDay = event.endDay ?? event.startDay;
        if (lastDay) {
          siteFullDays.add(event.startDay ?? lastDay);
          siteMonthDays.add((event.startDay ?? lastDay).slice(5));
        }
        if (lastDay && lastDay < today && issues.filter((i) => i.code === "past_event_listed").length < 10) {
          issues.push(issue("high", "past_event_listed", "Evento pasado sigue publicado", `"${event.name}" (${lastDay}) aparece como evento en ${pageUrl}.`, "Quitar el evento de la lista de proximos eventos o moverlo a eventos pasados.", pageUrl));
        }
      }

      const isArchive = /\b(past events|eventos pasados|archive|archivo|recap)\b/i.test(text) || /past|pasad|archiv/i.test(new URL(pageUrl).pathname);
      if (!isArchive && mentionsUpcoming(text)) {
        const oldest = addDays(today, -STALE_LOOKBACK_DAYS);
        const pastDays = dates.fullDays.filter((day) => day < addDays(today, -1) && day > oldest);
        const futureDays = dates.fullDays.filter((day) => day >= today);
        if (pastDays.length > 0) {
          issues.push(futureDays.length === 0
            ? issue("high", "stale_upcoming", "La seccion de proximos eventos esta vieja", `Solo muestra fechas pasadas (${pastDays.slice(-3).join(", ")}) en ${pageUrl}.`, "Publicar el proximo evento y quitar las fechas que ya pasaron.", pageUrl)
            : issue("medium", "past_dates_listed", "Hay fechas pasadas junto a proximos eventos", `Fechas pasadas: ${pastDays.slice(-3).join(", ")} en ${pageUrl}.`, "Quitar las fechas pasadas o moverlas a eventos pasados.", pageUrl));
        }
      }

      for (const link of extractLinks(html, pageUrl)) {
        if (!foundOn.has(link)) foundOn.set(link, pageUrl);
        if (sameOrigin(link, siteUrl)) {
          if (looksLikePage(link) && depth < MAX_CRAWL_DEPTH && !queued.has(link)) {
            queued.add(link);
            queue.push({ url: link, depth: depth + 1 });
          } else if (!looksLikePage(link) && !externalLinks.includes(link)) {
            externalLinks.push(link); // same-origin asset: checked with the bounded extra checks
          }
        } else if (!externalLinks.includes(link)) {
          externalLinks.push(link);
        }
      }
    };

    if (home.ok && home.text) {
      checkedLinks.add(siteUrl);
      analyzePage(sameOrigin(home.finalUrl, siteUrl) ? home.finalUrl : siteUrl, home.text, 0);
    }
    while (queue.length > 0 && pagesCrawled < maxPages && !outOfTime()) {
      const next = queue.shift()!;
      if (checkedLinks.has(next.url)) continue;
      checkedLinks.add(next.url);
      linksChecked += 1;
      const page = await timedFetch(ctx, safeFetch, next.url, { method: "GET", timeoutMs: PAGE_TIMEOUT_MS, readBody: true });
      if (!page.ok) {
        brokenLinks.push({ url: next.url, status: page.status, ...(page.error ? { error: page.error } : {}), foundOn: foundOn.get(next.url) ?? siteUrl });
        continue;
      }
      if (page.text && /html/i.test(page.contentType || "text/html") && sameOrigin(page.finalUrl, siteUrl)) analyzePage(next.url, page.text, next.depth);
    }
    if (queue.length > 0) skipped.push(`Quedaron ${queue.length} paginas sin revisar (limite de ${maxPages} paginas o de tiempo).`);

    const unverifiable: string[] = [];
    const checkLink = async (url: string, origin: string): Promise<void> => {
      if (checkedLinks.has(url)) return;
      checkedLinks.add(url);
      linksChecked += 1;
      let result = await timedFetch(ctx, safeFetch, url, { method: "HEAD", timeoutMs: LINK_TIMEOUT_MS, readBody: false });
      if (result.status === 405 || result.status === 501 || result.status === 400) {
        result = await timedFetch(ctx, safeFetch, url, { method: "GET", timeoutMs: LINK_TIMEOUT_MS, readBody: false });
      }
      if (result.status === 401 || result.status === 403 || result.status === 429) {
        unverifiable.push(url);
        return;
      }
      if (!result.ok) brokenLinks.push({ url, status: result.status, ...(result.error ? { error: result.error } : {}), foundOn: origin });
    };
    const extra = externalLinks.slice(0, MAX_EXTRA_LINK_CHECKS);
    for (const url of extra) {
      if (outOfTime()) break;
      await checkLink(url, foundOn.get(url) ?? siteUrl);
    }
    if (externalLinks.length > extra.length) skipped.push(`Revise ${extra.length} de ${externalLinks.length} links externos (limite por corrida).`);
    if (unverifiable.length > 0) {
      issues.push(issue("low", "link_unverifiable", "Links que no se pudieron verificar", `${unverifiable.length} link(s) bloquean revisiones automaticas: ${unverifiable.slice(0, 3).join(", ")}.`, "Abrirlos a mano una vez para confirmar que funcionan."));
    }

    // 4. Bio links and countdowns (read-only admin API).
    const bio: BlackRoomWebsiteReport["bioLinks"] = { checked: false, total: 0, active: 0, inactive: 0, expired: 0 };
    const headers = adminHeaders(ctx.env);
    const adminBase = adminBaseUrl(ctx.env);
    if (!headers) {
      skipped.push(`Links de la bio sin revisar: falta ${BLACKROOM_WEBSITE_ADMIN_NEED}.`);
    } else if (!adminBase) {
      skipped.push("Links de la bio sin revisar: BLACKROOM_ADMIN_BASE_URL no es una URL https valida.");
    } else {
      // Admin requests carry credentials: never follow a redirect (fetch would forward X-API-Key to
      // whatever host the Location names).
      const statsResult = await timedFetch(ctx, safeFetch, `${adminBase}/api/admin/link-stats`, { method: "GET", timeoutMs: PAGE_TIMEOUT_MS, readBody: true, headers, redirect: "manual" });
      let links: Record<string, unknown>[] | null = null;
      try {
        if (statsResult.ok && statsResult.text) links = asRecordList(JSON.parse(statsResult.text), "links");
      } catch {
        links = null;
      }
      if (isRedirectOutcome(statsResult)) {
        skipped.push("Links de la bio sin revisar: el admin redirigio a otra direccion y no se sigue (las credenciales solo van al admin).");
      } else if (!links) {
        skipped.push(`Links de la bio sin revisar: el admin respondio ${statsResult.status ?? statsResult.error ?? "sin datos"}.`);
      } else {
        bio.checked = true;
        bio.total = links.length;
        let bioChecks = 0;
        for (const link of links) {
          const active = isActive(link);
          if (!active) { bio.inactive += 1; continue; }
          bio.active += 1;
          const label = textField(link, "title", "subtitle") || String(link.url ?? "link");
          const linkDates = extractDates(textField(link, "title", "subtitle", "date", "event_date")).fullDays.filter((day) => day < addDays(today, -1) && day > addDays(today, -STALE_LOOKBACK_DAYS));
          if (linkDates.length > 0 && linkDates.every((day) => day < today)) {
            bio.expired += 1;
            issues.push(issue("medium", "bio_link_expired", "Link de la bio de un evento que ya paso", `"${label.slice(0, 80)}" (${linkDates.join(", ")}) sigue activo.`, "Desactivar ese link en el admin de la bio o cambiarlo al proximo evento.", typeof link.url === "string" ? link.url : undefined));
          }
          if (typeof link.url === "string" && /^https?:\/\//i.test(link.url) && bioChecks < MAX_BIO_LINK_CHECKS && !outOfTime()) {
            bioChecks += 1;
            const before = brokenLinks.length;
            await checkLink(link.url, "bio");
            if (brokenLinks.length > before) {
              issues.push(issue("high", "bio_link_broken", "Link de la bio roto", `"${label.slice(0, 80)}" -> ${link.url} (${brokenLinks[brokenLinks.length - 1].status ?? brokenLinks[brokenLinks.length - 1].error}).`, "Corregir la URL del link en el admin de la bio o desactivarlo.", link.url));
            }
          }
        }
        const elementsResult = await timedFetch(ctx, safeFetch, `${adminBase}/api/admin/bio-elements`, { method: "GET", timeoutMs: PAGE_TIMEOUT_MS, readBody: true, headers, redirect: "manual" });
        if (isRedirectOutcome(elementsResult)) skipped.push("No revise los contadores de la bio: el admin redirigio a otra direccion y no se sigue.");
        else try {
          const elements = elementsResult.ok && elementsResult.text ? asRecordList(JSON.parse(elementsResult.text), "elements") : [];
          for (const element of elements) {
            if (element.element_type !== "countdown" || !isActive(element)) continue;
            const metadata = element.metadata && typeof element.metadata === "object" ? element.metadata as Record<string, unknown> : {};
            const target = typeof metadata.countdown_date === "string" ? Date.parse(metadata.countdown_date) : NaN;
            if (Number.isFinite(target) && target < nowMs) {
              bio.expired += 1;
              issues.push(issue("medium", "countdown_expired", "Contador de la bio ya termino", `"${textField(element, "title") || "Contador"}" llego a cero (${metadata.countdown_date}).`, "Quitar el contador o ponerle la fecha de la proxima fiesta."));
            }
          }
        } catch {
          skipped.push("No pude leer los contadores de la bio (respuesta no valida).");
        }
      }
    }

    // 5. App events vs site.
    const appEventsReport: BlackRoomWebsiteReport["appEvents"] = { checked: false, upcoming: 0, missingOnSite: 0 };
    if (pagesCrawled === 0) {
      skipped.push("No compare los eventos de la app con la web: no pude leer ninguna pagina.");
    } else {
      try {
        const events = await readAppEvents(ctx);
        if (events === null) {
          skipped.push("No compare los eventos de la app con la web: no hay usuario o calendario disponible.");
        } else {
          appEventsReport.checked = true;
          const horizon = addDays(today, APP_EVENT_HORIZON_DAYS);
          const upcoming = events
            .map((event) => ({ title: event.title, day: Number.isFinite(Date.parse(event.date)) ? isoDayInZone(new Date(event.date), timeZone) : null }))
            .filter((event): event is { title: string; day: IsoDay } => !!event.day && event.day >= today && event.day <= horizon);
          appEventsReport.upcoming = upcoming.length;
          const missing = upcoming.filter((event) => !siteFullDays.has(event.day) && !siteMonthDays.has(event.day.slice(5)));
          appEventsReport.missingOnSite = missing.length;
          if (missing.length > 0) {
            issues.push(issue("medium", "app_event_missing", "Eventos de la app que no aparecen en la web", missing.slice(0, 5).map((event) => `${event.title} (${event.day})`).join("; "), "Agregar esos eventos (fecha y link de tickets) a la web o confirmar que no se van a promocionar ahi."));
          }
        }
      } catch (error) {
        skipped.push(`No pude leer los eventos de la app: ${error instanceof Error ? error.message.slice(0, 120) : "sin detalle"}.`);
      }
    }

    // Broken link issues (pages and site links; bio ones were reported above).
    for (const broken of brokenLinks.filter((item) => item.foundOn !== "bio").slice(0, 15)) {
      const internal = sameOrigin(broken.url, siteUrl);
      issues.push(issue(internal ? "high" : "medium", internal ? "broken_internal_link" : "broken_external_link", internal ? "Pagina interna rota" : "Link externo roto",
        `${broken.url} -> ${broken.status ?? broken.error} (aparece en ${broken.foundOn}).`,
        internal ? "Arreglar la ruta o quitar el link del menu/pagina." : "Actualizar o quitar el link (tickets, redes, etc.).", broken.url));
    }

    const history = [...state.history, { at: now.toISOString(), ok: home.status !== null && home.status < 400, status: home.status, ms: home.status === null ? null : home.ms }].slice(-HISTORY_LIMIT);
    const okCount = history.filter((entry) => entry.ok).length;
    const sorted = sortIssues(issues);
    return {
      checkedAt: now.toISOString(),
      url: siteUrl,
      reachable,
      statusCode: home.status,
      responseMs: home.status === null ? null : home.ms,
      title: home.text ? pageTitle(home.text) : null,
      tls: tlsReport,
      pagesCrawled,
      linksChecked,
      brokenLinks,
      bioLinks: bio,
      appEvents: appEventsReport,
      uptime: { checks: history.length, ok: okCount, percent: history.length ? Math.round((okCount / history.length) * 1000) / 10 : null },
      issues: sorted,
      counts: countBySeverity(sorted),
      skipped,
    };
  }

  function draftApproval(ctx: BlackRoomTeamContext, report: BlackRoomWebsiteReport): BlackRoomTeamApproval {
    const actionable = report.issues.filter((item) => item.severity === "critical" || item.severity === "high" || item.severity === "medium");
    const now = ctx.now();
    return {
      id: `website-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: ID,
      kind: "draft-task",
      title: `Arreglar website Black Room: ${report.counts.critical + report.counts.high} problema(s) importantes`,
      summary: actionable.slice(0, 5).map((item) => `[${item.severity}] ${item.title}`).join(" | "),
      payload: {
        url: report.url,
        fingerprint: issuesFingerprint(report.issues),
        checkedAt: report.checkedAt,
        issues: actionable.slice(0, 20),
        note: "Borrador de tarea para Robert. Este agente no edita la web.",
      },
      createdAt: now.toISOString(),
      status: "pending",
      decidedAt: null,
      dryRun: true,
    };
  }

  async function run(ctx: BlackRoomTeamContext, input: Record<string, unknown> = {}): Promise<BlackRoomTeamRunResult> {
    const siteUrl = resolveBlackRoomWebsiteUrl(ctx.env);
    if (!siteUrl) return { ok: false, summary: `No puedo revisar la web: falta ${BLACKROOM_WEBSITE_URL_NEED}.`, error: "missing_url" };
    const maxPages = parseMaxPages(input.maxPages);
    if (maxPages === null) return { ok: false, summary: `maxPages debe ser un numero entero entre 1 y ${MAX_PAGES_LIMIT}.`, error: "invalid_max_pages" };

    const state = await loadState(ctx);
    let report: BlackRoomWebsiteReport;
    try {
      report = await inspect(ctx, siteUrl, maxPages, state);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "sin detalle";
      await ctx.state.save<BlackRoomWebsiteState>({ ...state, lastError: message });
      return { ok: false, summary: `La revision de la web fallo: ${message}`, error: "inspect_failed" };
    }

    const needsApproval: BlackRoomTeamApproval[] = [];
    let approvals = state.approvals;
    const fingerprint = issuesFingerprint(report.issues);
    if (fingerprint && input.createDraft !== false) {
      const existing = approvals.find((item) => item.status === "pending" && (item.payload as { fingerprint?: unknown } | null)?.fingerprint === fingerprint);
      if (existing) {
        needsApproval.push(existing);
      } else {
        // A newer report replaces older pending drafts: only one open draft task at a time.
        approvals = approvals.map((item) => item.status === "pending" ? { ...item, status: "rejected" as const, decidedAt: report.checkedAt } : item);
        const draft = draftApproval(ctx, report);
        approvals = [...approvals, draft].slice(-APPROVALS_LIMIT);
        needsApproval.push(draft);
      }
    }

    const history = [...state.history, { at: report.checkedAt, ok: report.statusCode !== null && report.statusCode < 400, status: report.statusCode, ms: report.responseMs }].slice(-HISTORY_LIMIT);
    await ctx.state.save<BlackRoomWebsiteState>({
      ...state,
      lastRunAt: report.checkedAt,
      lastOkAt: report.reachable ? report.checkedAt : state.lastOkAt,
      lastError: null,
      lastReport: report,
      history,
      approvals,
    });
    const summary = buildSummary(report) + (needsApproval.length ? " Deje un borrador de tarea para que lo apruebes; no toque la web." : "");
    return { ok: true, summary, report, ...(needsApproval.length ? { needsApproval } : {}) };
  }

  async function getStatus(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamStatus> {
    const siteUrl = resolveBlackRoomWebsiteUrl(ctx.env);
    const state = await loadState(ctx);
    const pendingApprovals = state.approvals.filter((item) => item.status === "pending").length;
    if (!siteUrl) {
      return {
        id: ID, state: "blocked", label: "Falta la URL", summary: "La URL del website configurada no es valida.",
        needs: [BLACKROOM_WEBSITE_URL_NEED], lastRunAt: state.lastRunAt, pendingApprovals,
      };
    }
    const needs = adminHeaders(ctx.env) ? [] : [BLACKROOM_WEBSITE_ADMIN_NEED];
    const report = state.lastReport;
    const lastRunMs = state.lastRunAt ? Date.parse(state.lastRunAt) : NaN;
    const nowMs = ctx.now().getTime();
    const fresh = Number.isFinite(lastRunMs) && lastRunMs <= nowMs && nowMs - lastRunMs <= BLACKROOM_TEAM_WORKING_FRESH_MS;
    const metrics: Record<string, number | string> = { url: siteUrl };
    if (report) {
      metrics.criticos = report.counts.critical;
      metrics.altos = report.counts.high;
      metrics.medios = report.counts.medium;
      metrics.paginas = report.pagesCrawled;
      metrics.linksRotos = report.brokenLinks.length;
      if (report.responseMs !== null) metrics.respuestaMs = report.responseMs;
      if (report.uptime.percent !== null) metrics.uptime = report.uptime.percent;
      if (report.tls.daysLeft !== null) metrics.diasCertificado = report.tls.daysLeft;
    }
    if (fresh && report) {
      const important = report.counts.critical + report.counts.high;
      return {
        id: ID,
        state: "working",
        label: !report.reachable ? "Web caida" : important > 0 ? `Web con ${important} problema(s)` : "Web revisada",
        summary: buildSummary(report),
        needs,
        lastRunAt: state.lastRunAt,
        metrics,
        pendingApprovals,
      };
    }
    return {
      id: ID,
      state: "available",
      label: "Listo para revisar",
      summary: report
        ? `Ultima revision ${state.lastRunAt}: ${buildSummary(report)} Corre una revision nueva para actualizar.`
        : `Listo para revisar ${siteUrl} (estado, HTTPS, links rotos, contenido viejo y eventos). Todavia no ha corrido.`,
      needs,
      lastRunAt: state.lastRunAt,
      metrics,
      pendingApprovals,
    };
  }

  async function decide(ctx: BlackRoomTeamContext, input: Record<string, unknown>, decision: "approved" | "rejected"): Promise<BlackRoomTeamRunResult> {
    const id = typeof input.id === "string" ? input.id : "";
    if (!id) return { ok: false, summary: "Falta el id del borrador.", error: "missing_id" };
    const state = await loadState(ctx);
    const index = state.approvals.findIndex((item) => item.id === id);
    if (index < 0) return { ok: false, summary: "No encontre ese borrador.", error: "not_found" };
    const current = state.approvals[index];
    if (current.status !== "pending") return { ok: false, summary: `Ese borrador ya estaba ${current.status === "approved" ? "aprobado" : "rechazado"}.`, error: "already_decided" };
    const updated: BlackRoomTeamApproval = { ...current, status: decision, decidedAt: ctx.now().toISOString() };
    const approvals = [...state.approvals];
    approvals[index] = updated;
    await ctx.state.save<BlackRoomWebsiteState>({ ...state, approvals });
    if (decision === "rejected") return { ok: true, summary: "Borrador rechazado.", report: { item: updated } };
    let taskNote = "Quedo aprobado como tarea pendiente para Robert; la web no se modifico.";
    if (deps.createDraftTask) {
      try {
        const task = await deps.createDraftTask(ctx, updated);
        if (task) taskNote = `Tarea creada (${task.id}); la web no se modifico.`;
      } catch (error) {
        taskNote = `Aprobado, pero no pude crear la tarea: ${error instanceof Error ? error.message.slice(0, 120) : "sin detalle"}.`;
      }
    }
    return { ok: true, summary: taskNote, report: { item: updated } };
  }

  return {
    id: ID,
    getStatus,
    run,
    actions: {
      check: (ctx, input) => run(ctx, input),
      async report(ctx) {
        const state = await loadState(ctx);
        if (!state.lastReport) return { ok: true, summary: "Todavia no hay reporte de la web.", report: null };
        return { ok: true, summary: buildSummary(state.lastReport), report: state.lastReport };
      },
      async approvals(ctx) {
        const state = await loadState(ctx);
        const pending = state.approvals.filter((item) => item.status === "pending");
        return { ok: true, summary: `${pending.length} borrador(es) pendiente(s).`, report: { items: state.approvals }, needsApproval: pending };
      },
      approve: (ctx, input) => decide(ctx, input, "approved"),
      reject: (ctx, input) => decide(ctx, input, "rejected"),
    },
  };
}

const agent = createBlackRoomWebsiteAgent();
export default agent;
