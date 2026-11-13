import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBlackRoomTeamStatus, type BlackRoomTeamApproval } from "../shared/blackroom-team";
import { createBlackRoomTeamContext } from "../server/blackroom-team";
import defaultAgent, {
  BLACKROOM_WEBSITE_ADMIN_NEED,
  BLACKROOM_WEBSITE_DEFAULT_URL,
  BLACKROOM_WEBSITE_URL_NEED,
  createBlackRoomWebsiteAgent,
  createReadOnlyWebsiteFetch,
  resolveBlackRoomWebsiteUrl,
  type BlackRoomWebsiteReport,
} from "../server/blackroom-team/blackroom-website";
import { extractDates, extractJsonLdEvents, extractLinks } from "../server/blackroom-team/blackroom-website/analyze";

const NOW = new Date("2026-11-12T17:00:00Z");
const SITE = "https://blackroomus.com/";

async function withDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "br-website-"));
  try { return await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(routes: Record<string, { status: number; body?: string; type?: string; location?: string }>, calls: Call[]): typeof fetch {
  const impl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, method: String(init?.method || "GET"), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body });
    const route = routes[url];
    if (!route) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { cause: { code: "ENOTFOUND" } });
    if (route.location) {
      // Like undici: redirect "follow" re-sends custom headers (X-API-Key) to the new host.
      if (init?.redirect === "manual") return new Response(null, { status: route.status, headers: { location: route.location } });
      return impl(route.location, init);
    }
    return new Response(init?.method === "HEAD" ? null : route.body ?? "", { status: route.status, headers: { "content-type": route.type ?? "text/html" } });
  });
  return impl as unknown as typeof fetch;
}

const failingFetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
const goodTls = async () => ({ validTo: "2027-03-01T00:00:00.000Z", authorized: true });

const HOME = `<!doctype html><html><head><title>Black Room</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"MusicEvent","name":"Black Room Halloween","startDate":"2026-10-31T22:00"},
 {"@type":"Event","name":"Black Room Thanksgiving","startDate":"2026-11-27T22:00"}]}</script></head>
<body><h1>Upcoming events</h1><p>Nov 27, 2026 - Thanksgiving party. Tickets below.</p>
<a href="/events">Eventos</a> <a href="/about#team">About</a> <a href="/old-page">Viejo</a>
<a href="https://tickets.example/br">Tickets</a> <a href="https://broken.example/x">Roto</a>
<a href="mailto:hi@blackroomus.com">mail</a></body></html>`;

const EVENTS = `<html><body><h2>Proximos eventos</h2><p>15 de octubre de 2026 - Radio night</p><a href="/">Inicio</a></body></html>`;

function siteRoutes() {
  return {
    [SITE]: { status: 200, body: HOME },
    "https://blackroomus.com/events": { status: 200, body: EVENTS },
    "https://blackroomus.com/about": { status: 200, body: "<html><body>About</body></html>" },
    "https://blackroomus.com/old-page": { status: 404, body: "no" },
    "https://tickets.example/br": { status: 200 },
  };
}

test("analyze helpers: links, dates and JSON-LD events", () => {
  const links = extractLinks(HOME, SITE);
  assert.ok(links.includes("https://blackroomus.com/about"), "fragment stripped");
  assert.ok(!links.some((link) => link.startsWith("mailto:")));
  const dates = extractDates("Nov 27, 2026 y 15 de octubre de 2026, tambien 12/05/2026 y Dec 31");
  assert.deepEqual(dates.fullDays, ["2026-10-15", "2026-11-27", "2026-12-05"]);
  assert.ok(dates.monthDays.includes("12-31"));
  assert.deepEqual(extractJsonLdEvents(HOME).map((event) => event.startDay), ["2026-10-31", "2026-11-27"]);
});

test("resolveBlackRoomWebsiteUrl: known default, env override, invalid values", () => {
  assert.equal(resolveBlackRoomWebsiteUrl({}), `${BLACKROOM_WEBSITE_DEFAULT_URL}/`);
  assert.equal(resolveBlackRoomWebsiteUrl({ BLACKROOM_WEBSITE_URL: "https://example.org/br" }), "https://example.org/br");
  assert.equal(resolveBlackRoomWebsiteUrl({ BLACKROOM_WEBSITE_URL: "ftp://x" }), null);
  assert.equal(resolveBlackRoomWebsiteUrl({ BLACKROOM_WEBSITE_URL: "your-site" }), null);
});

test("getStatus: never working with empty env, failing fetch and empty data dir", async () => {
  await withDir(async (dir) => {
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: failingFetch, dataDir: dir, now: () => NOW });
    const status = parseBlackRoomTeamStatus(await defaultAgent.getStatus(ctx));
    assert.ok(status);
    assert.equal(status!.state, "available");
    assert.notEqual(status!.state, "working");
    assert.deepEqual(status!.needs, [BLACKROOM_WEBSITE_ADMIN_NEED]);
    assert.equal(status!.lastRunAt, null);
    assert.deepEqual(await readdir(dir), [], "getStatus does not write state");
  });
});

test("blocked path: invalid BLACKROOM_WEBSITE_URL blocks status and run makes no request", async () => {
  await withDir(async (dir) => {
    const calls: Call[] = [];
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: { BLACKROOM_WEBSITE_URL: "not a url" }, fetch: fakeFetch({}, calls), dataDir: dir, now: () => NOW });
    const agent = createBlackRoomWebsiteAgent({ checkTls: goodTls, readAppEvents: async () => [] });
    const status = await agent.getStatus(ctx);
    assert.equal(status.state, "blocked");
    assert.deepEqual(status.needs, [BLACKROOM_WEBSITE_URL_NEED]);
    const result = await agent.run(ctx, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_url");
    assert.equal(calls.length, 0);
  });
});

test("happy path: report by severity, draft task pending/dryRun, working status, no outward writes", async () => {
  await withDir(async (dir) => {
    const calls: Call[] = [];
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: fakeFetch(siteRoutes(), calls), dataDir: dir, now: () => NOW, userId: "u1" });
    const agent = createBlackRoomWebsiteAgent({
      checkTls: goodTls,
      readAppEvents: async () => [
        { title: "Black Room Thanksgiving", date: "2026-11-28T03:00:00.000Z" }, // 27 Nov in New York
        { title: "Radio Black Room", date: "2026-12-05T02:00:00.000Z" }, // 4 Dec: not on the site
        { title: "Evento viejo", date: "2026-10-01T02:00:00.000Z" },
      ],
    });
    const result = await agent.run(ctx, {});
    assert.equal(result.ok, true, result.summary);
    const report = result.report as BlackRoomWebsiteReport;
    assert.equal(report.reachable, true);
    assert.equal(report.statusCode, 200);
    assert.equal(report.title, "Black Room");
    assert.equal(report.tls.daysLeft, 108);
    assert.equal(report.pagesCrawled, 3);
    const codes = report.issues.map((item) => item.code);
    assert.ok(codes.includes("past_event_listed"), "Halloween JSON-LD event already passed");
    assert.ok(codes.includes("stale_upcoming"), "/events only shows past dates under 'proximos'");
    assert.ok(codes.includes("broken_internal_link"));
    assert.ok(codes.includes("broken_external_link"));
    assert.ok(codes.includes("app_event_missing"));
    assert.equal(report.appEvents.upcoming, 2);
    assert.equal(report.appEvents.missingOnSite, 1);
    assert.ok(report.issues.find((item) => item.code === "app_event_missing")!.detail.includes("2026-12-04"));
    assert.ok(report.skipped.some((line) => line.includes("Links de la bio sin revisar")));
    // sorted by severity
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
    for (let i = 1; i < report.issues.length; i += 1) assert.ok(rank[report.issues[i - 1].severity] <= rank[report.issues[i].severity]);
    for (const item of report.issues) assert.ok(item.fix.length > 0);

    // Safety: only GET/HEAD, no bodies, no admin credentials anywhere.
    assert.ok(calls.every((call) => call.method === "GET" || call.method === "HEAD"));
    assert.ok(calls.every((call) => call.body === undefined));
    assert.ok(calls.every((call) => !("Cookie" in call.headers) && !("Authorization" in call.headers)));

    assert.equal(result.needsApproval?.length, 1);
    const draft = result.needsApproval![0];
    assert.equal(draft.status, "pending");
    assert.equal(draft.dryRun, true);
    assert.equal(draft.kind, "draft-task");

    const status = parseBlackRoomTeamStatus(await agent.getStatus(ctx));
    assert.equal(status!.state, "working");
    assert.equal(status!.lastRunAt, NOW.toISOString());
    assert.equal(status!.pendingApprovals, 1);
    assert.equal(status!.metrics?.linksRotos, 2);

    // Re-run with the same findings does not duplicate the draft.
    const again = await agent.run(ctx, {});
    assert.equal(again.needsApproval?.[0].id, draft.id);
    const listed = await agent.actions!.approvals(ctx, {});
    assert.equal((listed.report as { items: BlackRoomTeamApproval[] }).items.length, 1);

    // Status goes back to available when the last run is old.
    const later = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: failingFetch, dataDir: dir, now: () => new Date(NOW.getTime() + 27 * 3_600_000) });
    assert.equal((await agent.getStatus(later)).state, "available");
  });
});

test("approval flow: approve only records the decision (or calls the injected task creator), never the site", async () => {
  await withDir(async (dir) => {
    const calls: Call[] = [];
    const created: string[] = [];
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: fakeFetch(siteRoutes(), calls), dataDir: dir, now: () => NOW });
    const agent = createBlackRoomWebsiteAgent({
      checkTls: goodTls,
      readAppEvents: async () => null,
      createDraftTask: async (_ctx, approval) => { created.push(approval.id); return { id: "task-1" }; },
    });
    const result = await agent.run(ctx, {});
    assert.equal(created.length, 0, "no task before approval");
    const draft = result.needsApproval![0];
    const callsBefore = calls.length;
    assert.equal((await agent.actions!.approve(ctx, {})).error, "missing_id");
    assert.equal((await agent.actions!.approve(ctx, { id: "nope" })).error, "not_found");
    const approved = await agent.actions!.approve(ctx, { id: draft.id });
    assert.equal(approved.ok, true);
    assert.deepEqual(created, [draft.id]);
    assert.equal(calls.length, callsBefore, "approving makes no network call");
    assert.equal((await agent.actions!.approve(ctx, { id: draft.id })).error, "already_decided");
    assert.equal((await agent.actions!.reject(ctx, { id: draft.id })).error, "already_decided");
    assert.equal((await agent.getStatus(ctx)).pendingApprovals, 0);
  });
});

test("site down and invalid TLS are critical; status stays honest", async () => {
  await withDir(async (dir) => {
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: failingFetch, dataDir: dir, now: () => NOW });
    const agent = createBlackRoomWebsiteAgent({ checkTls: goodTls, readAppEvents: async () => [] });
    const result = await agent.run(ctx, {});
    const report = result.report as BlackRoomWebsiteReport;
    assert.equal(report.reachable, false);
    assert.equal(report.issues[0].severity, "critical");
    assert.equal(report.issues[0].code, "site_down");
    assert.equal(report.uptime.percent, 0);
    const status = await agent.getStatus(ctx);
    assert.equal(status.label, "Web caida");

    const tlsFetch = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "CERT_HAS_EXPIRED" } }); }) as unknown as typeof fetch;
    const tlsCtx = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: tlsFetch, dataDir: dir, now: () => NOW });
    const tlsReport = (await agent.run(tlsCtx, {})).report as BlackRoomWebsiteReport;
    assert.equal(tlsReport.issues[0].code, "tls_invalid");

    const expiring = createBlackRoomWebsiteAgent({ checkTls: async () => ({ validTo: "2026-11-20T00:00:00.000Z", authorized: true }), readAppEvents: async () => [] });
    const okCtx = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: fakeFetch({ [SITE]: { status: 200, body: "<html><title>x</title></html>" } }, []), dataDir: dir, now: () => NOW });
    const expReport = (await expiring.run(okCtx, {})).report as BlackRoomWebsiteReport;
    assert.ok(expReport.issues.some((item) => item.code === "tls_expiring" && item.severity === "high"));
  });
});

test("bio links: admin credentials go only to the admin origin, expired/broken links reported", async () => {
  await withDir(async (dir) => {
    const calls: Call[] = [];
    const routes = {
      ...siteRoutes(),
      "https://blackroomus.com/api/admin/link-stats": { status: 200, type: "application/json", body: JSON.stringify({ links: [
        { id: 1, title: "Halloween Oct 31, 2026", url: "https://tickets.example/halloween", is_active: true },
        { id: 2, title: "Merch", url: "https://shop.example/dead", is_active: true },
        { id: 3, title: "Viejo", url: "https://x.example", is_active: false },
      ] }) },
      "https://blackroomus.com/api/admin/bio-elements": { status: 200, type: "application/json", body: JSON.stringify([
        { element_type: "countdown", title: "Halloween", is_active: true, metadata: { countdown_date: "2026-10-31T22:00" } },
      ]) },
      "https://tickets.example/halloween": { status: 200 },
      "https://shop.example/dead": { status: 410 },
    };
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: { BLACKROOM_ADMIN_API_KEY: "real-looking-key-123" }, fetch: fakeFetch(routes, calls), dataDir: dir, now: () => NOW });
    const agent = createBlackRoomWebsiteAgent({ checkTls: goodTls, readAppEvents: async () => [] });
    const report = (await agent.run(ctx, {})).report as BlackRoomWebsiteReport;
    assert.equal(report.bioLinks.checked, true);
    assert.equal(report.bioLinks.inactive, 1);
    const codes = report.issues.map((item) => item.code);
    assert.ok(codes.includes("bio_link_expired"));
    assert.ok(codes.includes("bio_link_broken"));
    assert.ok(codes.includes("countdown_expired"));
    for (const call of calls) {
      const hasKey = "X-API-Key" in call.headers;
      assert.equal(hasKey, call.url.startsWith("https://blackroomus.com/api/admin/"), `credential leak check for ${call.url}`);
    }
    assert.deepEqual((await agent.getStatus(ctx)).needs, []);
  });
});

test("admin redirects are never followed, so credentials never reach another host", async () => {
  await withDir(async (dir) => {
    const calls: Call[] = [];
    const routes = {
      ...siteRoutes(),
      "https://blackroomus.com/api/admin/link-stats": { status: 302, location: "http://evil.example/steal" },
      "http://evil.example/steal": { status: 200, type: "application/json", body: JSON.stringify({ links: [] }) },
    };
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: { BLACKROOM_ADMIN_API_KEY: "real-looking-key-123" }, fetch: fakeFetch(routes, calls), dataDir: dir, now: () => NOW });
    const agent = createBlackRoomWebsiteAgent({ checkTls: goodTls, readAppEvents: async () => [] });
    const report = (await agent.run(ctx, {})).report as BlackRoomWebsiteReport;
    assert.equal(report.bioLinks.checked, false);
    assert.ok(report.skipped.some((line) => /redirigio/.test(line)));
    assert.ok(!calls.some((call) => call.url.startsWith("http://evil.example")), "the redirect target is never requested");
    for (const call of calls) assert.equal("X-API-Key" in call.headers, call.url.startsWith("https://blackroomus.com/api/admin/"));
  });
});

test("read-only fetch guard refuses writes before the network", async () => {
  const calls: Call[] = [];
  const guarded = createReadOnlyWebsiteFetch(fakeFetch({ [SITE]: { status: 200 } }, calls));
  await assert.rejects(guarded(SITE, { method: "POST", body: "{}" }), /solo lectura/);
  await assert.rejects(guarded(SITE, { method: "DELETE" }), /solo lectura/);
  await assert.rejects(guarded(SITE, { method: "GET", body: "x" }), /solo lectura/);
  assert.equal(calls.length, 0);
  await guarded(SITE, { method: "HEAD" });
  assert.equal(calls.length, 1);
});

test("run validates maxPages and respects the crawl bound", async () => {
  await withDir(async (dir) => {
    const calls: Call[] = [];
    const ctx = createBlackRoomTeamContext("blackroom-website", { env: {}, fetch: fakeFetch(siteRoutes(), calls), dataDir: dir, now: () => NOW });
    const agent = createBlackRoomWebsiteAgent({ checkTls: goodTls, readAppEvents: async () => [] });
    assert.equal((await agent.run(ctx, { maxPages: 0 })).error, "invalid_max_pages");
    assert.equal((await agent.run(ctx, { maxPages: 99 })).error, "invalid_max_pages");
    const report = (await agent.run(ctx, { maxPages: 1, createDraft: false })).report as BlackRoomWebsiteReport;
    assert.equal(report.pagesCrawled, 1);
    assert.ok(report.skipped.some((line) => line.includes("paginas sin revisar")));
  });
});

test("browser hint links (preconnect to Google Fonts, stylesheets, icons) are not treated as links", () => {
  const html = `<head><link rel="preconnect" href="https://fonts.googleapis.com/"><link href="https://fonts.gstatic.com/" rel="preconnect" crossorigin><link rel="stylesheet" href="/app.css"><link rel="icon" href="/favicon.ico"></head><body><a href="https://tickets.example.com/e/1">Tickets</a></body>`;
  assert.deepEqual(extractLinks(html, "https://blackroomus.com/"), ["https://tickets.example.com/e/1"]);
});
