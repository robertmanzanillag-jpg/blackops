import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { selectCreatorPreferences } from './clippers-creator-selection.mjs';
import { findDestination, destinationKey, exactPost, canonicalDestinationKey } from './clippers-portfolio-metricool.mjs';
import { confirmedRenderReceipt } from './clippers-portfolio-render.mjs';
import { canonicalSourceIdentity, resolveCreatorGroup } from '../shared/clippers-priority-creators.mjs';
const HOUR=3600000, SHA=/^[a-f0-9]{64}$/, ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const ROOT='reports/clippers-creator-selection';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
const legacySha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
const iso=v=>new Date(v).toISOString();
async function read(root,relative,fallback){
 let fd;const file=path.join(root,relative);
 try{if(await realpath(path.dirname(file))!==path.dirname(file))throw Error('creator_private_parent_required');
  fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=await fd.stat();
  if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid())||stat.size>8*1024*1024)throw Error('creator_private_file_required');
  const data=Buffer.alloc(stat.size+1);const {bytesRead}=await fd.read(data,0,data.length,0);if(bytesRead!==stat.size)throw Error('creator_file_changed');return JSON.parse(data.subarray(0,bytesRead).toString());
 }catch(e){if(e.code==='ENOENT')return fallback;throw e;}finally{await fd?.close();}
}
async function save(root,relative,value,maxBytes=8*1024*1024){const file=path.join(root,relative),temp=file+'.'+randomUUID()+'.tmp';
 const serialized=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(serialized)>maxBytes)throw Error('creator_ledger_size_capacity');
 try{await writeFile(temp,serialized,{mode:0o600,flag:'wx'});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}}
const scopeOf=m=>({destination:m.destination,language:m.language,format:m.format,context:m.context,renderManifestSha256:m.renderManifestSha256,renderEngineSha256:m.renderEngineSha256,postingSlot:m.postingSlot,windowHours:m.windowHours});
const scopeKey=m=>sha(scopeOf(m));
const assetKey=a=>destinationKey(a)+':'+a.id;
function videoId(url){return canonicalSourceIdentity(url)?.replace(/^youtube:/,'')??null;}
const clock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function band(at){const parts=Object.fromEntries(clock.formatToParts(new Date(at)).map(p=>[p.type,p.value]));return parts.hour+':00';}
export function normalizeCreatorContext(value,asset,resolveCreator){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const names=['format','context','channelId','sourceVideoId','postingBand','timezone','windowHours',...(value.sourceEpisodeId===undefined?[]:['sourceEpisodeId'])];
 if(Object.keys(value).length!==names.length||Object.keys(value).some(k=>!names.includes(k))||!ID.test(value.format??'')||value.format==='unknown'||!ID.test(value.context??'')||value.timezone!=='America/New_York'||!/^(?:[01]\d|2[0-3]):00$/.test(value.postingBand??'')||![24,72,168].includes(value.windowHours)||!Number.isFinite(time(asset.scheduledAt))||value.postingBand!==band(asset.scheduledAt))return null;
 const channel=resolveCreator(value.channelId),source=videoId(asset.sourceUrl);
 if(!channel||channel.channelId!==value.channelId||resolveCreatorGroup(asset.creator)?.id!==channel.creatorGroupId||!source||source!==value.sourceVideoId||(value.sourceEpisodeId!==undefined&&!ID.test(value.sourceEpisodeId)))return null;
 return {format:value.format,context:value.context,channelId:channel.channelId,sourceVideoId:source,postingBand:value.postingBand,timezone:'America/New_York',windowHours:value.windowHours,...(value.sourceEpisodeId===undefined?{}:{sourceEpisodeId:value.sourceEpisodeId})};
}
async function metadata(root,asset,now,resolveCreator){
 if(!findDestination(asset)||asset.experiment||!SHA.test(asset.renderReceiptSha256??'')||!SHA.test(asset.evidenceSha256??''))return null;
 const evidence=await read(root,'config/clippers-daily-learning/evidence/'+asset.evidenceSha256+'.json',null);
 if(!evidence||legacySha(evidence)!==asset.evidenceSha256||evidence.assetId!==asset.id||
  ['sourceUrl','mediaSha256','renderReceiptSha256','policyVersion','scheduledAt','language','creator'].some(k=>evidence[k]!==asset[k])||
  ['rightsObservedAt','rightsValidUntil','sourcePublishedAt'].some(k=>evidence[k]!==asset.rightsEvidence?.[k])||
  evidence.commercialPermission!=='approved'||evidence.sourceScope!=='exact_asset'||
  !ID.test(evidence.reviewedBy??'')||!findDestination(evidence.destination)||destinationKey(evidence.destination)!==destinationKey(asset))return null;
 const m=normalizeCreatorContext(evidence.creatorSelection,asset,resolveCreator);
 if(!m||!ID.test(m.format??'')||m.format==='unknown'||!ID.test(m.context??'')||m.timezone!=='America/New_York'||!/^\d\d:00$/.test(m.postingBand??'')||![24,72,168].includes(m.windowHours))return null;
 const creator=resolveCreator(m.channelId);if(!creator||creator.channelId!==m.channelId)return null;
 const sourceVideoId=videoId(asset.sourceUrl);if(!sourceVideoId||m.sourceVideoId!==sourceVideoId||(m.sourceEpisodeId!==undefined&&!ID.test(m.sourceEpisodeId)))return null;
 const proof=await confirmedRenderReceipt(root,asset,findDestination(asset));if(!proof)return null;
 const receiptPath=`reports/clippers-daily-learning/render-receipts/${asset.brandId}__${asset.network}__${asset.account}/${asset.id}/${asset.policyVersion}/${asset.mediaSha256}.json`;
 const render=await read(root,receiptPath,null);if(!render||legacySha(render)!==asset.renderReceiptSha256||render.manifestSha!==proof.manifestSha||render.engineSha256!==proof.engineSha256)return null;
 if(m.postingBand!==band(asset.scheduledAt)||!Array.isArray(render.actualParams.posting_slot)&&typeof render.actualParams.posting_slot!=='string')return null;
 const slots=Array.isArray(render.actualParams.posting_slot)?render.actualParams.posting_slot:[render.actualParams.posting_slot];
 // A band is declared in reviewed evidence before assignment, never fitted to metrics.
 if(!slots.some(s=>s.slice(0,2)+':00'===m.postingBand))return null;
 const readyUntil=Math.min(time(asset.rightsEvidence?.rightsValidUntil),time(asset.rightsEvidence?.rightsObservedAt)+24*HOUR,time(asset.rightsEvidence?.sourcePublishedAt)+72*HOUR);
 if(!(readyUntil>now)||time(asset.rightsEvidence.rightsObservedAt)>now||time(asset.rightsEvidence.sourcePublishedAt)>now||time(asset.scheduledAt)<now+5*60000||time(asset.scheduledAt)>readyUntil)return null;
 return {bandCapacity:slots.filter(s=>s.slice(0,2)+':00'===m.postingBand).length,...scopeOf({...m,destination:findDestination(asset),language:asset.language,renderManifestSha256:proof.manifestSha,renderEngineSha256:proof.engineSha256,postingSlot:m.postingBand}),creatorGroupId:creator.creatorGroupId,channelId:m.channelId,sourceVideoId,sourceEpisodeId:m.sourceEpisodeId??null,sourceSha256:render.sourceSha256,sourceStartSeconds:render.startSeconds,durationSeconds:render.actualParams.duration,readyUntil:iso(readyUntil),readinessReceiptSha256:sha({evidenceSha256:asset.evidenceSha256,renderReceiptSha256:asset.renderReceiptSha256,mediaSha256:asset.mediaSha256,readyUntil:iso(readyUntil)}),rightsObservedAt:asset.rightsEvidence.rightsObservedAt,rightsValidUntil:asset.rightsEvidence.rightsValidUntil,sourcePublishedAt:asset.rightsEvidence.sourcePublishedAt};
}
function validateLedger(v){return v?.schemaVersion===1&&Array.isArray(v.plans)&&v.plans.length<=300&&Array.isArray(v.assignments)&&v.assignments.length<=10000&&Array.isArray(v.preferences)&&v.preferences.length<=32&&Array.isArray(v.transitions)&&v.transitions.length<=300&&v.plans.every(p=>p.sha256===sha(p.manifest))&&v.assignments.every(a=>a.sha256===sha(a.record));}
function samplesFrom(ledger,state,now){
 const samples=[];
 for(const a of ledger.assignments){const r=a.record,plan=ledger.plans.find(p=>p.sha256===r.planSha256)?.manifest;if(!plan)continue;
  const d=state.deliveries.find(d=>d.id===r.deliveryId&&destinationKey(d)===destinationKey(r.meta.destination));
  const verified=!!d&&d.status==='published'&&d.creatorAssignmentSha256===a.sha256&&d.mediaSha256===r.mediaSha256&&d.evidenceSha256===r.evidenceSha256&&d.renderReceiptSha256===r.renderReceiptSha256&&exactPost(d.post?.url,d)?.id===d.post?.id&&Number.isFinite(time(d.post?.verifiedAt))&&time(d.post.verifiedAt)<=now&&time(d.post.publishedAt)>time(plan.registeredAt);
  const observed=verified?state.observations.filter(o=>o.deliveryId===d.id&&canonicalDestinationKey(o.destination)===destinationKey(d)&&o.postId===d.post.id&&o.publishedAt===d.post.publishedAt&&o.window===r.meta.windowHours).sort((a,b)=>time(a.observedAt)-time(b.observedAt))[0]:null;
  // Keep every sealed assigned member, including unknown publication/metrics.
  // Filtering bad members could let a later cohort hide an incomplete old lot.
  samples.push({...r.meta,deliveryId:r.deliveryId,postId:verified?d.post.id:null,publishedAt:verified?d.post.publishedAt:null,observedAt:observed?.observedAt??null,timing:observed?.timing??null,actualAgeHours:observed?(time(observed.observedAt)-time(d.post.publishedAt))/HOUR:null,views:observed?.views??null,completionRate:observed?.completionRate??null,qualityDefinition:'completion_rate',costUsd:verified?d.costUsd:null,elapsedMs:verified?d.elapsedMs:null,evidence:{status:verified&&band(d.post.publishedAt)===r.meta.postingSlot?'ready':'unverified',publicationReceiptSha256:verified?sha({destination:r.meta.destination,post:d.post,metricoolId:d.metricoolId,mediaSha256:d.mediaSha256}):null,renderReceiptSha256:r.renderReceiptSha256,rightsEvidenceSha256:r.evidenceSha256,assignmentSha256:r.planSha256,rightsObservedAt:r.meta.rightsObservedAt,rightsValidUntil:r.meta.rightsValidUntil,sourcePublishedAt:r.meta.sourcePublishedAt},selectionExperiment:{id:plan.id,registeredAt:plan.registeredAt,expiresAt:plan.expiresAt,controlCreatorGroupId:plan.controlCreatorGroupId,challengerCreatorGroupId:plan.challengerCreatorGroupId,arm:r.arm}});
 }
 return samples;
}
/** Called under the learner's existing private writer lock. Only validated ready
 * assets enter this adapter; it rechecks render/evidence bytes and journals each
 * assignment BEFORE provider dispatch. No provider, render, upload or key APIs. */
export async function createClippersCreatorRouting({workspaceRoot,state,readyAssets,now=new Date(),resolveCreator,maxLedgerBytes=8*1024*1024}={}){
 const root=await realpath(workspaceRoot),at=+now;if(!Number.isSafeInteger(maxLedgerBytes)||maxLedgerBytes<512||maxLedgerBytes>8*1024*1024)throw Error('creator_ledger_limit_invalid');if(!Number.isFinite(at)||!Array.isArray(readyAssets)||readyAssets.length>250)throw Error('creator_routing_input_invalid');
 if(!resolveCreator){const catalog=await import('../shared/clippers-priority-creators.mjs');resolveCreator=catalog.resolveCreatorChannel;}
 const dir=path.join(root,ROOT);await mkdir(dir,{recursive:true,mode:0o700});const fd=await open(dir,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await fd.stat();if(!st.isDirectory()||(st.mode&0o077)||(process.getuid&&st.uid!==process.getuid())||await realpath(dir)!==dir)throw Error('creator_private_directory_required');}finally{await fd.close();}
 let ledger=await read(root,ROOT+'/state.json',{schemaVersion:1,plans:[],assignments:[],preferences:[],transitions:[]});if(!validateLedger(ledger))throw Error('creator_routing_ledger_invalid');
 const duplicateIds=new Set(readyAssets.filter((a,i)=>readyAssets.some((b,j)=>i!==j&&assetKey(a)===assetKey(b))).map(assetKey));
 const started=performance.now();const held={},metas=new Map(),groups=new Map();if(duplicateIds.size)held.duplicate_reviewed_asset_id=duplicateIds.size;if(!readyAssets.length)held.no_current_ready_assets=1;
 for(const asset of readyAssets){if(duplicateIds.has(assetKey(asset)))continue;if(performance.now()-started>5000){held.creator_context_time_budget_reached=1;break;}let m;try{m=await metadata(root,asset,at,resolveCreator);}catch{}if(!m){held.reviewed_creator_context_or_render_missing=(held.reviewed_creator_context_or_render_missing??0)+1;continue;}const key=scopeKey(m);metas.set(assetKey(asset),m);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({asset,meta:m});}
 const samples=samplesFrom(ledger,state,at),preferences=[],persistedScopes=new Set(ledger.preferences.map(p=>p.scopeKey));
 for(const [key,rows]of groups){if(!persistedScopes.has(key)&&persistedScopes.size>=32){held.scope_capacity_reached=(held.scope_capacity_reached??0)+1;continue;}persistedScopes.add(key);
  const ready=rows.map(r=>r.meta).sort((a,b)=>time(b.readyUntil)-time(a.readyUntil))[0],prior=ledger.preferences.find(p=>p.scopeKey===key);
  const initial=prior?.originalBaselineCreatorGroupId??rows[0].meta.creatorGroupId;
  let incumbent=initial,preserved=null;
  // Revalidate only the incumbent's immutable original promotion cohorts. A new
  // contender that beat an obsolete baseline cannot displace that incumbent.
  if(prior?.status==='preferred'&&prior.promotionBatchIds?.length===3){
   const proof=selectCreatorPreferences({samples:samples.filter(s=>prior.promotionBatchIds.includes(s.selectionExperiment.id)),contexts:[{...ready,baselineCreatorGroupId:prior.comparedWithCreatorGroupId}],evaluatedAt:iso(at)}).preferences[0];
   if(proof.status==='preferred'&&proof.preferredCreatorGroupId===prior.preferredCreatorGroupId){incumbent=prior.preferredCreatorGroupId;preserved=proof;}
  }
  const result=selectCreatorPreferences({samples,contexts:[{...ready,baselineCreatorGroupId:incumbent}],previousPreferences:prior?[prior]:[],evaluatedAt:iso(at)}).preferences[0];
  let decision=result.status==='preferred'?result:preserved??result;
  if(ready.bandCapacity<2){held.creator_band_capacity_insufficient=(held.creator_band_capacity_insufficient??0)+1;decision={...result,status:'unmeasured',preferredCreatorGroupId:initial,reason:'multiple_approved_slots_in_band_required',expiresAt:null};}
  const selected={...decision,originalBaselineCreatorGroupId:initial,comparedWithCreatorGroupId:decision.baselineCreatorGroupId,promotionBatchIds:decision.status==='preferred'?decision.candidates.find(c=>c.creatorGroupId===decision.preferredCreatorGroupId&&c.qualified)?.batches.map(b=>b.id)??[]:[],scopeKey:key};
  preferences.push(selected);
  if(prior?.preferredCreatorGroupId!==selected.preferredCreatorGroupId||prior?.status!==selected.status){if(ledger.transitions.length>=300)throw Error('creator_transition_capacity');const t={at:iso(at),scopeKey:key,from:prior?.preferredCreatorGroupId??initial,to:selected.preferredCreatorGroupId,reason:selected.reason,evidenceSha256:selected.inputSha256,expiresAt:selected.expiresAt};ledger.transitions.push({...t,sha256:sha(t)});}
  const lastAttempt=id=>Math.max(0,...ledger.plans.filter(p=>[p.manifest.controlCreatorGroupId,p.manifest.challengerCreatorGroupId].includes(id)&&p.manifest.scopeKey===key).map(p=>time(p.manifest.registeredAt)));
  const challenger=[...new Set(rows.map(r=>r.meta.creatorGroupId))].filter(id=>id!==selected.preferredCreatorGroupId).sort((a,b)=>lastAttempt(a)-lastAttempt(b)||a.localeCompare(b))[0];
  const active=ledger.plans.filter(p=>p.manifest.scopeKey===key&&p.manifest.controlCreatorGroupId===selected.preferredCreatorGroupId&&time(p.manifest.expiresAt)>at);
  if(ready.bandCapacity>=2&&challenger&&active.length===0&&ledger.plans.length<=297){for(let i=0;i<3;i++){const manifest={schemaVersion:1,id:randomUUID(),scopeKey:key,scope:scopeOf(ready),registeredAt:iso(at),expiresAt:iso(at+720*HOUR),controlCreatorGroupId:selected.preferredCreatorGroupId,challengerCreatorGroupId:challenger,armCapacity:5,timezone:'America/New_York',postingBandWidthMinutes:60};ledger.plans.push({manifest,sha256:sha(manifest)});}}
 }
 ledger.preferences=[...ledger.preferences.filter(p=>!groups.has(p.scopeKey)),...preferences];await save(root,ROOT+'/state.json',ledger,maxLedgerBytes);
 const report={schemaVersion:1,evaluatedAt:iso(at),paidSpendUsd:0,allowedUse:'ready_asset_order_only',contexts:preferences.length,assigned:ledger.assignments.length,heldReasons:Object.keys(held),heldCounts:held,preferences:preferences.map(p=>({scopeKey:p.scopeKey,destination:p.scope.destination,language:p.scope.language,format:p.scope.format,context:p.scope.context,postingBand:p.scope.postingSlot,timezone:'America/New_York',windowHours:p.scope.windowHours,baselineCreatorGroupId:p.baselineCreatorGroupId,preferredCreatorGroupId:p.preferredCreatorGroupId,status:p.status,reason:p.reason,eligibleSamples:p.eligibleSamples,expiresAt:p.expiresAt,evidenceSha256:p.inputSha256}))};
 await save(root,ROOT+'/latest.json',report);
 return {report,
  async flush(){report.assigned=ledger.assignments.length;await save(root,ROOT+'/latest.json',report);return report;},
  order(assets){
   const ordered=[...assets],positions=new Map();
   for(let i=0;i<assets.length;i++){const m=metas.get(assetKey(assets[i]));if(!m)continue;const key=scopeKey(m);if(!positions.has(key))positions.set(key,[]);positions.get(key).push(i);}
   for(const [key,indexes]of positions){const preference=preferences.find(p=>p.scopeKey===key),rows=indexes.map(i=>assets[i]);
    if(preference?.status==='preferred'&&time(preference.expiresAt)>at)rows.sort((a,b)=>Number(metas.get(assetKey(b)).creatorGroupId===preference.preferredCreatorGroupId)-Number(metas.get(assetKey(a)).creatorGroupId===preference.preferredCreatorGroupId));
    const pending=ledger.plans.find(p=>p.manifest.scopeKey===key&&time(p.manifest.expiresAt)>at&&p.manifest.controlCreatorGroupId===preference?.preferredCreatorGroupId&&ledger.assignments.filter(a=>a.record.planSha256===p.sha256&&a.record.arm==='challenger').length<5);
    if(pending){const index=rows.findIndex(a=>metas.get(assetKey(a)).creatorGroupId===pending.manifest.challengerCreatorGroupId);if(index>0)rows.unshift(...rows.splice(index,1));}
    indexes.forEach((index,i)=>{ordered[index]=rows[i];});
   }
   return ordered;
  },
  async assign(asset){const m=metas.get(assetKey(asset));if(!m)return null;const existing=ledger.assignments.find(a=>a.record.deliveryId===asset.id&&destinationKey(a.record.meta.destination)===destinationKey(asset));if(existing)return existing.sha256;
   if(ledger.assignments.length>=10000)throw Error('creator_assignment_capacity');
   if(ledger.assignments.some(a=>a.record.meta.sourceSha256===m.sourceSha256||a.record.meta.sourceVideoId===m.sourceVideoId||(m.sourceEpisodeId&&a.record.meta.sourceEpisodeId===m.sourceEpisodeId)))return null;
   const available=ledger.plans.filter(p=>p.manifest.scopeKey===scopeKey(m)&&time(p.manifest.expiresAt)>at&&[p.manifest.controlCreatorGroupId,p.manifest.challengerCreatorGroupId].includes(m.creatorGroupId));
   const candidates=available.map(p=>{const arm=m.creatorGroupId===p.manifest.controlCreatorGroupId?'control':'challenger';return {p,arm,count:ledger.assignments.filter(a=>a.record.planSha256===p.sha256&&a.record.arm===arm).length};}).filter(p=>p.count<5).sort((a,b)=>a.count-b.count||a.p.manifest.id.localeCompare(b.p.manifest.id));
   if(!candidates.length)return null;const {p,arm}=candidates[0];const record={deliveryId:asset.id,assignedAt:iso(at),planSha256:p.sha256,arm,meta:m,mediaSha256:asset.mediaSha256,evidenceSha256:asset.evidenceSha256,renderReceiptSha256:asset.renderReceiptSha256};const assignment={record,sha256:sha(record)};const next={...ledger,assignments:[...ledger.assignments,assignment]};await save(root,ROOT+'/state.json',next,maxLedgerBytes);ledger=next;return assignment.sha256;
  }};
}
