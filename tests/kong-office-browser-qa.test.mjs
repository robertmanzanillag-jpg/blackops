import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import express from 'express';
import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// This fixture never replaces the production DatabaseStorage or connects external apps.
test('KONG unified office: browser route, click, API, error and improvement scouts', async () => {
 const serveMode=process.argv.includes('--serve');
 const evidenceDir=path.resolve('work/kong-office-qa');await mkdir(evidenceDir,{recursive:true});
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
 if(!executablePath&&process.platform!=='win32'){try { executablePath=execFileSync('which',['chromium'],{encoding:'utf8'}).trim(); } catch { executablePath=undefined; }}
 const temp=await mkdtemp(path.join(process.cwd(),'.local-office-qa-'));
 const envKeys=['NODE_ENV','ALLOW_DEV_USER_FALLBACK','DEFAULT_USER_ID','APP_QA_BASE_URL','APP_QA_VISUAL_MODE'];
 const previous=new Map(envKeys.map(k=>[k,process.env[k]]));
  process.env.NODE_ENV='development';delete process.env.ALLOW_DEV_USER_FALLBACK;process.env.DEFAULT_USER_ID='fixture-owner';process.env.APP_QA_VISUAL_MODE='off';
 let browser,server;const users=new Map();const requests=[];
 globalThis.__officeLocalStorage={
  getUser:async id=>users.get(id),getUserByUsername:async name=>[...users.values()].find(u=>u.username===name),
  checkPersistentRateLimit:async()=>({allowed:true,remaining:19,resetAt:Date.now()+900000}),
  getAppProjects:async()=>[{id:'local-office',name:'Agents Office · LOCAL FIXTURE',environment:'development',priority:'low',status:'healthy',tags:[],publicUrl:globalThis.__officeLocalBase+'/agents-office',healthUrl:globalThis.__officeLocalBase+'/health',testCommand:'node --test tests/agents-office-local-qa.test.mjs',buildCommand:'npm run build'}],
  getAppHealthChecks:async()=>[],getAppIncidentsForProject:async()=>[],getAppErrorEvents:async()=>[],
  getTelegramConfig:async()=>{throw new Error('Passive local QA must not read external delivery settings');}
 };
 const modules={
  './storage':'export const storage=globalThis.__officeLocalStorage;',
  './github-client':'export const isGitHubConnected=async()=>true;export const listRepositories=async()=>[];',
  './telegram':'export const escapeTelegramHtml=v=>String(v);export const sendTelegramMessage=async()=>{throw new Error("No external delivery allowed");};export const sendTelegramPhoto=sendTelegramMessage;',
  './automation-registry':'export const recordScheduledAutomationRun=async()=>{throw new Error("No history writes allowed");};',
  './developer-autopilot':'export const createDeveloperAutopilotHandoff=async()=>{throw new Error("No remote handoff allowed");};'
 };
 try {
  await build({stdin:{contents:`export {registerLocalAuthRoutes,hashPassword} from './server/local-auth';export {createSessionMiddleware} from './server/session-config';export {resolveCurrentUserId} from './server/user-context';export {isConfiguredSingleUserOwner} from './server/single-user-owner';export {runAppQaScan,runVisualClickScout,__appQaAgentInternals} from './server/app-qa-agent';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(temp,'runtime.mjs'),plugins:[{name:'local-storage-only',setup(builder){builder.onResolve({filter:/^\.\/(storage|github-client|telegram|automation-registry|developer-autopilot)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));}}]});
  const runtime=await import(pathToFileURL(path.join(temp,'runtime.mjs')).href);
  const fixturePassword='local-fixture-password';
  for(const id of ['fixture-owner','fixture-member'])users.set(id,{id,username:id,password:await runtime.hashPassword(fixturePassword)});
  const app=express();app.use(express.json());app.use(runtime.createSessionMiddleware({enabled:true,secret:'isolated-fixture-session-key',storeKind:'memory',production:false,secureCookie:false}));
  runtime.registerLocalAuthRoutes(app);
  app.get('/health',(_req,res)=>res.json({status:'ok',scope:'fixture-memory-only'}));
  app.use('/api',async(req,res,next)=>{requests.push({method:req.method,path:req.path});const id=runtime.resolveCurrentUserId(req);if(!id)return res.status(401).json({error:'Authentication required'});req.fixtureUserId=id;next();});
  app.get('/api/fixture-owner-boundary',async(req,res)=>{if(!await runtime.isConfiguredSingleUserOwner(req.fixtureUserId))return res.status(403).json({error:'Owner only'});res.json({scope:'fixture owner'});});
  app.get('/api/monthly-goals',(req,res)=>res.json([{id:req.fixtureUserId+'-goal',title:'Meta LOCAL · '+req.fixtureUserId,completed:false}]));
  app.get('/api/projects',(_req,res)=>res.json([]));app.get('/api/legal-compliance/reports',(_req,res)=>res.json({reports:[],summary:{critico:0,revisar:0,info:0}}));
  // Explicit synthetic read adapters for the affected GitHub handoff consumer.
  // No real connection, repository, AI request, commit or push is used.
  app.get('/api/github/status',(_req,res)=>res.json({connected:true,user:{login:'fixture',name:'Synthetic read adapter',avatar_url:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'}}));
  app.get('/api/github/repos',(_req,res)=>res.json([{id:1,name:'office-fixture',full_name:'fixture/office-fixture',private:true,description:'Isolated QA fixture',language:'TypeScript'}]));
  app.get('/api/github/repos/fixture/office-fixture/contents',(_req,res)=>res.json([]));
  app.get('/api/ceo/go-live',(_req,res)=>res.json({status:'blocked',checks:[],scope:'LOCAL fixture only'}));
  app.get('/api/ceo/readiness',(_req,res)=>res.json({status:'blocked',checks:[],scope:'LOCAL fixture only'}));
  app.get('/api/ceo/conversation-history',(_req,res)=>res.json({messages:[]}));
  app.get('/api/agents-office/connections',(_req,res)=>{
   const blocked={status:'blocked',reason:'Isolated fixture. No provider connection.',checkedAt:new Date().toISOString()};
   res.json({claude:blocked,kong:blocked,worker:blocked});
  });
  app.get('/api/agents-office/cities',(_req,res)=>res.json(Array.from({length:25},(_,index)=>({
   id:'fixture-city-'+(index+1),name:'Ciudad de prueba '+(index+1),countryCode:'US',timeZone:'America/New_York',currency:'USD',
  }))));
  let kongUnavailable=true;
  app.get('/api/agents-office/kong-snapshot',(_req,res)=>{
   if(kongUnavailable)return res.status(503).json({error:'Isolated fixture without KONG activity access.'});
   res.json({evidence:{generatedAt:new Date().toISOString(),cityAgentsEnabled:true,cities:[]}});
  });
  app.get('/api/agent-council/state',(_req,res)=>res.json({enabled:false,cycles:0,costUsd:0,lessons:[],debates:[],proposals:[],overrides:{},scout:{lastRunAt:null,latest:[],error:null},company:{version:1,careers:{},trainees:[],orders:[],events:[]},leaderboard:[{agentId:'ceo',nickname:'MAIN-ONLY-SENTINEL',points:999,battery:100,level:'expert',rank:1,title:'main',reliability:1}],kongCompany:{version:1,careers:{},trainees:[],orders:[],events:[]},kongLeaderboard:[],kongCollaboration:{verified:false,observedAt:null,totalFindings:0,exchanges:[]}}));
  app.get('/api/app-qa-agent/status',async(req,res)=>res.json(await runtime.runAppQaScan(req.fixtureUserId,false,false,false)));
  app.use('/api',(req,res)=>req.method==='GET'?res.json([]):res.status(403).json({error:'Mutation outside local QA scope'}));
  // Serve the actual production build, not a dev proxy with HMR noise.
  await access(path.resolve('dist/public/index.html'));
  app.use(express.static(path.resolve('dist/public')));
  app.use((req,res,next)=>['GET','HEAD'].includes(req.method)?res.sendFile(path.resolve('dist/public/index.html')):next());
  server=await new Promise(resolve=>{const s=app.listen(serveMode?5000:0,serveMode?'0.0.0.0':'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;globalThis.__officeLocalBase=base;process.env.APP_QA_BASE_URL=base;
  if(serveMode){
   console.log('Isolated office QA fixture ready on port 5000. Memory-only sessions/data; no workers or external services.');
   await new Promise(resolve=>process.once('SIGTERM',resolve));
   return;
  }
  assert.equal((await fetch(base+'/api/monthly-goals',{headers:{'x-user-id':'fixture-owner'}})).status,401);
  const login=async username=>{const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:fixturePassword})});assert.equal(response.status,200);return response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');};
  const ownerCookie=await login('fixture-owner');const memberCookie=await login('fixture-member');
  assert.equal((await fetch(base+'/api/fixture-owner-boundary',{headers:{cookie:ownerCookie}})).status,200);
  assert.equal((await fetch(base+'/api/fixture-owner-boundary',{headers:{cookie:memberCookie}})).status,403);
  const memberGoals=await (await fetch(base+'/api/monthly-goals',{headers:{cookie:memberCookie}})).json();assert.equal(memberGoals[0].id,'fixture-member-goal');
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'fixture-owner',password:'wrong-password'})})).status,401);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://wrong-origin.invalid'},body:JSON.stringify({username:'fixture-owner',password:fixturePassword})})).status,403);
  console.log('QA fixture ready, launching Chrome');
  browser=await chromium.launch({executablePath,args:['--no-sandbox']});
  console.log('Chrome launched');
  const results=[];
  for(const mode of (process.env.KONG_QA_MODES?.split(',') || ['desktop','tablet','mobile','no-webgl'])) {
   const context=await browser.newContext({viewport:mode==='mobile'?{width:390,height:844}:mode==='tablet'?{width:1024,height:768}:{width:1440,height:1080},reducedMotion:'reduce'});
   await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
   await context.addCookies(ownerCookie.split('; ').map(item=>({name:item.split('=')[0],value:item.slice(item.indexOf('=')+1),url:base})));
   if(mode==='no-webgl')await context.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return String(kind).includes('webgl')?null:get.call(this,kind,...args);};});
   const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.stack);});
   console.log('Starting',mode);
   await page.goto(base+'/agents-office');
   await page.getByTestId('office-open-kong').click();console.log('KONG entered',mode);
   await page.getByTestId('world-company-label').filter({hasText:'KONG'}).waitFor();
   await page.getByTestId('world-deptnav').waitFor();
   const account=await page.getByRole('button',{name:'Salir',exact:true}).locator('..').boundingBox();assert.ok(account);
   for(const title of ['Oficina 3D','Edificio','Clasica','Supervisor KONG','Oficina KONG','Operacion KONG']){
    const box=await page.getByRole('button',{name:title,exact:true}).boundingBox();assert.ok(box,title);
    assert.ok(box.x>=0 && box.x+box.width<=page.viewportSize().width,title+' stays within viewport');
    assert.ok(box.x+box.width<=account.x || account.x+account.width<=box.x || box.y+box.height<=account.y || account.y+account.height<=box.y,title+' must not overlap account controls');
   }
   // One office contains the operational departments and all 25 city teams.
   const nav=page.getByTestId('world-deptnav');
   await page.waitForFunction(()=>document.querySelector('[data-testid=world-deptnav]')?.querySelectorAll('button').length>=25);
   assert.ok(await nav.getByRole('button').count()>=25,'All city teams must be reachable');
   assert.equal(await page.getByTestId('world-city-map-fallback').count(),0,'No separate cities-office fallback');
   await page.getByTestId('world-ranking').click();
   await page.getByTestId('world-ranking-panel').waitFor();
   assert.equal(await page.getByTestId('world-ranking-panel').getByText('MAIN-ONLY-SENTINEL',{exact:false}).count(),0);
   await page.getByTestId('world-ranking-panel').getByRole('button').click();
   await page.getByTestId('world-kong-collaboration').click();
   const collaboration=page.getByTestId('world-kong-collaboration-panel');
   await collaboration.getByText('Sin intercambios con evidencia vigente.').waitFor();
   await collaboration.getByRole('button',{name:'Cerrar colaboración'}).click();
   await nav.getByRole('button',{name:'Ciudad de prueba 25',exact:true}).click();
   const cityRows=page.locator('[data-testid^="world-agent-row-kong-city:fixture-city-25:"]');
   await cityRows.first().waitFor();assert.equal(await cityRows.count(),7);
   assert.match(await cityRows.first().innerText(),/Sin evidencia/);
   await cityRows.first().click();
   await page.getByTestId('world-agent-card').waitFor();
   assert.equal(await page.getByTestId('world-career').count(),0,'No fake career when server has no history');
   await page.getByTestId('world-overview').click();
   if(mode!=='no-webgl'){await page.locator('[data-testid^="world-dept-kong-city:"]').first().waitFor();await page.getByTestId('world-canvas-host').filter({has:page.locator('canvas')}).waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid=world-canvas-host]')?.dataset.sceneSettled==='true');}
   await page.evaluate(()=>{const badge=document.createElement('div');badge.textContent='DATOS DE PRUEBA · QA LOCAL';badge.style.cssText='position:fixed;bottom:4px;right:8px;z-index:9999;background:#111827;color:#fff;padding:4px 8px;font:11px sans-serif;border:1px solid #94a3b8';badge.id='qa-fixture-label';document.body.append(badge);});
   await page.screenshot({path:path.join(evidenceDir,mode+'-kong-office.png'),fullPage:true});
   console.log('Basic UI completed',mode);
   if(mode==='desktop') {
    let stale=false;
    await page.route('**/api/agents-office/kong-snapshot',route=>{
     const now=Date.now();const iso=new Date(now-(stale?600000:0)).toISOString();
     return route.fulfill({json:{evidence:{generatedAt:iso,cityAgentsEnabled:true,cities:[{id:'fixture-city-1',name:'Ciudad de prueba 1',countryCode:'US',timeZone:'America/New_York',currency:'USD',categories:[{category:'media',state:'running',evidence:'persisted',lastRunAt:null,lastSuccessAt:null,lastStartedAt:new Date(now-1000).toISOString(),nextRunAt:null,leaseUntil:new Date(now+90000).toISOString(),issues:[]}]}]},collaboration:{verified:true,observedAt:iso,totalFindings:1,exchanges:[{id:'fixture-proposal',cityId:'fixture-city-1',category:'media',kind:'attention',evidenceAt:iso,comments:[{author:'supervisor',text:'Hallazgo sintético de QA.'},{author:'operations',text:'Revisar la fuente antes del próximo turno.'}],proposal:{recipient:'ceo',status:'proposed',action:'review_city_improvement',text:'Propuesta sintética pendiente.'}}]}}});
    });
    console.log('Loading live snapshot');
    await page.reload();await page.getByTestId('office-open-kong').click();console.log('Live office entered');
    await page.getByTestId('world-working-count').filter({hasText:/^1 ejecutando ahora/}).waitFor();console.log('Live work verified');
    await page.getByTestId('world-kong-collaboration').click();
    await page.getByTestId('world-kong-collaboration-panel').getByText('Hallazgo sintético de QA.',{exact:false}).waitFor();
    await page.getByTestId('world-kong-collaboration-panel').getByText('Propuesta sintética pendiente.',{exact:false}).waitFor();
    await page.evaluate(()=>{const badge=document.createElement('div');badge.textContent='DATOS DE PRUEBA · QA LOCAL';badge.style.cssText='position:fixed;bottom:4px;right:8px;z-index:9999;background:#111827;color:#fff;padding:4px 8px;font:11px sans-serif;border:1px solid #94a3b8';document.body.append(badge);});
    await page.screenshot({path:path.join(evidenceDir,'desktop-live-fixture.png'),fullPage:true});
    await page.getByTestId('world-kong-collaboration-panel').getByRole('button',{name:'Cerrar colaboración'}).click();
    await page.getByTestId('world-deptnav').getByRole('button',{name:'Ciudad de prueba 1',exact:true}).click();
    await page.getByTestId('world-agent-row-kong-city:fixture-city-1:media').click();
    await page.getByTestId('world-agent-card').getByText('Ejecutando · verificado',{exact:false}).waitFor();
    await page.screenshot({path:path.join(evidenceDir,'desktop-active-agent-fixture.png'),fullPage:true});
    console.log('Live collaboration verified');stale=true;await page.reload();await page.getByTestId('office-open-kong').click();
    await page.getByTestId('world-working-count').filter({hasText:/^0 ejecutando ahora/}).waitFor();
    await page.getByTestId('world-kong-collaboration').click();
    await page.getByTestId('world-kong-collaboration-panel').getByText('Sin intercambios con evidencia vigente.').waitFor();
    assert.equal(await page.getByTestId('world-kong-collaboration-panel').getByText('Hallazgo sintético de QA.',{exact:false}).count(),0);console.log('Stale evidence fails closed');
   }
   results.push({mode,entry:'pass',departments:await nav.getByRole('button').count(),errors});
   assert.deepEqual(errors,[]);
   await context.close();
  }
  kongUnavailable=false;
  const passive=await runtime.runAppQaScan('fixture-owner',false,false,false);
  for(const id of ['route-scout','link-click-scout','api-scout','error-scout'])assert.equal(passive.subAgents.find(s=>s.id===id).status,'pass',JSON.stringify(passive));
  assert.equal(passive.improvementIdeas.length,0);assert.equal(passive.telegramSent,false);assert.equal(passive.dailyDigestSent,false);
  const nativePlaywright={chromium:{launch:async options=>{const real=await chromium.launch({...options,executablePath});const original=real.newContext.bind(real);real.newContext=async settings=>{const ctx=await original(settings);await ctx.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));const response=await ctx.request.post(base+'/api/auth/login',{data:{username:'fixture-owner',password:fixturePassword}});assert.equal(response.status(),200);return ctx;};return real;}}};
  const officeRoute=runtime.__appQaAgentInternals.LOCAL_ROUTE_MAP.filter(r=>r.path==='/agents-office');
  const visual=await runtime.runVisualClickScout(officeRoute,{loadPlaywright:async()=>nativePlaywright});
  await writeFile(path.join(evidenceDir,'app-qa-scouts.json'),JSON.stringify({scope:'Local fixture only',passive,visual},null,2));
  assert.equal(visual.status,'pass',JSON.stringify(visual.findings));assert.deepEqual(visual.visualScans.flatMap(s=>s.consoleErrors),[]);
  await writeFile(path.join(evidenceDir,'browser-results.json'),JSON.stringify({scope:'Compiled app with isolated memory fixture. No production readiness claim.',results,requests},null,2));
 } catch(error) {console.error(error);for(const ctx of browser?.contexts()||[])for(const page of ctx.pages()){console.error((await page.locator('body').innerText({timeout:3000}).catch(()=>'' )).slice(0,16000));await page.screenshot({path:path.join(evidenceDir,'failure.png'),timeout:3000}).catch(()=>{});}throw error;} finally {
  if(server)server.closeAllConnections();
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));for(const [k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}delete globalThis.__officeLocalStorage;delete globalThis.__officeLocalBase;await rm(temp,{recursive:true,force:true});
 }
});
