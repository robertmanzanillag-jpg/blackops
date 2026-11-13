import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBlackRoomTeamContext } from "../server/blackroom-team";
import competition, { type CompetitionReport } from "../server/blackroom-team/blackroom-competition";
import {
  isAllowedByRobots,
  parseCompetitorSeeds,
  parseJsonLdEvents,
  parseRobotsTxt,
  parseYoutubeFeed,
  safePublicUrl,
} from "../server/blackroom-team/blackroom-competition/parsers";
import { isPublicIpAddress, setCompetitionDnsLookupForTests } from "../server/blackroom-team/blackroom-competition";

const NOW = new Date("2026-11-12T15:00:00Z");
const RIVAL_CHANNEL = "UCaaaaaaaaaaaaaaaaaaaaaa";
const OWN_CHANNEL = "UCbbbbbbbbbbbbbbbbbbbbbb";

function feed(channelId: string, title: string, videos: Array<{ id: string; title: string; daysAgo: number; views: number }>): string {
  const entries = videos.map((video) => `<entry><id>yt:video:${video.id}</id><yt:videoId>${video.id}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${video.title}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${video.id}"/><published>${new Date(NOW.getTime() - video.daysAgo * 86400000).toISOString()}</published><media:group><media:community><media:starRating count="12" average="5.00" min="1" max="5"/><media:statistics views="${video.views}"/></media:community></media:group></entry>`).join("");
  return `<?xml version="1.0"?><feed><yt:channelId>${channelId}</yt:channelId><title>${title}</title>${entries}</feed>`;
}

const RIVAL_EVENTS_HTML = `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [
  { "@type": "MusicEvent", name: "Noche Reggaeton", startDate: "2026-11-21T03:00:00Z", url: "/eventos/noche", location: { "@type": "Place", name: "Club Rival" } },
  { "@type": "Event", name: "Fiesta pasada", startDate: "2026-10-01T03:00:00Z" },
] })}</script></head><body>Agenda</body></html>`;
const OWN_EVENTS_HTML = `<script type="application/ld+json">${JSON.stringify([{ "@type": "Event", name: "Black Room Friday", startDate: "2026-11-21T02:00:00Z" }])}</script>`;

type Call = { url: string; method: string; headers: Record<string, string>; credentials: unknown };

function fakeFetch(routes: Record<string, { status?: number; body: string; url?: string; location?: string } | "fail">) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: String(init.method ?? "GET"), headers: { ...(init.headers as Record<string, string>) }, credentials: init.credentials });
    const route = routes[url];
    if (route === "fail" || route === undefined) {
      if (route === undefined) return new Response("", { status: 404 });
      throw new TypeError("fetch failed");
    }
    const response = route.location
      ? new Response(null, { status: route.status ?? 302, headers: { location: route.location } })
      : new Response(route.body, { status: route.status ?? 200 });
    if (route.url) Object.defineProperty(response, "url", { value: route.url });
    return response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function withDir<T>(work: (dataDir: string, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "br-competition-"));
  try {
    return await work(path.join(root, "team"), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function ctxFor(dataDir: string, env: Record<string, string>, fetchImpl: typeof fetch, now = NOW) {
  return createBlackRoomTeamContext("blackroom-competition", { dataDir, env: { BLACKROOM_COMPETITION_REQUEST_GAP_MS: "0", ...env }, fetch: fetchImpl, now: () => now, userId: "robert" });
}

const HAPPY_ROUTES = {
  [`https://www.youtube.com/feeds/videos.xml?channel_id=${RIVAL_CHANNEL}`]: { body: feed(RIVAL_CHANNEL, "Club Rival", [
    { id: "aaaaaaaaaa1", title: "Aftermovie sold out", daysAgo: 2, views: 9000 },
    { id: "aaaaaaaaaa2", title: "DJ set corto", daysAgo: 5, views: 1200 },
    { id: "aaaaaaaaaa3", title: "Anuncio line-up", daysAgo: 9, views: 3000 },
    { id: "aaaaaaaaaa4", title: "Behind the scenes", daysAgo: 20, views: 800 },
  ]) },
  [`https://www.youtube.com/feeds/videos.xml?channel_id=${OWN_CHANNEL}`]: { body: feed(OWN_CHANNEL, "Black Room", [
    { id: "bbbbbbbbbb1", title: "Black Room recap", daysAgo: 3, views: 500 },
    { id: "bbbbbbbbbb2", title: "Black Room DJ", daysAgo: 25, views: 700 },
  ]) },
  "https://clubrival.com/robots.txt": { body: "User-agent: *\nDisallow: /privado\n" },
  "https://clubrival.com/eventos": { body: RIVAL_EVENTS_HTML },
  "https://clubrival.com/": { body: "<html>sin eventos</html>" },
  "https://blackroom.example-venue.com/robots.txt": { status: 404, body: "" },
  "https://blackroom.example-venue.com/": { body: OWN_EVENTS_HTML },
} as const;

const HAPPY_ENV = {
  BLACKROOM_COMPETITORS: `Club Rival|${RIVAL_CHANNEL}|https://clubrival.com/|https://clubrival.com/eventos`,
  BLACKROOM_YOUTUBE_CHANNEL_ID: OWN_CHANNEL,
  BLACKROOM_WEBSITE_URL: "https://blackroom.example-venue.com/",
};

test("blocked with the exact need when there are no competitors (env empty, fetch fails, no data)", async () => {
  await withDir(async (dataDir) => {
    const { impl, calls } = fakeFetch({});
    const failing = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    const ctx = createBlackRoomTeamContext("blackroom-competition", { dataDir, env: {}, fetch: failing, now: () => NOW, userId: null });
    const status = await competition.getStatus(ctx);
    assert.equal(status.state, "blocked");
    assert.match(status.needs[0], /BLACKROOM_COMPETITORS/);
    const result = await competition.run(ctx, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "blocked_no_competitors");
    assert.equal(calls.length, 0);
    void impl;
  });
});

test("happy path: public RSS + JSON-LD events, comparison vs Black Room, persisted and working", async () => {
  await withDir(async (dataDir, root) => {
    await mkdir(path.join(root, "agent"), { recursive: true });
    await writeFile(path.join(root, "agent", "organic-peer-hypotheses.json"), JSON.stringify({ evaluatedAt: "2026-11-12T00:00:00Z", brands: [{ brand: "blackroom", status: "insufficient_evidence", proposal: null }] }));
    const { impl, calls } = fakeFetch(HAPPY_ROUTES as never);
    const ctx = ctxFor(dataDir, HAPPY_ENV, impl);
    assert.equal((await competition.getStatus(ctx)).state, "available");

    const result = await competition.run(ctx, {});
    assert.equal(result.ok, true, result.summary);
    assert.equal(result.needsApproval, undefined, "reports never create outward actions");
    const report = result.report as CompetitionReport;
    assert.equal(report.mayPublish, false);
    const rival = report.competitors[0];
    assert.equal(rival.name, "Club Rival");
    assert.equal(rival.youtube?.medianViews, 2100);
    assert.equal(rival.youtube?.postsPerWeek, 1);
    assert.equal(rival.youtube?.topVideos[0].title, "Aftermovie sold out");
    assert.deepEqual(rival.upcomingEvents.map((event) => event.name), ["Noche Reggaeton"]);
    assert.equal(rival.upcomingEvents[0].url, "https://clubrival.com/eventos/noche");
    assert.equal(report.blackroom.youtube?.medianViews, 600);
    assert.equal(report.bestContent[0].views, 9000);
    assert.ok(report.takeaways.some((line) => /Choque de fechas con Club Rival: 2026-11-21/.test(line)), report.takeaways.join("\n"));
    assert.ok(report.takeaways.some((line) => /mediana de vistas mas alta/.test(line)));
    assert.ok(report.takeaways.some((line) => /Scout organico/.test(line)));
    assert.match(result.summary, /Conclusiones/);

    // Robots.txt checked once per host and before the page.
    assert.equal(calls.filter((call) => call.url === "https://clubrival.com/robots.txt").length, 1);
    assert.ok(calls.findIndex((call) => call.url.endsWith("/robots.txt")) < calls.findIndex((call) => call.url === "https://clubrival.com/eventos"));

    const saved = JSON.parse(await readFile(path.join(dataDir, "blackroom-competition.json"), "utf8"));
    assert.equal(saved.lastRunOk, true);
    const status = await competition.getStatus(ctx);
    assert.equal(status.state, "working");
    assert.equal(status.lastRunAt, NOW.toISOString());
    assert.equal(status.metrics?.eventosProximos, 1);

    // Rate limit: a second run within 6h reuses the report without network.
    const before = calls.length;
    const again = await competition.run(ctx, {});
    assert.equal(again.ok, true);
    assert.equal(calls.length, before);

    // Old evidence reads as available, not working.
    const later = ctxFor(dataDir, HAPPY_ENV, impl, new Date(NOW.getTime() + 30 * 3600_000));
    assert.equal((await competition.getStatus(later)).state, "available");
  });
});

test("safety: only public GETs, no credentials, robots.txt disallow and login redirects respected", async () => {
  await withDir(async (dataDir) => {
    const { impl, calls } = fakeFetch({
      "https://rival-a.com/robots.txt": { body: "User-agent: *\nDisallow: /\n" },
      "https://rival-b.com/robots.txt": { body: "" },
      "https://rival-b.com/agenda": { body: "", location: "https://rival-b.com/login?next=/agenda" },
    });
    const ctx = ctxFor(dataDir, { BLACKROOM_COMPETITORS: "Rival A|https://rival-a.com/agenda, Rival B|https://rival-b.com/agenda" }, impl);
    const result = await competition.run(ctx, { force: true });
    assert.equal(result.ok, false, "nothing readable means the run is not ok");
    const report = result.report as CompetitionReport;
    assert.equal(report.competitors[0].sources[0].status, "skipped");
    assert.match(report.competitors[0].sources[0].detail, /robots/);
    assert.match(report.competitors[1].sources[0].detail, /iniciar sesion/);
    assert.ok(!calls.some((call) => call.url === "https://rival-a.com/agenda"), "disallowed page is never fetched");
    for (const call of calls) {
      assert.equal(call.method, "GET");
      assert.equal(call.credentials, "omit");
      assert.ok(!Object.keys(call.headers).some((key) => /authorization|cookie/i.test(key)));
      assert.match(call.url, /^https:\/\//);
    }
    const status = await competition.getStatus(ctx);
    assert.equal(status.state, "blocked", "failed sources are reported honestly, never as working");
    assert.ok(status.needs.length > 0);
  });
});

test("network failures make the agent blocked after a run, not working", async () => {
  await withDir(async (dataDir) => {
    const failing = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    const ctx = ctxFor(dataDir, { BLACKROOM_COMPETITORS: `Club Rival|${RIVAL_CHANNEL}` }, failing);
    const result = await competition.run(ctx, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "no_public_sources_responded");
    const status = await competition.getStatus(ctx);
    assert.equal(status.state, "blocked");
  });
});

test("add/remove/list competitors persist and reject unsafe URLs", async () => {
  await withDir(async (dataDir) => {
    const { impl, calls } = fakeFetch({});
    const ctx = ctxFor(dataDir, { BLACKROOM_COMPETITORS: "Seed Club|https://seedclub.com" }, impl);
    for (const bad of ["http://insecure.com", "https://localhost/x", "https://10.0.0.1/", "https://user:pw@site.com/", "https://site.com/login", "https://site.com:8443/"]) {
      const result = await competition.actions!["add-competitor"](ctx, { name: "Malo", websiteUrl: bad });
      assert.equal(result.ok, false, bad);
    }
    assert.equal((await competition.actions!["add-competitor"](ctx, { name: "Sin fuente" })).error, "missing_source");
    const added = await competition.actions!["add-competitor"](ctx, { name: "Fiesta Nueva", youtubeChannelId: RIVAL_CHANNEL });
    assert.equal(added.ok, true);
    let list = (await competition.actions!["list-competitors"](ctx, {})).report as { competitors: Array<{ id: string }> };
    assert.deepEqual(list.competitors.map((item) => item.id), ["seed-club", "fiesta-nueva"]);
    assert.equal((await competition.actions!["remove-competitor"](ctx, { id: "seed-club" })).ok, true);
    assert.equal((await competition.actions!["remove-competitor"](ctx, { id: "fiesta-nueva" })).ok, true);
    list = (await competition.actions!["list-competitors"](ctx, {})).report as { competitors: Array<{ id: string }> };
    assert.deepEqual(list.competitors, []);
    assert.equal((await competition.getStatus(ctx)).state, "blocked");
    assert.equal((await competition.actions!.report(ctx, {})).ok, false);
    assert.equal(calls.length, 0, "config actions never touch the network");
  });
});

test("parsers: seeds, robots, feed and JSON-LD", () => {
  assert.deepEqual(parseCompetitorSeeds(`A|${RIVAL_CHANNEL}|https://a.com, https://b.com/, ,A`).map((c) => [c.id, c.youtubeChannelId, c.websiteUrl]), [
    ["a", RIVAL_CHANNEL, "https://a.com/"],
    ["b-com", null, "https://b.com/"],
  ]);
  const rules = parseRobotsTxt("User-agent: googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /eventos\nAllow: /eventos/publicos\n");
  assert.equal(isAllowedByRobots(rules, "https://x.com/eventos/privados"), false);
  assert.equal(isAllowedByRobots(rules, "https://x.com/eventos/publicos/1"), true);
  assert.equal(isAllowedByRobots(rules, "https://x.com/"), true);
  const parsed = parseYoutubeFeed(feed(RIVAL_CHANNEL, "R &amp; B", [{ id: "aaaaaaaaaa1", title: "Hola &amp; adios", daysAgo: 1, views: 5 }]));
  assert.equal(parsed.channelTitle, "R & B");
  assert.equal(parsed.videos[0].title, "Hola & adios");
  assert.equal(parsed.videos[0].views, 5);
  assert.equal(parseJsonLdEvents('<script type="application/ld+json">{bad json</script>', "https://x.com").length, 0);
  assert.equal(safePublicUrl("https://ok.com/agenda?x=1"), "https://ok.com/agenda?x=1");
  assert.equal(safePublicUrl("https://ok.com/?token=abc"), null);
});

test("redirects to internal or non-https targets are never followed (SSRF)", async () => {
  await withDir(async (dataDir) => {
    const { impl, calls } = fakeFetch({
      "https://rival-a.com/robots.txt": { body: "" },
      "https://rival-a.com/agenda": { body: "", location: "http://169.254.169.254/latest/meta-data/" },
      "https://rival-b.com/robots.txt": { body: "" },
      "https://rival-b.com/agenda": { body: "", location: "https://127.0.0.1:8080/admin" },
      "https://rival-c.com/robots.txt": { body: "" },
      "https://rival-c.com/agenda": { body: "", location: "https://rival-c.com/a" },
      "https://rival-c.com/a": { body: "", location: "https://rival-c.com/b" },
      "https://rival-c.com/b": { body: "", location: "https://rival-c.com/c" },
      "https://rival-c.com/c": { body: "", location: "https://rival-c.com/d" },
      "https://rival-c.com/d": { body: RIVAL_EVENTS_HTML },
    });
    const ctx = ctxFor(dataDir, { BLACKROOM_COMPETITORS: "Rival A|https://rival-a.com/agenda, Rival B|https://rival-b.com/agenda, Rival C|https://rival-c.com/agenda" }, impl);
    const result = await competition.run(ctx, { force: true });
    const report = result.report as CompetitionReport;
    assert.match(report.competitors[0].sources[0].detail, /redireccion a un destino no permitido/);
    assert.match(report.competitors[1].sources[0].detail, /redireccion a un destino no permitido/);
    assert.match(report.competitors[2].sources[0].detail, /demasiadas redirecciones/);
    assert.ok(!calls.some((call) => /169\.254|127\.0\.0\.1|rival-c\.com\/d$/.test(call.url)), "internal targets and the 4th hop are never requested");
  });
});

test("hosts whose DNS answer is private are refused before any request", async () => {
  await withDir(async (dataDir) => {
    const { impl, calls } = fakeFetch({
      "https://rival-a.com/robots.txt": { body: "" },
      "https://rival-a.com/agenda": { body: RIVAL_EVENTS_HTML },
    });
    setCompetitionDnsLookupForTests(async () => [{ address: "10.0.0.5", family: 4 }]);
    try {
      const ctx = ctxFor(dataDir, { BLACKROOM_COMPETITORS: "Rival A|https://rival-a.com/agenda" }, impl);
      const result = await competition.run(ctx, { force: true });
      assert.equal(result.ok, false);
      assert.equal(calls.length, 0);
    } finally {
      setCompetitionDnsLookupForTests(null);
    }
    for (const bad of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      assert.equal(isPublicIpAddress(bad), false, bad);
    }
    assert.equal(isPublicIpAddress("8.8.8.8"), true);
    assert.equal(isPublicIpAddress("2606:4700::1111"), true);
  });
});

test("large pages are read with a cap, not buffered whole", async () => {
  await withDir(async (dataDir) => {
    const huge = RIVAL_EVENTS_HTML + "x".repeat(3_000_000);
    const { impl } = fakeFetch({
      "https://rival-a.com/robots.txt": { body: "" },
      "https://rival-a.com/agenda": { body: huge },
    });
    const ctx = ctxFor(dataDir, { BLACKROOM_COMPETITORS: "Rival A|https://rival-a.com/agenda" }, impl);
    const result = await competition.run(ctx, { force: true });
    const report = result.report as CompetitionReport;
    assert.equal(report.competitors[0].sources[0].status, "ok");
    assert.equal(report.competitors[0].upcomingEvents.length, 1);
  });
});
