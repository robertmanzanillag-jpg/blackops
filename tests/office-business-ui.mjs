import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
if(!process.env.AGENTS_WORLD_BROWSER)throw Error('Existing Chromium executable required');
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {OfficeBusinessHistory} from './client/src/components/office-business-history';const client=new QueryClient();function App(){const [owner,setOwner]=useState('owner');const [kind,setKind]=useState('business');window.changeOwner=setOwner;window.changeKind=setKind;window.refresh=()=>client.invalidateQueries();return <QueryClientProvider client={client}><OfficeBusinessHistory ownerId={owner} sessionScope={owner} kind={kind}/></QueryClientProvider>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src')},define:{'process.env.NODE_ENV':'"test"'}});
const browser=await chromium.launch({executablePath:process.env.AGENTS_WORLD_BROWSER,headless:true});
try{
 const page=await browser.newPage();let reads=0,unavailable=false;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/bundle.js"></script>'});
  if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});
  assert.ok(['/api/agents-office/business-work','/api/agents-office/editorial-work','/api/agents-office/revenue-work'].includes(url.pathname));assert.equal(route.request().method(),'GET');reads++;
  if(unavailable)return route.fulfill({status:503,body:'Unavailable'});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({ownerId:'owner',checkedAt:'2026-11-07T00:00:00Z',jobs:[{id:'one',role:url.pathname.endsWith('/revenue-work')?'revenue':url.pathname.endsWith('/editorial-work')?'news':'portfolio',generation:2,status:'completed',startedAt:'2026-11-07T00:00:00Z',artifact:{text:'Private reconciliation <script>throw Error("unsafe")</script>',html:'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><h1>Private concept</h1><script>parent.document.body.textContent="unsafe"</script>'}}]})});
 });
 await page.goto('http://business-history.invalid/');await page.getByText('Cartera · generación 2',{exact:true}).waitFor();
 await page.getByText('Leer entregable',{exact:true}).click();await page.getByText('Private reconciliation',{exact:false}).waitFor();assert.equal(reads,1);
 await page.reload();await page.getByText('Cartera · generación 2',{exact:true}).waitFor();assert.equal(reads,2);
 unavailable=true;await page.evaluate(()=>window.refresh());await page.getByRole('alert').waitFor();assert.equal(await page.getByText('Cartera · generación 2',{exact:true}).count(),0);
 unavailable=false;await page.evaluate(()=>window.refresh());await page.getByText('Cartera · generación 2',{exact:true}).waitFor();
 await page.evaluate(()=>window.changeOwner('other'));await page.getByText('Cargando entregables…',{exact:true}).waitFor();assert.equal(await page.getByText('Cartera · generación 2',{exact:true}).count(),0);
 await page.evaluate(()=>window.changeOwner(null));await page.getByText('Verificando acceso al historial…',{exact:true}).waitFor();assert.equal(await page.getByText('Private reconciliation',{exact:false}).count(),0);assert.deepEqual(errors,[]);
 await page.evaluate(()=>{window.changeOwner('owner');window.changeKind('editorial');});await page.getByText('Mesa editorial · generación 2',{exact:true}).waitFor();assert.equal(await page.getByText('Cartera · generación 2',{exact:true}).count(),0);
 assert.equal(await page.locator('iframe').count(),0);
 await page.evaluate(()=>window.changeKind('revenue'));await page.getByText('Revenue · generación 2',{exact:true}).waitFor();await page.getByText('Ver maqueta interna',{exact:true}).click();
 assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'),'no-referrer');await page.frameLocator('iframe').getByRole('heading',{name:'Private concept'}).waitFor();assert.equal(await page.getByText('Revenue · generación 2',{exact:true}).count(),1);
 await page.evaluate(()=>window.changeOwner(null));await page.getByText('Verificando acceso al historial…',{exact:true}).waitFor();assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS read-only saved deliverables, reload, escaped content, failed refresh, owner change and logout isolation');
}finally{await browser.close();}
