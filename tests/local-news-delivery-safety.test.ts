import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deliverClipperLocalNewsToMetricool, __clipperLocalNewsMetricoolInternals, type ClipperLocalNewsMetricoolOptions } from "../server/clippers-local-news-metricool";
import { canonicalNewsArticleUrl, newsArticleIdentity, newsSourceMatchesCity, readLocalNewsDeliveryPolicy, type LocalNewsDeliveryPolicy } from "../server/local-news-delivery-safety";
import { hashLocalNewsQueueReview, hashLocalNewsReviewValue } from "../server/clippers-local-news-review-committee";
import { createClipperLocalNewsScheduler } from "../server/clippers-local-news-scheduler";
import { ingestClipperLocalNewsEvents } from "../server/clippers-local-news-agent";

const now = () => new Date("2026-09-30T16:30:00.000Z");
const article = "https://www.miamidade.gov/global/news-item.page?Mduid_news=news1790773023764344";
const policy: LocalNewsDeliveryPolicy = {
  paused: false, reason: "isolated fake authorization",
  destinations: { "miami-news": { blogId: "501", identityVerified: true, permissionVerifiedUntil: "2027-01-01T00:00:00.000Z", networkAccounts: { facebook: "fake-page-id" } } },
};
function reviewed(overrides: Record<string, unknown> = {}) {
  const item: any = {
    id: "public-safety", eventId: "fire-prevention", eventRevision: 1,
    lane: "miami-news", platform: "facebook", source: "Miami-Dade County",
    sourceUrl: article, copy: "Public Safety — Safe Lithium-Ion battery charging during Fire Prevention Week.",
    risk: "medium", status: "auto_eligible", autoEligible: true, approvalRequired: false,
    published: false, createdAt: "2026-09-30T16:00:00.000Z",
    originalPublishedAt: "2026-09-30T12:00:00.000Z",
    canonicalEventIdentity: "a".repeat(64), claimIdentityHash: "b".repeat(64),
    checkedAt: "2026-09-30T16:00:00.000Z", publishDecision: "auto_publish", consensus: "unanimous_approve",
    verdicts: ["source_verifier", "safety_editor", "monetization_editor"].map(role => ({
      role, verdict: "approve", reasons: ["fixture"], evidence: ["fixture"], checkedAt: "2026-09-30T16:00:00.000Z",
    })),
    ...overrides,
  };
  item.evidence = overrides.evidence ?? ["connector=miami-dade-news", `copyHash=${hashLocalNewsReviewValue(item.copy)}`];
  item.reviewHash = hashLocalNewsQueueReview({
    queueItemId: item.id, eventId: item.eventId, eventRevision: item.eventRevision, lane: item.lane,
    copy: item.copy, platform: item.platform, risk: item.risk, canonicalEventIdentity: item.canonicalEventIdentity,
    claimIdentityHash: item.claimIdentityHash, verdicts: item.verdicts, evidence: item.evidence,
    consensus: item.consensus, publishDecision: item.publishDecision, checkedAt: item.checkedAt,
    originalPublishedAt: item.originalPublishedAt, expires: item.expires,
  });
  return item;
}
async function fixture(items = [reviewed()]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "news-safety-"));
  await writeFile(path.join(dir, "metricool-queue.json"), JSON.stringify({ items }));
  return dir;
}
function options(dir: string, fetcher?: typeof fetch): ClipperLocalNewsMetricoolOptions {
  return { workspaceDir: dir, now, env: { METRICOOL_USER_TOKEN: "fake", METRICOOL_USER_ID: "123", METRICOOL_MIAMI_NEWS_BLOG_ID: "501" },
    readPolicy: async () => policy, fetch: fetcher ?? (async input =>
      String(input).includes("simpleProfiles") ? Response.json([{ id: 501, label: "Miami News", facebook: "fake-page", facebookPageId: "fake-page-id", canPublish: true }])
        : Response.json({ id: "fake-accepted" })) };
}

test("committed pause survives a new process and credentials cannot override it", async () => {
  assert.equal((await readLocalNewsDeliveryPolicy()).paused, true);
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
    'import {readLocalNewsDeliveryPolicy} from "./server/local-news-delivery-safety.ts";console.log((await readLocalNewsDeliveryPolicy()).paused)'],
  { cwd: process.cwd(), env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "true");
  const dir = await fixture();
  let calls = 0;
  const config = options(dir, async () => { calls++; throw new Error("no real request"); });
  delete config.readPolicy;
  const result = await deliverClipperLocalNewsToMetricool(config);
  assert.equal(result.status, "paused");
  assert.equal(calls, 0);
  assert.equal(result.publicationConfirmed, 0);
});

test("scheduler automatic and manual runNow both reach the paused boundary", async () => {
  const dir = await fixture();
  let network = 0;
  const scheduler = createClipperLocalNewsScheduler({
    env: {}, bootstrap: async () => ({} as never), runCycle: async () => ({ status: {} } as never),
    deliver: () => deliverClipperLocalNewsToMetricool({ ...options(dir, async () => { network++; throw Error("forbidden"); }), readPolicy: readLocalNewsDeliveryPolicy }),
    setInterval: () => ({ unref() {} } as never), clearInterval: () => {}, log: () => {},
  });
  scheduler.start();
  while (scheduler.status().running) await new Promise(resolve => setTimeout(resolve, 1));
  await scheduler.runNow();
  scheduler.stop();
  assert.equal(network, 0);
});

test("a cycle already waiting for media cannot POST when policy becomes paused", async () => {
  const dir = await fixture([reviewed({ mediaUrl: "https://www.miamidade.gov/image.jpg" })]);
  let paused = false, posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    ...options(dir, async (input, init) => {
      if (String(input).includes("simpleProfiles")) return Response.json([{ id: 501, label: "Miami News", facebook: "fake-page", facebookPageId: "fake-page-id", canPublish: true }]);
      if (String(input).includes("normalize")) { paused = true; return Response.json({ id: "fake-media" }); }
      if (init?.method === "POST") posts++;
      return Response.json({ id: "forbidden" });
    }),
    readPolicy: async () => ({ ...policy, paused }),
  });
  assert.equal(result.status, "paused");
  assert.equal(posts, 0);
});

test("manual brand selection still requires discovery, matching identity, network and current permission", async () => {
  for (const profile of [
    { id: 501, label: "Miami News", facebook: null, canPublish: true },
    { id: 501, label: "Miami News", facebook: "page" },
    { id: 501, label: "Other City", facebook: "page", canPublish: true },
    { id: 999, label: "Miami News", facebook: "page", canPublish: true },
    { id: 501, label: "Miami News", facebook: "page", facebookPageId: "wrong-page", canPublish: true },
  ]) {
    const dir = await fixture();
    let posts = 0, reads = 0;
    const result = await deliverClipperLocalNewsToMetricool(options(dir, async (input, init) => {
      if (String(input).includes("simpleProfiles")) { reads++; return Response.json([{ facebookPageId: "fake-page-id", ...profile }]); }
      if (init?.method === "POST") posts++;
      return Response.json({ id: "forbidden" });
    }));
    assert.equal(reads, 1);
    assert.equal(result.status, "blocked");
    assert.equal(posts, 0);
  }
  const dir = await fixture();
  assert.equal((await deliverClipperLocalNewsToMetricool({ ...options(dir), readPolicy: async () => ({ ...policy, destinations: {} }) })).scheduled, 0);
});

test("source/city/date rejection includes unknown, future and publication-time expiry", async () => {
  for (const overrides of [
    { sourceUrl: undefined }, { source: "" }, { evidence: ["connector=doj-sdny"] },
    { originalPublishedAt: null }, { originalPublishedAt: "2026-10-01T00:00:00.000Z" },
    { originalPublishedAt: "2026-09-29T16:31:00.000Z" }, // expires before +2 minute slot
    { expires: "2026-09-30T16:31:00.000Z" },
  ]) {
    let posts = 0;
    const dir = await fixture([reviewed(overrides)]);
    await deliverClipperLocalNewsToMetricool(options(dir, async (input, init) => {
      if (init?.method === "POST") posts++;
      return String(input).includes("simpleProfiles")
        ? Response.json([{ id: 501, label: "Miami News", facebook: "page", facebookPageId: "fake-page-id", canPublish: true }])
        : Response.json({ id: "forbidden" });
    }));
    assert.equal(posts, 0);
  }
  assert.equal(newsSourceMatchesCity(reviewed({ lane: "ny-news" })), false);
  assert.equal(__clipperLocalNewsMetricoolInternals.queueItemIsFresh(reviewed({ originalPublishedAt: null }), now().getTime(), {}), false);
});

test("article identity ignores headings/media/tracking but preserves Mduid_news and other selectors", () => {
  assert.equal(newsArticleIdentity(article), newsArticleIdentity(article + "&utm_source=facebook&fbclid=abc#image"));
  assert.notEqual(newsArticleIdentity(article), newsArticleIdentity(article.replace("news1790773023764344", "different-article")));
  assert.notEqual(newsArticleIdentity(article + "&edition=1"), newsArticleIdentity(article + "&edition=2"));
  assert.ok(canonicalNewsArticleUrl(article)?.includes("Mduid_news="));
});

test("legacy Miami-Dade Public Safety / Update variants with no original date cannot dispatch", async () => {
  const items = [
    reviewed({ originalPublishedAt: undefined }),
    reviewed({ id: "update", eventRevision: 2, copy: "Update — Fire Prevention Week, safe Lithium-Ion charging.", originalPublishedAt: undefined }),
  ];
  const dir = await fixture(items);
  const before = await readFile(path.join(dir, "metricool-queue.json"), "utf8");
  let calls = 0;
  const result = await deliverClipperLocalNewsToMetricool(options(dir, async () => { calls++; throw Error("forbidden"); }));
  assert.equal(calls, 0);
  assert.equal(result.scheduled, 0);
  assert.equal(await readFile(path.join(dir, "metricool-queue.json"), "utf8"), before);
});

test("event updates cannot reset original date or replace a known missing date with ingestion time", async () => {
  for (const effective of [undefined, "2026-09-29T12:00:00.000Z"]) {
    const dir = await fixture([]);
    const event = { sourceEventId: "stable-article", source: "Miami-Dade County", sourceUrl: article,
      lane: "miami-news" as const, title: "Fire Prevention Week", description: "Safe Lithium-Ion battery charging.", effective };
    await ingestClipperLocalNewsEvents({ workspaceDir: dir, env: { NODE_ENV: "test" }, now: now().toISOString(), events: [event] });
    await ingestClipperLocalNewsEvents({ workspaceDir: dir, env: { NODE_ENV: "test" }, now: now().toISOString(),
      events: [{ ...event, title: "Update — Fire Prevention Week", effective: now().toISOString() }] });
    const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.events[0].originalPublishedAt, effective ?? null);
    assert.equal(state.queue.at(-1).originalPublishedAt, effective ?? null);
  }
});

test("reviewed date cannot be changed after committee approval", async () => {
  const item = reviewed();
  item.originalPublishedAt = "2026-09-30T16:00:00.000Z";
  const dir = await fixture([item]);
  let calls = 0;
  await deliverClipperLocalNewsToMetricool(options(dir, async () => { calls++; throw Error("forbidden"); }));
  assert.equal(calls, 0);
});

test("Miami-Dade Public Safety / Update failed attempts remain recorded and are never resent", async () => {
  const dir = await fixture([reviewed(), reviewed({ id: "update", eventRevision: 2, copy: "Update — Safe Lithium-Ion battery charging during Fire Prevention Week.", sourceUrl: article + "&utm_source=update", mediaUrl: "https://www.miamidade.gov/new-image.jpg" })]);
  const attempts = ["public-safety", "update"].map(queueItemId => ({
    attemptId: queueItemId, queueItemId, articleIdentity: newsArticleIdentity(article),
    lane: "miami-news", platform: "facebook", startedAt: "2026-09-30T16:00:00.000Z", state: "rejected", httpStatus: 400,
  }));
  const file = path.join(dir, "metricool-delivery-attempts.json");
  const before = JSON.stringify(attempts);
  await writeFile(file, before);
  let calls = 0;
  const result = await deliverClipperLocalNewsToMetricool(options(dir, async () => { calls++; throw Error("do not retry"); }));
  assert.equal(calls, 0);
  assert.equal(result.scheduled, 0);
  assert.equal(result.duplicatesSuppressed, 2);
  assert.equal(await readFile(file, "utf8"), before);
});

test("uncertain response reserves article before POST and survives subsequent cycle/restart", async () => {
  const dir = await fixture();
  let posts = 0;
  const transport: typeof fetch = async (input, init) => {
    if (String(input).includes("simpleProfiles")) return Response.json([{ id: 501, label: "Miami News", facebook: "page", facebookPageId: "fake-page-id", canPublish: true }]);
    if (init?.method === "POST") { posts++; throw Error("ambiguous response"); }
    throw Error("unexpected");
  };
  const first = await deliverClipperLocalNewsToMetricool(options(dir, transport));
  assert.equal(first.pendingReconciliation, 1);
  assert.equal(first.reason, "metricool_reconciliation_required");
  assert.equal(first.scheduled, 0);
  await writeFile(path.join(dir, "metricool-queue.json"), JSON.stringify({ items: [reviewed({ id: "update", copy: "Update — same article", sourceUrl: article + "&gclid=123" })] }));
  const second = await deliverClipperLocalNewsToMetricool(options(dir, transport));
  assert.equal(posts, 1);
  assert.equal(second.pendingReconciliation, 1);
  assert.equal(second.alreadyScheduled, 0);
});

test("accepted scheduling never implies confirmed publication; unknown success body is reconciled", async () => {
  const dir = await fixture();
  const result = await deliverClipperLocalNewsToMetricool(options(dir));
  assert.equal(result.scheduled, 1);
  assert.equal(result.publicationConfirmed, 0);
  const other = await fixture();
  const ambiguous = await deliverClipperLocalNewsToMetricool(options(other, async input =>
    String(input).includes("simpleProfiles") ? Response.json([{ id: 501, label: "Miami News", facebook: "page", facebookPageId: "fake-page-id", canPublish: true }]) : Response.json({})));
  assert.equal(ambiguous.scheduled, 0);
  assert.equal(ambiguous.pendingReconciliation, 1);
});
