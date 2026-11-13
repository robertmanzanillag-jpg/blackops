import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { getPublicLocalNewsBySlug, listPublicLocalNews, renderPublicLocalNewsShareHtml } from "../server/public-local-news";
import { hashLocalNewsCanonicalEventIdentity, hashLocalNewsQueueReview, hashLocalNewsReviewValue } from "../server/clippers-local-news-review-committee";
import { registerRoutes } from "../server/routes";
import { requireAppUser } from "../server/user-context";

const NOW = "2026-07-21T12:00:00.000Z";
let workspaceDir = "";
let server: Server;
let baseUrl = "";
const envSnapshot = {
  NODE_ENV: process.env.NODE_ENV,
  ALLOW_DEV_USER_FALLBACK: process.env.ALLOW_DEV_USER_FALLBACK,
  DEFAULT_USER_ID: process.env.DEFAULT_USER_ID,
  CLIPPERS_LOCAL_NEWS_WORKSPACE: process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
};

const miamiEvent = {
  id: "miami-event-1234567890",
  lane: "miami-news",
  title: "Flood Watch",
  description: "Heavy rain is possible.",
  instruction: "Monitor official updates.",
  location: "Miami-Dade",
  eventType: "Flood Watch",
  source: "National Weather Service",
  sourceUrl: "https://www.weather.gov/example-miami",
  severity: "Moderate",
  urgency: "Expected",
  certainty: "Likely",
  risk: "medium",
  lifecycle: "active",
  effective: "2026-07-21T11:00:00.000Z",
  expires: "2026-07-22T01:00:00.000Z",
  firstSeenAt: "2026-07-21T11:00:00.000Z",
  updatedAt: NOW,
  resolvedAt: null,
  revision: 2,
};

const nyEvent = {
  ...miamiEvent,
  id: "ny-event-1234567890",
  lane: "ny-news",
  title: "Road Closure",
  description: "A route is temporarily closed.",
  location: "Manhattan",
  eventType: "Traffic closure",
  source: "NY511",
  sourceUrl: "https://www.511ny.org/example",
  risk: "low",
};

const highRiskEvent = {
  ...miamiEvent,
  id: "high-risk-event-1234",
  title: "Severe emergency",
  eventType: "Emergency",
  risk: "high" as const,
};

const crossJurisdictionEvent = {
  ...miamiEvent,
  id: "cross-jurisdiction-event-1234",
  title: "Chicago federal case update",
  description: "A case from the Northern District of Illinois.",
  location: "Miami area",
  eventType: "Federal case update",
  source: "U.S. Department of Justice",
  sourceUrl: "https://www.justice.gov/usao-ndil/pr/chicago-federal-case-update",
  risk: "low" as const,
};

function queueItem(overrides: Record<string, unknown>) {
  return {
    id: "queue-default",
    eventId: miamiEvent.id,
    eventRevision: 2,
    lane: "miami-news",
    platform: "x",
    copy: "INTERNAL QUEUE COPY MUST NEVER BE PUBLIC",
    risk: "medium",
    lifecycle: "active",
    status: "auto_eligible",
    approvalRequired: false,
    autoEligible: true,
    published: false,
    createdAt: NOW,
    ...overrides,
  };
}

function reviewedSensitiveQueueItem(event: typeof highRiskEvent = highRiskEvent, overrides: Record<string, unknown> = {}) {
  const claimIdentityHash = "a".repeat(64);
  const canonicalEventIdentity = hashLocalNewsCanonicalEventIdentity({ eventId: event.id, eventRevision: event.revision, lane: event.lane, title: event.title, description: event.description, instruction: event.instruction, location: event.location, eventType: event.eventType, source: event.source, sourceUrl: event.sourceUrl, risk: event.risk, lifecycle: event.lifecycle, effective: event.effective, expires: event.expires, claimIdentityHash });
  const base = queueItem({ id: "reviewed-sensitive", eventId: event.id, eventRevision: event.revision, canonicalEventIdentity, claimIdentityHash, lane: event.lane, platform: "facebook", risk: event.risk, copy: "Arresto confirmado por una fuente oficial; toda persona se presume inocente.", ...overrides });
  const checkedAt = "2026-07-21T11:40:00.000Z";
  const verdicts = (["source_verifier", "safety_editor", "monetization_editor"] as const).map((role) => ({ role, verdict: "approve" as const, reasons: ["verified"], evidence: ["official"], checkedAt }));
  const evidence = ["connector=official-sensitive", `claimHash=${claimIdentityHash}`, `copyHash=${hashLocalNewsReviewValue(base.copy)}`];
  const reviewed = { ...base, verdicts, evidence, consensus: "unanimous_approve" as const, publishDecision: "auto_publish" as const, checkedAt };
  return { ...reviewed, reviewHash: hashLocalNewsQueueReview({ queueItemId: reviewed.id, eventId: reviewed.eventId, eventRevision: reviewed.eventRevision, lane: reviewed.lane, copy: reviewed.copy, platform: reviewed.platform, risk: reviewed.risk, canonicalEventIdentity: reviewed.canonicalEventIdentity, claimIdentityHash: reviewed.claimIdentityHash, verdicts, evidence, consensus: reviewed.consensus, publishDecision: reviewed.publishDecision, checkedAt }) };
}

test.before(async () => {
  workspaceDir = await mkdtemp(path.join(os.tmpdir(), "public-local-news-"));
  await writeFile(path.join(workspaceDir, "state.json"), JSON.stringify({
    version: 1,
    bootstrappedAt: NOW,
    updatedAt: NOW,
    lastRunAt: NOW,
    scheduleMinutes: 3,
    events: [miamiEvent, nyEvent, highRiskEvent, crossJurisdictionEvent],
    queue: [
      queueItem({ id: "miami-x", platform: "x" }),
      queueItem({
        id: "miami-facebook",
        platform: "facebook",
        organicGrowth: {
          zeroCost: true,
          experiment: "deterministic_observed_metrics",
          variantId: "utility",
          headline: { es: "Tiempo en Miami-Dade: Flood Watch", en: "Weather in Miami-Dade: Flood Watch" },
          headlineVariants: {
            utility: { es: "Tiempo en Miami-Dade: Flood Watch", en: "Weather in Miami-Dade: Flood Watch" },
            impact: { es: "Lo que debes saber en Miami-Dade: Flood Watch", en: "What to know in Miami-Dade: Flood Watch" },
          },
          ownedArticleUrl: "https://news.example.com/news/article/miami-update-test?utm_source=metricool",
          hashtags: ["#Miami", "#Tiempo"],
          shortForm: { ready: true, format: "9:16", durationSeconds: 8, soundRequired: true, renderMode: "local_template", scenes: [] },
        },
      }),
      queueItem({ id: "ny-x", eventId: nyEvent.id, lane: "ny-news", risk: "low" }),
      queueItem({ id: "high-x", eventId: highRiskEvent.id, eventRevision: 1 }),
      queueItem({
        id: "cross-jurisdiction-facebook",
        eventId: crossJurisdictionEvent.id,
        eventRevision: crossJurisdictionEvent.revision,
        platform: "facebook",
        sourceUrl: crossJurisdictionEvent.sourceUrl,
        evidence: ["connector=none"],
        risk: "low",
      }),
      queueItem({ id: "quarantined-ny", eventId: nyEvent.id, eventRevision: 2, lane: "ny-news", platform: "facebook", risk: "low", status: "quarantined", approvalRequired: false, autoEligible: false }),
      queueItem({ id: "rejected-ny", eventId: nyEvent.id, eventRevision: 2, lane: "ny-news", platform: "x", risk: "low", status: "rejected", approvalRequired: false, autoEligible: false }),
    ],
    metrics: [],
  }, null, 2));
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({
    version: 1,
    entries: [
      { queueItemId: "miami-x", lane: "miami-news", platform: "x", blogId: "private-blog-id", scheduledFor: "2026-07-21T11:50:00.000Z", scheduledAt: NOW, metricoolPostId: "secret-provider-id", token: "never-public" },
      { queueItemId: "miami-facebook", lane: "miami-news", platform: "facebook", blogId: "private-blog-id", scheduledFor: "2026-07-21T11:52:00.000Z", scheduledAt: NOW, metricoolPostId: "secret-provider-id-2" },
      { queueItemId: "ny-x", lane: "ny-news", platform: "x", blogId: "private-ny", scheduledFor: "2099-07-21T12:15:00.000Z", scheduledAt: NOW, metricoolPostId: "future-provider-id" },
      { queueItemId: "high-x", lane: "miami-news", platform: "x", blogId: "private-high", scheduledFor: "2026-07-21T11:55:00.000Z", scheduledAt: NOW, metricoolPostId: null },
      { queueItemId: "cross-jurisdiction-facebook", lane: "miami-news", platform: "facebook", blogId: "private-miami", scheduledFor: "2026-07-21T11:54:00.000Z", scheduledAt: NOW, metricoolPostId: "must-not-publish-cross-city" },
      { queueItemId: "quarantined-ny", lane: "ny-news", platform: "facebook", blogId: "private-quarantine", scheduledFor: "2026-07-21T11:56:00.000Z", scheduledAt: NOW, metricoolPostId: "must-not-publish" },
      { queueItemId: "rejected-ny", lane: "ny-news", platform: "x", blogId: "private-reject", scheduledFor: "2026-07-21T11:57:00.000Z", scheduledAt: NOW, metricoolPostId: "must-not-publish" },
    ],
  }, null, 2));

  process.env.NODE_ENV = "production";
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  delete process.env.DEFAULT_USER_ID;
  process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE = workspaceDir;
  process.env.PUBLIC_BASE_URL = "https://news.example.com";
  const app = express();
  app.use(express.json());
  app.use(requireAppUser);
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(workspaceDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("ledger evidence gates articles and X/Facebook rows deduplicate to one bilingual story", async () => {
  const feed = await listPublicLocalNews({ workspaceDir, lang: "es", limit: 50 });
  assert.equal(feed.articles.length, 1);
  const article = feed.articles[0];
  assert.equal(article.city, "miami");
  assert.equal(article.lang, "es");
  assert.deepEqual(article.publicationEvidence.platforms, ["facebook", "x"]);
  assert.equal(article.translations.en.title, "Weather in Miami-Dade: Flood Watch");
  assert.equal(article.translations.es.title, "Tiempo en Miami-Dade: Flood Watch");
  assert.deepEqual(article.organicGrowth, {
    zeroCost: true,
    variantId: "utility",
    headlineVariants: {
      utility: { es: "Tiempo en Miami-Dade: Flood Watch", en: "Weather in Miami-Dade: Flood Watch" },
      impact: { es: "Lo que debes saber en Miami-Dade: Flood Watch", en: "What to know in Miami-Dade: Flood Watch" },
    },
    hashtags: ["#Miami", "#Tiempo"],
    shortFormReady: true,
  });
  assert.match(article.translations.es.body, /no pretende ser una traducción completa/);

  const serialized = JSON.stringify(feed);
  for (const forbidden of ["INTERNAL QUEUE COPY", "private-blog-id", "secret-provider-id", "never-public", "Chicago federal case update", workspaceDir]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(serialized, /high-risk-event|Road Closure/);
  assert.match(article.slug, /^miami-update-/);
  assert.equal(
    article.slug,
    (await listPublicLocalNews({ workspaceDir, lang: "en" })).articles[0].slug,
    "article URLs must remain stable across languages and mutable presentation fields",
  );
});

test("serves the last known-good feed while a large state file is being replaced", async () => {
  const statePath = path.join(workspaceDir, "state.json");
  const originalState = await readFile(statePath, "utf8");
  const before = await listPublicLocalNews({ workspaceDir, lang: "es", limit: 50 });
  try {
    await writeFile(statePath, "{\n");
    const duringReplacement = await listPublicLocalNews({ workspaceDir, lang: "es", limit: 50 });
    assert.deepEqual(duringReplacement, before);
  } finally {
    await writeFile(statePath, originalState);
  }
});

test("city filters, language projection, detail lookup, and safe share metadata work", async () => {
  const miami = await listPublicLocalNews({ workspaceDir, city: "miami", lang: "en", limit: 1 });
  assert.equal(miami.articles.length, 1);
  assert.equal(miami.articles[0].title, miami.articles[0].translations.en.title);
  const ny = await listPublicLocalNews({ workspaceDir, city: "new-york", lang: "en" });
  assert.equal(ny.articles.length, 0, "NY has no Metricool ledger evidence");

  const detail = await getPublicLocalNewsBySlug(miami.articles[0].slug, { workspaceDir, lang: "es" });
  assert.equal(detail?.title, detail?.translations.es.title);
  const html = renderPublicLocalNewsShareHtml(detail!, "https://example.com/news/miami/story", "https://example.com/logo.png");
  assert.match(html, /property="og:title"/);
  assert.match(html, /https:\/\/example.com\/news\/miami\/story/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /property="og:image:secure_url"/);
  assert.match(html, /property="og:image:type" content="image\/png"/);
  assert.match(html, /property="og:image:width" content="1254"/);
  assert.match(html, /name="twitter:image"/);
  assert.match(html, /property="og:locale"/);
  assert.match(html, /hreflang="es"/);
  assert.match(html, /hreflang="en"/);
  assert.match(html, /hreflang="x-default"/);
  assert.match(html, /"@type":"NewsArticle"/);
  assert.match(html, /id="share-update"/);
  assert.match(html, /navigator\.share/);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /private-blog-id|INTERNAL QUEUE COPY/);
});

test("public HTTP feed bypasses auth, validates queries, supports ETag, and returns 404 for unknown slugs", async () => {
  const response = await fetch(`${baseUrl}/api/public/local-news?city=miami&lang=en&limit=10`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /public/);
  const etag = response.headers.get("etag");
  assert.ok(etag);
  const body = await response.json() as { articles: Array<{ slug: string }> };
  assert.equal(body.articles.length, 1);

  const notModified = await fetch(`${baseUrl}/api/public/local-news?city=miami&lang=en&limit=10`, { headers: { "If-None-Match": etag! } });
  assert.equal(notModified.status, 304);
  const invalid = await fetch(`${baseUrl}/api/public/local-news?city=boston&limit=0`);
  assert.equal(invalid.status, 400);
  const missing = await fetch(`${baseUrl}/api/public/local-news/does-not-exist?lang=es`);
  assert.equal(missing.status, 404);

  const share = await fetch(`${baseUrl}/news/article/${body.articles[0].slug}?lang=es`);
  assert.equal(share.status, 200);
  const shareHtml = await share.text();
  assert.match(shareHtml, /property="og:title"/);
  assert.match(shareHtml, /https:\/\/news\.example\.com\/local-news\/miami-news-profile\.png/);
  assert.match(shareHtml, /https:\/\/news\.example\.com\/news\/article\//);
});

test("publishes a sensitive current revision only with an intact unanimous committee review", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "public-local-news-sensitive-"));
  try {
    const sensitiveEvent = { ...highRiskEvent, title: "Defendant faces three counts", description: "The defendant was taken into custody after a criminal complaint.", eventType: "Criminal complaint", source: "U.S. Attorney for the Southern District of Florida", sourceUrl: "https://www.justice.gov/usao-sdfl/pr/example" };
    const reviewed = reviewedSensitiveQueueItem(sensitiveEvent);
    const writeState = async (candidate: unknown, event: typeof sensitiveEvent = sensitiveEvent) => writeFile(path.join(dir, "state.json"), JSON.stringify({
      version: 1, updatedAt: NOW, events: [event], queue: [candidate],
    }), "utf8");
    await writeState(reviewed);
    await writeFile(path.join(dir, "metricool-delivery-ledger.json"), JSON.stringify({
      version: 1,
      entries: [{
        queueItemId: reviewed.id,
        eventId: reviewed.eventId,
        eventRevision: reviewed.eventRevision,
        canonicalEventIdentity: reviewed.canonicalEventIdentity,
        reviewHash: reviewed.reviewHash,
        copyHash: hashLocalNewsReviewValue(reviewed.copy),
        reviewedCopyHash: hashLocalNewsReviewValue(reviewed.copy),
        lane: reviewed.lane,
        platform: reviewed.platform,
        blogId: "private-sensitive",
        scheduledFor: "2026-07-21T11:50:00.000Z",
        scheduledAt: "2026-07-21T11:45:00.000Z",
        metricoolPostId: "sensitive-post",
      }],
    }), "utf8");

    const approved = await listPublicLocalNews({ workspaceDir: dir, now: NOW });
    assert.equal(approved.articles.length, 1);
    assert.equal(approved.articles[0].source, sensitiveEvent.source);
    assert.equal(approved.articles[0].category, "public-safety");
    assert.match(approved.articles[0].translations.es.summary, /se presume inocente/);
    assert.match(approved.articles[0].translations.en.summary, /presumed innocent/);
    const approvedEn = await listPublicLocalNews({ workspaceDir: dir, now: NOW, lang: "en" });
    assert.match(renderPublicLocalNewsShareHtml(approvedEn.articles[0], "https://example.com/news/sensitive", "https://example.com/logo.png"), /presumed innocent/);

    await writeState({ ...reviewed, copy: `${reviewed.copy} Texto alterado después de la revisión.` });
    const tampered = await listPublicLocalNews({ workspaceDir: dir, now: NOW });
    assert.equal(tampered.articles.length, 0);

    await writeState(reviewed, { ...sensitiveEvent, description: `${sensitiveEvent.description} Contenido alterado sin nueva revisión.` });
    const eventTampered = await listPublicLocalNews({ workspaceDir: dir, now: NOW });
    assert.equal(eventTampered.articles.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uses the compact public snapshot and refuses to parse an oversized legacy state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "public-local-news-compact-"));
  try {
    const compactState = {
      version: 1,
      updatedAt: NOW,
      events: [miamiEvent],
      queue: [queueItem({ id: "compact-facebook", platform: "facebook" })],
    };
    await writeFile(path.join(dir, "public-news-snapshot.json"), JSON.stringify(compactState), "utf8");
    await writeFile(path.join(dir, "state.json"), `${" ".repeat(6 * 1024 * 1024)}not-json`, "utf8");
    await writeFile(path.join(dir, "metricool-delivery-ledger.json"), JSON.stringify({
      version: 1,
      entries: [{ queueItemId: "compact-facebook", lane: "miami-news", platform: "facebook", scheduledFor: "2026-07-21T11:52:00.000Z", scheduledAt: NOW }],
    }), "utf8");

    const compactFeed = await listPublicLocalNews({ workspaceDir: dir, city: "miami", now: NOW });
    assert.equal(compactFeed.articles.length, 1);
    assert.equal(compactFeed.articles[0].source, miamiEvent.source);

    await rm(path.join(dir, "public-news-snapshot.json"));
    const legacySize = (await stat(path.join(dir, "state.json"))).size;
    assert.ok(legacySize > 5 * 1024 * 1024);
    const safeEmptyFeed = await listPublicLocalNews({ workspaceDir: dir, city: "miami", now: "2026-07-21T12:01:00.000Z" });
    assert.deepEqual(safeEmptyFeed.articles, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
