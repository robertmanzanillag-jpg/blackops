import { createHash } from 'node:crypto';

// Pure evaluator. The caller must join the real delivery/analytics ledgers and verify
// the referenced receipt files. Digests here bind that evidence; they do not attest it.
// Legacy rows without the added pre-publication assignment remain unmeasured.
// assignmentSha256 binds a shared immutable batch manifest (including expiresAt);
// the integration retains separate individual asset-assignment entries.
// readyUntil is derived by that adapter from the current scope's verified proofs.
const HOUR = 3_600_000;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const id = value => typeof value === 'string' && ID.test(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const SLOT = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WINDOWS = new Set([24, 72, 168]);
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
};
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return NaN;
  const [year, month, day, hour, minute, second] = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})/).slice(1).map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return hour < 24 && minute < 60 && second < 60 && date.toISOString().slice(0, 10) === value.slice(0, 10) ? Date.parse(value) : NaN;
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const destinationValid = value => Number.isSafeInteger(value?.brandId) && value.brandId > 0 &&
  ['tiktok', 'facebook', 'youtube', 'instagram'].includes(value.network) && id(value.account);
const scope = row => ({ destination: row.destination, language: row.language, format: row.format,
  context: row.context, renderManifestSha256: row.renderManifestSha256,
  renderEngineSha256: row.renderEngineSha256, postingSlot: row.postingSlot, windowHours: row.windowHours });
const contextValid = row => destinationValid(row?.destination) && LANGUAGE.test(row.language ?? '') &&
  id(row.format) && row.format !== 'unknown' && id(row.context) &&
  id(row.baselineCreatorGroupId) && SHA.test(row.renderManifestSha256 ?? '') &&
  SHA.test(row.renderEngineSha256 ?? '') && SLOT.test(row.postingSlot ?? '') && WINDOWS.has(row.windowHours);
const clone = value => JSON.parse(JSON.stringify(value));

function sampleReason(row, context, now, policy) {
  if (![row.deliveryId, row.postId, row.creatorGroupId].every(value => id(value)) ||
      !/^UC[A-Za-z0-9_-]{22}$/.test(row.channelId ?? '')) return 'identity_unverified';
  if (row.timing !== 'provider_observation_time') return 'provider_timing_required';
  const published = timestamp(row.publishedAt), observed = timestamp(row.observedAt);
  const age = (observed - published) / HOUR;
  if (!Number.isFinite(published) || !Number.isFinite(observed) || published > observed || observed > now ||
      now - observed >= policy.maxObservationAgeHours * HOUR || !finite(row.actualAgeHours) ||
      Math.abs(row.actualAgeHours - age) > 0.000001 || age < context.windowHours || age >= context.windowHours + 24) return 'observation_age_or_freshness_unverified';
  if (!Number.isSafeInteger(row.views) || row.views < 0) return 'views_missing_or_invalid';
  if (row.qualityDefinition !== 'completion_rate' || !finite(row.completionRate) || row.completionRate < 0 || row.completionRate > 1) return 'direct_quality_metric_required';
  if (row.costUsd !== 0 || !finite(row.elapsedMs) || row.elapsedMs <= 0) return 'cost_or_elapsed_unverified';
  if (!SHA.test(row.sourceSha256 ?? '') || !finite(row.sourceStartSeconds) || row.sourceStartSeconds < 0 ||
      !finite(row.durationSeconds) || row.durationSeconds <= 0 ||
      !(/^[A-Za-z0-9_-]{11}$/.test(row.sourceVideoId ?? '') && typeof row.sourceVideoId === 'string') ||
      (row.sourceEpisodeId != null && !id(row.sourceEpisodeId))) return 'source_segment_unverified';
  const evidence = row.evidence;
  if (!evidence || evidence.status !== 'ready' || !['publicationReceiptSha256', 'renderReceiptSha256', 'rightsEvidenceSha256', 'assignmentSha256'].every(key => SHA.test(evidence[key] ?? ''))) return 'ready_receipts_required';
  const rightsObserved = timestamp(evidence.rightsObservedAt), rightsUntil = timestamp(evidence.rightsValidUntil), sourcePublished = timestamp(evidence.sourcePublishedAt);
  if (!Number.isFinite(rightsObserved) || rightsObserved > published || published - rightsObserved > 24 * HOUR ||
      !Number.isFinite(rightsUntil) || rightsUntil < published || !Number.isFinite(sourcePublished) ||
      sourcePublished > published || published - sourcePublished > policy.maxSourceAgeAtPublicationHours * HOUR) return 'rights_or_source_freshness_unverified';
  const experiment = row.selectionExperiment;
  if (!experiment || !id(experiment.id) || !id(experiment.controlCreatorGroupId) ||
      !id(experiment.challengerCreatorGroupId) || experiment.controlCreatorGroupId !== context.baselineCreatorGroupId ||
      experiment.controlCreatorGroupId === experiment.challengerCreatorGroupId ||
      !['control', 'challenger'].includes(experiment.arm) ||
      row.creatorGroupId !== (experiment.arm === 'control' ? experiment.controlCreatorGroupId : experiment.challengerCreatorGroupId) ||
      !Number.isFinite(timestamp(experiment.registeredAt)) || timestamp(experiment.registeredAt) >= published ||
      !Number.isFinite(timestamp(experiment.expiresAt)) || timestamp(experiment.expiresAt) <= timestamp(experiment.registeredAt) + context.windowHours * HOUR ||
      timestamp(experiment.expiresAt) > timestamp(experiment.registeredAt) + 720 * HOUR || observed >= timestamp(experiment.expiresAt)) return 'prepublication_assignment_required';
  if (timestamp(experiment.expiresAt) <= now) return 'assignment_expired';
  return null;
}
function collision(a, b) {
  return a.postId === b.postId || a.deliveryId === b.deliveryId ||
    a.evidence.publicationReceiptSha256 === b.evidence?.publicationReceiptSha256 ||
    a.evidence.renderReceiptSha256 === b.evidence?.renderReceiptSha256 ||
    (a.sourceVideoId && a.sourceVideoId === b.sourceVideoId) ||
    (a.sourceEpisodeId && a.sourceEpisodeId === b.sourceEpisodeId) ||
    a.sourceSha256 === b.sourceSha256;
}
function identityKeys(row) {
  return [ ['post', row.postId], ['delivery', row.deliveryId], ['publication', row.evidence?.publicationReceiptSha256],
    ['render', row.evidence?.renderReceiptSha256], ['video', row.sourceVideoId], ['episode', row.sourceEpisodeId],
    ['source', row.sourceSha256], ['assignment', row.evidence?.assignmentSha256] ]
    .filter(([, value]) => typeof value === 'string' && value.length > 0).map(([kind, value]) => kind + ':' + value);
}
const cohortKey = row => canonical([row.selectionExperiment.id, row.selectionExperiment.challengerCreatorGroupId]);
const append = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
function expiredCohort(rows, context, now) {
  if (!rows.length) return false;
  const bindings = rows.map(row => ({ id: row.selectionExperiment.id, controlCreatorGroupId: row.selectionExperiment.controlCreatorGroupId, challengerCreatorGroupId: row.selectionExperiment.challengerCreatorGroupId, registeredAt: row.selectionExperiment.registeredAt, expiresAt: row.selectionExperiment.expiresAt, assignmentSha256: row.evidence?.assignmentSha256 }));
  return new Set(bindings.map(canonical)).size === 1 && rows.every(row => {
    const e = row.selectionExperiment, registered = timestamp(e.registeredAt), expires = timestamp(e.expiresAt);
    return SHA.test(row.evidence?.assignmentSha256 ?? '') && Number.isFinite(registered) && registered < timestamp(row.publishedAt) &&
      Number.isFinite(expires) && expires > registered + context.windowHours * HOUR && expires <= registered + 720 * HOUR && expires <= now;
  });
}
function batchReceipt(id, rows, hashes) {
  const controls = rows.filter(row => row.selectionExperiment.arm === 'control');
  const challengers = rows.filter(row => row.selectionExperiment.arm === 'challenger');
  if (controls.length !== 5 || challengers.length !== 5) return { id, passed: false, reason: 'exact_five_per_arm_required', evidenceHashes: rows.map(row => hashes.get(row)).sort() };
  const ageBins=[...new Set(rows.map(row=>Math.floor(row.actualAgeHours)))];
  if(ageBins.length!==1)return {id,passed:false,reason:'actual_age_bin_mismatch',evidenceHashes:rows.map(row=>hashes.get(row)).sort()};
  const control = { views: median(controls.map(row => row.views)), completionRate: median(controls.map(row => row.completionRate)), costUsd: median(controls.map(row => row.costUsd)), elapsedMs: median(controls.map(row => row.elapsedMs)) };
  const challenger = { views: median(challengers.map(row => row.views)), completionRate: median(challengers.map(row => row.completionRate)), costUsd: median(challengers.map(row => row.costUsd)), elapsedMs: median(challengers.map(row => row.elapsedMs)) };
  const lift = control.views > 0 ? challenger.views / control.views - 1 : null;
  const reason = lift === null ? 'positive_control_median_required' : BigInt(challenger.views) * 5n < BigInt(control.views) * 6n ? 'median_lift_below_twenty_percent' : challenger.completionRate < control.completionRate ? 'quality_regression' : challenger.costUsd > control.costUsd || challenger.elapsedMs > control.elapsedMs ? 'cost_or_elapsed_regression' : 'batch_passed';
  return { id, passed: reason === 'batch_passed', reason, actualAgeBinHours:ageBins[0], control, challenger, viewLift: lift, evidenceHashes: rows.map(row => hashes.get(row)).sort() };
}

/** preferences only order already-ready assets in this exact scope; never alter
 * destination permissions, publication caps, rights, render parameters or spending.
 * Input is JSON data, not provider responses or executable commands. */
export function selectCreatorPreferences({ samples = [], contexts = [], previousPreferences = [], evaluatedAt, policy = {} } = {}) {
  const now = timestamp(evaluatedAt);
  const limits = { maxObservationAgeHours: policy.maxObservationAgeHours ?? 720,
    preferenceTtlHours: policy.preferenceTtlHours ?? 24, maxSourceAgeAtPublicationHours: policy.maxSourceAgeAtPublicationHours ?? 72 };
  if (!Number.isFinite(now) || !Array.isArray(samples) || samples.length > 10_000 || !Array.isArray(contexts) || contexts.length > 32 ||
      !Array.isArray(previousPreferences) || previousPreferences.length > 32 || Object.keys(policy).some(key => !(key in limits)) ||
      Object.entries(limits).some(([key, value]) => !finite(value) || value <= 0 || value > (key === 'maxSourceAgeAtPublicationHours' ? 72 : key === 'maxObservationAgeHours' ? 720 : 24))) throw Error('creator_selection_input_invalid');
  // JSON normalization rejects cycles, accessors/non-data values are outside this API.
  const normalizedSamples = clone(samples);
  const normalizedContexts = clone(contexts);
  const scopedSamples = new Map(), rowHashes = new Map(), registeredTimes = new Map();
  for (const row of normalizedSamples) {
    rowHashes.set(row, digest(row));
    if (!row || typeof row !== 'object') continue;
    append(scopedSamples, digest(scope(row)), row);
    const registered = timestamp(row.selectionExperiment?.registeredAt);
    registeredTimes.set(row, Number.isFinite(registered) ? registered : -Infinity);
  }
  const sampleHashes = normalizedSamples.map(row => rowHashes.get(row)).sort();
  const results = [], seenScopes = new Set();
  for (const context of normalizedContexts.sort((a, b) => compare(canonical(a), canonical(b)))) {
    if (!contextValid(context)) throw Error('creator_selection_context_invalid');
    const scopeValue = scope(context), scopeKey = digest(scopeValue);
    if (seenScopes.has(scopeKey)) throw Error('creator_selection_duplicate_scope');
    seenScopes.add(scopeKey);
    const scoped = scopedSamples.get(scopeKey) ?? [];
    const excluded = {}, eligible = [], rejectedBatchIds = new Set(), allBatches = new Map(), eligibleBatches = new Map();
    if (scoped.length !== normalizedSamples.length) excluded.scope_mismatch = normalizedSamples.length - scoped.length;
    for (const row of scoped) {
      if (id(row.selectionExperiment?.id)) append(allBatches, row.selectionExperiment.id, row);
      const reason = sampleReason(row, context, now, limits);
      if (reason) {
        excluded[reason] = (excluded[reason] ?? 0) + 1;
        if (id(row.selectionExperiment?.id)) rejectedBatchIds.add(row.selectionExperiment.id);
      } else {
        eligible.push(row);
        append(eligibleBatches, cohortKey(row), row);
      }
    }
    for (const rows of eligibleBatches.values()) rows.sort((a, b) => compare(rowHashes.get(a), rowHashes.get(b)));
    const allAssigned = scoped.filter(row => id(row.selectionExperiment?.id) &&
      row.selectionExperiment.controlCreatorGroupId === context.baselineCreatorGroupId &&
      id(row.selectionExperiment.challengerCreatorGroupId) && row.selectionExperiment.challengerCreatorGroupId !== context.baselineCreatorGroupId)
      .sort((a, b) => registeredTimes.get(a) - registeredTimes.get(b) || compare(a.selectionExperiment.id, b.selectionExperiment.id));
    const retiredBatches = [], retiredIds = new Set();
    for (const batchId of [...allBatches.keys()].sort()) {
      const members = allBatches.get(batchId);
      if (expiredCohort(members, context, now)) {
        retiredIds.add(batchId);
        retiredBatches.push({ id: batchId, expiresAt: members[0].selectionExperiment.expiresAt, assignmentSha256: members[0].evidence.assignmentSha256 });
      }
    }
    const identityCohorts = new Map(), challengerBatches = new Map();
    for (const row of allAssigned) {
      const cohort = cohortKey(row);
      for (const key of identityKeys(row)) {
        if (!identityCohorts.has(key)) identityCohorts.set(key, new Set());
        identityCohorts.get(key).add(cohort);
      }
      if (!retiredIds.has(row.selectionExperiment.id)) {
        const creator = row.selectionExperiment.challengerCreatorGroupId;
        if (!challengerBatches.has(creator)) challengerBatches.set(creator, new Map());
        const batches = challengerBatches.get(creator);
        if (!batches.has(row.selectionExperiment.id)) batches.set(row.selectionExperiment.id, eligibleBatches.get(cohort) ?? []);
      }
    }
    const conflictingIds = new Set(rejectedBatchIds);
    for (const [batchId, members] of allBatches) {
      if (new Set(members.map(row => row.selectionExperiment.challengerCreatorGroupId)).size !== 1) conflictingIds.add(batchId);
    }
    const candidates = [];
    const contextReady = SHA.test(context.readinessReceiptSha256 ?? '') && timestamp(context.readyUntil) > now;
    for (const creatorGroupId of [...challengerBatches.keys()].sort()) {
      // Retired lots stay in the input digest/history. Active malformed lots cannot
      // disappear just because an invalid observation was excluded.
      // Use the first three registered lots, not the best-performing lots.
      const chosen = [...challengerBatches.get(creatorGroupId)].slice(0, 3);
      const used = chosen.flatMap(([, items]) => items);
      const duplicate = used.length === 30 && (used.some((a, index) => used.slice(index + 1).some(b => collision(a, b))) ||
        used.some(row => identityKeys(row).some(key => identityCohorts.get(key).size > 1)));
      const consistentAssignment = new Set(chosen.map(([, items]) => items[0]?.evidence.assignmentSha256)).size === chosen.length && chosen.every(([, items]) => new Set(items.map(row => canonical([row.selectionExperiment.registeredAt, row.selectionExperiment.expiresAt]))).size === 1 &&
        new Set(items.map(row => row.evidence.assignmentSha256)).size === 1);
      const batchReceipts = chosen.map(([id, items]) => batchReceipt(id, items, rowHashes));
      const conflictingBatch = chosen.some(([batchId]) => conflictingIds.has(batchId));
      const reason = !contextReady ? 'current_readiness_required' : chosen.length !== 3 ? 'three_disjoint_batches_required' : conflictingBatch ? 'assigned_sample_invalid_or_conflicting' : duplicate ? 'duplicate_post_or_source' : !consistentAssignment ? 'assignment_binding_conflict' : batchReceipts.find(row => !row.passed)?.reason ?? 'qualified';
      const expires = Math.min(now + limits.preferenceTtlHours * HOUR, timestamp(context.readyUntil), ...used.map(row => Math.min(timestamp(row.observedAt) + limits.maxObservationAgeHours * HOUR, timestamp(row.selectionExperiment.expiresAt))));
      candidates.push({ creatorGroupId, qualified: reason === 'qualified', reason, batches: batchReceipts,
        expiresAt: Number.isFinite(expires) ? new Date(expires).toISOString() : null });
    }
    // One bounded preference per exact scope; ties use identity, never a post-hoc lift ranking.
    const winner = candidates.find(row => row.qualified);
    const preferredCreatorGroupId = winner?.creatorGroupId ?? context.baselineCreatorGroupId;
    const prior = previousPreferences.filter(row => row?.scopeKey === scopeKey);
    const receipt = { schemaVersion: 1, scopeKey, scope: scopeValue, baselineCreatorGroupId: context.baselineCreatorGroupId,
      preferredCreatorGroupId, status: winner ? 'preferred' : eligible.length ? 'baseline' : 'unmeasured',
      reason: winner ? 'three_disjoint_batches_qualified' : !contextReady ? 'current_readiness_required' : candidates[0]?.reason ?? 'comparable_evidence_insufficient',
      evaluatedAt: new Date(now).toISOString(), expiresAt: winner?.expiresAt ?? null, allowedUse: 'ready_asset_order_only',
      maxPriorityBoost: winner ? 1 : 0, mayIncreaseDailyLimit: false, mayAuthorizePublication: false, paidSpendUsd: 0,
      inputSha256: digest({ samples: sampleHashes, context, policy: limits }),
      previousPreferenceHashes: prior.map(digest).sort(), readinessReceiptSha256: context.readinessReceiptSha256 ?? null,
      eligibleSamples: eligible.length, excluded, retiredBatches, candidates };
    results.push({ ...receipt, receiptSha256: digest(receipt) });
  }
  return { schemaVersion: 1, evaluatedAt: new Date(now).toISOString(), policy: { ...limits, batches: 3, samplesPerArm: 5, minimumMedianViewLift: 0.2, qualityMetric: 'completion_rate' }, preferences: results, paidSpendUsd: 0 };
}
