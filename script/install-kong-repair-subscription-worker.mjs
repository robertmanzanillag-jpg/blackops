#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runProcess,cleanEnvironment} from './kong-repair-subscription-worker.mjs';
import {STARTUP_RETRY_CONTRACT} from './kong-repair-startup-supervisor.mjs';

const LABEL='com.blackops.kong-repair-subscription-worker';
const SHA=/^[a-f0-9]{40}$/;
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function installPlan(home=os.homedir()) {
  const root=path.join(home,'.local/share/blackops/kong-repair-runtime');
  const node=path.join(home,'.nvm/versions/node/v22.23.0/bin/node');
  const script=path.join(root,'kong-repair-subscription-worker.mjs');
  const supervisor=path.join(root,'kong-repair-startup-supervisor.mjs');
  const plist=path.join(home,'Library/LaunchAgents',`${LABEL}.plist`);
  const content=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(supervisor)}</string><string>--once</string></array>\n<key>WorkingDirectory</key><string>${xml(root)}</string>\n<key>StartInterval</key><integer>1800</integer>\n<key>RunAtLoad</key><false/>\n<key>ProcessType</key><string>Background</string>\n<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string><key>PATH</key><string>${xml(path.dirname(node))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>KONG_REPAIR_LOCAL_WORKER_ENABLED</key><string>true</string></dict>\n<key>StandardOutPath</key><string>${xml(path.join(root,'worker.stdout.log'))}</string>\n<key>StandardErrorPath</key><string>${xml(path.join(root,'worker.stderr.log'))}</string>\n</dict></plist>\n`;
  return {label:LABEL,root,node,script,supervisor,plist,content,startIntervalSeconds:1800,runAtLoad:false,maxModelReservationsPerNewYorkDay:3};
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function ownedPrivate(file) {
  const info=await fs.lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)||(process.getuid&&info.uid!==process.getuid()))throw Error('Private owned installation file required.');
  return fs.readFile(file);
}
async function atomicPrivate(file,bytes) {
  const temporary=`${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});await fs.rename(temporary,file);
}
async function journals(root) {
  const names=(await fs.readdir(root)).sort(),hashes={};
  for(const name of names)if(/^[a-f0-9]{64}\.json$/.test(name)||['health-pointer.json','last-successful-poll.json','health-publication-failure.json','preflight-holds.json','startup-readiness.json','startup-supervisor-last.json'].includes(name))hashes[name]=digest(await ownedPrivate(path.join(root,name)));
  return hashes;
}
async function noWorkerLock(root) {
  try{await fs.lstat(path.join(root,'worker.lock'));throw Error('Existing worker lock requires reconciliation.');}catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function upgradeReviewedInstallation({plan,workerBytes,supervisorBytes,reviewedSha,fromReviewedSha,run=runProcess,now=()=>new Date()}) {
  if(!SHA.test(reviewedSha)||!SHA.test(fromReviewedSha)||await fs.realpath(plan.root)!==plan.root)throw Error('Reviewed upgrade required.');
  const beforeIdentity=await ownedPrivate(path.join(plan.root,'installation.json')),identity=JSON.parse(beforeIdentity),oldWorker=await ownedPrivate(plan.script),oldPlist=await ownedPrivate(plan.plist);
  if(identity.reviewedSha!==fromReviewedSha||digest(oldWorker)!==identity.workerSha256)throw Error('Installed engine identity changed.');
  await noWorkerLock(plan.root);const preserved=await journals(plan.root),service=`gui/${process.getuid()}/${plan.label}`;
  const inactive=async()=>{const status=await run('/bin/launchctl',['print',service],{env:cleanEnvironment()});if(status.exitCode!==0||!/^\s*state = not running\s*$/m.test(status.output)||/^\s*pid = \d+/m.test(status.output))throw Error('Worker must be loaded and not running.');};
  await inactive();
  const argumentLine=script=>`<key>ProgramArguments</key><array><string>${xml(plan.node)}</string><string>${xml(script)}</string><string>--once</string></array>`;
  const beforeLine=argumentLine(plan.script),afterLine=argumentLine(plan.supervisor),text=oldPlist.toString();let content;
  const trustedLegacy=plan.content.replace(afterLine,beforeLine);
  if(text!==trustedLegacy&&text!==plan.content)throw Error('LaunchAgent differs from the trusted schedule and activation plan.');
  if(text.split(beforeLine).length===2&&!text.includes(afterLine))content=text.replace(beforeLine,afterLine);
  else if(text.split(afterLine).length===2&&!text.includes(beforeLine))content=text;
  else throw Error('LaunchAgent arguments differ from the reviewed plan.');
  let priorSupervisor=null;try{priorSupervisor=await ownedPrivate(plan.supervisor);if(digest(priorSupervisor)!==identity.supervisorSha256)throw Error('Supervisor identity changed.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const backup=path.join(plan.root,'upgrade-backups',`${now().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`);await fs.mkdir(backup,{recursive:true,mode:0o700});
  for(const [name,bytes] of [['worker.mjs',oldWorker],['installation.json',beforeIdentity],['worker.plist',oldPlist],...(priorSupervisor?[['supervisor.mjs',priorSupervisor]]:[])])await fs.writeFile(path.join(backup,name),bytes,{flag:'wx',mode:0o600});
  await inactive();await noWorkerLock(plan.root);
  if((await run('/bin/launchctl',['bootout',service],{env:cleanEnvironment()})).exitCode!==0)throw Error('Worker unload unconfirmed; preserve backup.');
  await noWorkerLock(plan.root);
  if(!(await ownedPrivate(plan.script)).equals(oldWorker)||!(await ownedPrivate(path.join(plan.root,'installation.json'))).equals(beforeIdentity)||!(await ownedPrivate(plan.plist)).equals(oldPlist))throw Error('Installed files changed after backup; preserve backup.');
  const next={...identity,reviewedSha,workerSha256:digest(workerBytes),supervisorSha256:digest(supervisorBytes),startupRetryContract:STARTUP_RETRY_CONTRACT,upgradedAt:now().toISOString(),previousReviewedSha:identity.reviewedSha};
  await atomicPrivate(plan.script,workerBytes);await atomicPrivate(plan.supervisor,supervisorBytes);await atomicPrivate(path.join(plan.root,'installation.json'),JSON.stringify(next,null,2));await atomicPrivate(plan.plist,content);
  if(JSON.stringify(await journals(plan.root))!==JSON.stringify(preserved))throw Error('Journal changed; inspect backup before restart.');
  if(digest(await ownedPrivate(plan.script))!==next.workerSha256||digest(await ownedPrivate(plan.supervisor))!==next.supervisorSha256)throw Error('Upgrade readback mismatch.');
  if((await run('/usr/bin/plutil',['-lint',plan.plist],{env:cleanEnvironment()})).exitCode!==0)throw Error('LaunchAgent invalid; preserve backup.');
  if((await run('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plan.plist],{env:cleanEnvironment()})).exitCode!==0)throw Error('Worker load unconfirmed; preserve backup.');
  const receipt={...next,backupDirectory:backup,preservedJournalHashes:preserved,label:plan.label,loaded:true,kickstartPerformed:false,paidApiSpendUsd:0};await fs.writeFile(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});return receipt;
}
async function main() {
  const args=process.argv.slice(2),plan=installPlan();
  if(args.length===1&&args[0]==='--plan'){console.log(JSON.stringify({...plan,content:undefined}));return;}
  const upgrading=args[0]==='--upgrade';
  if(args[1]!=='--reviewed-sha'||!SHA.test(args[2]||'')||(!upgrading&&(args.length!==3||args[0]!=='--install'))||(upgrading&&(args.length!==5||args[3]!=='--from-reviewed-sha'||!SHA.test(args[4]||''))))throw Error('Use --plan, --install --reviewed-sha <commit>, or --upgrade --reviewed-sha <commit> --from-reviewed-sha <installed commit>.');
  const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const git=await runProcess('/usr/bin/git',['rev-parse','HEAD'],{cwd:sourceRoot,env:cleanEnvironment()}),status=await runProcess('/usr/bin/git',['status','--porcelain'],{cwd:sourceRoot,env:cleanEnvironment()});
  if(git.exitCode!==0||git.output.trim()!==args[2]||status.exitCode!==0||status.output.trim())throw Error('Exact reviewed commit and clean worktree required.');
  await fs.access(plan.node);const workerBytes=await fs.readFile(path.join(sourceRoot,'script/kong-repair-subscription-worker.mjs')),supervisorBytes=await fs.readFile(path.join(sourceRoot,'script/kong-repair-startup-supervisor.mjs'));
  if(upgrading){console.log(JSON.stringify(await upgradeReviewedInstallation({plan,workerBytes,supervisorBytes,reviewedSha:args[2],fromReviewedSha:args[4]})));return;}
  const identity={reviewedSha:args[2],workerSha256:digest(workerBytes),supervisorSha256:digest(supervisorBytes),startupRetryContract:STARTUP_RETRY_CONTRACT,installedAt:new Date().toISOString(),paidApiSpendUsd:0};
  for(const destination of [plan.script,plan.supervisor,plan.plist,path.join(plan.root,'installation.json')])try{await fs.lstat(destination);throw Error('Existing installation: use an explicitly reviewed upgrade.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(plan.root,{recursive:true,mode:0o700});await fs.mkdir(path.dirname(plan.plist),{recursive:true});
  for(const [file,bytes] of [[plan.script,workerBytes],[plan.supervisor,supervisorBytes],[path.join(plan.root,'installation.json'),JSON.stringify(identity,null,2)],[plan.plist,plan.content]])await fs.writeFile(file,bytes,{mode:0o600,flag:'wx'});
  if((await runProcess('/usr/bin/plutil',['-lint',plan.plist],{env:cleanEnvironment()})).exitCode!==0)throw Error('LaunchAgent validation failed; not loaded.');
  if((await runProcess('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plan.plist],{env:cleanEnvironment()})).exitCode!==0)throw Error('LaunchAgent load unconfirmed; inspect before retry.');
  console.log(JSON.stringify({...identity,label:LABEL,loaded:true,firstModelRunVerified:false,cadenceSeconds:1800,maxModelReservationsPerNewYorkDay:3}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error(JSON.stringify({state:'installation_blocked',loadedVerified:false}));process.exitCode=1;});
