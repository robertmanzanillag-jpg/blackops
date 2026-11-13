import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('actual GET status handler reports critical findings without Telegram or writes; explicit notify still works', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'qa-readonly-'));
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousVisual = process.env.APP_QA_VISUAL_MODE;
  const previousFetch = globalThis.fetch;
  globalThis.__qaReadonlyFixture = { sends: 0, telegramReads: 0 };
  process.env.TELEGRAM_BOT_TOKEN = 'fixture-only-token';
  process.env.APP_QA_VISUAL_MODE = 'every_scan';
  globalThis.fetch = async () => { throw new Error('Unexpected outbound request'); };
  const modules = {
    './automation-registry': `export const recordScheduledAutomationRun=async()=>{throw new Error('Unexpected history write');};`,
    './developer-autopilot': `export const createDeveloperAutopilotHandoff=async()=>{throw new Error('Unexpected GitHub handoff');};`,
    './storage': `export const storage = {
      getAppProjects:async()=>[{id:'fixture',name:'Fixture',environment:'production',status:'healthy',tags:[]}],
      getAppHealthChecks:async()=>[],getAppErrorEvents:async()=>[],
      getAppIncidentsForProject:async()=>[{id:'incident',severity:'critical',status:'open',title:'Real fixture failure',summary:'Fixture only',firstSeenAt:new Date(),lastSeenAt:new Date()}],
      getTelegramConfig:async()=>{globalThis.__qaReadonlyFixture.telegramReads++;return {enabled:true,chatId:'fixture-chat'};}
    };`,
    './github-client': `export const isGitHubConnected=async()=>false; export const listRepositories=async()=>[];`,
    './ceo-doctor-cli': `export const hasRealValue=value=>Boolean(value);`,
    './telegram': `export const escapeTelegramHtml=value=>String(value); export const sendTelegramMessage=async()=>{globalThis.__qaReadonlyFixture.sends++;return true;}; export const sendTelegramPhoto=async()=>{throw new Error('Unexpected photo');};`,
  };
  try {
    await build({ entryPoints:['server/app-qa-agent.ts'], bundle:true, platform:'node', format:'esm', packages:'external', outfile:path.join(temp,'scan.mjs'), plugins:[{
      name:'no-outbound-fixtures', setup(builder) {
        builder.onResolve({filter:/^\.\/(storage|github-client|ceo-doctor-cli|telegram|automation-registry|developer-autopilot)$/},args=>({path:args.path,namespace:'fixture'}));
        builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));
      },
    }] });
    const { runAppQaScan } = await import(pathToFileURL(path.join(temp,'scan.mjs')).href);
    const routes = await readFile('server/routes.ts','utf8');
    const registration = routes.slice(routes.indexOf('  app.get("/api/app-qa-agent/status"'), routes.indexOf('  app.post("/api/app-qa-agent/scan"'));
    let handler;
    new Function('app','runAppQaScan','getCurrentUserId',registration)({get:(url,callback)=>{assert.equal(url,'/api/app-qa-agent/status');handler=callback;}},runAppQaScan,()=> 'fixture-owner');
    let result;
    await handler({}, {json:value=>{result=value;},status:()=>{throw new Error('Unexpected error response');}});
    assert.ok(result.findings.some(f=>f.severity==='critical'));
    assert.equal(result.telegramSent,false);
    assert.equal(result.subAgents.find(agent=>agent.id==='visual-click-scout').checked,0);
    assert.deepEqual(result.visualScans,[]);
    assert.deepEqual(globalThis.__qaReadonlyFixture,{sends:0,telegramReads:0});
    process.env.APP_QA_VISUAL_MODE = 'off';
    const notified = await runAppQaScan('fixture-owner',true);
    assert.equal(notified.telegramSent,true);
    assert.deepEqual(globalThis.__qaReadonlyFixture,{sends:1,telegramReads:1});
  } finally {
    globalThis.fetch=previousFetch;
    if(previousToken===undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN=previousToken;
    if(previousVisual===undefined) delete process.env.APP_QA_VISUAL_MODE; else process.env.APP_QA_VISUAL_MODE=previousVisual;
    delete globalThis.__qaReadonlyFixture;
    await rm(temp,{recursive:true,force:true});
  }
});
