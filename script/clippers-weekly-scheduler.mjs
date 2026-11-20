import { verifiedExternalSchedules, externalScheduleCollision } from './clippers-native-media-receipts.mjs';
import { canonicalSourceIdentity } from '../shared/clippers-priority-creators.mjs';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, open, realpath, rename, unlink, writeFile, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadClipperSelectedEnv } from './clippers-selected-env.mjs';
import { createPortfolioMetricool, DESTINATIONS, destinationKey, findDestination, localDay, providerTimestamp, canonicalAccount } from './clippers-portfolio-metricool.mjs';
import { createMacLedgerGuard, macLedgerEnv } from './clippers-mac-ledger-guard.mjs';
import { validateApprovedClippersAsset } from './clippers-daily-learning.mjs';
import { validWeeklyWindow, readWeeklyPrivateJson, weeklyDeliveryCollision, weeklyDigest } from './clippers-weekly-policy.mjs';
const CONFIG='config/clippers-daily-learning', REPORT='reports/clippers-daily-learning';
async function save(root,relative,value) {
  const file=path.join(root,relative), bytes=JSON.stringify(value,null,2)+'\n';
  if(Buffer.byteLength(bytes)>25000000)throw Error('weekly_state_capacity');
  const before=await lstat(file).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(before && (!before.isFile() || before.nlink!==1 || before.mode&0o077 || (process.getuid && before.uid!==process.getuid())))throw Error('weekly_private_file_required');
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,bytes,{mode:0o600,flag:'wx'});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}
}
const emptyState=()=>({schemaVersion:1,day:null,deliveries:[],observations:[],history:[],versions:{}});
const initialReport=(now,window,apply)=>({schemaVersion:1,mode:'weekly',generatedAt:now.toISOString(),window,applyRequested:apply,
  scheduled:0,ready:0,attempts:0,paidSpendUsd:0,heldReasons:[],outcomes:[]});
/** Explicit owner invocation only. Existing publish permission is still required, and report-only is default.
 * Shares the daily learner lock/state but never marks the metrics day complete or promotes render policies.
 */
export async function runClippersWeeklyScheduling({workspaceRoot,window,now=new Date(),env=process.env,adapter,ledgerGuard,apply=false,maxCycleMs=480000}={}) {
  if(!(now instanceof Date)||!Number.isFinite(+now)||!validWeeklyWindow(window,now)||window.endDate>remainingWeeklyWindow(now).endDate)throw Error('weekly_window_invalid');
  if(typeof apply!=='boolean'||!Number.isFinite(maxCycleMs)||maxCycleMs<=0)throw Error('weekly_cycle_invalid');
  const root=await realpath(path.resolve(workspaceRoot||env.CLIPPERS_WORKSPACE_ROOT||'clippers_workspace'));
  const reportDir=path.join(root,REPORT);await mkdir(reportDir,{recursive:true,mode:0o700});
  const dir=await lstat(reportDir);
  if(await realpath(reportDir)!==reportDir || !dir.isDirectory() || dir.mode&0o077 || (process.getuid&&dir.uid!==process.getuid()))throw Error('weekly_private_directory_required');
  const lockFile=path.join(root,'reports/metricool-autopilot.lock');let lock;
  try{lock=await open(lockFile,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code==='EEXIST')return {status:'held',reason:'metricool_worker_busy',scheduled:0,paidSpendUsd:0};throw error;}
  const controller=new AbortController(),started=performance.now(),limit=Math.min(maxCycleMs,480000);
  const deadline=setTimeout(()=>controller.abort(),limit);
  const current=()=>new Date(+now+performance.now()-started);
  const within=()=>!controller.signal.aborted && performance.now()-started<limit;
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,nonce:randomUUID(),mode:'weekly',startedAt:now.toISOString()})+'\n');
    const report=initialReport(now,window,apply);
    const state=await readWeeklyPrivateJson(root,`${REPORT}/state.json`,emptyState());
    if(state.schemaVersion!==1||!Array.isArray(state.deliveries)||!Array.isArray(state.observations)||!Array.isArray(state.history)||!state.versions||typeof state.versions!=='object'||Array.isArray(state.versions)||state.deliveries.some(r=>!findDestination(r)||typeof r.id!=='string'||typeof r.caption!=='string'||!providerTimestamp(r.scheduledAt)||!['verification_pending','scheduled','published'].includes(r.status)))throw Error('weekly_state_invalid');
    const configured=await readWeeklyPrivateJson(root,`${CONFIG}/approved-input.json`,{schemaVersion:1,assets:[],publish:false,reviews:[]});
    if(configured.schemaVersion!==1||!Array.isArray(configured.assets)||configured.assets.length>250||!Array.isArray(configured.reviews))throw Error('weekly_input_invalid');
    const receipts=await readWeeklyPrivateJson(root,`${REPORT}/portfolio-media-receipts.json`,[]);
    const legacy=await readWeeklyPrivateJson(root,'reports/metricool-autopilot-ledger.json',[],0o022);
    if(!Array.isArray(receipts)||!Array.isArray(legacy))throw Error('weekly_receipt_ledger_invalid');
    const external=verifiedExternalSchedules(await readWeeklyPrivateJson(root,`${REPORT}/external-schedules.json`,[]),now);
    const candidates=configured.assets.filter(a=>findDestination(a)&&(a.weeklyAuthorizationSha256||a.editorialPolicy==='evergreen_streamer_clip')&&providerTimestamp(a.scheduledAt)&&
      localDay(new Date(a.scheduledAt))>=window.startDate&&localDay(new Date(a.scheduledAt))<=window.endDate);
    const counts=new Map();for(const a of candidates){const key=destinationKey(a)+':'+a.id;counts.set(key,(counts.get(key)||0)+1);}
    const windowKey=window.startDate+':'+window.endDate,budgetWeek=remainingWeeklyWindow(now).endDate;
    let attempts=state.deliveries.filter(row=>row.weeklyWindow&&remainingWeeklyWindow(new Date(row.scheduledAt)).endDate===budgetWeek).length;
    for(const raw of [...candidates].sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||destinationKey(a).localeCompare(destinationKey(b))||String(a.id).localeCompare(String(b.id)))) {
      const outcome={destination:destinationKey(raw),assetId:typeof raw.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(raw.id)?raw.id:'unverified_asset',scheduledAt:raw.scheduledAt,status:'held',reason:null};report.outcomes.push(outcome);
      if(!within()){outcome.reason='weekly_cycle_deadline';break;}
      if(counts.get(destinationKey(raw)+':'+raw.id)!==1){outcome.reason='duplicate_asset_identity';continue;}
      if(external.some(r=>destinationKey(r.destination)===destinationKey(raw)&&(r.assetId===raw.id||r.sha256===raw.mediaSha256||r.mediaUrl===raw.mediaUrl))){outcome.reason='external_owner_ui_schedule_observed_no_replay';continue;}
      let item=await validateApprovedClippersAsset(raw,root,current(),receipts,state,window);
      if(!item){outcome.reason='weekly_asset_rights_media_or_render_unverified';continue;}
      if(external.some(row=>externalScheduleCollision(row,item))||state.deliveries.some(row=>weeklyDeliveryCollision(row,item)) || legacy.some(row=>Number(row.metricoolBlogId)===item.brandId&&canonicalAccount(row.metricoolBlogId,item.network,row.account)===item.account&&
          (row.sha256===item.mediaSha256||row.mediaSha256===item.mediaSha256||row.mediaUrl===item.mediaUrl||row.sourceUrl===item.sourceUrl||(canonicalSourceIdentity(row.sourceUrl)&&canonicalSourceIdentity(row.sourceUrl)===canonicalSourceIdentity(item.sourceUrl))))){outcome.reason='duplicate_or_overlapping_delivery';continue;}
      const day=localDay(new Date(item.scheduledAt));
      const existing=state.deliveries.filter(row=>findDestination(row)&&destinationKey(row)===destinationKey(item)&&localDay(new Date(row.scheduledAt))===day);
      if(existing.some(row=>!['scheduled','published'].includes(row.status))){outcome.reason='prior_schedule_outcome_unreconciled';continue;}
      if(existing.length>=5){outcome.reason='destination_daily_cap';continue;}
      report.ready++;
      if(!apply||configured.publish!==true){outcome.status='ready_for_live_preflight';outcome.reason=apply?'publisher_disabled':'report_only';continue;}
      if(report.attempts>=20||attempts>=100){outcome.reason='weekly_attempt_budget';continue;}
      if(!adapter) {
        const selected={...env};
        try{
          if((!selected.METRICOOL_USER_TOKEN||!selected.METRICOOL_USER_ID)&&env.CLIPPERS_CONFIG_ROOT)loadClipperSelectedEnv(env.CLIPPERS_CONFIG_ROOT,selected);
          adapter=createPortfolioMetricool({token:selected.METRICOOL_USER_TOKEN,userId:selected.METRICOOL_USER_ID,
            fetcher:(url,options={})=>fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal})});
        }catch{outcome.reason='metricool_adapter_unavailable';continue;}
      }
      let preflightEvidence;
      try{
        const check=await adapter.weeklyPreflight(findDestination(item),item,{now:current()});
        if(!check||check.day!==day||!Number.isInteger(check.confirmedCount)||check.confirmedCount<0||check.confirmedCount>=5||
            !Array.isArray(check.scheduledIds)||!Array.isArray(check.publishedIds)||!check.evidence||check.evidenceSha256!==weeklyDigest(check.evidence))throw Error('weekly_preflight_unverified');
        // A previously acknowledged local delivery missing from fresh provider coverage is unknown, never a free slot.
        if(existing.some(row=>row.status==='scheduled'?!(check.calendarIds??check.scheduledIds).includes(row.metricoolId):!check.publishedIds.includes(row.post?.id)))throw Error('existing_delivery_needs_provider_reconciliation');
        preflightEvidence={...check.evidence,sha256:check.evidenceSha256};
      }catch(error){outcome.reason=['today_publication_coverage_unverified','past_schedule_requires_publication_confirmation','existing_delivery_needs_provider_reconciliation','metricool_slot_duplicate_or_daily_cap'].includes(error.message)?error.message:'weekly_live_preflight_blocked';continue;}
      if(!within()){outcome.reason='weekly_cycle_deadline';break;}
      const latestInput=await readWeeklyPrivateJson(root,`${CONFIG}/approved-input.json`,null);
      const latestRows=Array.isArray(latestInput?.assets)?latestInput.assets.filter(a=>findDestination(a)&&destinationKey(a)===destinationKey(raw)&&a.id===raw.id):[];
      if(latestInput?.schemaVersion!==1||latestInput.publish!==true||latestRows.length!==1||weeklyDigest(latestRows[0])!==weeklyDigest(raw)){outcome.reason='weekly_approval_changed_during_preflight';continue;}
      const currentReceipts=await readWeeklyPrivateJson(root,`${REPORT}/portfolio-media-receipts.json`,[]);
      if(!Array.isArray(currentReceipts)){outcome.reason='weekly_media_approval_changed';continue;}
      item=await validateApprovedClippersAsset(latestRows[0],root,current(),currentReceipts,state,window);
      if(!item){outcome.reason='weekly_review_expired_during_preflight';continue;}

      // Shared cross-account ledger (same as the cloud publisher): one clip -> one account, fail closed.
      ledgerGuard??=createMacLedgerGuard({env:macLedgerEnv(env),workspaceRoot:root,metricool:adapter});
      const reservation=await ledgerGuard.reserve(findDestination(item),item);
      if(!reservation.ok){outcome.reason=`cross_account_ledger:${reservation.reason}`;continue;}
      const record={...item,createdAt:current().toISOString(),status:'verification_pending',costUsd:0,weeklyWindow:windowKey,weeklyBudgetWeek:budgetWeek,preflightEvidence,ledgerEvidence:reservation.evidence};
      state.deliveries.push(record);
      try{await save(root,`${REPORT}/state.json`,state);}catch(error){state.deliveries.pop();throw error;}
      report.attempts++;attempts++;
      try{
        const operationStarted=performance.now();
        const receipt=await adapter.schedule(findDestination(item),item);
        if(!receipt||typeof receipt!=='object'||typeof receipt.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(receipt.id)||typeof receipt.mediaUrl!=='string')throw Error('weekly_schedule_get_receipt_missing');
        // The production adapter returns only after exact scheduler GET and media verification.
        const confirmed=await adapter.confirmSchedule(findDestination(item),{...item,verifiedSchedulerMediaUrl:receipt.mediaUrl});
        if(!confirmed||typeof confirmed!=='object'||confirmed.id!==receipt.id||confirmed.mediaUrl!==receipt.mediaUrl)throw Error('weekly_schedule_get_receipt_missing');
        record.scheduleEvidence={id:confirmed.id,scheduledAt:item.scheduledAt,destination:findDestination(item),mediaUrl:confirmed.mediaUrl,confirmedAt:current().toISOString()};
        record.scheduleEvidenceSha256=weeklyDigest(record.scheduleEvidence);
        record.metricoolId=receipt.id;record.verifiedSchedulerMediaUrl=receipt.mediaUrl;record.status='scheduled';record.elapsedMs=performance.now()-operationStarted;
        report.scheduled++;outcome.status='scheduled';outcome.reason=null;outcome.metricoolId=receipt.id;
      }catch{outcome.reason='provider_receipt_pending_retry_suppressed';}
      await save(root,`${REPORT}/state.json`,state);
    }
    if(!candidates.length)report.heldReasons.push('no_weekly_permissioned_assets');
    if(!within())report.heldReasons.push('weekly_cycle_deadline');
    report.status=report.scheduled?'partial_scheduled':report.ready?'ready_or_held':'held';
    await save(root,`${REPORT}/weekly-latest.json`,report);return report;
  } finally {
    clearTimeout(deadline);controller.abort();
    const held=await lock.stat();await lock.close();
    const currentLock=await lstat(lockFile).catch(()=>null);
    if(currentLock?.ino===held.ino&&currentLock?.dev===held.dev)await unlink(lockFile);
  }
}
export function remainingWeeklyWindow(now=new Date()) {
  const startDate=localDay(now),end=new Date(startDate+'T12:00:00Z');
  end.setUTCDate(end.getUTCDate()+((7-end.getUTCDay())%7));
  return{startDate,endDate:end.toISOString().slice(0,10)};
}
export async function runWeeklySchedulingChild({workspaceRoot,window,env=process.env,now=new Date(),timeoutMs=480000,spawnProcess=spawn}={}) {
  if(!validWeeklyWindow(window,now)||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('weekly_child_input_invalid');
  const childEnv={CLIPPERS_WORKSPACE_ROOT:await realpath(workspaceRoot)};
  for(const key of ['HOME','PATH','TMPDIR','TMP','TEMP','USER','LOGNAME','CLIPPERS_CONFIG_ROOT','DEFAULT_USER_ID'])if(typeof env[key]==='string')childEnv[key]=env[key];
  return new Promise(resolve=>{
    let output='',bytes=0,failure,settled=false,killTimer;
    const child=spawnProcess(process.execPath,[fileURLToPath(import.meta.url),'--start',window.startDate,'--end',window.endDate,'--apply'],
      {cwd:fileURLToPath(new URL('..',import.meta.url)),env:childEnv,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const stop=signal=>{try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch{}};
    const blocked=reason=>({status:'blocked',reason,scheduled:null,ready:null,attempts:null,paidSpendUsd:0,reconciliationRequired:true});
    const finish=value=>{if(settled)return;if(failure||value.status==='blocked')stop('SIGKILL');settled=true;clearTimeout(timer);clearTimeout(killTimer);resolve(value);};
    const terminate=reason=>{failure||=reason;stop('SIGTERM');killTimer||=setTimeout(()=>{stop('SIGKILL');finish(blocked(failure));},250);};
    const timer=setTimeout(()=>terminate('weekly_child_deadline'),Math.min(timeoutMs,480000));
    child.stdout.on('data',chunk=>{if(settled||failure)return;bytes+=chunk.length;if(bytes>262144){terminate('weekly_child_output_limit');return;}output+=chunk.toString();});
    child.stderr.on('data',()=>{});
    child.on('error',()=>finish(blocked('weekly_child_unavailable')));
    child.on('close',exit=>{
      if(failure)return finish(blocked(failure));if(exit!==0)return finish(blocked('weekly_child_failed'));
      try{
        const r=JSON.parse(output);
        if(r.schemaVersion!==1||r.mode!=='weekly'||r.paidSpendUsd!==0||r.applyRequested!==true||
            r.window?.startDate!==window.startDate||r.window?.endDate!==window.endDate||!['held','ready_or_held','partial_scheduled'].includes(r.status)||
            !Number.isSafeInteger(r.scheduled)||r.scheduled<0||r.scheduled>20||!Number.isSafeInteger(r.ready)||r.ready<0||r.ready>250||
            !Number.isSafeInteger(r.attempts)||r.attempts<r.scheduled||r.attempts>20)throw Error();
        finish({status:r.status,scheduled:r.scheduled,ready:r.ready,attempts:r.attempts,paidSpendUsd:0});
      }catch{finish(blocked('weekly_child_report_unverified'));}
    });
  });
}
export function parseWeeklySchedulingArgs(args) {
  const window={},seen=new Set();let apply=false;
  for(let i=0;i<args.length;i++){
    const name=args[i];if(seen.has(name))throw Error('weekly_cli_usage');seen.add(name);
    if(name==='--apply')apply=true;
    else if(['--start','--end'].includes(name)&&typeof args[i+1]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(args[i+1]))window[name==='--start'?'startDate':'endDate']=args[++i];
    else throw Error('weekly_cli_usage');
  }
  if(!window.startDate||!window.endDate)throw Error('weekly_cli_usage');
  return{window,apply};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const args=parseWeeklySchedulingArgs(process.argv.slice(2));
    // The child process bounds inherited renderer filesystem calls as well as provider I/O.
    // A killed process retains its attempt ledger/lock for explicit reconciliation, never automatic replay.
    const hardStop=setTimeout(()=>{console.log(JSON.stringify({status:'held',reason:'weekly_process_deadline',scheduled:null,reconciliationRequired:true}));process.exit(124);},480000);
    hardStop.unref();
    try{console.log(JSON.stringify(await runClippersWeeklyScheduling(args),null,2));}finally{clearTimeout(hardStop);}
  }catch(error){
    const safe=new Set(['weekly_window_invalid','weekly_cli_usage','weekly_cycle_invalid','weekly_state_invalid','weekly_input_invalid','weekly_state_capacity','weekly_receipt_ledger_invalid','weekly_private_file_required','weekly_private_directory_required']);
    console.log(JSON.stringify({status:'held',reason:safe.has(error.message)?error.message:'weekly_runtime_unavailable',scheduled:null,reconciliationRequired:true}));process.exitCode=1;
  }
}
