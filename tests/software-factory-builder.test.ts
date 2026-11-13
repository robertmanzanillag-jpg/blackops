import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFactoryBuilderAdapter, createFactoryPipelineBuilder, createDockerFactoryRunner, type FactoryBuilderDependencies, type FactoryBuildInput } from '../server/software-factory-builder';
const input: FactoryBuildInput = { repository:'owner/app',baseSha:'a'.repeat(40),request:'Fix label',reservedCents:20,testCommand:['npm','test'],buildCommand:['npm','run','build'] };
const patch='--- a/label.txt\n+++ b/label.txt\n@@ -1 +1 @@\n-old\n+new\n';
function fixture(overrides:Partial<FactoryBuilderDependencies>={}) {
 const calls:string[]=[];
 const deps:FactoryBuilderDependencies={
  exportSource:async(_r,sha,dir)=>{await writeFile(path.join(dir,'label.txt'),'old\n');return {sha};},
  generatePatch:async()=>({patch,costCents:10}),
  runIsolated:async c=>{if(c.argv[0] !== 'git') assert.equal(c.readOnlySource,true);calls.push(c.argv.join(' '));},
  publishPullRequest:async request=>{calls.push('publish');return {headSha:'b'.repeat(40),prUrl:'https://github.com/owner/app/pull/1',appliedPatchSha256:request.expectedPatchSha256};},...overrides};
 return {run:createFactoryBuilderAdapter(deps),calls};
}
test('missing trusted adapters block rather than simulate build success',async()=>{assert.equal((await createFactoryBuilderAdapter()(input)).status,'blocked');});
test('pinned export, isolated checks, then trusted PR publication',async()=>{const {run,calls}=fixture();const result=await run(input);assert.equal(result.status,'completed');assert.equal(result.costCents,10);assert.deepEqual(calls,['git apply --check .factory.patch','git apply .factory.patch','npm test','npm run build','publish']);});
test('failed checks prevent PR publication',async()=>{const {run,calls}=fixture({runIsolated:async()=>{throw Error('broken');}});assert.equal((await run(input)).status,'failed');assert.deepEqual(calls,[]);});
test('wrong source version prevents model spend',async()=>{let model=false;const {run}=fixture({exportSource:async()=>({sha:'c'.repeat(40)}),generatePatch:async()=>{model=true;return {patch,costCents:10};}});assert.equal((await run(input)).status,'failed');assert.equal(model,false);});
test('export containing secrets is rejected before model',async()=>{const {run}=fixture({exportSource:async(_r,sha,dir)=>{await writeFile(path.join(dir,'.env'),'FAKE=fixture');return {sha};}});assert.equal((await run(input)).status,'failed');});
test('protected patch and cost overrun cannot publish',async()=>{for(const generated of [{patch:patch.replaceAll('label.txt','.env'),costCents:10},{patch,costCents:21}]){const {run,calls}=fixture({generatePatch:async()=>generated});assert.notEqual((await run(input)).status,'completed');assert.deepEqual(calls,[]);}});
test('uncertain publication is never a retryable success',async()=>{const {run}=fixture({publishPullRequest:async()=>{throw Error('lost response');}});assert.equal((await run(input)).status,'unknown');});
test('no reservation blocks model and digest pinning is mandatory',async()=>{const {run,calls}=fixture();assert.equal((await run({...input,reservedCents:0})).status,'blocked');assert.deepEqual(calls,[]);assert.throws(()=>createDockerFactoryRunner({image:'node:latest'}));});
test('Docker command envelope excludes host credentials and enables isolation',async()=>{
 const {mkdtemp,readFile,chmod,rm}=await import('node:fs/promises');const os=await import('node:os');
 const dir=await mkdtemp(path.join(os.tmpdir(),'factory-docker-test-'));
 const executable=path.join(dir,'docker'), report=path.join(dir,'report.json');
 const prior=process.env.FACTORY_TEST_SECRET;process.env.FACTORY_TEST_SECRET='synthetic-do-not-forward';
 try {
  await writeFile(executable,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(report)},JSON.stringify({args:process.argv.slice(2),env:process.env}));\n`);await chmod(executable,0o700);
  await createDockerFactoryRunner({image:'node@sha256:'+'a'.repeat(64),executable})({workspace:dir,argv:['npm','test']});
  const record=JSON.parse(await readFile(report,'utf8'));
  assert.equal(record.env.FACTORY_TEST_SECRET,undefined);
  for(const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=1g','--pids-limit=128'])assert.ok(record.args.includes(flag));
  assert.deepEqual(record.args.slice(-2),['npm','test']);
  assert.ok(record.args.some((arg:string)=>arg.endsWith('dst=/workspace,readonly')));
 } finally {if(prior===undefined)delete process.env.FACTORY_TEST_SECRET;else process.env.FACTORY_TEST_SECRET=prior;await rm(dir,{recursive:true,force:true});}
});
test('timed out containers are removed before the runner returns',async()=>{
 const {mkdtemp,readFile,chmod,rm}=await import('node:fs/promises');const os=await import('node:os');
 const dir=await mkdtemp(path.join(os.tmpdir(),'factory-timeout-test-')), executable=path.join(dir,'docker'), report=path.join(dir,'removed');
 try {
  await writeFile(executable,`#!${process.execPath}\nif(process.argv[2]==='rm'){require('node:fs').writeFileSync(${JSON.stringify(report)},'removed');process.exit(0)}setInterval(()=>{},1000);\n`);await chmod(executable,0o700);
  const run=createDockerFactoryRunner({image:'node@sha256:'+'a'.repeat(64),executable,timeoutMs:100});
  await assert.rejects(run({workspace:dir,argv:['npm','test']}),/ISOLATED_CHECK_FAILED/);
  assert.equal(await readFile(report,'utf8'),'removed');
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('unconfirmed container cleanup makes the build outcome unknown',async()=>{
 const {run}=fixture({runIsolated:async()=>{throw Error('ISOLATED_CLEANUP_UNCONFIRMED');}});
 assert.equal((await run(input)).status,'unknown');
});

test('publication must attest the exact tested patch hash',async()=>{const {run}=fixture({publishPullRequest:async()=>({headSha:'b'.repeat(40),prUrl:'https://github.com/owner/app/pull/1',appliedPatchSha256:'c'.repeat(64)})});assert.equal((await run(input)).status,'unknown');});


test('pipeline bridge preserves known failures instead of making them uncertain', async () => {
 const build=createFactoryPipelineBuilder({dependencies:{}, commands:()=>({test:['npm','test'],build:['npm','run','build']}),attest:async()=>{throw Error('must not attest');}});
 const result=await build({repo:'owner/app'} as any,{finding:{baseSha:input.baseSha,request:input.request}} as any,{signal:new AbortController().signal,maxCostCents:20});
 assert.ok('status' in result);
 if ('status' in result) {assert.equal(result.status,'blocked');assert.equal(result.costCents,0);}
});


test('pipeline bridge retains paid failed checks and uncertain publication distinctly', async () => {
 for(const publish of [false,true]) {
  const build=createFactoryPipelineBuilder({dependencies:{
   exportSource:async(_repo,sha,dir)=>{await writeFile(path.join(dir,'label.txt'),'old\n');return {sha};},
   generatePatch:async()=>({patch,costCents:10}),
   runIsolated:async()=>{if(!publish)throw Error('known failed check');},
   publishPullRequest:async()=>{throw Error('lost publication response');},
  },commands:()=>({test:['npm','test'],build:['npm','run','build']}),attest:async()=>{throw Error('must not attest');}});
  const result=await build({repo:'owner/app'} as any,{finding:{baseSha:input.baseSha,request:input.request}} as any,{signal:new AbortController().signal,maxCostCents:20});
  assert.ok('status' in result);
  if('status' in result){assert.equal(result.status,publish?'unknown':'failed');assert.equal(result.costCents,10);}
 }
});
