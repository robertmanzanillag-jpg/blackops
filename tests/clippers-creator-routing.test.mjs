import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,readFile,rm,chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createClippersCreatorRouting, normalizeCreatorContext } from '../script/clippers-creator-routing.mjs';
import { DESTINATIONS,destinationKey } from '../script/clippers-portfolio-metricool.mjs';
import { PRIORITY_CREATORS } from '../shared/clippers-priority-creators.mjs';
const H=3600000,DAY=24*H,START=Date.parse('2026-11-01T14:00:00.000Z');
const hash=x=>createHash('sha256').update(x).digest('hex'),digest=x=>hash(JSON.stringify(x)),iso=x=>new Date(x).toISOString();
const ENGINE_SHA256=hash(await readFile(new URL('../script/clippers-portfolio-render.mjs',import.meta.url)));
const target=DESTINATIONS[0],scope=`${target.brandId}__${target.network}__${target.account}`;
const groups=[PRIORITY_CREATORS.find(x=>x.creatorGroupId==='mrbeast'),PRIORITY_CREATORS.find(x=>x.creatorGroupId==='thegrefg'),PRIORITY_CREATORS.find(x=>x.creatorGroupId==='ishowspeed')];
async function save(root,relative,v){const p=path.join(root,relative);await mkdir(path.dirname(p),{recursive:true,mode:0o700});await writeFile(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'creator-routing-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
async function asset(root,id,creator,at=START,slot='10:30',postingSlots=['10:00','10:30']){
 const params={hook:0,duration:30,crop:'center',caption_layout:'off',posting_slot:postingSlots};
 const manifest={schemaVersion:1,version:'baseline-1',destination:target,engineSha256:ENGINE_SHA256,reviewedBy:'synthetic-owner',params};
 await save(root,`config/clippers-daily-learning/render-policies/${scope}/baseline-1.json`,manifest);
 const video=id.replace(/[^a-zA-Z0-9]/g,'').padStart(11,'0').slice(-11),draftFile=`drafts/portfolio/${id}.mp4`,bytes='original synthetic render '+id;
 const request={schemaVersion:1,id,...target,policyVersion:'baseline-1',sourceSha256:hash('original source '+id),sourceStartSeconds:0,captionText:''};
 const receipt={schemaVersion:1,requestId:id,destination:target,version:'baseline-1',manifestSha:digest(manifest),engineSha256:ENGINE_SHA256,experiment:null,comparison:null,actualParams:params,sourceSha256:request.sourceSha256,startSeconds:0,renderRequestSha256:digest(request),captionTextSha256:hash(''),draftFile,outputSha256:hash(bytes),renderedAt:iso(at-1000),costUsd:0};
 const scheduledAt=iso(at+H+(slot==='10:30'?H/2:0));
 const item={...target,id,campaignId:'synthetic',sourceId:id,sourceUrl:'https://www.youtube.com/watch?v='+video,creator:creator.id,language:'en',policyVersion:'baseline-1',mediaSha256:receipt.outputSha256,renderReceiptSha256:digest(receipt),draftFile,scheduledAt,rightsEvidence:{rightsObservedAt:iso(at),rightsValidUntil:iso(at+24*H),sourcePublishedAt:iso(at-H)}};
 const evidence={assetId:id,sourceUrl:item.sourceUrl,mediaSha256:item.mediaSha256,renderReceiptSha256:item.renderReceiptSha256,policyVersion:item.policyVersion,scheduledAt,language:item.language,creator:item.creator,...item.rightsEvidence,commercialPermission:'approved',sourceScope:'exact_asset',reviewedBy:'synthetic-owner',destination:target,creatorSelection:{format:'vertical_clip',context:'streamer_clip',channelId:creator.channelId,sourceVideoId:video,postingBand:'10:00',timezone:'America/New_York',windowHours:24}};item.evidenceSha256=digest(evidence);
 await save(root,`config/clippers-daily-learning/evidence/${item.evidenceSha256}.json`,evidence);await save(root,`config/clippers-daily-learning/render-requests/${id}.json`,request);await save(root,`reports/clippers-daily-learning/render-receipts/${scope}/${id}/baseline-1/${item.mediaSha256}.json`,receipt);await save(root,draftFile,bytes);
 return item;
}
const empty=()=>({schemaVersion:1,deliveries:[],observations:[],versions:{},history:[]});
async function session(root,state,assets,at=START){return createClippersCreatorRouting({workspaceRoot:root,state,readyAssets:assets,now:new Date(at)});}
async function publish(state,item,assignment,views,at){const p={id:String(state.deliveries.length+1),url:`https://www.tiktok.com/@${target.account}/video/${state.deliveries.length+1}`,publishedAt:item.scheduledAt,verifiedAt:iso(at+2*H)};state.deliveries.push({...item,creatorAssignmentSha256:assignment,createdAt:iso(at),status:'published',post:p,metricoolId:'provider-'+p.id,costUsd:0,elapsedMs:10});state.observations.push({destination:destinationKey(target),deliveryId:item.id,postId:p.id,publishedAt:p.publishedAt,observedAt:iso(Date.parse(p.publishedAt)+24*H),window:24,views,completionRate:.6,timing:'provider_observation_time'});}

test('empty/missing creator metadata is unmeasured and never invents an assignment',async()=>fixture(async root=>{
 const state=empty(),s=await session(root,state,[]);assert.equal(s.report.contexts,0);assert.deepEqual(s.report.heldReasons,['no_current_ready_assets']);assert.equal(await s.assign({...target,id:'unknown'}),null);
 const a=await asset(root,'baseline',groups[0]);const evidenceFile=`config/clippers-daily-learning/evidence/${a.evidenceSha256}.json`;await save(root,evidenceFile,{assetId:a.id});const held=await session(root,state,[a]);assert.equal(held.report.contexts,0);assert.ok(held.report.heldReasons.includes('reviewed_creator_context_or_render_missing'));assert.equal(await held.assign(a),null);
}));
test('prospective immutable cohorts and asset assignment are saved before publication; replay is idempotent',async()=>fixture(async root=>{
 const state=empty(),a=await asset(root,'a',groups[0]),b=await asset(root,'b',groups[1]);const s=await session(root,state,[a,b]);assert.equal(s.report.preferences[0].status,'unmeasured');const id=await s.assign(a);assert.match(id,/^[a-f0-9]{64}$/);assert.equal(await s.assign(a),id);
 const ledger=JSON.parse(await readFile(path.join(root,'reports/clippers-creator-selection/state.json'),'utf8'));assert.equal(ledger.plans.length,3);assert.equal(ledger.assignments.length,1);assert.equal(ledger.assignments[0].sha256,id);assert.equal(state.deliveries.length,0);assert.equal((await s.flush()).assigned,1);
 const st=await import('node:fs/promises').then(f=>f.stat(path.join(root,'reports/clippers-creator-selection/state.json')));assert.equal(st.mode&0o077,0);
}));
test('wrong render bytes, denied destination, tampered context and unsafe ledger stay held',async()=>fixture(async root=>{
 const state=empty(),a=await asset(root,'a',groups[0]);await save(root,a.draftFile,'changed bytes');let s=await session(root,state,[a]);assert.equal(s.report.contexts,0);
 s=await session(root,state,[{...a,brandId:6431692}]);assert.equal(s.report.contexts,0);
 const file=path.join(root,'reports/clippers-creator-selection/state.json');await chmod(file,0o644);await assert.rejects(session(root,state,[]),/private_file/);
}));
test('three actual matched5+5 cohorts prefer the proven creator, without routing a lesser challenger against obsolete baseline',async()=>fixture(async root=>{
 const state=empty();
 for(let day=0;day<15;day++){
  const at=START+day*DAY,a=await asset(root,'control'+day,groups[0],at,'10:00'),b=await asset(root,'winner'+day,groups[1],at,'10:30');const s=await session(root,state,[a,b],at);
  await publish(state,a,await s.assign(a),100,at);await publish(state,b,await s.assign(b),150,at);
 }
 const at=START+16*DAY,a=await asset(root,'freshcontrol',groups[0],at),b=await asset(root,'freshwinner',groups[1],at),c=await asset(root,'freshother',groups[2],at);
 const s=await session(root,state,[a,b,c],at);const p=s.report.preferences[0];assert.equal(p.status,'preferred');assert.equal(p.preferredCreatorGroupId,groups[1].creatorGroupId);assert.equal(p.eligibleSamples,30);assert.equal(s.order([a,b,c])[0].id,c.id,'one already-ready challenger gets an exploration position inside the same scope');assert.equal(s.order([a,b,c])[1].id,b.id);
 const ledger=JSON.parse(await readFile(path.join(root,'reports/clippers-creator-selection/state.json'),'utf8'));assert.equal(ledger.transitions.at(-1).to,groups[1].creatorGroupId);assert.ok(ledger.plans.some(p=>p.manifest.controlCreatorGroupId===groups[1].creatorGroupId));
 // Existing sources cannot be reassigned to a new challenger comparison.
 const clone={...a,id:'reused-source',sourceUrl:state.deliveries[0].sourceUrl};assert.equal(await s.assign(clone),null);
 const again=await session(root,state,[c,b,a],at+H/10);assert.equal(again.report.preferences[0].preferredCreatorGroupId,groups[1].creatorGroupId,'new contender has no comparison against incumbent');
 const expiredAt=START+31*DAY,ea=await asset(root,'expired-control',groups[0],expiredAt),eb=await asset(root,'expired-winner',groups[1],expiredAt);const expired=await session(root,state,[ea,eb],expiredAt);assert.notEqual(expired.report.preferences[0].status,'preferred');assert.equal(expired.report.preferences[0].preferredCreatorGroupId,groups[0].creatorGroupId);
}));

test('observations stored under the legacy destination key (streamersclips) still count',async()=>fixture(async root=>{
 const state=empty();
 for(let day=0;day<15;day++){
  const at=START+day*DAY,a=await asset(root,'control'+day,groups[0],at,'10:00'),b=await asset(root,'winner'+day,groups[1],at,'10:30');const s=await session(root,state,[a,b],at);
  await publish(state,a,await s.assign(a),100,at);await publish(state,b,await s.assign(b),150,at);
 }
 for(const o of state.observations)o.destination='6431685:tiktok:streamersclips';
 const at=START+16*DAY,a=await asset(root,'freshcontrol',groups[0],at),b=await asset(root,'freshwinner',groups[1],at);
 const p=(await session(root,state,[a,b],at)).report.preferences[0];assert.equal(p.status,'preferred');assert.equal(p.eligibleSamples,30);
}));
test('a preference cannot reorder another context and leaves a ready challenger position within its scope',async()=>fixture(async root=>{
 const state=empty(),a=await asset(root,'one',groups[0]),b=await asset(root,'two',groups[1]),other=await asset(root,'other',groups[2]);
 const file=path.join(root,`config/clippers-daily-learning/evidence/${other.evidenceSha256}.json`),e=JSON.parse(await readFile(file,'utf8'));e.creatorSelection.context='other_context';other.evidenceSha256=digest(e);await save(root,`config/clippers-daily-learning/evidence/${other.evidenceSha256}.json`,e);
 const s=await session(root,state,[a,other,b]);const order=s.order([a,other,b]);assert.equal(order[1],other);assert.equal(order[0],b);assert.equal(order.length,3);
}));

test('duplicate exact asset identities cannot alias routing metadata or emit a prospective assignment',async()=>fixture(async root=>{
 const state=empty(),a=await asset(root,'same',groups[0]);const b={...a,scheduledAt:iso(START+2*H)};const s=await session(root,state,[a,b]);assert.equal(s.report.contexts,0);assert.ok(s.report.heldReasons.includes('duplicate_reviewed_asset_id'));assert.equal(await s.assign(a),null);assert.equal(await s.assign(b),null);
}));

test('total persisted scope capacity holds a new context without corrupting old scopes or the next cycle',async()=>fixture(async root=>{
 const state=empty(),assets=[];for(let i=0;i<33;i++){const a=await asset(root,'context'+i,groups[0]);const e=JSON.parse(await readFile(path.join(root,`config/clippers-daily-learning/evidence/${a.evidenceSha256}.json`),'utf8'));e.creatorSelection.context='context'+i;a.evidenceSha256=digest(e);await save(root,`config/clippers-daily-learning/evidence/${a.evidenceSha256}.json`,e);assets.push(a);}
 assert.equal((await session(root,state,assets.slice(0,32))).report.contexts,32);const extra=await session(root,state,[assets[32]]);assert.ok(extra.report.heldReasons.includes('scope_capacity_reached'));assert.equal(extra.report.contexts,0);const stored=JSON.parse(await readFile(path.join(root,'reports/clippers-creator-selection/state.json'),'utf8'));assert.equal(stored.preferences.length,32);await session(root,state,[]);
}));
test('size capacity is checked before replacing a valid ledger and failed assignment does not poison memory',async()=>fixture(async root=>{
 const state=empty(),a=await asset(root,'sizeone',groups[0]),b=await asset(root,'sizetwo',groups[1]);await session(root,state,[a,b]);const file=path.join(root,'reports/clippers-creator-selection/state.json'),before=await readFile(file,'utf8');
 const s=await createClippersCreatorRouting({workspaceRoot:root,state,readyAssets:[a,b],now:new Date(START),maxLedgerBytes:Buffer.byteLength(before)+100});const stable=await readFile(file,'utf8');
 await assert.rejects(s.assign(a),/creator_ledger_size_capacity/);assert.equal(await readFile(file,'utf8'),stable);await assert.rejects(s.assign(a),/creator_ledger_size_capacity/);assert.equal(await readFile(file,'utf8'),stable);assert.equal(JSON.parse(stable).assignments.length,0);await session(root,state,[]);
}));

test('one approved slot in the declared hour band stays unmeasured instead of registering an impossible trial',async()=>fixture(async root=>{
 const state=empty(),a=await asset(root,'singleone',groups[0],START,'10:30',['10:30']),b=await asset(root,'singletwo',groups[1],START,'10:30',['10:30']);const s=await session(root,state,[a,b]);assert.ok(s.report.heldReasons.includes('creator_band_capacity_insufficient'));assert.equal(s.report.preferences[0].status,'unmeasured');assert.equal(await s.assign(a),null);const ledger=JSON.parse(await readFile(path.join(root,'reports/clippers-creator-selection/state.json'),'utf8'));assert.equal(ledger.plans.length,0);
}));

test('source context uses the exact canonical source and creator identity, not an ambiguous URL or a different creator',()=>{
 const asset={...target,id:'normalization',creator:'mrbeast',sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',scheduledAt:iso(START+1.5*H)},m={format:'vertical_clip',context:'streamer_clip',channelId:groups[0].channelId,sourceVideoId:'abcdefghijk',postingBand:'10:00',timezone:'America/New_York',windowHours:24},resolve=id=>groups.find(g=>g.channelId===id);
 assert.ok(normalizeCreatorContext(m,asset,resolve));assert.ok(normalizeCreatorContext(m,{...asset,sourceUrl:'https://www.youtube.com/shorts/abcdefghijk'},resolve));assert.equal(normalizeCreatorContext(m,{...asset,sourceUrl:'https://www.youtube.com:444/watch?v=abcdefghijk'},resolve),null);assert.equal(normalizeCreatorContext(m,{...asset,sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk&v=abcdefghijk'},resolve),null);assert.equal(normalizeCreatorContext(m,{...asset,creator:'thegrefg'},resolve),null);
});
