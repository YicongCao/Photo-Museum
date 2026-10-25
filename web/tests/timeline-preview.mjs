import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const output='docs/design/previews/timeline-preview';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage(),checks=[],errors=[],requests=[];
await context.addInitScript(()=>{window.previewRevoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.previewRevoked.push(url);revoke(url)}});
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const bubble=page.locator('.timeline-preview');
const decoded=async()=>{await page.waitForFunction(()=>{const el=document.querySelector('.timeline-preview');return el&&el.querySelectorAll('img').length===Number(el.dataset.photoCount)&&[...el.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth)});await bubble.evaluate(el=>Promise.allSettled(el.getAnimations().map(a=>a.finished)))};
try{
 await page.goto('http://localhost:8793/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁'}).click();await page.locator('.depth-0').waitFor();
 const data=await (await context.request.get('http://localhost:8793/api/gallery')).json();
 await page.getByRole('button',{name:'海边的一天',exact:true}).hover();await bubble.waitFor();await decoded();
 const count=Number(await bubble.getAttribute('data-photo-count'));assert.ok(count>=3&&count<=5);
 const scores=await bubble.locator('.timeline-preview-cell').evaluateAll(els=>els.map(el=>Number(el.dataset.score)));
 const expected=data.activities.find(a=>a.event.theme==='海边的一天').selected.slice(0,count).map(p=>p.score);assert.deepEqual(scores,expected);checks.push('Loads only leading score-ranked photos and selects 3–5 images');
 const box=await bubble.boundingBox(),rail=await page.locator('.dock-timeline').boundingBox();assert.equal(box.width,336);assert.equal(box.height,236);assert.ok(box.x+box.width<rail.x&&box.y>=78&&box.y+box.height<=720);checks.push('Uniform 336×236 speech bubble opens left outside timeline scroll clipping');
 const typography=await page.locator('.dock-timeline').evaluate(el=>['.timeline-year','.timeline-month','button'].map(s=>getComputedStyle(el.querySelector(s)).fontSize));assert.deepEqual(typography,['26px','17px','14px']);checks.push('Year, month and activity fonts enlarged for 720px screens');
 await page.screenshot({path:output+'/desktop.png'});
 const urls=await bubble.locator('img').evaluateAll(els=>els.map(i=>i.src));await page.mouse.move(20,60);await page.locator('.timeline-preview.closing').waitFor();assert.ok(await bubble.evaluate(el=>el.getAnimations().length>0));await bubble.waitFor({state:'detached'});
 assert.ok(await page.evaluate(urls=>urls.every(u=>window.previewRevoked.includes(u)),urls));checks.push('Collapse animation releases every thumbnail Blob URL');
 await page.getByRole('button',{name:'山间露营',exact:true}).hover();await bubble.waitFor();await decoded();assert.deepEqual(await bubble.boundingBox().then(b=>[b.width,b.height]),[336,236]);checks.push('Activities retain the same bubble size');
 await page.getByRole('button',{name:'老友相聚',exact:true}).hover();await page.getByRole('button',{name:'海边的一天',exact:true}).hover();await expect(bubble).toHaveAttribute('data-activity',data.activities.find(a=>a.event.theme==='海边的一天').id);await decoded();assert.equal(await bubble.count(),1);checks.push('Rapid activity changes cannot display stale previews');
 await page.keyboard.press('Escape');await bubble.waitFor({state:'detached'});
 await page.mouse.move(20,60);await page.getByRole('button',{name:'山间露营',exact:true}).focus();await bubble.waitFor();await decoded();await page.keyboard.press('Escape');await bubble.waitFor({state:'detached'});checks.push('Keyboard focus previews and Escape dismisses');
 await page.getByRole('button',{name:'海边的一天',exact:true}).hover();await bubble.waitFor();await page.locator('.dock-timeline').evaluate(el=>el.scrollTop=50);await bubble.waitFor({state:'detached'});checks.push('Timeline scroll dismisses anchored preview');
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'海边的一天',exact:true}).hover();await bubble.waitFor();assert.equal(await bubble.evaluate(el=>el.getAnimations().length),0);checks.push('Reduced motion disables bubble animations');await page.keyboard.press('Escape');await bubble.waitFor({state:'detached'});
 await page.setViewportSize({width:390,height:844});await page.mouse.move(20,50);await page.getByRole('button',{name:'海边的一天',exact:true}).focus();await bubble.waitFor();await decoded();const mobile=await bubble.boundingBox();assert.ok(mobile.x>=0&&mobile.x+mobile.width<=390&&mobile.y>=0&&mobile.y+mobile.height<=844);assert.equal(await bubble.getAttribute('class').then(s=>s.includes('from-above')),true);await page.screenshot({path:output+'/mobile.png'});checks.push('Narrow viewport keeps preview on screen above timeline');
 // Controlled aspect metadata exercises every collage layout in the real CSS grid.
 await page.route('**/api/gallery',async route=>{const response=await route.fetch();const d=await response.json();
  const ratios={'海边的一天':[1.05,1.4,1.4,.5,.5],'山间露营':[1,.75,.75,.75,.75],'老友相聚':[1.5,1.5,1.5,1.5,1.5]};
  for(const a of d.activities){const r=ratios[a.event.theme];if(r)a.selected=a.selected.map((p,i)=>({...p,score:100-i,info:{...p.info,width:(r[i]||1.5)*100,height:100}}))}await route.fulfill({json:d});
 });
 await page.setViewportSize({width:1280,height:720});await page.reload();await page.locator('.depth-0').waitFor();
 for(const [theme,n] of [['海边的一天',3],['山间露营',5],['老友相聚',4]]){
  await page.getByRole('button',{name:theme,exact:true}).hover();await expect(bubble).toHaveAttribute('data-photo-count',String(n));await decoded();
  assert.deepEqual(await bubble.boundingBox().then(b=>[b.width,b.height]),[336,236]);
  const grid=await bubble.locator('.timeline-preview-mosaic').boundingBox(),cells=await bubble.locator('.timeline-preview-cell').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}));
  assert.ok(cells.every(c=>c.x>=grid.x&&c.y>=grid.y&&c.x+c.w<=grid.x+grid.width+.1&&c.y+c.h<=grid.y+grid.height+.1));
  assert.ok(cells.reduce((s,c)=>s+c.w*c.h,0)>grid.width*grid.height*.95);
 }checks.push('Three, four and five photo layouts fill the same rectangle without clipping');
 assert.equal(requests.filter(u=>u.includes('/original?')).length,0);checks.push('Preview never fetches NAS originals');assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await fs.writeFile('docs/research/timeline-preview-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,typography,bubble:{width:box.width,height:box.height},fixtures:'synthetic geometry only'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
