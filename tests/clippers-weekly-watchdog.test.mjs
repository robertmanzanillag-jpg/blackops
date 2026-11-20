import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runClippersDailyWatchdog} from '../script/clippers-daily-watchdog.mjs';
import {runWeeklySchedulingChild,remainingWeeklyWindow} from '../script/clippers-weekly-scheduler.mjs';
const NOW=new Date('2026-11-18T15:00:00Z'),window={startDate:'2026-11-18',endDate:'2026-11-22'};
async function fixture(t){const root=await realpath(await mkdtemp(path.join(tmpdir(),'clippers-weekly-watchdog-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function input(root,publish,assets){const p=path.join(root,'config/clippers-daily-learning');await mkdir(p,{recursive:true,mode:0o700});await writeFile(path.join(p,'approved-input.json'),JSON.stringify({schemaVersion:1,publish,assets,reviews:[]}),{mode:0o600});}
test('autonomous weekly phase requires due time, existing publishing approval and explicit editorial assets',async t=>{
 const root=await fixture(t),order=[],env={CLIPPERS_PORTFOLIO_PREPARE_ENABLED:'true',CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED:'true'};
 const options={workspaceRoot:root,env,now:NOW,dailyPrepare:true,dailyLearning:true,runPortfolioPrepare:async()=>{order.push('prepare');return{status:'prepared',prepared:1,uploaded:0,paidSpendUsd:0};},runWeeklySchedulingChild:async args=>{order.push('weekly');assert.deepEqual(args.window,window);await assert.rejects(readFile(path.join(root,'reports/metricool-autopilot.lock')),/ENOENT/);return{status:'partial_scheduled',scheduled:1,attempts:1,ready:1,paidSpendUsd:0};},runClippersDailyLearning:async()=>{order.push('learn');return{status:'already_completed'};}};
 await input(root,true,[{editorialPolicy:'evergreen_streamer_clip'}]);let r=await runClippersDailyWatchdog({...options,now:new Date('2026-11-18T14:59:00Z')});assert.deepEqual(order,[]);assert.equal(r.weeklyScheduling,undefined);
 await input(root,false,[{editorialPolicy:'evergreen_streamer_clip'}]);await runClippersDailyWatchdog(options);assert.deepEqual(order,['prepare','learn']);order.length=0;
 await input(root,true,[{id:'ordinary-legacy'}]);await runClippersDailyWatchdog(options);assert.deepEqual(order,['prepare','learn']);order.length=0;
 await input(root,true,[{editorialPolicy:'evergreen_streamer_clip'}]);r=await runClippersDailyWatchdog(options);assert.deepEqual(order,['prepare','weekly','learn']);assert.equal(r.weeklyScheduling.scheduled,1);assert.equal(r.dailyLearning.status,'already_completed');
});
test('blocked weekly child preserves unknown outcome and lets daily observation continue',async t=>{
 const root=await fixture(t);await input(root,true,[{weeklyAuthorizationSha256:'a'.repeat(64)}]);let learned=false;
 const r=await runClippersDailyWatchdog({workspaceRoot:root,now:NOW,env:{},dailyLearning:true,runWeeklySchedulingChild:async()=>({status:'blocked',scheduled:null,paidSpendUsd:0,reason:'weekly_child_deadline'}),runClippersDailyLearning:async()=>{learned=true;return{status:'held_or_partial',scheduled:0};}});
 assert.equal(learned,true);assert.equal(r.alerts.weeklySchedulingBlocked,true);assert.equal(r.weeklyScheduling.scheduled,null);
});
test('weekly child forwards only configuration pointers and requires an exact zero-spend bounded report',async t=>{
 const root=await fixture(t),helper=path.join(root,'fake-child.mjs');const body={schemaVersion:1,mode:'weekly',window,applyRequested:true,status:'held',scheduled:0,ready:0,attempts:0,paidSpendUsd:0};
 await writeFile(helper,`console.log(${JSON.stringify(JSON.stringify(body))});`,{mode:0o600});let child;
 const spawnProcess=(cmd,args,options)=>{assert.ok(args[0].endsWith('clippers-weekly-scheduler.mjs'));assert.deepEqual(args.slice(1),['--start',window.startDate,'--end',window.endDate,'--apply']);assert.equal(options.env.OPENAI_API_KEY,undefined);assert.equal(options.env.METRICOOL_USER_TOKEN,undefined);assert.equal(options.env.CLIPPERS_CONFIG_ROOT,'/synthetic/config');assert.equal(options.env.NODE_OPTIONS,undefined);return child=spawn(cmd,[helper],options);};
 t.after(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}});
 const r=await runWeeklySchedulingChild({workspaceRoot:root,window,now:NOW,env:{PATH:process.env.PATH,CLIPPERS_CONFIG_ROOT:'/synthetic/config',OPENAI_API_KEY:'synthetic-not-forwarded',METRICOOL_USER_TOKEN:'synthetic-not-forwarded',NODE_OPTIONS:'synthetic-not-forwarded'},spawnProcess});assert.equal(r.status,'held');assert.equal(r.scheduled,0);
 body.paidSpendUsd=1;await writeFile(helper,`console.log(${JSON.stringify(JSON.stringify(body))});`,{mode:0o600});const rejected=await runWeeklySchedulingChild({workspaceRoot:root,window,now:NOW,env:{CLIPPERS_CONFIG_ROOT:'/synthetic/config'},spawnProcess});assert.equal(rejected.reason,'weekly_child_report_unverified');assert.equal(rejected.scheduled,null);
});
test('weekly child deadline kills a resistant synthetic child without running provider code',async t=>{
 const root=await fixture(t),helper=path.join(root,'resistant.mjs');await writeFile(helper,"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);",{mode:0o600});let child;
 t.after(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}});
 const r=await runWeeklySchedulingChild({workspaceRoot:root,window,now:NOW,env:{},timeoutMs:500,spawnProcess:(cmd,args,options)=>(child=spawn(cmd,[helper],options))});
 assert.equal(r.reason,'weekly_child_deadline');assert.equal(r.scheduled,null);assert.equal(r.reconciliationRequired,true);
});
test('remaining week uses New York calendar and Sunday does not spill into next week',()=>{
 assert.deepEqual(remainingWeeklyWindow(NOW),window);assert.deepEqual(remainingWeeklyWindow(new Date('2026-11-23T04:59:59Z')),{startDate:'2026-11-22',endDate:'2026-11-22'});assert.deepEqual(remainingWeeklyWindow(new Date('2026-11-23T05:00:00Z')),{startDate:'2026-11-23',endDate:'2026-11-29'});
});
