import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createSoftwareFactorySchemaSql,createSoftwareFactoryStore} from '../server/software-factory-store';
import type {OfficeCloudPool} from '../server/office-cloud-store';
const exec=promisify(execFile),bin=process.env.FACTORY_TEST_POSTGRES_BIN||'/opt/homebrew/opt/postgresql@16/bin';
test('API authority uses actual PostgreSQL lock, rollback, monthly liabilities and parent escrow',{timeout:120000},async t=>{
 try{await access(path.join(bin,'initdb'));}catch{t.skip('PostgreSQL fixture tools unavailable');return;}
 const root=await mkdtemp(path.join(os.tmpdir(),'factory-api-pg-')),data=path.join(root,'data'),env={PATH:`${bin}:/usr/bin:/bin`,LANG:'C',LC_ALL:'C'};
 let pool:Pool|undefined,started=false;
 try{
  await exec(path.join(bin,'initdb'),['-D',data,'-U','fixture','--auth=trust','--no-locale','--encoding=UTF8'],{env,timeout:30000});
  await exec(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-F -h '' -k '${root}' -p 55447`,'-w','start'],{env,timeout:30000});started=true;
  pool=new Pool({host:root,port:55447,user:'fixture',database:'postgres',max:12});await pool.query(createSoftwareFactorySchemaSql());
  const store=createSoftwareFactoryStore(pool as unknown as OfficeCloudPool),owner='fixture-owner',key=createHash('sha256').update(owner).digest('hex'),now=new Date().toISOString(),month=now.slice(0,7),sha='a'.repeat(64);
  const checkpoint={month,reconciledAt:now,evidenceSha256:sha,externalSpentMicroUsd:0,externalReservedMicroUsd:0,externalUnknownReservations:0,complete:true as const};
  const input=(k:string,maximumMicroUsd=40_000_000)=>({key:k,requestSha256:sha,maximumMicroUsd,consumer:'office' as const});
  const reset=async()=>{await pool!.query('TRUNCATE software_factory_api_authority,software_factory_jobs,software_factory_budget,software_factory_controls');await store.initializeMonth(owner,month,0);};
  await t.test('no inferred checkpoint from existing budget, no writes on denied admission',async()=>{await reset();const before=await store.apiBudgetStatus(owner);assert.equal(before.remainingMicroUsd,null);await assert.rejects(store.reserveApi(owner,input('no')),/RECONCILIATION_REQUIRED/);assert.equal((await pool!.query('SELECT count(*)::int n FROM software_factory_api_authority')).rows[0].n,0);});
  await t.test('concurrent API and Factory escrows share one lock and limit',async()=>{await reset();await store.checkpointApiMonth(owner,checkpoint);const out=await Promise.allSettled([store.reserveApi(owner,input('office')),store.reserveApi(owner,{...input('academy'),consumer:'academy'}),store.enqueue(owner,{key:'factory',projectId:'p',kind:'build',reservedCents:4000,payload:{}})]);assert.equal(out.filter(x=>x.status==='fulfilled').length,2);const status=await store.apiBudgetStatus(owner);assert.equal(status.reservedMicroUsd,80_000_000);});
  await t.test('duplicate persisted API reservation never grants second dispatch',async()=>{await reset();await store.checkpointApiMonth(owner,checkpoint);const out=await Promise.all(Array.from({length:6},()=>store.reserveApi(owner,input('same',100))));assert.equal(out.filter(x=>x.admitted).length,1);await store.settleApi(owner,'same',{actualMicroUsd:17,evidenceSha256:sha});await store.settleApi(owner,'same',{actualMicroUsd:17,evidenceSha256:sha});assert.equal((await store.apiBudgetStatus(owner)).spentMicroUsd,17);});
  await t.test('prior-month Factory unknown and reservations constrain current admission',async()=>{await reset();await store.checkpointApiMonth(owner,checkpoint);const old='2025-01',id=randomUUID(),job={key:'old',projectId:'p',kind:'build',reservedCents:9900,recoveryCents:0,payload:{}};await pool!.query('INSERT INTO software_factory_budget(owner_key,month,fixed_cents,reserved_cents) VALUES($1,$2,0,9900)',[key,old]);await pool!.query("INSERT INTO software_factory_jobs(id,owner_key,month,input,request_hash,job_key,status) VALUES($1,$2,$3,$4::jsonb,$5,'old','unknown')",[id,key,old,JSON.stringify(job),sha]);assert.equal((await store.apiBudgetStatus(owner)).reservedMicroUsd,99_000_000);assert.equal((await store.apiBudgetStatus(owner)).unknown,true);await assert.rejects(store.reserveApi(owner,input('new',1)),/UNKNOWN_HOLD/);});
  await t.test('parent child cannot release escrow without verified cost; rollback preserves job',async()=>{await reset();await store.checkpointApiMonth(owner,checkpoint);await store.setPaused(owner,false);await store.enqueue(owner,{key:'parent',projectId:'p',kind:'build',reservedCents:100,payload:{}});const parent=(await store.claim('worker'))!;const child={...input('child',100),parent:{jobId:parent.id,fence:parent.fence!}};await store.reserveApi(owner,child);await assert.rejects(store.complete(parent,{status:'completed',costCents:0}),/CHILD_UNCONFIRMED/);await store.settleApi(owner,'child',{actualMicroUsd:17,evidenceSha256:sha});await assert.rejects(store.complete(parent,{status:'completed',costCents:0}),/COST_UNDERSTATED/);assert.equal(await store.complete(parent,{status:'completed',costCents:1}),true);assert.equal((await store.apiBudgetStatus(owner)).spentMicroUsd,10000);});
  await t.test('external unknown receipt blocks even if nominal allowance remains',async()=>{await reset();await store.checkpointApiMonth(owner,{...checkpoint,externalUnknownReservations:1,externalReservedMicroUsd:1});assert.equal((await store.apiBudgetStatus(owner)).reason,'FACTORY_API_UNKNOWN_HOLD');await assert.rejects(store.reserveApi(owner,input('no',1)),/UNKNOWN_HOLD/);});
 }finally{await pool?.end();if(started)await exec(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','stop'],{env,timeout:30000});await rm(root,{recursive:true,force:true});}
});
