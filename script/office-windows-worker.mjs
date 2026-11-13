import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ownershipPaths, acquireWorkerOwnership, requestWorkerStop, resumeWorker } from './office-worker-ownership.mjs';

const allowed = new Set(['DATABASE_URL','DEFAULT_USER_ID','OPENAI_API_KEY','OFFICE_OPENAI_MODEL','OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT','OFFICE_OPENAI_MAX_OUTPUT_TOKENS','OFFICE_ACADEMY_PREPARATION_ENABLED','OFFICE_ACADEMY_EXECUTION_ENABLED','OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED','OFFICE_EXPECTED_WEB_REVISION','GITHUB_TOKEN','OFFICE_INTERNAL_WORK_ENABLED']);
const localEnvFiles = ['.env','.env.local','.env.development','.env.development.local','.env.production','.env.production.local','.env.replit','CEO_ASSISTANT_ENV','CEO_ASSISTANT_ENV.local'];
const roleFlags=['OFFICE_ROLE_WORK_ENABLED','OFFICE_WEB_SOURCES_ENABLED','OFFICE_ROLE_ACADEMY_ENABLED','OFFICE_CAPABILITY_TRAINING_ENABLED','OPENAI_SHARED_CREDITS_REQUIRED'];
for(const key of [...roleFlags,'OFFICE_WEB_SOURCE_ORIGIN','OFFICE_ROLE_ACADEMY_DAILY_PAIRS','OPENAI_SHARED_CREDIT_CONFIG','OFFICE_CAPABILITY_MAX_CALLS_PER_DAY'])allowed.add(key);
const fail = code => { throw new Error(code); };
export function assertPrivateConfigAcl(configPath, execute = spawnSync, inherited = process.env) {
  const script = "$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Get-Acl -LiteralPath $env:OFFICE_PRIVATE_CONFIG_PATH; if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18','S-1-5-32-544')){exit 1}; foreach($rule in $acl.Access){$id=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($rule.AccessControlType -eq 'Allow' -and $id -notin @($sid,'S-1-5-18','S-1-5-32-544')){exit 1}}; Write-Output 'PRIVATE_CONFIG_ACL_OK'";
  const env = {}; for (const key of ['SystemRoot','WINDIR','TEMP','TMP']) if (inherited[key]) env[key] = inherited[key];
  if (!env.SystemRoot) fail('WINDOWS_SYSTEM_ROOT_REQUIRED');
  const result = execute(path.join(env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'), ['-NoProfile','-NonInteractive','-Command',script], {
    env:{...env,OFFICE_PRIVATE_CONFIG_PATH:configPath}, windowsHide:true, shell:false, timeout:15000, encoding:'utf8', maxBuffer:4096,
  });
  if (result.status !== 0 || result.stdout?.trim() !== 'PRIVATE_CONFIG_ACL_OK') fail('CONFIGURATION_ACL_NOT_VERIFIED');
}
export function parseWorkerConfig(raw) {
  if (Buffer.byteLength(raw) > 65536) fail('CONFIG_TOO_LARGE');
  const config = {};
  for (const line of raw.split(/\r?\n/)) {
    const value = line.trim(); if (!value || value.startsWith('#')) continue;
    const match = value.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(config, match[1])) fail('CONFIG_KEY_INVALID');
    let text = match[2].trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1,-1);
    if (!text || /[\r\n\0]/.test(text)) fail('CONFIG_VALUE_INVALID');
    config[match[1]] = text;
  }
  for (const key of ['DATABASE_URL','DEFAULT_USER_ID','OPENAI_API_KEY','OFFICE_OPENAI_MODEL','OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT']) if (!config[key]) fail(`CONFIG_MISSING_${key}`);
  let database; try { database = new URL(config.DATABASE_URL); } catch { fail('DATABASE_URL_INVALID'); }
  if (!['postgres:','postgresql:'].includes(database.protocol) || !database.hostname || database.pathname.length < 2) fail('DATABASE_URL_INVALID');
  if (/replace|placeholder|example|your[_-]|change.?me/i.test(config.DEFAULT_USER_ID) || config.DEFAULT_USER_ID.length > 200 || /\s/.test(config.DEFAULT_USER_ID)) fail('OWNER_INVALID');
  if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(config.OPENAI_API_KEY)) fail('KEY_FORMAT_INVALID');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(config.OFFICE_OPENAI_MODEL)) fail('MODEL_INVALID');
  const cap = Number(config.OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT);
  if (!/^[a-f0-9]{40}$/.test(config.OFFICE_EXPECTED_WEB_REVISION || '')) fail('VERIFIED_WEB_REVISION_REQUIRED');
  if (!Number.isSafeInteger(cap) || cap < 1) fail('EXPLICIT_TOKEN_LIMIT_REQUIRED');
  const output = Number(config.OFFICE_OPENAI_MAX_OUTPUT_TOKENS || '2048');
  if (!Number.isSafeInteger(output) || output < 32 || output > 4096) fail('OUTPUT_LIMIT_INVALID');
  for (const key of ['OFFICE_ACADEMY_PREPARATION_ENABLED','OFFICE_ACADEMY_EXECUTION_ENABLED','OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED','OFFICE_INTERNAL_WORK_ENABLED']) if (config[key] && !['true','false'].includes(config[key])) fail('FLAG_INVALID');
  for(const key of roleFlags)if(config[key] && !['true','false'].includes(config[key]))fail('FLAG_INVALID');
  if(config.OPENAI_SHARED_CREDIT_CONFIG && (!path.isAbsolute(config.OPENAI_SHARED_CREDIT_CONFIG) || /[\r\n\0"]/.test(config.OPENAI_SHARED_CREDIT_CONFIG)))fail('SHARED_CREDIT_PATH_INVALID');
  if(config.OPENAI_SHARED_CREDITS_REQUIRED==='true' && !config.OPENAI_SHARED_CREDIT_CONFIG)fail('SHARED_CREDIT_CONFIG_REQUIRED');
  if(config.OFFICE_ROLE_ACADEMY_ENABLED==='true'){
    const pairs=Number(config.OFFICE_ROLE_ACADEMY_DAILY_PAIRS);
    if(!Number.isSafeInteger(pairs)||pairs<1||pairs>14||!config.OPENAI_SHARED_CREDIT_CONFIG||config.OPENAI_SHARED_CREDITS_REQUIRED!=='true')fail('ROLE_ACADEMY_LIMITS_REQUIRED');
  }
  if(config.OFFICE_CAPABILITY_TRAINING_ENABLED==='true'){
    const calls=Number(config.OFFICE_CAPABILITY_MAX_CALLS_PER_DAY);
    if(!Number.isSafeInteger(calls)||calls<1||calls>28||!config.OPENAI_SHARED_CREDIT_CONFIG||config.OPENAI_SHARED_CREDITS_REQUIRED!=='true'||config.OFFICE_ROLE_WORK_ENABLED!=='true')fail('CAPABILITY_TRAINING_LIMITS_REQUIRED');
  }
  if(config.OFFICE_WEB_SOURCES_ENABLED==='true'){
    let origin;try{origin=new URL(config.OFFICE_WEB_SOURCE_ORIGIN);}catch{fail('WEB_SOURCE_ORIGIN_INVALID');}
    if(origin.protocol!=='https:'||origin.origin!==config.OFFICE_WEB_SOURCE_ORIGIN||config.OFFICE_ROLE_WORK_ENABLED!=='true')fail('WEB_SOURCE_ORIGIN_INVALID');
  }
  return config;
}
export function safeWorkerEnvironment(config, inherited = process.env) {
  const env = {};
  for (const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','Path','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC']) if (inherited[key]) env[key] = inherited[key];
  return { ...env, ...config, NODE_ENV:'production', OFFICE_WORKER_ENABLED:'true', OFFICE_WORKER_RUN_ONCE:'false', OFFICE_WORKER_FAIL_FAST:'true', OFFICE_WORKER_REVIEW_ONLY:'true', OFFICE_REVIEW_PROVIDER:'openai', OFFICE_KONG_AUDIT_SCHEDULE_ENABLED:'false', AGENT_COUNCIL_STORAGE:'postgres',
    OFFICE_INTERNAL_WORK_ENABLED:config.OFFICE_INTERNAL_WORK_ENABLED || 'false', OFFICE_ACADEMY_PREPARATION_ENABLED:config.OFFICE_ACADEMY_PREPARATION_ENABLED || 'false', OFFICE_ACADEMY_EXECUTION_ENABLED:config.OFFICE_ACADEMY_EXECUTION_ENABLED || 'false', OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED:config.OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED || 'false' };
}
export function validateWorkerPaths(repoInput, configInput, nodeInput = process.execPath) {
  if (![repoInput, configInput, nodeInput].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\r\n\0"]/.test(value))) fail('ABSOLUTE_PATH_REQUIRED');
  const repo = fs.realpathSync(repoInput), configPath = fs.realpathSync(configInput), node = fs.realpathSync(nodeInput);
  const relative = path.relative(repo, configPath);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('CONFIG_MUST_BE_OUTSIDE_REPOSITORY');
  if (!fs.statSync(repo).isDirectory() || !fs.statSync(configPath).isFile() || !fs.statSync(node).isFile()) fail('PATH_TYPE_INVALID');
  if (process.platform === 'win32' && path.basename(node).toLowerCase() !== 'node.exe') fail('NODE_EXECUTABLE_REQUIRED');
  const manifest = JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
  if (manifest.name !== 'rest-express' || !fs.existsSync(path.join(repo,'script','office-worker.ts')) || !fs.existsSync(path.join(repo,'node_modules','tsx','package.json'))) fail('REVIEWED_WORKER_OR_DEPENDENCIES_MISSING');
  if (localEnvFiles.some(file => fs.existsSync(path.join(repo,file)))) fail('REPOSITORY_ENV_FALLBACK_FORBIDDEN');
  return { repo, configPath, node };
}
export async function preflightDatabase(config, Pool, assertProtocolReady) {
  if (typeof assertProtocolReady !== 'function') fail('PROTOCOL_VERIFIER_REQUIRED');
  const pool = new Pool({ connectionString:config.DATABASE_URL, connectionTimeoutMillis:10000, statement_timeout:10000, max:1 });
  try {
    const result = await pool.query(`SELECT to_regclass('public.agent_office_cloud_jobs') AS jobs, to_regclass('public.office_agent_workers') AS workers, to_regclass('public.revenue_engine_state') AS council`);
    if (!result.rows[0]?.jobs || !result.rows[0]?.workers || !result.rows[0]?.council) fail('QUEUE_SCHEMA_MISSING');
    const owner = await pool.query('SELECT EXISTS(SELECT 1 FROM users WHERE id=$1) AND EXISTS(SELECT 1 FROM app_projects WHERE user_id=$1) AS valid', [config.DEFAULT_USER_ID]);
    if (owner.rows[0]?.valid !== true) fail('OFFICE_OWNER_DATABASE_MISMATCH');
    await assertProtocolReady(pool, config.DEFAULT_USER_ID, config.OFFICE_EXPECTED_WEB_REVISION);
  } finally { await pool.end(); }
}
export async function superviseOwnedWorker(child, ownership, ownedPaths, { pollMs=1000, parentAlive=()=>{
  try { process.kill(ownership.identity.parentPid,0); return true; } catch(error) { return error.code !== 'ESRCH'; }
} } = {}) {
  let requested=false;
  const terminate=()=>{ if (!requested && child.connected) { requested=true; child.send({type:'office-shutdown'},()=>{}); } };
  process.on('SIGTERM',terminate); process.on('SIGINT',terminate);
  const monitor=setInterval(()=>{
    try { if (!parentAlive()) requestWorkerStop(ownedPaths); if (ownership.stopRequested()) terminate(); }
    catch { terminate(); }
  },pollMs);
  try { return await new Promise((resolve,reject)=>{ child.once('error',reject); child.once('exit',code=>resolve(code)); }); }
  finally { clearInterval(monitor); process.off('SIGTERM',terminate); process.off('SIGINT',terminate); }
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('NODE_22_OR_NEWER_REQUIRED');
  const args = process.argv.slice(2);
  if (args.length !== 5 || args[0] !== '--repo' || args[2] !== '--config' || !['--preflight','--run','--stop','--resume'].includes(args[4])) fail('ARGUMENTS_INVALID');
  const paths = validateWorkerPaths(args[1], args[3]);
  assertPrivateConfigAcl(paths.configPath);
  assertPrivateConfigAcl(path.dirname(paths.configPath));
  const config = parseWorkerConfig(fs.readFileSync(paths.configPath,'utf8'));
  const ownedPaths = ownershipPaths(paths.repo,paths.configPath,config.DEFAULT_USER_ID);
  if (args[4] === '--stop') { requestWorkerStop(ownedPaths); console.log('Worker pause persisted; active cycle may still be finishing. Verify lock removal before restart.'); return; }
  if(config.OPENAI_SHARED_CREDIT_CONFIG){
    const creditPath=fs.realpathSync(config.OPENAI_SHARED_CREDIT_CONFIG);
    if(!fs.statSync(creditPath).isFile() || path.dirname(creditPath)!==path.dirname(paths.configPath))fail('SHARED_CREDIT_PRIVATE_DIRECTORY_REQUIRED');
    assertPrivateConfigAcl(creditPath);
    config.OPENAI_SHARED_CREDIT_CONFIG=creditPath;
  }
  if (args[4] === '--resume') { resumeWorker(ownedPaths); console.log('Worker pause cleared; no worker started.'); return; }
  const ownership = args[4] === '--run' ? acquireWorkerOwnership(ownedPaths) : undefined;
  let child;
  let childFinished = false;
  try {
  for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
  const require = createRequire(path.join(paths.repo,'package.json'));
  const { tsImport } = require('tsx/esm/api');
  const protocol = await tsImport(pathToFileURL(path.join(paths.repo,'server','office-protocol.ts')).href, import.meta.url);
  await preflightDatabase(config, require('pg').Pool, protocol.assertOfficeProtocolReady);
  if (args[4] === '--preflight') { console.log('Office worker preflight verified. No task was registered or executed.'); return; }
  if (ownership.stopRequested()) return;
  child = spawn(paths.node, ['--import','tsx','script/office-worker.ts'], { cwd:paths.repo, env:safeWorkerEnvironment(config), shell:false, windowsHide:true, stdio:['ignore','ignore','ignore','ipc'] });
  const code=await superviseOwnedWorker(child,ownership,ownedPaths);
  childFinished=true;
  if(code !== 0) throw new Error('WORKER_CYCLE_UNCONFIRMED');
  } finally {
    // A force-killed wrapper leaves a lock for explicit reconciliation. Never
    // unlock an uncertain live child or replay its provider request.
    if (ownership && (!child || childFinished || !child.pid)) ownership.release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Office Windows worker stopped: configuration, database identity, or execution was not verified. No automatic job retry.'); process.exitCode=1; });
