import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildRecoveryDigest,buildRecoverySchemaSql,enqueueFailedBuildRecovery,loadFailedBuildRecovery,recoverableFailedBuild,verifyRecoveryRebase,recoveryEquivalentPaths,RECOVERY_HARNESS_FILES} from '../server/software-factory-build-recovery';
import {OFFICE_UI_HARNESS_FILES} from '../script/software-factory-ui-static.mjs';
import {createSoftwareFactorySchemaSql} from '../server/software-factory-store';
import {councilSchemaSql} from '../server/agent-council-store';
import {createFactoryPipeline} from '../server/software-factory-pipeline';
const SELECTED=['server/office-role-work.ts','tests/office-role-work.test.ts'],RECOVERY_EQUIVALENT_PATHS=recoveryEquivalentPaths(SELECTED);
const exec=promisify(execFile),digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),owner='fixture-owner',ownerKey=createHash('sha256').update(owner).digest('hex');
test('production recovery mirrors trusted harness paths without importing its executable CLI',()=>assert.deepEqual(RECOVERY_HARNESS_FILES,OFFICE_UI_HARNESS_FILES));
test('authorization hashes survive PostgreSQL jsonb object ordering without changing array provider keys',()=>{
 assert.equal(buildRecoveryDigest({b:2,a:{z:3,y:4}}),buildRecoveryDigest({a:{y:4,z:3},b:2}));
 assert.equal(buildRecoveryDigest(['asistente','root',0]),digest(['asistente','root',0]));
});
async function repository(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'recovery-git-'));
 const git=async(...args:string[])=>(await exec('git',['-C',dir,...args],{timeout:10000})).stdout.trim();
 await git('init');
 for(const file of RECOVERY_EQUIVALENT_PATHS){await mkdir(path.dirname(path.join(dir,file)),{recursive:true});await writeFile(path.join(dir,file),'// immutable fixture\n');}
 await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');const base=await git('rev-parse','HEAD');
 await writeFile(path.join(dir,'engine-only.txt'),'trusted engine update\n');await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','engine');const target=await git('rev-parse','HEAD');
 return {dir,git,base,target,close:()=>rm(dir,{recursive:true,force:true})};
}
test('rebase proof requires ancestor and identical protected blobs, without checkout',async()=>{
 const r=await repository();try{const proof=await verifyRecoveryRebase(r.dir,r.base,r.target,SELECTED);assert.equal(proof.files.length,RECOVERY_EQUIVALENT_PATHS.length);
 await assert.rejects(verifyRecoveryRebase(r.dir,r.target,r.base,SELECTED));
 await writeFile(path.join(r.dir,RECOVERY_EQUIVALENT_PATHS[0]),'// changed source\n');await r.git('add','.');await r.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','source');await assert.rejects(verifyRecoveryRebase(r.dir,r.base,await r.git('rev-parse','HEAD'),SELECTED));
 }finally{await r.close();}
});
test('unknown, side effects, postpublication phase and repair limit never qualify',()=>{
 const job:any={id:randomUUID(),projectId:'asistente',kind:'build',status:'failed',completedAt:new Date().toISOString(),reservedCents:30,result:{status:'failed',costCents:23,reason:'FACTORY_REMOTE_BUILD_FAILED:PATCH',evidence:{pipelineState:{version:1,projectId:'asistente',rootJobId:randomUUID(),target:'staging',repairAttempts:0,evidence:[],finding:{baseSha:'a'.repeat(40),request:'real bug'}}}}};
 assert.equal(recoverableFailedBuild(job).repairAttempts,0);
 job.result.reason='FACTORY_REMOTE_BUILD_FAILED:PROVIDER_OUTPUT_LIMIT';job.result.evidence.pipelineState.repairAttempts=1;
 assert.equal(recoverableFailedBuild(job).repairAttempts,1);
 for(const mutate of [(j:any)=>delete j.completedAt,(j:any)=>j.result.status='unknown',(j:any)=>j.result.reason='FACTORY_REMOTE_BUILD_FAILED:PROVIDER_OUTPUT_LIMIT:extra',(j:any)=>j.result.reason='PROVIDER_OUTPUT_LIMIT',(j:any)=>j.result.evidence.pipelineState.evidence=[{kind:'tests'}],(j:any)=>j.headSha='c'.repeat(40)]){const bad=structuredClone(job);mutate(bad);assert.throws(()=>recoverableFailedBuild(bad));}
 for(const mutate of [(j:any)=>j.status='unknown',(j:any)=>j.result.reason='FACTORY_REMOTE_BUILD_FAILED:FINALIZE',(j:any)=>j.result.evidence.pipelineState.candidate={},(j:any)=>j.result.evidence.pipelineState.repairAttempts=2,(j:any)=>j.result.costCents=31]){const bad=structuredClone(job);mutate(bad);assert.throws(()=>recoverableFailedBuild(bad));}
});
test('workflow exception is explicit exact pair and cannot permit changed editable source',async()=>{
 const r=await repository();try{
 const file='.github/workflows/factory-candidate-checks.yml',before=await r.git('rev-parse',`${r.base}:${file}`);
 await writeFile(path.join(r.dir,file),'// reviewed workflow trigger\n');await r.git('add','.');await r.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','workflow');const target=await r.git('rev-parse','HEAD'),after=await r.git('rev-parse',`${target}:${file}`);
 await assert.rejects(verifyRecoveryRebase(r.dir,r.base,target,SELECTED));assert.deepEqual((await verifyRecoveryRebase(r.dir,r.base,target,SELECTED,{before,after})).reviewedWorkflowBlobChange,{before,after});
 await assert.rejects(verifyRecoveryRebase(r.dir,r.base,target,SELECTED,{before,after:'a'.repeat(40)}));
 await writeFile(path.join(r.dir,RECOVERY_EQUIVALENT_PATHS[0]),'// forbidden rebase change\n');await r.git('add','.');await r.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','source');await assert.rejects(verifyRecoveryRebase(r.dir,r.base,await r.git('rev-parse','HEAD'),SELECTED,{before,after}));
 }finally{await r.close();}
});
test('review-only pipeline advances provider attempt and applies approved base only to the new state',async()=>{
 const root=randomUUID(),failedId=randomUUID(),base='a'.repeat(40),target='b'.repeat(40);
 const state:any={version:1,projectId:'asistente',rootJobId:root,target:'staging',repairAttempts:0,evidence:[],finding:{id:'order',kind:'bug',request:'Fix observed bug',baseSha:base,artifactIds:['proof']}};
 const previous:any={id:failedId,ownerKey,projectId:'asistente',kind:'build',status:'failed',completedAt:new Date().toISOString(),reservedCents:30,result:{status:'failed',costCents:23,reason:'FACTORY_REMOTE_BUILD_FAILED:PATCH',evidence:{pipelineState:state}}};
 const job:any={id:randomUUID(),ownerKey,projectId:'asistente',kind:'build',key:`${failedId}.repair`,reservedCents:30,recoveryCents:0,payload:{previousJobId:failedId,repairAttempts:1,recovery:{rebase:{originalBaseSha:base,targetBaseSha:target}}}};
 let calls=0;
 const deps:any={executionMode:'review-only',project:async()=>({id:'asistente',repo:'owner/repo',testCommand:'test',buildCommand:'build',journeys:['login']}),previous:async()=>undefined,recoveryPrevious:async()=>previous,claimFinding:async()=>true,reservations:{discover:1,build:30,simulate:1,review:1},discover:async()=>({costCents:0}),simulate:async()=>{throw Error('unexpected');},review:async()=>{throw Error('unexpected');},build:async(_p:any,s:any)=>{calls++;assert.equal(s.rootJobId,root);assert.equal(s.finding.baseSha,target);assert.equal(s.repairAttempts,1);assert.notEqual(digest(['asistente',s.rootJobId,s.repairAttempts]),digest(['asistente',root,0]));return {status:'failed',costCents:0,reason:'FIXTURE_NO_PROVIDER'};}};
 const execute=()=>createFactoryPipeline(deps).adapters!.build!.execute(job,{signal:new AbortController().signal,maxCostCents:30});
 await execute();assert.equal(calls,1);assert.equal(state.finding.baseSha,base);assert.equal(state.repairAttempts,0);
 delete deps.recoveryPrevious;await assert.rejects(execute());assert.equal(calls,1);
});
test('real PostgreSQL recovery serializes duplicate admissions and rejects forged queue payloads',{timeout:120000},async t=>{
 const bin=process.env.FACTORY_TEST_POSTGRES_BIN;
 if(!bin){if(process.env.CI)throw Error('PostgreSQL binaries required in CI');t.skip('Real PostgreSQL runs in dedicated CI; no local binaries configured');return;}
 await access(path.join(bin,'initdb'));
 const dir=await mkdtemp(path.join(os.tmpdir(),'recovery-pg-')),data=path.join(dir,'data'),repo=await repository();
 const env={PATH:`${bin}:/usr/bin:/bin`,LANG:'C',LC_ALL:'C'};let started=false,pool:Pool|undefined;
 try{
  await exec(path.join(bin,'initdb'),['-D',data,'-U','fixture','--auth=trust','--no-locale','--encoding=UTF8'],{env,timeout:30000});
  await exec(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-F -h '' -k '${dir}' -p 55438`,'-w','start'],{env,timeout:30000});started=true;
  pool=new Pool({host:dir,port:55438,user:'fixture',database:'postgres',max:12});
  await pool.query(createSoftwareFactorySchemaSql());await pool.query(councilSchemaSql);await pool.query(buildRecoverySchemaSql);await pool.query(buildRecoverySchemaSql);
  const at=new Date(),stamp=at.toISOString(),month=stamp.slice(0,7),rootId=randomUUID(),failedId=randomUUID();
  const grant={id:'fixture-grant',accountScope:'fixture-account',availableMicroUsd:10000000,observedAt:new Date(+at-60000).toISOString(),expiresAt:new Date(+at+3600000).toISOString(),verificationEvidenceId:'fixture-proof'};
  const state={version:1,projectId:'asistente',rootJobId:rootId,target:'staging',repairAttempts:0,evidence:[],finding:{id:'real-order',kind:'bug',request:'Fix observed deadline',baseSha:repo.base,artifactIds:['fixture-reproduction'],sourcePaths:SELECTED}};
  const rootInput={key:'original-order',projectId:'asistente',kind:'discover',reservedCents:1,recoveryCents:0,payload:{companyOrder:{orderId:'real-order',revision:'d'.repeat(64)}}},failedInput={key:`${rootId}.next`,projectId:'asistente',kind:'build',reservedCents:30,recoveryCents:0,payload:{previousJobId:rootId,repairAttempts:0}};
  const outcome={status:'failed',costCents:23,reason:'FACTORY_REMOTE_BUILD_FAILED:PATCH',evidence:{pipelineState:state}},providerKey=`factory:${digest(['asistente',rootId,0])}`;
  const credit={version:1,grant,lastObservedAt:stamp,reservations:[{key:providerKey,consumer:'factory',requestSha256:'b'.repeat(64),reservedMicroUsd:300000,createdAt:new Date(+at-1000).toISOString(),status:'settled',actualMicroUsd:225001,settlementEvidenceId:'provider-real-receipt',settledAt:stamp,reconciled:false}]};
  const namespace=createHash('sha256').update(JSON.stringify(['shared-openai-credit-ledger-v1',grant.accountScope])).digest('hex');
  const seed=async()=>{
   await pool!.query('TRUNCATE software_factory_build_recoveries,software_factory_jobs,software_factory_controls,software_factory_budget,software_factory_projects,agent_council_state');
   await pool!.query('INSERT INTO software_factory_controls(owner_key,paused) VALUES($1,true)',[ownerKey]);
   await pool!.query('INSERT INTO software_factory_budget(owner_key,month,fixed_cents,spent_cents,reserved_cents) VALUES($1,$2,0,23,0)',[ownerKey,month]);
   await pool!.query('INSERT INTO software_factory_projects(owner_key,id,config) VALUES($1,$2,$3)',[ownerKey,'asistente',JSON.stringify({repo:'robertmanzanillag-jpg/blackops',automaticRelease:false,providerSupportsRelease:false,providerSupportsRollback:false})]);
   for(const [id,input,status,result] of [[rootId,rootInput,'completed',{status:'completed',costCents:0,evidence:{pipelineState:state}}],[failedId,failedInput,'failed',outcome]] as const)await pool!.query('INSERT INTO software_factory_jobs(id,owner_key,month,input,request_hash,job_key,status,completed_at,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,ownerKey,month,JSON.stringify(input),digest(input),input.key,status,stamp,JSON.stringify(result)]);
   await pool!.query('INSERT INTO agent_council_state(owner_key,state) VALUES($1,$2)',[namespace,JSON.stringify(credit)]);
  };
  const options={pool,owner,grant,repositoryPath:repo.dir,targetBaseSha:repo.target,now:()=>new Date(+at+1000),request:{failedJobId:failedId,rootJobId:rootId,baseSha:repo.base,attempt:0,reservedCents:30,sourcePaths:SELECTED}};
  await seed();const before=JSON.stringify((await pool.query('SELECT state FROM agent_council_state')).rows[0]);
  const jobs=await Promise.all(Array.from({length:6},()=>enqueueFailedBuildRecovery(options)));
  assert.equal(new Set(jobs.map(j=>j.id)).size,1);assert.equal((await pool.query('SELECT reserved_cents FROM software_factory_budget')).rows[0].reserved_cents,30);
  assert.equal(JSON.stringify((await pool.query('SELECT state FROM agent_council_state')).rows[0]),before);
  assert.deepEqual((await pool.query('SELECT result FROM software_factory_jobs WHERE id=$1',[failedId])).rows[0].result,outcome);
  assert.equal((await loadFailedBuildRecovery(pool,ownerKey,failedId,jobs[0].id))?.id,failedId);
  await pool.query('UPDATE software_factory_controls SET paused=false');assert.equal((await enqueueFailedBuildRecovery(options)).id,jobs[0].id);
  await pool.query('DELETE FROM software_factory_build_recoveries');assert.equal(await loadFailedBuildRecovery(pool,ownerKey,failedId,jobs[0].id),undefined);await assert.rejects(enqueueFailedBuildRecovery(options));
  await seed();const first=await enqueueFailedBuildRecovery(options);
  const retryState={...state,repairAttempts:1,finding:{...state.finding,baseSha:repo.target}};
  await pool.query("UPDATE software_factory_jobs SET status='failed',completed_at=$2,result=$3 WHERE id=$1",[first.id,stamp,JSON.stringify({...outcome,costCents:7,reason:'FACTORY_REMOTE_BUILD_FAILED:PROVIDER_OUTPUT_LIMIT',evidence:{pipelineState:retryState}})]);
  await pool.query('UPDATE software_factory_budget SET reserved_cents=0,spent_cents=30');
  const retryCredit=structuredClone(credit);retryCredit.reservations.push({...retryCredit.reservations[0],key:`factory:${digest(['asistente',rootId,1])}`,actualMicroUsd:70000,settlementEvidenceId:'provider-retry-receipt'});
  await pool.query('UPDATE agent_council_state SET state=$1',[JSON.stringify(retryCredit)]);
  const second=await enqueueFailedBuildRecovery({...options,request:{...options.request,failedJobId:first.id,baseSha:repo.target,attempt:1}});
  assert.equal(second.payload.repairAttempts,2);assert.notEqual(second.id,first.id);assert.equal((await loadFailedBuildRecovery(pool,ownerKey,first.id,second.id))?.id,first.id);
  await assert.rejects(enqueueFailedBuildRecovery({...options,request:{...options.request,attempt:2}}));
  for(const change of ['cost','unknown','reserved','unpaused','cap']){
   await seed();
   if(change==='cost')await pool.query("UPDATE agent_council_state SET state=jsonb_set(state,'{reservations,0,actualMicroUsd}','1')");
   if(change==='unknown'||change==='reserved'){const changed=structuredClone(credit) as any;changed.reservations.push({key:'other',consumer:'office',requestSha256:'c'.repeat(64),reservedMicroUsd:1,createdAt:stamp,status:change,...(change==='unknown'?{unknownEvidenceId:'unconfirmed'}:{})});await pool.query('UPDATE agent_council_state SET state=$1',[JSON.stringify(changed)]);}
   if(change==='unpaused')await pool.query('UPDATE software_factory_controls SET paused=false');
   if(change==='cap')await pool.query('UPDATE software_factory_budget SET fixed_cents=9970');
   await assert.rejects(enqueueFailedBuildRecovery(options));assert.equal((await pool.query('SELECT count(*)::int n FROM software_factory_build_recoveries')).rows[0].n,0);assert.equal((await pool.query('SELECT reserved_cents FROM software_factory_budget')).rows[0].reserved_cents,0);
  }
 }finally{await pool?.end();if(started)await exec(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,timeout:15000});await repo.close();await rm(dir,{recursive:true,force:true});}
});

test('recovery equivalence follows the persisted per-order selection, not a hard-coded pair',async()=>{
 const selected=['client/src/pages/office.tsx','tests/office.test.ts'];
 assert.deepEqual(recoveryEquivalentPaths(selected).slice(0,2),selected);
 assert.ok(recoveryEquivalentPaths(selected).includes('.github/workflows/factory-candidate-checks.yml'));
 for(const bad of [[],['package.json'],['server/../x.ts'],['.github/workflows/x.yml'],Array.from({length:9},(_,i)=>`server/f${i}.ts`)])assert.throws(()=>recoveryEquivalentPaths(bad));
 const r=await repository();try{
  for(const file of selected){await mkdir(path.dirname(path.join(r.dir,file)),{recursive:true});await writeFile(path.join(r.dir,file),'// selected\n');}
  await r.git('add','.');await r.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','selected');const base=await r.git('rev-parse','HEAD');
  await writeFile(path.join(r.dir,'server/office-role-work.ts'),'// unselected change is allowed\n');await r.git('add','.');await r.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','other');const target=await r.git('rev-parse','HEAD');
  const proof=await verifyRecoveryRebase(r.dir,base,target,selected);assert.deepEqual(proof.files.slice(0,2).map(f=>f[0]),selected);
  await assert.rejects(verifyRecoveryRebase(r.dir,base,target,SELECTED));
  await writeFile(path.join(r.dir,selected[0]),'// selected change forbidden\n');await r.git('add','.');await r.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','sel');
  await assert.rejects(verifyRecoveryRebase(r.dir,base,await r.git('rev-parse','HEAD'),selected));
  await assert.rejects(verifyRecoveryRebase(r.dir,base,target,['package.json']));
 }finally{await r.close();}
});

test('recovery pipeline rejects a rebase proof that does not cover the persisted selection',async()=>{
 const root=randomUUID(),failedId=randomUUID(),base='a'.repeat(40),target='b'.repeat(40);
 const state:any={version:1,projectId:'asistente',rootJobId:root,target:'staging',repairAttempts:0,evidence:[],finding:{id:'order',kind:'bug',request:'Fix',baseSha:base,artifactIds:['proof'],sourcePaths:['server/a.ts','tests/a.test.ts']}};
 const previous:any={id:failedId,ownerKey,projectId:'asistente',kind:'build',status:'failed',completedAt:new Date().toISOString(),reservedCents:30,result:{status:'failed',costCents:23,reason:'FACTORY_REMOTE_BUILD_FAILED:PATCH',evidence:{pipelineState:state}}};
 let calls=0,seen:any;
 const deps:any={executionMode:'review-only',project:async()=>({id:'asistente',repo:'owner/repo',testCommand:'test',buildCommand:'build',journeys:['login']}),previous:async()=>undefined,recoveryPrevious:async()=>previous,claimFinding:async()=>true,reservations:{discover:1,build:30,simulate:1,review:1},discover:async()=>({costCents:0}),simulate:async()=>{throw Error('unexpected');},review:async()=>{throw Error('unexpected');},build:async(_p:any,s:any)=>{calls++;seen=s;return {status:'failed',costCents:0,reason:'stop'};}};
 const job=(files:unknown):any=>({id:randomUUID(),ownerKey,projectId:'asistente',kind:'build',key:`${failedId}.repair`,reservedCents:30,recoveryCents:0,payload:{previousJobId:failedId,repairAttempts:1,recovery:{rebase:{originalBaseSha:base,targetBaseSha:target,files}}}});
 const run=(files:unknown)=>createFactoryPipeline(deps).adapters!.build!.execute(job(files),{signal:new AbortController().signal,maxCostCents:30});
 await assert.rejects(run([['server/a.ts','c'.repeat(40)]]),/RECOVERY_UNTRUSTED/);assert.equal(calls,0);
 await run([['server/a.ts','c'.repeat(40)],['tests/a.test.ts','d'.repeat(40)]]);assert.equal(calls,1);
 assert.deepEqual(seen.finding.sourcePaths,['server/a.ts','tests/a.test.ts']);assert.equal(seen.finding.baseSha,target);
});
