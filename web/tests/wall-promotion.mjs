import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8793',out=process.env.MUSEUM_BROWSER_OUTPUT||'docs/design/previews/wall-promotion';
await fs.mkdir(out,{recursive:true});await fs.mkdir('data/wall-promotion',{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1500,height:940}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
let releaseWarm,releaseImage,releasePage;
const warmGate=new Promise(r=>releaseWarm=r),imageGate=new Promise(r=>releaseImage=r),pageGate=new Promise(r=>releasePage=r);
await page.addInitScript(()=>{
 const original=HTMLImageElement.prototype.decode;
 window.decodePending=[];window.decodeGate=new Promise(r=>window.releaseWallDecode=r);
 HTMLImageElement.prototype.decode=async function(){await original.call(this);if(this.classList.contains('wall-display')){window.decodePending.push(this);await window.decodeGate}};
 const create=URL.createObjectURL.bind(URL);window.warmBlobs=[];URL.createObjectURL=b=>{const u=create(b);window.warmBlobs.push(u);return u};
});
await page.route('**/media/display?**',async route=>{await (route.request().resourceType()==='fetch'?warmGate:imageGate);await route.continue().catch(()=>{})});
await page.route('**/api/gallery/*?**',async route=>{
 const limit=new URL(route.request().url()).searchParams.get('limit');
 // This fixture has only fourteen photos per activity; shorten its first page
 // to exercise real pagination/loading without inventing media records.
 if(limit==='15'){const response=await route.fetch(),data=await response.json();data.items=data.items.slice(0,8);return route.fulfill({response,json:data})}
 if(limit==='200')await pageGate;await route.continue().catch(()=>{});
});
const stable=async p=>{await p.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false')};
async function loaderFits(p){
 const r=await p.locator('.gallery-photo-loading:visible').boundingBox(),size=p.viewportSize();assert.ok(r);
 assert.ok(r.x>size.width*.5&&r.y>size.height*.75&&r.x+r.width<=size.width-8&&r.y+r.height<=size.height-8,JSON.stringify(r));
 const bar=await p.locator('.wall-scroll-control').boundingBox();if(bar)assert.ok(r.x>=bar.x+bar.width||r.y>=bar.y+bar.height,'Loading indicator must clear the horizontal scrollbar');
 const caption=await p.locator('.gallery-caption').boundingBox();if(caption)assert.ok(r.x>=caption.x+caption.width||r.y+r.height<=caption.y,'Loading indicator must clear the activity caption');
}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();await page.locator('.depth-0').click();await stable(page);
 const tile=page.locator('.wall-photo').first();await expect.poll(()=>tile.locator('.wall-thumb').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
 await page.locator('.wall-photo-loading:visible').waitFor();await loaderFits(page);await page.screenshot({path:out+'/desktop-loading.png'});
 releaseImage();await page.waitForFunction(()=>window.decodePending.length>0);
 assert.equal(await tile.locator('.wall-display.ready').count(),0);assert.ok(await tile.locator('.wall-thumb').isVisible());checks.push('Slow 4K decode keeps the painted thumbnail visible; no premature ready state');
 await page.evaluate(()=>{
  window.wallSamples=[];window.wallTracking=true;
  const node=document.querySelector('.wall-photo');
  const sample=()=>{if(!window.wallTracking)return;const thumb=node.querySelector('.wall-thumb'),display=node.querySelector('.wall-display');if(display){const opacity=Number(getComputedStyle(display).opacity);window.wallSamples.push({opacity,covered:!!(thumb?.complete&&thumb.naturalWidth)||display.complete&&display.naturalWidth>0&&opacity>=.999,thumb:!!thumb})}requestAnimationFrame(sample)};
  requestAnimationFrame(sample);window.releaseWallDecode();
 });
 await tile.locator('.wall-display.settled').waitFor();await page.evaluate(()=>window.wallTracking=false);
 const samples=await page.evaluate(()=>window.wallSamples);
 assert.ok(samples.length>=8);assert.ok(samples.every(s=>s.covered),'A frame lost its opaque thumbnail before the display was opaque');
 assert.ok(samples.filter(s=>s.opacity>0&&s.opacity<.999&&s.thumb).length>=2,'The test must observe the actual crossfade');
 assert.equal(await tile.locator('.wall-thumb').count(),0);assert.equal(await tile.locator('.wall-display').evaluate(e=>getComputedStyle(e).willChange),'auto');
 checks.push('Frame samples preserve opaque image coverage throughout the real crossfade; thumbnail and compositor hint retire only after full opacity');
 const source=await tile.locator('.wall-display').getAttribute('src');assert.ok(source.includes('/media/display?'));
 releaseWarm();await page.waitForFunction(()=>window.warmBlobs.length>=4);await page.setViewportSize({width:1500,height:944});await page.waitForTimeout(120);
 assert.equal(await tile.locator('.wall-display').getAttribute('src'),source);checks.push('Late warm-up Blob aliases plus parent reflow do not replace an already displayed image src');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);await loaderFits(page);await page.screenshot({path:out+'/mobile-loading.png'});
 checks.push('Loading indicator stays bottom-right on desktop and phone, clear of the centered scrollbar');
 releasePage();await page.locator('.wall-photo-loading').waitFor({state:'detached'});
 const storage=await context.storageState();
 const brokenContext=await browser.newContext({storageState:storage,reducedMotion:'reduce'}),broken=await brokenContext.newPage();broken.on('pageerror',e=>errors.push(e.message));broken.on('request',r=>requests.push(r.url()));
 await broken.addInitScript(()=>{const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return this.classList.contains('wall-display')?Promise.reject(Error('Synthetic decode failure')):decode.call(this)}});
 await broken.goto(base+'/#gallery');await broken.locator('.depth-0').waitFor();await broken.locator('.depth-0').click();await stable(broken);await broken.waitForTimeout(500);
 const fallback=broken.locator('.wall-photo').first();assert.equal(await fallback.locator('.wall-display').count(),0);assert.ok(await fallback.locator('.wall-thumb').evaluate(e=>e.complete&&e.naturalWidth>0));checks.push('Rejected decode preserves the thumbnail instead of exposing a broken/blank 4K layer');await brokenContext.close();
 const pendingContext=await browser.newContext({storageState:storage,reducedMotion:'reduce'}),pending=await pendingContext.newPage();pending.on('pageerror',e=>errors.push(e.message));pending.on('request',r=>requests.push(r.url()));
 await pending.addInitScript(()=>{const decode=HTMLImageElement.prototype.decode;window.pendingImages=[];const gate=new Promise(r=>window.releasePendingDecode=r);HTMLImageElement.prototype.decode=async function(){await decode.call(this);if(this.classList.contains('wall-display')){window.pendingImages.push(this);await gate}}});
 await pending.goto(base+'/#gallery');await pending.locator('.depth-0').waitFor();await pending.locator('.depth-0').click();await stable(pending);await pending.waitForFunction(()=>window.pendingImages.length>0);
 await pending.getByRole('button',{name:'返回 Gallery',exact:true}).click();await pending.locator('.horizontal-wall').waitFor({state:'detached'});
 assert.ok(await pending.evaluate(()=>window.pendingImages.every(e=>e.getAttribute('src')===null)));await pending.evaluate(()=>window.releasePendingDecode());await pending.waitForTimeout(80);assert.equal(await pending.locator('.wall-display').count(),0);
 checks.push('Returning during decode removes image src and ignores late completion after unmount');await pendingContext.close();
 const reducedContext=await browser.newContext({storageState:storage,reducedMotion:'reduce'}),reduced=await reducedContext.newPage();reduced.on('pageerror',e=>errors.push(e.message));reduced.on('request',r=>requests.push(r.url()));
 await reduced.goto(base+'/#gallery');await reduced.locator('.depth-0').waitFor();await reduced.locator('.depth-0').click();await reduced.locator('.wall-display.settled').first().waitFor();
 assert.equal(await reduced.locator('.wall-display.settled').first().evaluate(e=>getComputedStyle(e).opacity),'1');assert.equal(await reduced.locator('.wall-photo').first().locator('.wall-thumb').count(),0);checks.push('Reduced motion reveals decoded opaque 4K directly and releases its thumbnail');await reducedContext.close();
 assert.equal(requests.filter(u=>/\/original(?:-compatible)?(?:\?|$)/.test(u)).length,0);assert.deepEqual(errors,[]);checks.push('Zero original-file requests and uncaught browser errors');
 await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE||'docs/research/wall-promotion-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,frames:samples,fixture:'Synthetic photos; controlled network and decode gates. Frame coverage is measured on rendered image layers; private photo color remains separate.'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/wall-promotion/failure.png'});throw e}finally{releaseWarm();releaseImage();releasePage();await browser.close()}
