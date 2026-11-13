import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { createSoftwareFactorySchemaSql, createSoftwareFactoryStore } from '../server/software-factory-store';
import type { OfficeCloudPool } from '../server/office-cloud-store';

const exec = promisify(execFile);
const bin = process.env.FACTORY_TEST_POSTGRES_BIN || '/opt/homebrew/opt/postgresql@16/bin';
// No production connection string is read. This fixture initializes a new local
// database with only a private Unix socket, and destroys it after the test.
test('factory PostgreSQL transactional integration', { timeout: 120000 }, async t => {
 try { await access(path.join(bin,'initdb')); } catch { t.skip('Install PostgreSQL tools or set FACTORY_TEST_POSTGRES_BIN to run the real database fixture.'); return; }
 const root=await mkdtemp(path.join(os.tmpdir(),'fpg-')),data=path.join(root,'data');
 const env={PATH:`${bin}:/usr/bin:/bin`,LANG:'C',LC_ALL:'C'};
 let started=false;let pool:Pool|undefined;
 try {
  await exec(path.join(bin,'initdb'),['-D',data,'-U','factory_fixture','--auth=trust','--no-locale','--encoding=UTF8'],{env,timeout:30000});
  await exec(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-F -h '' -k '${root}' -p 55439`,'-w','start'],{env,timeout:30000});started=true;
  pool=new Pool({host:root,port:55439,user:'factory_fixture',database:'postgres',max:12});
  await pool.query(createSoftwareFactorySchemaSql());
  const store=createSoftwareFactoryStore(pool as unknown as OfficeCloudPool),month=new Date().toISOString().slice(0,7);
  const reset=async()=>{await pool!.query('TRUNCATE software_factory_jobs,software_factory_budget,software_factory_controls,software_factory_projects,software_factory_workers,software_factory_findings');};
  const setup=async(owner='owner',fixed=0)=>{await store.initializeMonth(owner,month,fixed);await store.setPaused(owner,false);};
  const input=(key:string,reservedCents=100)=>({key,projectId:'pilot',kind:'build' as const,reservedCents,payload:{}});
  await t.test('concurrent reservations never exceed remaining monthly budget',async()=>{
   await reset();await setup('owner',9000);
   const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>store.enqueue('owner',input(`job-${i}`,300))));
   assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,3);
   const status=await store.status('owner');assert.equal(status.fixedCents+status.reservedCents+status.spentCents,9900);
   assert.equal((await store.list('owner')).length,3);
  });
  await t.test('concurrent duplicate requests reserve only once; changed request conflicts',async()=>{
   await reset();await setup();
   const jobs=await Promise.all(Array.from({length:8},()=>store.enqueue('owner',input('same',200))));
   assert.equal(new Set(jobs.map(j=>j.id)).size,1);assert.equal((await store.status('owner')).reservedCents,200);
   await assert.rejects(store.enqueue('owner',input('same',201)),/IDEMPOTENCY_CONFLICT/);
  });
  await t.test('global slot permits one worker across concurrent owners',async()=>{
   await reset();await setup('one');await setup('two');await store.enqueue('one',input('one'));await store.enqueue('two',input('two'));
   const claims=await Promise.all(Array.from({length:8},(_,i)=>store.claim(`worker-${i}`)));
   assert.equal(claims.filter(Boolean).length,1);
   assert.equal((await pool!.query("SELECT count(*)::int n FROM software_factory_jobs WHERE status='running'")).rows[0].n,1);
  });
  await t.test('stale fence cannot settle budget or complete a job',async()=>{
   await reset();await setup();await store.enqueue('owner',input('fence',200));const job=(await store.claim('worker'))!;
   assert.equal(await store.complete({...job,fence:'00000000-0000-4000-8000-000000000000'},{status:'completed',costCents:25}),false);
   assert.equal((await store.status('owner')).reservedCents,200);
   assert.equal(await store.complete(job,{status:'completed',costCents:25}),true);
   const status=await store.status('owner');assert.equal(status.reservedCents,0);assert.equal(status.spentCents,25);
   assert.equal(await store.complete(job,{status:'completed',costCents:25}),false);
  });
  await t.test('expired execution retains reservation and blocks slot until proven reconciliation',async()=>{
   await reset();await setup();await store.enqueue('owner',input('expires',200));await store.enqueue('owner',input('later',100));const job=(await store.claim('worker'))!;
   await pool!.query("UPDATE software_factory_jobs SET lease_expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[job.id]);
   assert.equal(await store.complete(job,{status:'completed',costCents:25}),false);
   assert.equal(await store.expire(),1);assert.equal(await store.claim('another'),undefined);
   assert.equal((await store.status('owner')).reservedCents,300);
   await assert.rejects(store.reconcile('owner',job.id,{actualCostCents:30,executionStopped:false,reason:'fixture'}),/PROOF_REQUIRED/);
   await assert.rejects(store.reconcile('different-owner',job.id,{actualCostCents:30,executionStopped:true,reason:'fixture'}),/UNKNOWN_JOB_REQUIRED/);
   await store.reconcile('owner',job.id,{actualCostCents:30,executionStopped:true,reason:'Fixture process stopped and usage verified'});
   const status=await store.status('owner');assert.equal(status.spentCents,30);assert.equal(status.reservedCents,100);assert.equal(status.paused,true);
   assert.equal(await store.claim('another'),undefined);await store.setPaused('owner',false);assert.ok(await store.claim('another'));
   await assert.rejects(store.reconcile('owner',job.id,{actualCostCents:30,executionStopped:true,reason:'duplicate'}),/UNKNOWN_JOB_REQUIRED/);
  });
  await t.test('zero-cost deferral requeues a claimed job until notBefore and keeps its reservation',async()=>{
   await reset();await setup();await store.enqueue('owner',input('deferred',200));const job=(await store.claim('worker'))!;
   const soon=new Date(Date.now()+1500).toISOString(),later=new Date(Date.now()+3600000).toISOString();
   assert.equal(await store.defer({...job,fence:'00000000-0000-4000-8000-000000000000'},{reason:'FACTORY_DAILY_DRAFT_PR_LIMIT',notBefore:later}),false);
   if(later.slice(0,7)===month){assert.equal(await store.defer(job,{reason:'FACTORY_DAILY_DRAFT_PR_LIMIT',notBefore:soon}),true);
    assert.equal(await store.complete(job,{status:'completed',costCents:1}),false);
    const status=await store.status('owner');assert.equal(status.reservedCents,200);assert.equal(status.spentCents,0);
    assert.equal(await store.claim('worker'),undefined);
    await new Promise(r=>setTimeout(r,1700));const again=(await store.claim('worker'))!;assert.equal(again.id,job.id);
    assert.equal(await store.complete(again,{status:'blocked',costCents:0}),true);assert.equal((await store.status('owner')).reservedCents,0);}
   await assert.rejects(store.defer(job,{reason:'bad reason',notBefore:later}));
  });
  await t.test('completion and next stage reservation commit together without duplication',async()=>{
   await reset();await setup();await store.enqueue('owner',input('first',200));const job=(await store.claim('worker'))!;
   const next={...input('ignored',150),kind:'simulate' as const};
   assert.equal(await store.complete(job,{status:'completed',costCents:20},next),true);
   assert.equal(await store.complete(job,{status:'completed',costCents:20},next),false);
   const status=await store.status('owner');assert.equal(status.spentCents,20);assert.equal(status.reservedCents,150);assert.equal((await store.list('owner')).length,2);
  });
  await t.test('recovery escrow survives exact cap and pause through verify and rollback',async()=>{
   await reset();await setup('owner',9850);
   await store.enqueue('owner',{...input('release',150),kind:'deploy',recoveryCents:50});
   await assert.rejects(store.enqueue('owner',input('competing',1)),/BUDGET_UNAVAILABLE/);
   const deploy=(await store.claim('worker'))!;assert.equal(deploy.kind,'deploy');
   assert.equal(await store.complete(deploy,{status:'completed',costCents:100},{...input('verify',50),kind:'verify',recoveryCents:30}),true);
   let status=await store.status('owner');assert.equal(status.spentCents,100);assert.equal(status.reservedCents,50);
   assert.equal(status.fixedCents+status.spentCents+status.reservedCents,10000);
   await store.setPaused('owner',true);
   const verify=(await store.claim('worker'))!;assert.ok(verify,'Recovery verification must run despite pause');assert.equal(verify.kind,'verify');
   assert.equal(await store.complete(verify,{status:'completed',costCents:20},{...input('rollback',30),kind:'rollback',recoveryCents:0}),true);
   const rollback=(await store.claim('worker'))!;assert.ok(rollback,'Escrowed rollback must run despite pause');assert.equal(rollback.kind,'rollback');
   assert.equal(await store.complete(rollback,{status:'completed',costCents:30}),true);
   status=await store.status('owner');assert.equal(status.spentCents,150);assert.equal(status.reservedCents,0);assert.equal(status.fixedCents+status.spentCents,10000);assert.equal(status.paused,true);
  });
  await t.test('actual overrun records full cost and pauses further work',async()=>{
   await reset();await setup();await store.enqueue('owner',input('overrun',100));const job=(await store.claim('worker'))!;
   await store.complete(job,{status:'completed',costCents:150});const status=await store.status('owner');assert.equal(status.spentCents,150);assert.equal(status.reservedCents,0);assert.equal(status.paused,true);
  });
 } finally {
  await pool?.end();
  if(started)await exec(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,timeout:15000});
  await rm(root,{recursive:true,force:true});
 }
});
