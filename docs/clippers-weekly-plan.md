# Clippers weekly demand planner

`script/clippers-weekly-plan.mjs` exports `planClippersWeek` and `newYorkSlot`. This is a pure read-only planner, not a scheduler or a rights verifier. It performs no I/O, model calls, uploads, or provider writes. Current rollout window: November 18–22, 2026, America/New_York. Four exact destinations × five days × five posts = 100 target posts before existing verified coverage. Brand 6595747 remains disconnected pending network verification; KONG and BlackRoom are excluded by the adapter's fixed destination allowlist.

## Trusted input boundary

The calling owner workflow must obtain fresh, complete Metricool GET results for each exact destination/day, including pagination and account identity verification. Normalize them into `snapshots` entries:

```js
{
  destination: { brandId: 6431685, network: 'tiktok', account: 'streamersus' },
  day: '2026-11-18', status: 'verified', complete: true,
  observedAt: '2026-11-18T14:00:00Z', evidenceSha256: '<actual retained GET evidence digest>',
  posts: [{
    destination: { brandId: 6431685, network: 'tiktok', account: 'streamersus' },
    providerPostId: '<actual Metricool ID>', scheduledAt: '2026-11-18T17:00:00Z',
    status: 'scheduled', confirmationSha256: '<actual retained confirmation digest>'
  }]
}
```

These fields are attestations from trusted adapter code and retained receipts, not permissions or provider proof inferred by a language model. Hash shape validation does not authenticate an arbitrary caller. There is deliberately no network/CLI path that accepts model JSON and starts scheduling. For a normalized published row, `scheduledAt` is the actual confirmed publication time (the effective calendar coverage), not the obsolete planned time; it must be no later than that snapshot's observedAt. Today's already published posts require actual publication-confirmation receipts; a past scheduled row is unreconciled, not successful coverage. Omitted/partial/stale reads are unknown, never empty schedules. Receipt-only uncertain/in-flight attempts must be supplied in `reservations` with exact `destination`, `day`, and `status: 'in_flight' | 'outcome_unknown'`; these block automatic retry until the provider is reconciled.

Call with `{ now, startDate, endDate, snapshots, reservations, proposedHours }`. Dates are NY calendar dates, at most seven days. Default end is Sunday. Snapshot age is at most 15 minutes. Default proposed hours are 12, 14, 16, 18 and 20 NY; these are **proposals**, not approved policy slots or claimed best times. Caller may supply five distinct hours after checking owner-reviewed policy slots and observed best-time data. DST repeated/missing hours are excluded. Posts in the same local hour conflict even at different minutes. Existing five-post conflicts or excess posts require owner reconciliation; no sixth post or deletion is proposed. Past missed slots do not move to tomorrow.

## Execution recipe and current missing links

1. Read all four exact account identities, timezone, complete schedules and actual publication confirmations through the authorized Metricool adapter/plugin. Retain evidence and normalize snapshots. Reconcile unknown attempts before retrying.
2. Run the pure planner. Inspect held cells, distribution conflicts, unknown cells and future proposal slots. `coverageComplete` is false when any cell is unknown or has conflicted identity; `providerConfirmedCount` is only the observed subtotal, never a complete week total in that case. `knownDeficit` excludes unknown cells; `providerConfirmedCount` is coverage only, not unique-media or verified performance. `readyAssetsVerified` stays null: this planner has not audited assets.
3. Obtain exact-slot owner-reviewed assets and source/rights proof. Current actual eligible inventory is zero. Public RSS candidates carry unknown rights; creator names, RSS presence and popularity confer no publishing permission. No placeholders can fill demand.
4. Use existing renderer → private preparation packet → existing Drive/media receipt → approved input workflow. Retain source/render/request/policy/evidence hashes and target scope. Revalidate source freshness at publication (currently at most 72h), rights through scheduledAt, current rights review (24h), direct media byte proof and publication capability. Local FFmpeg and deterministic metadata cost no model API dollars. No paid spend or increase to the user's common $100 API ceiling is authorized by a plan.
5. Existing preparation and learner intentionally accept **only today's NY date**, at least five minutes ahead. The Metricool adapter itself supports future dates and enforces five per account/day, but this planner does not widen the preparation/learner gates. A reviewed future-horizon executor change or rolling daily preparation is still required to complete the whole week's future queue. Wednesday source freshness cannot be silently extended to Sunday.
6. Immediately before each authorized write, rerun existing adapter preflight for the exact day/account and distinct local hour, current rights/media and duplicate checks. Serialize writes; persist attempt receipt before dispatch. On lost acknowledgement, hold and reconcile via GET, never repost automatically. Confirm actual Metricool ID/time/network/media/status with GET before reporting scheduled. Rebuild snapshots and plan after writes; keep backups and immutable evidence.

No runtime installation, provider execution or publishing flag changes are part of this module. The new different-hour requirement can leave existing creator-comparison studies requiring multiple slots in one hour unmeasured; this planner does not weaken experiment controls or override the publication requirement.

Rollback: remove these new planner/test/doc files; existing runtime behavior is unchanged.
