import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {superviseStartup,retryableReadinessFailure,verifySupervisorInstallation,STARTUP_RETRY_CONTRACT,launchWorker} from '../script/kong-repair-startup-supervisor.mjs';
import {installPlan,upgradeReviewedInstallation} from '../script/install-kong-repair-subscription-worker.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blocked={exitCode:1,signal:null,stdout:'',stderr:JSON.stringify({state:'blocked',reasonCode:'WORKER_NOT_READY',paidApiSpendUsd:0}),overflow:false,timedOut:false};
const idle={exitCode:0,signal:null,stdout:'{"state":"idle","paidApiSpendUsd":0}\n',stderr:'',overflow:false,timedOut:false};
test('only exact preconsume readiness failures get two bounded startup retries',async()=>{
 let calls=0;const sleeps=[];const result=await superviseStartup({run:async()=>++calls===1?blocked:idle,sleep:async ms=>sleeps.push(ms)});assert.equal(calls,2);assert.equal(result.exitCode,0);assert.deepEqual(sleeps,[5000]);
 calls=0;sleeps.length=0;const failed=await superviseStartup({run:async()=>{calls++;return blocked;},sleep:async ms=>sleeps.push(ms)});assert.equal(calls,3);assert.equal(failed.exitCode,1);assert.deepEqual(sleeps,[5000,5000]);
});
test('postclaim states, signals, timeouts, extra output and changed schemas never retry',async()=>{
 for(const patch of [{stdout:'claim attempted'}, {signal:'SIGTERM'}, {timedOut:true}, {overflow:true}, {exitCode:0}, {stderr:blocked.stderr+'\n'+blocked.stderr},
  {stderr:JSON.stringify({state:'maker_unknown',reasonCode:'WORKER_NOT_READY',paidApiSpendUsd:0})},{stderr:JSON.stringify({state:'blocked',reasonCode:'WORKER_NOT_READY',paidApiSpendUsd:1})},
  {stderr:JSON.stringify({state:'blocked',reasonCode:'WORKER_NOT_READY',paidApiSpendUsd:0,extra:true})},{stderr:JSON.stringify({state:'blocked',reasonCode:'VALIDATION_FAILED',paidApiSpendUsd:0})}]){
  let calls=0;const value={...blocked,...patch};assert.equal(retryableReadinessFailure(value),false);await superviseStartup({run:async()=>{calls++;return value;},sleep:async()=>assert.fail('no sleep')});assert.equal(calls,1);
 }
});
test('supervisor installation binds exact reviewed worker and supervisor bytes',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'kong-supervisor-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const worker=Buffer.from('// reviewed worker'),supervisor=Buffer.from('// reviewed supervisor');
 for(const [name,value] of [['kong-repair-subscription-worker.mjs',worker],['kong-repair-startup-supervisor.mjs',supervisor],['installation.json',JSON.stringify({reviewedSha:'a'.repeat(40),workerSha256:hash(worker),supervisorSha256:hash(supervisor),startupRetryContract:STARTUP_RETRY_CONTRACT})]])await fs.writeFile(path.join(root,name),value,{mode:0o600});
 assert.equal(await verifySupervisorInstallation(root),path.join(root,'kong-repair-subscription-worker.mjs'));await fs.appendFile(path.join(root,'kong-repair-subscription-worker.mjs'),'changed');await assert.rejects(verifySupervisorInstallation(root),/UNCONFIRMED/);
});
async function upgradeFixture(t){
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'kong-upgrade-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));const plan=installPlan(home);await fs.mkdir(plan.root,{recursive:true,mode:0o700});await fs.mkdir(path.dirname(plan.plist),{recursive:true});const old=Buffer.from('// old reviewed worker');
 await fs.writeFile(plan.script,old,{mode:0o600});await fs.writeFile(path.join(plan.root,'installation.json'),JSON.stringify({reviewedSha:'a'.repeat(40),workerSha256:hash(old),installedAt:'original'}),{mode:0o600});
 await fs.writeFile(plan.plist,plan.content.replace(plan.supervisor,plan.script),{mode:0o600});
 const journal=path.join(plan.root,'f'.repeat(64)+'.json'),health=path.join(plan.root,'health-pointer.json');await fs.writeFile(journal,JSON.stringify({state:'maker_unknown',modelReservations:[{kind:'maker'}]}),{mode:0o600});await fs.writeFile(health,JSON.stringify({pending:true,writtenAt:'unchanged',issueNumber:8,commentId:9}),{mode:0o600});
 const calls=[];return{plan,old,journal,health,calls,run:async(binary,args)=>{calls.push({binary,args});return{exitCode:0,output:args[0]==='print'?'state = not running\n':''};}};
}
test('guarded upgrade preserves unknown journals and pending health receipts while backing up old engine',async t=>{
 const f=await upgradeFixture(t),beforeJournal=await fs.readFile(f.journal),beforeHealth=await fs.readFile(f.health),workerBytes=Buffer.from('// new reviewed worker'),supervisorBytes=Buffer.from('// new reviewed supervisor');
 const result=await upgradeReviewedInstallation({...f,workerBytes,supervisorBytes,reviewedSha:'b'.repeat(40),fromReviewedSha:'a'.repeat(40)});
 assert.deepEqual(await fs.readFile(f.journal),beforeJournal);assert.deepEqual(await fs.readFile(f.health),beforeHealth);assert.deepEqual(await fs.readFile(path.join(result.backupDirectory,'worker.mjs')),f.old);
 const identity=JSON.parse(await fs.readFile(path.join(f.plan.root,'installation.json'),'utf8'));assert.equal(identity.reviewedSha,'b'.repeat(40));assert.equal(identity.installedAt,'original');assert.equal(identity.previousReviewedSha,'a'.repeat(40));assert.equal(identity.workerSha256,hash(workerBytes));assert.equal(result.kickstartPerformed,false);
 assert.deepEqual(f.calls.map(c=>c.args[0]),['print','print','bootout','-lint','bootstrap']);assert.ok((await fs.readFile(f.plan.plist,'utf8')).includes(f.plan.supervisor));
});
test('running worker, existing lock and changed installed identity stop before any upgrade',async t=>{
 for(const kind of ['running','lock','identity']){
  const f=await upgradeFixture(t),before=await fs.readFile(f.plan.script);if(kind==='lock')await fs.writeFile(path.join(f.plan.root,'worker.lock'),'unknown');if(kind==='identity')await fs.appendFile(f.plan.script,'unexpected');
  await assert.rejects(upgradeReviewedInstallation({...f,workerBytes:Buffer.from('new'),supervisorBytes:Buffer.from('new supervisor'),reviewedSha:'b'.repeat(40),fromReviewedSha:'a'.repeat(40),run:kind==='running'?async()=>({exitCode:0,output:'state = running\npid = 123\n'}):f.run}));
  assert.deepEqual(await fs.readFile(f.plan.script),kind==='identity'?Buffer.concat([before,Buffer.from('unexpected')]):before);assert.equal(f.calls.some(c=>c.args[0]==='bootout'),false);
 }
});

test('automatic startup overrides and changed cadence are refused before bootout or code writes',async t=>{
 for(const mutate of [text=>text.replace('<key>RunAtLoad</key><false/>','<key>RunAtLoad</key><true/>'),text=>text.replace('<key>RunAtLoad</key><false/>','<key>RunAtLoad</key><false/><key>KeepAlive</key><true/>'),text=>text.replace('<key>StartInterval</key><integer>1800</integer>','<key>StartInterval</key><integer>1</integer>')]){
  const f=await upgradeFixture(t),old=await fs.readFile(f.plan.script);await fs.writeFile(f.plan.plist,mutate(await fs.readFile(f.plan.plist,'utf8')));
  await assert.rejects(upgradeReviewedInstallation({...f,workerBytes:Buffer.from('new'),supervisorBytes:Buffer.from('new supervisor'),reviewedSha:'b'.repeat(40),fromReviewedSha:'a'.repeat(40)}),/trusted schedule/);
  assert.equal(f.calls.some(c=>c.args[0]==='bootout'),false);assert.deepEqual(await fs.readFile(f.plan.script),old);
 }
});
