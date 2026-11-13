import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finalizeSourceObservation, recordSourceObservation, readSourceDiagnostics, sanitizeSourceError, sourceObservation } from "../server/local-news-source-diagnostics";
import { getClipperLocalNewsStatus, runClipperLocalNewsCycle } from "../server/clippers-local-news-agent";
import { deliverClipperLocalNewsToMetricool } from "../server/clippers-local-news-metricool";
import { LocalNewsTranslator } from "../server/clippers-local-news-translation";

const at = "2026-10-06T08:00:00.000Z";
const source = { id: "miami-dade-news", lane: "miami-news" as const };
const catalog = [{ ...source, configured: true }];
async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "news-diagnostics-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const fresh = () => finalizeSourceObservation(sourceObservation(source, at, 1, [{ sourceEventId: "article", originalPublishedAt: at }]), 1);

test("missing diagnostics are explicitly unobserved and a read creates no artifact", async t => {
  const dir = await fixture(t);
  const r = await readSourceDiagnostics(dir, catalog, at);
  assert.equal(r.available, false);
  assert.equal(r.storageError, "missing");
  assert.equal(r.sources[0].status, "not_observed");
  await assert.rejects(readFile(path.join(dir, "source-diagnostics.json")), { code: "ENOENT" });
});

test("empty transport success is not news success; disabled sources remain distinct", async t => {
  const dir = await fixture(t);
  await recordSourceObservation(dir, sourceObservation(source, at, 0, []));
  const r = await readSourceDiagnostics(dir, [...catalog, { id: "ny511", lane: "ny-news", configured: false }], at);
  assert.equal(r.sources[0].status, "empty");
  assert.equal(r.sources[0].lastFetchSuccessAt, at);
  assert.equal(r.sources[0].lastNewsSuccessAt, null);
  assert.equal(r.sources[1].status, "disabled");
});

test("old, undated and future news never become recent through fetch time", () => {
  assert.equal(sourceObservation(source, at, 1, []).outcome, "no_recent_news");
  assert.equal(sourceObservation(source, at, 1, [{ effective: "2026-09-01T00:00:00Z" }]).recentCount, 0);
  const missing = sourceObservation(source, at, 1, [{ effective: at, originalPublishedAt: null }]);
  assert.equal(missing.outcome, "undated");
  assert.equal(missing.recentCount, 0);
  assert.equal(sourceObservation(source, at, 1, [{ originalPublishedAt: "2026-10-07T00:00:00Z" }]).recentCandidateCount, 0);
  assert.equal(sourceObservation(source, at, 1, [{ effective: at }]).recentCandidateCount, 0);
});

test("recent contributions count unique articles, not platform queue entries", () => {
  const o = sourceObservation(source, at, 2, [
    { sourceEventId: "same", originalPublishedAt: at }, { sourceEventId: "same", originalPublishedAt: at },
  ]);
  assert.equal(o.outcome, "candidates_only");
  assert.equal(o.recentCount, 0);
  assert.equal(o.recentCandidateCount, 1);
  assert.equal(o.acceptedCount, 1);
});

test("classification allowlists concrete safe codes without leaking upstream text", () => {
  const errors = [
    new Error("HTTP 503 Authorization: Bearer FAKE_PRIVATE_VALUE user@example.invalid https://example.invalid/?key=FAKE_PRIVATE_VALUE"),
    new Error("HTTP 403 cookie=FAKE_PRIVATE_VALUE"),
    new Error("missing_api_key"),
    Object.assign(new Error("private response body"), { cause: { code: "ECONNRESET" } }),
    Object.assign(new Error("FAKE_PRIVATE_VALUE"), { name: "AbortError" }),
    new SyntaxError("private JSON body: FAKE_PRIVATE_VALUE"),
    new Error("unknown user@example.invalid FAKE_PRIVATE_VALUE"),
  ].map(sanitizeSourceError);
  assert.equal(errors[0].message, "HTTP 503");
  assert.equal(errors[0].category, "potentially_transient");
  assert.equal(errors[1].category, "configuration_or_access");
  assert.equal(errors[3].message, "ECONNRESET");
  assert.equal(errors[5].category, "invalid_response");
  assert.equal(errors[6].category, "unknown");
  assert.doesNotMatch(JSON.stringify(errors), /FAKE_PRIVATE_VALUE|example\.invalid|private JSON/);
});

test("sanitized detail persists in a fresh process; recovery does not erase prior failure", async t => {
  const dir = await fixture(t);
  await recordSourceObservation(dir, sourceObservation(source, "2026-10-06T07:00:00.000Z", null, [], new Error("HTTP 429 key=FAKE_PRIVATE_VALUE")));
  await recordSourceObservation(dir, fresh());
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import {readSourceDiagnostics} from './server/local-news-source-diagnostics.ts';console.log(JSON.stringify(await readSourceDiagnostics(${JSON.stringify(dir)},${JSON.stringify(catalog)},${JSON.stringify(at)})))`],
  { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const r = JSON.parse(child.stdout);
  assert.equal(r.sources[0].lastNewsSuccessAt, at);
  assert.equal(r.sources[0].history[1].error.message, "HTTP 429");
  assert.doesNotMatch(await readFile(path.join(dir, "source-diagnostics.json"), "utf8"), /FAKE_PRIVATE_VALUE/);
});

test("retention bounds history to 100 entries and seven days while retaining last success", async t => {
  const dir = await fixture(t);
  await recordSourceObservation(dir, finalizeSourceObservation(sourceObservation(source, "2026-09-25T08:00:00.000Z", 1, [{ originalPublishedAt: "2026-09-25T08:00:00Z" }]), 1));
  for (let i = 0; i < 105; i++) await recordSourceObservation(dir,
    sourceObservation(source, new Date(Date.parse(at) + i * 1000).toISOString(), null, [], new Error("HTTP 503")));
  const r = await readSourceDiagnostics(dir, catalog, "2026-10-06T09:00:00.000Z");
  assert.equal(r.sources[0].history.length, 100);
  assert.equal(r.sources[0].lastNewsSuccessAt, "2026-09-25T08:00:00.000Z");
  assert.ok(r.sources[0].history.every(o => Date.parse(o.checkedAt) >= Date.parse(at)));
});

test("concurrent same-process observations are not lost and cities remain separate", async t => {
  const dir = await fixture(t);
  const ny = { id: "fbi-ny", lane: "ny-news" as const };
  await Promise.all(Array.from({ length: 10 }, (_, i) => recordSourceObservation(dir,
    sourceObservation(i % 2 ? source : ny, new Date(Date.parse(at) + i * 1000).toISOString(), 0, []))));
  const r = await readSourceDiagnostics(dir, [...catalog, { ...ny, configured: true }], "2026-10-06T09:00:00.000Z");
  assert.equal(r.sources[0].city, "Miami");
  assert.equal(r.sources[1].city, "New York");
  assert.deepEqual(r.sources.map(s => s.history.length), [5, 5]);
  assert.equal(r.scope, "local_instance");
});

test("corrupt diagnostic state is explicit, does not expose content and is not overwritten", async t => {
  const dir = await fixture(t);
  const file = path.join(dir, "source-diagnostics.json");
  await writeFile(file, '{"private":"FAKE_PRIVATE_VALUE"}');
  const r = await readSourceDiagnostics(dir, catalog, at);
  assert.equal(r.storageError, "invalid");
  assert.doesNotMatch(JSON.stringify(r), /FAKE_PRIVATE_VALUE/);
  await assert.rejects(recordSourceObservation(dir, fresh()), /source_diagnostics_invalid/);
  assert.equal(await readFile(file, "utf8"), '{"private":"FAKE_PRIVATE_VALUE"}');
});

test("isolated cycle records source identity, counts and errors without any delivery; pause remains closed", async t => {
  const dir = await fixture(t);
  let posts = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (init?.method === "POST") { posts++; throw Error("forbidden_post"); }
    const url = String(input);
    if (url.includes("weather.gov")) return Response.json({ features: [] });
    if (url.includes("/feeds/miami-news")) throw new Error("HTTP 403 FAKE_PRIVATE_VALUE");
    if (url.includes("sheriff.org")) return new Response("<html>Unexpected layout FAKE_PRIVATE_VALUE</html>");
    if (url.includes("justice.gov")) return new Response("<rss><channel></channel></rss>");
    const link = url.includes("miamidade") ? "https://www.miamidade.gov/global/news-item.page?Mduid_news=fake"
      : "https://www.fbi.gov/news/press-releases/fake";
    return new Response(`<rss><channel><item><guid>${link}</guid><link>${link}</link><title>Official public safety update</title><description>Verified safety update for residents.</description><pubDate>${at}</pubDate></item></channel></rss>`);
  };
  const cycle = await runClipperLocalNewsCycle({
    workspaceDir: dir, env: { CLIPPERS_LOCAL_NEWS_HOT_ONLY: "false" }, now: at,
    fetch: fetcher, officialFeedTextFallback: async () => null,
  });
  assert.equal(cycle.sourceObservations.length, 9);
  assert.equal(cycle.sourceObservations.find(s => s.sourceId === "fbi-miami")?.error?.message, "HTTP 403");
  assert.equal(cycle.sourceObservations.find(s => s.sourceId === "broward-sheriff-breaking")?.outcome, "error");
  assert.equal(cycle.sourceObservations.find(s => s.sourceId === "nws-miami")?.outcome, "empty");
  assert.equal(cycle.sourceObservations.find(s => s.sourceId === "miami-dade-news")?.recentCandidateCount, 1);
  assert.doesNotMatch(JSON.stringify(cycle.failedSources), /FAKE_PRIVATE_VALUE/);
  const status = await getClipperLocalNewsStatus({ workspaceDir: dir, env: {}, now: at });
  assert.equal(status.sourceDiagnostics.sources.find(s => s.id === "fbi-miami")?.latest?.error?.message, "HTTP 403");
  const delivery = await deliverClipperLocalNewsToMetricool({ workspaceDir: dir, env: {}, fetch: fetcher });
  assert.equal(delivery.status, "paused");
  assert.equal(posts, 0);
});

test("manual supplied events do not manufacture fetch success or source observations", async t => {
  const dir = await fixture(t);
  const cycle = await runClipperLocalNewsCycle({ workspaceDir: dir, env: {}, now: at, events: [], fetch: async () => { throw Error("unexpected_fetch"); } });
  assert.deepEqual(cycle.sourceObservations, []);
  assert.equal(cycle.status.sourceDiagnostics.storageError, "missing");
  assert.ok(cycle.status.sourceDiagnostics.sources.filter(s => s.configured).every(s => s.status === "not_observed"));
});

test("old observations cannot present current source health as success", async t => {
  const dir = await fixture(t);
  await recordSourceObservation(dir, fresh());
  const r = await readSourceDiagnostics(dir, catalog, "2026-10-06T09:00:00.000Z");
  assert.equal(r.sources[0].status, "stale");
  assert.equal(r.sources[0].latest?.outcome, "recent_news");
  assert.equal(r.sources[0].lastNewsSuccessAt, at);
});

test("independent workers do not pretend to have shared source evidence", async t => {
  const a = await fixture(t), b = await fixture(t);
  await recordSourceObservation(a, fresh());
  assert.equal((await readSourceDiagnostics(a, catalog, at)).sources[0].status, "recent_news");
  assert.equal((await readSourceDiagnostics(b, catalog, at)).sources[0].status, "not_observed");
});

test("actual read-only UI renders missing evidence, errors and history without secrets", async t => {
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const dir = await fixture(t);
  const outfile = path.join(dir, "source-ui.cjs");
  await build({ entryPoints: ["client/src/components/clippers/local-news-source-diagnostics.tsx"],
    outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent" });
  const Component = createRequire(import.meta.url)(outfile).LocalNewsSourceDiagnostics;
  let diagnostics = await readSourceDiagnostics(dir, catalog, at);
  let html = renderToStaticMarkup(createElement(Component, { diagnostics }));
  assert.match(html, /miami-dade-news/);
  assert.match(html, /Miami/);
  assert.match(html, /not_observed/);
  assert.match(html, /ausente/);
  await recordSourceObservation(dir, sourceObservation(source, at, null, [], new Error("HTTP 403 FAKE_PRIVATE_VALUE")));
  diagnostics = await readSourceDiagnostics(dir, catalog, at);
  html = renderToStaticMarkup(createElement(Component, { diagnostics }));
  assert.match(html, /HTTP 403/);
  assert.match(html, /configuration_or_access/);
  assert.match(html, /<details/);
  assert.match(html, /Historial de observaciones/);
  assert.doesNotMatch(html, /FAKE_PRIVATE_VALUE/);
});

test("telemetry corruption cannot interrupt actual ingestion or overwrite corrupt evidence", async t => {
  const dir = await fixture(t);
  const file = path.join(dir, "source-diagnostics.json");
  await writeFile(file, '{"private":"FAKE_PRIVATE_VALUE"}');
  let gets = 0;
  const cycle = await runClipperLocalNewsCycle({ workspaceDir: dir, now: at,
    env: { CLIPPERS_LOCAL_NEWS_HOT_ONLY: "false" }, officialFeedTextFallback: async () => null,
    fetch: async input => {
      gets++;
      const url = String(input);
      if (url.includes("weather.gov")) return Response.json({ features: [] });
      if (url.includes("sheriff.org")) return new Response("<script>let allNewsItems = [];</script>");
      if (url.includes("miamidade")) return new Response(`<rss><channel><item><guid>unique</guid><link>https://www.miamidade.gov/global/news-item.page?Mduid_news=unique</link><title>Official new emergency safety guidance</title><description>Verified current public safety guidance for Miami-Dade residents. Follow the official directions and review the release before taking action.</description><pubDate>${at}</pubDate></item></channel></rss>`);
      return new Response("<rss><channel></channel></rss>");
    },
  });
  assert.equal(gets, 9);
  assert.ok(cycle.created > 0);
  assert.ok(cycle.queued > 0);
  assert.equal(cycle.failedSources.length, 0);
  assert.ok(cycle.diagnosticWriteErrors.length > 0);
  assert.equal(cycle.status.sourceDiagnostics.available, false);
  assert.equal(cycle.status.sourceDiagnostics.storageError, "invalid");
  assert.equal(await readFile(file, "utf8"), '{"private":"FAKE_PRIVATE_VALUE"}');
  assert.doesNotMatch(JSON.stringify(cycle.status.sourceDiagnostics), /FAKE_PRIVATE_VALUE/);
});

test("finalizing extraction replaces the same bounded observation and only genuine contribution advances news success", async t => {
  const dir = await fixture(t);
  const candidate = sourceObservation(source, at, 1, [{ sourceEventId: "a", originalPublishedAt: at }]);
  await recordSourceObservation(dir, candidate);
  assert.equal((await readSourceDiagnostics(dir, catalog, at)).sources[0].lastNewsSuccessAt, null);
  await recordSourceObservation(dir, finalizeSourceObservation(candidate, 0), true);
  let r = await readSourceDiagnostics(dir, catalog, at);
  assert.equal(r.sources[0].history.length, 1);
  assert.equal(r.sources[0].status, "candidates_only");
  assert.equal(r.sources[0].lastNewsSuccessAt, null);
  await recordSourceObservation(dir, finalizeSourceObservation(candidate, 1), true);
  r = await readSourceDiagnostics(dir, catalog, at);
  assert.equal(r.sources[0].history.length, 1);
  assert.equal(r.sources[0].status, "recent_news");
  assert.equal(r.sources[0].lastNewsSuccessAt, at);
});

test("status response mounts source diagnostics in local news independently of permission tracker", async () => {
  const page = await readFile("client/src/pages/clippers.tsx", "utf8");
  const mount = page.indexOf("<LocalNewsSourceDiagnostics diagnostics={localNews?.sourceDiagnostics}");
  const localNewsSection = page.lastIndexOf("<section", mount);
  const end = page.indexOf("</section>", mount);
  assert.ok(localNewsSection >= 0 && mount > localNewsSection && end > mount);
  const section = page.slice(localNewsSection, end);
  assert.match(section, /Noticias locales para X y Facebook/);
  assert.doesNotMatch(section, /permissionTracker/);
  assert.equal(page.match(/<LocalNewsSourceDiagnostics /g)?.length, 1);
});

test("real contribution is counted after cross-source dedupe, once per news event rather than Facebook/X copies or repeat fetches", async t => {
  const dir = await fixture(t);
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async text => ({
    "The federal agency issues a public safety update for residents": "La agencia federal emite una actualización de seguridad pública para los residentes",
    "The official agency has issued new safety guidance for residents.": "La agencia oficial ha emitido nuevas recomendaciones de seguridad para los residentes.",
    "Review the official source before taking action.": "Consulta la fuente oficial antes de actuar.",
  }[text] || "Actualización oficial verificada para la comunidad local.") } });
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.includes("weather.gov")) return Response.json({ features: [] });
    if (url.includes("sheriff.org")) return new Response("<script>let allNewsItems = [];</script>");
    if (!url.includes("/feeds/new-york") && !url.includes("field_component=1981")) return new Response("<rss><channel></channel></rss>");
    const link = url.includes("field_component=1981") ? "https://www.justice.gov/usao-sdny/pr/official-public-safety-update"
      : "https://www.fbi.gov/contact-us/field-offices/newyork/news/official-public-safety-update";
    return new Response(`<rss><channel><item><guid>${link}</guid><link>${link}</link><title>The federal agency issues a public safety update for residents</title><description>The official agency has issued new safety guidance for residents.</description><pubDate>${at}</pubDate></item></channel></rss>`);
  };
  const options = { workspaceDir: dir, env: { CLIPPERS_LOCAL_NEWS_HOT_ONLY: "false" },
    fetch: fetcher, translator, officialFeedTextFallback: async () => null };
  const first = await runClipperLocalNewsCycle({ ...options, now: at });
  assert.equal(first.created, 1);
  assert.equal(first.queued, 2);
  assert.equal(first.sourceObservations.reduce((sum, o) => sum + o.recentCandidateCount, 0), 2);
  const queueEvidence = JSON.parse(await readFile(path.join(dir, "metricool-queue.json"), "utf8")).items
    .map((item: any) => ({ publishDecision: item.publishDecision, verdicts: item.verdicts, reasons: item.reasons }));
  assert.equal(first.sourceObservations.reduce((sum, o) => sum + o.recentCount, 0), 1, JSON.stringify(queueEvidence));
  const contributor = first.sourceObservations.find(o => o.recentCount === 1)!;
  assert.ok(contributor);
  const second = await runClipperLocalNewsCycle({ ...options, now: "2026-10-06T08:03:00.000Z" });
  assert.equal(second.created, 0);
  assert.equal(second.sourceObservations.reduce((sum, o) => sum + o.recentCount, 0), 0);
  assert.equal(second.status.sourceDiagnostics.sources.find(s => s.id === contributor.sourceId)?.lastNewsSuccessAt, at);
});

test("known-date extracted news cannot become a genuine contribution when existing translation/review rejects it", async t => {
  const dir = await fixture(t);
  const translator = new LocalNewsTranslator({ enabled: true, adapter: { translate: async () => { throw Error("fake_translation_rejected"); } } });
  const cycle = await runClipperLocalNewsCycle({ workspaceDir: dir, now: at, translator,
    env: { CLIPPERS_LOCAL_NEWS_HOT_ONLY: "false" }, officialFeedTextFallback: async () => null,
    fetch: async input => {
      const url = String(input);
      if (url.includes("weather.gov")) return Response.json({ features: [] });
      if (url.includes("sheriff.org")) return new Response("<script>let allNewsItems = [];</script>");
      if (!url.includes("miamidade")) return new Response("<rss><channel></channel></rss>");
      return new Response(`<rss><channel><item><guid>a</guid><link>https://www.miamidade.gov/global/news-item.page?Mduid_news=a</link><title>Official public safety update</title><description>Verified safety update for residents.</description><pubDate>${at}</pubDate></item></channel></rss>`);
    },
  });
  const observed = cycle.sourceObservations.find(o => o.sourceId === source.id)!;
  assert.equal(observed.recentCandidateCount, 1);
  assert.equal(observed.recentCount, 0);
  assert.equal(observed.outcome, "candidates_only");
  assert.equal(cycle.status.sourceDiagnostics.sources.find(s => s.id === source.id)?.lastNewsSuccessAt, null);
});
