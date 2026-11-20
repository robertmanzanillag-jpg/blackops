import { approvedNativeMedia, verifiedExternalSchedules, externalScheduleCollision } from './clippers-native-media-receipts.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClipperSelectedEnv } from './clippers-selected-env.mjs';
import { confirmedRenderReceipt, readPortfolioRenderManifest } from './clippers-portfolio-render.mjs';
import { createClippersCreatorRouting } from './clippers-creator-routing.mjs';
import {
  createPortfolioMetricool, DAILY_LIMIT, DESTINATIONS, DISCONNECTED_BRAND, destinationKey,
  exactPost, findDestination, localDay, providerTimestamp, canonicalDestinationKey, canonicalAccount, valueForDestination,
} from './clippers-portfolio-metricool.mjs';
import { createMacLedgerGuard, macLedgerEnv } from './clippers-mac-ledger-guard.mjs';

import { approvedWeeklyAuthorization, approvedEditorialSourceProof, weeklyDeliveryCollision } from './clippers-weekly-policy.mjs';

const HOUR = 3_600_000;
const WINDOWS = [24, 72, 168];
const BASELINE = 'baseline-1';
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/;
const SHA = /^[a-f0-9]{64}$/;
const VARIABLES = new Set(['hook', 'duration', 'caption_layout', 'crop', 'posting_slot']);
const digest = value => createHash('sha256').update(value).digest('hex');
const featureDigest = value => digest(JSON.stringify(value));
const dayAge = (at, now) => (+now - Date.parse(at)) / HOUR;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};

async function privateJson(file, fallback, prohibitedMode = 0o077) {
  let handle;
  try {
    if (path.dirname(file) !== await realpath(path.dirname(file))) throw new Error('private_parent_symlink');
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & prohibitedMode) ||
        (process.getuid && info.uid !== process.getuid()) || info.size > 25_000_000) throw new Error('private_file_required');
    const bytes=Buffer.alloc(info.size+1);let length=0;
    while(length<bytes.length){const result=await handle.read(bytes,length,bytes.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
    const after=await handle.stat();
    if(length!==info.size||after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs)throw Error('private_file_changed');
    return JSON.parse(bytes.subarray(0,length).toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  } finally { await handle?.close(); }
}
async function save(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}
async function optionalArray(file) {
  const value = await privateJson(file, [], 0o022);
  if (!Array.isArray(value)) throw new Error('existing_receipt_ledger_invalid');
  return value;
}
function initialState() {
  return { schemaVersion: 1, day: null, deliveries: [], observations: [], history: [], versions: {} };
}
function validatesState(state) {
  return state?.schemaVersion === 1 && Array.isArray(state.deliveries) && Array.isArray(state.observations) &&
    Array.isArray(state.history) && state.versions && typeof state.versions === 'object';
}
function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch { return false; }
}
function approvedMedia(item, media) {
  if(item.mediaProvider==='metricool')return approvedNativeMedia(item,media);
  if(item.mediaProvider!==undefined&&item.mediaProvider!=='google_drive')return false;
  if(['mediaReceiptNativeUrl','mediaReceiptResource','mediaReceiptSha256'].some(k=>Object.hasOwn(item,k)))return false;
  if (!safeHttps(item.mediaUrl)) return false;
  const url = new URL(item.mediaUrl);
  if (!['drive.google.com', 'drive.usercontent.google.com'].includes(url.hostname) ||
      !['/uc', '/download'].includes(url.pathname) || url.searchParams.get('id') !== item.mediaReceiptFileId) return false;
  return media.some(row => row.status === 'ready' && row.paidSpendAllowed === false && typeof row.fileId === 'string' && ID.test(row.fileId) &&
    (item.renderReceiptSha256 ? findDestination(row) && destinationKey(row) === destinationKey(item) &&
      row.renderReceiptSha256 === item.renderReceiptSha256 : row.renderReceiptSha256 == null) &&
    row.campaignId === item.campaignId && row.draftFile === item.draftFile &&
    (row.provider===undefined||row.provider==='google_drive') && row.fileId === item.mediaReceiptFileId && row.mediaUrl === item.mediaUrl && row.sha256 === item.mediaSha256);
}
async function approvedItem(raw, root, now, receipts, state, weeklyWindow) {
  const destination = findDestination(raw);
  if (!destination) return null;
  if ((raw.weeklyAuthorizationSha256 || raw.editorialPolicy) && !weeklyWindow) return null;
  const weekly = !!weeklyWindow && await approvedWeeklyAuthorization(root, raw, now, weeklyWindow);
  if (weeklyWindow && raw.weeklyAuthorizationSha256 && !weekly) return null;
  if (weeklyWindow && !raw.weeklyAuthorizationSha256 && raw.editorialPolicy!=='evergreen_streamer_clip') return null;
  if (raw.editorialPolicy!==undefined && raw.editorialPolicy!=='evergreen_streamer_clip') return null;
  const currentVersion = valueForDestination(state.versions, destinationKey(destination)) ?? BASELINE;
  const scheduledAt = providerTimestamp(raw.scheduledAt);
  const rightsObservedAt = providerTimestamp(raw.rightsObservedAt);
  const publishedAt = providerTimestamp(raw.sourcePublishedAt);
  const rightsValidUntil = providerTimestamp(raw.rightsValidUntil);
  const validVariant = !raw.experiment || (ID.test(raw.experiment.id ?? '') && ID.test(raw.experiment.context ?? '') &&
    VARIABLES.has(raw.experiment.variable) && ['control', 'candidate'].includes(raw.experiment.arm) &&
    raw.experiment.baselineVersion === currentVersion && ID.test(raw.experiment.candidateVersion ?? '') &&
    raw.experiment.candidateVersion !== currentVersion);
  const usesVersion = raw.experiment?.arm === 'candidate' ? raw.experiment.candidateVersion : currentVersion;
  if (!ID.test(raw.id ?? '') || !ID.test(raw.campaignId ?? '') || !ID.test(raw.sourceId ?? '') || !validVariant ||
      raw.policyVersion !== usesVersion || !ID.test(raw.creator ?? '') || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(raw.language ?? '') ||
      !scheduledAt || Date.parse(scheduledAt) < +now + 5 * 60_000 || (!weekly && localDay(new Date(scheduledAt)) !== localDay(now)) ||
      !rightsObservedAt || dayAge(rightsObservedAt, now) < 0 || dayAge(rightsObservedAt, now) > 24 ||
      !publishedAt || dayAge(publishedAt, now) < 0 || (!weekly && dayAge(publishedAt, new Date(scheduledAt)) > 72) ||
      !rightsValidUntil || Date.parse(rightsValidUntil) < Date.parse(scheduledAt) ||
      !safeHttps(raw.sourceUrl) || !SHA.test(raw.mediaSha256 ?? '') || !SHA.test(raw.evidenceSha256 ?? '') ||
      typeof raw.caption !== 'string' || !raw.caption.trim() || raw.caption.length > 2200 ||
      typeof raw.thirdPartyCommercial !== 'boolean' || !approvedMedia(raw, receipts)) return null;
  const file = path.join(root, 'config/clippers-daily-learning/evidence', raw.evidenceSha256 + '.json');
  const evidence = await privateJson(file, null);
  if (!evidence || featureDigest(evidence) !== raw.evidenceSha256 ||
      evidence.assetId !== raw.id || evidence.sourceUrl !== raw.sourceUrl || evidence.sourceId !== raw.sourceId ||
      evidence.campaignId !== raw.campaignId || evidence.creator !== raw.creator || evidence.language !== raw.language ||
      evidence.sourcePublishedAt !== raw.sourcePublishedAt || evidence.mediaSha256 !== raw.mediaSha256 ||
      evidence.mediaUrl !== raw.mediaUrl || evidence.caption !== raw.caption ||
      (raw.mediaProvider==='metricool' && ['mediaProvider','mediaReceiptNativeUrl','mediaReceiptResource','mediaReceiptSha256'].some(k=>featureDigest(evidence[k]??null)!==featureDigest(raw[k]??null))) ||
      evidence.policyVersion !== raw.policyVersion || evidence.scheduledAt !== raw.scheduledAt ||
      evidence.renderReceiptSha256 !== raw.renderReceiptSha256 ||
      featureDigest(evidence.experiment ?? null) !== featureDigest(raw.experiment ?? null) ||
      evidence.editorialPolicy !== raw.editorialPolicy || evidence.weeklyAuthorizationSha256 !== raw.weeklyAuthorizationSha256 ||
      evidence.rightsObservedAt !== raw.rightsObservedAt || evidence.rightsValidUntil !== raw.rightsValidUntil ||
      evidence.thirdPartyCommercial !== raw.thirdPartyCommercial || !findDestination(evidence.destination) ||
      destinationKey(evidence.destination) !== destinationKey(destination) ||
      evidence.commercialPermission !== 'approved' || !safeHttps(evidence.termsUrl) ||
      evidence.sourceScope !== 'exact_asset' ||
      !((evidence.rightsBasis === 'campaign' && evidence.membership === 'verified') ||
        (evidence.rightsBasis === 'public_policy' && evidence.membership === 'not_required') ||
        (evidence.rightsBasis === 'owned' && evidence.membership === 'not_required' && evidence.ownership === 'verified')) ||
      evidence.quality !== 'passed' || evidence.originalEdit !== 'verified' ||
      evidence.disclosure !== 'verified' || !ID.test(evidence.reviewedBy ?? '') ||
      evidence.authorizedSpendUsd !== 0 || evidence.providerIncrementalCostUsd !== 0) return null;
  const pinnedManifest = state.history.filter(row => canonicalDestinationKey(row.destination) === destinationKey(destination)).at(-1)?.toManifestSha;
  let renderProof = null;
  if (raw.experiment || usesVersion !== BASELINE || pinnedManifest || raw.renderReceiptSha256) {
    try { renderProof = await confirmedRenderReceipt(root, raw, destination); } catch { return null; }
    if (!renderProof) return null;
  }
  const editorialProof=raw.editorialPolicy ? await approvedEditorialSourceProof(root,raw) : null;
  if(raw.editorialPolicy && (!editorialProof || !renderProof || editorialProof.rightsBasis!==evidence.rightsBasis || editorialProof.membership!==evidence.membership || editorialProof.termsUrl!==evidence.termsUrl || editorialProof.ownership!==evidence.ownership))return null;
  const { id, campaignId, sourceUrl, sourceId, creator, language, policyVersion, experiment, caption, mediaUrl,
    mediaSha256, thirdPartyCommercial, evidenceSha256 } = raw;
  return { ...destination, id, campaignId, sourceId, sourceUrl, creator, language, policyVersion, experiment,
    caption, mediaUrl, mediaSha256, thirdPartyCommercial, evidenceSha256, renderProof, scheduledAt,
    ...(editorialProof ? {editorialPolicy:raw.editorialPolicy,weeklySourceProof:editorialProof} : {}),
    ...(weekly ? {weeklyAuthorizationSha256: raw.weeklyAuthorizationSha256,weeklySourceProof:weekly} : {}),
    draftFile: raw.draftFile, renderReceiptSha256: raw.renderReceiptSha256,
    rightsEvidence: { reviewedBy: evidence.reviewedBy, termsUrl: evidence.termsUrl, rightsBasis: evidence.rightsBasis,
      membership: evidence.membership, rightsObservedAt, rightsValidUntil, sourcePublishedAt: publishedAt } };
}
function deliveryCollision(a, b) {
  if(a.editorialPolicy==='evergreen_streamer_clip'||b.editorialPolicy==='evergreen_streamer_clip')return weeklyDeliveryCollision(a,b);
  return destinationKey(a) === destinationKey(b) && (
    a.id === b.id || a.mediaSha256 === b.mediaSha256 || a.sourceUrl === b.sourceUrl ||
    a.scheduledAt === b.scheduledAt || a.caption.trim().toLowerCase() === b.caption.trim().toLowerCase()
  );
}
function snapshotWindow(publication, observedAt) {
  const hours = dayAge(publication.publishedAt, new Date(observedAt));
  return WINDOWS.find(window => hours >= window && hours < window + 24) ?? null;
}
function snapshotKey(delivery, post, window) {
  return [destinationKey(delivery), post.id, window].join('|');
}
function bindScheduleReceipt(delivery, receipt) {
  const id = typeof receipt === 'string' ? receipt : receipt?.id;
  if (typeof id !== 'string' || !ID.test(id)) return false;
  delivery.metricoolId = id;
  if (receipt.mediaUrl) delivery.verifiedSchedulerMediaUrl = receipt.mediaUrl;
  delivery.status = 'scheduled';
  return true;
}
async function reconcileAndCollect(state, adapter, now, counts, withinBudget) {
  for (const delivery of state.deliveries) {
    if (!withinBudget()) { counts.timeBudgetReached = true; break; }
    const target = findDestination(delivery);
    if (!target || dayAge(delivery.scheduledAt, now) > 240) continue;
    try {
      if (delivery.status === 'verification_pending') {
        if (!bindScheduleReceipt(delivery, await adapter.confirmSchedule(target, delivery))) continue;
      }
      if (delivery.status === 'scheduled' && +now >= Date.parse(delivery.scheduledAt)) {
        const post = await adapter.publication(target, delivery, now);
        const exact = post && exactPost(post.url, target);
        if (exact?.id === post?.id && providerTimestamp(post?.publishedAt) &&
            Date.parse(post.publishedAt) <= +now && Date.parse(post.publishedAt) >= Date.parse(delivery.scheduledAt) - 15 * 60_000 &&
            !state.deliveries.some(row => row !== delivery && destinationKey(row) === destinationKey(delivery) && row.post?.id === exact.id)) {
          delivery.post = { ...exact, publishedAt: post.publishedAt, source: post.source, verifiedAt: now.toISOString() };
          delivery.status = 'published';
          counts.verifiedPublications++;
        }
      }
      if (delivery.status !== 'published' || !delivery.post) continue;
      const window = snapshotWindow(delivery.post, now.toISOString());
      if (window == null || state.observations.some(row => row.key === snapshotKey(delivery, delivery.post, window))) continue;
      const metric = await adapter.metrics(target, delivery.post, now);
      if (!metric || !providerTimestamp(metric.observedAt) || Date.parse(metric.observedAt) > +now ||
          snapshotWindow(delivery.post, metric.observedAt) !== window ||
          !Number.isSafeInteger(metric.views) || metric.views < 0 ||
          (metric.completionRate != null && (!Number.isFinite(metric.completionRate) ||
            metric.completionRate < 0 || metric.completionRate > 1))) continue;
      state.observations.push({
        key: snapshotKey(delivery, delivery.post, window), deliveryId: delivery.id, destination: destinationKey(delivery),
        postId: delivery.post.id, publishedAt: delivery.post.publishedAt, ...metric, window,
        ageHours: dayAge(delivery.post.publishedAt, new Date(metric.observedAt)),
        capturedAt: now.toISOString(),
      });
      counts.snapshots++;
    } catch { counts.providerReadFailures++; }
  }
}
function evaluate(state) {
  const groups = new Map();
  for (const metric of state.observations) {
    const delivery = state.deliveries.find(d => d.id === metric.deliveryId && destinationKey(d) === canonicalDestinationKey(metric.destination) && d.post?.id === metric.postId);
    if (!delivery?.experiment || !delivery.renderProof?.comparison || !Number.isFinite(delivery.elapsedMs) || !Number.isFinite(metric.completionRate) || metric.timing !== 'provider_observation_time') continue;
    const { experiment: e } = delivery;
    const age = dayAge(metric.publishedAt, new Date(metric.observedAt));
    const key = JSON.stringify([canonicalDestinationKey(metric.destination), delivery.language, delivery.creator, e.id, e.context,
      e.baselineVersion, e.candidateVersion, metric.window, Math.floor(age),
      delivery.renderProof.comparison.baselineManifestSha, delivery.renderProof.comparison.candidateManifestSha]);
    const items = groups.get(key) ?? [];
    items.push({ ...metric, ...e, elapsedMs: delivery.elapsedMs, costUsd: delivery.costUsd });
    groups.set(key, items);
  }
  return [...groups].flatMap(([key, rows]) => {
    const baseline = rows.filter(r => r.arm === 'control');
    const candidate = rows.filter(r => r.arm === 'candidate');
    if (new Set(rows.map(r => r.variable)).size !== 1 || baseline.length < 5 || candidate.length < 5 ||
        new Set(rows.map(r => r.postId)).size !== rows.length) return [];
    const views = median(baseline.map(row => row.views));
    const candidateViews = median(candidate.map(row => row.views));
    const completion = median(baseline.map(row => row.completionRate));
    const candidateCompletion = median(candidate.map(row => row.completionRate));
    if (!views || candidateViews / views - 1 + Number.EPSILON < 0.2 || candidateCompletion < completion * 0.9) return [];
    const [destination, , , experimentId, , baselineVersion, candidateVersion, , , baselineManifestSha, candidateManifestSha] = JSON.parse(key);
    const evidence = rows.map(row => row.key).sort();
    return [{
      id: featureDigest([key, evidence, views, candidateViews, completion, candidateCompletion]), destination, experimentId,
      baselineVersion, candidateVersion, baselineManifestSha, candidateManifestSha, evidence, posts: rows.map(r => r.postId),
      qualityImproved: candidateCompletion > completion,
      regressed: rows.some(row => row.costUsd !== 0) || candidateCompletion < completion ||
        median(candidate.map(row => row.elapsedMs)) > median(baseline.map(row => row.elapsedMs)),
      viewLift: candidateViews / views - 1, baselineCompletion: completion, candidateCompletion,
    }];
  });
}
function qualifiedPairs(pairs, key, active, candidateVersion) {
  if (pairs.length !== 3 || pairs.some(p => !p || p.destination !== key || p.baselineVersion !== active ||
      p.candidateVersion !== candidateVersion || p.regressed) || new Set(pairs.map(p => p.experimentId)).size !== 3) return false;
  if (new Set(pairs.map(p => p.baselineManifestSha)).size !== 1 ||
      new Set(pairs.map(p => p.candidateManifestSha)).size !== 1) return false;
  const posts = pairs.flatMap(p => p.posts);
  return new Set(posts).size === posts.length && pairs.filter(p => p.qualityImproved).length >= 2;
}

function qualifiedCandidates(state, proposals) {
  const byVersion = new Map();
  for (const proposal of proposals) {
    const active = valueForDestination(state.versions, proposal.destination) ?? BASELINE;
    if (proposal.baselineVersion !== active || proposal.regressed) continue;
    const versionKey = JSON.stringify([proposal.destination, active, proposal.candidateVersion]);
    const group = byVersion.get(versionKey) ?? new Map();
    if (!group.has(proposal.experimentId) || proposal.qualityImproved) group.set(proposal.experimentId, proposal);
    byVersion.set(versionKey, group);
  }
  return [...byVersion].flatMap(([key, group]) => {
    const [destination, baselineVersion, candidateVersion] = JSON.parse(key);
    const pairs = [...group.values()].sort((a, b) => Number(b.qualityImproved) - Number(a.qualityImproved)).slice(0, 3);
    if (!qualifiedPairs(pairs, destination, baselineVersion, candidateVersion)) return [];
    const comparisons = pairs.map(p => p.id).sort();
    return [{ destination, baselineVersion, candidateVersion, comparisons, evidenceDigest: featureDigest(comparisons),
      baselineManifestSha: pairs[0].baselineManifestSha, candidateManifestSha: pairs[0].candidateManifestSha,
      status: 'qualified_for_queue_review' }];
  });
}

function missedSnapshots(state, now) {
  return state.deliveries.reduce((count, delivery) => count + (delivery.post ? WINDOWS.filter(window =>
    dayAge(delivery.post.publishedAt, now) >= window + 24 &&
    !state.observations.some(row => row.key === snapshotKey(delivery, delivery.post, window))).length : 0), 0);
}

async function applyApprovedActions(root, state, reviews, proposals, now) {
  for (const review of reviews) {
    if (!ID.test(review.id ?? '') || !ID.test(review.reviewer ?? '') || !ID.test(review.authorizedBy ?? '') ||
        review.reviewer === review.authorizedBy || state.history.some(event => event.id === review.id)) continue;
    const target = findDestination(review.destination);
    if (!target) continue;
    const key = destinationKey(target);
    const active = valueForDestination(state.versions, key) ?? BASELINE;
    if (review.from !== active) continue;
    let fromManifestSha, toManifestSha;
    if (review.action === 'rollback') {
      const last = state.history.filter(item => canonicalDestinationKey(item.destination) === key).at(-1);
      if (!last || last.action !== 'activate' || review.to !== last.from || review.evidenceDigest !== last.evidenceDigest) continue;
      fromManifestSha = last.toManifestSha;
      toManifestSha = last.fromManifestSha;
    } else if (review.action === 'activate') {
      const pairs = Array.isArray(review.comparisons) && review.comparisons.map(id => proposals.find(p => p.id === id));
      if (!pairs || !qualifiedPairs(pairs, key, active, review.to) ||
          review.evidenceDigest !== featureDigest(pairs.map(p => p.id).sort())) continue;
      fromManifestSha = pairs[0].baselineManifestSha;
      toManifestSha = pairs[0].candidateManifestSha;
    } else continue;
    if (!SHA.test(fromManifestSha ?? '') || !SHA.test(toManifestSha ?? '')) continue;
    try {
      const next = await readPortfolioRenderManifest(root, target, review.to);
      if (next.sha !== toManifestSha) continue;
      if (review.action === 'activate' && (await readPortfolioRenderManifest(root, target, active)).sha !== fromManifestSha) continue;
    } catch { continue; }
    state.history.push({
      id: review.id, action: review.action, scope: 'approved_media_queue', destination: key, from: active, to: review.to,
      evidenceDigest: review.evidenceDigest, fromManifestSha, toManifestSha, reviewer: review.reviewer, authorizedBy: review.authorizedBy,
      at: now.toISOString(),
    });
    state.versions[key] = review.to;
  }
}
function exportedVersionState(state) {
  return DESTINATIONS.map(destination => {
    const key = destinationKey(destination);
    const active = valueForDestination(state.versions, key) ?? BASELINE;
    const activation = state.history.filter(e => canonicalDestinationKey(e.destination) === key).at(-1);
    const observedPost = activation?.action === 'activate' && SHA.test(activation.toManifestSha ?? '') && state.deliveries.find(row => destinationKey(row) === key &&
      row.policyVersion === active && row.renderProof?.manifestSha === activation.toManifestSha &&
      row.post && Date.parse(row.post.publishedAt) > Date.parse(activation.at) &&
      Date.parse(row.createdAt) >= Date.parse(activation.at) && !row.experiment &&
      state.observations.some(metric => metric.deliveryId === row.id && canonicalDestinationKey(metric.destination) === key));
    return {
      destination: key, active, scope: 'approved_media_queue',
      status: observedPost ? 'queue_policy_active_outcome_observed'
        : activation?.action === 'activate' ? 'queue_policy_active_outcome_pending'
          : activation?.action === 'rollback' ? 'queue_policy_rolled_back' : 'queue_policy_baseline',
      activation: activation ?? null,
    };
  });
}
export async function runClippersDailyLearning({ workspaceRoot, now = new Date(), env = process.env, adapter, ledgerGuard } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(+now)) throw new Error('invalid_cycle_time');
  workspaceRoot = await realpath(path.resolve(workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || 'clippers_workspace'));
  const reportDir = path.join(workspaceRoot, 'reports', 'clippers-daily-learning');
  const configRoot = path.join(workspaceRoot, 'config', 'clippers-daily-learning');
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  if (await realpath(reportDir) !== reportDir) throw new Error('learning_report_directory_symlink');
  const lockFile = path.join(workspaceRoot, 'reports', 'metricool-autopilot.lock');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return { status: 'blocked', reason: 'metricool_worker_busy' }; throw error; }
  try {
    const statePath = path.join(reportDir, 'state.json');
    const state = await privateJson(statePath, initialState());
    if (!validatesState(state)) throw new Error('learning_state_invalid');
    const date = localDay(now);
    if (state.day === date) return { status: 'already_completed', date };
    const startedAt = performance.now();
    const stopAt = startedAt + 8 * 60_000;
    const withinBudget = () => performance.now() < stopAt;
    const configured = await privateJson(path.join(configRoot, 'approved-input.json'), { schemaVersion: 1, assets: [], reviews: [], publish: false, collect: false });
    if (configured.schemaVersion !== 1 || !Array.isArray(configured.assets) || configured.assets.length > 250 ||
        !Array.isArray(configured.reviews) || configured.reviews.length > 250) throw new Error('learning_config_invalid');
    const counts = { verifiedPublications: 0, snapshots: 0, scheduled: 0, providerReadFailures: 0, timeBudgetReached: false };
    const relevantDelivery = state.deliveries.some(item => dayAge(item.scheduledAt, now) <= 240);
    const needsAdapter = (configured.publish === true && configured.assets.length > 0) || (configured.collect === true && relevantDelivery);
    if (!adapter && needsAdapter) {
      const selected = { ...env };
      try {
        if ((!selected.METRICOOL_USER_TOKEN || !selected.METRICOOL_USER_ID) && env.CLIPPERS_CONFIG_ROOT) {
          loadClipperSelectedEnv(env.CLIPPERS_CONFIG_ROOT, selected);
        }
        adapter = createPortfolioMetricool({ token: selected.METRICOOL_USER_TOKEN, userId: selected.METRICOOL_USER_ID });
      } catch { counts.providerReadFailures++; }
    }
    if (adapter && configured.collect === true) {
      await reconcileAndCollect(state, adapter, now, counts, withinBudget);
      await save(statePath, state);
    }
    const proposals = evaluate(state);
    const decisions = state.history.length;
    await applyApprovedActions(workspaceRoot, state, configured.reviews, proposals, now);
    if (state.history.length !== decisions) await save(statePath, state);
    const existingMedia = await optionalArray(path.join(workspaceRoot, 'reports', 'metricool-public-media-receipts.json'));
    const scopedMedia = await privateJson(path.join(reportDir, 'portfolio-media-receipts.json'), []);
    if (!Array.isArray(scopedMedia)) throw Error('portfolio_media_receipt_ledger_invalid');
    const authorized = [...existingMedia.map(row => ({ ...row, renderReceiptSha256: undefined })),
      ...scopedMedia.filter(row => findDestination(row) && SHA.test(row.renderReceiptSha256 ?? ''))];
    const external=verifiedExternalSchedules(await privateJson(path.join(reportDir,'external-schedules.json'),[]),now);
    const legacy = await optionalArray(path.join(workspaceRoot, 'reports', 'metricool-autopilot-ledger.json'));
    const outcomes = [];
    const checked = new Map();
    const duplicateAssetKeys = new Set(configured.assets.filter((a,i)=>findDestination(a)&&configured.assets.some((b,j)=>i!==j&&findDestination(b)&&destinationKey(a)===destinationKey(b)&&a.id===b.id)).map(a=>destinationKey(a)+':'+a.id));
    for (const raw of configured.assets) {
      if (!withinBudget()) { counts.timeBudgetReached = true; break; }
      if (!findDestination(raw) || duplicateAssetKeys.has(destinationKey(raw)+':'+raw.id)) continue;
      const item = await approvedItem(raw, workspaceRoot, new Date(+now + performance.now() - startedAt), authorized, state);
      checked.set(raw,item);
    }
    let creatorRouting;
    let creatorSelection = { schemaVersion: 1, evaluatedAt: now.toISOString(), contexts: 0, assigned: null,
      paidSpendUsd: 0, allowedUse: 'ready_asset_order_only', preferences: [], heldReasons: ['creator_routing_unavailable'] };
    try {
      creatorRouting = await createClippersCreatorRouting({workspaceRoot,state,readyAssets:[...checked.values()].filter(Boolean),now});
      creatorSelection = creatorRouting.report;
    } catch { /* Missing/invalid creator evidence never changes legacy publication authorization. */ }
    for (const destination of DESTINATIONS) {
      const key = destinationKey(destination);
      let eligible = 0;
      let confirmed = state.deliveries.filter(r => destinationKey(r) === key && localDay(new Date(r.scheduledAt)) === date &&
        ['scheduled', 'published'].includes(r.status)).length;
      const blockers = new Set();
      const scopedAssets = configured.assets.filter(item => findDestination(item) && destinationKey(item) === key)
        .sort((a, b) => (Date.parse(b.sourcePublishedAt) || 0) - (Date.parse(a.sourcePublishedAt) || 0));
      const orderedAssets = creatorRouting ? creatorRouting.order(scopedAssets) : scopedAssets;
      for (const raw of orderedAssets) {
        let item = checked.get(raw);
        if (item && configured.publish === true && adapter) {
          if (!withinBudget()) { counts.timeBudgetReached = true; break; }
          item = await approvedItem(raw, workspaceRoot, new Date(+now + performance.now() - startedAt), authorized, state);
        }
        if (!item) { blockers.add('asset_rights_media_or_scope_unverified'); continue; }
        const dispatchNow = +now + performance.now() - startedAt;
        if (Date.parse(item.scheduledAt) < dispatchNow + 5*60_000 ||
            dispatchNow - Date.parse(item.rightsEvidence.rightsObservedAt) > 24*HOUR) {
          blockers.add('asset_review_or_schedule_expired_during_cycle'); continue;
        }
        if (external.some(row=>externalScheduleCollision(row,item)) || state.deliveries.some(row => deliveryCollision(row, item)) ||
            legacy.some(row => Number(row.metricoolBlogId) === item.brandId &&
              canonicalAccount(row.metricoolBlogId, item.network, row.account) === item.account &&
              (row.mediaSha256 === item.mediaSha256 || row.sha256 === item.mediaSha256 || row.mediaUrl === item.mediaUrl || row.sourceUrl === item.sourceUrl))) {
          blockers.add('duplicate_delivery'); continue;
        }
        eligible++;
        if (!withinBudget()) { counts.timeBudgetReached = true; blockers.add('cycle_time_budget_reached'); break; }
        if (configured.publish !== true || !adapter) { blockers.add('publisher_unavailable_or_disabled'); continue; }
        if (confirmed >= DAILY_LIMIT || state.deliveries.some(row => destinationKey(row) === key &&
             row.status === 'verification_pending' && localDay(new Date(row.scheduledAt)) === date)) {
          blockers.add('daily_target_or_unverified_prior_attempt'); continue;
        }
        try { await adapter.preflight(destination, item); }
        catch { blockers.add('metricool_preflight_blocked'); continue; }
        // Shared cross-account ledger (same as the cloud publisher): one clip -> one account, fail closed.
        ledgerGuard ??= createMacLedgerGuard({ env: macLedgerEnv(env), workspaceRoot, metricool: adapter });
        const reservation = await ledgerGuard.reserve(destination, item);
        if (!reservation.ok) { blockers.add(`cross_account_ledger:${reservation.reason}`); continue; }
        let creatorAssignmentSha256;
        try { creatorAssignmentSha256 = await creatorRouting?.assign(item); }
        catch { blockers.add('creator_assignment_unavailable'); }
        const record = { ...item, ...(creatorAssignmentSha256 ? {creatorAssignmentSha256} : {}), ledgerEvidence: reservation.evidence, createdAt: now.toISOString(), status: 'verification_pending', costUsd: 0 };
        state.deliveries.push(record);
        await save(statePath, state);
        try {
          const started = performance.now();
          const receipt = await adapter.schedule(destination, item);
          if (!bindScheduleReceipt(record, receipt)) throw new Error('remote_receipt_missing');
          record.elapsedMs = performance.now() - started;
          confirmed++;
          counts.scheduled++;
        } catch { blockers.add('provider_receipt_pending_retry_suppressed'); }
        await save(statePath, state);
      }
      if (!eligible) blockers.add('no_current_permissioned_ready_assets');
      outcomes.push({ ...destination, target: DAILY_LIMIT, eligible, confirmedScheduledOrPublished: confirmed,
        shortfall: Math.max(0, DAILY_LIMIT - confirmed), blockers: [...blockers] });
    }
    try { if (creatorRouting) creatorSelection = await creatorRouting.flush(); } catch { creatorSelection.heldReasons.push('creator_report_write_unavailable'); }
    const report = {
      schemaVersion: 1, date, generatedAt: now.toISOString(), paidSpendUsd: 0, ...counts,
      status: outcomes.some(row => row.shortfall > 0) ? 'held_or_partial' : 'completed',
      destinations: outcomes, disconnected: [{ brandId: DISCONNECTED_BRAND, reason: 'destination_not_connected' }],
      creatorSelection, observations: state.observations.length, missedSnapshots: missedSnapshots(state, now),
      proposalCount: proposals.length, proposals, qualifiedCandidates: qualifiedCandidates(state, proposals), versions: exportedVersionState(state),
      automaticPromotion: false, rendererPolicyBinding: 'required_for_experiments_and_candidate_versions',
    };
    // Publish the report before claiming the day so a failed write can be retried.
    await save(path.join(reportDir, 'latest.json'), report);
    state.day = date;
    await save(statePath, state);
    return report;
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await runClippersDailyLearning();
  console.log(JSON.stringify(report, null, 2));
}

// Shared audited validation; weekly executor supplies a bounded explicit window.
export { approvedItem as validateApprovedClippersAsset, deliveryCollision as clippersDeliveryCollision };
