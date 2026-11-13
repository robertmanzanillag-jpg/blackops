# Clippers Content Learning CEO

This local tool produces an advisory daily volume plan and a fact-only learning report for two separate content lanes. It never connects to a platform, reads credentials, publishes content, or spends money.

## Lanes and limits

- `motivation_short`: two independent channel plans, each with an editorial target of 5 assets per day (`5 es + 5 en`). A channel can plan five only when five distinct candidates have passed rights, account, quality, and deduplication review; otherwise it reports the exact shortfall. Scaling advice requires at least 14 calendar days of comparable evidence. Advice may move by at most one daily post in any seven-day period, but a recommendation above five is advisory only and never authorizes publishing. A performance drop below `0.75x` baseline is the explicit guardrail that may reduce the plan below five.
- `sleep_long`: an initial maximum of one asset in any rolling seven-day period. This protects quality and makes each eight-hour video a deliberate test rather than bulk repetitive content.
- Spanish (`es`) and English (`en`) are evaluated separately. Account, lane, language, and metric observation-window length must all match before rows can be compared.

Mandatory account, rights, candidate-readiness, and quality gates are configured per lane. A closed gate produces a target of zero. On a true motivation cold start with no metric rows, passing gates and five eligible candidates produce a controlled plan of five for that channel; the decision remains `cold_start_controlled`, experiments remain inconclusive, and no winner is named. Existing rows with missing or stale metrics fail closed. With verified but insufficient baseline data, volume remains capped by the five-asset editorial target and actual eligible candidates. Sleep permits one conservative cold-start test only when all mandatory gates pass.

## Ledger schema

The ledger can be a JSON array or an object containing `entries`, `items`, or `publications`. Each publication should contain:

```json
{
  "id": "short-es-001",
  "lane": "motivation_short",
  "language": "es",
  "account": "channel-name",
  "status": "published",
  "publishedAt": "2026-08-20T14:00:00Z",
  "rightsStatus": "owned",
  "accountVerified": true,
  "qualityPassed": true,
  "metrics": {
    "observedAt": "2026-08-22T14:00:00Z",
    "windowHours": 48,
    "views": 1200,
    "completionRate": 0.42,
    "averageViewDurationSeconds": 18.4
  },
  "experiment": {
    "id": "hook-001",
    "variable": "hook_style",
    "variant": "direct"
  }
}
```

Metrics are never estimated. Negative, missing, stale, or un-timestamped values are rejected. Earnings are not calculated from views.

## Experiments

An experiment must isolate exactly one named variable, use exactly two variants, and keep account, lane, language, and observation window identical. The default minimum is three verified samples per variant. A winner requires at least 20% median-view lift and no completion-rate regression greater than 10%. Otherwise the report explicitly says the experiment is inconclusive.

## Configuration and CLI

```json
{
  "maximumMetricsAgeHours": 72,
  "shortChannels": {
    "es": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true, "eligibleCandidates": 5 },
    "en": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true, "eligibleCandidates": 5 }
  },
  "laneGates": {
    "sleep_long": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true }
  }
}
```

Run locally:

```sh
node script/clippers-content-learning-ceo.mjs \
  --ledger /absolute/path/publication-metrics-ledger.json \
  --config /absolute/path/content-learning-config.json \
  --output /absolute/path/reports \
  --now 2026-08-24T14:00:00Z
```

Outputs are written atomically with owner-only permissions:

- `clippers-content-daily-plan.json`
- `clippers-content-learning-report.json`

Both outputs are evidence artifacts, not publishing instructions. Another reviewed component must enforce publication permissions separately.
