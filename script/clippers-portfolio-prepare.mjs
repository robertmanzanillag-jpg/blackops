import { resolveNativeMediaReceipt, nativeAssetMediaFields } from './clippers-native-media-receipts.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, realpath, rename, unlink, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findDestination, destinationKey, providerTimestamp, localDay } from './clippers-portfolio-metricool.mjs';
import { approvedWeeklyAuthorization, approvedEditorialSourceProof, newYorkHour } from './clippers-weekly-policy.mjs';

const CONFIG = 'config/clippers-daily-learning';
const REPORT = 'reports/clippers-daily-learning';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const SHA = /^[a-f0-9]{64}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,160}$/;
const MAX_BYTES = 250_000_000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const key = destination => destinationKey(destination).replaceAll(':', '__');
const HELPER_ENV_KEYS = new Set(['HOME', 'PATH', 'NODE_ENV', 'DEFAULT_USER_ID', 'DATABASE_URL',
  'REPLIT_CONNECTORS_HOSTNAME', 'REPL_IDENTITY', 'WEB_REPL_RENEWAL',
  'CLIPPERS_CONFIG_ROOT', 'CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED', 'CLIPPERS_DRIVE_ROOT_FOLDER_ID',
  'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'GOOGLE_DRIVE_CLIPPERS_ROOT_FOLDER_ID']);
export function driveHelperEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => HELPER_ENV_KEYS.has(name) && typeof value === 'string'));
}

async function ownerJson(root, relative, fallback) {
  const file = path.join(root, relative);
  let fd;
  try {
    if (await realpath(path.dirname(file)) !== path.dirname(file)) throw Error('private_parent_required');
    fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await fd.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > 5_000_000 ||
        (process.getuid && info.uid !== process.getuid())) throw Error('owner_private_file_required');
    return JSON.parse(await fd.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  } finally { await fd?.close(); }
}
async function save(root, relative, value) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (await realpath(path.dirname(file)) !== path.dirname(file)) throw Error('private_parent_required');
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}
function https(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port; }
  catch { return false; }
}
export function publicDriveUrl(fileId) {
  if (!DRIVE_ID.test(fileId ?? '')) throw Error('drive_file_id_invalid');
  return 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&confirm=t';
}
function exactDriveUrl(url, fileId) {
  if (!https(url) || !DRIVE_ID.test(fileId ?? '')) return false;
  const parsed = new URL(url);
  return ['drive.google.com', 'drive.usercontent.google.com'].includes(parsed.hostname) &&
    ['/uc', '/download'].includes(parsed.pathname) && parsed.searchParams.get('id') === fileId;
}
export function prepareReadiness(env = process.env) {
  const has = names => names.some(name => typeof env[name] === 'string' && !!env[name].trim());
  let driveLoaderAvailable = false; try { driveLoaderAvailable = !!import.meta.resolve('tsx'); } catch {}
  return {
    enabled: env.CLIPPERS_PORTFOLIO_PREPARE_ENABLED === 'true',
    publicUploadEnabled: env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED === 'true',
    driveOAuthEnvironmentPossible: has(['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID']) &&
      has(['GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET']) &&
      has(['GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_OAUTH_REFRESH_TOKEN']),
    replitDriveConnectorPossible: !!env.REPLIT_CONNECTORS_HOSTNAME && !!(env.REPL_IDENTITY || env.WEB_REPL_RENEWAL),
    storedOAuthPossible: !!env.DATABASE_URL,
    systemOwnerConfigured: !!env.DEFAULT_USER_ID,
    driveLoaderAvailable,
    credentialValidityVerified: false, paidSpendUsd: 0,
  };
}

/** A public, unauthenticated read proves the exact bytes, not only a plausible URL. */
export async function verifyPublicBytes(url, expectedSha, sizeBytes, fetcher = fetch, timeoutMs = 60_000) {
  if (!SHA.test(expectedSha) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_BYTES) return false;
  let next = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!https(next)) return false;
      const parsed = new URL(next);
      if (!['drive.google.com', 'drive.usercontent.google.com'].includes(parsed.hostname) &&
          !parsed.hostname.endsWith('.googleusercontent.com')) return false;
      const response = await fetcher(next, { redirect: 'manual', signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.headers.get('location')) return false;
        next = new URL(response.headers.get('location'), next).href; continue;
      }
      if (response.status !== 200 || !response.body) return false;
      if (!/^(video\/|application\/(?:octet-stream|mp4))/i.test(response.headers.get('content-type') ?? '')) return false;
      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) !== sizeBytes) return false;
      const contentHash = createHash('sha256'); let count = 0;
      for await (const part of response.body) {
        count += part.length;
        if (count > sizeBytes) { controller.abort(); return false; }
        contentHash.update(part);
      }
      return count === sizeBytes && contentHash.digest('hex') === expectedSha;
    }
    return false;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

async function boundedHelper(operation, input, timeoutMs, loader) {
  const childEnv = driveHelperEnvironment();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', loader, fileURLToPath(import.meta.url), '--drive-operation', operation],
      { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', ended = false;
    const stop = signal => { try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch {} };
    const timer = setTimeout(() => { stop('SIGTERM'); setTimeout(() => stop('SIGKILL'), 250).unref(); }, timeoutMs);
    child.stdout.on('data', bytes => { output += bytes.toString(); if (output.length > 16_000) stop('SIGTERM'); });
    // Deliberately do not surface provider errors or credential-bearing stdout.
    child.stderr.on('data', () => {});
    child.on('error', () => { if (!ended) { ended = true; clearTimeout(timer); reject(Error('drive_helper_unconfirmed')); } });
    child.on('close', status => {
      if (ended) return; ended = true; clearTimeout(timer);
      try { if (status !== 0 || output.length > 16_000) throw Error(); resolve(JSON.parse(output)); }
      catch { reject(Error('drive_helper_unconfirmed')); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input));
  });
}
async function livePreparation(root, auth) {
  const active = await ownerJson(root, `${REPORT}/portfolio-prepare.lock`);
  const age = Date.now() - Date.parse(active.startedAt);
  if (!Number.isSafeInteger(active.pid) || active.pid < 1 || active.pid !== auth.parentPid || active.pid !== process.ppid ||
      active.nonce !== auth.operationNonce || !/^[a-f0-9-]{36}$/.test(active.nonce ?? '') ||
      !Number.isFinite(age) || age < 0 || age > 120_000) throw Error('prepare_parent_unconfirmed');
  try { process.kill(active.pid, 0); } catch { throw Error('prepare_parent_unconfirmed'); }
}
export async function claimDriveOperation(root, auth, operation, input = {}) {
  await livePreparation(root, auth);
  if (!['folder', 'upload', 'public'].includes(operation) || !SHA.test(auth.outputSha256 ?? '')) throw Error('drive_operation_invalid');
  const state = await ownerJson(root, `${REPORT}/portfolio-upload-state.json`);
  const upload = state.uploads?.[auth.outputSha256];
  if (!upload || upload.sha256 !== auth.outputSha256 ||
      upload.status !== (operation === 'public' ? 'sharing_unknown' : 'upload_unknown') ||
      (operation === 'upload' && upload.folderId !== input.folderId) ||
      (operation === 'public' && upload.fileId !== input.fileId)) throw Error('drive_operation_state_invalid');
  const directory = path.join(root, REPORT, 'drive-operation-claims', auth.outputSha256);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== directory) throw Error('private_parent_required');
  const claim = await open(path.join(directory, operation + '.json'), 'wx', 0o600);
  try { await claim.writeFile(JSON.stringify({ operation, packetSha256: auth.packetSha256,
    outputSha256: auth.outputSha256, parentPid: auth.parentPid, operationNonce: auth.operationNonce,
    startedAt: new Date().toISOString() }) + '\n'); }
  finally { await claim.close(); }
}
export async function createExistingDriveAdapter({ remaining = () => 30_000, authorization } = {}) {
  // Existing OAuth helpers run in a bounded process. Killing an ambiguous upload
  // leaves the durable reservation unknown, rather than repeating its write.
  if (process.env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED !== 'true') throw Error('drive_upload_process_not_authorized');
  if (!process.env.DEFAULT_USER_ID?.trim()) throw Error('drive_owner_not_configured');
  let loader; try { loader = import.meta.resolve('tsx'); } catch { throw Error('drive_loader_unavailable'); }
  if (!authorization) throw Error('drive_asset_authorization_required');
  const call = (operation, data) => boundedHelper(operation, { ...data, authorization }, Math.max(1, Math.min(30_000, remaining())), loader);
  return {
    readiness: () => call('readiness', {}),
    ensureFolder: async () => (await call('folder', {})).folderId,
    uploadFile: input => call('upload', input),
    makePublic: async fileId => (await call('public', { fileId })).mediaUrl,
    verifyPublic: (url, sha, size) => verifyPublicBytes(url, sha, size, fetch, Math.max(1, Math.min(30_000, remaining()))),
  };
}
async function media(root, relative, expectedSha) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || !relative.startsWith('drafts/portfolio/')) throw Error('portfolio_media_required');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || await realpath(file) !== file) throw Error('portfolio_media_required');
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES || (process.getuid && info.uid !== process.getuid())) throw Error('portfolio_media_invalid');
    const bytes = await fd.readFile();
    if (hash(bytes) !== expectedSha) throw Error('portfolio_media_changed');
    return bytes;
  } finally { await fd.close(); }
}
async function privateStageDirectory(root) {
  const parts = [root, 'reports', 'clippers-daily-learning', 'upload-stage'];
  let directory = parts[0];
  for (let index = 0; index < parts.length; index++) {
    if (index) directory = path.join(directory, parts[index]);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()) ||
        (info.mode & (index === parts.length - 1 ? 0o077 : 0o022)) || await realpath(directory) !== directory) throw Error('private_stage_directory_required');
  }
}
async function renderAndApprove(root, id, now, renderer) {
  const packet = await ownerJson(root, `${CONFIG}/prepare-requests/${id}.json`);
  const request = await ownerJson(root, `${CONFIG}/render-requests/${id}.json`);
  const destination = findDestination(packet?.destination);
  if (!destination || packet.schemaVersion !== 1 || packet.id !== id || request.id !== id ||
      !findDestination(request) || destinationKey(destination) !== destinationKey(request) ||
      packet.renderRequestSha256 !== digest(request) || !SHA.test(packet.renderReceiptSha256 ?? '') ||
      !SHA.test(packet.outputSha256 ?? '') || packet.publicUploadAuthorized !== true || packet.schedulerAssetAuthorized !== true ||
      !ID.test(packet.reviewedBy ?? '') || !ID.test(packet.campaignId ?? '') || !ID.test(packet.sourceId ?? '') ||
      !ID.test(packet.creator ?? '') || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(packet.language ?? '') ||
      !https(packet.sourceUrl) || typeof packet.caption !== 'string' || !packet.caption.trim() || packet.caption.length > 2200 ||
      typeof packet.thirdPartyCommercial !== 'boolean' || packet.quality !== 'passed' ||
      packet.originalEdit !== 'verified' || packet.disclosure !== 'verified' ||
      packet.authorizedSpendUsd !== 0 || packet.providerIncrementalCostUsd !== 0) throw Error('reviewed_prepare_packet_required');
  const scheduledAt = providerTimestamp(packet.scheduledAt);
  const rights = request.rights;
  const validAt = value => !!providerTimestamp(value);
  const weeklyCandidate = request.weeklyAuthorization ? { ...destination, id, policyVersion: request.policyVersion, scheduledAt, sourceUrl: packet.sourceUrl,
    sourcePublishedAt: rights?.sourcePublishedAt, rightsObservedAt: rights?.observedAt, rightsValidUntil: rights?.validUntil,
    thirdPartyCommercial:packet.thirdPartyCommercial, mediaSha256: packet.outputSha256, renderReceiptSha256: packet.renderReceiptSha256, weeklyAuthorizationSha256: digest(request.weeklyAuthorization) } : null;
  const weekly = weeklyCandidate && await approvedWeeklyAuthorization(root, weeklyCandidate, now, { startDate: request.weeklyAuthorization.windowStart, endDate: request.weeklyAuthorization.windowEnd });
  if (request.weeklyAuthorization && !weekly) throw Error('weekly_authorization_not_verified');
  if (!scheduledAt || (!weekly && localDay(new Date(scheduledAt)) !== localDay(now)) || Date.parse(scheduledAt) < +now + 300_000 ||
      !rights || !findDestination(rights.destination) || destinationKey(rights.destination) !== destinationKey(destination) ||
      !Array.isArray(rights.permittedNetworks) || !rights.permittedNetworks.includes(destination.network) ||
      rights.thirdPartyCommercial !== packet.thirdPartyCommercial || rights.commercialPermission !== 'approved' ||
      rights.sourceScope !== 'exact_asset' || rights.sourceSha256 !== request.sourceSha256 || !https(rights.termsUrl) ||
      !ID.test(rights.reviewedBy ?? '') ||
      !((rights.basis === 'campaign' && rights.membership === 'verified') ||
        (rights.basis === 'public_policy' && rights.membership === 'not_required') ||
        (rights.basis === 'owned' && rights.membership === 'not_required' && rights.ownership === 'verified')) ||
      !validAt(rights.validUntil) || !validAt(rights.observedAt) || !validAt(rights.sourcePublishedAt) ||
      Date.parse(rights.observedAt) > +now || +now - Date.parse(rights.observedAt) > 24 * 3_600_000 ||
      Date.parse(rights.sourcePublishedAt) > +now ||
      Date.parse(rights?.validUntil) < Date.parse(scheduledAt) ||
      (!weekly && Date.parse(scheduledAt) - Date.parse(rights?.sourcePublishedAt) > 72 * 3_600_000)) throw Error('prepare_schedule_outside_rights');
  // Rendering and media review happen before public upload. Never rerender an
  // approved clip merely because another destination uses the same bytes.
  const receiptFile = `${REPORT}/render-receipts/${key(destination)}/${id}/${request.policyVersion}/${packet.outputSha256}.json`;
  if (!ID.test(request.policyVersion ?? '')) throw Error('reviewed_render_output_changed');
  const rendered = await ownerJson(root, receiptFile, null);
  if (!rendered || digest(rendered) !== packet.renderReceiptSha256 || rendered.outputSha256 !== packet.outputSha256 ||
      !findDestination(rendered.destination) || destinationKey(rendered.destination) !== destinationKey(destination) ||
      rendered.requestId !== id || rendered.version !== request.policyVersion || rendered.costUsd !== 0 ||
      rendered.sourceSha256 !== request.sourceSha256 ||
      !Number.isFinite(request.sourceStartSeconds) || !Number.isFinite(rendered.actualParams?.hook) ||
      rendered.startSeconds !== request.sourceStartSeconds + rendered.actualParams.hook ||
      rendered.renderRequestSha256 !== digest(request) ||
      rendered.captionTextSha256 !== hash(typeof request.captionText === 'string' ? request.captionText : '')) throw Error('reviewed_render_output_changed');
  if (packet.editorialPolicy!==undefined && packet.editorialPolicy!=='evergreen_streamer_clip') throw Error('editorial_policy_unrecognized');
  const asset = { ...destination, id, campaignId: packet.campaignId, sourceId: packet.sourceId, sourceUrl: packet.sourceUrl,
    creator: packet.creator, language: packet.language, caption: packet.caption, scheduledAt,
    policyVersion: rendered.version, experiment: request.experiment ?? undefined,
    renderReceiptSha256: packet.renderReceiptSha256, mediaSha256: rendered.outputSha256, draftFile: rendered.draftFile,
    thirdPartyCommercial: packet.thirdPartyCommercial,
    ...(packet.editorialPolicy ? {editorialPolicy:packet.editorialPolicy} : {}),
    ...(weekly ? { weeklyAuthorizationSha256: weeklyCandidate.weeklyAuthorizationSha256 } : {}),
    sourcePublishedAt: rights.sourcePublishedAt, rightsObservedAt: rights.observedAt, rightsValidUntil: rights.validUntil };
  if (!(await renderer.confirmedRenderReceipt(root, asset, destination))) throw Error('render_receipt_unconfirmed');
  if (asset.editorialPolicy && !(await approvedEditorialSourceProof(root,asset))) throw Error('editorial_source_proof_unverified');
  let creatorSelectionHeld;
  if (request.creatorSelection !== undefined) {
    const { normalizeCreatorContext } = await import('./clippers-creator-routing.mjs');
    const { resolveCreatorChannel } = await import('../shared/clippers-priority-creators.mjs');
    const normalized = normalizeCreatorContext(request.creatorSelection, asset, resolveCreatorChannel);
    if (normalized) asset.creatorSelection = normalized;
    else creatorSelectionHeld = 'creator_context_not_reviewed';
  }
  const bytes = await media(root, asset.draftFile, asset.mediaSha256);
  return { packet, request, asset, bytes, destination, creatorSelectionHeld };
}

async function appendSchedulerInput(root, approved, uploaded) {
  const { asset, packet, request, destination } = approved;
  const result = { ...asset, ...(uploaded.provider==='metricool' ? nativeAssetMediaFields(uploaded) : {mediaReceiptFileId: uploaded.fileId,mediaUrl:uploaded.mediaUrl}) };
  const evidence = { assetId: result.id, destination, sourceUrl: result.sourceUrl, sourceId: result.sourceId,
    campaignId: result.campaignId, creator: result.creator, language: result.language,
    sourcePublishedAt: result.sourcePublishedAt, mediaSha256: result.mediaSha256, mediaUrl: result.mediaUrl,
    ...(uploaded.provider==='metricool' ? nativeAssetMediaFields(uploaded) : {}),
    caption: result.caption, policyVersion: result.policyVersion, scheduledAt: result.scheduledAt,
    ...(result.editorialPolicy ? {editorialPolicy:result.editorialPolicy} : {}),
    ...(result.weeklyAuthorizationSha256 ? { weeklyAuthorizationSha256: result.weeklyAuthorizationSha256 } : {}),
    renderReceiptSha256: result.renderReceiptSha256, experiment: result.experiment ?? null,
    ...(asset.creatorSelection ? { creatorSelection: asset.creatorSelection } : {}),
    rightsObservedAt: result.rightsObservedAt, rightsValidUntil: result.rightsValidUntil,
    thirdPartyCommercial: result.thirdPartyCommercial, commercialPermission: request.rights.commercialPermission,
    termsUrl: request.rights.termsUrl, sourceScope: request.rights.sourceScope, rightsBasis: request.rights.basis,
    membership: request.rights.membership, ...(request.rights.ownership ? { ownership: request.rights.ownership } : {}),
    quality: packet.quality, originalEdit: packet.originalEdit, disclosure: packet.disclosure,
    reviewedBy: packet.reviewedBy, authorizedSpendUsd: 0, providerIncrementalCostUsd: 0 };
  result.evidenceSha256 = digest(evidence);
  const reportLock = path.join(root, 'reports/metricool-autopilot.lock'); let lock;
  try { lock = await open(reportLock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw Error('scheduler_worker_busy'); throw error; }
  try {
    const input = await ownerJson(root, `${CONFIG}/approved-input.json`, { schemaVersion: 1, publish: false, collect: false, assets: [], reviews: [] });
    if (input.schemaVersion !== 1 || !Array.isArray(input.assets) || !Array.isArray(input.reviews) || input.assets.length > 250) throw Error('approved_scheduler_input_invalid');
    const prior = input.assets.find(item => item.id === result.id && destinationKey(item) === destinationKey(destination));
    if (prior && !same(prior, result)) throw Error('approved_asset_conflict');
    if (!prior && input.assets.length >= 250) throw Error('approved_queue_capacity');
    const receipts = await ownerJson(root, `${REPORT}/portfolio-media-receipts.json`, []);
    if (!Array.isArray(receipts) || receipts.length > 5000) throw Error('portfolio_media_ledger_invalid');
    const receipt = { ...destination, status: 'ready', ...(uploaded.provider==='metricool' ? {provider:'metricool',resource:uploaded.resource,nativeReceiptSha256:uploaded.nativeReceiptSha256} : {fileId: uploaded.fileId}), campaignId: result.campaignId,
      draftFile: result.draftFile, mediaUrl: result.mediaUrl, sha256: result.mediaSha256,
      renderReceiptSha256: result.renderReceiptSha256, paidSpendAllowed: false };
    const existing = receipts.find(row => destinationKey(row) === destinationKey(destination) && row.draftFile === result.draftFile);
    if (existing && !same(existing, receipt)) throw Error('portfolio_media_receipt_conflict');
    if (!existing && receipts.length >= 5000) throw Error('portfolio_receipt_capacity');
    if (!existing) receipts.push(receipt);
    await save(root, `${REPORT}/portfolio-media-receipts.json`, receipts);
    await save(root, `${CONFIG}/evidence/${result.evidenceSha256}.json`, evidence);
    if (!prior) input.assets.push(result);
    await save(root, `${CONFIG}/approved-input.json`, input);
    return result;
  } finally { await lock.close(); await unlink(reportLock); }
}

export async function runClippersPortfolioPrepare({ workspaceRoot, now = new Date(), env = process.env, dependencies, renderer, maxCycleMs = 120_000 } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(+now)) throw Error('invalid_prepare_time');
  if (!Number.isFinite(maxCycleMs) || maxCycleMs <= 0) throw Error('invalid_prepare_budget');
  const readiness = prepareReadiness(env);
  if (!readiness.enabled || !readiness.publicUploadEnabled) return { status: 'disabled', readiness, prepared: 0, uploaded: 0, paidSpendUsd: 0 };
  const cycleStopAt = performance.now() + Math.min(120_000, maxCycleMs);
  const root = await realpath(path.resolve(workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || 'clippers_workspace'));
  const reportRoot = path.join(root, REPORT);
  await mkdir(reportRoot, { recursive: true, mode: 0o700 });
  if (await realpath(reportRoot) !== reportRoot) throw Error('private_report_directory_required');
  let files;
  try { files = await readdir(path.join(root, CONFIG, 'prepare-requests')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; files = []; }
  const names = files.filter(file => file.endsWith('.json') && ID.test(file.slice(0, -5)));
  if (names.length > 5000) return { status: 'held', reason: 'prepare_request_retention_required', prepared: 0, uploaded: 0, paidSpendUsd: 0 };
  const metadata = await Promise.all(names.map(async name => ({ name, time: (await lstat(path.join(root, CONFIG, 'prepare-requests', name))).mtimeMs })));
  // Stale/bad packets do not consume the twenty usable-packet allowance. Prefer
  // recently reviewed inputs, rather than repeatedly taking the oldest names.
  const priorInput = await ownerJson(root, `${CONFIG}/approved-input.json`, {assets:[]});
  if (!Array.isArray(priorInput.assets) || priorInput.assets.length>250) throw Error('approved_scheduler_input_invalid');
  const queuedIds = new Set(priorInput.assets.map(row=>row.id));
  // New packets lead the bounded scan: twenty already-prepared recent IDs must not starve later weekly batches.
  const ids = metadata.sort((a,b)=>Number(queuedIds.has(a.name.slice(0,-5)))-Number(queuedIds.has(b.name.slice(0,-5))) || b.time-a.time || a.name.localeCompare(b.name)).slice(0,500).map(row=>row.name.slice(0,-5));
  if (!ids.length) return { status: 'held', reason: 'no_reviewed_prepare_packets', readiness, prepared: 0, uploaded: 0, paidSpendUsd: 0 };
  const lockFile = path.join(reportRoot, 'portfolio-prepare.lock'); let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return { status: 'held', reason: 'portfolio_prepare_busy', prepared: 0, uploaded: 0, paidSpendUsd: 0 }; throw error; }
  try {
    const operationNonce = randomUUID();
    await lock.writeFile(JSON.stringify({ pid: process.pid, nonce: operationNonce, startedAt: now.toISOString() }) + '\n');
    const ledgerFile = `${REPORT}/portfolio-upload-state.json`;
    const state = await ownerJson(root, ledgerFile, { schemaVersion: 1, uploads: {}, targets: [] });
    if (state.schemaVersion !== 1 || !state.uploads || typeof state.uploads !== 'object' || Array.isArray(state.uploads) || !Array.isArray(state.targets)) throw Error('portfolio_upload_state_invalid');
    const stopAt = cycleStopAt;
    const remaining = () => Math.max(0, stopAt - performance.now());
    const bounded = (operation) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('prepare_time_budget_reached')), Math.max(1, remaining()));
      Promise.resolve().then(operation).then(resolve, reject).finally(() => clearTimeout(timer));
    });
    let renderApi = renderer; const outcomes = []; let uploaded = 0, prepared = 0, usablePackets = 0;
    for (const id of ids) {
      if (!remaining()) { outcomes.push({ id, status: 'held', reason: 'prepare_time_budget_reached' }); break; }
      try {
        renderApi ||= await import('./clippers-portfolio-render.mjs');
        const approved = await renderAndApprove(root, id, now, renderApi);
        if (usablePackets >= 20) { outcomes.push({ id, status: 'held', reason: 'prepare_packet_budget_reached' }); break; }
        usablePackets++;
        const targetKey = destinationKey(approved.destination), day = localDay(new Date(approved.asset.scheduledAt));
        const reservations = state.targets.filter(row => row.destination === targetKey && row.day === day);
        const priorTarget = reservations.find(row => row.id === id);
        if ((priorTarget && (priorTarget.renderReceiptSha256 !== approved.asset.renderReceiptSha256 || priorTarget.scheduledAt !== approved.asset.scheduledAt)) ||
            (!priorTarget && (reservations.length >= 5 || reservations.some(row => newYorkHour(row.scheduledAt) === newYorkHour(approved.asset.scheduledAt) ||
              row.mediaSha256 === approved.asset.mediaSha256 || row.captionDigest === digest(approved.asset.caption))))) {
          outcomes.push({ id, status: 'held', reason: 'destination_daily_cap_or_slot_conflict' }); continue;
        }
        const input = await ownerJson(root, `${CONFIG}/approved-input.json`, { assets: [] });
        if (!Array.isArray(input.assets) || (input.schemaVersion !== undefined && input.schemaVersion !== 1) ||
            (input.reviews !== undefined && !Array.isArray(input.reviews))) throw Error('approved_scheduler_input_invalid');
        const priorAsset = input.assets.find(row => row.id === id && findDestination(row) && destinationKey(row) === targetKey);
        if (priorAsset && Object.entries(approved.asset).some(([field, value]) => !same(priorAsset[field], value))) throw Error('approved_asset_conflict');
        if (input.assets.length >= 250 && !input.assets.some(row => row.id === id && findDestination(row) && destinationKey(row) === targetKey)) {
          outcomes.push({ id, status: 'held', reason: 'approved_queue_capacity' }); continue;
        }
        const queued = input.assets.filter(row => findDestination(row) && destinationKey(row) === targetKey && localDay(new Date(row.scheduledAt)) === day);
        if (!queued.some(row => row.id === id) && (queued.length >= 5 || queued.some(row => newYorkHour(row.scheduledAt) === newYorkHour(approved.asset.scheduledAt) ||
            row.mediaSha256 === approved.asset.mediaSha256 || row.caption === approved.asset.caption))) {
          outcomes.push({ id, status: 'held', reason: 'destination_daily_cap_or_slot_conflict' }); continue;
        }
        if (!priorTarget) { state.targets.push({ destination: targetKey, day, id, scheduledAt: approved.asset.scheduledAt,
          mediaSha256: approved.asset.mediaSha256, captionDigest: digest(approved.asset.caption), renderReceiptSha256: approved.asset.renderReceiptSha256 }); await save(root, ledgerFile, state); }
        if(approved.packet.mediaProvider!==undefined&&!['metricool','google_drive'].includes(approved.packet.mediaProvider))throw Error('native_media_provider_invalid');
        if(approved.packet.mediaProvider==='metricool'){
          const imported=await bounded(()=>resolveNativeMediaReceipt(root,approved.asset,approved.bytes.length,{now,packet:approved.packet,fetcher:dependencies?.nativeFetch??fetch,timeoutMs:Math.min(15000,remaining())}));
          await appendSchedulerInput(root,approved,imported);prepared++;
          outcomes.push({id,destination:approved.destination,status:'prepared',mediaProvider:'metricool',providerWrites:0,renderReceiptSha256:approved.asset.renderReceiptSha256});continue;
        }
        const sha = approved.asset.mediaSha256; let entry = state.uploads[sha];
        if (priorAsset && (entry?.status !== 'ready' || priorAsset.mediaReceiptFileId !== entry.fileId || priorAsset.mediaUrl !== entry.mediaUrl)) {
          outcomes.push({ id, status: 'held', reason: 'approved_asset_needs_reconciliation' }); continue;
        }
        const existingReceipts = await ownerJson(root, `${REPORT}/portfolio-media-receipts.json`, []);
        if (!Array.isArray(existingReceipts) || existingReceipts.length > 5000) throw Error('portfolio_media_ledger_invalid');
        const existingReceipt = existingReceipts.find(row => findDestination(row) && destinationKey(row) === targetKey && row.draftFile === approved.asset.draftFile);
        if (!existingReceipt && existingReceipts.length >= 5000) throw Error('portfolio_receipt_capacity');
        if (existingReceipt && (existingReceipt.sha256 !== sha || existingReceipt.renderReceiptSha256 !== approved.asset.renderReceiptSha256 ||
            existingReceipt.campaignId !== approved.asset.campaignId || existingReceipt.paidSpendAllowed !== false)) throw Error('portfolio_media_receipt_conflict');
        if (entry && (entry.sha256 !== sha || !['upload_unknown', 'sharing_unknown', 'ready'].includes(entry.status))) throw Error('portfolio_upload_state_invalid');
        if (entry?.status === 'upload_unknown') { outcomes.push({ id, status: 'held', reason: 'upload_outcome_unknown_no_replay' }); continue; }
        const adapter = dependencies || (entry?.status === 'ready' || entry?.status === 'sharing_unknown'
          ? { verifyPublic: (url, value, size) => verifyPublicBytes(url, value, size, fetch, Math.max(1, Math.min(30_000, remaining()))) }
          : await createExistingDriveAdapter({ remaining, authorization: { workspaceRoot: root, requestId: id,
            packetSha256: digest(approved.packet), outputSha256: sha, parentPid: process.pid, operationNonce } }));
        if (!entry) {
          const stageDir = path.join(reportRoot, 'upload-stage'); await mkdir(stageDir, { recursive: true, mode: 0o700 });
          await privateStageDirectory(root);
          if (adapter.readiness) await bounded(() => adapter.readiness());
          const staged = path.join(stageDir, sha + '.mp4');
          try { await writeFile(staged, approved.bytes, { flag: 'wx', mode: 0o600 }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          const stagedFd = await open(staged, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { const info = await stagedFd.stat();
            if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid()) ||
                hash(await stagedFd.readFile()) !== sha) throw Error('staged_media_changed'); }
          finally { await stagedFd.close(); }
          entry = state.uploads[sha] = { sha256: sha, status: 'upload_unknown', reservedAt: now.toISOString(), sizeBytes: approved.bytes.length };
          await save(root, ledgerFile, state);
          const folderId = await bounded(() => adapter.ensureFolder());
          if (!DRIVE_ID.test(folderId ?? '')) throw Error('upload_folder_unconfirmed');
          entry.folderId = folderId; await save(root, ledgerFile, state);
          const result = await bounded(() => adapter.uploadFile({ filePath: staged, folderId, mimeType: 'video/mp4' }));
          if (!DRIVE_ID.test(result?.fileId ?? '')) throw Error('upload_receipt_missing');
          entry.fileId = result.fileId; entry.status = 'sharing_unknown';
          await save(root, ledgerFile, state); uploaded++;
          const url = await bounded(() => adapter.makePublic(entry.fileId));
          if (!exactDriveUrl(url, entry.fileId)) throw Error('public_drive_url_unconfirmed');
          entry.mediaUrl = url;
          await save(root, ledgerFile, state);
        }
        const url = entry.mediaUrl || publicDriveUrl(entry.fileId);
        if (!exactDriveUrl(url, entry.fileId) || !(await bounded(() => adapter.verifyPublic(url, sha, approved.bytes.length)))) {
          outcomes.push({ id, status: 'held', reason: 'public_exact_bytes_unverified_no_write_retry' }); continue;
        }
        entry.mediaUrl = url; entry.status = 'ready'; entry.verifiedAt = now.toISOString();
        await save(root, ledgerFile, state);
        await appendSchedulerInput(root, approved, entry); prepared++;
        outcomes.push({ id, destination: approved.destination, status: 'prepared', renderReceiptSha256: approved.asset.renderReceiptSha256, ...(approved.creatorSelectionHeld ? { creatorSelectionHeld: approved.creatorSelectionHeld } : {}) });
      } catch (error) {
        const reason = ['reviewed_prepare_packet_required', 'prepare_schedule_outside_rights', 'reviewed_render_output_changed', 'render_receipt_unconfirmed',
          'portfolio_media_changed', 'owner_private_file_required', 'scheduler_worker_busy', 'approved_asset_conflict', 'portfolio_media_receipt_conflict', 'prepare_time_budget_reached',
          'approved_queue_capacity', 'portfolio_receipt_capacity', 'approved_scheduler_input_invalid', 'portfolio_media_ledger_invalid',
          'private_stage_directory_required', 'staged_media_changed', 'native_media_provider_invalid', 'native_media_receipt_unverified', 'native_public_bytes_unverified'].includes(error.message)
          ? error.message : 'prepare_validation_or_provider_unconfirmed';
        outcomes.push({ id, status: 'held', reason });
      }
    }
    const report = { status: outcomes.every(row => row.status === 'prepared') ? 'prepared' : 'held_or_partial', generatedAt: now.toISOString(),
      prepared, uploaded, outcomes, paidSpendUsd: 0, publisherEnabledChanged: false };
    await save(root, `${REPORT}/prepare-latest.json`, report);
    return report;
  } finally { await lock.close(); await unlink(lockFile); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === '--drive-operation') {
    // This deadline survives the parent process dying during a remote write.
    setTimeout(() => process.exit(124), 30_000).unref();
    try {
      let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4000) throw Error(); }
      if (process.env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED !== 'true') throw Error();
      if (process.env.CLIPPERS_CONFIG_ROOT) {
        const { loadClipperSelectedEnv } = await import('./clippers-selected-env.mjs');
        const selected = {}; loadClipperSelectedEnv(process.env.CLIPPERS_CONFIG_ROOT, selected);
        for (const [name, value] of Object.entries(selected)) if (name.startsWith('GOOGLE_') && !process.env[name]) process.env[name] = value;
      }
      const input = JSON.parse(raw), auth = input.authorization;
      if (!auth || !ID.test(auth.requestId ?? '') || !SHA.test(auth.packetSha256 ?? '') || !SHA.test(auth.outputSha256 ?? '')) throw Error();
      const root = await realpath(path.resolve(auth.workspaceRoot));
      await livePreparation(root, auth);
      const packet = await ownerJson(root, `${CONFIG}/prepare-requests/${auth.requestId}.json`);
      if (digest(packet) !== auth.packetSha256 || packet.outputSha256 !== auth.outputSha256) throw Error();
      const renderApi = await import('./clippers-portfolio-render.mjs');
      await renderAndApprove(root, auth.requestId, new Date(), renderApi);
      if (process.argv[3] !== 'readiness') await claimDriveOperation(root, auth, process.argv[3], input);
      const drive = await import('../server/google-drive.ts'); let result;
      if (process.argv[3] === 'readiness') result = { connected: true, existingFolderId: await drive.findDriveFolderPath([drive.DRIVE_APP_ROOT_FOLDER, drive.DRIVE_CLIPPERS_MEDIA_FOLDER, 'Portfolio reviewed media']) };
      else if (process.argv[3] === 'folder') result = { folderId: await drive.ensureAppDriveFolderPath([drive.DRIVE_CLIPPERS_MEDIA_FOLDER, 'Portfolio reviewed media']) };
      else if (process.argv[3] === 'upload' && input.filePath === path.join(root, REPORT, 'upload-stage', auth.outputSha256 + '.mp4') && DRIVE_ID.test(input.folderId)) {
        await privateStageDirectory(root);
        const ledger = await ownerJson(root, `${REPORT}/portfolio-upload-state.json`);
        if (ledger.uploads?.[auth.outputSha256]?.folderId !== input.folderId) throw Error();
        const fd = await open(input.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const info = await fd.stat();
          if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid()) ||
              hash(await fd.readFile()) !== auth.outputSha256) throw Error(); } finally { await fd.close(); }
        result = await drive.uploadLocalFileToDriveFolder({ filePath: input.filePath, folderId: input.folderId, mimeType: 'video/mp4' });
      }
      else if (process.argv[3] === 'public' && DRIVE_ID.test(input.fileId)) {
        const ledger = await ownerJson(root, `${REPORT}/portfolio-upload-state.json`);
        if (ledger.uploads?.[auth.outputSha256]?.fileId !== input.fileId) throw Error();
        result = { mediaUrl: await drive.ensureDriveFilePublicDownload({ fileId: input.fileId }) };
      }
      else throw Error();
      process.stdout.write(JSON.stringify(result)); process.exit(0);
    } catch { process.exit(1); }
  } else {
    // Schedulers can invoke this CLI as a bounded child even if local I/O stalls.
    setTimeout(() => process.exit(124), 120_000).unref();
    console.log(JSON.stringify(await runClippersPortfolioPrepare(), null, 2));
  }
}
