import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  __localNewsGrowthScoutInternals,
  createLocalNewsGrowthScoutScheduler,
  runLocalNewsGrowthScout,
} from "../server/local-news-growth-scout";

test("parses public Reddit metadata without retaining author or post body", () => {
  const rows = __localNewsGrowthScoutInternals.parseRedditListing({
    data: {
      children: [{ data: {
        id: "abc",
        title: "Breaking: What to know about a Miami road closure?",
        permalink: "/r/Miami/comments/abc/story/",
        created_utc: 1_753_000_000,
        score: 42,
        num_comments: 11,
        selftext: "private user discussion that must not be retained",
        author: "not-retained",
      } }],
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Breaking: What to know about a Miami road closure?");
  assert.equal(rows[0].link, "https://www.reddit.com/r/Miami/comments/abc/story/");
  assert.equal(rows[0].score, 42);
  assert.equal(rows[0].comments, 11);
  assert.equal("author" in rows[0], false);
  assert.equal("selftext" in rows[0], false);
});

test("default Reddit discovery uses hot feeds and keeps community content metadata-only", () => {
  const sources = __localNewsGrowthScoutInternals.normalizedSources({});
  const reddit = sources.filter((source) => source.kind === "reddit");
  assert.ok(reddit.length >= 5);
  assert.ok(reddit.every((source) => source.url.includes("/hot.json")));
  assert.ok(reddit.some((source) => source.id === "reddit-facebook"));
  assert.ok(reddit.some((source) => source.id === "reddit-social-media"));
});

test("scout aggregates Reddit and RSS patterns, persists a safe snapshot, and never marks media as owned", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "local-news-growth-scout-"));
  try {
    const now = new Date("2026-08-03T12:00:00.000Z");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("reddit")) {
        return new Response(JSON.stringify({ data: { children: [
          { data: { id: "1", title: "Breaking alert: Miami officials issue evacuation warning", permalink: "/r/Miami/comments/1/a", created_utc: 1_754_213_000, score: 55, num_comments: 14 } },
          { data: { id: "2", title: "What to know about a New York public safety update?", permalink: "/r/nyc/comments/2/b", created_utc: 1_754_212_000, score: 35, num_comments: 9 } },
        ] } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("<rss><channel><item><title>How the city explained the new safety update</title><link>https://news.example.test/item</link><pubDate>Mon, 03 Aug 2026 11:00:00 GMT</pubDate></item></channel></rss>", { status: 200, headers: { "content-type": "application/rss+xml" } });
    };
    const snapshot = await runLocalNewsGrowthScout({
      now: () => now,
      fetch: fetcher,
      env: {
        CLIPPERS_LOCAL_NEWS_WORKSPACE: workspace,
        LOCAL_NEWS_GROWTH_SCOUT_SOURCES: JSON.stringify([
          { id: "reddit-miami", kind: "reddit", label: "Reddit Miami", url: "https://www.reddit.com/r/Miami/new.json", lane: "miami-news" },
          { id: "city-rss", kind: "rss", label: "City RSS", url: "https://news.example.test/rss", lane: "ny-news" },
        ]),
      },
    });
    assert.equal(snapshot.signals.length, 3);
    assert.equal(snapshot.sourceErrors.length, 0);
    assert.equal(snapshot.policy.metadataOnly, true);
    assert.equal(snapshot.policy.noContentReposting, true);
    assert.equal(snapshot.policy.noAutomatedCommunityPosting, true);
    assert.ok(snapshot.recommendations.some((item) => item.pattern === "breaking_alert"));
    assert.ok(snapshot.recommendations.every((item) => item.guardrail.includes("no reutilizar")));
    const raw = JSON.parse(await readFile(path.join(workspace, "growth-scout", "growth-scout-latest.json"), "utf8"));
    assert.equal(raw.signals.length, 3);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("growth scout scheduler defaults to hourly, starts immediately, and respects disabled mode", async () => {
  let delay = 0;
  let runs = 0;
  const timer = { unref() {} } as ReturnType<typeof setInterval>;
  const scheduler = createLocalNewsGrowthScoutScheduler({
    env: { CLIPPERS_LOCAL_NEWS_WORKSPACE: await mkdtemp(path.join(os.tmpdir(), "local-news-growth-scheduler-")) },
    fetch: async () => { runs += 1; return new Response("{\"data\":{\"children\":[]}}", { status: 200 }); },
    setInterval: (callback, configuredDelay) => { delay = configuredDelay; void callback; return timer; },
    setTimeout: () => ({ unref() {} } as ReturnType<typeof setTimeout>),
    clearTimeout: () => {},
    log: () => {},
  });
  assert.equal(scheduler.start().intervalMinutes, 60);
  for (let attempt = 0; attempt < 20 && scheduler.status().running; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(delay, 60 * 60_000);
  assert.equal(runs > 0, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(scheduler.stop().running, false);

  const disabled = createLocalNewsGrowthScoutScheduler({ env: { LOCAL_NEWS_GROWTH_SCOUT_ENABLED: "false" }, setInterval: () => { throw new Error("must not schedule"); } });
  assert.equal(disabled.start().enabled, false);
  assert.equal(await disabled.runNow(), "skipped");
});

test("scout caps upstream bodies and redacts source query strings in the artifact", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "local-news-growth-hardening-"));
  try {
    const snapshot = await runLocalNewsGrowthScout({
      env: {
        CLIPPERS_LOCAL_NEWS_WORKSPACE: workspace,
        LOCAL_NEWS_GROWTH_SCOUT_SOURCES: JSON.stringify([{ id: "rss-secret", kind: "rss", label: "RSS", url: "https://news.example.test/rss?token=do-not-persist", lane: "miami-news" }]),
      },
      fetch: async () => new Response(`<rss>${"x".repeat(1_000_001)}</rss>`, { status: 200 }),
    });
    assert.equal(snapshot.signals.length, 0);
    assert.equal(snapshot.sourceErrors[0]?.error, "source_response_too_large");
    assert.equal(snapshot.sources[0]?.url, "https://news.example.test/rss");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
