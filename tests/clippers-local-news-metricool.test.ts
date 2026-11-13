import assert from "node:assert/strict";
import { access, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __clipperLocalNewsMetricoolInternals, deliverClipperLocalNewsToMetricool as deliver, getClipperLocalNewsMetricoolReadiness as readiness, hasCompleteLocalNewsCommitteeApproval, type ClipperLocalNewsMetricoolOptions } from "../server/clippers-local-news-metricool";
import type { LocalNewsDeliveryPolicy } from "../server/local-news-delivery-safety";
import { hashLocalNewsQueueReview, hashLocalNewsReviewValue } from "../server/clippers-local-news-review-committee";

function rawItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "queue-1",
    eventId: "event-1",
    eventRevision: 1,
    canonicalEventIdentity: "b".repeat(64),
    claimIdentityHash: "a".repeat(64),
    lane: "miami-news",
    platform: "x",
    copy: "Cierre local. Fuente oficial: https://example.gov/road",
    risk: "medium",
    status: "auto_eligible",
    approvalRequired: false,
    autoEligible: true,
    published: false,
    createdAt: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}

function unanimouslyReviewedItem(overrides: Record<string, unknown> = {}) {
  const { committeeConnector, ...itemOverrides } = overrides;
  const base = rawItem(itemOverrides);
  const ny = base.lane === "ny-news";
  Object.assign(base, {
    source: "Official city fixture",
    sourceUrl: `https://${ny ? "www.nyc.gov" : "www.miamidade.gov"}/global/news-item.page?Mduid_news=${base.eventId}`,
    originalPublishedAt: base.createdAt,
    ...itemOverrides,
  });
  const checkedAt = "2026-07-21T15:55:00.000Z";
  const reviewed = {
    ...base,
    verdicts: ["source_verifier", "safety_editor", "monetization_editor"].map((role) => ({ role, verdict: "approve", reasons: ["verified"], evidence: ["verified"], checkedAt })),
    evidence: [`connector=${typeof committeeConnector === "string" ? committeeConnector : ny ? "notify-nyc" : "miami-dade-news"}`, `claimHash=${"a".repeat(64)}`, `copyHash=${hashLocalNewsReviewValue(base.copy)}`],
    consensus: "unanimous_approve",
    publishDecision: "auto_publish",
    checkedAt,
  };
  const reviewHash = hashLocalNewsQueueReview({
    queueItemId: reviewed.id,
    eventId: reviewed.eventId,
    eventRevision: reviewed.eventRevision,
    lane: reviewed.lane,
    copy: reviewed.copy,
    platform: reviewed.platform,
    risk: reviewed.risk,
    canonicalEventIdentity: reviewed.canonicalEventIdentity,
    claimIdentityHash: reviewed.claimIdentityHash,
    verdicts: reviewed.verdicts as Parameters<typeof hashLocalNewsQueueReview>[0]["verdicts"],
    evidence: reviewed.evidence,
    consensus: reviewed.consensus as "unanimous_approve",
    publishDecision: reviewed.publishDecision as "auto_publish",
    checkedAt: reviewed.checkedAt,
    originalPublishedAt: (reviewed as Record<string, unknown>).originalPublishedAt as string,
    expires: (reviewed as Record<string, unknown>).expires as string | undefined,
  });
  return { ...reviewed, reviewHash };
}

function item(overrides: Record<string, unknown> = {}) {
  return unanimouslyReviewedItem(overrides);
}

async function workspace(items: unknown[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-news-metricool-"));
  await writeFile(path.join(dir, "metricool-queue.json"), JSON.stringify({ items }), "utf8");
  return dir;
}

const credentials = { METRICOOL_USER_TOKEN: "real-token", METRICOOL_USER_ID: "123", CLIPPERS_LOCAL_NEWS_ENABLE_X: "true" };
const fixedNow = () => new Date("2026-07-21T16:00:00.000Z");

// Explicit verified fixtures for legacy delivery-behaviour tests. Production
// remains paused. New safety tests exercise the real default and unknown rights.
function fixtureOptions(options: ClipperLocalNewsMetricoolOptions): ClipperLocalNewsMetricoolOptions {
  const policy: LocalNewsDeliveryPolicy = { paused: false, reason: "isolated fixture", destinations: {} };
  const originalFetch = options.fetch!;
  const register = (record: Record<string, unknown>) => {
    const label = record.label ?? record.name;
    const lane = label === "Miami News" || label === "ynb4b6r6" ? "miami-news"
      : label === "NY News" || label === "New York News" ? "ny-news" : null;
    if (lane) {
      policy.destinations[lane] = { blogId: String(record.blogId ?? record.id), identityVerified: true, permissionVerifiedUntil: "2030-01-01T00:00:00.000Z",
        networkAccounts: { facebook: `fixture-${lane}-facebook`, x: `fixture-${lane}-x` } };
      record.facebookPageId = `fixture-${lane}-facebook`;
      record.twitterId = `fixture-${lane}-x`;
      record.canPublish = true;
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(x => { if (x && typeof x === "object") register(x); });
      else if (child && typeof child === "object") register(child as Record<string, unknown>);
    }
  };
  return { ...options, readPolicy: async () => policy, fetch: async (input, init) => {
    if (new URL(String(input)).pathname !== "/api/admin/simpleProfiles") return originalFetch(input, init);
    // Older tests supplied a manually selected verified destination and only
    // mocked the POST. Discovery is now mandatory; supply explicit GET evidence.
    if (options.env?.METRICOOL_MIAMI_NEWS_BLOG_ID === "99" || options.env?.METRICOOL_NY_NEWS_BLOG_ID === "100") {
      const profiles = [
        { blogId: "99", label: "Miami News", networks: ["twitter", "facebook"] },
        { blogId: "100", label: "NY News", networks: ["twitter", "facebook"] },
      ];
      profiles.forEach(register);
      return Response.json({ profiles });
    }
    const response = await originalFetch(input, init);
    if (!response.ok) return response;
    const value = await response.json();
    if (Array.isArray(value)) value.forEach(register); else if (value && typeof value === "object") register(value);
    return Response.json(value);
  } };
}
const deliverClipperLocalNewsToMetricool = (options: ClipperLocalNewsMetricoolOptions) => deliver(fixtureOptions(options));
const getClipperLocalNewsMetricoolReadiness = (options: ClipperLocalNewsMetricoolOptions) => readiness(fixtureOptions(options));

test("missing credentials blocks without making a network request", async () => {
  const dir = await workspace([item()]);
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: {},
    workspaceDir: dir,
    fetch: async () => { fetched = true; throw new Error("should not fetch"); },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "missing_metricool_credentials");
  assert.equal(fetched, false);
});

test("X delivery is opt-in so the paid Metricool add-on stays off by default", async () => {
  const dir = await workspace([item()]);
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { METRICOOL_USER_TOKEN: "real-token", METRICOOL_USER_ID: "123" },
    workspaceDir: dir,
    fetch: async () => { fetched = true; throw new Error("disabled X must not reach Metricool"); },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 0);
  assert.equal(result.filtered, 1);
  assert.equal(fetched, false);
});

test("routine traffic is filtered from automatic delivery by default", async () => {
  const dir = await workspace([item({ id: "traffic-default", platform: "facebook", section: "traffic", copy: "TRÁFICO | Congestión rutinaria. Fuente: https://fl511.com" })]);
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("routine traffic must not reach Metricool"); },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.scanned, 1);
  assert.equal(result.eligible, 0);
  assert.equal(result.scheduled, 0);
  assert.equal(result.filtered, 1);
  assert.equal(fetched, false);
});

test("breaking or high-impact traffic remains eligible without enabling routine traffic", async () => {
  const dir = await workspace([item({ id: "traffic-breaking", platform: "facebook", section: "traffic", editorialUrgency: "breaking", risk: "high", copy: "URGENTE | Accidente con cierre total. Fuente: https://fl511.com" })]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [{ blogId: 501, label: "Miami News", networks: ["facebook"] }] }), { status: 200 });
      }
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ data: { uuid: "traffic-breaking-post" } }), { status: 201 });
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
});

test("medium developing traffic alerts with a real closure or crash remain eligible", async () => {
  const dir = await workspace([item({
    id: "traffic-developing-closure",
    platform: "facebook",
    section: "traffic",
    editorialUrgency: "developing",
    risk: "medium",
    copy: "ROAD CLOSURE | Crash closes two lanes on Broadway. Use an alternate route. Fuente: https://511.example/closure",
  })]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [{ blogId: 501, label: "Miami News", networks: ["facebook"] }] }), { status: 200 });
      }
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "traffic-developing-post" }), { status: 201 });
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
});
test("discovers the exact Miami News brand and sends one provider with safe scheduling fields", async () => {
  const dir = await workspace([item()]);
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [
          { id: 88, label: "Miami news", networks: ["twitter", "facebook"] },
          { blogId: 99, label: "Miami News", networks: ["twitter", "facebook"] },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { uuid: "metricool-post-1" } }), { status: 201 });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get("userId"), "123");
  assert.equal(calls[1].url.pathname, "/api/v2/scheduler/posts");
  assert.equal(calls[1].url.searchParams.get("blogId"), "99");
  assert.equal(calls[1].url.searchParams.get("jobId"), "queue-1");
  assert.equal((calls[1].init?.headers as Record<string, string>)["X-Mc-Auth"], "real-token");
  const payload = JSON.parse(String(calls[1].init?.body));
  assert.deepEqual(payload.providers, [{ network: "twitter" }]);
  assert.equal(payload.autoPublish, true);
  assert.equal(payload.draft, false);
  assert.equal(payload.shortener, false);
  assert.deepEqual(payload.smartLinkData, { ids: [] });
  assert.deepEqual(payload.facebookData, undefined);
  assert.equal(payload.publicationDate.timezone, "America/New_York");
  assert.equal(payload.publicationDate.dateTime, "2026-07-21T12:02:00");

  const ledger = await readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8");
  assert.match(ledger, /metricool-post-1/);
  assert.doesNotMatch(ledger, /real-token/);
});

test("maps the live Metricool Facebook brand labels to the correct Miami and New York lanes", async () => {
  const dir = await workspace([
    item({ id: "miami-facebook", platform: "facebook" }),
    item({ id: "ny-facebook", eventId: "event-ny", lane: "ny-news", platform: "facebook" }),
  ]);
  const scheduledBlogIds: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [
          { blogId: 501, label: "ynb4b6r6", networks: ["facebook"] },
          { blogId: 502, label: "New York News", networks: ["facebook"] },
        ] }), { status: 200 });
      }
      if (init?.method === "POST") scheduledBlogIds.push(url.searchParams.get("blogId") || "");
      return new Response(JSON.stringify({ id: `post-${scheduledBlogIds.length}` }), { status: 201 });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 2);
  assert.deepEqual(scheduledBlogIds, ["501", "502"]);
});

test("delivery-time jurisdiction filter purges legacy nationwide and cross-city queue rows", async () => {
  const dir = await workspace([
    item({
      id: "legacy-doj-nationwide",
      platform: "facebook",
      committeeConnector: "none",
      source: "U.S. Department of Justice",
      sourceUrl: "https://www.justice.gov/opa/pr/nationwide-enforcement-action",
    }),
    item({
      id: "legacy-fbi-wrong-lane",
      eventId: "legacy-fbi-event",
      platform: "facebook",
      committeeConnector: "fbi-ny",
      source: "Federal Bureau of Investigation New York",
      sourceUrl: "https://www.fbi.gov/contact-us/field-offices/newyork/news/example",
    }),
    item({
      id: "legacy-fbi-national-no-connector",
      eventId: "legacy-fbi-national-event",
      platform: "facebook",
      committeeConnector: "unknown-legacy-connector",
      source: "Federal Bureau of Investigation",
      sourceUrl: "https://www.fbi.gov/news/press-releases/national-update",
    }),
    item({
      id: "legacy-google-news-aggregator",
      eventId: "legacy-google-news-event",
      platform: "facebook",
      committeeConnector: "google-news-nyc",
      source: "Google News",
      sourceUrl: "https://news.google.com/rss/articles/legacy-aggregated-story",
    }),
  ]);
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("wrong-jurisdiction rows must not reach Metricool"); },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.eligible, 0);
  assert.equal(result.filtered, 4);
  assert.equal(result.scheduled, 0);
  assert.equal(fetched, false);
});

test("delivery-time jurisdiction filter preserves a verified local district article", async () => {
  const dir = await workspace([
    item({
      id: "local-doj-sdfl",
      platform: "facebook",
      committeeConnector: "doj-sdfl",
      source: "U.S. Attorney for the Southern District of Florida",
      sourceUrl: "https://www.justice.gov/usao-sdfl/pr/verified-local-case",
    }),
    item({
      id: "local-fbi-newyork",
      eventId: "local-fbi-newyork-event",
      lane: "ny-news",
      platform: "facebook",
      committeeConnector: "fbi-ny",
      source: "Federal Bureau of Investigation New York",
      sourceUrl: "https://www.fbi.gov/contact-us/field-offices/newyork/news/verified-local-case",
      copy: "Verified New York field-office update.",
    }),
  ]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99", METRICOOL_NY_NEWS_BLOG_ID: "100" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "local-district-post" }), { status: 200 });
    },
  });

  assert.equal(result.filtered, 0);
  assert.equal(result.scheduled, 2);
  assert.equal(posts, 2);
});

test("schedules Facebook breaking and traffic updates as text-only posts without requiring media", async () => {
  const dir = await workspace([
    item({ id: "miami-text-only", platform: "facebook", editorialUrgency: "breaking", copy: "TRÁFICO | Cierre en Miami-Dade. Según FHP/FL511: tome una ruta alterna. Fuente: https://fl511.com" }),
  ]);
  let scheduledPayload: Record<string, unknown> | null = null;

  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC: "true" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [
          { blogId: 501, label: "Miami News", networks: ["facebook"] },
        ] }), { status: 200 });
      }
      scheduledPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: { uuid: "facebook-text-only" } }), { status: 201 });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 1);
  assert.deepEqual(scheduledPayload?.providers, [{ network: "facebook" }]);
  assert.equal(scheduledPayload?.shortener, false);
  assert.deepEqual(scheduledPayload?.smartLinkData, { ids: [] });
  assert.deepEqual(scheduledPayload?.facebookData, { type: "POST", title: "TRÁFICO | Cierre en Miami-Dade. Según FHP/FL511: tome una ruta alterna. Fuente:" });
  assert.deepEqual(scheduledPayload?.publicationDate, { dateTime: "2026-07-21T12:00:00", timezone: "America/New_York" });
  assert.match(String(scheduledPayload?.text), /TRÁFICO/);
  assert.equal("media" in (scheduledPayload || {}), false);
  assert.equal("images" in (scheduledPayload || {}), false);
  assert.equal("attachments" in (scheduledPayload || {}), false);
});

test("spaces multiple breaking posts per account instead of assigning one immediate timestamp", async () => {
  const dir = await workspace(Array.from({ length: 3 }, (_, index) => item({
    id: `breaking-spaced-${index}`,
    eventId: `breaking-spaced-event-${index}`,
    platform: "facebook",
    editorialUrgency: "breaking",
    copy: `URGENTE | Actualización local verificada ${index}. Fuente: https://official.example.gov/${index}`,
    sourceUrl: `https://www.miamidade.gov/global/news-item.page?Mduid_news=${index}`,
  })));
  const dates: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    maxPerRun: 3,
    fetch: async (_input, init) => {
      dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime);
      return new Response(JSON.stringify({ id: `breaking-${dates.length}` }), { status: 200 });
    },
  });

  assert.equal(result.scheduled, 3);
  assert.deepEqual(dates, ["2026-07-21T12:00:00", "2026-07-21T12:15:00", "2026-07-21T12:30:00"]);
});

test("normalizes the existing public brand image and attaches it without any paid generation", async () => {
  const dir = await workspace([item({ id: "miami-facebook-image", platform: "facebook" })]);
  let scheduledPayload: Record<string, any> | null = null;
  let normalizedUrl = "";
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, PUBLIC_BASE_URL: "https://news.example.com" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [{ blogId: 501, label: "Miami News", networks: ["facebook"] }] }), { status: 200 });
      }
      if (url.pathname === "/api/actions/normalize/image/url") {
        normalizedUrl = url.searchParams.get("url") || "";
        return new Response(JSON.stringify({ mediaId: "media-123" }), { status: 200 });
      }
      scheduledPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "post-with-media" }), { status: 201 });
    },
  });

  assert.equal(normalizedUrl, "https://news.example.com/local-news/miami-news-profile.png");
  assert.deepEqual(scheduledPayload?.media, { mediaId: "media-123" });
  assert.equal(result.mediaAttached, 1);
  assert.equal(result.mediaFallback, 0);
});

test("retries transient Metricool media normalization before scheduling a link post", async () => {
  const dir = await workspace([item({ id: "miami-facebook-image-retry", platform: "facebook" })]);
  let normalizationAttempts = 0;
  let scheduledPayload: Record<string, any> | null = null;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, PUBLIC_BASE_URL: "https://news.example.com" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [{ blogId: 501, label: "Miami News", networks: ["facebook"] }] }), { status: 200 });
      }
      if (url.pathname === "/api/actions/normalize/image/url") {
        normalizationAttempts += 1;
        if (normalizationAttempts < 3) return new Response("temporary", { status: 503 });
        return new Response(JSON.stringify({ mediaId: "media-after-retry" }), { status: 200 });
      }
      scheduledPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "post-after-retry" }), { status: 201 });
    },
  });

  assert.equal(result.scheduled, 1);
  assert.equal(normalizationAttempts, 3);
  assert.deepEqual(scheduledPayload?.media, { mediaId: "media-after-retry" });
  assert.equal(result.mediaAttached, 1);
  assert.equal(result.mediaFallback, 0);
});

test("transient scheduler failure requires reconciliation without a write retry", async () => {
  const dir = await workspace([item({ id: "miami-facebook-schedule-retry", platform: "facebook" })]);
  let scheduleAttempts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, PUBLIC_BASE_URL: "https://news.example.com" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [{ blogId: 501, label: "Miami News", networks: ["facebook"] }] }), { status: 200 });
      }
      if (url.pathname === "/api/actions/normalize/image/url") return new Response(JSON.stringify({ mediaId: "media-ready" }), { status: 200 });
      scheduleAttempts += 1;
      if (scheduleAttempts < 3) return new Response("temporary", { status: 503 });
      return new Response(JSON.stringify({ id: "post-after-schedule-retry" }), { status: 201 });
    },
  });

  assert.equal(result.scheduled, 0);
  assert.equal(result.pendingReconciliation, 1);
  assert.equal(result.failed, 1);
  assert.equal(scheduleAttempts, 1);
});

test("prefers a verified source video over the fallback brand image", async () => {
  const dir = await workspace([item({ id: "miami-facebook-video", platform: "facebook", mediaUrl: "https://notify.nyc/media/closure.mp4", mediaType: "video" })]);
  let normalizedUrl = "";
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, PUBLIC_BASE_URL: "https://news.example.com" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") return new Response(JSON.stringify({ profiles: [{ blogId: 501, label: "Miami News", networks: ["facebook"] }] }), { status: 200 });
      if (url.pathname === "/api/actions/normalize/image/url") {
        normalizedUrl = url.searchParams.get("url") || "";
        return new Response(JSON.stringify({ mediaId: "source-video-media" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "video-post" }), { status: 201 });
    },
  });
  assert.equal(normalizedUrl, "https://notify.nyc/media/closure.mp4");
  assert.equal(result.mediaAttached, 1);
});

test("media normalization failure falls back to publishing the verified text", async () => {
  const dir = await workspace([item({ id: "miami-facebook-image-fallback", platform: "facebook" })]);
  let scheduledPayload: Record<string, any> | null = null;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, PUBLIC_BASE_URL: "https://news.example.com" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [{ blogId: 501, label: "Miami News", networks: ["facebook"] }] }), { status: 200 });
      }
      if (url.pathname === "/api/actions/normalize/image/url") return new Response("unavailable", { status: 503 });
      scheduledPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "fallback-post" }), { status: 201 });
    },
  });

  assert.equal(result.scheduled, 1);
  assert.equal(result.mediaAttached, 0);
  assert.equal(result.mediaFallback, 1);
  assert.equal("media" in (scheduledPayload || {}), false);
});

test("keeps cadence-deferred posts automatic but does not send them before notBefore", async () => {
  const dir = await workspace([
    item({ id: "deferred-facebook", platform: "facebook", gateReason: "cadence", notBefore: "2026-07-21T17:00:00.000Z" }),
  ]);
  let fetched = false;

  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("deferred item must not reach Metricool"); },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.eligible, 1);
  assert.equal(result.deferred, 1);
  assert.equal(result.scheduled, 0);
  assert.equal(fetched, false);
});

test("reports both Facebook news accounts ready while X remains independently pending", async () => {
  const readiness = await getClipperLocalNewsMetricoolReadiness({
    env: credentials,
    fetch: async () => new Response(JSON.stringify({ profiles: [
      { blogId: 501, label: "ynb4b6r6", networks: ["facebook", "tiktok"] },
      { blogId: 502, label: "New York News", networks: ["facebook"] },
    ] }), { status: 200 }),
  });

  assert.equal(readiness.status, "partial");
  assert.equal(readiness.connected, true);
  assert.equal(readiness.blocker, null);
  assert.deepEqual(readiness.platforms.facebook, { required: 2, connected: 2, ready: true });
  assert.deepEqual(readiness.platforms.x, { required: 2, connected: 0, ready: false });
  assert.equal(readiness.targets.filter((target) => target.platform === "facebook" && target.ready).length, 2);
  assert.equal(readiness.targets.filter((target) => target.platform === "x" && target.ready).length, 0);
});

test("readiness blocks safely without credentials and never performs discovery", async () => {
  let fetched = false;
  const readiness = await getClipperLocalNewsMetricoolReadiness({
    env: {},
    fetch: async () => { fetched = true; throw new Error("should not fetch"); },
  });

  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.connected, false);
  assert.equal(readiness.connectedConnections, 0);
  assert.equal(fetched, false);
});

test("readiness does not treat a blog id override as proof of an unverified provider", async () => {
  const readiness = await getClipperLocalNewsMetricoolReadiness({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "501" },
    fetch: async () => new Response(JSON.stringify({ profiles: [
      { blogId: 501, label: "renamed-miami", networks: ["facebook"] },
      { blogId: 502, label: "New York News", networks: ["facebook"] },
    ] }), { status: 200 }),
  });

  assert.equal(readiness.platforms.facebook.ready, false);
  assert.equal(readiness.platforms.x.ready, false);
});

test("filters unsigned high/critical and approval-required queue items even if their flags conflict", async () => {
  const dir = await workspace([
    rawItem({ id: "high", risk: "high" }),
    rawItem({ id: "critical", risk: "critical" }),
    item({ id: "review", status: "approval_required", approvalRequired: true, autoEligible: false }),
    item({ id: "safe", platform: "facebook" }),
  ]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    },
  });
  assert.equal(result.filtered, 3);
  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
});

test("quarantined and rejected stories do not block delivery of a safe item in the same queue", async () => {
  const dir = await workspace([
    item({ id: "safe-mixed", platform: "facebook" }),
    item({ id: "quarantined-mixed", risk: "critical", status: "quarantined", approvalRequired: false, autoEligible: false }),
    item({ id: "rejected-mixed", risk: "high", status: "rejected", approvalRequired: false, autoEligible: false }),
  ]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.filtered, 2);
  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
});

test("schedules a sensitive story only after unanimous three-role review with verified evidence", async () => {
  const dir = await workspace([unanimouslyReviewedItem({ id: "reviewed-high", risk: "high", platform: "facebook" })]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    },
  });
  assert.equal(result.filtered, 0);
  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
});

test("blocks sensitive copy changed after committee review", async () => {
  const reviewed = unanimouslyReviewedItem({ id: "tampered-high", risk: "critical", platform: "facebook" });
  const dir = await workspace([{ ...reviewed, copy: `${reviewed.copy} Texto añadido después.` }]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    },
  });
  assert.equal(result.filtered, 1);
  assert.equal(result.scheduled, 0);
  assert.equal(posts, 0);
});

test("blocks a discovered brand when its requested social profile is not connected", async () => {
  const dir = await workspace([item({ platform: "facebook" })]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      if (init?.method === "POST") posts += 1;
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify([{ id: 99, label: "Miami News", networks: ["twitter"] }]), { status: 200 });
      }
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "metricool_profile_or_provider_not_connected");
  assert.deepEqual(result.blockedLanes, ["miami-news"]);
  assert.equal(posts, 0);
});

test("durable ledger makes successful queue IDs idempotent across runs", async () => {
  const dir = await workspace([item()]);
  let posts = 0;
  const fetcher: typeof fetch = async () => {
    posts += 1;
    return new Response(JSON.stringify({ id: `post-${posts}` }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };
  assert.equal((await deliverClipperLocalNewsToMetricool(options)).scheduled, 1);
  const second = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(second.scheduled, 0);
  assert.equal(second.alreadyScheduled, 1);
  assert.equal(posts, 1);
});

test("durable ledger deduplicates the same event and copy when a later cycle changes queueItemId", async () => {
  const dir = await workspace([item({ id: "cycle-one-id" })]);
  let posts = 0;
  const fetcher: typeof fetch = async () => {
    posts += 1;
    return new Response(JSON.stringify({ id: `post-${posts}` }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };

  assert.equal((await deliverClipperLocalNewsToMetricool(options)).scheduled, 1);
  await writeFile(path.join(dir, "metricool-queue.json"), JSON.stringify({
    items: [item({ id: "cycle-two-id", copy: "  CIERRE local.  Fuente oficial: https://example.gov/road  " })],
  }), "utf8");

  const second = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(second.scheduled, 0);
  assert.equal(second.alreadyScheduled, 1);
  assert.equal(posts, 1);

  const ledger = JSON.parse(await readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8"));
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].eventId, "event-1");
  assert.match(ledger.entries[0].copyHash, /^[a-f0-9]{64}$/);
  assert.equal(ledger.entries[0].reviewedCopyHash, hashLocalNewsReviewValue(item().copy));
  assert.notEqual(ledger.entries[0].copyHash, ledger.entries[0].reviewedCopyHash);
});

test("durable ledger deduplicates the same official article URL after copy changes", async () => {
  const sourceUrl = "https://www.miamidade.gov/global/news-item.page?Mduid_news=one-story";
  const dir = await workspace([item({ id: "source-cycle-one", sourceUrl })]);
  let posts = 0;
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => {
      posts += 1;
      return new Response(JSON.stringify({ id: `post-${posts}` }), { status: 200 });
    },
  };
  assert.equal((await deliverClipperLocalNewsToMetricool(options)).scheduled, 1);
  await writeFile(path.join(dir, "metricool-queue.json"), JSON.stringify({
    items: [item({ id: "source-cycle-two", eventId: "different-event", sourceUrl, copy: "Different generated copy for the same official article." })],
  }), "utf8");
  const second = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(second.scheduled, 0);
  assert.equal(second.alreadyScheduled, 1);
  assert.equal(posts, 1);
});

test("legacy ledger without sourceUrlHash deduplicates the same event identity", async () => {
  const sourceUrl = "https://feeds.everbridge.net/feeds/453003085617722/rss/alert-1";
  const queued = item({
    id: "notify-nyc-translated-variant",
    eventId: "notify-nyc-alert-1",
    lane: "ny-news",
    platform: "facebook",
    committeeConnector: "notify-nyc",
    sourceUrl,
    copy: "Nueva variante bilingüe del mismo aviso oficial.",
  });
  const dir = await workspace([queued]);
  await writeFile(path.join(dir, "metricool-delivery-ledger.json"), JSON.stringify({
    version: 1,
    entries: [{
      queueItemId: "legacy-notify-queue-id",
      eventId: "notify-nyc-alert-1",
      eventRevision: 1,
      lane: "ny-news",
      platform: "facebook",
      blogId: "100",
      scheduledFor: "2026-07-21T15:00:00.000Z",
      scheduledAt: "2026-07-21T14:55:00.000Z",
      metricoolPostId: "legacy-notify-post",
    }],
  }), "utf8");
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_NY_NEWS_BLOG_ID: "100" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("legacy duplicate must not reach Metricool"); },
  });

  assert.equal(result.scheduled, 0);
  assert.equal(result.alreadyScheduled, 1);
  assert.equal(fetched, false);
});

test("breaking stories stop at the bounded daily burst instead of flooding an account", async () => {
  const dir = await workspace([item({ id: "breaking-over-cap", platform: "facebook", editorialUrgency: "breaking" })]);
  await writeFile(path.join(dir, "metricool-delivery-ledger.json"), JSON.stringify({
    version: 1,
    entries: Array.from({ length: 12 }, (_, index) => ({
      queueItemId: `already-${index}`,
      lane: "miami-news",
      platform: "facebook",
      blogId: "99",
      scheduledFor: `2026-07-21T${String(index + 12).padStart(2, "0")}:00:00.000Z`,
      scheduledAt: "2026-07-21T00:00:00.000Z",
      metricoolPostId: `post-${index}`,
    })),
  }), "utf8");
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("daily burst cap must stop the request"); },
  });
  assert.equal(result.scheduled, 0);
  assert.equal(result.deferred, 1);
  assert.equal(fetched, false);
});

test("an editorial revision of the same article cannot bypass source deduplication", async () => {
  const sourceUrl = "https://www.miamidade.gov/global/news-item.page?Mduid_news=developing-story";
  const dir = await workspace([item({ id: "initial-event-copy", sourceUrl })]);
  let posts = 0;
  const fetcher: typeof fetch = async () => {
    posts += 1;
    return new Response(JSON.stringify({ id: `post-${posts}` }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };

  assert.equal((await deliverClipperLocalNewsToMetricool(options)).scheduled, 1);
  await writeFile(path.join(dir, "metricool-queue.json"), JSON.stringify({
    items: [item({ id: "updated-event-copy", eventRevision: 2, sourceUrl, copy: "Reabierta la vía local. Fuente oficial: https://example.gov/road" })],
  }), "utf8");

  const second = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(second.scheduled, 0);
  assert.equal(second.alreadyScheduled, 1);
  assert.equal(posts, 1);
});

test("deduplicates identical copy inside one queue even when event and queue IDs differ", async () => {
  const dir = await workspace([
    item({ id: "duplicate-one", eventId: "event-one" }),
    item({ id: "duplicate-two", eventId: "event-two" }),
  ]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => {
      posts += 1;
      return new Response(JSON.stringify({ id: `post-${posts}` }), { status: 200 });
    },
  });

  assert.equal(result.scheduled, 1);
  assert.equal(result.alreadyScheduled, 1);
  assert.equal(posts, 1);
});

test("deduplicates one official article URL inside a single queue even when generated copy differs", async () => {
  const sourceUrl = "https://www.miamidade.gov/global/news-item.page?Mduid_news=shared-article";
  const dir = await workspace([
    item({ id: "source-duplicate-one", eventId: "source-event-one", sourceUrl, copy: "First generated version." }),
    item({ id: "source-duplicate-two", eventId: "source-event-two", sourceUrl, copy: "Second generated version." }),
  ]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => {
      posts += 1;
      return new Response(JSON.stringify({ id: `post-${posts}` }), { status: 200 });
    },
  });
  assert.equal(result.scheduled, 1);
  assert.equal(result.alreadyScheduled, 1);
  assert.equal(posts, 1);
});

test("does not deduplicate the same copy across different destination platforms", async () => {
  const dir = await workspace([
    item({ id: "same-copy-x", platform: "x" }),
    item({ id: "same-copy-facebook", platform: "facebook" }),
  ]);
  const providers: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      providers.push(JSON.parse(String(init?.body)).providers[0].network);
      return new Response(JSON.stringify({ id: `post-${providers.length}` }), { status: 200 });
    },
  });

  assert.equal(result.scheduled, 2);
  assert.deepEqual(providers, ["twitter", "facebook"]);
});

test("an alternate duplicate cannot retry an ambiguous write in the same run", async () => {
  const dir = await workspace([
    item({ id: "first-copy-attempt" }),
    item({ id: "second-copy-attempt" }),
  ]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [{ blogId: 99, label: "Miami News", networks: ["twitter"] }] }), { status: 200 });
      }
      posts += 1;
      return posts <= 3
        ? new Response(JSON.stringify({ error: "temporary" }), { status: 500 })
        : new Response(JSON.stringify({ id: "retry-success" }), { status: 200 });
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.failed, 1);
  assert.equal(result.scheduled, 0);
  assert.equal(posts, 1);
  const attempts = JSON.parse(await readFile(path.join(dir, "metricool-delivery-attempts.json"), "utf8"));
  assert.equal(attempts[0].queueItemId, "first-copy-attempt");
});

test("continues reading a legacy ledger without eventId or copyHash", async () => {
  const dir = await workspace([item({ id: "legacy-queue-id" })]);
  await writeFile(path.join(dir, "metricool-delivery-ledger.json"), JSON.stringify({
    version: 1,
    entries: [{
      queueItemId: "legacy-queue-id",
      lane: "miami-news",
      platform: "x",
      blogId: "99",
      scheduledFor: "2026-07-21T15:00:00.000Z",
      scheduledAt: "2026-07-21T14:58:00.000Z",
      metricoolPostId: "legacy-post",
    }],
  }), "utf8");
  let fetched = false;

  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("legacy duplicate must not reach Metricool"); },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 0);
  assert.equal(result.alreadyScheduled, 1);
  assert.equal(fetched, false);
});

test("failed scheduling preserves an uncertain attempt and cannot retry next run", async () => {
  const dir = await workspace([item()]);
  let scheduleAttempts = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/admin/simpleProfiles") {
      return new Response(JSON.stringify({ profiles: [{ blogId: 99, label: "Miami News", networks: ["twitter"] }] }), { status: 200 });
    }
    scheduleAttempts += 1;
    return scheduleAttempts <= 3
      ? new Response(JSON.stringify({ error: "rejected" }), { status: 500 })
      : new Response(JSON.stringify({ id: "retried-ok" }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };
  const first = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(first.failed, 1);
  await assert.rejects(readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8"), /ENOENT/);
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
  const second = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(second.scheduled, 0);
  assert.equal(second.pendingReconciliation, 1);
  assert.equal(scheduleAttempts, 1);
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
});

test("exclusive workspace lock prevents concurrent duplicate Metricool posts", async () => {
  const dir = await workspace([item()]);
  let postCount = 0;
  let signalPostStarted: (() => void) | undefined;
  let releasePost: (() => void) | undefined;
  const postStarted = new Promise<void>((resolve) => { signalPostStarted = resolve; });
  const holdPost = new Promise<void>((resolve) => { releasePost = resolve; });
  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") {
      postCount += 1;
      signalPostStarted?.();
      await holdPost;
    }
    return new Response(JSON.stringify({ id: "only-post" }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };

  const firstPromise = deliverClipperLocalNewsToMetricool(options);
  await postStarted;
  const competing = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(competing.status, "blocked");
  assert.equal(competing.reason, "metricool_delivery_in_progress");
  assert.equal(postCount, 1);

  releasePost?.();
  const first = await firstPromise;
  assert.equal(first.scheduled, 1);
  const ledger = JSON.parse(await readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8"));
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].queueItemId, "queue-1");
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
});

test("recovers a bounded stale lock and cleans up its replacement", async () => {
  const dir = await workspace([item()]);
  const lockPath = path.join(dir, "metricool-delivery-ledger.json.lock");
  await writeFile(lockPath, JSON.stringify({ ownerId: "dead-process" }), "utf8");
  const stale = new Date(Date.now() - 11 * 60_000);
  await utimes(lockPath, stale, stale);
  let posts = 0;

  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => {
      posts += 1;
      return new Response(JSON.stringify({ id: "recovered" }), { status: 200 });
    },
  });

  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
  await assert.rejects(access(lockPath), /ENOENT/);
});

test("spaces standard posts across the day and honors the run cap", async () => {
  const dir = await workspace([
    item({ id: "one" }),
    item({ id: "two", eventId: "event-2", copy: "Cierre en la avenida 2. Fuente oficial: https://example.gov/road/2" }),
    item({ id: "three", eventId: "event-3", copy: "Cierre en la avenida 3. Fuente oficial: https://example.gov/road/3" }),
  ]);
  const dates: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    maxPerRun: 2,
    fetch: async (_input, init) => {
      dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime);
      return new Response(JSON.stringify({ id: `post-${dates.length}` }), { status: 200 });
    },
  });
  assert.equal(result.scheduled, 2);
  assert.deepEqual(dates, ["2026-07-21T12:02:00", "2026-07-21T13:17:00"]);
});

test("allocates a 20-post run evenly so both city accounts can reach ten per day", async () => {
  const items = (["miami-news", "ny-news"] as const).flatMap((lane) => Array.from({ length: 12 }, (_, index) => item({
    id: `${lane}-${index}`,
    eventId: `${lane}-event-${index}`,
    lane,
    platform: "facebook",
    copy: `ESPAÑOL / ENGLISH verified local story ${lane} ${index}.`,
    editorialPriority: 50,
  })));
  const dir = await workspace(items);
  const scheduledBlogIds: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99", METRICOOL_NY_NEWS_BLOG_ID: "100" },
    workspaceDir: dir,
    now: fixedNow,
    maxPerRun: 20,
    fetch: async (input) => {
      scheduledBlogIds.push(new URL(String(input)).searchParams.get("blogId") || "");
      return new Response(JSON.stringify({ id: `post-${scheduledBlogIds.length}` }), { status: 200 });
    },
  });
  assert.equal(result.scheduled, 20);
  assert.equal(scheduledBlogIds.filter((id) => id === "99").length, 10);
  assert.equal(scheduledBlogIds.filter((id) => id === "100").length, 10);
});

test("suppresses routine subway and Metrobus noise before it reaches Metricool", async () => {
  const dir = await workspace([
    item({
      id: "routine-mta",
      platform: "facebook",
      source: "MTA Subway Alerts",
      copy: "MTA subway: demoras rutinarias en la línea A.",
      editorialUrgency: "routine",
      editorialPriority: 100,
    }),
    item({
      id: "routine-metrobus",
      platform: "facebook",
      source: "Miami-Dade Transit",
      copy: "Metrobus opera con una demora menor.",
      editorialUrgency: "routine",
      editorialPriority: 99,
    }),
  ]);
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("routine transit must not reach Metricool"); },
  });

  assert.equal(result.filtered, 2);
  assert.equal(result.scheduled, 0);
  assert.equal(fetched, false);
});

test("uses editorial priority and recency before applying the per-run cap", async () => {
  const dir = await workspace([
    item({ id: "routine-local", platform: "facebook", copy: "Aviso local rutinario.", editorialPriority: 5, createdAt: "2026-07-21T15:58:00.000Z" }),
    item({ id: "important-public-safety", platform: "facebook", copy: "Actualización verificada de seguridad pública.", editorialPriority: 85, createdAt: "2026-07-21T15:50:00.000Z" }),
  ]);
  const posted: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" }, workspaceDir: dir, now: fixedNow, maxPerRun: 1,
    fetch: async (_input, init) => { posted.push(JSON.parse(String(init?.body)).text); return new Response(JSON.stringify({ id: "priority-post" }), { status: 200 }); },
  });
  assert.equal(result.scheduled, 1);
  assert.match(posted[0], /Actualización verificada/);
  assert.doesNotMatch(posted[0], /Aviso local rutinario/);
});


test("committee review identity cannot be replayed or risk-downgraded", () => {
  const reviewed = unanimouslyReviewedItem({ id: "queue-sensitive", eventId: "event-sensitive", eventRevision: 3, lane: "ny-news", risk: "high" });
  assert.equal(hasCompleteLocalNewsCommitteeApproval(reviewed), true);
  assert.equal(hasCompleteLocalNewsCommitteeApproval({ ...reviewed, id: "queue-replay" }), false);
  assert.equal(hasCompleteLocalNewsCommitteeApproval({ ...reviewed, eventId: "another-event" }), false);
  assert.equal(hasCompleteLocalNewsCommitteeApproval({ ...reviewed, eventRevision: 4 }), false);
  assert.equal(hasCompleteLocalNewsCommitteeApproval({ ...reviewed, lane: "miami-news" }), false);
  assert.equal(hasCompleteLocalNewsCommitteeApproval({ ...reviewed, risk: "low" }), false);
  assert.equal(hasCompleteLocalNewsCommitteeApproval({ ...reviewed, canonicalEventIdentity: undefined }), false);
});


function ledgerEntry(lane: "miami-news" | "ny-news", platform: "facebook" | "x", index: number, scheduledFor: string) {
  return { queueItemId: `ledger-${lane}-${platform}-${index}`, lane, platform, blogId: lane === "miami-news" ? "99" : "100", scheduledFor, scheduledAt: scheduledFor, metricoolPostId: `old-${index}` };
}

test("allocates the run by existing account-day deficit instead of raw queue order", async () => {
  const queued = (["miami-news", "ny-news"] as const).flatMap((lane) => Array.from({ length: 10 }, (_, index) => item({
    id: `deficit-${lane}-${index}`, eventId: `deficit-event-${lane}-${index}`, lane, platform: "facebook", copy: `Verified deficit story ${lane} ${index}.`, editorialPriority: 50,
  })));
  const dir = await workspace(queued);
  await writeFile(path.join(dir, "metricool-delivery-ledger.json"), JSON.stringify({ version: 1, entries: Array.from({ length: 9 }, (_, index) => ledgerEntry("miami-news", "facebook", index, `2026-07-21T${String(12 + index).padStart(2, "0")}:00:00.000Z`)) }), "utf8");
  const posted: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99", METRICOOL_NY_NEWS_BLOG_ID: "100" }, workspaceDir: dir, now: fixedNow, maxPerRun: 10,
    fetch: async (input) => { posted.push(new URL(String(input)).searchParams.get("blogId") || ""); return new Response(JSON.stringify({ id: `new-${posted.length}` }), { status: 200 }); },
  });
  assert.equal(result.scheduled, 10);
  assert.equal(posted.filter((blogId) => blogId === "99").length, 1);
  assert.equal(posted.filter((blogId) => blogId === "100").length, 9);
});

test("compresses safe routine slots late in the day so ten can still land on that account-day", async () => {
  const dir = await workspace(Array.from({ length: 10 }, (_, index) => item({ id: `late-${index}`, eventId: `late-event-${index}`, platform: "facebook", copy: `Verified late-day story ${index}.` })));
  const dates: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" }, workspaceDir: dir, now: () => new Date("2026-07-22T02:00:00.000Z"), maxPerRun: 10,
    fetch: async (_input, init) => { dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime); return new Response(JSON.stringify({ id: `late-post-${dates.length}` }), { status: 200 }); },
  });
  assert.equal(result.scheduled, 10);
  assert.ok(dates.every((date) => date.startsWith("2026-07-21T")), dates.join(", "));
  assert.ok(dates.at(-1)! <= "2026-07-21T23:59:59");
});

test("shares a capped run fairly across all four city and platform accounts", async () => {
  const queued = (["miami-news", "ny-news"] as const).flatMap((lane) => (["facebook", "x"] as const).flatMap((platform) => Array.from({ length: 6 }, (_, index) => item({
    id: `four-${lane}-${platform}-${index}`, eventId: `four-event-${lane}-${platform}-${index}`, lane, platform, copy: `Verified four-account story ${lane} ${platform} ${index}.`,
  }))));
  const dir = await workspace(queued);
  const combinations: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99", METRICOOL_NY_NEWS_BLOG_ID: "100" }, workspaceDir: dir, now: fixedNow, maxPerRun: 20,
    fetch: async (input, init) => { const blogId = new URL(String(input)).searchParams.get("blogId"); const network = JSON.parse(String(init?.body)).providers[0].network; combinations.push(`${blogId}|${network}`); return new Response(JSON.stringify({ id: `four-post-${combinations.length}` }), { status: 200 }); },
  });
  assert.equal(result.scheduled, 20);
  for (const combination of ["99|facebook", "99|twitter", "100|facebook", "100|twitter"]) assert.equal(combinations.filter((value) => value === combination).length, 5, combination);
});

test("uses one maximum observed adaptive target for a mixed baseline and breakout account-day", async () => {
  const modes = [10, 10, 10, 14] as const;
  const dir = await workspace(modes.map((dailyTargetPosts, index) => item({
    id: `adaptive-${index}`, eventId: `adaptive-event-${index}`, platform: "facebook", copy: `Verified adaptive story ${index}.`, editorialPriority: 100 - index,
    organicGrowth: { ceoDecision: { dailyMinimumPosts: 10, dailyTargetPosts, performanceMode: dailyTargetPosts === 14 ? "breakout" : "baseline" } },
  })));
  await writeFile(path.join(dir, "metricool-delivery-ledger.json"), JSON.stringify({ version: 1, entries: Array.from({ length: 10 }, (_, index) => ledgerEntry("miami-news", "facebook", index, `2026-07-21T${String(6 + index).padStart(2, "0")}:00:00.000Z`)) }), "utf8");
  const dates: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" }, workspaceDir: dir, now: fixedNow, maxPerRun: 4,
    fetch: async (_input, init) => { dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime); return new Response(JSON.stringify({ id: `adaptive-post-${dates.length}` }), { status: 200 }); },
  });
  assert.equal(result.scheduled, 4);
  assert.ok(dates.every((date) => date.startsWith("2026-07-21T")), dates.join(", "));
});

test("ignores a 523-entry legacy future backlog when choosing a slot for current news", async () => {
  const dir = await workspace([item({
    id: "current-after-backlog",
    eventId: "current-after-backlog-event",
    platform: "facebook",
    createdAt: "2026-07-21T15:50:00.000Z",
    copy: "Verified current local report after legacy backlog.",
  })]);
  const legacyBacklog = Array.from({ length: 523 }, (_, index) => ledgerEntry(
    "miami-news",
    "facebook",
    index,
    new Date(Date.UTC(2026, 7, 1) + index * 60 * 60_000).toISOString(),
  ));
  await writeFile(
    path.join(dir, "metricool-delivery-ledger.json"),
    JSON.stringify({ version: 1, entries: legacyBacklog }),
    "utf8",
  );
  const dates: string[] = [];

  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime);
      return new Response(JSON.stringify({ id: "current-post" }), { status: 200 });
    },
  });

  assert.equal(result.scheduled, 1);
  assert.deepEqual(dates, ["2026-07-21T12:02:00"]);
});

test("legacy reservations beyond the horizon cannot push breaking news days into the future", async () => {
  const dir = await workspace([item({
    id: "breaking-after-legacy-chain",
    eventId: "breaking-after-legacy-chain-event",
    platform: "facebook",
    createdAt: "2026-07-21T15:50:00.000Z",
    editorialUrgency: "breaking",
    copy: "Verified breaking report after a legacy reservation chain.",
    organicGrowth: { ceoDecision: { dailyMinimumPosts: 10, dailyTargetPosts: 14, performanceMode: "breakout" } },
  })]);
  const nowMs = fixedNow().getTime();
  const legacyBacklog = Array.from({ length: 36 }, (_, index) => ledgerEntry(
    "miami-news",
    "facebook",
    index,
    new Date(nowMs + index * 121 * 60_000).toISOString(),
  ));
  await writeFile(
    path.join(dir, "metricool-delivery-ledger.json"),
    JSON.stringify({ version: 1, entries: legacyBacklog }),
    "utf8",
  );
  const dates: string[] = [];

  const result = await deliverClipperLocalNewsToMetricool({
    env: {
      ...credentials,
      METRICOOL_MIAMI_NEWS_BLOG_ID: "99",
      CLIPPERS_LOCAL_NEWS_SCHEDULE_HORIZON_HOURS: "2",
      CLIPPERS_LOCAL_NEWS_BREAKING_SPACING_MINUTES: "120",
    },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime);
      return new Response(JSON.stringify({ id: "bounded-breaking-post" }), { status: 200 });
    },
  });

  assert.equal(result.scheduled, 1);
  assert.deepEqual(dates, ["2026-07-21T14:00:00"]);
  assert.ok(new Date(`${dates[0]}-04:00`).getTime() <= nowMs + 2 * 60 * 60_000);
});

test("does not push routine news beyond the end of the next New York calendar day", async () => {
  const dir = await workspace([item({
    id: "routine-beyond-horizon",
    eventId: "routine-beyond-horizon-event",
    platform: "facebook",
    createdAt: "2026-07-21T15:50:00.000Z",
    copy: "Verified routine report that must not become stale in a future queue.",
  })]);
  const filledToday = Array.from({ length: 10 }, (_, index) => ledgerEntry(
    "miami-news",
    "facebook",
    index,
    `2026-07-21T${String(12 + index).padStart(2, "0")}:00:00.000Z`,
  ));
  const filledTomorrow = Array.from({ length: 10 }, (_, index) => ledgerEntry(
    "miami-news",
    "facebook",
    10 + index,
    `2026-07-22T${String(12 + index).padStart(2, "0")}:00:00.000Z`,
  ));
  await writeFile(
    path.join(dir, "metricool-delivery-ledger.json"),
    JSON.stringify({ version: 1, entries: [...filledToday, ...filledTomorrow] }),
    "utf8",
  );
  let fetched = false;

  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => { fetched = true; throw new Error("out-of-horizon news must not reach Metricool"); },
  });

  assert.equal(result.scheduled, 0);
  assert.equal(result.deferred, 1);
  assert.equal(fetched, false);
});

test("filters stale queue rows while fresh developing and breaking news keep their delivery behavior", async () => {
  const staleItems = [
    item({ id: "stale-routine", eventId: "stale-routine-event", platform: "facebook", createdAt: "2026-07-20T15:59:00.000Z", editorialUrgency: "routine", copy: "Old routine report." }),
    item({ id: "stale-developing", eventId: "stale-developing-event", platform: "facebook", createdAt: "2026-07-20T03:59:00.000Z", editorialUrgency: "developing", copy: "Old developing report." }),
    item({ id: "stale-breaking", eventId: "stale-breaking-event", platform: "facebook", createdAt: "2026-07-21T03:59:00.000Z", editorialUrgency: "breaking", copy: "Old breaking report." }),
  ];
  const staleDir = await workspace(staleItems);
  let staleFetched = false;
  const staleResult = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: staleDir,
    now: fixedNow,
    fetch: async () => { staleFetched = true; throw new Error("stale news must not reach Metricool"); },
  });
  assert.equal(staleResult.filtered, 3);
  assert.equal(staleResult.scheduled, 0);
  assert.equal(staleFetched, false);

  const freshDir = await workspace([
    item({ id: "fresh-developing", eventId: "fresh-developing-event", platform: "facebook", createdAt: "2026-07-21T15:30:00.000Z", editorialUrgency: "developing", copy: "Fresh developing report." }),
    item({ id: "fresh-breaking", eventId: "fresh-breaking-event", platform: "facebook", createdAt: "2026-07-21T15:45:00.000Z", editorialUrgency: "breaking", copy: "Fresh breaking report." }),
  ]);
  const dates: string[] = [];
  const freshResult = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: freshDir,
    now: fixedNow,
    maxPerRun: 2,
    fetch: async (_input, init) => {
      dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime);
      return new Response(JSON.stringify({ id: `fresh-${dates.length}` }), { status: 200 });
    },
  });
  assert.equal(freshResult.scheduled, 2);
  assert.ok(dates.includes("2026-07-21T12:00:00"), dates.join(", "));
});

test("bounds Metricool JSON responses before parsing them into memory", async () => {
  const small = await __clipperLocalNewsMetricoolInternals.safeJson(new Response(JSON.stringify({ id: "ok" })));
  assert.deepEqual(small, { id: "ok" });

  const oversized = new Response(JSON.stringify({ payload: "x".repeat(1024 * 1024 + 1) }));
  assert.equal(await __clipperLocalNewsMetricoolInternals.safeJson(oversized), null);

  const declaredOversized = new Response("{}", { headers: { "content-length": String(2 * 1024 * 1024) } });
  assert.equal(await __clipperLocalNewsMetricoolInternals.safeJson(declaredOversized), null);
});

test("bounds a Metricool response body that never finishes streaming", async () => {
  const hanging = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":"partial'));
    },
  }));
  const startedAt = Date.now();
  assert.equal(await __clipperLocalNewsMetricoolInternals.safeJson(hanging, 25), null);
  assert.ok(Date.now() - startedAt < 500);
});

test("a hanging successful Metricool body cannot retain the delivery lock", async () => {
  const dir = await workspace([item({ platform: "facebook" })]);
  const hangingResponse = () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":"partial'));
    },
  }), { status: 201 });

  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    responseTimeoutMs: 25,
    fetch: async () => hangingResponse(),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.scheduled, 0);
  assert.equal(result.pendingReconciliation, 1);
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
});

test("bounds a Metricool fetch even when the transport ignores abort", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    __clipperLocalNewsMetricoolInternals.fetchMetricool(
      async () => new Promise<Response>(() => {}),
      "https://app.metricool.com/api/v2/scheduler/posts",
      {},
      25,
    ),
    /metricool_request_aborted/,
  );
  assert.ok(Date.now() - startedAt < 500);
});

test("an ambiguous timed-out Metricool POST is not retried in the same cycle", async () => {
  const dir = await workspace([item({ platform: "facebook" })]);
  let calls = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    requestTimeoutMs: 100,
    fetch: async () => {
      calls += 1;
      return await new Promise<Response>(() => {});
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "metricool_reconciliation_required");
  assert.equal(result.failed, 1);
  assert.equal(calls, 1);
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
});
