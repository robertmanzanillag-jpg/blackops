import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { DESTINATIONS, destinationKey, createPortfolioMetricool } from '../script/clippers-portfolio-metricool.mjs';
import { weeklyDigest as digest, validateEvergreenAuthorization, weeklyDeliveryCollision, readWeeklyPrivateJson } from '../script/clippers-weekly-policy.mjs';
import { runClippersWeeklyScheduling, parseWeeklySchedulingArgs } from '../script/clippers-weekly-scheduler.mjs';
import { buildClippersOrchestraReport } from '../script/clippers-orchestra-report.mjs';
import { renderClippersPortfolio, confirmedRenderReceipt } from '../script/clippers-portfolio-render.mjs';
import { runClippersPortfolioPrepare, publicDriveUrl } from '../script/clippers-portfolio-prepare.mjs';
const exec=promisify(execFile),NOW=new Date('2026-11-18T15:00:00Z'),target=DESTINATIONS[0];
const WINDOW={startDate:'2026-11-18',endDate:'2026-11-22'},SHA='a'.repeat(64),CONFIG='config/clippers-daily-learning',REPORT='reports/clippers-daily-learning';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const tools=['ffmpeg','ffprobe'].every(c=>spawnSync(c,['-version']).status===0);
function pureFixture(){
 const rights={destination:target,reviewedBy:'actual-fixture-owner',sourceSha256:SHA,sourcePublishedAt:'2026-11-17T17:04:07Z',observedAt:'2026-11-18T14:00:00Z',validUntil:'2026-11-23T05:00:00Z',termsUrl:'https://example.com/owned',commercialPermission:'approved',sourceScope:'exact_asset',basis:'owned',membership:'not_required',ownership:'verified',thirdPartyCommercial:false,permittedNetworks:['tiktok']};
 const license={...rights,schemaVersion:1,kind:'reviewed_exact_asset_license',sourceUrl:'https://www.youtube.com/watch?v=aaaaaaaaaaa',reviewedBy:'actual-fixture-owner',permissionExpiresAt:null};
 const a={...rights,schemaVersion:1,contentClass:'evergreen_streamer_clip',sourceUrl:license.sourceUrl,reviewedBy:'actual-fixture-owner',licenseEvidenceSha256:digest(license),windowStart:WINDOW.startDate,windowEnd:WINDOW.endDate,scheduledAt:'2026-11-22T17:00:00.000Z'};
 const request={schemaVersion:1,...target,id:'synthetic-1',policyVersion:'baseline-1',sourceSha256:SHA,rights,weeklyAuthorization:a};
 const rendered={requestId:request.id,destination:target,version:'baseline-1',sourceSha256:SHA,outputSha256:'b'.repeat(64),costUsd:0,renderedAt:'2026-11-18T14:10:00Z',renderRequestSha256:digest(request),startSeconds:0,actualParams:{duration:5}};
 const asset={...target,id:request.id,policyVersion:request.policyVersion,mediaSha256:rendered.outputSha256,renderReceiptSha256:digest(rendered),sourceUrl:a.sourceUrl,sourcePublishedAt:rights.sourcePublishedAt,scheduledAt:a.scheduledAt,rightsObservedAt:rights.observedAt,rightsValidUntil:rights.validUntil,weeklyAuthorizationSha256:digest(a),thirdPartyCommercial:false};
 return {authorization:a,license,request,rendered,asset,now:NOW,window:WINDOW};
}
test('evergreen proof preserves original date, exact license/network/slot and source render recency',()=>{
 const f=pureFixture();assert.equal(validateEvergreenAuthorization(f),true);
 for(const mutate of [x=>x.asset.scheduledAt='2026-11-21T17:00:00.000Z',x=>x.asset.rightsObservedAt='2026-11-16T14:00:00Z',x=>x.license.permittedNetworks=['facebook'],x=>x.license.permissionExpiresAt='2026-11-21T00:00:00Z',x=>x.authorization.windowEnd='2026-11-25',x=>x.rendered.renderedAt='2026-11-22T00:00:00Z',x=>x.request.sourceSha256='c'.repeat(64),x=>x.asset.network='facebook']){const changed=structuredClone(f);changed.now=NOW;mutate(changed);assert.equal(validateEvergreenAuthorization(changed),false);}
 const old=pureFixture();old.now=new Date('2026-11-19T14:00:01Z');assert.equal(validateEvergreenAuthorization(old),false);
});
test('segment dedupe conserves default URL guard but permits nonoverlapping reviewed evergreen moments',()=>{
 const base={...target,id:'a',caption:'A',scheduledAt:'2026-11-18T17:00:00Z',mediaSha256:'a',sourceUrl:'https://youtu.be/aaaaaaaaaaa',weeklySourceProof:{sourceSha256:SHA,sourceIdentity:'youtube:aaaaaaaaaaa',startSeconds:0,endSeconds:10}};
 const next={...base,id:'b',caption:'B',mediaSha256:'b',scheduledAt:'2026-11-18T19:00:00Z',weeklySourceProof:{...base.weeklySourceProof,startSeconds:11,endSeconds:20}};
 assert.equal(weeklyDeliveryCollision(base,next),false);next.weeklySourceProof.startSeconds=9;assert.equal(weeklyDeliveryCollision(base,next),true);
 next.weeklySourceProof.sourceSha256='c'.repeat(64);next.sourceUrl='https://www.youtube.com/watch?v=aaaaaaaaaaa';assert.equal(weeklyDeliveryCollision(base,next),true);
 next.weeklySourceProof.startSeconds=11;next.scheduledAt='2026-11-18T17:30:00Z';assert.equal(weeklyDeliveryCollision(base,next),true);
 const legacy={...base};delete legacy.weeklySourceProof;next.sourceUrl=base.sourceUrl;next.scheduledAt='2026-11-18T19:00:00Z';assert.equal(weeklyDeliveryCollision(legacy,next),true);
 next.sourceUrl='https://www.youtube.com/watch?v=aaaaaaaaaaa';assert.equal(weeklyDeliveryCollision(legacy,next),true);
 assert.equal(weeklyDeliveryCollision(base,{...next,...DESTINATIONS[1]}),false);
});
async function fixture(t){
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'clippers-weekly-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const write=async(file,value)=>{await mkdir(path.dirname(path.join(root,file)),{recursive:true,mode:0o700});await writeFile(path.join(root,file),JSON.stringify(value),{mode:0o600});};
 const read=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
 await mkdir(path.join(root,REPORT),{recursive:true,mode:0o700});
 return{root,write,read};
}
test('empty weekly path is truthful and never loads credentials/providers or claims metrics day',async t=>{
 const f=await fixture(t);const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:new Proxy({},{get(){assert.fail('no calls');}})});
 assert.equal(r.scheduled,0);assert.equal(r.ready,0);assert.deepEqual(r.heldReasons,['no_weekly_permissioned_assets']);
 await assert.rejects(f.read(`${REPORT}/state.json`),/ENOENT/);
});
async function readyFixture(t,{sameDay=false}={}){
 const f=await fixture(t);await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=4:d=16','-f','lavfi','-i','sine=frequency=300:duration=16','-c:v','libx264','-c:a','aac','-shortest',path.join(f.root,'original.mp4')]);
 const sourceSha=hash(await readFile(path.join(f.root,'original.mp4'))), engineSha=hash(await readFile(new URL('../script/clippers-portfolio-render.mjs',import.meta.url)));
 const scoped=destinationKey(target).replaceAll(':','__');
 await f.write(`${CONFIG}/render-policies/${scoped}/baseline-1.json`,{schemaVersion:1,version:'baseline-1',destination:target,engineSha256:engineSha,reviewedBy:'fixture-checker',params:{hook:0,duration:5,crop:'center',caption_layout:'off',posting_slot:['12:00','14:00','16:00','18:00','20:00']}});
 const p=pureFixture();if(sameDay){p.authorization.scheduledAt='2026-11-18T17:00:00.000Z';delete p.request.weeklyAuthorization;}p.request.sourceSha256=p.request.rights.sourceSha256=p.authorization.sourceSha256=p.license.sourceSha256=sourceSha;
 p.authorization.licenseEvidenceSha256=digest(p.license);if(!sameDay)p.request.weeklyAuthorization=p.authorization;p.request.sourceFile='original.mp4';p.request.sourceStartSeconds=0;
 await f.write(`${CONFIG}/rights-evidence/${digest(p.license)}.json`,p.license);
 await f.write(`${CONFIG}/render-requests/${p.request.id}.json`,p.request);
 const rendered=await renderClippersPortfolio({workspaceRoot:f.root,requestId:p.request.id,now:NOW});
 const packet={schemaVersion:1,id:p.request.id,destination:target,renderRequestSha256:digest(p.request),renderReceiptSha256:rendered.receiptSha256,outputSha256:rendered.outputSha256,publicUploadAuthorized:true,schedulerAssetAuthorized:true,reviewedBy:'fixture-editor',campaignId:'owned-synthetic',sourceId:'source-one',sourceUrl:p.authorization.sourceUrl,creator:'owned-synthetic',language:'en',caption:'Actual synthetic fixture',scheduledAt:p.authorization.scheduledAt,thirdPartyCommercial:false,quality:'passed',originalEdit:'verified',disclosure:'verified',authorizedSpendUsd:0,providerIncrementalCostUsd:0};
 if(sameDay)packet.editorialPolicy='evergreen_streamer_clip';
 await f.write(`${CONFIG}/prepare-requests/${packet.id}.json`,packet);
 let bytes;const calls={upload:0,schedule:0,preflight:0};
 const uploader={ensureFolder:async()=> 'owned-test-folder',uploadFile:async({filePath})=>{calls.upload++;bytes=await readFile(filePath);return{fileId:'test-drive-file'};},makePublic:async id=>publicDriveUrl(id),verifyPublic:async(url,sha,size)=>hash(bytes)===sha&&size===bytes.length};
 const prepared=await runClippersPortfolioPrepare({workspaceRoot:f.root,now:NOW,env:{CLIPPERS_PORTFOLIO_PREPARE_ENABLED:'true',CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED:'true'},dependencies:uploader,renderer:{confirmedRenderReceipt,renderClippersPortfolio(){throw Error('no rerender');}}});
 assert.equal(prepared.prepared,1);assert.equal(calls.upload,1);
 const configured=await f.read(`${CONFIG}/approved-input.json`);configured.publish=true;await f.write(`${CONFIG}/approved-input.json`,configured);
 let scheduledId=null;
 const adapter={weeklyPreflight:async(d,item)=>{calls.preflight++;const evidence={destination:d,day:item.scheduledAt.slice(0,10),observedAt:NOW.toISOString(),source:'fresh_rest_calendar_and_account_analytics',scheduled:[],published:[]};return{day:evidence.day,confirmedCount:scheduledId?1:0,scheduledIds:scheduledId?[scheduledId]:[],publishedIds:[],evidence,evidenceSha256:digest(evidence)};},schedule:async(d,item)=>{calls.schedule++;scheduledId='actual-fake-get-receipt';return{id:scheduledId,mediaUrl:item.mediaUrl};},confirmSchedule:async(d,item)=>({id:scheduledId,mediaUrl:item.mediaUrl}),crossAccountPreflight:async()=>({checkedDays:[]})};
 return{...f,calls,adapter,p,packet};
}
test('actual FFmpeg preparation binds future exact-slot evergreen and weekly receipt replay is idempotent', {skip:!tools},async t=>{
 const f=await readyFixture(t);let report=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});
 assert.equal(report.scheduled,1);assert.equal(f.calls.schedule,1);const state=await f.read(`${REPORT}/state.json`);assert.equal(state.day,null);assert.equal(state.deliveries[0].status,'scheduled');assert.equal(state.deliveries[0].weeklySourceProof.startSeconds,0);assert.equal(state.deliveries[0].weeklySourceProof.endSeconds,5);
 report=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(report.scheduled,0);assert.equal(f.calls.schedule,1);
});
test('lost acknowledgement keeps pending reservation and suppresses every replay', {skip:!tools},async t=>{
 const f=await readyFixture(t);f.adapter.schedule=async()=>{f.calls.schedule++;throw Error('lost ack');};
 const args={workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter};
 assert.equal((await runClippersWeeklyScheduling(args)).scheduled,0);assert.equal((await f.read(`${REPORT}/state.json`)).deliveries[0].status,'verification_pending');
 assert.equal((await runClippersWeeklyScheduling(args)).attempts,0);assert.equal(f.calls.schedule,1);
});
test('request relabeling after render cannot produce rights/ready/upload evidence', {skip:!tools},async t=>{
 const f=await readyFixture(t);f.p.request.weeklyAuthorization.scheduledAt='2026-11-21T17:00:00.000Z';await f.write(`${CONFIG}/render-requests/${f.p.request.id}.json`,f.p.request);
 const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.ready,0);assert.equal(r.scheduled,0);assert.equal(f.calls.schedule,0);
});
test('real adapter fresh daily coverage unions pending and published; documented page.next cannot bypass cap',async()=>{
 let posts=[],analytics=[];const fetcher=async resource=>{const u=new URL(resource);if(u.pathname==='/api/admin/simpleProfiles')return Response.json([{id:target.brandId,canPublish:true,tiktokUsername:target.account}]);return Response.json(u.pathname.includes('/analytics/')?analytics:posts);};
 const adapter=createPortfolioMetricool({token:'synthetic-test-token',userId:12,fetcher});const item={scheduledAt:'2026-11-18T17:00:00.000Z',caption:'new',mediaUrl:'https://drive.google.com/uc?id=one'};
 analytics=[{postId:'1234',publishedAt:'2026-11-18T14:00:00Z'}];let coverage=await adapter.weeklyPreflight(target,item,{now:NOW});assert.equal(coverage.confirmedCount,1);assert.deepEqual(coverage.publishedIds,['1234']);
 analytics=[{postId:'1234',publishedAt:'2026-11-18T17:00:00Z'}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/coverage_unverified/);
 analytics=[];posts={data:[],page:{next:'next-page'}};await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/pagination/);
 posts=[{id:'p1',providers:[{network:'tiktok',status:'PENDING'}],publicationDate:'2026-11-18T17:30:00Z',text:'different'}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/daily_cap/);
});
function seal(f){f.authorization.licenseEvidenceSha256=digest(f.license);f.request.weeklyAuthorization=f.authorization;f.rendered.renderRequestSha256=digest(f.request);f.asset.weeklyAuthorizationSha256=digest(f.authorization);f.asset.renderReceiptSha256=digest(f.rendered);return f;}
test('rehashed owner inputs still cannot weaken real recency, window, expiry or network rules',()=>{
 for(const mutate of [
  f=>f.license.permissionExpiresAt='2026-11-20T00:00:00Z',
  f=>{f.authorization.windowEnd='2026-11-26';},
  f=>{for(const x of [f.authorization,f.license,f.request.rights])x.permittedNetworks=['facebook'];},
  f=>{for(const x of [f.authorization,f.license,f.request.rights])x.observedAt='2026-11-16T14:00:00Z';f.asset.rightsObservedAt='2026-11-16T14:00:00Z';},
  f=>{for(const x of [f.authorization,f.license,f.request.rights])x.sourcePublishedAt='2026-11-10T14:00:00Z';f.asset.sourcePublishedAt='2026-11-10T14:00:00Z';},
  f=>{f.window={startDate:'2026-11-18',endDate:'2026-11-20'};},
  f=>{f.license.commercialPermission='unknown';},
  f=>{delete f.license.permissionExpiresAt;},
 ]){const f=pureFixture();mutate(f);seal(f);assert.equal(validateEvergreenAuthorization(f),false);}
});
test('same-day editorial approval after immutable render enables local interval proof without future exception', {skip:!tools},async t=>{
 const f=await readyFixture(t,{sameDay:true});const configured=await f.read(`${CONFIG}/approved-input.json`);
 assert.equal(configured.assets[0].weeklyAuthorizationSha256,undefined);assert.equal(configured.assets[0].editorialPolicy,'evergreen_streamer_clip');
 const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.scheduled,1);assert.equal(f.calls.schedule,1);
 const state=await f.read(`${REPORT}/state.json`);assert.equal(state.deliveries[0].weeklyAuthorizationSha256,undefined);assert.equal(state.deliveries[0].weeklySourceProof.sourceIdentity,'youtube:aaaaaaaaaaa');assert.equal(state.day,null);
});
test('same-day editorial cannot be retimed to future with copied evidence or fabricated weekly digest', {skip:!tools},async t=>{
 const f=await readyFixture(t,{sameDay:true});const configured=await f.read(`${CONFIG}/approved-input.json`),raw=configured.assets[0];
 const evidence=await f.read(`${CONFIG}/evidence/${raw.evidenceSha256}.json`);raw.scheduledAt=evidence.scheduledAt='2026-11-22T17:00:00.000Z';raw.evidenceSha256=digest(evidence);await f.write(`${CONFIG}/evidence/${raw.evidenceSha256}.json`,evidence);await f.write(`${CONFIG}/approved-input.json`,configured);
 let r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.ready,0);assert.equal(f.calls.schedule,0);
 raw.weeklyAuthorizationSha256=SHA;evidence.weeklyAuthorizationSha256=SHA;raw.evidenceSha256=digest(evidence);await f.write(`${CONFIG}/evidence/${raw.evidenceSha256}.json`,evidence);await f.write(`${CONFIG}/approved-input.json`,configured);
 r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.ready,0);assert.equal(f.calls.schedule,0);
});
test('report-only and disabled publishing never touch provider despite locally ready asset', {skip:!tools},async t=>{
 const f=await readyFixture(t);const args={workspaceRoot:f.root,window:WINDOW,now:NOW,adapter:new Proxy({},{get(){assert.fail('provider must remain untouched');}})};
 let r=await runClippersWeeklyScheduling(args);assert.equal(r.ready,1);assert.equal(r.scheduled,0);assert.equal(r.outcomes[0].reason,'report_only');
 const configured=await f.read(`${CONFIG}/approved-input.json`);configured.publish=false;await f.write(`${CONFIG}/approved-input.json`,configured);
 r=await runClippersWeeklyScheduling({...args,apply:true});assert.equal(r.ready,1);assert.equal(r.scheduled,0);assert.equal(r.outcomes[0].reason,'publisher_disabled');
});
test('POST acknowledgement without exact GET remains unknown and cannot be replayed', {skip:!tools},async t=>{
 const f=await readyFixture(t);f.adapter.confirmSchedule=async()=>null;const args={workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter};
 assert.equal((await runClippersWeeklyScheduling(args)).scheduled,0);const state=await f.read(`${REPORT}/state.json`);assert.equal(state.deliveries[0].status,'verification_pending');assert.equal(state.deliveries[0].metricoolId,undefined);
 assert.equal((await runClippersWeeklyScheduling(args)).attempts,0);assert.equal(f.calls.schedule,1);
});
test('shared lock prevents weekly/daily concurrency without deleting the other owner lock',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'reports/metricool-autopilot.lock'),'other-owner',{mode:0o600});
 const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true});assert.equal(r.reason,'metricool_worker_busy');assert.equal(await readFile(path.join(f.root,'reports/metricool-autopilot.lock'),'utf8'),'other-owner');
});
test('live coverage counts five pending plus real published once and holds opaque statuses',async()=>{
 let rows=[],analytics=[];const fetcher=async resource=>{const u=new URL(resource);return Response.json(u.pathname==='/api/admin/simpleProfiles'?[{id:target.brandId,canPublish:true,tiktokUsername:target.account}]:u.pathname.includes('/analytics/')?analytics:rows);};
 const adapter=createPortfolioMetricool({token:'synthetic-fixture-token',userId:12,fetcher}),item={scheduledAt:'2026-11-18T17:00:00.000Z',caption:'new',mediaUrl:'https://drive.google.com/uc?id=new'};
 const row=(id,hour,status='PENDING')=>({id,providers:[{network:'tiktok',status}],publicationDate:`2026-11-18T${hour}:00:00Z`,text:id});
 rows=[row('one','18'),row('two','19'),row('three','20'),row('four','21')];analytics=[{postId:'111',publishedAt:'2026-11-18T14:00:00Z'}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/daily_cap/);
 rows=[{...row('already','14','PUBLISHED'),providers:[{network:'tiktok',status:'PUBLISHED',publicUrl:'https://www.tiktok.com/@streamersclips/video/111'}]}];
 const c=await adapter.weeklyPreflight(target,item,{now:NOW});assert.equal(c.confirmedCount,1);assert.equal(c.evidenceSha256,digest(c.evidence));
 analytics=[];rows=[row('in-progress','14','PUBLISHING')];const reserved=await adapter.weeklyPreflight(target,item,{now:NOW});assert.equal(reserved.confirmedCount,1);assert.equal(reserved.reservedPublishing,1);assert.deepEqual(reserved.calendarIds,['in-progress']);
 rows=[row('unknown','18','AWAITING_CONFIRMATION')];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/unverified/);
 rows=[];analytics=[{postId:'111',publishedAt:'2026-11-18T13:00:00Z'},{postId:'111',publishedAt:'2026-11-18T14:00:00Z'}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/identity_conflict/);
});

test('weekly CLI requires exact window and never silently accepts duplicate or stray flags',()=>{
 assert.deepEqual(parseWeeklySchedulingArgs(['--start','2026-11-18','--end','2026-11-22']),{window:WINDOW,apply:false});
 assert.equal(parseWeeklySchedulingArgs(['--start','2026-11-18','--end','2026-11-22','--apply']).apply,true);
 for(const args of [[],['--apply'],['--start','2026-11-18','--end','2026-11-22','--apply','--apply'],['--start','2026-11-18','--end','2026-11-22','extra'],['--start','--apply','--end','2026-11-22']])assert.throws(()=>parseWeeklySchedulingArgs(args),/usage/);
});

test('private readers reject FIFO without blocking and retain read-only legacy ledger permissions',async t=>{
 const f=await fixture(t);await f.write('legacy.json',[]);await chmod(path.join(f.root,'legacy.json'),0o644);
 await assert.rejects(readWeeklyPrivateJson(f.root,'legacy.json'),/private_file/);assert.deepEqual(await readWeeklyPrivateJson(f.root,'legacy.json',undefined,0o022),[]);
 const fifo=path.join(f.root,'pipe.json');assert.equal(spawnSync('mkfifo',['-m','600',fifo]).status,0);
 const moduleUrl=new URL('../script/clippers-weekly-policy.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import{readWeeklyPrivateJson}from ${JSON.stringify(moduleUrl)};try{await readWeeklyPrivateJson(${JSON.stringify(f.root)},'pipe.json');process.exit(2)}catch(e){process.exit(e.message==='weekly_private_file_required'?0:3)}`],{timeout:2000,encoding:'utf8'});
 assert.equal(child.status,0);assert.equal(child.error,undefined);
});

test('owner publishing revocation during preflight prevents POST even for a previously ready exact asset',{skip:!tools},async t=>{
 const f=await readyFixture(t);const preflight=f.adapter.weeklyPreflight;f.adapter.weeklyPreflight=async(...args)=>{const c=await preflight(...args);const input=await f.read(`${CONFIG}/approved-input.json`);input.publish=false;await f.write(`${CONFIG}/approved-input.json`,input);return c;};
 const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.scheduled,0);assert.equal(f.calls.schedule,0);assert.equal(r.outcomes[0].reason,'weekly_approval_changed_during_preflight');
});

test('Office projection consumes actual weekly GET evidence without renewing receipt time or inventing daily report',{skip:!tools},async t=>{
 const f=await readyFixture(t,{sameDay:true});await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});
 const at=new Date(+NOW+60000);let report=await buildClippersOrchestraReport({workspaceRoot:f.root,now:at});
 assert.equal(report.accounts[0].confirmedScheduledOrPublished,1);assert.equal(report.accounts[0].shortfall,4);assert.equal(report.accounts[1].confirmedScheduledOrPublished,null);assert.equal(report.accounts[1].shortfall,null);let role=report.roles.find(r=>r.stage==='publisher');assert.equal(role.outputs.confirmed,1);assert.equal(role.state,'completed');assert.equal(role.heartbeatAt,null);
 const timestamp=role.evidenceAt;report=await buildClippersOrchestraReport({workspaceRoot:f.root,now:new Date(+at+60000)});assert.equal(report.roles.find(r=>r.stage==='publisher').evidenceAt,timestamp);
 const state=await f.read(`${REPORT}/state.json`);state.deliveries[0].scheduleEvidenceSha256=SHA;await f.write(`${REPORT}/state.json`,state);report=await buildClippersOrchestraReport({workspaceRoot:f.root,now:at});role=report.roles.find(r=>r.stage==='publisher');assert.equal(role.outcomes.length,0);assert.equal(report.accounts[0].confirmedScheduledOrPublished,null);
});
test('legacy URL aliases without immutable intervals hold before any POST',{skip:!tools},async t=>{
 const f=await readyFixture(t,{sameDay:true});await f.write('reports/metricool-autopilot-ledger.json',[{metricoolBlogId:target.brandId,account:target.account,sourceUrl:'https://youtu.be/aaaaaaaaaaa',sha256:'different'}]);
 const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.scheduled,0);assert.equal(f.calls.schedule,0);assert.equal(f.calls.preflight,0);assert.equal(r.outcomes[0].reason,'duplicate_or_overlapping_delivery');
});
test('legacy ledger rows under the old account name (streamersclips) still block a duplicate',{skip:!tools},async t=>{
 const f=await readyFixture(t,{sameDay:true});await f.write('reports/metricool-autopilot-ledger.json',[{metricoolBlogId:target.brandId,account:'@StreamersClips',sourceUrl:'https://youtu.be/aaaaaaaaaaa',sha256:'different'}]);
 const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.scheduled,0);assert.equal(f.calls.schedule,0);assert.equal(r.outcomes[0].reason,'duplicate_or_overlapping_delivery');
});
test('calendar rows with unknown provider/brand identity cannot disappear into zero coverage',async()=>{
 let rows=[];const fetcher=async resource=>{const u=new URL(resource);return Response.json(u.pathname==='/api/admin/simpleProfiles'?[{id:target.brandId,canPublish:true,tiktokUsername:target.account}]:u.pathname.includes('/analytics/')?[]:rows);};
 const adapter=createPortfolioMetricool({token:'synthetic-fixture-token',userId:12,fetcher}),item={scheduledAt:'2026-11-18T17:00:00.000Z',caption:'new',mediaUrl:'https://drive.google.com/uc?id=new'};
 for(const providers of [undefined,[],[null],[{network:'tiktok'},{network:'tiktok'}],[{network:'TIKTOK'}]]){rows=[{id:'existing',publicationDate:'2026-11-18T18:00:00Z',text:'existing',...(providers===undefined?{}:{providers})}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/schedule_unverified/);}
 rows=[{id:'existing',blogId:6431692,providers:[{network:'tiktok',status:'PENDING'}],publicationDate:'2026-11-18T18:00:00Z',text:'existing'}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/schedule_unverified/);
 rows=[{id:'explicit-other-network',providers:[{network:'facebook',status:'PENDING'}],publicationDate:'2026-11-18T18:00:00Z'}];assert.equal((await adapter.weeklyPreflight(target,item,{now:NOW})).confirmedCount,0);
});
test('changing CLI subwindow does not reset stable-week attempt quota',{skip:!tools},async t=>{
 const f=await readyFixture(t);const state={schemaVersion:1,day:null,deliveries:[],observations:[],history:[],versions:{}};
 for(let i=0;i<100;i++){const destination=DESTINATIONS[Math.floor(i/5)%4],day=16+Math.floor(i/20),hour=11+2*(i%5);state.deliveries.push({...destination,id:'prior-'+i,caption:'Prior '+i,sourceUrl:'https://example.com/prior/'+i,mediaSha256:hash(String(i)),scheduledAt:`2026-11-${day}T${String(hour+5).padStart(2,'0')}:00:00.000Z`.replace('T24:','T23:'),status:'scheduled',metricoolId:'prior-provider-'+i,weeklyWindow:'2026-11-16:2026-11-20'});}
 await f.write(`${REPORT}/state.json`,state);const r=await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});assert.equal(r.attempts,0);assert.equal(f.calls.schedule,0);assert.equal(r.outcomes[0].reason,'weekly_attempt_budget');
 await assert.rejects(runClippersWeeklyScheduling({workspaceRoot:f.root,window:{startDate:'2026-11-18',endDate:'2026-11-24'},now:NOW}),/weekly_window_invalid/);
});

test('Office daily coverage is account-local and retains outside pending/published rows from actual preflight',{skip:!tools},async t=>{
 const f=await readyFixture(t,{sameDay:true}),preflight=f.adapter.weeklyPreflight;f.adapter.weeklyPreflight=async(...args)=>{const r=await preflight(...args);r.evidence.scheduled=[{id:'outside-pending',scheduledAt:'2026-11-18T18:00:00.000Z',status:'pending'}];r.evidence.published=[{id:'4444',publishedAt:'2026-11-18T14:00:00.000Z'}];r.confirmedCount=2;r.scheduledIds=['outside-pending'];r.publishedIds=['4444'];r.evidenceSha256=digest(r.evidence);return r;};
 await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});const report=await buildClippersOrchestraReport({workspaceRoot:f.root,now:new Date(+NOW+60000)});assert.equal(report.accounts[0].confirmedScheduledOrPublished,3);assert.equal(report.accounts[0].shortfall,2);assert.equal(report.accounts[1].confirmedScheduledOrPublished,null);
});
test('raw MCP scheduling follows authenticated native schema and sends public media in info, not picker attachments',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/metricool-create-post-schema-20261118.json',import.meta.url),'utf8'));
 assert.equal(fixture.inputSchemaSha256,'e8a8454f6d4de833250f35597c86086d37b685d9de75c8b9a895284e6a2c7cec');let posts=[],writes=0;
 const item={id:'actual-schema-fixture',scheduledAt:'2026-11-18T17:00:00.000Z',caption:'Approved source #TJR',mediaUrl:'https://drive.google.com/uc?export=download&id=fixture',thirdPartyCommercial:false};
 const fetcher=async(resource,options)=>{const url=new URL(resource);if(url.pathname==='/api/admin/simpleProfiles')return Response.json([{id:target.brandId,canPublish:true,tiktokUsername:target.account}]);
  if(url.hostname==='ai.metricool.com'){
   const request=JSON.parse(options.body),args=request.params.arguments,s=fixture.inputSchemaWithoutDescriptions;
   for(const required of s.required)assert.ok(Object.hasOwn(args,required));for(const[k,v]of Object.entries(args)){assert.ok(Object.hasOwn(s.properties,k));assert.equal(typeof v,s.properties[k].type);}
   assert.equal(args.mediaFiles,undefined);const info=JSON.parse(args.info);assert.deepEqual(info.media,[item.mediaUrl]);assert.deepEqual(info.providers,[{network:'tiktok'}]);assert.equal(info.tiktokData.commercialContentThirdParty,false);
   writes++;posts=[{id:'native-schema-receipt',autoPublish:true,draft:false,providers:[{network:'tiktok',status:'PENDING'}],text:info.text,media:info.media,publicationDate:info.publicationDate}];return Response.json({result:{content:[]}});
  }return Response.json(posts);
 };
 const adapter=createPortfolioMetricool({token:'synthetic-schema-token',userId:12,fetcher});const receipt=await adapter.schedule(target,item);assert.equal(writes,1);assert.equal(receipt.id,'native-schema-receipt');assert.equal(receipt.mediaUrl,item.mediaUrl);
});

test('known publishing reserves capacity; calendar published joins analytics exactly once without inventing publication time',async()=>{
 let rows=[],analytics=[];const fetcher=async resource=>{const u=new URL(resource);return Response.json(u.pathname==='/api/admin/simpleProfiles'?[{id:target.brandId,canPublish:true,tiktokUsername:target.account}]:u.pathname.includes('/analytics/')?analytics:rows);};
 const adapter=createPortfolioMetricool({token:'synthetic-fixture-token',userId:12,fetcher}),item={scheduledAt:'2026-11-18T19:00:00.000Z',caption:'new distinct',mediaUrl:'https://static.metricool.com/video/123/202611/new.mp4'};
 const row={id:'123',providers:[{network:'tiktok',status:'PUBLISHED',publicUrl:'https://www.tiktok.com/@streamersclips/video/111'}],publicationDate:'2026-11-18T14:00:00Z',text:'original'};rows=[row];
 let p=await adapter.weeklyPreflight(target,item,{now:NOW});assert.equal(p.confirmedCount,1);assert.equal(p.publicationTimesUnverified,1);assert.deepEqual(p.publishedIds,['111']);assert.equal(p.evidence.published.length,0);assert.equal(p.evidence.scheduled[0].publicationTimeVerified,false);assert.equal(Object.hasOwn(p.evidence.scheduled[0],'publishedAt'),false);
 analytics=[{postId:'111',publishedAt:'2026-11-18T14:00:00Z'}];p=await adapter.weeklyPreflight(target,item,{now:NOW});assert.equal(p.confirmedCount,1);assert.equal(p.evidence.scheduled.length,0);assert.deepEqual(p.calendarIds,['123']);
 analytics=[];rows=[{...row,providers:[{network:'tiktok',status:'PUBLISHED',publicUrl:'https://www.tiktok.com/@another/video/111'}]}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/unreconciled/);
 rows=[row,{...row,id:'456'}];await assert.rejects(adapter.weeklyPreflight(target,item,{now:NOW}),/identity_conflict/);
});

test('Office never double counts a local scheduled ACK after the same calendar ID becomes published',{skip:!tools},async t=>{
 const f=await readyFixture(t,{sameDay:true});await runClippersWeeklyScheduling({workspaceRoot:f.root,window:WINDOW,now:NOW,apply:true,adapter:f.adapter});
 const state=await f.read(`${REPORT}/state.json`),delivery=state.deliveries[0],proof=delivery.preflightEvidence;proof.scheduled=[{id:delivery.metricoolId,scheduledAt:delivery.scheduledAt,status:'published',platformPostId:'111',publicationTimeVerified:false}];proof.published=[];proof.calendarPublished=[{id:delivery.metricoolId,platformPostId:'111'}];const {sha256,...p}=proof;proof.sha256=digest(p);await f.write(`${REPORT}/state.json`,state);
 let report=await buildClippersOrchestraReport({workspaceRoot:f.root,now:new Date(+NOW+3*3600000)});assert.equal(report.accounts[0].confirmedScheduledOrPublished,1);assert.equal(report.accounts[0].shortfall,4);
 proof.scheduled=[];proof.published=[{id:'111',publishedAt:'2026-11-18T14:00:00.000Z'}];const {sha256:old,...updated}=proof;proof.sha256=digest(updated);await f.write(`${REPORT}/state.json`,state);report=await buildClippersOrchestraReport({workspaceRoot:f.root,now:new Date(+NOW+3*3600000)});assert.equal(report.accounts[0].confirmedScheduledOrPublished,1);
});
