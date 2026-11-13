import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeRevenuePreviewSource,validateRevenuePreviewSource,revenueOwnerKey,readRevenuePreviewSource,safeRevenueEvidenceUrl,revenueCandidateVersion} from '../server/office-revenue-source';
import {buildOfficeRevenuePreview,validateOfficeRevenuePreview} from '../server/office-revenue-artifact';
import {createRevenueWorkRunner,readRevenueWork,parseRevenueWork,REVENUE_WORK_KIND,revenueWorkCapacity} from '../server/office-revenue-work';
import type {BusinessPool} from '../server/office-business-sources';
const now=Date.parse('2026-11-07T04:30:00Z'),owner='owner';
const candidate={id:'candidate-one',businessName:'Fixture Bakery',area:'Miami',niche:'bakery',websiteStatus:'unknown',painPoint:'',sourceUrl:'https://bakery-fixture.net/about',evidence:'Public listing describes a bakery in Miami.',verificationStatus:'verified_public',publicEvidenceVerified:true,updatedAt:new Date(now-1000).toISOString()};
const source=(rows:any[]=[candidate])=>composeRevenuePreviewSource(owner,[{kind:'publicLeadCandidates',revision:3,data:rows}],now);
test('uses canonical candidate identity and evidence; never infers imported lead, approval or source freshness',()=>{
 const s=source(),a=buildOfficeRevenuePreview(s,owner,candidate.id,now);
 assert.equal(a.scope,'prospect_public_evidence');assert.equal(a.candidateId,candidate.id);assert.equal(a.externalActions,0);assert.equal(a.fullRoleQualification,false);assert.equal(a.htmlSha256,createHash('sha256').update(a.html).digest('hex'));assert.match(a.html,/BORRADOR INTERNO/);assert.match(a.html,/Fuente registrada \(no consultada de nuevo\)/);assert.match(a.html,/Public listing describes/);assert.doesNotMatch(a.html,/<script\b|<form\b|Commercial package and QA|\$1,500/);assert.match(a.html,/script-src 'none'/);assert.deepEqual(validateOfficeRevenuePreview(a,s,owner,now),a);
 assert.throws(()=>validateOfficeRevenuePreview({...a,html:a.html+'tamper'},s,owner,now));assert.throws(()=>validateRevenuePreviewSource(s,'another',now));assert.throws(()=>validateRevenuePreviewSource(s,owner,now+240001));
});
test('missing, unverified, duplicate, future or nonpublic sources never fabricate a business',()=>{
 assert.throws(()=>composeRevenuePreviewSource(owner,[],now));assert.throws(()=>source([candidate,candidate]));assert.throws(()=>source([{...candidate,updatedAt:new Date(now+31000).toISOString()}]));
 for(const c of [{...candidate,publicEvidenceVerified:false},{...candidate,verificationStatus:'needs_review'},{...candidate,sourceUrl:'https://127.0.0.1/'},{...candidate,sourceUrl:'https://example.com/'},{...candidate,businessName:'REPLACE ME'}]){const s=source([c]);assert.equal(s.items.length,0);assert.deepEqual(s.diagnostics,['NO_VERIFIED_MATCH']);assert.throws(()=>buildOfficeRevenuePreview(s,owner,candidate.id,now));}
 assert.equal(safeRevenueEvidenceUrl('https://user:pass@public-domain.net/'),false);assert.equal(safeRevenueEvidenceUrl('https://public-domain.net/?token=private'),false);
});
test('malicious source text stays escaped, no scripts or network resource embeds enter static HTML',()=>{
 const s=source([{...candidate,businessName:'Bakery </title><script>alert(1)</script>',evidence:'<img src="https://evil.net/x" onerror="alert(1)"> bakery evidence'}]);
 const a=buildOfficeRevenuePreview(s,owner,candidate.id,now);assert.match(a.html,/&lt;script&gt;/);assert.match(a.html,/&lt;img/);assert.doesNotMatch(a.html,/<script\b|<img\b|<iframe\b/);
});
test('reads exact durable hashed owner in readonly transaction, caps bytes and performs no bootstrap',async()=>{
 const calls:any[]=[];const pool:any={async connect(){return{release(){},async query(sql:string,args?:unknown[]){calls.push({sql,args});if(sql.includes('FROM users'))return{rows:[{id:owner}]};if(sql.includes('FROM revenue_engine_state'))return{rows:[{kind:'publicLeadCandidates',revision:3,data:[candidate]}]};return{rows:[]};}}}};
 const s=await readRevenuePreviewSource(pool,owner,now);assert.equal(s.items.length,1);assert.match(calls[0].sql,/READ ONLY/);const read=calls.find(c=>c.sql.includes('FROM revenue_engine_state'));assert.equal(read.args[0],revenueOwnerKey(owner));assert.match(read.sql,/2097152/);assert.equal(calls.some(c=>/INSERT|UPDATE|CREATE|ALTER/.test(c.sql)),false);
});

function database(){
 const records=new Map<string,any>(),queries:Array<{sql:string;params:any[]}>=[];let tail:Promise<void>=Promise.resolve();
 const read=async(sql:string,params:any[]=[]):Promise<{rows:any[]}>=>{queries.push({sql,params});if(sql.includes("FROM users"))return {rows:params[0]===owner?[{id:owner}]:[]};if(sql.startsWith("SELECT data FROM revenue_engine_state"))return {rows:records.has(params[0])?[{data:structuredClone(records.get(params[0]))}]:[]};throw Error("unexpected query");};
 const pool:BusinessPool={query:read,async connect(){let unlock:(()=>void)|undefined,pending:any;return {release(){unlock?.();},async query(sql,params=[]){
  if(sql.includes("pg_advisory_xact_lock")){const old=tail;tail=new Promise<void>(r=>{unlock=r;});await old;queries.push({sql,params});return {rows:[]};}
  if(sql.startsWith("INSERT INTO")){assert.equal(params[1],REVENUE_WORK_KIND);pending={owner:params[0],state:JSON.parse(params[2])};return {rows:[]};}
  if(sql==="COMMIT"){if(pending)records.set(pending.owner,pending.state);return {rows:[]};}if(sql==="ROLLBACK"){pending=undefined;return {rows:[]};}if(sql.startsWith("BEGIN")||sql.startsWith("SET LOCAL"))return {rows:[]};return read(sql,params);
 }};}};return {pool,records,queries};
}

test('concurrent workers reserve one fenced artifact, reload verifies it and tampering fails closed',async()=>{
 const f=database();let reads=0;const opts={pool:f.pool,owner,now:()=>now,getGeneration:async()=>1,readSource:async()=>{reads++;return source();}};
 await Promise.all([createRevenueWorkRunner(opts).tick(),createRevenueWorkRunner(opts).tick()]);const state=await readRevenueWork(f.pool,owner);assert.equal(reads,1);assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].status,'completed');assert.match(state.jobs[0].artifact!.html,/Fixture Bakery/);assert.deepEqual(parseRevenueWork(JSON.parse(JSON.stringify(state)),owner),state);
 state.jobs[0].artifact!.html+='tamper';assert.throws(()=>parseRevenueWork(state,owner));
});
test('missing verified candidate blocks explicitly; stopped and trainee generation never start reads',async()=>{
 for(const mode of ['empty','stop','trainee']){const f=database();let reads=0;await createRevenueWorkRunner({pool:f.pool,owner,now:()=>now,getGeneration:async()=>mode==='trainee'?undefined:1,shouldStop:()=>mode==='stop',readSource:async()=>{reads++;return source([]);}}).tick();const state=await readRevenueWork(f.pool,owner);
 if(mode==='empty'){assert.equal(state.jobs[0].status,'blocked');assert.equal(state.jobs[0].reason,'NO_ELIGIBLE_CANDIDATE');assert.equal(state.jobs[0].artifact,undefined);}else{assert.equal(reads,0);assert.equal(state.jobs.length,0);}}
});
test('holder loss or expired result stays unknown and never retries automatically',async()=>{
 for(const mode of ['holder','late']){const f=database();let at=now,gen:number|undefined=1;const runner=createRevenueWorkRunner({pool:f.pool,owner,now:()=>at,getGeneration:async()=>gen,readSource:async()=>{if(mode==='late')at+=60001;else gen=undefined;return source();}});await runner.tick();const state=await runner.read();assert.equal(state.jobs[0].status,'unknown');assert.equal(state.jobs[0].artifact,undefined);gen=1;at+=86400000;await runner.tick();assert.equal((await runner.read()).jobs.length,1);}
});
test('next UTC day selects another verified candidate, not the same unchanged deliverable',async()=>{
 const f=database();let at=now;const runner=createRevenueWorkRunner({pool:f.pool,owner,now:()=>at,getGeneration:async()=>1,readSource:async()=>composeRevenuePreviewSource(owner,[{kind:'publicLeadCandidates',revision:3,data:[candidate,{...candidate,id:'candidate-two'}]}],at)});
 await runner.tick();at+=86400000;await runner.tick();const state=await runner.read();assert.equal(state.jobs.length,2);assert.deepEqual(state.jobs.map(j=>j.artifact?.candidateId),['candidate-one','candidate-two']);assert.equal(revenueWorkCapacity(state).reached,false);
});

test('completed candidate exclusion occurs before the20-item cap, so later real candidates are reachable',()=>{
 const candidates=Array.from({length:21},(_,i)=>({...candidate,id:`candidate-${String(i).padStart(2,'0')}`}));const rows=[{kind:'publicLeadCandidates',revision:3,data:candidates}];
 const first=composeRevenuePreviewSource(owner,rows,now);assert.equal(first.items.length,20);assert.equal(first.eligibleTotal,21);
 const next=composeRevenuePreviewSource(owner,rows,now,new Set(first.items.map(revenueCandidateVersion)));assert.equal(next.items.length,1);assert.equal(next.items[0].id,'candidate-20');assert.equal(next.eligibleTotal,1);
});
