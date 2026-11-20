import { verifiedExternalSchedules } from './clippers-native-media-receipts.mjs';
// Read-only projection of the installed pipeline's private receipts. No provider, rights or publishing API.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DESTINATIONS, destinationKey, findDestination, exactPost, localDay, canonicalDestinationKey } from './clippers-portfolio-metricool.mjs';
import { readPortfolioRenderManifest } from './clippers-portfolio-render.mjs';
import { ALL_DISCOVERY_CREATORS, KNOWN_CREATOR_GROUPS } from '../shared/clippers-priority-creators.mjs';
import { buildViralScout } from '../shared/clippers-viral-scout.mjs';
const HOUR=3600000, SHA=/^[a-f0-9]{64}$/, ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const objectRow=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const n=value=>Number.isSafeInteger(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER?value:null;
const time=(v,now)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v&&Date.parse(v)<=now?v:null;
const codes=value=>Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,200}$/.test(v)))].slice(0,100):[];
const NY_CLOCK=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const total=(rows,field)=>rows.every(row=>n(row[field])!==null)?rows.reduce((sum,row)=>sum+row[field],0):null;
const emptyCareer=()=>({registered:false,generation:null,points:null,battery:null,inTraining:false,hiredAt:null,skillIds:[],lastEvidenceId:null});
export async function privateOrchestraJson(root,relative,maxBytes=25_000_000){
  const file=path.join(root,relative);let fd;
  try{
    if(await realpath(path.dirname(file))!==path.dirname(file))throw Error('private_parent_required');
    fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));const stat=await fd.stat();
    if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid())||stat.size>maxBytes)throw Error('private_file_required');
    const chunks=[];let bytes=0;const buffer=Buffer.alloc(Math.min(65536,maxBytes+1));
    for(;;){const length=Math.min(buffer.length,maxBytes+1-bytes);if(length<1)throw Error('private_file_too_large');const read=await fd.read(buffer,0,length,null);if(!read.bytesRead)break;bytes+=read.bytesRead;if(bytes>maxBytes)throw Error('private_file_too_large');chunks.push(Buffer.from(buffer.subarray(0,read.bytesRead)));}
    const raw=Buffer.concat(chunks,bytes).toString('utf8');return {value:JSON.parse(raw),sha:hash(raw),error:null};
  }catch(error){return {value:null,sha:null,error:error.code==='ENOENT'?'report_missing':'report_unreadable'};}
  finally{await fd?.close();}
}
function nextDaily(at,hour){
  if(!Number.isInteger(hour)||hour<0||hour>23)return null;
  // Match the installed watchdog's New York clock, including DST.
  for(let hours=1;hours<=48;hours++){
    const date=new Date(Math.floor(at/HOUR)*HOUR+hours*HOUR);
    const parts=Object.fromEntries(NY_CLOCK.formatToParts(date).map(p=>[p.type,p.value]));
    if(Number(parts.hour)===hour&&parts.minute==='00')return date.toISOString();
  }
  return null;
}
function metricRows(state,now){
  if(!state)return [];
  const deliveries=new Map(state.deliveries.filter(d=>findDestination(d)&&exactPost(d.post?.url,d)?.id===d.post?.id).map(d=>[`${destinationKey(d)}:${d.id}`,d]));
  const seen=new Set();return state.observations.filter(m=>{
    const d=deliveries.get(`${m.destination}:${m.deliveryId}`), observed=time(m.observedAt,now),published=time(m.publishedAt,now);
    const age=observed&&published?(Date.parse(observed)-Date.parse(published))/HOUR:NaN;
    const key=`${m.destination}:${m.postId}:${m.window}`;
    if(!d||d.post.id!==m.postId||d.post.publishedAt!==published||!observed||![24,72,168].includes(m.window)||age<m.window||age>=m.window+24||n(m.views)===null||seen.has(key))return false;
    seen.add(key);return true;
  });
}
function ageBuckets(metrics,key){
  return [24,72,168].flatMap(window=>{
    const rows=metrics.filter(m=>m.destination===key&&m.window===window);if(!rows.length)return [];
    const ages=rows.map(m=>(Date.parse(m.observedAt)-Date.parse(m.publishedAt))/HOUR);
    return [{windowHours:window,samples:rows.length,actualAgeHoursMin:Math.min(...ages),actualAgeHoursMax:Math.max(...ages),latestObservedAt:rows.map(m=>m.observedAt).sort().at(-1),views:rows.reduce((s,m)=>s+m.views,0),likes:total(rows,'likes'),comments:total(rows,'comments'),shares:total(rows,'shares')}];
  });
}
function discoveryView(receipts,now){
  const safe=receipts.filter(r=>[1,2].includes(r?.schemaVersion)&&r.paidSpendUsd===0&&r.mayPublish===false&&r.permission==='unknown'&&time(r.observedAt,now)&&Array.isArray(r.feeds)&&r.feeds.length<=(r.schemaVersion===2?14:4)&&Array.isArray(r.observations)&&r.observations.length<=(r.schemaVersion===2?350:100));
  const observations=[...new Map(safe.flatMap(r=>r.observations).filter(o=>ALL_DISCOVERY_CREATORS.some(c=>c.id===o.creatorId&&c.channelId===o.channelId)&&/^[A-Za-z0-9_-]{11}$/.test(o.videoId??'')&&time(o.observedAt,now)&&time(o.publishedAt,now)&&Date.parse(o.publishedAt)<=Date.parse(o.observedAt)).map(o=>[`${o.channelId}:${o.videoId}:${o.observedAt}`,o])).values()];
  const sources=ALL_DISCOVERY_CREATORS.map(c=>{
    const candidate=safe.flatMap(r=>r.feeds.filter(f=>f.creatorId===c.id&&f.channelId===c.channelId).map(feed=>({feed,observedAt:time(feed.observedAt,now)??(r.schemaVersion===1?r.observedAt:null)}))).sort((a,b)=>(a.observedAt??'').localeCompare(b.observedAt??'')).at(-1);
    const feed=candidate?.feed;
    return {creatorId:c.id,channelId:c.channelId,observedAt:candidate?.observedAt??null,status:feed?.status==='observed'&&candidate.observedAt?'observed':feed?'unavailable':'not_observed',heldReasons:feed?.status==='observed'&&candidate.observedAt?[]:[feed&&/^[a-z][a-z0-9_]{1,80}$/.test(feed.reason??'')?feed.reason:'source_not_observed'],observations:observations.filter(o=>o.creatorId===c.id).length};
  });
  const byVideo=new Map();
  for(const o of observations){const k=`${o.channelId}:${o.videoId}`,rows=byVideo.get(k)??[];if(!rows.some(r=>r.observedAt===o.observedAt))rows.push(o);byVideo.set(k,rows);}
  const signals=[...byVideo.values()].map(rows=>{
    rows.sort((a,b)=>a.observedAt.localeCompare(b.observedAt));const latest=rows.at(-1),prior=rows.slice(0,-1).filter(o=>o.metricEvidence==='direct_public_feed'&&n(o.views)!==null&&o.publishedAt===latest.publishedAt&&Date.parse(o.observedAt)<=Date.parse(latest.observedAt)-HOUR).at(-1);
    const views=latest.metricEvidence==='direct_public_feed'?n(latest.views):null,previousViews=prior?n(prior.views):null;
    const paired=views!==null&&previousViews!==null&&Date.parse(latest.observedAt)>Date.parse(prior.observedAt)&&now-Date.parse(latest.observedAt)<=72*HOUR&&now-Date.parse(prior.observedAt)<=72*HOUR;
    const growth=paired?views-previousViews:null;
    return {creatorId:latest.creatorId,videoId:latest.videoId,publishedAt:latest.publishedAt,observedAt:latest.observedAt,views,previousObservedAt:prior?.observedAt??null,previousViews,growthViews:growth,growthPerHour:paired?growth/((Date.parse(latest.observedAt)-Date.parse(prior.observedAt))/HOUR):null,label:now-Date.parse(latest.publishedAt)>72*HOUR?'stale_reference':paired&&growth>0?'paired_growth_observed':views===null?'insufficient_metrics':'initial_baseline',rights:'unknown'};
  }).sort((a,b)=>b.observedAt.localeCompare(a.observedAt)).slice(0,200);
  return {sources,observations:safe.length?observations.length:null,eligibleAssets:safe.length?0:null,rotationSize:14,rotationDays:1,catalogVersion:2,signals,scout:buildViralScout(safe,new Date(now)),rightsPolicy:'owner_review_required'};
}
function creatorSelectionView(raw,now){
 const missing={evaluatedAt:null,contexts:0,assigned:null,heldReasons:['creator_selection_report_unavailable'],preferences:[]};
 if(raw?.schemaVersion!==1||raw.paidSpendUsd!==0||raw.allowedUse!=='ready_asset_order_only'||!time(raw.evaluatedAt,now)||!Array.isArray(raw.preferences)||raw.preferences.length>32||(raw.assigned!==null&&n(raw.assigned)===null))return missing;
 const groups=new Set(KNOWN_CREATOR_GROUPS.map(g=>g.id));
 const preferences=[];
 for(const p of raw.preferences){
  if(!SHA.test(p.scopeKey??'')||!SHA.test(p.evidenceSha256??'')||!findDestination(p.destination)||!groups.has(p.baselineCreatorGroupId)||!groups.has(p.preferredCreatorGroupId)||!['preferred','baseline','unmeasured'].includes(p.status)||!ID.test(p.reason??'')||!ID.test(p.format??'')||!ID.test(p.context??'')||!ID.test(p.language??'')||p.timezone!=='America/New_York'||!/^(?:[01]\d|2[0-3]):00$/.test(p.postingBand??'')||![24,72,168].includes(p.windowHours)||n(p.eligibleSamples)===null)return missing;
  let status=p.status,reason=p.reason,preferredCreatorGroupId=p.preferredCreatorGroupId;
  if(status==='preferred'&&(!time(p.expiresAt,now+24*HOUR)||Date.parse(p.expiresAt)<=now||p.eligibleSamples<30)){status='baseline';reason='creator_preference_expired';preferredCreatorGroupId=p.baselineCreatorGroupId;}
  preferences.push({scopeKey:p.scopeKey,destination:findDestination(p.destination),language:p.language,format:p.format,context:p.context,postingBand:p.postingBand,timezone:p.timezone,windowHours:p.windowHours,baselineCreatorGroupId:p.baselineCreatorGroupId,preferredCreatorGroupId,status,reason,eligibleSamples:p.eligibleSamples,expiresAt:time(p.expiresAt,now+24*HOUR)??null,evidenceSha256:p.evidenceSha256});
 }
 return {evaluatedAt:raw.evaluatedAt,contexts:preferences.length,assigned:raw.assigned,heldReasons:codes(raw.heldReasons),preferences};
}
async function verifiedRenderBinding(root,delivery,cache,media=[],at=Date.now()){
  if(!findDestination(delivery)||!ID.test(delivery.id??'')||!ID.test(delivery.policyVersion??'')||!SHA.test(delivery.mediaSha256??''))return {verified:false};
  const key=destinationKey(delivery),cacheKey=`${key}:${delivery.id}:${delivery.policyVersion}:${delivery.mediaSha256}`;
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const relative=`reports/clippers-daily-learning/render-receipts/${key.replaceAll(':','__')}/${delivery.id}/${delivery.policyVersion}/${delivery.mediaSha256}.json`;
  const [{value:r},{value:request},manifest]=await Promise.all([
    privateOrchestraJson(root,relative,200000),privateOrchestraJson(root,`config/clippers-daily-learning/render-requests/${delivery.id}.json`,200000),
    readPortfolioRenderManifest(root,delivery,delivery.policyVersion).catch(()=>null),
  ]);
  let comparisonBound=true;
  if(delivery.experiment){
    const e=delivery.experiment;
    const [base,candidate]=await Promise.all([readPortfolioRenderManifest(root,delivery,e.baselineVersion).catch(()=>null),readPortfolioRenderManifest(root,delivery,e.candidateVersion).catch(()=>null)]);
    const differences=base&&candidate?['hook','duration','crop','caption_layout','posting_slot'].filter(k=>digest(base.params[k])!==digest(candidate.params[k])):[];
    comparisonBound=!!base&&!!candidate&&differences.length===1&&differences[0]===e.variable&&
      r?.comparison?.baselineManifestSha===base.sha&&r?.comparison?.candidateManifestSha===candidate.sha&&r?.comparison?.variable===e.variable&&
      delivery.policyVersion===(e.arm==='control'?e.baselineVersion:e.arm==='candidate'?e.candidateVersion:null);
  }
  // Only the immutable, originally verified receipt boundary is inspected here;
  // no rendering or media upload is attempted by a reporting poll.
  const match=media.find(m=>findDestination(m)&&destinationKey(m)===key&&m.campaignId===delivery.campaignId&&m.sha256===delivery.mediaSha256&&m.draftFile===r?.draftFile&&m.renderReceiptSha256===digest(r)&&m.status==='ready'&&m.paidSpendAllowed===false);
  const proof=delivery.renderProof;
  const yes=comparisonBound&&!!match&&!!r&&!!request&&!!manifest&&time(r.renderedAt,at)&&SHA.test(r.sourceSha256??'')&&Number.isFinite(request.sourceStartSeconds)&&request.sourceStartSeconds>=0&&Number.isFinite(r.actualParams?.hook)&&r.requestId===delivery.id&&r.outputSha256===delivery.mediaSha256&&r.version===delivery.policyVersion&&r.costUsd===0&&
    findDestination(r.destination)&&destinationKey(r.destination)===key&&SHA.test(r.engineSha256??'')&&r.engineSha256===manifest.engineSha256&&r.manifestSha===manifest.sha&&digest(r.actualParams)===digest(manifest.params)&&
    (proof?proof.manifestSha===r.manifestSha&&proof.engineSha256===r.engineSha256&&digest(proof.comparison??null)===digest(r.comparison??null):delivery.renderReceiptSha256===digest(r)&&delivery.draftFile===r.draftFile)&&
    r.renderRequestSha256===digest(request)&&r.sourceSha256===request.sourceSha256&&r.startSeconds===request.sourceStartSeconds+r.actualParams?.hook&&
    r.captionTextSha256===hash(typeof request.captionText==='string'?request.captionText:'')&&digest(r.experiment??null)===digest(delivery.experiment??null)&&
    findDestination(request)&&destinationKey(request)===key&&request.policyVersion===delivery.policyVersion;
  const result={verified:yes,receiptSha256:yes?digest(r):null,renderedAt:yes?r.renderedAt:null};
  cache.set(cacheKey,result);return result;
}
function median(rows){const a=[...rows].sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;}
async function comparisonsView(root,state,metrics,now,media){
  if(!state)return {comparisons:[],qualifications:[]};
  const groups=new Map(),cache=new Map(),byDelivery=new Map();
  for(const m of metrics){const k=`${m.destination}:${m.deliveryId}`,rows=byDelivery.get(k)??[];rows.push(m);byDelivery.set(k,rows);}
  for(const d of state.deliveries){
    if(!findDestination(d)||!d.experiment||!ID.test(d.experiment.id??'')||!ID.test(d.experiment.baselineVersion??'')||!ID.test(d.experiment.candidateVersion??'')||!['hook','duration','caption_layout','crop','posting_slot'].includes(d.experiment.variable))continue;
    const e=d.experiment,key=destinationKey(d),k=JSON.stringify([key,e.id,e.context,d.creator,d.language,e.variable,e.baselineVersion,e.candidateVersion]);
    const group=groups.get(k)??{key,e,deliveries:[]};group.deliveries.push(d);groups.set(k,group);
  }
  const result=[],details=[];
  for(const [raw,g] of [...groups].slice(0,100)){
    let current=(state.versions[g.key]??'baseline-1')===g.e.baselineVersion;
    const own=new Map(g.deliveries.map(d=>[d.id,d]));
    const rows=g.deliveries.flatMap(d=>byDelivery.get(`${g.key}:${d.id}`)??[]);
    const byAge=new Map();
    for(const m of rows){
      if(m.timing!=='provider_observation_time'||typeof m.completionRate!=='number'||m.completionRate<0||m.completionRate>1)continue;
      const k=`${m.window}:${Math.floor((Date.parse(m.observedAt)-Date.parse(m.publishedAt))/HOUR)}`,items=byAge.get(k)??[];items.push(m);byAge.set(k,items);
    }
    let chosen=null;
    for(const sample of byAge.values()){
      const control=sample.filter(m=>own.get(m.deliveryId)?.experiment.arm==='control'),candidate=sample.filter(m=>own.get(m.deliveryId)?.experiment.arm==='candidate');
      if(!chosen||Math.min(control.length,candidate.length)>Math.min(chosen.control.length,chosen.candidate.length))chosen={control,candidate};
    }
    const control=chosen?.control??[],candidate=chosen?.candidate??[];
    if([...control,...candidate].some(m=>now-Date.parse(m.observedAt)>7*24*HOUR))current=false;
    const controlViews=median(control.map(m=>m.views)),candidateViews=median(candidate.map(m=>m.views));
    const improvement=controlViews>0&&candidateViews!==null?(candidateViews-controlViews)/controlViews:null;
    const relevant=g.deliveries.filter(d=>[...control,...candidate].some(m=>m.deliveryId===d.id));
    const renderVerified=relevant.length>0&&(await Promise.all(relevant.map(d=>verifiedRenderBinding(root,d,cache,media,now)))).every(r=>r?.verified===true);
    const unique=new Set([...control,...candidate].map(m=>m.postId)).size===control.length+candidate.length;
    const guard=control.length>=5&&candidate.length>=5&&unique&&improvement!==null&&improvement+Number.EPSILON>=0.2&&median(candidate.map(m=>m.completionRate))>=median(control.map(m=>m.completionRate))&&
      relevant.every(d=>d.costUsd===0&&typeof d.elapsedMs==='number'&&Number.isFinite(d.elapsedMs)&&d.elapsedMs>=0)&&
      median(relevant.filter(d=>d.experiment.arm==='candidate').map(d=>d.elapsedMs))<=median(relevant.filter(d=>d.experiment.arm==='control').map(d=>d.elapsedMs));
    const reasons=[];if(!current)reasons.push('comparison_not_current');if(!renderVerified)reasons.push('render_receipt_unverified');if(control.length<5||candidate.length<5)reasons.push('five_samples_per_arm_required');if(!guard)reasons.push('quality_cost_time_or_view_guard_not_met');
    const qualityImproved=median(candidate.map(m=>m.completionRate))>median(control.map(m=>m.completionRate));
    details.push({id:digest(raw),key:g.key,baseline:g.e.baselineVersion,candidate:g.e.candidateVersion,experiment:g.e.id,qualityImproved,posts:[...control,...candidate].map(m=>m.postId),manifests:relevant.map(d=>JSON.stringify(d.renderProof?.comparison??null)),eligible:current&&renderVerified&&guard});
    result.push({id:digest(raw),destination:g.key,variable:g.e.variable,baselineVersion:g.e.baselineVersion,candidateVersion:g.e.candidateVersion,controlSamples:control.length,candidateSamples:candidate.length,improvementRatio:improvement,current,renderReceiptVerified:renderVerified,eligible:current&&renderVerified&&guard,heldReasons:reasons});
  }
  const qualifications=[],byVersion=new Map();
  for(const d of details.filter(d=>d.eligible&&new Set(d.manifests).size===1)){
    const key=JSON.stringify([d.key,d.baseline,d.candidate,d.manifests[0]]),rows=byVersion.get(key)??[];rows.push(d);byVersion.set(key,rows);
  }
  for(const [key,rows] of byVersion){
    const byExperiment=new Map();for(const row of rows)if(!byExperiment.has(row.experiment)||row.qualityImproved)byExperiment.set(row.experiment,row);
    const unique=[...byExperiment.values()].sort((a,b)=>Number(b.qualityImproved)-Number(a.qualityImproved)).slice(0,3);
    const posts=unique.flatMap(r=>r.posts);
    if(unique.length===3&&unique.filter(r=>r.qualityImproved).length>=2&&new Set(posts).size===posts.length)qualifications.push({id:digest([key,unique.map(r=>r.id).sort()]),comparisons:unique.map(r=>r.id)});
  }
  return {comparisons:result,qualifications};
}

export async function buildClippersOrchestraReport({workspaceRoot,now=new Date()}={}){
  const at=+now;if(!Number.isFinite(at)||!workspaceRoot||!path.isAbsolute(workspaceRoot))throw Error('orchestra_configuration_invalid');
  const root=await realpath(workspaceRoot);
  const files={external:'reports/clippers-daily-learning/external-schedules.json',watchdog:'reports/clippers-daily-watchdog/latest.json',learning:'reports/clippers-daily-learning/latest.json',state:'reports/clippers-daily-learning/state.json',prepare:'reports/clippers-daily-learning/prepare-latest.json',media:'reports/clippers-daily-learning/portfolio-media-receipts.json',input:'config/clippers-daily-learning/approved-input.json',accountAnalytics:'reports/clippers-account-analytics/latest.json',creatorSelection:'reports/clippers-creator-selection/latest.json'};
  const caps={external:2097152,watchdog:1048576,learning:2097152,state:25000000,prepare:262144,media:5242880,input:2097152,accountAnalytics:524288,creatorSelection:262144};
  const entries=await Promise.all(Object.entries(files).map(async([k,file])=>[k,await privateOrchestraJson(root,file,caps[k])]));
  const artifacts=Object.fromEntries(entries),wd=artifacts.watchdog.value,report=artifacts.learning.value,prep=artifacts.prepare.value;
  const rawState=artifacts.state.value,state=rawState?.schemaVersion===1&&Array.isArray(rawState.deliveries)&&rawState.deliveries.length<=2000&&Array.isArray(rawState.observations)&&rawState.observations.length<=20000&&Array.isArray(rawState.history)&&rawState.history.length<=1000&&rawState.versions&&typeof rawState.versions==='object'?rawState:null;
  let discoveryFiles=[];
  try{
    const directory=path.join(root,'portfolio-discovery');if(await realpath(directory)!==directory)throw Error();
    const names=await readdir(directory),today=new Date(at).toISOString().slice(0,10);
    const legacy=names.filter(v=>/^\d{4}-\d\d-\d\d-[a-f0-9]{16}\.json$/.test(v)&&Date.parse(v.slice(0,10)+'T00:00:00Z')>=at-14*24*HOUR&&v.slice(0,10)<=today).sort().slice(-32);
    const channel=names.filter(v=>/^\d{4}-\d\d-\d\d-channel-UC[A-Za-z0-9_-]{22}\.json$/.test(v)&&v.slice(0,10)<=today&&Date.parse(v.slice(0,10)+'T00:00:00Z')>=Date.parse(today+'T00:00:00Z')-2*24*HOUR&&ALL_DISCOVERY_CREATORS.some(c=>v.endsWith('-'+c.channelId+'.json'))).sort().slice(-ALL_DISCOVERY_CREATORS.length*3);
    discoveryFiles=[...legacy.map(file=>({file,channel:false})),...channel.map(file=>({file,channel:true}))];
  }catch{}
  const discoveryReceipts=await Promise.all(discoveryFiles.map(async({file,channel})=>{
    const r=await privateOrchestraJson(root,`portfolio-discovery/${file}`,channel?131072:524288);
    // A malformed optional source row cannot suppress the entire telemetry report.
    if(objectRow(r.value)&&Array.isArray(r.value.feeds)&&Array.isArray(r.value.observations)){
      r.value={...r.value,feeds:r.value.feeds.filter(objectRow),observations:r.value.observations.filter(objectRow)};
    }
    if(channel&&r.value?.schemaVersion===2&&time(r.value.observedAt,at)&&Array.isArray(r.value.feeds)&&r.value.feeds.length===1){
      r.value={...r.value,feeds:r.value.feeds.map(f=>({...f,observedAt:f.status==='observed'?r.value.observedAt:null}))};
    }
    return r;
  }));
  const discovery=discoveryView(discoveryReceipts.map(r=>r.value),at),metrics=metricRows(state,at);
  const weeklyReceipts=(state?.deliveries??[]).filter(d=>objectRow(d)&&typeof d.weeklyWindow==='string'&&findDestination(d)&&['scheduled','published'].includes(d.status)&&typeof d.metricoolId==='string'&&ID.test(d.metricoolId)&&time(d.scheduledAt,Infinity)&&
    objectRow(d.scheduleEvidence)&&typeof d.scheduleEvidence.mediaUrl==='string'&&SHA.test(d.scheduleEvidenceSha256??'')&&digest(d.scheduleEvidence)===d.scheduleEvidenceSha256&&d.scheduleEvidence.id===d.metricoolId&&
    findDestination(d.scheduleEvidence.destination)&&destinationKey(d.scheduleEvidence.destination)===destinationKey(d)&&d.scheduleEvidence.scheduledAt===d.scheduledAt&&
    d.scheduleEvidence.mediaUrl===d.verifiedSchedulerMediaUrl&&time(d.scheduleEvidence.confirmedAt,at));
  const external=verifiedExternalSchedules(artifacts.external.value,now,{strict:false});
  const externalAt=external.map(r=>r.observedAt).sort().at(-1)??null;
  const weeklyAt=weeklyReceipts.map(d=>time(d.scheduleEvidence.confirmedAt,at)).sort().at(-1)??null;
  const media=Array.isArray(artifacts.media.value)?artifacts.media.value:[];
  const {comparisons,qualifications}=await comparisonsView(root,state,metrics,at,media);
  const reportAt=time(report?.generatedAt,at),watchdogAt=time(wd?.generatedAt,at),prepareAt=time(prep?.generatedAt,at);
  const rawAnalytics=artifacts.accountAnalytics.value;
  const analytics=time(rawAnalytics?.generatedAt,at)&&rawAnalytics?.schemaVersion===1&&rawAnalytics.paidSpendUsd===0&&rawAnalytics.readOnly===true&&Array.isArray(rawAnalytics.accounts)&&rawAnalytics.accounts.length===4&&new Set(rawAnalytics.accounts.filter(findDestination).map(destinationKey)).size===4?rawAnalytics:null;
  const analyticsAt=analytics?.generatedAt??null;
  const discoveryAt=discovery.sources.map(s=>s.observedAt).filter(Boolean).sort().at(-1)??null;
  const evidenceAt=[reportAt,watchdogAt,prepareAt,discoveryAt,analyticsAt,weeklyAt,externalAt].filter(Boolean).sort().at(-1)??null;
  const age=evidenceAt?(at-Date.parse(evidenceAt))/60000:null,sourceState=evidenceAt?(age<=26*60?'connected':'stale'):'disconnected';
  const validLearning=report?.schemaVersion===1&&report.paidSpendUsd===0&&reportAt&&report.date===localDay(now)&&Array.isArray(report.destinations)&&report.destinations.length===4&&new Set(report.destinations.filter(d=>findDestination(d)).map(destinationKey)).size===4?report:null;
  const nextDue=watchdogAt?nextDaily(at,wd.checkHour):null;
  const weeklyIsNewer=weeklyAt&&(!reportAt||weeklyAt>reportAt);
  const accounts=DESTINATIONS.map(d=>{
    const key=destinationKey(d);let r=validLearning?.destinations.find(r=>findDestination(r)&&destinationKey(r)===key);
    const own=weeklyReceipts.filter(v=>destinationKey(v)===key&&localDay(new Date(v.scheduledAt))===localDay(now)).sort((a,b)=>a.scheduleEvidence.confirmedAt.localeCompare(b.scheduleEvidence.confirmedAt));
    const latestOwn=own.at(-1);
    if(latestOwn&&(!reportAt||latestOwn.scheduleEvidence.confirmedAt>reportAt)){
      let confirmed=new Set(own.map(v=>v.metricoolId)).size,shortfall=null,blockers=['weekly_day_coverage_unverified'];
      const proof=latestOwn.preflightEvidence;
      if(objectRow(proof)){
        const {sha256,...p}=proof;
        const valid=typeof sha256==='string'&&SHA.test(sha256)&&digest(p)===sha256&&p.source==='fresh_rest_calendar_and_account_analytics'&&
          findDestination(p.destination)&&destinationKey(p.destination)===key&&p.day===localDay(now)&&time(p.observedAt,at)&&p.observedAt<=latestOwn.scheduleEvidence.confirmedAt&&
          Array.isArray(p.scheduled)&&p.scheduled.length<=5&&Array.isArray(p.published)&&p.published.length<=5&&
          p.scheduled.every(v=>objectRow(v)&&typeof v.id==='string'&&ID.test(v.id)&&time(v.scheduledAt,Infinity)&&localDay(new Date(v.scheduledAt))===p.day&&(['pending','scheduled','publishing'].includes(v.status)||(['published','posted'].includes(v.status)&&typeof v.platformPostId==='string'&&/^\d+$/.test(v.platformPostId)&&v.publicationTimeVerified===false)))&&
          (p.calendarPublished===undefined||(Array.isArray(p.calendarPublished)&&p.calendarPublished.length<=5&&p.calendarPublished.every(v=>objectRow(v)&&typeof v.id==='string'&&ID.test(v.id)&&typeof v.platformPostId==='string'&&/^\d+$/.test(v.platformPostId))&&new Set(p.calendarPublished.map(v=>v.id)).size===p.calendarPublished.length&&new Set(p.calendarPublished.map(v=>v.platformPostId)).size===p.calendarPublished.length))&&
          p.published.every(v=>objectRow(v)&&typeof v.id==='string'&&/^\d+$/.test(v.id)&&time(v.publishedAt,Date.parse(p.observedAt))&&localDay(new Date(v.publishedAt))===p.day);
        if(valid){
          const pending=new Set(p.scheduled.filter(v=>!v.platformPostId).map(v=>v.id)),published=new Set([...p.published.map(v=>v.id),...p.scheduled.filter(v=>v.platformPostId).map(v=>v.platformPostId)]);
          const calendarPublished=new Map([...(p.calendarPublished??[]),...p.scheduled.filter(v=>v.platformPostId)].map(v=>[v.id,v.platformPostId]));
          for(const v of (state?.deliveries??[]).filter(v=>findDestination(v)&&destinationKey(v)===key&&['scheduled','published'].includes(v.status)&&ID.test(v.metricoolId??'')&&time(v.scheduledAt,Infinity)&&localDay(new Date(v.scheduledAt))===p.day&&(!v.weeklyWindow||weeklyReceipts.includes(v)))){
            if(calendarPublished.has(v.metricoolId)){pending.delete(v.metricoolId);published.add(calendarPublished.get(v.metricoolId));}else if(v.status==='published'&&exactPost(v.post?.url,v)?.id===v.post?.id&&time(v.post?.publishedAt,at)){pending.delete(v.metricoolId);published.add(v.post.id);}else pending.add(v.metricoolId);
          }
          confirmed=pending.size+published.size;shortfall=Math.max(0,5-confirmed);blockers=confirmed>5?['daily_queue_exceeds_cap']:confirmed===5?[]:r?.blockers??['weekly_queue_partial'];
        }
      }
      r={...r,confirmedScheduledOrPublished:confirmed,shortfall,blockers};
    }
    const externalOwn=external.filter(v=>destinationKey(v.destination)===key&&localDay(new Date(v.scheduledAt))===localDay(now));
    if(externalOwn.length){
      const ownIds=new Set([...own.map(v=>v.metricoolId),...externalOwn.map(v=>v.metricoolId)]);
      const known=Math.max(r?.confirmedScheduledOrPublished??0,ownIds.size);
      r={...r,confirmedScheduledOrPublished:known,shortfall:known>=5?0:null,blockers:known>5?['daily_queue_exceeds_cap']:known===5?[]:['external_observations_partial_coverage_unverified']};
    }
    const buckets=ageBuckets(metrics,key),observedAt=buckets.map(b=>b.latestObservedAt).filter(Boolean).sort().at(-1)??null;
    const v=validLearning?.versions?.find(v=>v.destination===key);
    const measured=analytics?.accounts.find(row=>findDestination(row)&&destinationKey(row)===key);
    const verifiedPosts=(Array.isArray(measured?.posts)?measured.posts:[]).filter(p=>exactPost(p.url,d)?.id===p.id&&time(p.publishedAt,at)&&time(p.observedAt,at)&&Date.parse(p.observedAt)>=Date.parse(p.publishedAt)&&n(p.views)!==null);
    const ages=verifiedPosts.map(p=>(Date.parse(p.observedAt)-Date.parse(p.publishedAt))/HOUR);
    const analyticsStale=measured?.observedAt&&at-Date.parse(measured.observedAt)>26*HOUR;
    const accountAnalysis={status:analyticsStale?'held':measured?.status==='observed'?'observed':measured?'held':'unavailable',observedAt:time(measured?.observedAt,at),posts:measured?.status==='observed'?verifiedPosts.length:null,totalViews:measured?.status==='observed'?verifiedPosts.reduce((sum,p)=>sum+p.views,0):null,actualAgeHoursMin:ages.length?Math.min(...ages):null,actualAgeHoursMax:ages.length?Math.max(...ages):null,heldReasons:[...(analyticsStale?['account_analytics_stale']:[]),...(measured?.reason?codes([measured.reason]):measured?[]:['account_analytics_unavailable'])]};
    const accountObservedAt=[accountAnalysis.observedAt,observedAt].filter(Boolean).sort().at(-1)??null;
    return {key,brandId:String(d.brandId),network:d.network,account:d.account,label:d.network==='facebook'?'Streamers · Facebook':`@${d.account}`,connection:accountObservedAt&&at-Date.parse(accountObservedAt)<=26*HOUR?'observed':'unverified',observedAt:accountObservedAt,dailyTarget:5,eligibleAssets:r?n(r.eligible):null,confirmedScheduledOrPublished:r?n(r.confirmedScheduledOrPublished):null,shortfall:r?n(r.shortfall):null,heldReasons:r?codes(r.blockers):['learning_report_unavailable'],activeVersion:state?String(state.versions[key]??'baseline-1'):null,policyStatus:typeof v?.status==='string'&&/^[a-z_]+$/.test(v.status)?v.status:'policy_unobserved',metricAgeBuckets:buckets,analytics:accountAnalysis};
  });
  const confirmedMedia=Array.isArray(artifacts.media.value)?artifacts.media.value.filter(r=>findDestination(r)&&r.status==='ready'&&r.paidSpendAllowed===false&&SHA.test(r.sha256??'')&&SHA.test(r.renderReceiptSha256??'')):[];
  const eligibleComparisons=state?comparisons.filter(c=>c.eligible).length:null;
  const promotions=state?state.history.filter(h=>h.action==='activate'&&DESTINATIONS.some(d=>destinationKey(d)===canonicalDestinationKey(h.destination))&&SHA.test(h.fromManifestSha??'')&&SHA.test(h.toManifestSha??'')&&time(h.at,at)).length:null;
  const role=(stage,when,artifact,outputs={},held=[])=>({id:`clippers-${stage}`,stage,state:!when?'disconnected':at-Date.parse(when)>26*HOUR?'stale':held.length?'held':Object.values(outputs).some(n=>n>0)?'completed':'idle',evidenceAt:when,activeUntil:null,lastRunAt:when,heartbeatAt:null,nextDueAt:stage==='health'?null:nextDue,runId:artifact?.sha??null,evidenceIds:when&&artifact?.sha?[`clippers:${artifact.sha}:${stage}`]:[],outputs,heldReasons:held,lifePenaltyExempt:true,career:emptyCareer(),outcomes:[]});
  const discoveryArtifact=discoveryReceipts.filter(r=>r.value?.observedAt===discoveryAt).at(-1);
  const queueMetricAt=metrics.map(m=>time(m.capturedAt,at)).filter(Boolean).sort().at(-1)??null;
  const analyticsEvidenceAt=[analyticsAt,queueMetricAt].filter(Boolean).sort().at(-1)??null;
  const recentMetrics=metrics.filter(m=>time(m.capturedAt,at)&&at-Date.parse(m.capturedAt)<=26*HOUR);
  const paired=discovery.signals.filter(s=>s.label==='paired_growth_observed').length;
  const roles=[
    role('supervisor',watchdogAt,artifacts.watchdog,{},watchdogAt?[]:['watchdog_report_unavailable']),
    role('analytics',analyticsEvidenceAt,analyticsEvidenceAt===analyticsAt?artifacts.accountAnalytics:artifacts.state,{storedSnapshots:metrics.length,recentSnapshots:recentMetrics.length,accountsObserved:accounts.filter(a=>a.analytics.status==='observed').length},recentMetrics.length||accounts.some(a=>a.analytics.status==='observed')?[]:['no_verified_metric_observations']),
    role('trends',discoveryAt,discoveryArtifact,{pairedGrowthSignals:paired,...(discovery.scout.status==='no_data'?{}:{researchCandidates:discovery.scout.candidates.length})},paired?[]:['initial_baseline_or_insufficient_metrics']),
    role('streamers',discoveryAt,discoveryArtifact,discovery.observations===null?{}:{observations:discovery.observations},discovery.sources.some(s=>s.status==='observed')?[]:['public_feed_observations_unavailable']),
    role('editor',prepareAt,artifacts.prepare,prepareAt?{prepared:n(prep.prepared)??0,scopedMediaReceipts:confirmedMedia.length}:{},confirmedMedia.length?[]:[prep?.status==='disabled'?'preparation_disabled':'no_reviewed_ready_media']),
    role('checker',prepareAt,artifacts.prepare,prepareAt?{verifiedScopedMedia:confirmedMedia.length}:{},confirmedMedia.length?[]:['rights_or_render_review_required']),
    role('publisher',weeklyIsNewer?weeklyAt:reportAt,weeklyIsNewer?artifacts.state:artifacts.learning,(validLearning||weeklyIsNewer)?{confirmed:accounts.reduce((s,a)=>s+(a.confirmedScheduledOrPublished??0),0),verifiedPublications:weeklyIsNewer?weeklyReceipts.filter(d=>d.status==='published'&&exactPost(d.post?.url,d)?.id===d.post?.id&&time(d.post?.verifiedAt,at)).length:n(validLearning.verifiedPublications)??0}:{},((validLearning||weeklyIsNewer)&&accounts.some(a=>a.confirmedScheduledOrPublished>0))||(weeklyIsNewer&&weeklyReceipts.length)?[]:['no_provider_confirmed_publication_or_schedule']),
    role('learning',reportAt,artifacts.learning,state?{eligibleComparisons:eligibleComparisons,qualifiedCandidates:qualifications.length,promotions}:{},qualifications.length?[]:['three_current_independent_comparisons_required']),
    role('health',watchdogAt,artifacts.watchdog,{},sourceState==='connected'?[]:['runtime_evidence_unavailable_or_stale']),
  ];
  if(externalAt&&(!reportAt||externalAt>reportAt)&&(!weeklyAt||externalAt>weeklyAt)){const p=roles.find(r=>r.stage==='publisher');p.evidenceAt=externalAt;p.lastRunAt=externalAt;p.runId=artifacts.external.sha;p.evidenceIds=[`clippers:${artifacts.external.sha}:publisher`];p.heartbeatAt=null;p.state=at-Date.parse(externalAt)>26*HOUR?'stale':'completed';p.heldReasons=[];p.outputs={confirmed:accounts.reduce((n,a)=>n+(a.confirmedScheduledOrPublished??0),0),externalOwnerUiObservations:external.length};}
  if(weeklyIsNewer&&weeklyReceipts.length)roles.find(r=>r.stage==='publisher').state='completed';
  const outcomes=(stage,items)=>{
    const target=roles.find(r=>r.stage===stage);
    target.outcomes=items.filter(o=>time(o.completedAt,at)).slice(-100);
    target.evidenceIds=[...new Set([...target.evidenceIds,...target.outcomes.map(o=>o.evidenceId)])].slice(-100);
  };
  const outcome=(stage,proof,completedAt,reason)=>{const sha=digest(proof);return {evidenceId:`clippers:${sha}:${stage}`,completedAt,outcome:'verified_deliverable',reason,artifactSha256:sha};};
  outcomes('analytics',[...metrics.map(m=>outcome('analytics',[m.destination,m.key,m.observedAt,m.views,m.completionRate],m.capturedAt,'verified_metric_snapshot')),...accounts.filter(a=>a.analytics.status==='observed'&&a.analytics.posts>0).map(a=>outcome('analytics',[a.key,a.analytics.observedAt,a.analytics.posts,a.analytics.totalViews],a.analytics.observedAt,'verified_metric_snapshot'))]);
  outcomes('publisher',(state?.deliveries??[]).filter(d=>findDestination(d)&&ID.test(d.metricoolId??'')&&['scheduled','published'].includes(d.status)&&(!d.weeklyWindow||weeklyReceipts.includes(d))).map(d=>outcome('publisher',[destinationKey(d),d.metricoolId,d.mediaSha256,d.scheduledAt],d.status==='published'?d.post?.verifiedAt:d.weeklyWindow?d.scheduleEvidence.confirmedAt:d.createdAt,'provider_schedule_or_publication_receipt')));
  outcomes('streamers',discoveryReceipts.flatMap(({value:r})=>r?.schemaVersion===1&&time(r.observedAt,at)&&r.paidSpendUsd===0&&Array.isArray(r.feeds)&&Array.isArray(r.observations)?r.feeds.filter(f=>f.status==='observed'&&(r.schemaVersion===1||time(f.observedAt,at))&&SHA.test(f.feedSha256??'')&&ALL_DISCOVERY_CREATORS.some(c=>c.id===f.creatorId&&c.channelId===f.channelId)&&r.observations.some(o=>o.creatorId===f.creatorId&&time(o.publishedAt,at)&&at-Date.parse(o.publishedAt)<=72*HOUR)).map(f=>outcome('streamers',[f.creatorId,f.feedSha256,time(f.observedAt,at)??(r.schemaVersion===1?r.observedAt:null)],time(f.observedAt,at)??(r.schemaVersion===1?r.observedAt:null),'public_metadata_receipt')):[]));
  outcomes('trends',discovery.signals.filter(s=>s.label==='paired_growth_observed').map(s=>outcome('trends',s,s.observedAt,'paired_public_growth_observation')));
  outcomes('learning',qualifications.map(q=>outcome('learning',q,reportAt,'three_current_verified_comparisons')));
  const renderCache=new Map(),editor=[],checker=[];
  for(const p of Array.isArray(prep?.outcomes)?prep.outcomes.slice(0,20):[]){
    const asset=artifacts.input.value?.assets?.find(a=>a.id===p.id&&findDestination(a)&&findDestination(p.destination)&&destinationKey(a)===destinationKey(p.destination)&&a.renderReceiptSha256===p.renderReceiptSha256);
    if(p.status!=='prepared'||!asset)continue;
    const proof=await verifiedRenderBinding(root,asset,renderCache,media,at);
    if(!proof?.verified)continue;
    editor.push(outcome('editor',[destinationKey(asset),proof.receiptSha256],proof.renderedAt,'verified_render_receipt'));
    checker.push(outcome('checker',[destinationKey(asset),proof.receiptSha256],prepareAt,'reviewed_scoped_media_receipt'));
  }
  outcomes('editor',editor);outcomes('checker',checker);
  const routingAt=time(artifacts.creatorSelection.value?.evaluatedAt,at);
  const rawCreatorSelection=report?.creatorSelection&&reportAt&&(!routingAt||Date.parse(reportAt)>=Date.parse(routingAt))?report.creatorSelection:artifacts.creatorSelection.value;
  const creatorSelection=creatorSelectionView(rawCreatorSelection,at);
  return {version:1,creatorSelection,generatedAt:new Date(at).toISOString(),evidenceAt,sourceFreshness:{state:sourceState,transport:evidenceAt?'local_reports':'unavailable',receivedAt:null,reportedAt:evidenceAt,ageMinutes:age,staleAfterMinutes:26*60,heldReasons:evidenceAt?sourceState==='stale'?['runtime_evidence_stale']:[]:['runtime_reports_unavailable']},transport:{state:'disconnected',lastIngestAt:null,maxAgeMs:90000},disconnectedDestinations:[{brandId:'6595747',label:'New York',reason:'destination_not_connected'}],accounts,roles,discovery,learning:{comparisons,eligibleComparisons,promotions,requiredComparisons:3,minimumPerArm:5,improvementThreshold:0.2,automaticPromotion:false,heldReasons:qualifications.length?['manual_queue_review_required']:['three_current_independent_comparisons_required']},safety:{paidSpendUsd:0,deniedBrandIds:['6431692','6475033','6585226'],metadataDoesNotGrantRights:true,publicUploadRequiresReviewedPacket:true,publicationClaimsRequireProviderReceipt:true}};
}
