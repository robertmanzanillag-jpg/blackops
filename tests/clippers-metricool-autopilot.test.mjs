import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPublicationSchedule,
  runMetricoolAutopilot,
  validateAutopilotItem,
} from "../script/clippers-metricool-autopilot.mjs";

const eligible = {
  campaignId: "mrbeast",
  draftFile: "drafts/mrbeast-07.mp4",
  account: "streamersclipusa",
  blogId: 6431687,
  caption: "MrBeast on pyramids. #MrBeast #paidpartner",
  requiredHashtags: ["#MrBeast", "#paidpartner"],
  mediaUrl: "https://media.example.org/mrbeast-07.mp4",
  status: "ready_for_metricool_autopilot",
  publishAllowed: true,
};

const mediaReceipt = {
  campaignId: eligible.campaignId,
  draftFile: eligible.draftFile,
  fileId: "drive-file-123",
  mediaUrl: eligible.mediaUrl,
  sha256: "a".repeat(64),
  status: "ready",
};

test("requires every contractual hashtag and a public HTTPS media URL", () => {
  assert.deepEqual(validateAutopilotItem(eligible, "streamersclipusa").blockers, []);
  assert.ok(validateAutopilotItem({ ...eligible, caption: "No disclosure" }, "streamersclipusa")
    .blockers.includes("required_hashtag_missing"));
  assert.ok(validateAutopilotItem({ ...eligible, caption: "Not enough #MrBeast #paidpartnership" }, "streamersclipusa")
    .blockers.includes("required_hashtag_missing"));
  assert.ok(validateAutopilotItem({ ...eligible, mediaUrl: "http://127.0.0.1/video.mp4" }, "streamersclipusa")
    .blockers.includes("public_https_media_required"));
  assert.ok(validateAutopilotItem({ ...eligible, account: "another" }, "streamersclipusa")
    .blockers.includes("wrong_account"));
});

test("builds five spaced daily slots after the current time", () => {
  const slots = buildPublicationSchedule(new Date("2026-07-28T05:00:00.000Z"), 5);
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.map((value) => value.slice(11)), [
    "10:00:00", "12:30:00", "15:00:00", "17:30:00", "20:00:00",
  ]);
});

test("counts existing TikTok posts toward the daily limit and avoids occupied slots", () => {
  const slots = buildPublicationSchedule(new Date("2026-07-28T05:00:00.000Z"), 5, {
    occupiedLocalDateTimes: ["2026-07-28T10:00:00"],
    existingDailyCounts: { "2026-07-28": 1 },
    dailyLimit: 5,
  });
  assert.deepEqual(slots, [
    "2026-07-28T12:30:00",
    "2026-07-28T15:00:00",
    "2026-07-28T17:30:00",
    "2026-07-28T20:00:00",
    "2026-07-29T10:00:00",
  ]);
});

test("does not schedule without explicit authorization", async () => {
  const result = await runMetricoolAutopilot({ env: {}, queue: { targetDailyClips: 5, items: [eligible] } });
  assert.equal(result.status, "blocked");
  assert.equal(result.scheduled, 0);
});

test("dry-run validates a verified media receipt without credentials or network writes", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-dry-run-"));
  try {
    const result = await runMetricoolAutopilot({
      dryRun: true,
      env: { CLIPPERS_METRICOOL_BLOG_ID: "6431687", CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa" },
      workspaceRoot,
      queue: { targetDailyClips: 5, items: [eligible] },
      ledger: [],
      mediaReceipts: [mediaReceipt],
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch() {
        throw new Error("dry-run must not call Metricool");
      },
    });
    assert.equal(result.status, "dry_run");
    assert.equal(result.scheduled, 0);
    assert.equal(result.wouldSchedule, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("blocks an item whose public URL has no matching upload receipt", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-receipt-"));
  try {
    const result = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      workspaceRoot,
      queue: { targetDailyClips: 5, items: [eligible] },
      ledger: [],
      mediaReceipts: [],
      async fetch() {
        throw new Error("unverified media must not call Metricool");
      },
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.results[0].blockers.includes("verified_media_receipt_missing"));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("schedules eligible unique rows through Metricool MCP and writes no paid spend", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-autopilot-"));
  const calls = [];
  try {
    const result = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
        CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa",
      },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: { targetDailyClips: 5, items: [eligible] },
      ledger: [],
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch(url, init) {
        if (url === "https://ai.metricool.com/mcp") {
          calls.push(JSON.parse(init.body));
          return new Response(JSON.stringify({ jsonrpc: "2.0", result: { content: [{ type: "text", text: "ok" }] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (!calls.length) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          data: [{
            id: "metricool-123",
            text: eligible.caption,
            publicationDate: { dateTime: "2026-07-28T10:00:00" },
            providers: [{ network: "tiktok" }],
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.scheduled, 1);
    assert.equal(result.results[0].paidSpendAllowed, false);
    assert.equal(result.results[0].metricoolId, "metricool-123");
    const args = calls[0].params.arguments;
    assert.equal(args.blogId, "6431687");
    assert.equal(args.mediaFiles[0].download_url, eligible.mediaUrl);
    const info = JSON.parse(args.info);
    assert.equal(info.providers[0].network, "tiktok");
    assert.equal(info.tiktokData.commercialContentThirdParty, true);
    assert.match(info.text, /#paidpartner/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("records an uncertain Metricool outcome and never retries it silently", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-pending-"));
  try {
    let mcpCalls = 0;
    const result = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
        CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa",
      },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: { targetDailyClips: 5, items: [eligible] },
      ledger: [],
      now: new Date("2026-07-28T05:00:00.000Z"),
      verifyAttempts: 1,
      async fetch(url) {
        if (url === "https://ai.metricool.com/mcp") {
          mcpCalls += 1;
          return new Response(JSON.stringify({ jsonrpc: "2.0", result: { content: [] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ data: mcpCalls ? [{
          text: eligible.caption,
          publicationDate: { dateTime: "2026-07-28T10:00:00" },
          providers: [{ network: "tiktok" }],
        }] : [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(result.status, "attention_required");
    assert.equal(result.scheduled, 0);
    assert.equal(result.verificationPending, 1);
    assert.equal(result.results[0].status, "verification_pending");
    assert.equal(mcpCalls, 1);

    const retry = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: { targetDailyClips: 5, items: [eligible] },
      ledger: result.results,
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch(url) {
        assert.notEqual(url, "https://ai.metricool.com/mcp", "A pending item must not be submitted twice");
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(retry.status, "attention_required");
    assert.equal(retry.results.length, 1);
    assert.equal(retry.results[0].reason, "retry_suppressed_until_remote_outcome_is_known");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("blocks a queue item routed to a different Metricool blog", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-blog-"));
  try {
    const result = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: { targetDailyClips: 5, items: [{ ...eligible, blogId: 6595747 }] },
      ledger: [],
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch() {
        throw new Error("Wrong Metricool blogs must not be called");
      },
    });
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.results[0].blockers, ["wrong_metricool_blog"]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("blocks a slot that would run after the verified campaign expiry", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-expiry-"));
  let mcpCalls = 0;
  try {
    const result = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: {
        targetDailyClips: 5,
        items: [{ ...eligible, campaignExpiresAt: "2026-07-28T13:00:00.000Z" }],
      },
      ledger: [],
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch(url) {
        if (url === "https://ai.metricool.com/mcp") mcpCalls += 1;
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.results[0].blockers, ["campaign_expires_before_slot"]);
    assert.equal(mcpCalls, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("blocks an already expired campaign without calling Metricool", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-expired-"));
  let fetchCalls = 0;
  try {
    const result = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: {
        targetDailyClips: 5,
        items: [{ ...eligible, campaignExpiresAt: "2026-07-28T04:00:00.000Z" }],
      },
      ledger: [],
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch() {
        fetchCalls += 1;
        throw new Error("Expired campaigns must not call Metricool");
      },
    });
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.results[0].blockers, ["campaign_expired_or_invalid"]);
    assert.equal(fetchCalls, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("deduplicates identical items inside one queue before calling Metricool", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-batch-dedupe-"));
  let mcpCalls = 0;
  try {
    const result = await runMetricoolAutopilot({
      env: {
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        METRICOOL_USER_TOKEN: "token",
        METRICOOL_USER_ID: "3558197",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: { targetDailyClips: 5, items: [eligible, { ...eligible }] },
      ledger: [],
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch(url) {
        if (url === "https://ai.metricool.com/mcp") {
          mcpCalls += 1;
          return new Response(JSON.stringify({ jsonrpc: "2.0", result: { content: [] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (!mcpCalls) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          data: [{
            id: "metricool-deduped",
            text: eligible.caption,
            publicationDate: { dateTime: "2026-07-28T10:00:00" },
            providers: [{ network: "tiktok" }],
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(result.scheduled, 1);
    assert.equal(mcpCalls, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("skips a concurrent autopilot run while its lock is active", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-metricool-lock-"));
  const reportDir = path.join(workspaceRoot, "reports");
  await mkdir(reportDir, { recursive: true });
  const lock = await open(path.join(reportDir, "metricool-autopilot.lock"), "wx", 0o600);
  try {
    const result = await runMetricoolAutopilot({
      env: { CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true" },
      workspaceRoot,
      mediaReceipts: [mediaReceipt],
      queue: { targetDailyClips: 5, items: [eligible] },
    });
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "already_running");
  } finally {
    await lock.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
