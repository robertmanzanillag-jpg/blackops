import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { detectLocalNewsSensitiveContent } from "../server/clippers-local-news-review-committee";
import { __clipperLocalNewsInternals, bootstrapClipperLocalNews, getClipperLocalNewsStatus, ingestClipperLocalNewsEvents, normalizeClipperLocalNewsEvent, recordClipperLocalNewsMetrics, runClipperLocalNewsCycle } from "../server/clippers-local-news-agent";
import { LocalNewsTranslator } from "../server/clippers-local-news-translation";

async function fixture(t: test.TestContext) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "local-news-agent-"));
  t.after(() => rm(workspaceDir, { recursive: true, force: true }));
  return workspaceDir;
}

const event = { sourceEventId: "nws-1", source: "NWS Miami", sourceUrl: "https://weather.gov/example", lane: "miami-news" as const, title: "Flood Watch", description: "Heavy rain is possible.", location: "Miami-Dade", severity: "Moderate", urgency: "Expected" };

test("X weighting charges Unicode punctuation and emoji while treating a URL as 23", () => {
  assert.equal(__clipperLocalNewsInternals.xWeightedLength("A…😀 https://example.com/very/long/path"), 29);
});

test("hot-topic classifier prioritizes violent crime, kidnapping, and immigration over routine local noise", () => {
  const immigration = normalizeClipperLocalNewsEvent({
    sourceEventId: "ice-1",
    source: "Official immigration newsroom",
    sourceUrl: "https://www.ice.gov/newsroom/example",
    lane: "miami-news",
    title: "ICE announces immigration detention operation",
    description: "Officials released a verified update about detention and deportation proceedings.",
    eventType: "Immigration enforcement",
  });
  const kidnapping = normalizeClipperLocalNewsEvent({
    sourceEventId: "kidnap-1",
    source: "Official police newsroom",
    sourceUrl: "https://www.nyc.gov/police/example",
    lane: "ny-news",
    title: "Police seek suspect in kidnapping investigation",
    description: "Detectives released a verified public safety bulletin.",
    eventType: "Kidnapping",
  });
  const traffic = normalizeClipperLocalNewsEvent({
    sourceEventId: "traffic-1",
    source: "Road authority",
    sourceUrl: "https://www.transportation.gov/example",
    lane: "miami-news",
    title: "Routine traffic congestion reported",
    description: "Drivers should expect a normal weekday delay.",
    eventType: "Traffic",
  });
  assert.equal(immigration.section, "public_safety");
  assert.equal(immigration.topicTag, "immigration");
  assert.equal(kidnapping.topicTag, "kidnapping");
  assert.ok(immigration.editorialPriority > traffic.editorialPriority);
  assert.ok(kidnapping.editorialPriority > traffic.editorialPriority);
});

test("offline OPUS adapter produces substantive Spanish and English in the same social post", async (t) => {
  const workspaceDir = await fixture(t);
  const translations = new Map([
    ["Flood Watch", "Vigilancia de inundaciones"],
    ["Heavy rain is possible.", "Es posible que llueva intensamente."],
    ["Review the official source before taking action.", "Consulta la fuente oficial antes de actuar."],
  ]);
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async (input) => translations.get(input) || `Traducción: ${input}` } });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { NODE_ENV: "production" }, translator, events: [event] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const facebook = queue.find((item: any) => item.platform === "facebook");
  const x = queue.find((item: any) => item.platform === "x");
  assert.match(facebook.copy, /Vigilancia de inundaciones/);
  assert.match(facebook.copy, /Es posible que llueva intensamente/);
  assert.match(facebook.copy, /Flood Watch/);
  assert.match(facebook.copy, /Heavy rain is possible/);
  assert.match(x.copy, /Vigilancia de inundaciones/);
  assert.ok(queue.every((item: any) => item.evidence.includes("local_translation=verified")));
});

test("translation input is capped before the hosted request to bound cost and latency", async (t) => {
  const workspaceDir = await fixture(t);
  let captured: string[] = [];
  const translator = new LocalNewsTranslator({
    enabled: true,
    adapter: {
      translate: async () => "La fuente oficial publicó una actualización.",
      translateBatch: async (inputs) => {
        captured = inputs;
        return [
          "Alerta oficial para la comunidad.",
          "La carretera está cerrada por una investigación policial.",
          "Consulta la fuente oficial antes de actuar.",
        ];
      },
    },
  });
  await ingestClipperLocalNewsEvents({
    workspaceDir,
    now: "2026-07-21T12:00:00Z",
    env: { NODE_ENV: "production" },
    translator,
    events: [{
      ...event,
      title: `The official public safety alert ${"update ".repeat(100)}`,
      description: "The road is closed for a police investigation. ".repeat(100),
      instruction: "Review the official source before taking action. ".repeat(100),
    }],
  });

  assert.equal(captured.length, 3);
  assert.ok(captured[0].length <= 500);
  assert.ok(captured[1].length <= 700);
  assert.ok(captured[2].length <= 700);
});

test("offline translation integrity failure quarantines both platforms", async (t) => {
  const workspaceDir = await fixture(t);
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async (input) => input.replace("I-95", "I-94") } });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { NODE_ENV: "production" }, translator, events: [{ ...event, title: "Crash closes I-95", description: "Two lanes closed on I-95." }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.every((item: any) => item.status === "quarantined" && item.autoEligible === false && item.reasons.includes("local_translation_integrity_failed")));
});

test("offline translation quarantines added routes and times", async (t) => {
  const workspaceDir = await fixture(t);
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async (input) => `Traducción de ${input} I-75 a las 9:30.` } });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { NODE_ENV: "production" }, translator, events: [{ ...event, title: "Crash closes I-95", description: "Two lanes closed on I-95 at 8:30." }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.every((item: any) => item.status === "quarantined" && item.reasons.includes("local_translation_integrity_failed")));
});

test("temporary offline model failure retries on the next duplicate cycle", async (t) => {
  const workspaceDir = await fixture(t);
  let available = false;
  const translations = new Map([
    ["Flood Watch", "Vigilancia de inundaciones"],
    ["Heavy rain is possible.", "Es posible que llueva intensamente."],
    ["Review the official source before taking action.", "Consulta la fuente oficial antes de actuar."],
  ]);
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async (input) => {
    if (!available) throw new Error("model_download_pending");
    return translations.get(input) || `Traducción: ${input}`;
  } } });
  const options = { workspaceDir, env: { NODE_ENV: "production" }, translator, events: [event] };
  await ingestClipperLocalNewsEvents({ ...options, now: "2026-07-21T12:00:00Z" });
  let queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.every((item: any) => item.reasons.includes("local_translation_unavailable") && item.autoEligible === false));
  available = true;
  await ingestClipperLocalNewsEvents({ ...options, now: "2026-07-21T12:05:00Z" });
  queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.every((item: any) => item.autoEligible === true && item.evidence.includes("local_translation=verified")));
});

test("production cannot bypass required bilingual translation with an off flag", async (t) => {
  const workspaceDir = await fixture(t);
  const translator = new LocalNewsTranslator({ enabled: false });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { NODE_ENV: "production", CLIPPERS_LOCAL_NEWS_LOCAL_TRANSLATION: "false" }, translator, events: [event] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.every((item: any) => item.status === "quarantined" && item.autoEligible === false));
});

test("unknown source language is quarantined instead of labeling Spanish as English", async (t) => {
  const workspaceDir = await fixture(t);
  let calls = 0;
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async () => { calls += 1; return "Alerta vial local"; } } });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { NODE_ENV: "production" }, translator, events: [{ ...event, title: "Aviso vial", description: "Zona centro", instruction: "Cuidado" }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(calls, 0);
  assert.ok(queue.every((item: any) => item.status === "quarantined" && item.autoEligible === false && item.reasons.includes("local_translation_integrity_failed")));
  assert.ok(queue.every((item: any) => item.evidence.some((entry: string) => entry.includes("source_language_unknown"))));
});

test("mixed-language source fields are quarantined before translation", async (t) => {
  const workspaceDir = await fixture(t);
  let calls = 0;
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async () => { calls += 1; return "Traducción inesperada"; } } });
  await ingestClipperLocalNewsEvents({
    workspaceDir,
    now: "2026-07-21T12:00:00Z",
    env: { NODE_ENV: "production" },
    translator,
    events: [{ ...event, title: "Choque cierra I-95", description: "The road is closed after a major crash.", instruction: "Review the official source before taking action." }],
  });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(calls, 0);
  assert.ok(queue.every((item: any) => item.status === "quarantined" && item.autoEligible === false));
  assert.ok(queue.every((item: any) => item.evidence.some((entry: string) => entry.includes("source_field_language_mismatch:title:es"))));
});

test("Spanish events with missing fields use Spanish source fallbacks before translation", async (t) => {
  const workspaceDir = await fixture(t);
  const translations = new Map([
    ["Choque cierra I-95", "Crash closes I-95"],
    ["La fuente oficial no proporcionó detalles adicionales.", "The official source provided no additional detail."],
    ["Consulta la fuente oficial antes de actuar.", "Review the official source before taking action."],
  ]);
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async (input) => translations.get(input) || "" } });
  await ingestClipperLocalNewsEvents({
    workspaceDir,
    now: "2026-07-21T12:00:00Z",
    env: { NODE_ENV: "production" },
    translator,
    events: [{ ...event, title: "Choque cierra I-95", description: "", instruction: "" }],
  });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const facebook = queue.find((item: any) => item.platform === "facebook");
  assert.ok(queue.every((item: any) => item.status === "auto_eligible" && item.evidence.includes("local_translation=verified")));
  assert.match(facebook.copy, /La fuente oficial no proporcionó detalles adicionales\./);
  assert.match(facebook.copy, /The official source provided no additional detail\./);
});

test("bootstrap creates all artifacts and clamps schedule to 2-5 minutes", async (t) => {
  const workspaceDir = await fixture(t);
  const status = await bootstrapClipperLocalNews({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES: "99" } });
  assert.equal(status.bootstrapped, true);
  assert.equal(status.scheduleMinutes, 5);
  for (const artifact of Object.values(status.artifacts)) assert.ok((await readFile(artifact, "utf8")).length > 0);
  const runbook = await readFile(status.artifacts.runbook, "utf8");
  assert.match(runbook, /gpt-5\.4-nano/);
  assert.match(runbook, /10-request\/minute ceiling/);
  assert.doesNotMatch(runbook, /OPUS-MT|no API or membership cost/);
  const publicSnapshot = JSON.parse(await readFile(path.join(workspaceDir, "public-news-snapshot.json"), "utf8"));
  assert.deepEqual(publicSnapshot, { version: 1, updatedAt: "2026-07-21T12:00:00.000Z", events: [], queue: [] });
});

test("compact public snapshot balances Miami and New York candidates", async (t) => {
  const workspaceDir = await fixture(t);
  const now = "2026-07-21T12:00:00Z";
  const events = Array.from({ length: 20 }, (_, index) => ({
    ...event,
    id: `balanced-${index}`,
    lane: index < 18 ? "ny-news" as const : "miami-news" as const,
    title: `Official local update ${index}`,
  }));
  await ingestClipperLocalNewsEvents({ workspaceDir, now, events });
  const snapshot = JSON.parse(await readFile(path.join(workspaceDir, "public-news-snapshot.json"), "utf8"));
  assert.ok(snapshot.queue.some((item: any) => item.lane === "miami-news"));
  assert.ok(snapshot.queue.some((item: any) => item.lane === "ny-news"));
  const firstFourLanes = snapshot.queue.slice(0, 4).map((item: any) => item.lane);
  assert.deepEqual(firstFourLanes, ["miami-news", "ny-news", "miami-news", "ny-news"]);
});

test("stable dedupe, updates and resolution create one revision per change", async (t) => {
  const workspaceDir = await fixture(t);
  const first = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [event] });
  assert.deepEqual({ created: first.created, queued: first.queued }, { created: 1, queued: 2 });
  const duplicate = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:01:00Z", events: [event] });
  assert.equal(duplicate.duplicates, 1);
  assert.equal(duplicate.queued, 0);
  const update = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:02:00Z", events: [{ ...event, description: "Road flooding reported." }] });
  assert.equal(update.updated, 1);
  assert.equal(update.queued, 2);
  const resolution = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:03:00Z", events: [{ ...event, description: "Road flooding reported.", status: "resolved" }] });
  assert.equal(resolution.resolved, 1);
  assert.equal(resolution.status.events.resolved, 1);
  assert.equal(resolution.status.queue.total, 6);
});

test("risk gate blocks critical events and copy stays platform-specific", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE: "true" }, events: [{ ...event, title: "Hurricane Warning", severity: "Extreme", description: "Evacuate immediately. ".repeat(40) }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(queue.length, 2);
  assert.ok(queue.every((item: any) => item.status === "quarantined" && item.publishDecision === "quarantine" && item.published === false));
  const x = queue.find((item: any) => item.platform === "x");
  const facebook = queue.find((item: any) => item.platform === "facebook");
  assert.ok(__clipperLocalNewsInternals.xWeightedLength(x.copy) <= 280);
  assert.notEqual(x.copy, facebook.copy);
  assert.match(x.copy, /Fuente \/ Source: https:\/\/weather.gov\/example/);
  assert.match(facebook.copy, /Fuente oficial \/ Official source: NWS Miami/);
  assert.equal(facebook.textOnly, true);
  assert.equal(facebook.mediaRequired, false);
  assert.match(facebook.copy, /Actualización oficial .* a las .*E[DS]T/);
  assert.doesNotMatch(facebook.copy, /EXTRACTO ORIGINAL|Evacuate immediately\. Evacuate immediately/);
});

test("X keeps both languages and a valid source when the official URL is unusually long", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { PUBLIC_BASE_URL: "https://metrocurrent.example" }, events: [{
    ...event,
    sourceEventId: "long-url-1",
    sourceUrl: `https://weather.gov/${"official-update-".repeat(30)}`,
  }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const x = queue.find((item: any) => item.platform === "x");
  assert.ok(__clipperLocalNewsInternals.xWeightedLength(x.copy) <= 280);
  assert.match(x.copy, /^ES —/);
  assert.match(x.copy, /\nEN —/);
  assert.match(x.copy, new RegExp(`Fuente / Source: https://weather\\.gov/${"official-update-".repeat(30)}`));
  assert.doesNotMatch(x.copy, /metrocurrent\.example/);
});

test("X preserves an exact long official source using X weighted URL length", async (t) => {
  const workspaceDir = await fixture(t);
  const oversizedHost = `${"a".repeat(50)}.${"b".repeat(50)}.${"c".repeat(50)}.gov`;
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [{
    ...event,
    sourceEventId: "oversized-host-1",
    sourceUrl: `https://${oversizedHost}/official-update`,
    title: "Person charged after investigation",
  }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const x = queue.find((item: any) => item.platform === "x");
  assert.match(x.copy, new RegExp(`Fuente / Source: https://${oversizedHost}/official-update`));
  assert.ok(__clipperLocalNewsInternals.xWeightedLength(x.copy) <= 280);
});

test("low and medium events default to auto eligible, opt-out requires approval, and road closed remains active", async (t) => {
  const automaticWorkspace = await fixture(t);
  const automatic = await ingestClipperLocalNewsEvents({ workspaceDir: automaticWorkspace, now: "2026-07-21T12:00:00Z", events: [{ ...event, status: "closed" }] });
  assert.equal(automatic.status.events.active, 1);
  assert.equal(automatic.status.queue.autoEligible, 2);
  assert.equal(automatic.status.queue.approvalRequired, 0);

  const optedOutWorkspace = await fixture(t);
  const optedOut = await ingestClipperLocalNewsEvents({ workspaceDir: optedOutWorkspace, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE: "false" }, events: [event] });
  assert.equal(optedOut.status.queue.autoEligible, 0);
  assert.equal(optedOut.status.queue.approvalRequired, 2);
});

test("NWS sources target Miami and NYC coordinates instead of statewide alerts", () => {
  const configured = __clipperLocalNewsInternals.sources({});
  assert.equal(configured.find((source) => source.id === "nws-miami")?.url, "https://api.weather.gov/alerts/active?point=25.7617,-80.1918");
  assert.equal(configured.find((source) => source.id === "nws-nyc")?.url, "https://api.weather.gov/alerts/active?point=40.7128,-74.0060");
  assert.ok(configured.every((source) => !/[?&]area=(FL|NY)/.test(source.url)));
});

test("hot-news mode fetches official public-safety sources and leaves traffic connectors disabled by default", async (t) => {
  const workspaceDir = await fixture(t);
  const requested: string[] = [];
  const fetcher = async (url: string | URL | Request) => {
    const requestedUrl = String(url);
    requested.push(requestedUrl);
    if (requestedUrl.includes("service-updates.page")) return new Response('<service-updates apikey="public-runtime-key"></service-updates>', { status: 200, headers: { "content-type": "text/html" } });
    if (requestedUrl.includes("api/serviceupdates")) return new Response(JSON.stringify({ universal: [], metrorail: [], metrobus: [], metromover: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const cycle = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:00:00Z", env: {}, fetch: fetcher as typeof fetch });
  assert.equal(requested.length, 9);
  assert.ok(requested.every((url) => url !== "https://feeds.everbridge.net/feeds/453003085617722/rss/rss.xml"));
  assert.ok(requested.every((url) => !url.includes("subway-alerts.json")));
  assert.ok(requested.some((url) => url === "https://www.fbi.gov/feeds/new-york-news/rss.xml"));
  assert.ok(requested.some((url) => url === "https://www.fbi.gov/feeds/miami-news/rss.xml"));
  assert.ok(requested.some((url) => url.includes("justice.gov/news/rss?field_component=1981")));
  assert.ok(requested.some((url) => url.includes("justice.gov/news/rss?field_component=1771")));
  assert.ok(requested.some((url) => url === "https://www.miamidade.gov/global/rss-news.page"));
  assert.ok(requested.some((url) => url === "https://www.sheriff.org/pio/breaking-news/"));
  assert.ok(requested.every((url) => !url.includes("api/serviceupdates")));
  assert.ok(requested.some((url) => url.includes("news.miami-airport.com/tagfeed")));
  assert.equal(requested.filter((url) => url.includes("Road_Closures/FeatureServer")).length, 0);
  const ny511 = cycle.status.connectors.find((connector) => connector.id === "ny511");
  const fl511 = cycle.status.connectors.find((connector) => connector.id === "fl511");
  assert.deepEqual({ configured: ny511?.configured, requiresKey: ny511?.requiresKey }, { configured: false, requiresKey: true });
  assert.equal(fl511?.configured, false);
  assert.equal(cycle.status.connectors.find((connector) => connector.id === "notify-nyc")?.configured, false);
  assert.equal(cycle.status.connectors.find((connector) => connector.id === "mta-subway-alerts"), undefined);
  assert.equal(cycle.status.connectors.find((connector) => connector.id === "miami-dade-transit"), undefined);
  assert.equal(cycle.status.connectors.find((connector) => connector.id === "mia-airport-news")?.configured, true);
  assert.equal(cycle.status.connectors.find((connector) => connector.id === "fhp-miami-dade")?.configured, false);
  assert.equal(cycle.status.coverage.miamiTraffic, "not_configured");
  assert.equal(cycle.status.coverage.nyTraffic, "not_configured");
});

test("Broward Sheriff official breaking-news page supplies recent hot Miami-lane stories", () => {
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "broward-sheriff-breaking");
  assert.ok(source);
  const html = `<script>let allNewsItems = [
    {"Item":{"Url":"/pio/breaking-news/detectives-investigate-fatal-shooting/","Name":"DETECTIVES INVESTIGATE FATAL SHOOTING"},"NewsPublishedDate":"08/24/2026","NewsPublishedTime":"01:00 PM"},
    {"Item":{"Url":"https://attacker.example/fake-release/","Name":"SPOOFED RELEASE"},"NewsPublishedDate":"08/24/2026","NewsPublishedTime":"01:00 PM"},
    {"Item":{"Url":"/pio/breaking-news/old-release/","Name":"OLD RELEASE"},"NewsPublishedDate":"08/01/2026","NewsPublishedTime":"01:00 PM"}
  ];</script>`;
  const events = __clipperLocalNewsInternals.browardSheriffBreakingEvents(html, source, "2026-08-26T12:00:00Z");
  assert.equal(events.length, 1);
  assert.deepEqual({ lane: events[0].lane, source: events[0].source, title: events[0].title, location: events[0].location }, {
    lane: "miami-news",
    source: "Broward Sheriff's Office",
    title: "DETECTIVES INVESTIGATE FATAL SHOOTING",
    location: "Broward County",
  });
  assert.equal(events[0].sourceUrl, "https://www.sheriff.org/pio/breaking-news/detectives-investigate-fatal-shooting/");
});

test("real-cycle intake recovers blocked official feeds and keeps only high-interest non-traffic news", async (t) => {
  const workspaceDir = await fixture(t);
  const emptyRss = "<rss><channel></channel></rss>";
  const fallbackCalls: string[] = [];
  const result = await runClipperLocalNewsCycle({
    workspaceDir,
    now: "2026-08-24T12:00:00Z",
    env: { NODE_ENV: "test", CLIPPERS_LOCAL_NEWS_LOCAL_TRANSLATION: "false" },
    fetch: (async (input) => {
      const url = String(input);
      if (url.includes("fbi.gov/feeds/")) return new Response("blocked", { status: 403 });
      if (url.includes("field_component=1981")) return new Response(`<rss><channel><item><guid>sdny-hot</guid><title>Queens murder defendant sentenced to federal prison</title><description>The defendant was sentenced after a violent robbery case.</description><link>https://www.justice.gov/usao-sdny/pr/queens-murder-defendant-sentenced</link><pubDate>Thu, 20 Aug 2026 14:00:00 GMT</pubDate></item></channel></rss>`);
      if (url.includes("field_component=1771")) return new Response(`<rss><channel><item><guid>sdfl-hot</guid><title>Ten defendants sentenced in South Florida cocaine trafficking conspiracy</title><description>Federal prosecutors announced prison sentences in a cartel-linked cocaine case.</description><link>https://www.justice.gov/usao-sdfl/pr/ten-defendants-sentenced-south-florida-cocaine-trafficking-conspiracy</link><pubDate>Thu, 20 Aug 2026 14:00:00 GMT</pubDate></item></channel></rss>`);
      if (url.includes("weather.gov")) return new Response(JSON.stringify({ features: [{ properties: { id: "routine-weather", headline: "Routine weather outlook", description: "Normal conditions.", areaDesc: "Miami", severity: "Minor" } }] }), { headers: { "content-type": "application/json" } });
      return new Response(emptyRss);
    }) as typeof fetch,
    officialFeedTextFallback: async (source) => {
      fallbackCalls.push(source.id);
      if (source.id !== "fbi-miami") return emptyRss;
      return `<rss><channel><item><guid>fbi-miami-hot</guid><title>Miami resident charged in kidnapping investigation</title><description>The charge is an allegation and the case remains pending.</description><pubDate>Wed, 19 Aug 2026 14:00:00 GMT</pubDate></item></channel></rss>`;
    },
  });

  assert.deepEqual(fallbackCalls.sort(), ["fbi-miami", "fbi-ny"]);
  assert.equal(result.failedSources.length, 0);
  assert.equal(result.created, 3);
  assert.equal(result.status.events.total, 3);
  assert.equal(result.status.editorial.sections.traffic.events, 0);
  assert.equal(result.status.editorial.sections.public_safety.events, 3);
  assert.ok(result.status.queue.autoEligible >= 3);
});

test("professional newsroom classifies desks and produces attributed Facebook text without media", async (t) => {
  const workspaceDir = await fixture(t);
  const result = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { PUBLIC_BASE_URL: "https://news.example.com" }, events: [{
    sourceEventId: "traffic-1", source: "Notify NYC", sourceUrl: "https://notify.nyc/traffic-1", lane: "ny-news",
    title: "Road closure on Broadway", description: "Two lanes are closed near Canal Street.", instruction: "Use an alternate route.",
    location: "Broadway at Canal Street", eventType: "Traffic closure", urgency: "Expected",
  }] });
  const persisted = JSON.parse(await readFile(path.join(workspaceDir, "events.json"), "utf8")).events[0];
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const facebook = queue.find((item: any) => item.platform === "facebook");
  const x = queue.find((item: any) => item.platform === "x");
  assert.equal(persisted.section, "traffic");
  assert.equal(persisted.editorialUrgency, "developing");
  assert.deepEqual({ textOnly: facebook.textOnly, mediaRequired: facebook.mediaRequired }, { textOnly: true, mediaRequired: false });
  assert.match(facebook.copy, /^ESPAÑOL/);
  assert.match(facebook.copy, /\nENGLISH · TRAFFIC\n/);
  assert.match(facebook.copy, /ESPAÑOL · TRÁFICO/);
  assert.match(facebook.copy, /Fuente oficial \/ Official source: Notify NYC/);
  assert.match(facebook.copy, /https:\/\/news\.example\.com\/news\/article\//);
  assert.match(facebook.copy, /utm_source=metricool/);
  assert.match(x.copy, /https:\/\/notify\.nyc\/traffic-1/);
  assert.ok(__clipperLocalNewsInternals.xWeightedLength(x.copy) <= 280);
  assert.match(x.copy, /^ES —/);
  assert.match(x.copy, /\nEN —/);
  assert.equal(facebook.organicGrowth.zeroCost, true);
  assert.equal(facebook.organicGrowth.shortForm.renderMode, "local_template");
  assert.equal(result.status.editorial.owner, "Local News CEO");
  assert.deepEqual(
    { minimum: result.status.editorial.dailyPublishing.minimumPerAccount, maximum: result.status.editorial.dailyPublishing.adaptiveMaximum, bilingual: result.status.editorial.dailyPublishing.bilingualSamePost, videoFirst: result.status.editorial.dailyPublishing.videoFirst },
    { minimum: 10, maximum: 14, bilingual: true, videoFirst: true },
  );
  assert.deepEqual(result.status.editorial.dailyPublishing.accounts["ny-news"].facebook, { queuedToday: 1, target: 10, deficit: 9, performanceMode: "baseline" });
  assert.equal(result.status.editorial.sections.traffic.events, 1);
  assert.equal(result.status.editorial.textOnlyFacebook, 1);
  assert.deepEqual(
    { mode: result.status.editorial.growth.mode, paidAds: result.status.editorial.growth.paidAds, paidAi: result.status.editorial.growth.paidAiPerPost },
    { mode: "zero_cost_organic", paidAds: false, paidAi: true },
  );
  const growth = JSON.parse(await readFile(path.join(workspaceDir, "organic-growth.json"), "utf8"));
  assert.deepEqual(growth.costPolicy, { paidAds: false, paidAiPerPost: true, generation: "deterministic_local_templates", hostedTranslation: "gpt-5.4-nano_batched", estimatedMonthlyApiCostUsd: 0.5 });
});

test("adaptive Facebook cadence allows relevant developing coverage and defers conservative overflow", async (t) => {
  const workspaceDir = await fixture(t);
  const events = Array.from({ length: 9 }, (_, index) => ({
    sourceEventId: `traffic-${index}`, source: "Notify NYC", sourceUrl: `https://notify.nyc/${index}`, lane: "ny-news" as const,
    title: `Traffic closure ${index}`, description: "One lane is closed.", location: `Street ${index}`, eventType: "Traffic closure",
  }));
  const result = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const facebook = queue.filter((item: any) => item.platform === "facebook");
  assert.equal(facebook.filter((item: any) => item.gateReason === "none").length, 8);
  const deferred = facebook.find((item: any) => item.gateReason === "cadence");
  assert.equal(deferred.status, "auto_eligible");
  assert.equal(deferred.approvalRequired, false);
  assert.equal(deferred.notBefore, "2026-07-21T13:00:00.000Z");
  assert.equal(result.status.editorial.cadenceHeld, 2);
  assert.equal(result.status.editorial.cadence.facebookRelevantMax, 10);
});

test("breaking coverage bypasses hourly cadence holds and remains immediately eligible", async (t) => {
  const workspaceDir = await fixture(t);
  const events = Array.from({ length: 12 }, (_, index) => ({
    sourceEventId: `breaking-${index}`, source: "Notify NYC", sourceUrl: `https://notify.nyc/breaking-${index}`, lane: "ny-news" as const,
    title: `Emergency road closure ${index}`, description: "Road closed after a major incident.", location: `Street ${index}`, eventType: "Emergency closure", urgency: "Immediate", severity: "Severe",
  }));
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const breaking = queue.filter((item: any) => item.editorialUrgency === "breaking");
  assert.equal(breaking.length, 24);
  assert.ok(breaking.every((item: any) => item.gateReason !== "cadence" && item.notBefore === null));
});

test("three-role committee records auditable unanimous verdicts and hashes on every queue item", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [event] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(queue.length, 2);
  for (const item of queue) {
    assert.deepEqual(item.verdicts.map((verdict: any) => verdict.role), ["source_verifier", "safety_editor", "monetization_editor"]);
    assert.ok(item.verdicts.every((verdict: any) => verdict.verdict === "approve" && verdict.checkedAt === "2026-07-21T12:00:00.000Z"));
    assert.equal(item.consensus, "unanimous_approve");
    assert.equal(item.publishDecision, "auto_publish");
    assert.match(item.reviewHash, /^[a-f0-9]{64}$/);
    assert.ok(item.evidence.some((evidence: string) => /^copyHash=[a-f0-9]{64}$/.test(evidence)));
  }
});

test("verified official sensitive facts can publish automatically but unsafe claims fail closed", async (t) => {
  const workspaceDir = await fixture(t);
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "nws-miami")!;
  const fetched = __clipperLocalNewsInternals.sourceEvents({ features: [
    { sourceEventId: "fatal-official", title: "Fatal storm update", description: "Officials confirmed one death.", location: "Downtown Miami", eventType: "Public safety update", severity: "Extreme" },
    { sourceEventId: "accusation", title: "Official arrest update", description: "A person was arrested and charged; the allegation is unresolved.", location: "Downtown Miami", eventType: "Public safety update", severity: "Severe" },
    { sourceEventId: "minor", title: "Minor identified", description: "A 14-year-old child was identified as a victim.", location: "Downtown Miami", eventType: "Public safety update", severity: "Severe" },
  ] }, source, "2026-07-21T12:00:00Z");
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: fetched });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.filter((item: any) => item.source.includes("National Weather Service") && item.publishDecision === "auto_publish").length >= 2);
  assert.ok(queue.filter((item: any) => item.reasons.includes("unresolved_accusation")).every((item: any) => item.publishDecision === "quarantine" && item.autoEligible === false));
  assert.ok(queue.filter((item: any) => item.reasons.includes("identifiable_minor")).every((item: any) => item.publishDecision === "reject" && item.autoEligible === false));
});

test("critical evacuation is automatic only with verified provenance, a specific zone and a live validity window", async (t) => {
  const workspaceDir = await fixture(t);
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "nws-miami")!;
  const fetched = __clipperLocalNewsInternals.sourceEvents({ features: [{
    sourceEventId: "evac-live", title: "Evacuation order", description: "Evacuate now.", instruction: "Leave Zone A.",
    location: "Zone A east of Biscayne Boulevard", eventType: "Emergency evacuation", severity: "Extreme",
    effective: "2026-07-21T11:55:00Z", expires: "2026-07-21T14:00:00Z",
  }] }, source, "2026-07-21T12:00:00Z");
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: fetched });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.every((item: any) => item.publishDecision === "auto_publish" && item.reasons.includes("critical_evacuation_provenance_zone_and_validity_verified")));

  const manualWorkspace = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir: manualWorkspace, now: "2026-07-21T12:00:00Z", events: [{ ...event, sourceEventId: "manual-evac", title: "Evacuation order", description: "Evacuate now.", location: "Zone A", severity: "Extreme", effective: "2026-07-21T11:55:00Z", expires: "2026-07-21T14:00:00Z" }] });
  const manualQueue = JSON.parse(await readFile(path.join(manualWorkspace, "metricool-queue.json"), "utf8")).items;
  assert.ok(manualQueue.every((item: any) => item.publishDecision === "quarantine" && item.reasons.includes("sensitive_story_missing_verified_connector_provenance")));
});

test("unknown sources, contradictory reports, graphic violence, private victim addresses, and engagement bait never auto publish", async (t) => {
  const workspaceDir = await fixture(t);
  const cases = [
    { sourceEventId: "unknown", source: "Random Blog", sourceUrl: "https://example.com/story", title: "Traffic closure", description: "Road closed downtown." },
    { sourceEventId: "conflict", title: "Conflicting reports", description: "Officials published contradictory information." },
    { sourceEventId: "graphic", title: "Graphic violence", description: "Graphic gore was shown." },
    { sourceEventId: "address", title: "Victim update", description: "The victim lives at 123 Main Street." },
    { sourceEventId: "bait", title: "You won't believe this storm", description: "Share before everyone else." },
  ].map((item) => ({ ...event, severity: "Severe", ...item }));
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: cases });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.every((item: any) => item.autoEligible === false && ["quarantine", "reject"].includes(item.publishDecision)));
});

test("updates, corrections and resolved notices are tracked as newsroom revisions", async (t) => {
  const workspaceDir = await fixture(t);
  const base = { sourceEventId: "revision-1", source: "Miami-Dade County", sourceUrl: "https://miamidade.gov/update", lane: "miami-news" as const, title: "County service update", description: "Service is delayed.", location: "Miami-Dade", eventType: "Local update" };
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [base] });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:05:00Z", events: [{ ...base, description: "Service is delayed by one hour." }] });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:10:00Z", events: [{ ...base, status: "correction", title: "Correction: county service update", description: "Service is delayed by 30 minutes." }] });
  const resolved = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:15:00Z", events: [{ ...base, status: "resolved", description: "Service has resumed." }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.some((item: any) => item.revisionKind === "update" && /ACTUALIZACIÓN/.test(item.copy)));
  assert.ok(queue.some((item: any) => item.revisionKind === "correction" && /CORRECCIÓN/.test(item.copy)));
  assert.ok(queue.some((item: any) => item.revisionKind === "resolved" && /RESUELTO/.test(item.copy)));
  assert.equal(resolved.status.editorial.revisions, 3);
  assert.equal(resolved.status.editorial.corrections, 1);
  assert.equal(resolved.status.editorial.resolvedRevisions, 1);
});

test("FHP ArcGIS mapper uses documented fields and drops stale Miami-Dade incidents", () => {
  const source = __clipperLocalNewsInternals.sources({ CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC: "true" }).find((item) => item.id === "fhp-miami-closures")!;
  const mapped = __clipperLocalNewsInternals.sourceEvents({ features: [
    { attributes: { INCIDENTID: "fresh-1", DATESTR: "07/21/2026", TIMESTR: "07:30", TYPEEVENT: "Road Closure", COUNTY: "MIAMI-DADE", LOCATION: "I-95 NB", REMARKS: "Two lanes closed" } },
    { attributes: { INCIDENTID: "wrong-county-1", DATESTR: "07/21/2026", TIMESTR: "07:30", TYPEEVENT: "Road Closure", COUNTY: "BROWARD", LOCATION: "I-95 NB", REMARKS: "Outside Miami-Dade" } },
    { attributes: { INCIDENTID: "stale-1", DATESTR: "07/10/2026", TIMESTR: "07:30", TYPEEVENT: "Road Closure", COUNTY: "MIAMI-DADE", LOCATION: "Old Road", REMARKS: "Old event" } },
  ] }, source, "2026-07-21T12:00:00Z");
  assert.equal(mapped.length, 1);
  assert.deepEqual({ id: mapped[0].sourceEventId, type: mapped[0].eventType, location: mapped[0].location, description: mapped[0].description }, { id: "fresh-1", type: "Road Closure", location: "I-95 NB", description: "Two lanes closed" });
});

test("official RSS adapters normalize attributed XML items without credentials and skip stale/future feed entries", () => {
  const source = __clipperLocalNewsInternals.sources({ CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC: "true" }).find((item) => item.id === "notify-nyc")!;
  const items = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel>
    <item><guid>alert-1</guid><title>Traffic &amp; Transit</title><description><![CDATA[Road closed <b>temporarily</b>.]]></description><link>https://notify.nyc/alert-1</link><pubDate>Tue, 21 Jul 2026 12:00:00 GMT</pubDate></item>
    <item><guid>old-alert</guid><title>Old closure</title><description>Old</description><link>https://notify.nyc/old</link><pubDate>Fri, 17 Jul 2026 12:00:00 GMT</pubDate></item>
    <item><guid>future-alert</guid><title>Future closure</title><description>Future</description><link>https://notify.nyc/future</link><pubDate>Wed, 22 Jul 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`, source, "2026-07-21T12:00:00Z");
  assert.equal(items.length, 1);
  assert.deepEqual({ source: items[0].source, title: items[0].title, description: items[0].description }, { source: "Notify NYC", title: "Traffic & Transit", description: "Road closed temporarily ." });
  assert.equal(items[0].effective, "2026-07-21T12:00:00.000Z");
});

test("DOJ district connectors reject stories from other jurisdictions", () => {
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "doj-sdfl")!;
  const items = __clipperLocalNewsInternals.rssEvents(`<rss><channel>
    <item><guid>sdfl-1</guid><title>South Florida case update</title><description>Official release.</description><link>https://www.justice.gov/usao-sdfl/pr/south-florida-case-update</link><pubDate>Tue, 21 Jul 2026 12:00:00 GMT</pubDate></item>
    <item><guid>nm-1</guid><title>New Mexico case update</title><description>Wrong district.</description><link>https://www.justice.gov/usao-nm/pr/new-mexico-case-update</link><pubDate>Tue, 21 Jul 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`, source, "2026-07-21T12:05:00Z");
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceUrl, "https://www.justice.gov/usao-sdfl/pr/south-florida-case-update");
});

test("official RSS media is kept only when the feed exposes a public video or image", () => {
  const source = __clipperLocalNewsInternals.sources({ CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC: "true" }).find((item) => item.id === "notify-nyc")!;
  const items = __clipperLocalNewsInternals.rssEvents(`<rss><channel>
    <item><guid>video-alert</guid><title>Major closure update</title><description>Video details from the official source.</description><link>https://notify.nyc/video-alert</link><enclosure url="https://notify.nyc/media/closure.mp4" type="video/mp4"/><pubDate>Tue, 21 Jul 2026 12:00:00 GMT</pubDate></item>
    <item><guid>image-alert</guid><title>Image update</title><description>Photo details from the official source.</description><link>https://notify.nyc/image-alert</link><media:content url="https://notify.nyc/media/update.jpg" type="image/jpeg"/><pubDate>Tue, 21 Jul 2026 12:01:00 GMT</pubDate></item>
  </channel></rss>`, source, "2026-07-21T12:05:00Z");
  assert.deepEqual(items.map((item) => ({ mediaUrl: item.mediaUrl, mediaType: item.mediaType })), [
    { mediaUrl: "https://notify.nyc/media/closure.mp4", mediaType: "video" },
    { mediaUrl: "https://notify.nyc/media/update.jpg", mediaType: "image" },
  ]);
  const normalized = normalizeClipperLocalNewsEvent(items[0], "2026-07-21T12:05:00Z");
  assert.equal(normalized.mediaType, "video");
  assert.ok(normalized.qualityScore >= 80);
});

test("MTA adapter ingests only live unscheduled subway alerts and ignores planned-work floods", () => {
  const source = { id: "mta-subway-alerts", lane: "ny-news" as const, url: "https://www.mta.info/alerts", requiresKey: false, format: "mta-json" as const, sourceName: "Metropolitan Transportation Authority" };
  const items = __clipperLocalNewsInternals.mtaAlertEvents({ entity: [
    { id: "lmm:alert:101", alert: {
      active_period: [{ start: 1784633400 }],
      informed_entity: [{ route_id: "E" }, { route_id: "F" }],
      header_text: { translation: [{ text: "[E][F] trains are delayed in Queens.", language: "en" }] },
      description_text: { translation: [{ text: "Allow additional travel time.", language: "en" }] },
      "transit_realtime.mercury_alert": { created_at: 1784633400, updated_at: 1784633500, alert_type: "Delays" },
    } },
    { id: "lmm:planned_work:202", alert: { header_text: { translation: [{ text: "Weekend work", language: "en" }] } } },
    { id: "lmm:alert:303", alert: { active_period: [{ start: 1784547000, end: 1784550600 }], header_text: { translation: [{ text: "Expired delay", language: "en" }] } } },
  ] }, source, "2026-07-21T12:00:00Z");
  assert.equal(items.length, 1);
  assert.deepEqual({ id: items[0].sourceEventId, source: items[0].source, location: items[0].location, type: items[0].eventType }, {
    id: "lmm:alert:101", source: "Metropolitan Transportation Authority", location: "NYC Subway · Lines E, F", type: "Delays",
  });
  assert.equal(items[0].sourceUrl, "https://www.mta.info/alerts");
  const normalized = normalizeClipperLocalNewsEvent(items[0], "2026-07-21T12:00:00Z");
  assert.equal(normalized.section, "traffic");
});

test("Miami-Dade Transit adapter keeps current service updates and drops expired or stale indefinite detours", () => {
  const source = { id: "miami-dade-transit", lane: "miami-news" as const, url: "https://www.miamidade.gov/global/transportation/tracker/service-updates.page", requiresKey: false, format: "miami-transit-bootstrap" as const, sourceName: "Miami-Dade Transit" };
  const items = __clipperLocalNewsInternals.miamiTransitEvents({ metrobus: [
    { id: 3020, title: "Route 183 adjustment", serviceUpdate: '<p><a href="https://cloud.info.miamidade.gov/current">Details</a> New schedule.</p>', serviceUpdateType: "Metrobus", serviceUpdateTypeID: "183", inEffect: "2026-07-20T00:00:00", expireDate: "2026-09-01T00:00:00" },
    { id: 2000, title: "Expired detour", serviceUpdate: "Old", serviceUpdateType: "Metrobus", inEffect: "2026-01-01T00:00:00", expireDate: "2026-07-20T00:00:00" },
    { id: 1000, title: "Stale indefinite detour", serviceUpdate: "Very old", serviceUpdateType: "Metrobus", inEffect: "2025-01-01T00:00:00", expireDate: null },
  ] }, source, "2026-07-21T12:00:00Z");
  assert.equal(items.length, 1);
  assert.deepEqual({ id: items[0].sourceEventId, title: items[0].title, location: items[0].location }, { id: "service-update-3020", title: "Route 183 adjustment", location: "Miami-Dade Metrobus · Route 183" });
  assert.equal(items[0].sourceUrl, "https://cloud.info.miamidade.gov/current");
  assert.match(items[0].description || "", /Details New schedule/);
});

test("Miami transit bootstrap key is used ephemerally and never persisted", async (t) => {
  const workspaceDir = await fixture(t);
  const secret = "public-key-from-official-page";
  const headersSeen: Array<Record<string, string>> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const requestedUrl = String(url);
    if (requestedUrl.includes("service-updates.page")) return new Response(`<service-updates apikey="${secret}"></service-updates>`, { status: 200 });
    if (requestedUrl.includes("api/serviceupdates")) {
      headersSeen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return new Response(JSON.stringify({ universal: [], metrorail: [], metrobus: [], metromover: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  };
  const result = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:00:00Z", fetch: fetcher as typeof fetch });
  assert.equal(headersSeen.length, 0, "disabled transit connector must not request or use a bootstrap key");
  for (const artifact of Object.values(result.status.artifacts)) assert.doesNotMatch(await readFile(artifact, "utf8"), new RegExp(secret));
});

test("Facebook newsroom copy keeps official detail concise for long source descriptions", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [{
    sourceEventId: "long-copy-1", source: "Miami-Dade County", sourceUrl: "https://miamidade.gov/long", lane: "miami-news",
    title: "Traffic advisory", description: "Long detail. ".repeat(300), instruction: "Use alternate route. ".repeat(100),
    location: "Miami-Dade", eventType: "Traffic advisory",
  }] });
  const facebook = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items.find((item: any) => item.platform === "facebook");
  assert.ok(facebook.copy.length < 1_600);
  assert.doesNotMatch(facebook.copy, /EXTRACTO ORIGINAL|INSTRUCCIÓN ORIGINAL/);
  assert.equal((facebook.copy.match(/https:\/\/miamidade\.gov\/long/g) || []).length, 1);
});

test("sensitive Spanish and English topics receive automatic final quarantine or rejection", async (t) => {
  const workspaceDir = await fixture(t);
  const sensitive = ["Menor identificado como víctima", "Unconfirmed shooting", "Arresto y acusación", "Fallecido en incidente", "Rumor sin confirmar", "Crime investigation involving a robbery"];
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE: "true" }, events: sensitive.map((title, index) => ({ ...event, sourceEventId: `sensitive-${index}`, title: index === 4 ? "Actualización policial" : title, description: index === 4 ? title : event.description })) });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(queue.length, sensitive.length * 2);
  assert.ok(queue.every((item: any) => ["high", "critical"].includes(item.risk) && ["quarantined", "rejected"].includes(item.status) && item.approvalRequired === false));
});

test("NY511 sends its key only as an ephemeral query parameter and never persists it", async (t) => {
  const workspaceDir = await fixture(t);
  const secret = "super-secret-developer-key";
  const requested: URL[] = [];
  const fetcher = async (url: string | URL | Request) => {
    requested.push(new URL(String(url)));
    return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runClipperLocalNewsCycle({
    workspaceDir,
    now: "2026-07-21T12:00:00Z",
    env: {
      CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC: "true",
      NY511_FEED_URL: "https://example.test/incidents",
      NY511_API_KEY: secret,
    },
    fetch: fetcher as typeof fetch,
  });
  assert.equal(requested.find((url) => url.hostname === "example.test")?.searchParams.get("key"), secret);
  for (const artifact of Object.values(result.status.artifacts)) assert.doesNotMatch(await readFile(artifact, "utf8"), new RegExp(secret));
});

test("runtime validation rejects malformed and excessive route payloads with ZodError", async (t) => {
  const workspaceDir = await fixture(t);
  await assert.rejects(() => ingestClipperLocalNewsEvents({ workspaceDir, events: [{ ...event, lane: "boston-news" }] as any }), z.ZodError);
  await assert.rejects(() => runClipperLocalNewsCycle({ workspaceDir, events: Array.from({ length: 501 }, () => event) }), z.ZodError);
  await assert.rejects(() => recordClipperLocalNewsMetrics({ workspaceDir, metrics: Array.from({ length: 501 }, () => ({ lane: "miami-news" as const, platform: "x" as const })) }), z.ZodError);
  await assert.rejects(() => recordClipperLocalNewsMetrics({ workspaceDir, metrics: [{ lane: "miami-news", platform: "x", impressions: -1 }] }), z.ZodError);
});

test("cycle accepts deterministic injected events without network and resolves missing snapshot events", async (t) => {
  const workspaceDir = await fixture(t);
  await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [event] });
  const cycle = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:03:00Z", events: [], resolveMissing: true, snapshotLanes: ["miami-news"] });
  assert.equal(cycle.status.events.resolved, 1);
  assert.equal(cycle.status.lastRunAt, "2026-07-21T12:03:00.000Z");
});

test("a successful NWS fetch does not resolve an absent FL511 event, while explicit expiry does", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [
    { ...event, source: "fl511", sourceEventId: "fl511-active", title: "Cierre vial", expires: "2026-07-21T14:00:00Z" },
    { ...event, source: "fl511", sourceEventId: "fl511-expired", title: "Cierre temporal", expires: "2026-07-21T12:02:00Z" },
  ] });
  const fetcher = async (url: string | URL | Request) => {
    const requestedUrl = String(url);
    if (requestedUrl.includes("service-updates.page")) return new Response('<service-updates apikey="public-runtime-key"></service-updates>', { status: 200 });
    if (requestedUrl.includes("api/serviceupdates")) return new Response(JSON.stringify({ universal: [], metrorail: [], metrobus: [], metromover: [] }), { status: 200 });
    return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const cycle = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:03:00Z", fetch: fetcher as typeof fetch });
  assert.equal(cycle.failedSources.length, 0);
  assert.equal(cycle.status.events.active, 1);
  assert.equal(cycle.status.events.resolved, 1);
  const persisted = JSON.parse(await readFile(path.join(workspaceDir, "events.json"), "utf8")).events;
  assert.equal(persisted.find((item: any) => item.sourceEventId === "fl511-active").lifecycle, "active");
  assert.equal(persisted.find((item: any) => item.sourceEventId === "fl511-expired").lifecycle, "resolved");
});

test("metrics roll into analytics and status without changing publish claims", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [event] });
  const result = await recordClipperLocalNewsMetrics({ workspaceDir, now: "2026-07-21T13:00:00Z", metrics: [
    { eventId: "nws-1", lane: "miami-news", platform: "x", impressions: 100, reach: 80, videoViews: 75, engagements: 9, clicks: 4, shares: 2, revenueUsd: 12.5, costUsd: 3.25 },
    { eventId: "nws-1", lane: "miami-news", platform: "facebook" },
  ] });
  assert.deepEqual(result.status.metrics, { total: 2, impressions: 100, reach: 80, videoViews: 75, engagements: 9, clicks: 4, shares: 2, revenueUsd: 12.5, costUsd: 3.25, profitUsd: 9.25 });
  assert.deepEqual(result.status.monetization, {
    targetUsd: 10000, revenueUsd: 12.5, remainingUsd: 9987.5, progressPct: 0.13,
    externalEligibility: "unverified", pagesEligible: null, policyViolations: null, verifiedAt: null,
    bySection: { weather: { posts: 1, reach: 80, engagement: 9, revenueUsd: 12.5 } },
  });
  assert.equal(result.status.queue.published, 0);
  assert.match(await readFile(result.status.artifacts.analytics, "utf8"), /"impressions": 100/);
  assert.match(await readFile(result.status.artifacts.analyticsCsv, "utf8"), /revenueUsd,costUsd/);
  assert.deepEqual((await getClipperLocalNewsStatus({ workspaceDir })).metrics, result.status.metrics);
});

test("bootstrap safely backfills committee decisions for legacy queue state", async (t) => {
  const workspaceDir = await fixture(t);
  await bootstrapClipperLocalNews({ workspaceDir, now: "2026-07-21T12:00:00Z" });
  const statePath = path.join(workspaceDir, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:01:00Z", events: [event] });
  const populated = JSON.parse(await readFile(statePath, "utf8"));
  for (const item of populated.queue) {
    delete item.verdicts; delete item.evidence; delete item.consensus; delete item.publishDecision; delete item.reasons; delete item.checkedAt; delete item.reviewHash;
  }
  await writeFile(statePath, `${JSON.stringify(populated)}\n`, "utf8");
  const status = await bootstrapClipperLocalNews({ workspaceDir, now: "2026-07-21T12:02:00Z" });
  const migrated = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(state.version, 1);
  assert.ok(migrated.every((item: any) => item.verdicts.length === 3 && item.consensus === "unanimous_approve" && /^[a-f0-9]{64}$/.test(item.reviewHash)));
  assert.equal(status.editorial.committee.reviewed, 2);
});

test("official DOJ accusation uses the sensitive connector, public-safety priority, and neutral legal language", async (t) => {
  const workspaceDir = await fixture(t);
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "doj-sdfl")!;
  const fetched = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel><item>
    <guid>doj-charge-1</guid><title>Miami resident charged in federal case</title>
    <description>The defendant was arrested and charged. The allegation remains pending.</description>
    <link>https://www.justice.gov/usao-sdfl/pr/example-case</link>
    <pubDate>Tue, 21 Jul 2026 12:00:00 GMT</pubDate>
  </item></channel></rss>`, source, "2026-07-21T12:00:00Z");
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: fetched });
  const state = JSON.parse(await readFile(path.join(workspaceDir, "state.json"), "utf8"));
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(state.events[0].section, "public_safety");
  assert.ok(state.events[0].editorialPriority >= 80);
  assert.ok(queue.every((item: any) => item.publishDecision === "auto_publish" && item.autoEligible));
  assert.ok(queue.every((item: any) => /^[a-f0-9]{64}$/.test(item.claimIdentityHash) && /^[a-f0-9]{64}$/.test(item.canonicalEventIdentity)));
  assert.match(queue.find((item: any) => item.platform === "facebook").copy, /se presume inocente/);
  assert.match(queue.find((item: any) => item.platform === "x").copy, /ES: Se presume inocente\. EN: Presumed innocent/);
});

test("official RSS without link uses guid as article URL instead of the feed URL", () => {
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "fbi-ny")!;
  const fetched = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel><item>
    <guid>https://www.fbi.gov/contact-us/field-offices/newyork/news/bronx-man-charged-with-federal-hate-crimes</guid>
    <title>Bronx Man Charged with Federal Hate Crimes for Attack at Manhattan Synagogue</title>
    <description>Official federal charge update from New York.</description>
    <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
  </item></channel></rss>`, source, "2026-08-20T12:00:00Z");
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].sourceUrl, "https://www.fbi.gov/contact-us/field-offices/newyork/news/bronx-man-charged-with-federal-hate-crimes");
  assert.equal(fetched[0].sourceEventId, fetched[0].sourceUrl);
});

test("fetched official stories dedupe duplicate FBI and DOJ syndication before queuing", async (t) => {
  const workspaceDir = await fixture(t);
  const fbi = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "fbi-ny")!;
  const doj = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "doj-sdny")!;
  const now = "2026-08-20T12:00:00Z";
  const fbiEvent = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel><item>
    <guid>https://www.fbi.gov/contact-us/field-offices/newyork/news/bronx-man-charged-with-federal-hate-crimes-for-attack-at-manhattan-synagogue</guid>
    <title>Bronx Man Charged with Federal Hate Crimes for Attack at Manhattan Synagogue</title>
    <description>Official FBI update.</description>
    <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
  </item></channel></rss>`, fbi, now);
  const dojEvent = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel><item>
    <guid>https://www.justice.gov/usao-sdny/pr/bronx-man-charged-federal-hate-crimes-attack-manhattan-synagogue</guid>
    <title>Bronx Man Charged With Federal Hate Crimes For Attack At Manhattan Synagogue</title>
    <description>Official DOJ update with legal details.</description>
    <link>https://www.justice.gov/usao-sdny/pr/bronx-man-charged-federal-hate-crimes-attack-manhattan-synagogue</link>
    <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
  </item></channel></rss>`, doj, now);
  const deduped = __clipperLocalNewsInternals.dedupeFetchedStoryEvents([...fbiEvent, ...dojEvent], now);
  assert.equal(deduped.length, 1);
  assert.match(deduped[0].sourceUrl, /justice\.gov\/usao-sdny/);

  await ingestClipperLocalNewsEvents({ workspaceDir, now, events: deduped });
  const state = JSON.parse(await readFile(path.join(workspaceDir, "state.json"), "utf8"));
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(state.events.length, 1);
  assert.equal(queue.length, 2);
});

test("fetched official stories dedupe numeric and written-number headline variants", () => {
  const fbi = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "fbi-ny")!;
  const doj = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "doj-sdny")!;
  const now = "2026-08-20T12:00:00Z";
  const written = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel><item>
    <guid>https://www.fbi.gov/contact-us/field-offices/newyork/news/seventeen-iranians-charged-with-conducting-massive-cyber-theft-campaign</guid>
    <title>Seventeen Iranians Charged with Conducting Massive Cyber Theft Campaign</title>
    <description>Official FBI update.</description>
    <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
  </item></channel></rss>`, fbi, now);
  const numeric = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel><item>
    <guid>https://www.justice.gov/usao-sdny/pr/17-iranians-charged-conducting-massive-cyber-theft-campaign</guid>
    <title>17 Iranians Charged With Conducting Massive Cyber Theft Campaign</title>
    <description>Official DOJ update.</description>
    <link>https://www.justice.gov/usao-sdny/pr/17-iranians-charged-conducting-massive-cyber-theft-campaign</link>
    <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
  </item></channel></rss>`, doj, now);
  const deduped = __clipperLocalNewsInternals.dedupeFetchedStoryEvents([...written, ...numeric], now);
  assert.equal(deduped.length, 1);
  assert.match(deduped[0].sourceUrl, /justice\.gov\/usao-sdny/);
});

test("fetched alerts preserve same-title events in different locations", () => {
  const now = "2026-08-24T12:00:00Z";
  const alerts = [
    {
      sourceEventId: "nws-flood-bronx",
      source: "National Weather Service",
      sourceUrl: "https://api.weather.gov/alerts/urn:oid:bronx",
      lane: "ny-news" as const,
      title: "Flood Warning",
      description: "Flooding is expected in low-lying areas.",
      location: "Bronx County",
      eventType: "Flood Warning",
      severity: "Severe",
      urgency: "Immediate",
    },
    {
      sourceEventId: "nws-flood-queens",
      source: "National Weather Service",
      sourceUrl: "https://api.weather.gov/alerts/urn:oid:queens",
      lane: "ny-news" as const,
      title: "Flood Warning",
      description: "Flooding is expected in low-lying areas.",
      location: "Queens County",
      eventType: "Flood Warning",
      severity: "Severe",
      urgency: "Immediate",
    },
  ];
  const deduped = __clipperLocalNewsInternals.dedupeFetchedStoryEvents(alerts, now);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((item) => item.location), ["Bronx County", "Queens County"]);
});

test("traffic connectors stay disabled by default and can be explicitly restored", () => {
  const defaultSources = __clipperLocalNewsInternals.sources({});
  const defaultConnectors = __clipperLocalNewsInternals.connectorCatalog({});
  assert.equal(defaultSources.some((item) => item.id === "notify-nyc" || item.id.startsWith("fhp-miami-")), false);
  assert.equal(defaultConnectors.find((item) => item.id === "notify-nyc")?.configured, false);
  assert.equal(defaultConnectors.find((item) => item.id === "fhp-miami-dade")?.configured, false);

  const trafficSources = __clipperLocalNewsInternals.sources({ CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC: "true" });
  const trafficConnectors = __clipperLocalNewsInternals.connectorCatalog({ CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC: "true" });
  assert.equal(trafficSources.some((item) => item.id === "notify-nyc"), true);
  assert.equal(trafficSources.some((item) => item.id.startsWith("fhp-miami-")), true);
  assert.equal(trafficConnectors.find((item) => item.id === "notify-nyc")?.configured, true);
  assert.equal(trafficConnectors.find((item) => item.id === "fhp-miami-dade")?.configured, true);
});


test("sensitive detector covers custody, charge, complaint, and defendant language", () => {
  const base = { instruction: "", location: "Miami", eventType: "Public safety" };
  for (const description of ["The suspect was taken into custody.", "The defendant faces 3 counts.", "A criminal complaint was filed.", "The defendant faces multiple charges."]) {
    assert.equal(detectLocalNewsSensitiveContent({ ...base, title: "Official update", description }).accusation, true, description);
  }
});

test("sensitive detector rejects identifiable minors, graphic variants, and private residences without flagging ordinary road locations", () => {
  const base = { instruction: "", location: "Miami", eventType: "Public safety" };
  assert.equal(detectLocalNewsSensitiveContent({ ...base, title: "17-year-old boy John Smith located", description: "Official update" }).identifiableMinor, true);
  assert.equal(detectLocalNewsSensitiveContent({ ...base, title: "Juvenile Jane Smith located", description: "Official update" }).identifiableMinor, true);
  assert.equal(detectLocalNewsSensitiveContent({ ...base, title: "Investigation update", description: "Authorities reported severed remains." }).graphic, true);
  assert.equal(detectLocalNewsSensitiveContent({ ...base, title: "Family notice", description: "The victim family residence is 1200 Ocean Boulevard Unit 4." }).victimPrivateAddress, true);
  assert.equal(detectLocalNewsSensitiveContent({ ...base, title: "Road closure", description: "Traffic is blocked at 1200 Ocean Boulevard." }).victimPrivateAddress, false);
});
