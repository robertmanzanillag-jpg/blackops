import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,chmod,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { buildClippersOrchestraReport } from '../script/clippers-orchestra-report.mjs';
import { createClippersOrchestraRelay } from '../script/clippers-orchestra-relay.mjs';
import { collectClippersAccountAnalytics,readOnlyAnalyticsFetch } from '../script/clippers-orchestra-analytics.mjs';
import { DESTINATIONS,destinationKey,createPortfolioMetricool } from '../script/clippers-portfolio-metricool.mjs';
import { DISCOVERY_CREATORS } from '../script/clippers-portfolio-discovery.mjs';
import { parseClippersOrchestraStatus } from '../shared/clippers-orchestra';
import { createClippersOrchestraState,parseClippersEnvelope } from '../server/clippers-orchestra-state';
import { applyClippersReceiptOutcomes } from '../server/clippers-orchestra-life';
import { emptyCompanyState } from '../shared/agent-company';
const NOW=Date.parse('2026-11-18T18:00:00.000Z'),now=()=>new Date(NOW),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const digest=(v:any)=>hash(JSON.stringify(v));
async function fixture(fn:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'clippers-orchestra-test-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
async function save(root:string,file:string,value:any){const full=path.join(root,file);await mkdir(path.dirname(full),{recursive:true,mode:0o700});await writeFile(full,JSON.stringify(value),{mode:0o600});}
const post=(d:any,id='100')=>({id,url:d.network==='tiktok'?`https://www.tiktok.com/@${d.account}/video/${id}`:`https://www.facebook.com/${d.account}/videos/${id}`,publishedAt:new Date(NOW-24*3600000).toISOString(),observedAt:now().toISOString(),views:100,completionRate:.6,timing:'provider_observation_time',actualAgeHours:24});
async function base(root:string){return buildClippersOrchestraReport({workspaceRoot:root,now:now()});}
function memory(){let raw:string|null=null;return {async read(_owner:string){return raw;},async transact(_owner:string,update:any){raw=await update(raw);return raw!;},get raw(){return raw;}};}
const envelope=(report:any,nonce=randomUUID())=>({version:1,nonce,generatedAt:report.generatedAt,report});

test('empty workspace is disconnected, not four fake zero accounts or nine running workers',async()=>fixture(async root=>{
 const r=await base(root);assert.ok(parseClippersOrchestraStatus(r,NOW));assert.equal(r.sourceFreshness.state,'disconnected');assert.equal(r.accounts.length,4);assert.equal(r.disconnectedDestinations[0].brandId,'6595747');
 assert.ok(r.accounts.every((a:any)=>a.eligibleAssets===null&&a.confirmedScheduledOrPublished===null&&a.analytics.status==='unavailable'));
 assert.ok(r.roles.every((a:any)=>a.state==='disconnected'&&a.heartbeatAt===null&&a.activeUntil===null&&!a.career.registered&&a.career.battery===null&&a.outcomes.length===0));
 assert.equal(r.discovery.eligibleAssets,null);assert.equal(r.learning.promotions,null);assert.equal(r.safety.paidSpendUsd,0);
 assert.equal(r.discovery.scout.status,'no_data');assert.equal(Object.hasOwn(r.roles.find((r:any)=>r.stage==='trends').outputs,'researchCandidates'),false);
}));
test('malformed optional feed rows preserve the report and valid source candidates',async()=>fixture(async root=>{
 const {PRIORITY_CREATORS}=await import('../shared/clippers-priority-creators.mjs');const c=PRIORITY_CREATORS[0],sourceUrl=`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`;
 const receipt={schemaVersion:2,day:'2026-11-18',observedAt:now().toISOString(),paidSpendUsd:0,permission:'unknown',mayPublish:false,
  feeds:[null,{creatorId:c.id,channelId:c.channelId,status:'observed',sourceUrl,feedSha256:'a'.repeat(64)}],
  observations:[null,[],{}, {creatorId:c.id,channelId:c.channelId,network:'youtube',videoId:'abcdefghijk',title:'Original public source',url:'https://www.youtube.com/watch?v=abcdefghijk',sourceUrl,publishedAt:'2026-11-18T12:00:00.000Z',observedAt:now().toISOString(),views:100,metricEvidence:'direct_public_feed',permission:'unknown',mayPublish:false}]};
 await save(root,`portfolio-discovery/2026-11-18-channel-${c.channelId}.json`,receipt);
 let r=await base(root);assert.ok(parseClippersOrchestraStatus(r,NOW));assert.equal(r.discovery.scout.candidates.length,1);assert.equal(r.discovery.sources.find((s:any)=>s.creatorId===c.id).status,'observed');
 receipt.observations=[null,[]];await save(root,`portfolio-discovery/2026-11-18-channel-${c.channelId}.json`,receipt);r=await base(root);assert.equal(r.discovery.scout.status,'no_recent_candidates');assert.equal(r.roles.find((r:any)=>r.stage==='trends').outputs.researchCandidates,0);assert.ok(parseClippersOrchestraStatus(r,NOW));
}));
test('private files reject world-readable or symlinked evidence',async()=>fixture(async root=>{
 await save(root,'reports/clippers-daily-watchdog/latest.json',{generatedAt:now().toISOString(),checkHour:10});await chmod(path.join(root,'reports/clippers-daily-watchdog/latest.json'),0o644);
 assert.equal((await base(root)).sourceFreshness.state,'disconnected');
}));
test('actual daily report distinguishes recorded zero supply from missing metrics; no fabricated heartbeats',async()=>fixture(async root=>{
 await save(root,'reports/clippers-daily-learning/state.json',{schemaVersion:1,deliveries:[],observations:[],history:[],versions:{}});
 await save(root,'reports/clippers-daily-learning/latest.json',{schemaVersion:1,date:'2026-11-18',generatedAt:now().toISOString(),paidSpendUsd:0,destinations:DESTINATIONS.map((d:any)=>({...d,eligible:0,confirmedScheduledOrPublished:0,shortfall:5,blockers:['no_current_permissioned_ready_assets']}))});
 await save(root,'reports/clippers-daily-watchdog/latest.json',{generatedAt:now().toISOString(),checkHour:10});
 const r=await base(root);assert.ok(parseClippersOrchestraStatus(r,NOW));assert.ok(r.accounts.every((a:any)=>a.eligibleAssets===0&&a.shortfall===5));assert.equal(r.learning.eligibleComparisons,0);assert.ok(r.roles.every((a:any)=>a.heartbeatAt===null));
 assert.equal(r.roles.find((r:any)=>r.stage==='supervisor').nextDueAt,'2026-11-19T15:00:00.000Z');
}));
async function discovery(root:string,observedAt:string,views:number,file:string){const c=DISCOVERY_CREATORS[0];await save(root,`portfolio-discovery/${file}`,{schemaVersion:1,day:observedAt.slice(0,10),observedAt,paidSpendUsd:0,mayPublish:false,permission:'unknown',feeds:[{creatorId:c.id,channelId:c.channelId,status:'observed',feedSha256:'a'.repeat(64)}],observations:[{creatorId:c.id,channelId:c.channelId,videoId:'abcdefghijk',publishedAt:'2026-11-17T12:00:00.000Z',observedAt,views,metricEvidence:'direct_public_feed'}]});}
test('single public observation is initial baseline; fresh paired actual growth is labeled only observed growth',async()=>fixture(async root=>{
 await discovery(root,'2026-11-18T15:00:00.000Z',100,'2026-11-18-aaaaaaaaaaaaaaaa.json');let r=await base(root);assert.equal(r.discovery.signals[0].label,'initial_baseline');assert.equal(r.discovery.eligibleAssets,0);
 await discovery(root,'2026-11-18T17:00:00.000Z',140,'2026-11-18-bbbbbbbbbbbbbbbb.json');r=await base(root);assert.ok(parseClippersOrchestraStatus(r,NOW));assert.equal(r.discovery.signals[0].label,'paired_growth_observed');assert.equal(r.discovery.signals[0].growthPerHour,20);assert.equal(r.discovery.signals[0].rights,'unknown');assert.equal(r.discovery.sources.length,20);assert.equal(r.discovery.eligibleAssets,0);
 assert.equal(r.roles.find((r:any)=>r.stage==='trends').outcomes.length,1);
}));
test('whole-account collector reads every exact target, never NY/KONG/BlackRoom, then reuses same-day receipt',async()=>fixture(async root=>{
 const called:string[]=[];const adapter={async accountAnalytics(d:any){called.push(destinationKey(d));return {posts:[post(d)],receivedRows:1,rejectedRows:0};}};
 const first=await collectClippersAccountAnalytics({workspaceRoot:root,now:now(),env:{},adapter});assert.equal(first.accounts.length,4);assert.deepEqual(called,DESTINATIONS.map(destinationKey));assert.equal(first.readOnly,true);assert.equal(first.paidSpendUsd,0);
 await collectClippersAccountAnalytics({workspaceRoot:root,now:now(),env:{},adapter});assert.equal(called.length,4);
 const r=await base(root);assert.ok(parseClippersOrchestraStatus(r,NOW));assert.ok(r.accounts.every((a:any)=>a.analytics.posts===1&&a.analytics.totalViews===100&&a.analytics.actualAgeHoursMin===24));assert.equal(r.learning.eligibleComparisons,null);
 assert.equal(r.roles.find((r:any)=>r.stage==='publisher').outcomes.length,0,'analytics never creates publication evidence');
}));
test('collector rejects another account URL and preserves provider read failures as held',async()=>fixture(async root=>{
 const r=await collectClippersAccountAnalytics({workspaceRoot:root,now:now(),env:{},adapter:{async accountAnalytics(d:any){return {posts:[post({...d,account:'not-authorized'})],receivedRows:1,rejectedRows:0};}}});
 assert.ok(r.accounts.every((a:any)=>a.status==='held'&&a.posts.length===0));
}));
test('read-only fetch facade rejects schedule, wrong brand, new host and write MCP tools before network',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response('{}',{status:200});},safe=readOnlyAnalyticsFetch(fetcher,new AbortController().signal);
 for(const [url,init]of [['https://app.metricool.com/api/v2/scheduler/posts',{}],['https://app.metricool.com/api/v2/analytics/posts/tiktok?blogId=6431692',{}],['https://evil.example/api/admin/simpleProfiles',{}],['https://ai.metricool.com/mcp',{method:'POST',body:JSON.stringify({method:'tools/call',params:{name:'createPost',arguments:{}}})}]])await assert.rejects(safe(url,init));
 assert.equal(calls,0);await safe('https://app.metricool.com/api/admin/simpleProfiles');assert.equal(calls,1);
});
test('analytics deadline bounds a hung fake provider and records hold without publishing',async()=>fixture(async root=>{
 const start=performance.now();const r=await collectClippersAccountAnalytics({workspaceRoot:root,now:now(),env:{},maxCycleMs:30,adapter:{accountAnalytics:()=>new Promise(()=>{})}});
 assert.ok(performance.now()-start<1500);assert.ok(r.accounts.every((a:any)=>a.status==='held'));assert.equal(r.paidSpendUsd,0);
}));
test('adapter whole-account method requires allowlist and exact profile/URL, not just a post id',async()=>{
 const d=DESTINATIONS[0];const requests:string[]=[];
 const adapter=createPortfolioMetricool({token:'synthetic-token-valid',userId:'123',fetcher:async(url:any)=>{
 requests.push(String(url));return new Response(JSON.stringify(String(url).includes('simpleProfiles')?[{blogId:d.brandId,tiktokUsername:d.account,isShared:false,ownerUserId:'123'}]:[{...post(d),createTime:Math.floor((NOW-24*3600000)/1000)},{...post({...d,account:'wrong'},'101')}]),{status:200,headers:{'content-type':'application/json'}});
 }});
 const r=await adapter.accountAnalytics(d,now());assert.equal(r.posts.length,1);assert.equal(r.rejectedRows,1);assert.equal(r.posts[0].actualAgeHours,24);await assert.rejects(adapter.accountAnalytics({brandId:6431692,network:'tiktok',account:'kong'},now()));assert.equal(requests.length,2);
});
test('strict wire parser rejects unknown fields, denied targets, new source identities and future evidence',async()=>fixture(async root=>{
 const good=await base(root);for(const change of [(r:any)=>r.secret='private',(r:any)=>r.accounts[0].brandId='6431692',(r:any)=>r.discovery.sources[0].channelId='UC'+'x'.repeat(22),(r:any)=>r.evidenceAt='2099-01-01T00:00:00.000Z',(r:any)=>r.safety.paidSpendUsd=1]){const r=structuredClone(good);change(r);assert.equal(parseClippersOrchestraStatus(r,NOW),null);}
}));
test('nonce/timestamp/scoped schema reject before persistence; duplicates are idempotent and ordered',async()=>fixture(async root=>{
 const r=await base(root),store=memory();let sweeps=0,tick=NOW;const state=createClippersOrchestraState({owner:()=> 'owner',store:async()=>store,now:()=>tick,careerSweep:async()=>{sweeps++;}});
 const e=envelope(r);assert.equal((await state.ingest(e)).accepted,true);assert.equal((await state.ingest(e)).duplicate,true);assert.equal(sweeps,1);
 const conflict=structuredClone(e);conflict.report.roles[0].outputs={x:1};await assert.rejects(state.ingest(conflict),/NONCE_CONFLICT/);
 await assert.rejects(state.ingest(envelope(r)),/OUT_OF_ORDER/);
 const bad=structuredClone(e);bad.report.accounts[0].brandId='6585226';assert.equal((await state.ingest(bad)).accepted,false);
 const forged=structuredClone(e);forged.report.roles[0].career={registered:true,generation:1,battery:100,points:999,inTraining:false,hiredAt:now().toISOString(),skillIds:[],lastEvidenceId:null};assert.equal(parseClippersEnvelope(forged,NOW),null);
 tick+=91000;const view=await state.read();assert.equal(view!.transport.state,'stale');assert.ok(view!.roles.every(r=>r.state==='disconnected'||r.state==='stale'));
 assert.ok(parseClippersOrchestraStatus(view,tick));assert.equal(view!.roles.find(r=>r.stage==='health')!.heartbeatAt,now().toISOString());
}));
test('large and future envelopes never enter durable state',async()=>fixture(async root=>{
 const r=await base(root),e=envelope(r);e.generatedAt='2099-01-01T00:00:00.000Z';assert.equal(parseClippersEnvelope(e,NOW),null);
 const huge:any=envelope(r);huge.report.roles[0].outputs.private='x'.repeat(300000);assert.equal(parseClippersEnvelope(huge,NOW),null);
}));
test('nine careers hire through company engine with zero awards; heartbeat, held rights and old outcomes stay neutral',async()=>fixture(async root=>{
 const r=await base(root);let c=applyClippersReceiptOutcomes(emptyCompanyState(),r,NOW);assert.equal(Object.keys(c.careers).length,9);assert.ok(Object.values(c.careers).every(x=>x.points===0&&x.battery===80));
 const snapshot=JSON.stringify(c);c=applyClippersReceiptOutcomes(c,r,NOW+60000);assert.equal(JSON.stringify(c),snapshot);
}));
test('dated verified output scores once, never again on heartbeat/replay or for pre-hire evidence',async()=>fixture(async root=>{
 const r=await base(root);let c=applyClippersReceiptOutcomes(emptyCompanyState(),r,NOW-10000);
 const role=r.roles.find((r:any)=>r.stage==='streamers');const sha='a'.repeat(64);role.outcomes=[{evidenceId:`clippers:${sha}:streamers`,artifactSha256:sha,completedAt:now().toISOString(),outcome:'verified_deliverable',reason:'public_metadata_receipt'}];
 c=applyClippersReceiptOutcomes(c,r,NOW);const scored=c.careers['clippers-streamers'];assert.ok(scored.points>0);const points=scored.points;c=applyClippersReceiptOutcomes(c,r,NOW+1000);assert.equal(c.careers['clippers-streamers'].points,points);
 const before=c.careers['clippers-health'].points;r.roles.find((r:any)=>r.stage==='health').outcomes=[{...role.outcomes[0],evidenceId:`clippers:${sha}:health`}];c=applyClippersReceiptOutcomes(c,r,NOW+1000);assert.equal(c.careers['clippers-health'].points,before);
}));
test('relay is asynchronous cached telemetry only, with no transport credentials or outbound function',async()=>fixture(async root=>{
 let calls=0;const relay=createClippersOrchestraRelay({workspaceRoot:root,now,build:async(args:any)=>{calls++;return buildClippersOrchestraReport(args);}});assert.equal(relay.getEnvelope(),null);await relay.refresh();const e=relay.getEnvelope();assert.ok(e&&parseClippersEnvelope(e,NOW));assert.equal(calls,1);assert.equal(relay.getEnvelope()!.nonce,e!.nonce);relay.stop();
}));

test('stored paired growth ages without wedging reads or future ingestion',async()=>fixture(async root=>{
 await discovery(root,'2026-11-18T15:00:00.000Z',100,'2026-11-18-aaaaaaaaaaaaaaaa.json');await discovery(root,'2026-11-18T17:00:00.000Z',140,'2026-11-18-bbbbbbbbbbbbbbbb.json');
 const report=await base(root),store=memory();let at=NOW;const state=createClippersOrchestraState({owner:()=> 'owner',store:async()=>store,now:()=>at});
 assert.equal((await state.ingest(envelope(report))).accepted,true);at+=73*3600000;
 const old=await state.read();assert.equal(old!.discovery.signals[0].label,'stale_reference');assert.ok(parseClippersOrchestraStatus(old,at));
 const next=await buildClippersOrchestraReport({workspaceRoot:root,now:new Date(at)});assert.equal((await state.ingest(envelope(next))).accepted,true);assert.ok(await state.read());
}));
async function controlled(root:string,lift=1.2){
 const target=DESTINATIONS[0],key=destinationKey(target),scope=key.replaceAll(':','__');
 const engine=hash(await readFile(new URL('../script/clippers-portfolio-render.mjs',import.meta.url),'utf8'));
 const params={hook:0,duration:5,crop:'center',caption_layout:'off',posting_slot:'12:00'};
 const baseline={schemaVersion:1,destination:target,version:'baseline-1',engineSha256:engine,reviewedBy:'synthetic-owner',params};
 const candidate={...baseline,version:'candidate-1',params:{...params,hook:1}};
 await save(root,`config/clippers-daily-learning/render-policies/${scope}/baseline-1.json`,baseline);
 await save(root,`config/clippers-daily-learning/render-policies/${scope}/candidate-1.json`,candidate);
 const state:any={schemaVersion:1,deliveries:[],observations:[],history:[],versions:{}},media:any[]=[];
 for(let trial=0;trial<3;trial++)for(const arm of ['control','candidate'])for(let item=0;item<5;item++){
  const id=`synthetic-${trial}-${arm}-${item}`,index=state.deliveries.length+1;
  const experiment={id:`trial-${trial}`,context:'synthetic-independent',variable:'hook',arm,baselineVersion:'baseline-1',candidateVersion:'candidate-1'};
  const manifest=arm==='control'?baseline:candidate,comparison={baselineManifestSha:digest(baseline),candidateManifestSha:digest(candidate),variable:'hook'};
  const request={schemaVersion:1,id,...target,policyVersion:manifest.version,sourceSha256:hash(`original synthetic bytes ${id}`),sourceStartSeconds:0,captionText:'Synthetic original fixture',experiment};
  const receipt={requestId:id,destination:target,version:manifest.version,manifestSha:digest(manifest),engineSha256:engine,comparison,actualParams:manifest.params,sourceSha256:request.sourceSha256,startSeconds:manifest.params.hook,captionTextSha256:hash(request.captionText),renderRequestSha256:digest(request),outputSha256:hash(`synthetic render ${id}`),draftFile:`drafts/portfolio/${id}.mp4`,renderedAt:'2026-11-17T15:00:00.000Z',costUsd:0,experiment};
  await save(root,`config/clippers-daily-learning/render-requests/${id}.json`,request);
  await save(root,`reports/clippers-daily-learning/render-receipts/${scope}/${id}/${manifest.version}/${receipt.outputSha256}.json`,receipt);
  const p={...post(target,String(index)),publishedAt:'2026-11-17T16:00:00.000Z',verifiedAt:'2026-11-17T16:01:00.000Z'};
  state.deliveries.push({...target,id,campaignId:'synthetic-campaign',creator:'synthetic-creator',language:'en',policyVersion:manifest.version,mediaSha256:receipt.outputSha256,renderProof:{manifestSha:digest(manifest),engineSha256:engine,comparison},experiment,elapsedMs:arm==='control'?20:10,costUsd:0,createdAt:'2026-11-17T15:00:00.000Z',status:'published',metricoolId:`receipt-${index}`,scheduledAt:p.publishedAt,post:p});
  state.observations.push({key:`metric-${index}`,destination:key,deliveryId:id,postId:p.id,publishedAt:p.publishedAt,observedAt:'2026-11-18T16:00:00.000Z',capturedAt:'2026-11-18T16:00:01.000Z',window:24,views:arm==='control'?100:Math.round(100*lift),completionRate:arm==='control'?.5:.6,timing:'provider_observation_time'});
  media.push({...target,status:'ready',campaignId:'synthetic-campaign',draftFile:receipt.draftFile,sha256:receipt.outputSha256,renderReceiptSha256:digest(receipt),paidSpendAllowed:false});
 }
 await save(root,'reports/clippers-daily-learning/state.json',state);await save(root,'reports/clippers-daily-learning/portfolio-media-receipts.json',media);
 await save(root,'reports/clippers-daily-learning/latest.json',{schemaVersion:1,date:'2026-11-18',generatedAt:now().toISOString(),paidSpendUsd:0,destinations:DESTINATIONS.map((d:any)=>({...d,eligible:0,confirmedScheduledOrPublished:0,shortfall:5,blockers:[]}))});
 return {state,media};
}
test('exact20% with three independent5×5 current render-bound comparisons survives strict wire and remains manual review',async()=>fixture(async root=>{
 await controlled(root);const r=await base(root);assert.ok(parseClippersOrchestraStatus(r,NOW));assert.equal(r.learning.comparisons.length,3);assert.equal(r.learning.eligibleComparisons,3);assert.ok(r.learning.comparisons.every((c:any)=>c.improvementRatio===.2&&c.renderReceiptVerified&&c.eligible));assert.deepEqual(r.learning.heldReasons,['manual_queue_review_required']);assert.equal(r.learning.automaticPromotion,false);assert.equal(r.learning.promotions,0);
 assert.equal(r.roles.find((r:any)=>r.stage==='learning').outcomes.length,1);assert.ok(parseClippersEnvelope(envelope(r),NOW));
}));
test('missing render receipt, changed current version or reused public post suppresses qualification',async()=>fixture(async root=>{
 const {state}=await controlled(root,1.3);state.versions[destinationKey(DESTINATIONS[0])]='new-active-version';await save(root,'reports/clippers-daily-learning/state.json',state);
 let r=await base(root);assert.equal(r.learning.eligibleComparisons,0);assert.equal(r.roles.find((r:any)=>r.stage==='learning').outcomes.length,0);
 state.versions={};state.deliveries[0].mediaSha256='0'.repeat(64);await save(root,'reports/clippers-daily-learning/state.json',state);r=await base(root);assert.ok(r.learning.comparisons.some((c:any)=>!c.renderReceiptVerified));assert.equal(r.roles.find((r:any)=>r.stage==='learning').outcomes.length,0);
 const fresh=await controlled(root,1.3);fresh.state.deliveries[10].post={...fresh.state.deliveries[0].post};fresh.state.observations[10].postId=fresh.state.deliveries[0].post.id;
 await save(root,'reports/clippers-daily-learning/state.json',fresh.state);r=await base(root);assert.ok(r.learning.eligibleComparisons<3);assert.equal(r.roles.find((r:any)=>r.stage==='learning').outcomes.length,0);
}));

test('JSONB object-key reordering preserves receipt checksum, read and next ingest; replay has zero extra writes',async()=>fixture(async root=>{
 const order=(v:any):any=>Array.isArray(v)?v.map(order):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().reverse().map(k=>[k,order(v[k])])):v;
 let raw:string|null=null,writes=0,at=NOW;
 const store={async read(){return raw;},async transact(_owner:string,update:any){writes++;raw=JSON.stringify(order(JSON.parse(await update(raw))));return raw;}};
 const state=createClippersOrchestraState({owner:()=> 'owner',store:async()=>store,now:()=>at});const r=await base(root),e=envelope(r);
 assert.equal((await state.ingest(e)).accepted,true);assert.ok(await state.read());assert.equal((await state.ingest(e)).duplicate,true);assert.equal(writes,1);
 at+=60000;const next=await buildClippersOrchestraReport({workspaceRoot:root,now:new Date(at)});assert.equal((await state.ingest(envelope(next))).accepted,true);assert.ok(await state.read());assert.equal(writes,2);
}));
test('relay only retries an unacknowledged nonce and never requests a credential or destination',async()=>fixture(async root=>{
 const relay=createClippersOrchestraRelay({workspaceRoot:root,now});await relay.refresh();const e=relay.getEnvelope()!;relay.acknowledge('wrong');assert.equal(relay.getEnvelope()!.nonce,e.nonce);relay.acknowledge(e.nonce);assert.equal(relay.getEnvelope(),null);relay.stop();
}));
test('owner GET route denies other identities and scope changes, sanitizes errors, and offers no POST handler',async()=>fixture(async root=>{
 const {registerClippersOrchestraRoutes}=await import('../server/clippers-orchestra-routes');const routes=new Map<string,any>();let reads=0;
 registerClippersOrchestraRoutes({get(path:string,handler:any){routes.set(path,handler);}} as any,{isOwner:(req:any)=>{if(!req.user)throw Error('auth');return req.user.id==='owner';},read:async()=>{reads++;return base(root);}});
 const handler=routes.get('/api/clippers/orchestra/status');
 async function request(user:any,query:any={}){let status=200,cache='';let body:any;await handler({user,query},{set(_k:string,v:string){cache=v;},status(n:number){status=n;return this;},json(v:any){body=v;return v;}});return {status,cache,body};}
 assert.equal((await request(undefined)).status,401);assert.equal((await request({id:'other-admin'})).status,403);assert.equal(reads,0);assert.equal((await request({id:'owner'},{brandId:6431692})).status,400);assert.equal(reads,0);
 const good=await request({id:'owner'});assert.equal(good.status,200);assert.equal(good.cache,'private, no-store, max-age=0');assert.ok(parseClippersOrchestraStatus(good.body,NOW));assert.equal(reads,1);assert.equal(routes.size,1);
}));

test('telemetry requires proven Office HTTPS origin and only reports safe origin/auth booleans',async()=>{
 const {clippersOrchestraRemoteEligibility}=await import('../script/clippers-orchestra-relay.mjs');
 assert.equal(clippersOrchestraRemoteEligibility('https://robertwebsites.com',true).allowed,true);
 assert.equal(clippersOrchestraRemoteEligibility('https://ROBPLANNER.replit.app',true).allowed,true);
 for(const url of ['https://wrong.example','http://robertwebsites.com','https://robertwebsites.com.evil.test','https://robertwebsites.com/?token=private','https://other.replit.app','https://robplanner.replit.app.evil.test'])assert.equal(clippersOrchestraRemoteEligibility(url,true).allowed,false);
 assert.equal(clippersOrchestraRemoteEligibility('https://robertwebsites.com',false).allowed,false);
 assert.ok(!JSON.stringify(clippersOrchestraRemoteEligibility('https://robertwebsites.com/?token=private',true)).includes('private'));
});

test('bounded private reader rejects FIFO without waiting for a writer and enforces byte cap',async()=>fixture(async root=>{
 const {privateOrchestraJson}=await import('../script/clippers-orchestra-report.mjs');
 const {execFileSync}=await import('node:child_process');
 const file=path.join(root,'fifo.json');execFileSync('mkfifo',[file]);await chmod(file,0o600);
 const started=performance.now();assert.equal((await privateOrchestraJson(root,'fifo.json',100)).error,'report_unreadable');assert.ok(performance.now()-started<1000);
 await save(root,'large.json',{value:'x'.repeat(1000)});assert.equal((await privateOrchestraJson(root,'large.json',100)).error,'report_unreadable');
}));

test('optional telemetry bounds legacy heartbeat latency and refuses parallel writes while acknowledgement is unknown',async()=>{
 const {createOptionalClippersTelemetryIngest}=await import('../server/clippers-orchestra-state');let calls=0,finish:any;
 const ingest=createOptionalClippersTelemetryIngest(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},20);
 const first:any=await ingest({});assert.equal(first.code,'CLIPPERS_ORCHESTRA_INGEST_UNCONFIRMED');assert.equal((await ingest({}) as any).code,'CLIPPERS_ORCHESTRA_INGEST_BUSY');assert.equal(calls,1);
 finish({accepted:true});await new Promise(resolve=>setImmediate(resolve));
 const pending=ingest({});await new Promise(resolve=>setImmediate(resolve));finish({accepted:true});assert.equal((await pending as any).accepted,true);assert.equal(calls,2);
});

test('new exact priority catalog accepts historical eight-source receipts without widening the source allowlist',async()=>fixture(async root=>{
 const {LEGACY_DISCOVERY_CREATORS,ALL_DISCOVERY_CREATORS}=await import('../shared/clippers-priority-creators.mjs');const r=await base(root);assert.equal(r.discovery.catalogVersion,2);assert.equal(r.discovery.sources.length,ALL_DISCOVERY_CREATORS.length);assert.equal(r.discovery.rotationSize,14);assert.ok(parseClippersOrchestraStatus(r,NOW));
 const legacy=structuredClone(r);delete legacy.creatorSelection;delete legacy.discovery.catalogVersion;legacy.discovery.rotationSize=4;legacy.discovery.rotationDays=2;legacy.discovery.sources=legacy.discovery.sources.filter((s:any)=>LEGACY_DISCOVERY_CREATORS.some(c=>c.id===s.creatorId));assert.ok(parseClippersOrchestraStatus(legacy,NOW));
 legacy.discovery.sources[0].channelId=ALL_DISCOVERY_CREATORS[0].channelId;assert.equal(parseClippersOrchestraStatus(legacy,NOW),null);
}));
test('creator preference expires in local projection and durable owner view; no heartbeat can renew it',async()=>fixture(async root=>{
 const pref={scopeKey:'a'.repeat(64),destination:DESTINATIONS[0],language:'en',format:'vertical_clip',context:'streamer_clip',postingBand:'10:00',timezone:'America/New_York',windowHours:24,baselineCreatorGroupId:'mrbeast',preferredCreatorGroupId:'thegrefg',status:'preferred',reason:'three_disjoint_batches_qualified',eligibleSamples:30,expiresAt:new Date(NOW+3600000).toISOString(),evidenceSha256:'b'.repeat(64)};
 await save(root,'reports/clippers-creator-selection/latest.json',{schemaVersion:1,evaluatedAt:now().toISOString(),paidSpendUsd:0,allowedUse:'ready_asset_order_only',assigned:30,heldReasons:[],preferences:[pref]});const r=await base(root);assert.equal(r.creatorSelection.preferences[0].status,'preferred');assert.ok(parseClippersOrchestraStatus(r,NOW));
 let at=NOW;const store=memory(),state=createClippersOrchestraState({owner:()=> 'owner',store:async()=>store,now:()=>at});await state.ingest(envelope(r));at+=2*3600000;const view=await state.read();assert.equal(view!.creatorSelection!.preferences[0].status,'baseline');assert.equal(view!.creatorSelection!.preferences[0].preferredCreatorGroupId,'mrbeast');assert.ok(parseClippersOrchestraStatus(view,at));
 const later=await buildClippersOrchestraReport({workspaceRoot:root,now:new Date(at)});assert.equal(later.creatorSelection.preferences[0].status,'baseline');assert.equal(later.creatorSelection.evaluatedAt,r.creatorSelection.evaluatedAt);
 const denied=structuredClone(r);denied.creatorSelection.preferences[0].destination.brandId=6431692;assert.equal(parseClippersOrchestraStatus(denied,NOW),null);
}));

// Contract from the official /api/swagger.json, verified 2026-11-18.
test('analytics date boundaries use second-precision UTC local time and explicit timezone on TT and FB',async()=>{
 for(const d of [DESTINATIONS[0],DESTINATIONS[3]]){
  let requests=0;const adapter=createPortfolioMetricool({token:'synthetic-token-valid',userId:'123',fetcher:async(input:any)=>{
   const u=new URL(input);requests++;if(u.pathname.endsWith('simpleProfiles'))return Response.json([{blogId:d.brandId,ownerUserId:'123',isShared:false,[d.network==='tiktok'?'tiktokUsername':'facebook']:d.account}]);
   assert.equal(u.pathname,'/api/v2/analytics/posts/'+d.network);assert.equal(u.searchParams.get('from'),'2026-11-11T18:00:00');assert.equal(u.searchParams.get('to'),'2026-11-18T18:00:00');assert.equal(u.searchParams.get('timezone'),'UTC');
   assert.equal(u.searchParams.get('blogId'),String(d.brandId));return Response.json({data:[]});
  }});const r=await adapter.accountAnalytics(d,now());assert.equal(requests,2);assert.deepEqual(r,{posts:[],receivedRows:0,rejectedRows:0});
 }
});
test('analytics non-JSON, invalid JSON, unknown shape and HTTP errors stay held with bounded codes',async()=>fixture(async root=>{
 for(const [response,code]of [
  [()=>new Response('private csv body',{headers:{'content-type':'text/csv'}}),'analytics_json_response_required'],
  [()=>new Response('private invalid body',{headers:{'content-type':'application/json'}}),'analytics_json_invalid'],
  [()=>Response.json({private:'not a list'}),'metricool_list_unrecognized'],
  [()=>new Response('private denial',{status:403}),'analytics_http_403'],
 ]as const){
  const adapter=createPortfolioMetricool({token:'synthetic-token-valid',userId:'123',fetcher:async(input:any)=>{const u=new URL(input);if(u.pathname.endsWith('simpleProfiles'))return Response.json(DESTINATIONS.map(d=>({blogId:d.brandId,ownerUserId:'123',isShared:false,tiktokUsername:DESTINATIONS.find(x=>x.brandId===d.brandId&&x.network==='tiktok')?.account,facebook:d.brandId===6591612?'1193011863901514':undefined})).filter((d,i,a)=>a.findIndex(x=>x.blogId===d.blogId)===i));return response();}});
  const receipt=await collectClippersAccountAnalytics({workspaceRoot:root,now:new Date(NOW+3600000*8),env:{},adapter});assert.ok(receipt.accounts.every((a:any)=>a.status==='held'&&a.observedAt===null&&a.reason===code));
  assert.ok(!JSON.stringify(receipt).includes('private'));await rm(path.join(root,'reports/clippers-account-analytics/latest.json'));
 }
}));

test('a receipt from the rejected date contract is refreshed once, then the corrected contract reuses its cache',async()=>fixture(async root=>{
 await save(root,'reports/clippers-account-analytics/latest.json',{schemaVersion:1,date:'2026-11-18',generatedAt:now().toISOString(),readOnly:true,paidSpendUsd:0,accounts:DESTINATIONS.map(d=>({...d,status:'held',reason:'analytics_provider_read_unavailable',posts:[]}))});
 let calls=0;const adapter={async accountAnalytics(){calls++;return {posts:[],receivedRows:0,rejectedRows:0};}};
 const r=await collectClippersAccountAnalytics({workspaceRoot:root,now:now(),env:{},adapter});assert.equal(r.reused,false);assert.equal(r.adapterContract,'utc-local-v1');assert.equal(calls,4);
 assert.equal((await collectClippersAccountAnalytics({workspaceRoot:root,now:now(),env:{},adapter})).reused,true);assert.equal(calls,4);
}));

test('real discovery producer receipts project empty success, stable replay freshness and same-channel paired growth',async()=>fixture(async root=>{
 const {runPortfolioDiscovery,PRIORITY_CREATORS}=await import('../script/clippers-portfolio-discovery.mjs');
 const dir=path.join(await realpath(root),'portfolio-discovery');let calls=0,views=100;
 const fetchImpl=async(input:any)=>{calls++;const channel=new URL(input).searchParams.get('channel_id')!;const empty=channel===PRIORITY_CREATORS[0].channelId;const video=channel.slice(2,13);
  return new Response(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><yt:channelId>${channel.slice(2)}</yt:channelId><title>Original synthetic public fixture</title><author><uri>https://www.youtube.com/channel/${channel}</uri></author>${empty?'':`<entry><yt:videoId>${video}</yt:videoId><yt:channelId>${channel}</yt:channelId><title>Original synthetic entry</title><published>2026-11-17T12:00:00Z</published><media:group><media:community><media:statistics views="${views}"/></media:community></media:group></entry>`}</feed>`,{headers:{'content-type':'application/atom+xml'}});
 };
 await runPortfolioDiscovery({stateDir:dir,now:now(),fetchImpl});const first=await buildClippersOrchestraReport({workspaceRoot:root,now:new Date(NOW+10000)});assert.equal(calls,14);assert.ok(parseClippersOrchestraStatus(first,NOW+10000));
 const empty=first.discovery.sources.find((s:any)=>s.channelId===PRIORITY_CREATORS[0].channelId)!;assert.equal(empty.status,'observed');assert.equal(empty.observations,0);assert.ok(empty.observedAt);
 assert.equal(first.discovery.scout.requestsAdded,0);assert.equal(first.discovery.scout.candidates.length,13);assert.equal(first.discovery.scout.candidates[0].evidence,'popularity_observed');assert.ok(first.discovery.scout.candidates.every((c:any)=>c.url===`https://www.youtube.com/watch?v=${c.videoId}`&&c.rights==='unknown'&&c.mayPublish===false));
 const creator=PRIORITY_CREATORS[1],before=first.discovery.sources.find((s:any)=>s.channelId===creator.channelId)!;
 await runPortfolioDiscovery({stateDir:dir,now:new Date(NOW+2*3600000),creatorIds:[creator.id],fetchImpl});const replay=await buildClippersOrchestraReport({workspaceRoot:root,now:new Date(NOW+2*3600000+10000)});assert.equal(calls,14);assert.equal(replay.discovery.sources.find((s:any)=>s.channelId===creator.channelId)!.observedAt,before.observedAt);assert.equal(replay.discovery.observations,first.discovery.observations);
 views=130;await runPortfolioDiscovery({stateDir:dir,now:new Date(NOW+24*3600000),fetchImpl});const second=await buildClippersOrchestraReport({workspaceRoot:root,now:new Date(NOW+24*3600000+10000)});assert.equal(calls,28);assert.ok(parseClippersOrchestraStatus(second,NOW+24*3600000+10000));const signal=second.discovery.signals.find((s:any)=>s.creatorId===creator.id)!;assert.equal(signal.label,'paired_growth_observed');assert.equal(signal.growthViews,30);
 const candidate=second.discovery.scout.candidates.find((c:any)=>c.creatorId===creator.id)!;assert.equal(candidate.evidence,'growth_observed');assert.equal(candidate.growthViews,30);assert.ok(candidate.sampleSpanHours>=23.99);assert.equal(candidate.likes,null);
 const legacy=structuredClone(second);delete legacy.discovery.scout;assert.ok(parseClippersOrchestraStatus(legacy,NOW+24*3600000+10000));
 const forged=structuredClone(second);forged.discovery.scout.candidates[0].url='https://evil.example/';assert.equal(parseClippersOrchestraStatus(forged,NOW+24*3600000+10000),null);
}));

test('public growth needs identical channel/video/publication anchor and at least one hour',async()=>fixture(async root=>{
 const {PRIORITY_CREATORS}=await import('../shared/clippers-priority-creators.mjs');const c=PRIORITY_CREATORS[1],publishedAt='2026-11-17T12:00:00.000Z';
 async function receipt(day:string,at:string,views:number,published=publishedAt){await save(root,`portfolio-discovery/${day}-channel-${c.channelId}.json`,{schemaVersion:2,day,observedAt:at,paidSpendUsd:0,mayPublish:false,permission:'unknown',feeds:[{creatorId:c.id,channelId:c.channelId,status:'observed',feedSha256:'a'.repeat(64)}],observations:[{creatorId:c.id,channelId:c.channelId,videoId:'abcdefghijk',publishedAt:published,observedAt:at,views,metricEvidence:'direct_public_feed'}]});}
 await receipt('2026-11-17','2026-11-17T23:45:00.000Z',100);await receipt('2026-11-18','2026-11-18T00:15:00.000Z',120);assert.ok((await base(root)).discovery.signals.every((s:any)=>s.label!=='paired_growth_observed'));
 await receipt('2026-11-18','2026-11-18T01:15:00.000Z',120,'2026-11-17T13:00:00.000Z');const changed=await base(root);assert.equal(changed.discovery.signals.length,1);assert.ok(changed.discovery.signals.every((s:any)=>s.label!=='paired_growth_observed'));
}));

test('a newer failed routing cycle supersedes a still-dated old preference rather than presenting it as active',async()=>fixture(async root=>{
 await save(root,'reports/clippers-creator-selection/latest.json',{schemaVersion:1,evaluatedAt:new Date(NOW-60000).toISOString(),paidSpendUsd:0,allowedUse:'ready_asset_order_only',assigned:30,heldReasons:[],preferences:[{scopeKey:'a'.repeat(64),destination:DESTINATIONS[0],language:'en',format:'vertical_clip',context:'streamer_clip',postingBand:'10:00',timezone:'America/New_York',windowHours:24,baselineCreatorGroupId:'mrbeast',preferredCreatorGroupId:'thegrefg',status:'preferred',reason:'three_disjoint_batches_qualified',eligibleSamples:30,expiresAt:new Date(NOW+3600000).toISOString(),evidenceSha256:'b'.repeat(64)}]});
 await save(root,'reports/clippers-daily-learning/latest.json',{schemaVersion:1,generatedAt:now().toISOString(),paidSpendUsd:0,creatorSelection:{schemaVersion:1,evaluatedAt:now().toISOString(),paidSpendUsd:0,allowedUse:'ready_asset_order_only',contexts:0,assigned:null,heldReasons:['creator_routing_unavailable'],preferences:[]}});
 const report=await base(root);assert.equal(report.creatorSelection.preferences.length,0);assert.equal(report.creatorSelection.assigned,null);assert.ok(report.creatorSelection.heldReasons.includes('creator_routing_unavailable'));assert.ok(parseClippersOrchestraStatus(report,NOW));
}));

test('external owner UI observations survive wire validation without learner ACK or career awards',async()=>fixture(async root=>{
 const rows=Array.from({length:5},(_,i)=>{const r={schemaVersion:1,origin:'external_owner_ui',kind:'external_schedule_observation',assetId:'owner-ui-'+i,destination:DESTINATIONS[0],sourceUrl:'https://www.youtube.com/watch?v=aaaaaaaaaaa',caption:'Actual observed caption '+i,metricoolId:String(1000+i),scheduledAt:`2026-11-18T${String(16+i*2).padStart(2,'0')}:00:00.000Z`.replace('T24:','T23:'),mediaUrl:`https://static.metricool.com/video/123/202611/observed${i}.mp4`,sha256:'a'.repeat(64),sizeBytes:100,renderReceiptSha256:'b'.repeat(64),observedAt:now().toISOString(),confirmation:'exact_scheduler_get_and_native_bytes',publicationState:'not_evaluated',paidSpendUsd:0};return{...r,proofSha256:digest(r)};});
 await save(root,'reports/clippers-daily-learning/external-schedules.json',rows);
 const r=await base(root);assert.ok(parseClippersOrchestraStatus(r,NOW));assert.equal(r.accounts[0].confirmedScheduledOrPublished,5);assert.equal(r.accounts[0].shortfall,0);assert.equal(r.accounts[1].confirmedScheduledOrPublished,null);
 const publisher=r.roles.find((v:any)=>v.stage==='publisher');assert.equal(publisher.outputs.externalOwnerUiObservations,5);assert.equal(publisher.lastRunAt,now().toISOString());assert.equal(publisher.outcomes.length,0);assert.equal(publisher.heartbeatAt,null);assert.equal(publisher.career.points,null);
}));
