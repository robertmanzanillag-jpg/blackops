import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {withMarketingLearningContext,getMarketingCommandCenterSnapshot} from '../server/marketing-command-center.ts';
const browserPath=process.env.AGENTS_WORLD_BROWSER||chromium.executablePath();
if(!existsSync(browserPath))throw Error('Existing Chromium required; this test never downloads one');
for(const file of ['client/src/pages/marketing-command-center.tsx','tests/marketing-learning-ui.mjs'])new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(file));
const snapshot=withMarketingLearningContext('a',[{id:'saved',createdAt:'2026-11-07T03:00:00Z',focusClientId:'all',clientsReviewed:4,improvementsQueued:[],rulesUpdated:[],safetyBlocks:[],summary:'OWNER A PRIVATE PREPARATION'}],getMarketingCommandCenterSnapshot);
snapshot.ownerId='a';
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClientProvider} from '@tanstack/react-query';import {queryClient} from './client/src/lib/queryClient';import Page from './client/src/pages/marketing-command-center';queryClient.setQueryData(['auth-me'],{authenticated:true,user:{id:'a'}});window.refreshAuth=()=>{void queryClient.invalidateQueries({queryKey:['marketing-owner-auth']})};window.switchOwner=()=>queryClient.setQueryData(['auth-me'],{authenticated:true,user:{id:'b'}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><Page/></QueryClientProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"test"'}});
const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--disable-background-networking','--disable-sync']});
try{
 const page=await browser.newPage(),errors=[];let foreign=false,mismatch=false,holdAuth=false,releaseAuth;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/bundle.js"></script>'});
  if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});
  if(url.pathname==='/api/auth/me'){if(holdAuth)await new Promise(resolve=>{releaseAuth=resolve;});return route.fulfill({contentType:'application/json',body:JSON.stringify({authenticated:true,user:{id:foreign?'b':'a'}})});}
  if(url.pathname==='/api/marketing-command-center'&&!foreign)return route.fulfill({contentType:'application/json',body:JSON.stringify({...snapshot,ownerId:mismatch?'b':'a'})});
  return route.fulfill({status:503,body:'Unavailable'});
 });
 await page.goto('http://marketing-fixture.invalid');await page.getByText('OWNER A PRIVATE PREPARATION',{exact:true}).waitFor();assert.ok(await page.getByText('Sin verificar',{exact:true}).count()>=2);assert.equal(await page.getByText('Run self-improvement',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Guardar preparacion interna',exact:true}).click();await page.getByRole('alert').getByText('No se confirmo el guardado. Reintentar conserva la misma preparacion diaria.',{exact:true}).waitFor();
 holdAuth=true;await page.evaluate(()=>window.refreshAuth());await page.getByText('Historial privado no disponible. No se ha confirmado que este vacio.',{exact:true}).waitFor();assert.equal(await page.getByText('OWNER A PRIVATE PREPARATION',{exact:true}).count(),0);holdAuth=false;releaseAuth();await page.getByText('OWNER A PRIVATE PREPARATION',{exact:true}).waitFor();
 mismatch=true;await page.reload();await page.getByText('Historial privado no disponible. No se ha confirmado que este vacio.',{exact:true}).waitFor();assert.equal(await page.getByText('OWNER A PRIVATE PREPARATION',{exact:true}).count(),0);mismatch=false;await page.reload();await page.getByText('OWNER A PRIVATE PREPARATION',{exact:true}).waitFor();
 foreign=true;await page.evaluate(()=>window.switchOwner());await page.getByText('Historial privado no disponible. No se ha confirmado que este vacio.',{exact:true}).waitFor();assert.equal(await page.getByText('OWNER A PRIVATE PREPARATION',{exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('PASS marketing owner isolation, unknown metrics, persisted preparation and failed-save notice');
}finally{await browser.close();}
