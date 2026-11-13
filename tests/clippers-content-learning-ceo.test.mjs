import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildContentLearningDecision,
  evaluateExperiments,
  runContentLearningCeo,
} from "../script/clippers-content-learning-ceo.mjs";

const NOW = "2026-08-24T14:00:00.000Z";
const gates = {
  motivation_short: { accountVerified: true, rightsStatus: "owned", qualityPassed: true, candidatesReady: true, eligibleCandidates: 5 },
  sleep_long: { accountVerified: true, rightsStatus: "explicitly_authorized", qualityPassed: true, candidatesReady: true },
};

function row({
  id = "row", lane = "motivation_short", language = "es", account = "motivation-es",
  publishedAt = "2026-08-20T14:00:00.000Z", observedAt = "2026-08-23T14:00:00.000Z",
  windowHours = 48, views = 100, completionRate = 0.5, status = "published",
  rightsStatus = "owned", accountVerified = true, qualityPassed = true, experiment,
} = {}) {
  return {
    id, lane, language, account, publishedAt, status, rightsStatus, accountVerified, qualityPassed,
    metrics: { observedAt, windowHours, views, completionRate, averageViewDurationSeconds: 20 },
    ...(experiment ? { experiment } : {}),
  };
}

function decision(entries, config = {}) {
  return buildContentLearningDecision({
    ledger: { entries }, now: NOW,
    config: { laneGates: gates, ...config },
  });
}

test("cold start plans five per gated channel without claiming a winner", () => {
  const result = decision([]);
  const motivation = result.dailyPlan.lanes.filter((lane) => lane.lane === "motivation_short");
  assert.deepEqual(motivation.map((lane) => lane.target), [5, 5]);
  assert.ok(motivation.every((lane) => lane.action === "cold_start_controlled"));
  assert.equal(result.experiments.length, 0);
  assert.equal(result.report.learning.winners.length, 0);
  assert.equal(result.mode, "advisory_only");
  assert.equal(result.networkUsed, false);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.credentialsRead, false);
  assert.equal(result.apiCostUsd, 0);
});

test("cold start reports exact shortfall independently for ES and EN", () => {
  const result = decision([], {
    shortChannels: {
      es: { ...gates.motivation_short, eligibleCandidates: 5 },
      en: { ...gates.motivation_short, eligibleCandidates: 2 },
    },
  });
  const lanes = result.dailyPlan.lanes.filter((lane) => lane.lane === "motivation_short");
  assert.deepEqual(lanes.map(({ language, target, shortfall }) => ({ language, target, shortfall })), [
    { language: "es", target: 5, shortfall: 0 },
    { language: "en", target: 2, shortfall: 3 },
  ]);
});

test("rejects stale, missing, negative, unverified, unsafe, and malformed rows without inventing metrics", () => {
  const entries = [
    row({ id: "stale", observedAt: "2026-08-01T00:00:00Z" }),
    row({ id: "missing", views: null }),
    row({ id: "negative", views: -1 }),
    row({ id: "draft", status: "scheduled" }),
    row({ id: "rights", rightsStatus: "unknown" }),
    row({ id: "account", accountVerified: false }),
    row({ id: "quality", qualityPassed: false }),
    row({ id: "language", language: "fr" }),
  ];
  const result = decision(entries);
  assert.equal(result.report.usableMetricRows, 0);
  assert.equal(result.dailyPlan.lanes[0].target, 0);
  const rejected = Object.fromEntries(result.report.rejectedRows.map((entry) => [entry.id, entry.blockers]));
  assert.ok(rejected.stale.includes("metrics_stale"));
  assert.ok(rejected.missing.includes("views_missing"));
  assert.ok(rejected.negative.includes("views_missing"));
  assert.ok(rejected.draft.includes("publication_not_verified"));
  assert.ok(rejected.rights.includes("rights_not_verified"));
  assert.ok(rejected.account.includes("account_not_verified"));
  assert.ok(rejected.quality.includes("quality_not_passed"));
  assert.ok(rejected.language.includes("language_invalid"));
  assert.equal(result.report.learning.winners.length, 0);
});

test("collects a conservative baseline with verified but insufficient comparable samples", () => {
  const result = decision([
    row({ id: "one", views: 100 }),
    row({ id: "two", views: 120, publishedAt: "2026-08-21T14:00:00Z" }),
  ]);
  const lane = result.dailyPlan.lanes[0];
  assert.equal(lane.target, 5);
  assert.equal(lane.action, "hold_inconclusive");
});

test("increases motivation volume by only one when recent comparable performance clears 25 percent", () => {
  const views = [100, 100, 100, 130, 140, 150];
  const result = decision(views.map((value, index) => row({
    id: `v-${index}`, views: value, publishedAt: `2026-07-${String(10 + index * 4).padStart(2, "0")}T14:00:00Z`,
  })));
  const lane = result.dailyPlan.lanes[0];
  assert.equal(lane.target, 5);
  assert.equal(lane.advisoryRecommendedDaily, 6);
  assert.equal(lane.action, "recommend_increase_by_one");
  assert.ok(lane.performanceRatio >= 1.25);
});

test("caps motivation at five and decreases by one after a material decline", () => {
  const high = [100, 100, 100, 150, 150, 150].map((views, index) => row({ id: `h-${index}`, views, publishedAt: `2026-07-${10 + index * 4}T14:00:00Z` }));
  assert.equal(decision(high).dailyPlan.lanes[0].target, 5);
  const low = [100, 100, 100, 60, 70, 70].map((views, index) => row({ id: `l-${index}`, views, publishedAt: `2026-07-${10 + index * 4}T14:00:00Z` }));
  const lane = decision(low).dailyPlan.lanes[0];
  assert.equal(lane.target, 4);
  assert.equal(lane.action, "performance_guardrail_decrease_by_one");
});

test("holds volume inside the baseline band and separates English from Spanish", () => {
  const es = [100, 100, 100, 105, 110, 110].map((views, index) => row({ id: `es-${index}`, views, publishedAt: `2026-07-${10 + index * 4}T14:00:00Z` }));
  const en = Array.from({ length: 10 }, (_, index) => row({ id: `en-${index}`, language: "en", account: "motivation-en", windowHours: 24, views: 10_000, publishedAt: `2026-07-${10 + index}T14:00:00Z` }));
  const lane = decision([...es, ...en]).dailyPlan.lanes[0];
  assert.equal(lane.action, "hold");
  assert.equal(lane.target, 5);
  assert.equal(lane.baseline, 100);
});

test("plans five per channel independently and reports exact candidate shortfall", () => {
  const samples = [];
  for (const language of ["es", "en"]) {
    for (let index = 0; index < 3; index += 1) {
      samples.push(row({ id: `${language}-${index}`, language, account: `motivation-${language}`, publishedAt: `2026-08-${10 + index}T14:00:00Z` }));
    }
  }
  const result = decision(samples, {
    shortChannels: {
      es: { ...gates.motivation_short, eligibleCandidates: 5 },
      en: { ...gates.motivation_short, eligibleCandidates: 3 },
    },
  });
  const es = result.dailyPlan.lanes.find((lane) => lane.lane === "motivation_short" && lane.language === "es");
  const en = result.dailyPlan.lanes.find((lane) => lane.lane === "motivation_short" && lane.language === "en");
  assert.deepEqual({ target: es.target, shortfall: es.shortfall }, { target: 5, shortfall: 0 });
  assert.deepEqual({ target: en.target, shortfall: en.shortfall }, { target: 3, shortfall: 2 });
});

test("a fresh comparable group remains usable when unrelated historical rows are stale", () => {
  const fresh = [100, 100, 100, 105, 105, 105].map((views, index) => row({ id: `fresh-${index}`, views, publishedAt: `2026-07-${10 + index * 4}T14:00:00Z` }));
  const result = decision([row({ id: "old", observedAt: "2026-01-01T00:00:00Z" }), ...fresh]);
  assert.equal(result.dailyPlan.lanes[0].action, "hold");
  assert.equal(result.report.usableMetricRows, 6);
});

test("mandatory lane gates always override performance", () => {
  const entries = [100, 100, 100, 200, 200, 200].map((views, index) => row({ id: `${index}`, views, publishedAt: `2026-08-${10 + index}T14:00:00Z` }));
  const result = decision(entries, { laneGates: { ...gates, motivation_short: { ...gates.motivation_short, rightsStatus: "unknown" } } });
  assert.equal(result.dailyPlan.lanes[0].target, 0);
  assert.deepEqual(result.dailyPlan.lanes[0].blockers, ["rights_gate_closed"]);
});

test("requires fourteen days before scaling and permits only one target change per week", () => {
  const shortWindow = [100, 100, 100, 150, 150, 150].map((views, index) => row({ id: `s-${index}`, views, publishedAt: `2026-08-${10 + index}T14:00:00Z` }));
  const immature = decision(shortWindow).dailyPlan.lanes[0];
  assert.equal(immature.target, 5);
  assert.equal(immature.reason, "minimum_14_day_baseline_not_met");
  const mature = [100, 100, 100, 150, 150, 150].map((views, index) => row({ id: `m-${index}`, views, publishedAt: `2026-07-${10 + index * 4}T14:00:00Z` }));
  const cooldown = decision(mature, { lastMotivationVolumeChangeAt: "2026-08-21T14:00:00Z" }).dailyPlan.lanes[0];
  assert.equal(cooldown.target, 5);
  assert.equal(cooldown.reason, "weekly_volume_adjustment_cooldown");
});

test("sleep lane allows one cold-start asset, then enforces a rolling seven-day cap", () => {
  assert.equal(decision([]).dailyPlan.lanes[2].target, 1);
  const recent = row({ id: "sleep", lane: "sleep_long", account: "sleep-en", language: "en", publishedAt: "2026-08-22T14:00:00Z" });
  const capped = decision([recent]).dailyPlan.lanes[2];
  assert.equal(capped.target, 0);
  assert.equal(capped.reason, "seven_day_frequency_cap_reached");
});

test("sleep lane fails closed after cooldown if its latest metrics are missing", () => {
  const old = row({ id: "sleep-old", lane: "sleep_long", account: "sleep-en", language: "en", publishedAt: "2026-08-01T14:00:00Z", views: null });
  const lane = decision([old]).dailyPlan.lanes[2];
  assert.equal(lane.target, 0);
  assert.equal(lane.reason, "metrics_missing_or_stale");
});

test("declares an experiment winner only with isolated, comparable, sufficient evidence", () => {
  const samples = [];
  for (const [variant, values] of [["control", [100, 100, 100]], ["question", [130, 135, 140]]]) {
    values.forEach((views, index) => samples.push(row({
      id: `${variant}-${index}`, views, completionRate: variant === "control" ? 0.5 : 0.49,
      experiment: { id: "hook-1", variable: "hook_style", variant },
    })));
  }
  const experiments = decision(samples).experiments;
  assert.equal(experiments[0].winner, "question");
  assert.equal(experiments[0].reason, "winner_supported");
  assert.ok(experiments[0].lift >= 0.2);
});

test("does not name winners for insufficient, multi-variable, non-comparable, weak, or quality-regressing tests", () => {
  const insufficient = [
    row({ id: "a", experiment: { id: "small", variable: "hook", variant: "a" } }),
    row({ id: "b", views: 200, experiment: { id: "small", variable: "hook", variant: "b" } }),
  ];
  const multi = [];
  const nonComparable = [];
  const weak = [];
  const regression = [];
  for (let index = 0; index < 3; index += 1) {
    multi.push(row({ id: `ma-${index}`, experiment: { id: "multi", variable: "hook", variant: "a" } }));
    multi.push(row({ id: `mb-${index}`, views: 150, experiment: { id: "multi", variable: "caption", variant: "b" } }));
    nonComparable.push(row({ id: `na-${index}`, experiment: { id: "context", variable: "hook", variant: "a" } }));
    nonComparable.push(row({ id: `nb-${index}`, language: "en", experiment: { id: "context", variable: "hook", variant: "b" } }));
    weak.push(row({ id: `wa-${index}`, experiment: { id: "weak", variable: "hook", variant: "a" } }));
    weak.push(row({ id: `wb-${index}`, views: 110, experiment: { id: "weak", variable: "hook", variant: "b" } }));
    regression.push(row({ id: `ra-${index}`, completionRate: 0.6, experiment: { id: "regress", variable: "hook", variant: "a" } }));
    regression.push(row({ id: `rb-${index}`, views: 150, completionRate: 0.4, experiment: { id: "regress", variable: "hook", variant: "b" } }));
  }
  const results = Object.fromEntries(evaluateExperiments([...insufficient, ...multi, ...nonComparable, ...weak, ...regression].map((entry, index) => {
    const single = decision([entry]).report.rejectedRows;
    assert.equal(single.length, 0);
    // buildContentLearningDecision normalizes rows; use its experiment result below instead.
    return entry;
  })).map((entry) => [entry.experimentId, entry]));
  // Raw rows are intentionally not accepted by evaluateExperiments; verify through the public decision boundary.
  const normalizedResults = Object.fromEntries(decision([...insufficient, ...multi, ...nonComparable, ...weak, ...regression]).experiments.map((entry) => [entry.experimentId, entry]));
  assert.equal(Object.keys(results).length, 0);
  assert.equal(normalizedResults.small.reason, "insufficient_samples");
  assert.equal(normalizedResults.multi.reason, "experiment_does_not_isolate_one_variable");
  assert.equal(normalizedResults.context.reason, "non_comparable_windows_or_audiences");
  assert.equal(normalizedResults.weak.reason, "lift_below_threshold");
  assert.equal(normalizedResults.regress.reason, "completion_rate_regression");
  assert.ok(Object.values(normalizedResults).every((entry) => entry.winner === null));
});

test("writes separate atomic plan and fact-only report files from array ledgers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-learning-ceo-"));
  const ledgerPath = path.join(root, "ledger.json");
  const outputDir = path.join(root, "reports");
  await writeFile(ledgerPath, JSON.stringify([row()]));
  const result = await runContentLearningCeo({ ledgerPath, outputDir, now: NOW, config: { laneGates: gates } });
  const plan = JSON.parse(await readFile(result.planPath, "utf8"));
  const report = JSON.parse(await readFile(result.reportPath, "utf8"));
  assert.equal(plan.publishEnabled, false);
  assert.equal(plan.report, undefined);
  assert.equal(report.factsOnly, undefined);
  assert.equal(report.learning.factsOnly, true);
  assert.equal((await stat(result.planPath)).mode & 0o777, 0o600);
});

test("rejects invalid dates, invalid JSON, and missing paths", async () => {
  assert.throws(() => buildContentLearningDecision({ ledger: [], now: "not-a-date" }), /invalid_now/);
  const root = await mkdtemp(path.join(os.tmpdir(), "content-learning-errors-"));
  const bad = path.join(root, "bad.json");
  await writeFile(bad, "{");
  await assert.rejects(runContentLearningCeo({ ledgerPath: bad, outputDir: root }), /ledger_json_invalid/);
  await assert.rejects(runContentLearningCeo({ ledgerPath: "", outputDir: root }), /ledger_path_required/);
});
