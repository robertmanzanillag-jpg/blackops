import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalSourceIdentity } from '../shared/clippers-priority-creators.mjs';
import { findDestination, destinationKey, localDay, providerTimestamp } from './clippers-portfolio-metricool.mjs';
const HOUR = 3600000;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/;
export const weeklyDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = value => typeof value === 'string' && SHA.test(value);
const id = value => typeof value === 'string' && ID.test(value);
const equal = (a,b) => weeklyDigest(a ?? null) === weeklyDigest(b ?? null);
function calendarDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(day + 'T12:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === day ? +parsed : null;
}
export function validWeeklyWindow(window, now) {
  const from = calendarDay(window?.startDate), to = calendarDay(window?.endDate);
  return from !== null && to !== null && to >= from && to-from <= 6*24*HOUR &&
    window.endDate >= localDay(now) && window.startDate <= localDay(now);
}
export function validateEvergreenAuthorization({ authorization:a, license:p, request, rendered, asset, now, window }) {
  if (!(now instanceof Date) || !Number.isFinite(+now) || !validWeeklyWindow(window,now) ||
      !a || a.schemaVersion !== 1 || a.contentClass !== 'evergreen_streamer_clip' ||
      !p || p.schemaVersion !== 1 || p.kind !== 'reviewed_exact_asset_license' ||
      !findDestination(asset) || !findDestination(a.destination) || !findDestination(p.destination) ||
      !findDestination(request) || destinationKey(asset)!==destinationKey(request) ||
      destinationKey(asset) !== destinationKey(a.destination) || destinationKey(asset) !== destinationKey(p.destination) ||
      !sha(a.licenseEvidenceSha256) || weeklyDigest(p) !== a.licenseEvidenceSha256 ||
      !sha(asset.weeklyAuthorizationSha256) || weeklyDigest(a) !== asset.weeklyAuthorizationSha256 ||
      !equal(a,request?.weeklyAuthorization) || !equal(rendered?.destination,a.destination) ||
      rendered?.renderRequestSha256 !== weeklyDigest(request) || weeklyDigest(rendered) !== asset.renderReceiptSha256 ||
      rendered.costUsd !== 0 || rendered.requestId !== asset.id || rendered.version !== asset.policyVersion || rendered.outputSha256 !== asset.mediaSha256 ||
      rendered.sourceSha256 !== request?.sourceSha256 || !sha(request?.sourceSha256) ||
      !id(a.reviewedBy) || !id(p.reviewedBy)) return false;
  if (!Object.hasOwn(p,'permissionExpiresAt') || (p.permissionExpiresAt!==null && (!providerTimestamp(p.permissionExpiresAt) || Date.parse(p.permissionExpiresAt)<Date.parse(asset.scheduledAt)))) return false;
  const r = request.rights;
  const at = providerTimestamp(asset.scheduledAt), source = providerTimestamp(asset.sourcePublishedAt);
  const review = providerTimestamp(asset.rightsObservedAt), until = providerTimestamp(asset.rightsValidUntil);
  const renderedAt = providerTimestamp(rendered.renderedAt);
  if (!at || !source || !review || !until || !renderedAt ||
      +new Date(at) < +now + 300000 || +new Date(source) > +new Date(renderedAt) ||
      +new Date(renderedAt)-+new Date(source) >= 72*HOUR || +new Date(renderedAt)>+now ||
      +new Date(review)>+new Date(renderedAt) || +now-+new Date(review)>24*HOUR || +new Date(until)<+new Date(at) ||
      localDay(new Date(at)) < window.startDate || localDay(new Date(at)) > window.endDate ||
      !validWeeklyWindow({startDate:a.windowStart,endDate:a.windowEnd},now) ||
      localDay(new Date(at))<a.windowStart || localDay(new Date(at))>a.windowEnd ||
      a.scheduledAt !== asset.scheduledAt || a.sourceUrl !== asset.sourceUrl || a.sourceSha256 !== request.sourceSha256 ||
      a.sourcePublishedAt !== asset.sourcePublishedAt || a.observedAt !== asset.rightsObservedAt || a.validUntil !== asset.rightsValidUntil ||
      r?.sourceSha256 !== request.sourceSha256 || r.sourcePublishedAt !== asset.sourcePublishedAt ||
      r.observedAt !== asset.rightsObservedAt || r.validUntil !== asset.rightsValidUntil ||
      !findDestination(r.destination) || destinationKey(r.destination)!==destinationKey(asset)) return false;
  try { const sourceUrl=new URL(asset.sourceUrl);if(sourceUrl.protocol!=='https:'||sourceUrl.username||sourceUrl.password||sourceUrl.port)return false;
    const terms = new URL(r.termsUrl); if (terms.protocol !== 'https:' || terms.username || terms.password || terms.port) return false; } catch { return false; }
  if (!((r.basis==='campaign' && r.membership==='verified') || (r.basis==='public_policy' && r.membership==='not_required') ||
      (r.basis==='owned' && r.membership==='not_required' && r.ownership==='verified'))) return false;
  for (const proof of [a,p]) {
    if (proof.sourceSha256!==request.sourceSha256 || proof.sourceUrl!==asset.sourceUrl || proof.sourcePublishedAt!==asset.sourcePublishedAt ||
        proof.thirdPartyCommercial!==asset.thirdPartyCommercial || r.thirdPartyCommercial!==asset.thirdPartyCommercial ||
        proof.termsUrl!==r.termsUrl || proof.observedAt!==r.observedAt || proof.validUntil!==r.validUntil ||
        proof.sourceScope!=='exact_asset' || proof.commercialPermission!=='approved' || proof.basis!==r.basis || proof.membership!==r.membership ||
        (r.basis==='owned' && proof.ownership!=='verified') || !Array.isArray(proof.permittedNetworks) || !proof.permittedNetworks.includes(asset.network)) return false;
  }
  return Array.isArray(r.permittedNetworks) && r.permittedNetworks.includes(asset.network) && r.commercialPermission==='approved' && r.sourceScope==='exact_asset';
}
export async function readWeeklyPrivateJson(root, relative, fallback, prohibitedMode=0o077) {
  const file = path.resolve(root,relative);
  if (!file.startsWith(root+path.sep) || await realpath(root)!==root) throw Error('weekly_private_path_required');
  let fd;
  try {
    if (await realpath(path.dirname(file))!==path.dirname(file)) throw Error('weekly_private_path_required');
    fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const st=await fd.stat();
    if (!st.isFile() || st.nlink!==1 || st.mode&prohibitedMode || (process.getuid && st.uid!==process.getuid()) || st.size>25000000) throw Error('weekly_private_file_required');
    const bytes=Buffer.alloc(Math.min(st.size+1,25000001));let length=0;
    while(length<bytes.length){const got=await fd.read(bytes,length,bytes.length-length,null);if(!got.bytesRead)break;length+=got.bytesRead;}
    const after=await fd.stat();
    if(length!==st.size || after.size!==st.size || after.mtimeMs!==st.mtimeMs || after.ctimeMs!==st.ctimeMs)throw Error('weekly_private_file_changed');
    return JSON.parse(bytes.subarray(0,length).toString('utf8'));
  } catch(error) {if(error.code==='ENOENT' && fallback!==undefined)return fallback;throw error;}
  finally{await fd?.close();}
}
async function readEditorialRender(root,asset) {
  if(!findDestination(asset)||!id(asset.id)||!id(asset.policyVersion)||!sha(asset.mediaSha256)||!sha(asset.renderReceiptSha256))throw Error('editorial_render_unverified');
  const request=await readWeeklyPrivateJson(root,`config/clippers-daily-learning/render-requests/${asset.id}.json`);
  const rendered=await readWeeklyPrivateJson(root,`reports/clippers-daily-learning/render-receipts/${destinationKey(asset).replaceAll(':','__')}/${asset.id}/${asset.policyVersion}/${asset.mediaSha256}.json`);
  if(!findDestination(request)||destinationKey(request)!==destinationKey(asset)||!findDestination(rendered.destination)||destinationKey(rendered.destination)!==destinationKey(asset)||
      rendered.requestId!==asset.id||rendered.version!==asset.policyVersion||rendered.outputSha256!==asset.mediaSha256||rendered.costUsd!==0||
      weeklyDigest(rendered)!==asset.renderReceiptSha256||rendered.renderRequestSha256!==weeklyDigest(request)||
      rendered.sourceSha256!==request.sourceSha256||!sha(rendered.sourceSha256)||
      !Number.isFinite(request.sourceStartSeconds)||!Number.isFinite(rendered.actualParams?.hook)||rendered.startSeconds!==request.sourceStartSeconds+rendered.actualParams.hook||
      !Number.isFinite(rendered.startSeconds)||rendered.startSeconds<0||!Number.isFinite(rendered.actualParams.duration)||rendered.actualParams.duration<=0)throw Error('editorial_render_unverified');
  const r=request.rights;
  if(!r || !findDestination(r.destination) || destinationKey(r.destination)!==destinationKey(asset)||r.sourceSha256!==request.sourceSha256||
      r.sourcePublishedAt!==asset.sourcePublishedAt||r.observedAt!==asset.rightsObservedAt||r.validUntil!==asset.rightsValidUntil||r.thirdPartyCommercial!==asset.thirdPartyCommercial||
      !Array.isArray(r.permittedNetworks)||!r.permittedNetworks.includes(asset.network)||r.sourceScope!=='exact_asset'||r.commercialPermission!=='approved')throw Error('editorial_rights_binding_unverified');
  return{request,rendered};
}
function sourceProof(request,rendered,asset) {
  const url=new URL(asset.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('editorial_source_identity_unverified');
  const canonical=canonicalSourceIdentity(asset.sourceUrl),p=request.sourceProvenance;
  if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname)&&!canonical)throw Error('editorial_source_identity_unverified');
  if(p && (p.schemaVersion!==1||!sha(p.originalSourceSha256)||p.derivedSourceSha256!==request.sourceSha256||typeof p.canonicalVideoId!=='string'||!/^[-_a-zA-Z0-9]{11}$/.test(p.canonicalVideoId)||
      canonical!=='youtube:'+p.canonicalVideoId||p.originalSourcePublishedAt!==asset.sourcePublishedAt||p.timelinePreserved!==true||p.audioPreserved!==true||!sha(p.transformReceiptSha256)))throw Error('editorial_source_provenance_unverified');
  return{rightsBasis:request.rights.basis,membership:request.rights.membership,termsUrl:request.rights.termsUrl,...(request.rights.ownership?{ownership:request.rights.ownership}:{}),sourceSha256:rendered.sourceSha256,originalSourceSha256:p?.originalSourceSha256??rendered.sourceSha256,
    sourceIdentity:canonical??url.origin+url.pathname,startSeconds:rendered.startSeconds,endSeconds:rendered.startSeconds+rendered.actualParams.duration,
    ...(p?{sourceProvenanceSha256:weeklyDigest(p),transformReceiptSha256:p.transformReceiptSha256}:{})};
}
export async function approvedEditorialSourceProof(root,asset) {
  try{const{request,rendered}=await readEditorialRender(root,asset);return sourceProof(request,rendered,asset);}catch{return false;}
}
export async function approvedWeeklyAuthorization(root,asset,now,window) {
  if(!sha(asset?.weeklyAuthorizationSha256))return false;
  try {
    const{request,rendered}=await readEditorialRender(root,asset),a=request.weeklyAuthorization;
    if(!sha(a?.licenseEvidenceSha256))return false;
    const license=await readWeeklyPrivateJson(root,`config/clippers-daily-learning/rights-evidence/${a.licenseEvidenceSha256}.json`);
    if(!validateEvergreenAuthorization({authorization:a,license,request,rendered,asset,now,window}))return false;
    const proof=sourceProof(request,rendered,asset);
    if(request.sourceProvenance && (license.sourceProvenanceSha256!==weeklyDigest(request.sourceProvenance)||license.originalSourceSha256!==proof.originalSourceSha256))return false;
    return{authorizationSha256:asset.weeklyAuthorizationSha256,...proof};
  }catch{return false;}
}
export const newYorkHour = time => new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(new Date(time));

export function weeklyDeliveryCollision(a,b) {
  if (destinationKey(a)!==destinationKey(b))return false;
  if(a.id===b.id || a.mediaSha256===b.mediaSha256 || a.scheduledAt===b.scheduledAt ||
      (localDay(new Date(a.scheduledAt))===localDay(new Date(b.scheduledAt)) && newYorkHour(a.scheduledAt)===newYorkHour(b.scheduledAt)) ||
      a.caption.trim().toLowerCase()===b.caption.trim().toLowerCase())return true;
  const x=a.weeklySourceProof,y=b.weeklySourceProof;
  if(!x || !y) {
    if(a.sourceUrl===b.sourceUrl)return true;
    const legacy=x?b:y?a:null, proven=x??y;
    return !!legacy && canonicalSourceIdentity(legacy.sourceUrl)===proven.sourceIdentity;
  }
  if([x,y].some(p=>!sha(p.sourceSha256)||typeof p.sourceIdentity!=='string'||!Number.isFinite(p.startSeconds)||!Number.isFinite(p.endSeconds)||p.startSeconds<0||p.endSeconds<=p.startSeconds))return true;
  if(x.sourceSha256!==y.sourceSha256 && (!x.originalSourceSha256||!y.originalSourceSha256||x.originalSourceSha256!==y.originalSourceSha256) && x.sourceIdentity!==y.sourceIdentity)return false;
  return x.startSeconds<y.endSeconds && y.startSeconds<x.endSeconds;
}
