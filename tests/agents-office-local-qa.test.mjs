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
test('office local QA: actual sessions, owner isolation and native scouts with fixture storage', async () => {
 const serveMode=process.argv.includes('--serve');
 const evidenceDir=path.resolve('.local/office-evidence');await mkdir(evidenceDir,{recursive:true});
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
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
   let cityDirectoryFailures=0;
   app.get('/api/agents-office/cities',(_req,res)=>{
    if(cityDirectoryFailures++===0)return res.status(503).json({error:'One transient fixture failure.'});
    res.json(Array.from({length:25},(_,index)=>({
     id:'fixture-city-'+(index+1),name:'Ciudad de prueba '+(index+1),countryCode:'US',timeZone:'America/New_York',currency:'USD',
    })));
   });
  let kongUnavailable=true;
  app.get('/api/agents-office/kong-snapshot',(_req,res)=>{
    if(kongUnavailable){kongUnavailable=false;return res.status(503).json({error:'One transient fixture failure.'});}
    const now=Date.now();
    const lastRunAt=new Date(now-60_000).toISOString();
    const nextRunAt=new Date(now+60_000).toISOString();
    const centralAgents=[
     {id:'kong-videos',name:'Videos Kong',kind:'department',owner:'fixture',responsibility:'Videos',state:'running',lastRunAt:null,nextRunAt,blocker:null,nextAction:'Fixture current execution',issues:[]},
     {id:'kong-ai',name:'KONG AI',kind:'department',owner:'fixture',responsibility:'AI',state:'healthy',lastRunAt,nextRunAt,blocker:null,nextAction:'Fixture result',issues:[]},
     {id:'kong-promoters',name:'Promoters + Mesas',kind:'department',owner:'fixture',responsibility:'Promoters',state:'attention',lastRunAt,nextRunAt,blocker:null,nextAction:'Review coverage',issues:['Aviso de cobertura: datos pendientes']},
     {id:'kong-venues',name:'Venues',kind:'department',owner:'fixture',responsibility:'Venues',state:'unknown',lastRunAt:null,nextRunAt:null,blocker:'No hay evidencia',nextAction:'',issues:[]},
     {id:'kong-legal',name:'Kong Legal',kind:'department',owner:'fixture',responsibility:'Legal',state:'disabled',lastRunAt,nextRunAt:null,blocker:'Desactivado en fixture',nextAction:'',issues:[]},
    ];
    const cities=Array.from({length:25},(_,index)=>({
     id:'fixture-city-'+(index+1),name:'Ciudad de prueba '+(index+1),countryCode:'US',timeZone:'America/New_York',currency:'USD',
     status:'needs_attention',categories:Array.from({length:7},(_,categoryIndex)=>{
      const category=['clubs','vip','restaurants','events','sports','experiences','media'][categoryIndex];
      // A persisted running flag is not current work after its lease expires.
      // The later liveSnapshot fixture separately verifies a valid active lease.
      const expiredRun=index===0&&category==='media';
      return {category,state:expiredRun?'running':'unknown',evidence:expiredRun?'persisted':'missing',lastRunAt:null,lastSuccessAt:null,lastStartedAt:expiredRun?new Date(now-120_000).toISOString():null,
       nextRunAt:expiredRun?nextRunAt:null,leaseUntil:expiredRun?new Date(now-30_000).toISOString():null,intervalMs:86_400_000,recordedFailure:false,issues:[]};
     }),
    }));
    res.json({text:'Synthetic KONG Native read fixture.',completedAt:new Date(now).toISOString(),evidence:{generatedAt:new Date(now).toISOString(),citySnapshotCheckedAt:new Date(now).toISOString(),agents:centralAgents,
     cityAgentsEnabled:true,cityCoverageComplete:true,cities}});
  });
  app.get('/api/agent-council/state',(_req,res)=>res.json({enabled:false,cycles:0,costUsd:0,lessons:[],debates:[],proposals:[],overrides:{},scout:{lastRunAt:null,latest:[],error:null}}));
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
  browser=await chromium.launch({executablePath,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1080},reducedMotion:'reduce'});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const loginForm=async username=>{
   await page.getByLabel('Usuario',{exact:true}).fill(username);
   await page.getByLabel('Password',{exact:true}).fill(fixturePassword);
   const [loggedIn,session]=await Promise.all([
    page.waitForResponse(r=>r.url()===base+'/api/auth/login'&&r.request().method()==='POST'),
    page.waitForResponse(r=>r.url()===base+'/api/auth/me'&&r.request().method()==='GET'),
    page.getByRole('button',{name:'Entrar',exact:true}).last().click(),
   ]);
   assert.equal(loggedIn.status(),200);assert.equal(session.status(),200);
   const auth=await session.json();assert.equal(auth.sessionBacked,true);assert.equal(auth.user?.id,username);
  };
  const company=page.locator('.company-office');
  const openCompany=async()=>{
   await page.getByTestId('button-back-home').waitFor();
   await page.getByRole('button',{name:/^Abrir Company World/}).click();
   await company.getByRole('heading',{name:'Tu empresa, en movimiento.'}).waitFor();
  };
  await page.addInitScript(()=>localStorage.setItem('blackops-local-auth-user',JSON.stringify({id:'fixture-owner',username:'fixture-owner'})));
  await page.goto(base+'/agents-office');await page.getByLabel('Usuario',{exact:true}).waitFor();assert.equal(await page.locator('.company-office').count(),0);
  const protectedRoutes=runtime.__appQaAgentInternals.LOCAL_ROUTE_MAP.filter(r=>!r.path.startsWith('/news'));
  for(const route of protectedRoutes){
   const concrete=route.path.replace(':symbol','FIXTURE');
   await page.goto(base+concrete);await page.getByLabel('Usuario',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Salir',exact:true}).count(),0);
  }
  await writeFile(path.join(evidenceDir,'affected-route-auth-guards.json'),JSON.stringify({scope:'Actual compiled auth gate, anonymous browser, isolated backend; not signed-in page certification',routes:protectedRoutes.map(r=>({path:r.path,status:'pass',check:'real login required'}))},null,2));
  await page.goto(base+'/agents-office');await page.getByLabel('Usuario',{exact:true}).waitFor();
  await loginForm('fixture-member');console.log('Owner isolation/login passed; entering unified office');
  const mainPanelToggle=page.getByTestId('world-main-panel-toggle');
  await mainPanelToggle.click();
  assert.equal(await page.getByTestId('world-kong-wing').isVisible(),false);
  await mainPanelToggle.click();
  assert.equal(await page.getByTestId('world-kong-wing').isVisible(),true);
  await page.getByTestId('world-kong-wing').click();
  await page.getByTestId('world-company-label').filter({hasText:'KONG'}).waitFor();
  const departmentNav=page.getByTestId('world-deptnav');
  await departmentNav.getByRole('button',{name:'Ciudad de prueba 25',exact:true}).waitFor();
  assert.equal(cityDirectoryFailures,2,'city directory should recover after its first failed load');
  assert.equal(kongUnavailable,false,'KONG snapshot should recover after its first failed load');
  await departmentNav.getByRole('button',{name:'Contenido KONG',exact:true}).click();
  await page.getByTestId('world-agent-row-kong-videos').waitFor();
  assert.equal(await page.getByTestId('world-agent-row-kong-metrics').count(),1,'preserve the separate KONG metrics desk');
  await page.getByTestId('world-agent-row-kong-videos').click();
  await page.getByTestId('world-kong-native-evidence-kong-videos').getByText('Ejecución actual reportada por KONG Native').waitFor();
  assert.equal(await page.getByTestId('world-talk').isEnabled(),true);
  await page.getByLabel('Chat de estado',{exact:true}).fill('¿Qué estás haciendo?');
  await page.getByRole('button',{name:'Preguntar',exact:true}).click();
  await page.getByRole('status').filter({hasText:/no incluye el detalle de la tarea/}).waitFor();
  await page.getByTestId('world-talk').click();
  await page.getByRole('heading',{name:/Videos Kong/i,exact:true}).waitFor();
  await page.getByTestId('button-close-agent-card').click();
  await page.getByTestId('world-overview').click();
  assert.equal(await page.getByTestId('world-city-map-fallback').count(),0,'KONG has one unified office');
  const cityMarkers=page.locator('[data-testid^="world-dept-kong-city:"]');
  const fallback=page.getByTestId('world-kong-fallback');
  await cityMarkers.first().or(fallback).waitFor();
  const hasMap=await cityMarkers.count()>0;
  if(hasMap){
   assert.equal(await cityMarkers.count(),25);
   assert.equal(await page.getByTestId('world-canvas-host').getAttribute('data-city-desk-count'),'175','All city desks exist in the unified scene');
   assert.equal(await page.getByTestId('world-canvas-host').getAttribute('data-city-running-desk-count'),'0','Expired city lease is not running');
  }
  await page.getByTestId('world-city-director-toggle').click();
  const director=page.getByTestId('world-city-director-panel');
  await director.waitFor();
  assert.equal(await director.getByText(/Puntos del equipo|Puntaje parcial/).count(),0);
  assert.equal(await director.getByRole('listitem').count(),7);
  assert.equal(await director.getByRole('listitem').filter({hasText:'Sin puntuación'}).count(),7);
  await director.getByText('Relevos propuestos · 0',{exact:true}).waitFor();
  await director.getByRole('button',{name:'Cerrar',exact:true}).click();
  await departmentNav.getByRole('button',{name:'Ciudad de prueba 25',exact:true}).click();
  const selectedAgents=page.locator('[data-testid^="world-agent-row-kong-city:fixture-city-25:"]');
  await selectedAgents.first().waitFor();assert.equal(await selectedAgents.count(),7);
  assert.match(await selectedAgents.first().innerText(),/Sin evidencia/);
  await page.getByTestId('world-agent-row-kong-city:fixture-city-25:media').click();
  await page.getByLabel('Chat de estado',{exact:true}).fill('¿Qué tarea tienes?');
  await page.getByRole('button',{name:'Preguntar',exact:true}).click();
  await page.getByRole('status').filter({hasText:/KONG no confirma una ejecución actual/}).waitFor();
  if(hasMap){
   const avatars=page.locator('[data-testid^="world-avatar-kong-city:fixture-city-25:"]');
   assert.equal(await avatars.count(),7);
   assert.ok((await avatars.allTextContents()).every(text=>!text.includes('Ciudad de prueba 25')));
   assert.match(await avatars.first().getAttribute('aria-label'),/Ciudad de prueba 25/);
  }
  await page.getByTestId('world-overview').click();
  await departmentNav.getByRole('button',{name:'Ciudad de prueba 1',exact:true}).click();
  assert.equal(await page.locator('[data-testid^="world-agent-row-kong-city:fixture-city-1:"]').count(),7);
  await page.getByTestId('world-agent-row-kong-city:fixture-city-1:media').getByText('Ejecucion sin vigencia',{exact:false}).waitFor();
  console.log('Central evidence, expired lease and city navigation passed');
  const liveSnapshot = '**/api/agents-office/kong-snapshot';
  await page.route(liveSnapshot, route => {
   const now=Date.now();
   return route.fulfill({json:{evidence:{generatedAt:new Date(now).toISOString(),cityAgentsEnabled:true,cities:[{
    id:'fixture-city-1',name:'Ciudad de prueba 1',countryCode:'US',timeZone:'America/New_York',currency:'USD',categories:[{
     category:'media',state:'running',evidence:'persisted',lastRunAt:null,lastSuccessAt:null,lastStartedAt:new Date(now-1000).toISOString(),nextRunAt:null,leaseUntil:new Date(now+90000).toISOString(),issues:[],
    }],
   }]}}});
  });
  await page.reload();
  await page.getByTestId('world-kong-wing').click();
  await page.getByTestId('world-deptnav').getByRole('button',{name:'Ciudad de prueba 1',exact:true}).click();
  await page.getByTestId('world-agent-row-kong-city:fixture-city-1:media').click();
  await page.getByTestId('world-agent-card').getByText('Ciudad de prueba 1 · Fotos y media',{exact:true}).waitFor();
  await page.getByLabel('Chat de estado',{exact:true}).fill('¿Qué estás haciendo?');
  await page.getByRole('button',{name:'Preguntar',exact:true}).click();
  await page.getByRole('status').filter({hasText:/Audita imágenes y flyers/}).waitFor();
  await page.getByTestId('world-city-director-toggle').click();
  const scoredDirector=page.getByTestId('world-city-director-panel');
  await scoredDirector.getByText(/Puntaje parcial: 100\/100 · 1\/7 puestos verificados/).waitFor();
  await scoredDirector.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.unroute(liveSnapshot);
  await page.getByTestId('world-kong-wing').click();
  console.log('Live city evidence passed');
  await openCompany();await company.getByText(/Meta LOCAL · fixture-member/).waitFor();
  await page.getByLabel('Objetivo',{exact:true}).fill('Plan privado del miembro LOCAL');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Meta simulada guardada.'}).waitFor();
  assert.equal(await company.getByRole('navigation',{name:'Departamentos'}).getByRole('button').count(),6);
  assert.equal(await page.locator('.company-office').getAttribute('data-paused'),'true');
  assert.equal(await page.getByRole('button',{name:'Reanudar movimiento'}).isDisabled(),true);
  await page.getByRole('slider',{name:'Zoom del campus'}).focus();
  await page.getByRole('slider',{name:'Zoom del campus'}).press('End');
  assert.equal(await page.getByRole('slider',{name:'Zoom del campus'}).inputValue(),'1.2');
  for(let i=0;i<4;i++){
   await page.getByRole('button',{name:/^Ocultar Company World/}).click();
   assert.equal(await company.count(),0);
   assert.equal(await page.getByTestId('button-back-home').isVisible(),true);
   await openCompany();
   assert.equal(await company.getByLabel('Objetivo',{exact:true}).inputValue(),'Plan privado del miembro LOCAL');
  }
  await company.getByRole('navigation',{name:'Departamentos'}).getByRole('button',{name:/Ingeniería/}).click();await company.getByRole('button',{name:'App QA',exact:true}).click();
  await page.screenshot({path:path.join(evidenceDir,'integrated-session-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(evidenceDir,'integrated-session-mobile.png'),fullPage:true});
  await page.goto(base+'/app-qa-agent');await page.getByRole('heading',{name:'Cobertura y resultados por misión'}).waitFor();await page.getByText('26/26 rutas clasificadas.',{exact:false}).waitFor();assert.equal(await page.locator('[data-testid^=qa-mission-]').count(),5);await page.setViewportSize({width:1440,height:1080});await page.screenshot({path:path.join(evidenceDir,'missions-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(evidenceDir,'missions-mobile.png'),fullPage:true});await page.goto(base+'/agents-office');await openCompany();
  await page.route('**/api/auth/logout',route=>route.fulfill({status:503,json:{error:'Fixture logout unavailable'}}));await page.getByRole('button',{name:'Salir',exact:true}).click();await page.getByRole('alert').filter({hasText:/No se pudo cerrar/}).waitFor();assert.equal(await page.locator('.company-office').count(),1);await page.unroute('**/api/auth/logout');
  await page.getByRole('button',{name:'Salir',exact:true}).click();await page.getByLabel('Usuario',{exact:true}).waitFor();assert.equal(await page.locator('.company-office').count(),0);assert.equal((await context.request.get(base+'/api/monthly-goals')).status(),401);assert.deepEqual(errors,[]);
  await loginForm('fixture-owner');await openCompany();
  await page.getByText(/Meta LOCAL · fixture-owner/).waitFor();
  assert.notEqual(await page.getByLabel('Objetivo',{exact:true}).inputValue(),'Plan privado del miembro LOCAL');
  await page.evaluate(()=>{
   localStorage.setItem('office.githubAgentHandoff:owner:fixture-member',JSON.stringify({repo:'fixture/office-fixture',task:'MEMBER-ONLY fixture handoff'}));
   localStorage.setItem('office.githubAgentHandoff:owner:fixture-owner',JSON.stringify({repo:'fixture/office-fixture',task:'OWNER-ONLY fixture handoff'}));
   localStorage.setItem('office.githubAgentHandoff',JSON.stringify({repo:'fixture/office-fixture',task:'UNOWNED legacy fixture handoff'}));
  });
  await page.goto(base+'/github-agent?repo=fixture%2Foffice-fixture');
  await page.getByTestId('github-agent-page').waitFor();
  await page.locator('textarea').waitFor();
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='OWNER-ONLY fixture handoff');
  assert.equal(await page.getByText('MEMBER-ONLY fixture handoff',{exact:false}).count(),0);
  assert.equal(await page.getByText('UNOWNED legacy fixture handoff',{exact:false}).count(),0);
  await page.screenshot({path:path.join(evidenceDir,'github-owner-handoff.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(evidenceDir,'github-owner-handoff-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Salir',exact:true}).click();await page.getByLabel('Usuario',{exact:true}).waitFor();
  await loginForm('fixture-member');
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='MEMBER-ONLY fixture handoff');
  assert.equal(await page.getByText('OWNER-ONLY fixture handoff',{exact:false}).count(),0);
  assert.deepEqual(errors,[]);
  await writeFile(path.join(evidenceDir,'github-handoff-verification.json'),JSON.stringify({scope:'Real compiled consumer and backend sessions; synthetic read-only repository adapters',status:'pass',ownerAndMemberSeparated:true,unownedStateIgnored:true,externalActions:0},null,2));
  await context.close();await browser.close();browser=null;
  kongUnavailable=false;
  const passive=await runtime.runAppQaScan('fixture-owner',false,false,false);assert.equal(passive.failCount,0);assert.equal(passive.warnCount,0);assert.equal(passive.improvementIdeas.length,0);assert.equal(passive.telegramSent,false);assert.equal(passive.dailyDigestSent,false);
  for(const id of ['route-scout','link-click-scout','api-scout','error-scout'])assert.equal(passive.subAgents.find(s=>s.id===id).status,'pass');
  // Native visual scout gets an actual logged-in session via its existing dependency seam.
  const nativePlaywright={chromium:{launch:async options=>{const real=await chromium.launch({...options,executablePath});const original=real.newContext.bind(real);real.newContext=async settings=>{const ctx=await original(settings);await ctx.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));const response=await ctx.request.post(base+'/api/auth/login',{data:{username:'fixture-member',password:fixturePassword}});assert.equal(response.status(),200);return ctx;};return real;}}};
  const officeRoute=runtime.__appQaAgentInternals.LOCAL_ROUTE_MAP.filter(r=>r.path==='/agents-office');
  const pendingVisual=await runtime.runVisualClickScout(officeRoute,{loadPlaywright:async()=>({chromium:{launch:options=>chromium.launch({...options,executablePath})}})});
  assert.equal(pendingVisual.status,'warn');assert.equal(pendingVisual.checked,0);assert.equal(pendingVisual.visualScans[0].status,'pending');assert.equal(pendingVisual.findings.some(f=>f.severity==='high'),false);
   const visual=await runtime.runVisualClickScout([...officeRoute,...runtime.__appQaAgentInternals.LOCAL_ROUTE_MAP.filter(r=>['/app-qa-agent','/github-agent'].includes(r.path))],{loadPlaywright:async()=>nativePlaywright});
  await writeFile(path.join(evidenceDir,'integrated-app-qa-local.json'),JSON.stringify({scope:'LOCAL memory fixtures; no production DB, GitHub or telemetry certified',passive,visual,pendingVisual,requests},null,2));
  assert.equal(visual.status,'pass',JSON.stringify(visual.findings));assert.deepEqual(visual.visualScans.flatMap(s=>s.consoleErrors),[]);
 } catch(error) {console.error(error);throw error;} finally {
  if(browser)await browser.close();if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});for(const [k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}delete globalThis.__officeLocalStorage;delete globalThis.__officeLocalBase;await rm(temp,{recursive:true,force:true});
 }
});
