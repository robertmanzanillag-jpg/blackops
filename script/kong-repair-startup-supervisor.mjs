#!/usr/bin/env node
/** Retries only the reviewed worker's exact failure before queue admission. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const STARTUP_RETRY_CONTRACT='preconsume_readiness_v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function retryableReadinessFailure(result) {
  if(result.exitCode!==1||result.signal||result.timedOut||result.overflow||result.stdout.trim())return false;
  try{const body=JSON.parse(result.stderr.trim());return Object.keys(body).sort().join(',')==='paidApiSpendUsd,reasonCode,state'&&body.state==='blocked'&&body.reasonCode==='WORKER_NOT_READY'&&body.paidApiSpendUsd===0;}catch{return false;}
}
export async function superviseStartup({run,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  let result,attempts=0;
  for(;attempts<3;){result=await run();attempts++;if(!retryableReadinessFailure(result)||attempts===3)break;await sleep(5000);}
  return {...result,attempts};
}
async function privateBytes(file) {
  const info=await fs.lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)||(process.getuid&&info.uid!==process.getuid()))throw Error('SUPERVISOR_INSTALLATION_UNCONFIRMED');
  return fs.readFile(file);
}
export async function verifySupervisorInstallation(root) {
  if(await fs.realpath(root)!==root)throw Error('SUPERVISOR_INSTALLATION_UNCONFIRMED');
  const identity=JSON.parse(await privateBytes(path.join(root,'installation.json')));
  const worker=path.join(root,'kong-repair-subscription-worker.mjs'),supervisor=path.join(root,'kong-repair-startup-supervisor.mjs');
  if(!/^[a-f0-9]{40}$/.test(identity.reviewedSha||'')||identity.startupRetryContract!==STARTUP_RETRY_CONTRACT||
    hash(await privateBytes(worker))!==identity.workerSha256||hash(await privateBytes(supervisor))!==identity.supervisorSha256)throw Error('SUPERVISOR_INSTALLATION_UNCONFIRMED');
  return worker;
}
export function launchWorker(worker,{env=process.env,cwd=path.dirname(worker),spawnProcess=spawn}={}) {
  const selected={};for(const key of ['HOME','PATH','LANG','LC_ALL','SHELL','USER','LOGNAME','SYSTEMROOT','KONG_REPAIR_LOCAL_WORKER_ENABLED'])if(typeof env[key]==='string')selected[key]=env[key];
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(process.execPath,[worker,'--once'],{cwd,env:selected,shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',size=0,overflow=false;
    const collect=kind=>chunk=>{size+=chunk.length;if(size>128*1024){overflow=true;return;}if(kind==='stdout')stdout+=chunk;else stderr+=chunk;};
    child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
    child.on('error',()=>reject(Error('SUPERVISOR_PROCESS_UNAVAILABLE')));
    // Preserve all original model/process deadlines. An ambiguous child exit,
    // signal or output is never converted into permission to launch again.
    child.on('close',(exitCode,signal)=>resolve({exitCode,signal,stdout,stderr,overflow,timedOut:false}));
  });
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--once')throw Error('SUPERVISOR_ARGUMENT_INVALID');
  const root=path.join(os.homedir(),'.local/share/blackops/kong-repair-runtime');
  const result=await superviseStartup({run:async()=>launchWorker(await verifySupervisorInstallation(root))});
  const report={observedAt:new Date().toISOString(),attempts:result.attempts,exitCode:result.exitCode,signal:result.signal||null,overflow:result.overflow,startupRetries:result.attempts-1,paidApiSpendUsd:0};
  const file=path.join(root,'startup-supervisor-last.json'),temporary=`${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});await fs.rename(temporary,file);
  if(result.overflow)throw Error('SUPERVISOR_OUTPUT_UNCONFIRMED');
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  process.exitCode=Number.isInteger(result.exitCode)?result.exitCode:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error(JSON.stringify({state:'blocked',reasonCode:'SUPERVISOR_UNCONFIRMED',paidApiSpendUsd:0}));process.exitCode=1;});
