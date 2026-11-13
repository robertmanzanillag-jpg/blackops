import playwright from 'playwright';
const {chromium}=playwright;
import assert from 'node:assert/strict';
import {composeRevenuePreviewSource} from '../server/office-revenue-source';
import {buildOfficeRevenuePreview} from '../server/office-revenue-artifact';
const executablePath=process.env.AGENTS_WORLD_BROWSER;if(!executablePath)throw Error('Existing browser required');
const at=Date.parse('2026-11-07T04:30:00Z'),owner='fixture-owner';
const source=composeRevenuePreviewSource(owner,[{kind:'publicLeadCandidates',revision:1,data:[{id:'candidate-browser',businessName:'Fixture Bakery',area:'Miami',niche:'bakery',websiteStatus:'unknown',painPoint:'',sourceUrl:'https://bakery-fixture.net/about',evidence:'Public business listing describes a bakery in Miami.',verificationStatus:'verified_public',publicEvidenceVerified:true,updatedAt:new Date(at).toISOString()}]}],at);
const artifact=buildOfficeRevenuePreview(source,owner,'candidate-browser',at);
const browser=await chromium.launch({executablePath,headless:true});
try{const page=await browser.newPage({viewport:{width:1280,height:900}});const network:string[]=[];page.on('request',r=>network.push(r.url()));
 await page.setContent('<iframe title="Internal revenue concept" sandbox="" referrerpolicy="no-referrer" style="width:100%;height:850px;border:0"></iframe>');
 await page.locator('iframe').evaluate((el,html)=>{(el as HTMLIFrameElement).srcdoc=html;},artifact.html);
 const frame=page.frameLocator('iframe');await frame.getByRole('heading',{level:1}).waitFor();assert.match(await frame.locator('body').innerText(),/BORRADOR INTERNO/);assert.match(await frame.locator('body').innerText(),/Public business listing/);assert.equal(await frame.locator('script,form,input,img,iframe').count(),0);assert.equal(await frame.locator('a[href^="http"]').count(),0);
 await frame.locator('.btn.primary').click();assert.equal(await frame.locator('a').count(),0);await frame.locator('#services').scrollIntoViewIfNeeded();assert.deepEqual(network,[]);assert.ok(!(await frame.locator('body').innerText()).includes('\uFFFD'));
 if(process.env.REVENUE_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.REVENUE_PREVIEW_SCREENSHOT,fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await frame.locator('body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);assert.deepEqual(network,[]);console.log('PASS sandboxed desktop/mobile HTML, inert preview controls, no scripts/forms/remote requests');
}finally{await browser.close();}
