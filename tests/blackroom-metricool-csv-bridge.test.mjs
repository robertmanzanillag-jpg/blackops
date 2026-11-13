import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMetricoolCsv,
  extractMetricoolCsvSamples,
  parseMetricoolCsv,
} from "../script/blackroom-metricool-csv-bridge.mjs";

test("parses quoted Metricool CSV fields with commas, escaped quotes and newlines", () => {
  const rows = parseMetricoolCsv('URL,Title,Views\n"https://example.test/1","A ""large"", drop\ncontinued",42\n');
  assert.deepEqual(rows, [{
    URL: "https://example.test/1",
    Title: 'A "large", drop\ncontinued',
    Views: "42",
  }]);
});

test("recognizes only the supported Metricool exports", () => {
  assert.equal(classifyMetricoolCsv("tiktok-posts_2026-06-29_2026-07-28.csv"), "tiktok");
  assert.equal(classifyMetricoolCsv("facebook-posts_2026-06-29_2026-07-28.csv"), "facebook");
  assert.equal(classifyMetricoolCsv("facebook-reels_2026-06-29_2026-07-28.csv"), "facebook");
  assert.equal(classifyMetricoolCsv("youtube-published-videos-posts_2026-06-29_2026-07-28.csv"), "youtube");
  assert.equal(classifyMetricoolCsv("passwords.csv"), null);
});

test("normalizes TikTok, Facebook and YouTube rows into deterministic CEO samples", () => {
  const tiktok = extractMetricoolCsvSamples(
    "tiktok-posts_range.csv",
    "URL,Date,Views,Duration\nhttps://tiktok.test/1,2026-07-28 19:06,116,120\n",
  );
  const facebook = extractMetricoolCsvSamples(
    "facebook-reels_range.csv",
    'Reel Link,Content,Date,Video Views\nhttps://facebook.test/1,"line one\nline two",2026-07-27 03:30,44\n',
  );
  const youtube = extractMetricoolCsvSamples(
    "youtube-published-videos-posts_range.csv",
    "videoId,publishedAt,views\nabc123,2026-07-27 14:03,37\n",
  );
  assert.deepEqual(tiktok, {
    network: "tiktok",
    samples: [{
      id: "https://tiktok.test/1",
      views: 116,
      publishedAt: "2026-07-28T19:06:00",
      durationSeconds: 120,
    }],
  });
  assert.equal(facebook?.samples[0].views, 44);
  assert.equal(facebook?.samples[0].publishedAt, "2026-07-27T03:30:00");
  assert.equal(youtube?.samples[0].id, "abc123");
  assert.equal(youtube?.samples[0].views, 37);
});

test("deduplicates repeated post IDs and rejects rows without usable view metrics", () => {
  const result = extractMetricoolCsvSamples(
    "youtube-published-videos-posts_range.csv",
    "videoId,publishedAt,views\nsame,2026-07-27 14:03,3\nsame,2026-07-28 14:03,9\nmissing,2026-07-28 14:03,\n",
  );
  assert.equal(result?.samples.length, 1);
  assert.equal(result?.samples[0].views, 9);
});

test("imports engagement and retention analytics across Metricool header variants", () => {
  const result = extractMetricoolCsvSamples(
    "youtube-published-videos-posts_range.csv",
    "Video ID,Published At,Views,Likes,Comments,Shares,Average view duration,Average percentage viewed\nabc123,2026-08-11 20:00,400,20,5,3,18.5,62\n",
  );
  assert.deepEqual(result?.samples[0], {
    id: "abc123", views: 400, publishedAt: "2026-08-11T20:00:00",
    likes: 20, comments: 5, shares: 3, averageWatchSeconds: 18.5,
    completionRate: 0.62, engagementRate: 0.07,
  });
});

test("Facebook reach and impressions are not silently relabeled as video views", () => {
  const result = extractMetricoolCsvSamples(
    "facebook-reels_range.csv",
    "Reel Link,Date,Impressions,Reach\nhttps://facebook.com/reel/123,2026-09-20 10:00,900,500\n",
  );
  assert.equal(result?.samples.length ?? 0, 0);
});
