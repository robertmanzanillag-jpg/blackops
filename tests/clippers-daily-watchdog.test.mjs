import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runClippersDailyWatchdog, runPortfolioPrepareChild } from "../script/clippers-daily-watchdog.mjs";

const prepareEnabled = { CLIPPERS_PORTFOLIO_PREPARE_ENABLED: "true", CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true" };

test("optional preparation stays disabled unless due and explicitly enabled, and precedes learner without its lock", async () => {
  const workspaceRoot = await fixture(); const order = [];
  const runPortfolioPrepare = async () => {
    order.push("prepare");
    await assert.rejects(readFile(path.join(workspaceRoot, "reports/metricool-autopilot.lock")), { code: "ENOENT" });
    return { status: "prepared", prepared: 1, uploaded: 1, paidSpendUsd: 0 };
  };
  const runClippersDailyLearning = async () => { order.push("learn"); return { status: "held_or_partial", scheduled: 0, observations: 0 }; };
  try {
    const early = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T13:59:00Z"), env: prepareEnabled,
      dailyPrepare: true, dailyLearning: true, runPortfolioPrepare, runClippersDailyLearning });
    assert.equal(early.portfolioPreparation, undefined); assert.deepEqual(order, []);
    const disabled = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T14:00:00Z"), env: {},
      dailyPrepare: true, dailyLearning: true, runPortfolioPrepare, runClippersDailyLearning });
    assert.equal(disabled.portfolioPreparation.status, "disabled"); assert.deepEqual(order, ["learn"]);
    order.length = 0;
    const enabled = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T14:00:00Z"), env: prepareEnabled,
      dailyPrepare: true, dailyLearning: true, runPortfolioPrepare, runClippersDailyLearning });
    assert.deepEqual(order, ["prepare", "learn"]); assert.equal(enabled.portfolioPreparation.prepared, 1);
    assert.equal(enabled.costUsd, 0);
  } finally { await rm(workspaceRoot, { recursive: true, force: true }); }
});

test("a failed preparation alerts without leaking provider text or skipping the learner", async () => {
  const workspaceRoot = await fixture(); let learning = 0;
  try {
    const report = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T14:00:00Z"), env: prepareEnabled,
      dailyPrepare: true, dailyLearning: true, runPortfolioPrepare: async () => { throw Error("synthetic-private-provider-error"); },
      runClippersDailyLearning: async () => { learning++; return { status: "already_completed" }; } });
    assert.equal(report.portfolioPreparation.reason, "portfolio_prepare_failed");
    assert.equal(report.alerts.portfolioPreparationBlocked, true); assert.equal(learning, 1);
    assert.equal(JSON.stringify(report).includes("synthetic-private-provider-error"), false);
  } finally { await rm(workspaceRoot, { recursive: true, force: true }); }
});

test("actual prepare child is read-only with no packets and receives only the existing delivery credential scope", async () => {
  const workspaceRoot = await fixture(); let calls = 0;
  try {
    const report = await runPortfolioPrepareChild({ workspaceRoot,
      env: { ...prepareEnabled, PATH: process.env.PATH, DEFAULT_USER_ID: "test-owner", GOOGLE_DRIVE_CLIENT_ID: "synthetic-drive-client",
        OPENAI_API_KEY: "synthetic-unused-model-key", METRICOOL_USER_TOKEN: "synthetic-unused-token", NODE_OPTIONS: "--require unsafe-hook" },
      spawnProcess(binary, args, options) {
        calls++; assert.equal(binary, process.execPath); assert.equal(args.length, 1);
        assert.ok(args[0].endsWith("/script/clippers-portfolio-prepare.mjs"));
        assert.equal(options.env.DEFAULT_USER_ID, "test-owner"); assert.equal(options.env.OPENAI_API_KEY, undefined);
        assert.equal(options.env.METRICOOL_USER_TOKEN, undefined); assert.equal(options.env.NODE_OPTIONS, undefined);
        return spawn(binary, args, options);
      } });
    assert.equal(calls, 1); assert.equal(report.status, "held"); assert.equal(report.reason, "no_reviewed_prepare_packets");
    assert.equal(report.prepared, 0); assert.equal(report.uploaded, 0); assert.equal(report.paidSpendUsd, 0);
  } finally { await rm(workspaceRoot, { recursive: true, force: true }); }
});

test("prepare subprocess ignores provider stderr, refuses paid reports and is killed on a hard deadline", { timeout: 5000 }, async t => {
  const workspaceRoot = await fixture(); let child, closed;
  t.after(async () => { try { if (child?.pid) process.kill(-child.pid, "SIGKILL"); } catch {} await rm(workspaceRoot, { recursive: true, force: true }); });
  const invalid = await runPortfolioPrepareChild({ workspaceRoot, env: prepareEnabled, spawnProcess(binary, _args, options) {
    return spawn(binary, ["-e", 'process.stderr.write("synthetic-private-provider-error");console.log(JSON.stringify({status:"prepared",prepared:1,uploaded:1,paidSpendUsd:2}))'], options);
  } });
  assert.equal(invalid.reason, "portfolio_prepare_report_unconfirmed");
  assert.equal(JSON.stringify(invalid).includes("synthetic-private-provider-error"), false);
  const started = Date.now();
  const timeout = await runPortfolioPrepareChild({ workspaceRoot, env: prepareEnabled, timeoutMs: 150,
    spawnProcess(binary, _args, options) {
      child = spawn(binary, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], options);
      closed = once(child, "close"); return child;
    } });
  assert.equal(timeout.reason, "portfolio_prepare_deadline_exceeded");
  assert.ok(Date.now() - started < 2000); await closed;
});

test("timed-out or failed preparation cannot leave a TERM-resistant descendant after its parent closes", {
  timeout: 6000, skip: process.platform === "win32" && "POSIX process-group cleanup",
}, async t => {
  const workspaceRoot = await fixture(), groups = [];
  t.after(async () => {
    for (const pid of groups) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  for (const mode of ["timeout", "failed"]) {
    const pidFile = path.join(workspaceRoot, "descendant-" + mode + ".pid");
    const grandchild = 'process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(' + JSON.stringify(pidFile) + ',String(process.pid));setInterval(()=>{},1000)';
    const parent = 'const fs=require("node:fs");require("node:child_process").spawn(process.execPath,["-e",' + JSON.stringify(grandchild) + '],{stdio:"ignore"});' +
      (mode === "failed" ? 'setInterval(()=>{if(fs.existsSync(' + JSON.stringify(pidFile) + '))process.exit(1)},5)' : 'setInterval(()=>{},1000)');
    const result = await runPortfolioPrepareChild({ workspaceRoot, env: prepareEnabled, timeoutMs: 450,
      spawnProcess(binary, _args, options) { const child = spawn(binary, ["-e", parent], options); groups.push(child.pid); return child; } });
    assert.equal(result.reason, mode === "timeout" ? "portfolio_prepare_deadline_exceeded" : "portfolio_prepare_child_failed");
    const pid = Number(await readFile(pidFile, "utf8"));
    await new Promise(resolve => setTimeout(resolve, 50));
    const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    assert.ok(!state || state.startsWith("Z"), "a descendant must be gone or exited, not active: " + state);
  }
});

test("daily discovery runs only when due and preserves research-only evidence", async () => {
  const workspaceRoot = await fixture();
  const aliasDirectory = await mkdtemp(path.join(os.tmpdir(), "clippers-discovery-alias-"));
  const alias = path.join(aliasDirectory, "workspace");
  await symlink(workspaceRoot, alias, "dir");
  let calls = 0;
  const runPortfolioDiscovery = async ({ stateDir, now }) => {
    calls++;
    assert.equal(stateDir, path.join(await realpath(workspaceRoot), "portfolio-discovery"));
    assert.equal(now.toISOString(), "2026-08-12T14:00:00.000Z");
    return { status: "observed", observedAt: "2026-08-12T13:00:00.000Z", reused: true,
      feeds: [{ status: "observed" }], observations: [
        { publishedAt: "2026-08-12T12:00:00.000Z" },
        { publishedAt: "2026-08-09T13:30:00.000Z" },
        { publishedAt: "2026-08-12T15:00:00.000Z" },
      ] };
  };
  try {
    const early = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T13:59:00Z"), dailyDiscovery: true, runPortfolioDiscovery });
    assert.equal(calls, 0);
    assert.equal(early.publicDiscovery, undefined);
    const due = await runClippersDailyWatchdog({ workspaceRoot: alias, now: new Date("2026-08-12T14:00:00Z"), dailyDiscovery: true, runPortfolioDiscovery });
    assert.equal(calls, 1);
    assert.equal(due.publicDiscovery.recentUnder72Hours, 1);
    assert.equal(due.publicDiscovery.observedAt, "2026-08-12T13:00:00.000Z");
    assert.equal(due.publicDiscovery.eligibleAssets, 0);
    assert.equal(due.publicDiscovery.mayPublish, false);
    assert.equal(due.counts.published, 0);
  } finally {
    await rm(aliasDirectory, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("discovery failure alerts while the separate daily learning cycle still runs", async () => {
  const workspaceRoot = await fixture();
  try {
    const report = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T14:00:00Z"),
      dailyDiscovery: true, dailyLearning: true,
      runPortfolioDiscovery: async () => { throw new Error("simulated feed failure"); },
    });
    assert.equal(report.publicDiscovery.reason, "public_discovery_failed");
    assert.equal(report.dailyLearning.status, "held_or_partial");
    assert.equal(report.alerts.publicDiscoveryBlocked, true);
    assert.equal(report.alert, true);
    assert.equal(report.costUsd, 0);
  } finally { await rm(workspaceRoot, { recursive: true, force: true }); }
});

async function fixture({ ledger = [], worker = null, supply = null, content = null, delivery = freshDelivery() } = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-watchdog-"));
  const reports = path.join(workspaceRoot, "reports");
  await mkdir(path.join(reports, "free-local-worker"), { recursive: true });
  await writeFile(path.join(reports, "metricool-autopilot-ledger.json"), JSON.stringify(ledger));
  if (worker) await writeFile(path.join(reports, "free-local-worker", "latest.json"), JSON.stringify(worker));
  if (supply) await writeFile(path.join(reports, "marketplace-supply-report.json"), JSON.stringify(supply));
  if (content) {
    await mkdir(path.join(reports, "content-worker"), { recursive: true });
    await writeFile(
      path.join(reports, "content-worker", "clippers-content-local-worker-latest.json"),
      JSON.stringify(content),
    );
  }
  if (delivery) await writeFile(path.join(reports, "youtube-delivery-worker-latest.json"), JSON.stringify(delivery));
  return workspaceRoot;
}

function freshDelivery(overrides = {}) {
  return {
    schemaVersion: 1,
    finishedAt: "2026-08-12T13:30:00.000Z",
    status: "completed",
    stage: "publishing",
    published: 0,
    publicUrls: [],
    blockers: [],
    apiCostUsd: 0,
    ...overrides,
  };
}

function freshContent(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-12T12:00:00.000Z",
    status: "completed",
    networkUsed: false,
    publishEnabled: false,
    apiCostUsd: 0,
    motivation: {
      es: { channelId: "motivation-es", planned: 5, attempted: 5, rendered: 5, shortfall: 0 },
      en: { channelId: "motivation-en", planned: 5, attempted: 5, rendered: 5, shortfall: 0 },
    },
    sleep: { planned: 0, attempted: 0, generated: 0, shortfall: 0 },
    ...overrides,
  };
}

test("creates a local zero-post alert with worker stage, blocker, and run age", async () => {
  const workspaceRoot = await fixture({
    worker: {
      status: "blocked",
      failedStage: "supply",
      finishedAt: "2026-08-12T13:00:00.000Z",
      configurationBlockers: [],
    },
    supply: { summary: { snapshotsRead: 0 }, rejected: [] },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T14:05:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.status, "alert");
    assert.equal(report.alert, true);
    assert.equal(report.counts.total, 0);
    assert.equal(report.worker.stage, "supply");
    assert.deepEqual(report.worker.blockers, ["no_fresh_marketplace_snapshots"]);
    assert.equal(report.worker.lastRunAgeMinutes, 65);
    assert.equal(report.notificationSent, false);
    assert.equal(report.costUsd, 0);

    const alertJson = JSON.parse(await readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/alerts/2026-08-12.json",
    ), "utf8"));
    const alertMarkdown = await readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/alerts/2026-08-12.md",
    ), "utf8");
    assert.equal(alertJson.worker.stage, "supply");
    assert.match(alertMarkdown, /local alert only; no message was sent/i);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("counts only evidence-backed posts for the configured account and New York date", async () => {
  const workspaceRoot = await fixture({
    ledger: [
      { status: "scheduled", account: "@streamersclipusa", metricoolId: "m-1", scheduledFor: "2026-08-12T21:00:00.000Z", campaignId: "one" },
      { status: "published", account: "streamersclipusa", metricoolId: "m-2", publishedAt: "2026-08-12T15:00:00.000Z", publicUrl: "https://www.tiktok.com/@streamersclipusa/video/123456", campaignId: "two" },
      { status: "scheduled", account: "@streamersclipusa", scheduledFor: "2026-08-12T22:00:00.000Z" },
      { status: "published", account: "@streamersclipusa", publishedAt: "2026-08-12T16:00:00.000Z", publicUrl: "https://example.com/not-proof" },
      { status: "scheduled", account: "@other", metricoolId: "m-3", scheduledFor: "2026-08-12T18:00:00.000Z" },
      { status: "scheduled", account: "@streamersclipusa", metricoolId: "m-old", scheduledFor: "2026-08-11T18:00:00.000Z" },
      { status: "scheduled", account: "@streamersclipusa", metricoolId: "m-date-only", scheduledFor: "2026-08-12" },
    ],
    worker: { status: "completed", finishedAt: "2026-08-12T13:05:00.000Z" },
    content: freshContent(),
    delivery: freshDelivery(),
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.status, "healthy");
    assert.equal(report.counts.total, 3);
    assert.equal(report.counts.scheduled, 2);
    assert.equal(report.counts.published, 1);
    assert.equal(report.contentWorker.freshForToday, true);
    assert.equal(report.contentWorker.publicationProof, false);
    assert.deepEqual(report.evidence.map(({ metricoolId }) => metricoolId), ["m-1", "m-2", "m-date-only"]);
    await assert.rejects(readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/alerts/2026-08-12.json",
    )));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reports only exact confirmed YouTube watch URLs as publication proof", async () => {
  const workspaceRoot = await fixture({
    content: freshContent(),
    delivery: freshDelivery({
      published: 2,
      publicUrls: [
        { itemId: "es-1", lane: "motivation_es", privacyStatus: "public", youtubeUrl: "https://www.youtube.com/watch?v=abc123def" },
        { itemId: "sleep-1", lane: "sleep", privacyStatus: "public", youtubeUrl: "https://youtube.com/watch?v=xyz789abc" },
      ],
    }),
  });
  try {
    const report = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T15:00:00.000Z"), checkHour: 10 });
    assert.equal(report.youtubeDelivery.schemaValid, true);
    assert.equal(report.youtubeDelivery.published, 2);
    assert.equal(report.youtubeDelivery.publicationProof, true);
    assert.deepEqual(report.youtubeDelivery.publicUrls.map((row) => row.itemId), ["es-1", "sleep-1"]);
  } finally { await rm(workspaceRoot, { recursive: true, force: true }); }
});

test("never counts planned, rendered, packaged, or uncertain YouTube rows as published", async () => {
  const workspaceRoot = await fixture({
    content: freshContent(),
    delivery: freshDelivery({
      status: "completed_with_uncertain_outcomes",
      published: 0,
      publicUrls: [],
      blockers: ["manual_youtube_reconciliation_required"],
      packaging: { packaged: 10 },
      publishing: { queued: 10, uploaded: 0, uncertain: 1 },
    }),
  });
  try {
    const report = await runClippersDailyWatchdog({ workspaceRoot, now: new Date("2026-08-12T15:00:00.000Z"), checkHour: 10 });
    assert.equal(report.youtubeDelivery.published, 0);
    assert.equal(report.youtubeDelivery.publicationProof, false);
    assert.equal(report.alerts.youtubeDeliveryBlockedOrUncertain, true);
    assert.ok(report.youtubeDelivery.blockers.includes("youtube_delivery_uncertain_outcomes"));
  } finally { await rm(workspaceRoot, { recursive: true, force: true }); }
});

test("records not_due before the configurable local check hour", async () => {
  const workspaceRoot = await fixture();
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T12:59:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.status, "not_due");
    assert.equal(report.alert, false);
    const latest = JSON.parse(await readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/latest.json",
    ), "utf8"));
    assert.equal(latest.date, "2026-08-12");
    assert.equal(latest.timeZone, "America/New_York");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reports renderer shortfall from a partial worker without calling it a missing report", async () => {
  const workspaceRoot = await fixture({
    worker: {
      status: "partial",
      failedStage: null,
      finishedAt: "2026-08-12T13:00:00.000Z",
      renderingReport: { summary: { rendered: 2, missingAgainstTarget: 3 } },
    },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.worker.stage, "partial");
    assert.deepEqual(report.worker.blockers, ["renderer_shortfall_3"]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reports a long worker startup as running instead of a missing report", async () => {
  const workspaceRoot = await fixture({
    worker: { status: "running", startedAt: "2026-08-12T14:55:00.000Z" },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.worker.stage, "running");
    assert.deepEqual(report.worker.blockers, []);
    assert.equal(report.worker.lastRunAgeMinutes, 5);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("rejects an invalid configured hour", async () => {
  const workspaceRoot = await fixture();
  try {
    await assert.rejects(
      runClippersDailyWatchdog({ workspaceRoot, checkHour: 24 }),
      /integer from 0 to 23/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reports separate ES and EN render shortfalls without counting plans as publications", async () => {
  const workspaceRoot = await fixture({
    ledger: [{
      status: "scheduled",
      account: "@streamersclipusa",
      metricoolId: "tiktok-1",
      scheduledFor: "2026-08-12T18:00:00.000Z",
    }],
    content: freshContent({
      status: "completed_with_shortfall",
      motivation: {
        es: { channelId: "motivation-es", planned: 5, attempted: 5, rendered: 4, shortfall: 1 },
        en: { channelId: "motivation-en", planned: 5, attempted: 3, rendered: 3, shortfall: 2 },
      },
      sleep: { planned: 1, attempted: 1, generated: 0, shortfall: 1 },
    }),
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.status, "alert");
    assert.equal(report.alerts.noEvidenceBackedTikTokPost, false);
    assert.equal(report.alerts.contentWorkerShortfall, true);
    assert.equal(report.counts.total, 1);
    assert.deepEqual(report.contentWorker.motivation.es, {
      channelId: "motivation-es",
      planned: 5,
      attempted: 5,
      rendered: 4,
      shortfall: 1,
    });
    assert.equal(report.contentWorker.motivation.en.shortfall, 2);
    assert.equal(report.contentWorker.sleep.status, "shortfall");
    assert.equal(report.contentWorker.publicationProof, false);
    const markdown = await readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/latest.md",
    ), "utf8");
    assert.match(markdown, /ES planned\/rendered\/shortfall: 5\/4\/1/);
    assert.match(markdown, /EN planned\/rendered\/shortfall: 5\/3\/2/);
    assert.match(markdown, /not publication proof; no YouTube upload is claimed/i);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("alerts when today's content worker report is missing or violates no-network zero-cost gates", async () => {
  const workspaceRoot = await fixture({
    content: freshContent({
      generatedAt: "2026-08-11T12:00:00.000Z",
      networkUsed: true,
      publishEnabled: true,
      apiCostUsd: 1,
    }),
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.alerts.contentWorkerMissingOrStale, true);
    assert.equal(report.alerts.contentWorkerSafetyViolation, true);
    assert.deepEqual(report.contentWorker.blockers, [
      "content_worker_report_stale",
      "content_worker_publish_must_remain_disabled",
      "content_worker_network_must_remain_disabled",
      "content_worker_api_cost_must_remain_zero",
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("fails closed on a fresh but malformed content worker report", async () => {
  const workspaceRoot = await fixture({
    ledger: [{
      status: "scheduled",
      account: "@streamersclipusa",
      metricoolId: "valid-tiktok-evidence",
      scheduledFor: "2026-08-12T18:00:00.000Z",
    }],
    content: {
      schemaVersion: 1,
      generatedAt: "2026-08-12T12:00:00.000Z",
      status: "completed",
      networkUsed: false,
      publishEnabled: false,
      apiCostUsd: 0,
      motivation: { es: { channelId: "motivation-es" }, en: { channelId: "motivation-en" } },
      sleep: {},
    },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.contentWorker.freshForToday, true);
    assert.equal(report.contentWorker.schemaValid, false);
    assert.equal(report.alerts.noEvidenceBackedTikTokPost, false);
    assert.equal(report.alerts.contentWorkerInvalidReport, true);
    assert.ok(report.contentWorker.blockers.includes("content_worker_report_schema_invalid"));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
