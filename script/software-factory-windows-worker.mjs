import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertPrivateConfigAcl} from './office-windows-worker.mjs';
import {ownershipPaths,acquireWorkerOwnership,requestWorkerStop,resumeWorker} from './office-worker-ownership.mjs';
const fail=()=>{throw Error('FACTORY_LOCAL_CONFIGURATION_UNVERIFIED');};
const unsafe=['NODE_OPTIONS','NODE_PATH','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'];
const localEnvFiles=['.env','.env.local','.env.development','.env.development.local','.env.production','.env.production.local','.env.replit','CEO_ASSISTANT_ENV','CEO_ASSISTANT_ENV.local'];
export function factoryWorkerEnvironment(office,github,paths,inherited=process.env){
 if(unsafe.some(k=>inherited[k]))fail();
 if(!office.DATABASE_URL||!office.DEFAULT_USER_ID||!/^sk-\S{20,300}$/.test(office.OPENAI_API_KEY||'')||!/^github_pat_\S{20,300}$/.test(github.FACTORY_GITHUB_TOKEN||''))fail();
 const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(inherited[key])env[key]=inherited[key];
 if(!env.SystemRoot)fail();
 return {...env,PATH:path.dirname(process.execPath)+path.delimiter+path.join(env.SystemRoot,'System32'),NODE_ENV:'production',DATABASE_URL:office.DATABASE_URL,DEFAULT_USER_ID:office.DEFAULT_USER_ID,
  OPENAI_API_KEY:office.OPENAI_API_KEY,SOFTWARE_FACTORY_GITHUB_TOKEN:github.FACTORY_GITHUB_TOKEN,AGENT_COUNCIL_STORAGE:'postgres',
  OPENAI_SHARED_CREDIT_CONFIG:paths.creditConfig,OPENAI_SHARED_CREDITS_REQUIRED:'true',SOFTWARE_FACTORY_ENABLED:'true',SOFTWARE_FACTORY_OWNER_ID:office.DEFAULT_USER_ID,
  SOFTWARE_FACTORY_OPERATOR_CONFIG:paths.operatorConfig,SOFTWARE_FACTORY_ADAPTER_MODULE:path.join(paths.repo,'server/software-factory-asistente-operator.ts')};
}
export async function superviseFactoryChild(child,ownership,paths,{pollMs=1000,parentAlive=()=>{try{process.kill(ownership.identity.parentPid,0);return true;}catch(e){return e.code!=='ESRCH';}}}={}){
 let stopping=false;
 const stop=()=>{if(!stopping&&child.connected){stopping=true;child.send({type:'factory-shutdown'},()=>{});}};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 const timer=setInterval(()=>{try{if(!parentAlive())requestWorkerStop(paths);if(ownership.stopRequested())stop();}catch{stop();}},pollMs);
 try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}
 finally{clearInterval(timer);process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
function privateFile(value,repo){
 if(typeof value!=='string'||!path.isAbsolute(value)||/[\r\n\0",%]/.test(value))fail();
 const resolved=fs.realpathSync(value),stat=fs.lstatSync(value);
 const relative=path.relative(repo,resolved);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))fail();
 assertPrivateConfigAcl(resolved);assertPrivateConfigAcl(path.dirname(resolved));return resolved;
}
async function main(){
 if(process.platform!=='win32'||Number(process.versions.node.split('.')[0])<24||unsafe.some(k=>process.env[k]))fail();
 const args=process.argv.slice(2);if(args.length!==5||args[0]!=='--repo'||args[2]!=='--config'||!['--run','--preflight','--stop','--resume'].includes(args[4]))fail();
 const repo=fs.realpathSync(args[1]);if(!path.isAbsolute(args[1])||/[\r\n\0",%]/.test(repo)||!fs.statSync(repo).isDirectory()||localEnvFiles.some(name=>fs.existsSync(path.join(repo,name))))fail();
 const configPath=privateFile(args[3],repo),raw=JSON.parse(fs.readFileSync(configPath,'utf8'));
 if(!raw||Object.keys(raw).sort().join(',')!=='creditConfig,githubConfig,officeConfig,operatorConfig')fail();
 const paths={repo};for(const key of Object.keys(raw))paths[key]=privateFile(raw[key],repo);
 const office=parseEnv(fs.readFileSync(paths.officeConfig,'utf8')),github=parseEnv(fs.readFileSync(paths.githubConfig,'utf8'));
 const env=factoryWorkerEnvironment(office,github,paths),owned=ownershipPaths(repo,configPath,office.DEFAULT_USER_ID);
 if(args[4]==='--stop'){requestWorkerStop(owned);return;}
 if(args[4]==='--resume'){resumeWorker(owned);return;}
 const entry=path.join(repo,'script/software-factory-worker.ts');
 if(args[4]==='--preflight'){
  const result=spawnSync(process.execPath,['--import','tsx',entry,'--preflight'],{cwd:repo,env,windowsHide:true,shell:false,encoding:'utf8',timeout:60000,maxBuffer:65536});
  if(result.status!==0)fail();console.log('Factory configuration verified; no worker or task started.');return;
 }
 const ownership=acquireWorkerOwnership(owned);let child,finished=false;
 try{
  if(ownership.stopRequested())return;
  child=spawn(process.execPath,['--import','tsx',entry],{cwd:repo,env,windowsHide:true,shell:false,stdio:['ignore','ignore','ignore','ipc']});
  const code=await superviseFactoryChild(child,ownership,owned);finished=code===0;
  if(!finished)fail();
 }finally{if(!child||!child.pid||finished)ownership.release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Factory stopped: private configuration, ownership or execution needs verification. No automatic replay.');process.exitCode=1;});
