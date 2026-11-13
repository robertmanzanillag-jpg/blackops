import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LANES = ["motivation_short", "sleep_long"];
const LANGUAGES = ["es", "en"];
const RIGHTS_OK = new Set(["owned", "explicitly_authorized"]);
const PUBLISHED = new Set(["published", "verified_published"]);

const clean = (value) => String(value ?? "").trim();
const finite = (value) => {
  if (value === null || value === undefined || clean(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function iso(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function rowsFromLedger(ledger) {
  if (Array.isArray(ledger)) return ledger;
  for (const key of ["entries", "items", "publications"]) {
    if (Array.isArray(ledger?.[key])) return ledger[key];
  }
  return [];
}

function normalizedRow(row, index, nowMs, maximumMetricsAgeHours) {
  const metrics = row?.metrics && typeof row.metrics === "object" ? row.metrics : row;
  const publishedAt = iso(row?.publishedAt || row?.published_at || row?.scheduledFor);
  const observedAt = iso(metrics?.observedAt || row?.metricsObservedAt || row?.metrics_observed_at);
  const views = finite(metrics?.views);
  const windowHours = finite(metrics?.windowHours ?? row?.metricWindowHours ?? row?.observationWindowHours);
  const observedMs = observedAt ? Date.parse(observedAt) : NaN;
  const ageHours = Number.isFinite(observedMs) ? Math.max(0, (nowMs - observedMs) / 3_600_000) : null;
  const metricBlockers = [];
  if (views === null) metricBlockers.push("views_missing");
  if (!observedAt) metricBlockers.push("metrics_observed_at_missing");
  if (windowHours === null || windowHours <= 0) metricBlockers.push("metric_window_missing");
  if (ageHours !== null && ageHours > maximumMetricsAgeHours) metricBlockers.push("metrics_stale");
  const blockers = [...metricBlockers];
  if (!PUBLISHED.has(clean(row?.status).toLowerCase())) blockers.push("publication_not_verified");
  if (!publishedAt) blockers.push("published_at_missing");
  if (!RIGHTS_OK.has(clean(row?.rightsStatus || row?.rights_status).toLowerCase())) blockers.push("rights_not_verified");
  if (row?.accountVerified !== true) blockers.push("account_not_verified");
  if (row?.qualityPassed !== true) blockers.push("quality_not_passed");
  if (!clean(row?.account)) blockers.push("account_missing");
  const lane = clean(row?.lane);
  const language = clean(row?.language).toLowerCase();
  if (!LANES.includes(lane)) blockers.push("lane_invalid");
  if (!LANGUAGES.includes(language)) blockers.push("language_invalid");
  return {
    id: clean(row?.id || row?.metricoolId || row?.publicUrl) || `row-${index + 1}`,
    lane,
    language,
    account: clean(row?.account).replace(/^@/, "").toLowerCase(),
    publishedAt,
    observedAt,
    views,
    windowHours,
    completionRate: finite(metrics?.completionRate),
    averageViewDurationSeconds: finite(metrics?.averageViewDurationSeconds),
    experimentId: clean(row?.experiment?.id || row?.experimentId) || null,
    experimentVariable: clean(row?.experiment?.variable || row?.experimentVariable) || null,
    experimentVariant: clean(row?.experiment?.variant || row?.experimentVariant) || null,
    metricBlockers: [...new Set(metricBlockers)],
    blockers: [...new Set(blockers)],
    usable: blockers.length === 0,
  };
}

function comparableGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.usable) continue;
    const key = `${row.account}|${row.lane}|${row.language}|${row.windowHours}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

export function evaluateExperiments(rows, { minimumSamplesPerVariant = 3, minimumWinnerLift = 0.2 } = {}) {
  const experiments = new Map();
  for (const row of rows.filter((candidate) => candidate.usable && candidate.experimentId)) {
    const current = experiments.get(row.experimentId) || [];
    current.push(row);
    experiments.set(row.experimentId, current);
  }
  return [...experiments.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([experimentId, samples]) => {
    const variables = [...new Set(samples.map((row) => row.experimentVariable).filter(Boolean))];
    const contexts = [...new Set(samples.map((row) => `${row.account}|${row.lane}|${row.language}|${row.windowHours}`))];
    const variants = new Map();
    for (const sample of samples) {
      if (!sample.experimentVariant) continue;
      const current = variants.get(sample.experimentVariant) || [];
      current.push(sample);
      variants.set(sample.experimentVariant, current);
    }
    const summary = [...variants.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([variant, entries]) => ({
      variant,
      samples: entries.length,
      medianViews: median(entries.map((row) => row.views)),
      medianCompletionRate: median(entries.map((row) => row.completionRate).filter((value) => value !== null)),
    }));
    let reason = "insufficient_samples";
    let winner = null;
    let lift = null;
    if (variables.length !== 1) reason = "experiment_does_not_isolate_one_variable";
    else if (contexts.length !== 1) reason = "non_comparable_windows_or_audiences";
    else if (summary.length !== 2) reason = "exactly_two_variants_required";
    else if (summary.some((row) => row.samples < minimumSamplesPerVariant)) reason = "insufficient_samples";
    else {
      const ordered = [...summary].sort((a, b) => b.medianViews - a.medianViews || a.variant.localeCompare(b.variant));
      const [best, control] = ordered;
      lift = control.medianViews > 0 ? (best.medianViews - control.medianViews) / control.medianViews : null;
      const completionRegression = best.medianCompletionRate !== null && control.medianCompletionRate !== null
        && best.medianCompletionRate < control.medianCompletionRate * 0.9;
      if (lift === null) reason = "zero_baseline_cannot_establish_winner";
      else if (lift < minimumWinnerLift) reason = "lift_below_threshold";
      else if (completionRegression) reason = "completion_rate_regression";
      else {
        reason = "winner_supported";
        winner = best.variant;
      }
    }
    return { experimentId, variable: variables.length === 1 ? variables[0] : null, variants: summary, winner, lift, reason };
  });
}

function laneGate(config, lane, language = null) {
  const gate = language
    ? config?.shortChannels?.[language] || config?.laneGates?.[lane] || {}
    : config?.laneGates?.[lane] || {};
  const blockers = [];
  if (gate.accountVerified !== true) blockers.push("account_gate_closed");
  if (!RIGHTS_OK.has(clean(gate.rightsStatus).toLowerCase())) blockers.push("rights_gate_closed");
  if (gate.qualityPassed !== true) blockers.push("quality_gate_closed");
  if (gate.candidatesReady !== true) blockers.push("candidate_gate_closed");
  return blockers;
}

function motivationDecision(rows, config, language) {
  const editorialTarget = 5;
  const gateConfig = config?.shortChannels?.[language] || config?.laneGates?.motivation_short || {};
  const eligibleCandidates = boundedInteger(gateConfig.eligibleCandidates, 0, 0, 100);
  const gateBlockers = laneGate(config, "motivation_short", language);
  const relevant = rows.filter((row) => row.lane === "motivation_short" && row.language === language);
  const usableRelevant = relevant.filter((row) => row.usable);
  const missingOrStale = relevant.length > 0 && usableRelevant.length === 0;
  if (gateBlockers.length || missingOrStale) {
    return {
      lane: "motivation_short", language, editorialTarget, target: 0, shortfall: editorialTarget, eligibleCandidates,
      advisoryRecommendedDaily: null,
      action: "pause", reason: gateBlockers.length ? "mandatory_gate_closed" : "metrics_missing_or_stale",
      blockers: [...gateBlockers, ...(missingOrStale ? ["metrics_missing_or_stale"] : [])],
      baseline: null, recent: null, performanceRatio: null,
    };
  }
  if (!relevant.length) {
    const target = Math.min(editorialTarget, eligibleCandidates);
    return {
      lane: "motivation_short", language, editorialTarget, target, shortfall: editorialTarget - target, eligibleCandidates,
      advisoryRecommendedDaily: null,
      action: "cold_start_controlled", reason: "no_verified_metrics_baseline",
      blockers: [], baseline: null, recent: null, performanceRatio: null,
    };
  }
  const groups = [...comparableGroups(relevant).values()].sort((a, b) => b.length - a.length);
  const group = groups[0] || [];
  if (group.length < 3) {
    const target = Math.min(editorialTarget, eligibleCandidates);
    return { lane: "motivation_short", language, editorialTarget, target, shortfall: editorialTarget - target, eligibleCandidates, advisoryRecommendedDaily: null, action: "hold_inconclusive", reason: "insufficient_comparable_samples", blockers: [], baseline: null, recent: null, performanceRatio: null };
  }
  const ordered = [...group].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const coverageDays = ordered.length > 1
    ? (Date.parse(ordered.at(-1).publishedAt) - Date.parse(ordered[0].publishedAt)) / (24 * 3_600_000)
    : 0;
  const recentCount = Math.min(3, Math.max(1, Math.floor(ordered.length / 3)));
  const recentRows = ordered.slice(-recentCount);
  const baselineRows = ordered.slice(0, -recentCount);
  if (baselineRows.length < 2 || coverageDays < 14) {
    const target = Math.min(editorialTarget, eligibleCandidates);
    return { lane: "motivation_short", language, editorialTarget, target, shortfall: editorialTarget - target, eligibleCandidates, advisoryRecommendedDaily: null, action: "hold_inconclusive", reason: coverageDays < 14 ? "minimum_14_day_baseline_not_met" : "insufficient_comparable_samples", blockers: [], baseline: null, recent: null, performanceRatio: null, coverageDays };
  }
  const baseline = median(baselineRows.map((row) => row.views));
  const recent = median(recentRows.map((row) => row.views));
  const ratio = baseline > 0 ? recent / baseline : null;
  const lastChangeMs = Date.parse(clean(gateConfig.lastVolumeChangeAt || config.lastMotivationVolumeChangeAt));
  const inWeeklyCooldown = Number.isFinite(lastChangeMs)
    && (Date.parse(config.nowIso || rows[0]?.observedAt || 0) - lastChangeMs) < 7 * 24 * 3_600_000;
  const safeTarget = Math.min(editorialTarget, eligibleCandidates);
  const base = { lane: "motivation_short", language, editorialTarget, target: safeTarget, shortfall: editorialTarget - safeTarget, eligibleCandidates, blockers: [], baseline, recent, performanceRatio: ratio, coverageDays };
  if (inWeeklyCooldown) return { ...base, advisoryRecommendedDaily: editorialTarget, action: "hold", reason: "weekly_volume_adjustment_cooldown" };
  if (ratio === null) return { ...base, advisoryRecommendedDaily: null, action: "hold_inconclusive", reason: "zero_baseline" };
  if (ratio >= 1.25) return { ...base, advisoryRecommendedDaily: editorialTarget + 1, action: "recommend_increase_by_one", reason: "recent_views_at_least_25_percent_above_baseline" };
  if (ratio < 0.75) {
    const guardedTarget = Math.min(Math.max(0, editorialTarget - 1), eligibleCandidates);
    return { ...base, target: guardedTarget, shortfall: editorialTarget - guardedTarget, advisoryRecommendedDaily: editorialTarget - 1, action: "performance_guardrail_decrease_by_one", reason: "recent_views_more_than_25_percent_below_baseline" };
  }
  return { ...base, advisoryRecommendedDaily: editorialTarget, action: "hold", reason: "recent_views_within_baseline_band" };
}

function sleepDecision(rows, now, config) {
  const gateBlockers = laneGate(config, "sleep_long");
  const relevant = rows.filter((row) => row.lane === "sleep_long");
  const cutoff = now.getTime() - 7 * 24 * 3_600_000;
  const recentPublished = relevant.filter((row) => row.publishedAt && Date.parse(row.publishedAt) > cutoff).length;
  if (gateBlockers.length) return { lane: "sleep_long", target: 0, maximumPerSevenDays: 1, action: "pause", reason: "mandatory_gate_closed", blockers: gateBlockers, publishedLastSevenDays: recentPublished };
  if (recentPublished >= 1) return { lane: "sleep_long", target: 0, maximumPerSevenDays: 1, action: "wait", reason: "seven_day_frequency_cap_reached", blockers: [], publishedLastSevenDays: recentPublished };
  if (relevant.length) {
    const latest = [...relevant].sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))[0];
    if (latest.metricBlockers.length) return { lane: "sleep_long", target: 0, maximumPerSevenDays: 1, action: "pause", reason: "metrics_missing_or_stale", blockers: latest.metricBlockers, publishedLastSevenDays: recentPublished };
  }
  return { lane: "sleep_long", target: 1, maximumPerSevenDays: 1, action: relevant.length ? "test_one" : "cold_start_one", reason: relevant.length ? "eligible_after_seven_day_cooldown" : "no_prior_publication_conservative_test", blockers: [], publishedLastSevenDays: recentPublished };
}

export function buildContentLearningDecision({ ledger, now = new Date(), config = {} }) {
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error("invalid_now");
  const maximumMetricsAgeHours = finite(config.maximumMetricsAgeHours) ?? 72;
  const rows = rowsFromLedger(ledger).map((row, index) => normalizedRow(row, index, current.getTime(), maximumMetricsAgeHours));
  const rejected = rows.filter((row) => !row.usable).map(({ id, blockers }) => ({ id, blockers }));
  const decisionConfig = { ...config, nowIso: current.toISOString() };
  const lanes = [
    motivationDecision(rows, decisionConfig, "es"),
    motivationDecision(rows, decisionConfig, "en"),
    sleepDecision(rows, current, config),
  ];
  const experiments = evaluateExperiments(rows, config.experimentRules);
  const report = {
    generatedAt: current.toISOString(),
    sourceRows: rows.length,
    usableMetricRows: rows.filter((row) => row.usable).length,
    rejectedRows: rejected,
    learning: {
      factsOnly: true,
      winners: experiments.filter((row) => row.winner).map((row) => ({ experimentId: row.experimentId, variable: row.variable, winner: row.winner, lift: row.lift })),
      inconclusive: experiments.filter((row) => !row.winner).map((row) => ({ experimentId: row.experimentId, reason: row.reason })),
      statement: rows.some((row) => row.usable)
        ? "Recommendations use only verified metrics from this channel and comparable observation windows."
        : "No learning claim is available because no verified comparable metric row passed every gate.",
    },
  };
  return {
    schemaVersion: 1,
    generatedAt: current.toISOString(),
    mode: "advisory_only",
    networkUsed: false,
    publishEnabled: false,
    credentialsRead: false,
    apiCostUsd: 0,
    dailyPlan: { lanes, totalPlannedAssets: lanes.reduce((sum, lane) => sum + lane.target, 0) },
    experiments,
    report,
  };
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

export async function runContentLearningCeo({ ledgerPath, outputDir, now = new Date(), config = {} }) {
  if (!clean(ledgerPath)) throw new Error("ledger_path_required");
  if (!clean(outputDir)) throw new Error("output_dir_required");
  let ledger;
  try {
    ledger = JSON.parse(await readFile(path.resolve(ledgerPath), "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("ledger_json_invalid");
    throw error;
  }
  const decision = buildContentLearningDecision({ ledger, now, config });
  const root = path.resolve(outputDir);
  const planPath = path.join(root, "clippers-content-daily-plan.json");
  const reportPath = path.join(root, "clippers-content-learning-report.json");
  await atomicJson(planPath, { ...decision, report: undefined });
  await atomicJson(reportPath, decision.report);
  return { ...decision, planPath, reportPath };
}

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    values[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  const config = args.config ? JSON.parse(await readFile(path.resolve(args.config), "utf8")) : {};
  const result = await runContentLearningCeo({ ledgerPath: args.ledger, outputDir: args.output, now: args.now || new Date(), config });
  process.stdout.write(`${JSON.stringify({ status: "planned", planPath: result.planPath, reportPath: result.reportPath, totalPlannedAssets: result.dailyPlan.totalPlannedAssets, apiCostUsd: 0 })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
