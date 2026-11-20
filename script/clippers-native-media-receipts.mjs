import { createHash,randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open,realpath,mkdir,rename,unlink,writeFile,lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findDestination,destinationKey,providerTimestamp,createPortfolioMetricool } from './clippers-portfolio-metricool.mjs';
import { approvedEditorialSourceProof, weeklyDeliveryCollision, readWeeklyPrivateJson } from './clippers-weekly-policy.mjs';
import { readPortfolioRenderManifest } from './clippers-portfolio-render.mjs';
import { loadClipperSelectedEnv } from './clippers-selected-env.mjs';
const SHA=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const sha=v=>typeof v==='string'&&SHA.test(v),id=v=>typeof v==='string'&&ID.test(v);
const hash=b=>createHash('sha256').update(b).digest('hex');
export const nativeReceiptDigest=v=>hash(JSON.stringify(v));
const REPORT='reports/clippers-daily-learning',CONFIG='config/clippers-daily-learning';
/** Initially admit only the actual anonymously verified native CDN shape; no speculative S3 origins. */
export function metricoolNativeUrl(value){
 if(typeof value!=='string')return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.hostname==='static.metricool.com'&&/^\/video\/\d+\/\d{6}\/[A-Za-z0-9_-]+\.mp4$/.test(u.pathname)?u.href:null;}catch{return null;}
}
export function validNativeResource(resource,url){
 if(!resource||typeof resource!=='object'||Array.isArray(resource))return false;
 if(resource.kind==='metricool_cdn_url')return resource.url===url&&!!metricoolNativeUrl(url);
 return (resource.kind===undefined||resource.kind==='s3_object')&&typeof resource.bucket==='string'&&/^metricool-[a-z0-9-]+$/.test(resource.bucket)&&typeof resource.key==='string'&&resource.key.length<=1024&&resource.key.length>0&&!/[\x00-\x20?#\\]/.test(resource.key)&&!resource.key.split('/').includes('..');
}
export function nativeReceiptMatches(receipt,asset,sizeBytes,now=new Date()){
 return !!receipt&&receipt.schemaVersion===1&&receipt.provider==='metricool'&&receipt.kind==='metricool_native_media_receipt'&&receipt.status==='ready'&&
  findDestination(receipt.destination)&&findDestination(asset)&&destinationKey(receipt.destination)===destinationKey(asset)&&receipt.assetId===asset.id&&
  sha(receipt.renderReceiptSha256)&&receipt.renderReceiptSha256===asset.renderReceiptSha256&&sha(receipt.sha256)&&receipt.sha256===asset.mediaSha256&&
  Number.isSafeInteger(receipt.sizeBytes)&&receipt.sizeBytes>0&&receipt.sizeBytes===sizeBytes&&!!metricoolNativeUrl(receipt.mediaUrl)&&validNativeResource(receipt.resource,receipt.mediaUrl)&&
  !!providerTimestamp(receipt.verifiedAt)&&Date.parse(receipt.verifiedAt)<=+now&&
  receipt.verification==='anonymous_exact_bytes_sha256'&&receipt.paidSpendAllowed===false&&receipt.paidSpendUsd===0&&sha(receipt.authorizedManifestSha256)&&!Object.hasOwn(receipt,'fileId');
}
export async function verifyMetricoolNativeBytes(url,expectedSha,sizeBytes,{fetcher=fetch,timeoutMs=15000}={}){
 if(!metricoolNativeUrl(url)||!sha(expectedSha)||!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||sizeBytes>250000000)return false;
 try{const r=await fetcher(url,{headers:{accept:'video/mp4, application/octet-stream'},redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,30000)))});
  if(!r.ok||!r.body||!/^video\/mp4(?:;|$)|^application\/octet-stream(?:;|$)/i.test(r.headers.get('content-type')??''))return false;
  const length=r.headers.get('content-length');if(length!==null&&Number(length)!==sizeBytes)return false;
  const h=createHash('sha256');let count=0;for await(const chunk of r.body){count+=chunk.length;if(count>sizeBytes)return false;h.update(chunk);}return count===sizeBytes&&h.digest('hex')===expectedSha;
 }catch{return false;}
}
export async function resolveNativeMediaReceipt(root,asset,sizeBytes,{now=new Date(),fetcher=fetch,timeoutMs=15000,packet}={}){
 if(!id(asset?.id)||!findDestination(asset))throw Error('native_asset_scope_invalid');
 const receipt=await readWeeklyPrivateJson(root,`${REPORT}/native-media-imports/${asset.id}.json`,null);
 if(!packet||receipt?.authorizedManifestSha256!==nativeReceiptDigest(packet)||receipt.renderRequestSha256!==packet.renderRequestSha256||!nativeReceiptMatches(receipt,asset,sizeBytes,now))throw Error('native_media_receipt_unverified');
 if(!await verifyMetricoolNativeBytes(receipt.mediaUrl,receipt.sha256,sizeBytes,{fetcher,timeoutMs}))throw Error('native_public_bytes_unverified');
 return{provider:'metricool',mediaUrl:receipt.mediaUrl,resource:receipt.resource,nativeReceiptSha256:nativeReceiptDigest(receipt)};
}
export function nativeAssetMediaFields(media){
 return{mediaProvider:'metricool',mediaReceiptNativeUrl:media.mediaUrl,mediaReceiptResource:media.resource,mediaReceiptSha256:media.nativeReceiptSha256,mediaUrl:media.mediaUrl};
}
export function approvedNativeMedia(asset,rows){
 if(asset.mediaProvider!=='metricool'||Object.hasOwn(asset,'mediaReceiptFileId')||!metricoolNativeUrl(asset.mediaUrl)||asset.mediaReceiptNativeUrl!==asset.mediaUrl||!validNativeResource(asset.mediaReceiptResource,asset.mediaUrl)||!sha(asset.mediaReceiptSha256))return false;
 return rows.some(r=>r.provider==='metricool'&&r.status==='ready'&&r.paidSpendAllowed===false&&findDestination(r)&&destinationKey(r)===destinationKey(asset)&&
  r.campaignId===asset.campaignId&&r.draftFile===asset.draftFile&&r.sha256===asset.mediaSha256&&r.renderReceiptSha256===asset.renderReceiptSha256&&
  r.mediaUrl===asset.mediaUrl&&r.nativeReceiptSha256===asset.mediaReceiptSha256&&nativeReceiptDigest(r.resource)===nativeReceiptDigest(asset.mediaReceiptResource)&&!Object.hasOwn(r,'fileId'));
}
async function save(root,relative,value){const file=path.join(root,relative);await mkdir(path.dirname(file),{recursive:true,mode:0o700});const dir=await lstat(path.dirname(file));const prior=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(!dir.isDirectory()||(dir.mode&0o077)||(process.getuid&&dir.uid!==process.getuid())||(prior&&(!prior.isFile()||prior.nlink!==1||(prior.mode&0o077)||(process.getuid&&prior.uid!==process.getuid())))||await realpath(path.dirname(file))!==path.dirname(file))throw Error('native_private_path_required');const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}}
/** Read-only observation of a real owner-UI post. Never grants publishing eligibility or writes learner deliveries. */
export async function reconcileExternalMetricoolSchedule({workspaceRoot,assetId,external,now=new Date(),adapter,fetcher=fetch,env=process.env}={}){
 if(!(now instanceof Date)||!Number.isFinite(+now))throw Error('external_observation_time_invalid');
 const root=await realpath(path.resolve(workspaceRoot));if(!id(assetId)||!external||!findDestination(external.destination)||typeof external.metricoolId!=='string'||!/^\d+$/.test(external.metricoolId)||!providerTimestamp(external.scheduledAt)||!metricoolNativeUrl(external.mediaUrl)||!sha(external.sha256)||!Number.isSafeInteger(external.sizeBytes))throw Error('external_schedule_scope_invalid');
 const packet=await readWeeklyPrivateJson(root,`${CONFIG}/prepare-requests/${assetId}.json`),request=await readWeeklyPrivateJson(root,`${CONFIG}/render-requests/${assetId}.json`);
 if(packet.id!==assetId||request.id!==assetId||!findDestination(packet.destination)||destinationKey(packet.destination)!==destinationKey(external.destination)||!findDestination(request)||destinationKey(request)!==destinationKey(external.destination)||packet.renderRequestSha256!==nativeReceiptDigest(request)||packet.outputSha256!==external.sha256||providerTimestamp(packet.scheduledAt)!==providerTimestamp(external.scheduledAt)||packet.caption!==external.caption||!sha(packet.renderReceiptSha256))throw Error('external_asset_binding_invalid');
 if(!id(request.policyVersion))throw Error('external_render_binding_invalid');
 const receipt=await readWeeklyPrivateJson(root,`${REPORT}/render-receipts/${destinationKey(external.destination).replaceAll(':','__')}/${assetId}/${request.policyVersion}/${packet.outputSha256}.json`);
 const manifest=await readPortfolioRenderManifest(root,external.destination,request.policyVersion);
 if(nativeReceiptDigest(receipt)!==packet.renderReceiptSha256||receipt.renderRequestSha256!==nativeReceiptDigest(request)||receipt.requestId!==assetId||receipt.version!==request.policyVersion||receipt.captionTextSha256!==hash(typeof request.captionText==='string'?request.captionText:'')||receipt.engineSha256!==manifest.engineSha256||receipt.outputSha256!==external.sha256||!findDestination(receipt.destination)||destinationKey(receipt.destination)!==destinationKey(external.destination)||receipt.sourceSha256!==request.sourceSha256||receipt.startSeconds!==request.sourceStartSeconds+receipt.actualParams?.hook||receipt.manifestSha!==manifest.sha||nativeReceiptDigest(receipt.actualParams)!==nativeReceiptDigest(manifest.params)||receipt.costUsd!==0)throw Error('external_render_binding_invalid');
 const file=path.resolve(root,receipt.draftFile);if(!file.startsWith(root+path.sep)||await realpath(file)!==file)throw Error('external_local_media_invalid');let fd;
 try{fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await fd.stat();if(!s.isFile()||s.nlink!==1||(s.mode&0o022)||(process.getuid&&s.uid!==process.getuid())||s.size!==external.sizeBytes||s.size>250000000)throw Error('external_local_media_invalid');const h=createHash('sha256');let count=0;const chunk=Buffer.alloc(65536);while(true){const {bytesRead}=await fd.read(chunk,0,Math.min(chunk.length,external.sizeBytes+1-count));if(!bytesRead)break;count+=bytesRead;if(count>external.sizeBytes)throw Error('external_local_media_invalid');h.update(chunk.subarray(0,bytesRead));}const after=await fd.stat();if(count!==external.sizeBytes||h.digest('hex')!==external.sha256||after.size!==s.size||after.mtimeMs!==s.mtimeMs)throw Error('external_local_media_invalid');}finally{await fd?.close();}
 if(!await verifyMetricoolNativeBytes(external.mediaUrl,external.sha256,external.sizeBytes,{fetcher}))throw Error('external_public_media_invalid');
 if(!adapter){const selected={...env};if((!selected.METRICOOL_USER_TOKEN||!selected.METRICOOL_USER_ID)&&env.CLIPPERS_CONFIG_ROOT)loadClipperSelectedEnv(env.CLIPPERS_CONFIG_ROOT,selected);adapter=createPortfolioMetricool({token:selected.METRICOOL_USER_TOKEN,userId:selected.METRICOOL_USER_ID});}
 const item={...external.destination,id:assetId,scheduledAt:providerTimestamp(external.scheduledAt),caption:packet.caption,mediaUrl:external.mediaUrl,mediaSha256:external.sha256};
 const confirmed=await adapter.confirmSchedule(external.destination,item);
 if(!confirmed||confirmed.id!==external.metricoolId||confirmed.mediaUrl!==external.mediaUrl)throw Error('external_provider_get_unconfirmed');
 const actualAt=now.toISOString();
 const media={schemaVersion:1,provider:'metricool',kind:'metricool_native_media_receipt',status:'ready',assetId,destination:external.destination,renderReceiptSha256:packet.renderReceiptSha256,renderRequestSha256:packet.renderRequestSha256,sha256:external.sha256,sizeBytes:external.sizeBytes,mediaUrl:external.mediaUrl,resource:{kind:'metricool_cdn_url',url:external.mediaUrl},verifiedAt:actualAt,verification:'anonymous_exact_bytes_sha256',paidSpendAllowed:false,paidSpendUsd:0,authorizedManifestSha256:nativeReceiptDigest(packet),origin:'external_owner_ui'};
 const sourceAsset={...external.destination,id:assetId,policyVersion:request.policyVersion,mediaSha256:external.sha256,renderReceiptSha256:packet.renderReceiptSha256,sourceUrl:packet.sourceUrl,sourcePublishedAt:request.rights?.sourcePublishedAt,rightsObservedAt:request.rights?.observedAt,rightsValidUntil:request.rights?.validUntil,thirdPartyCommercial:packet.thirdPartyCommercial};
 const sourceProof=await approvedEditorialSourceProof(root,sourceAsset);if(!sourceProof)throw Error('external_source_binding_invalid');
 const observation={schemaVersion:1,origin:'external_owner_ui',kind:'external_schedule_observation',assetId,destination:external.destination,sourceUrl:packet.sourceUrl,caption:packet.caption,weeklySourceProof:sourceProof,metricoolId:confirmed.id,scheduledAt:item.scheduledAt,mediaUrl:media.mediaUrl,sha256:media.sha256,sizeBytes:media.sizeBytes,renderReceiptSha256:packet.renderReceiptSha256,observedAt:actualAt,confirmation:'exact_scheduler_get_and_native_bytes',publicationState:'not_evaluated',paidSpendUsd:0};
 const lockPath=path.join(root,'reports/metricool-autopilot.lock');let lock;
 try{lock=await open(lockPath,'wx',0o600);}catch{throw Error('scheduler_worker_busy');}
 try{const prior=await readWeeklyPrivateJson(root,`${REPORT}/external-schedules.json`,[]);if(!Array.isArray(prior)||prior.length>1000)throw Error('external_schedule_ledger_invalid');const existing=prior.find(r=>destinationKey(r.destination)===destinationKey(external.destination)&&r.metricoolId===confirmed.id);if(existing&&(existing.assetId!==assetId||existing.scheduledAt!==observation.scheduledAt||existing.sha256!==observation.sha256||existing.mediaUrl!==observation.mediaUrl))throw Error('external_schedule_identity_conflict');if(!existing&&prior.length===1000)throw Error('external_schedule_capacity');const ledger=prior.filter(r=>r!==existing);ledger.push({...observation,proofSha256:nativeReceiptDigest(observation)});await save(root,`${REPORT}/external-schedules.json`,ledger);const oldMedia=await readWeeklyPrivateJson(root,`${REPORT}/native-media-imports/${assetId}.json`,null);if(oldMedia){if(!nativeReceiptMatches(oldMedia,{...external.destination,id:assetId,renderReceiptSha256:packet.renderReceiptSha256,mediaSha256:external.sha256},external.sizeBytes,now)||oldMedia.mediaUrl!==media.mediaUrl||oldMedia.authorizedManifestSha256!==media.authorizedManifestSha256||oldMedia.renderRequestSha256!==media.renderRequestSha256)throw Error('native_media_identity_conflict');}else await save(root,`${REPORT}/native-media-imports/${assetId}.json`,media);
 }finally{const held=await lock.stat();await lock.close();const current=await lstat(lockPath).catch(()=>null);if(current?.ino===held.ino&&current?.dev===held.dev)await unlink(lockPath);}
 return{status:'external_schedule_verified',metricoolId:confirmed.id,assetId,scheduled:item.scheduledAt,origin:'external_owner_ui',providerWrites:0,learnerStateChanged:false,paidSpendUsd:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2),get=n=>args[args.indexOf(n)+1];if(!args.includes('--observe')||!args.includes('--asset')||args.length!==4||!get('--observe')?.endsWith('.json'))throw Error();const file=await realpath(get('--observe'));const external=await readWeeklyPrivateJson(path.dirname(file),path.basename(file));console.log(JSON.stringify(await reconcileExternalMetricoolSchedule({workspaceRoot:process.env.CLIPPERS_WORKSPACE_ROOT,assetId:get('--asset'),external})));}
 catch{console.log(JSON.stringify({status:'held',reason:'external_observation_unverified',providerWrites:0,learnerStateChanged:false}));process.exitCode=1;}
}

export function verifiedExternalSchedules(rows,now=new Date(),{strict=true}={}){
 const invalid=()=>{if(strict)throw Error('external_schedule_ledger_invalid');return [];};
 if(!Array.isArray(rows)||rows.length>1000)return invalid();
 const valid=rows.filter(r=>{if(!r||typeof r!=='object')return false;const {proofSha256,...p}=r;return sha(proofSha256)&&nativeReceiptDigest(p)===proofSha256&&r.schemaVersion===1&&r.origin==='external_owner_ui'&&r.kind==='external_schedule_observation'&&typeof r.sourceUrl==='string'&&typeof r.caption==='string'&&r.caption.length<=2200&&id(r.assetId)&&findDestination(r.destination)&&typeof r.metricoolId==='string'&&/^\d+$/.test(r.metricoolId)&&providerTimestamp(r.scheduledAt)&&metricoolNativeUrl(r.mediaUrl)&&sha(r.sha256)&&sha(r.renderReceiptSha256)&&Number.isSafeInteger(r.sizeBytes)&&r.sizeBytes>0&&providerTimestamp(r.observedAt)&&Date.parse(r.observedAt)<=+now&&r.confirmation==='exact_scheduler_get_and_native_bytes'&&r.publicationState==='not_evaluated'&&r.paidSpendUsd===0;});
 if(valid.length!==rows.length)return invalid();
 const ids=new Set(),assets=new Set();const result=valid.filter(r=>{const k=destinationKey(r.destination),key=k+':'+r.metricoolId,a=k+':'+r.assetId;if(ids.has(key)||assets.has(a))return false;ids.add(key);assets.add(a);return true;});return result.length===rows.length?result:invalid();
}

export function externalScheduleCollision(observation,asset){
 if(!observation||!findDestination(observation.destination)||!findDestination(asset)||destinationKey(observation.destination)!==destinationKey(asset))return false;
 if(observation.assetId===asset.id||observation.sha256===asset.mediaSha256||observation.mediaUrl===asset.mediaUrl)return true;
 return weeklyDeliveryCollision({...observation.destination,id:observation.assetId,mediaSha256:observation.sha256,scheduledAt:observation.scheduledAt,caption:observation.caption??'',sourceUrl:observation.sourceUrl,weeklySourceProof:observation.weeklySourceProof},asset);
}
