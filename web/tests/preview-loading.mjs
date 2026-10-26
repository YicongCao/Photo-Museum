import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base='http://127.0.0.1:8798',out='data/image-performance';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.livePreviewURLs=new Set();URL.createObjectURL=b=>{const u=create(b);window.livePreviewURLs.add(u);return u};URL.revokeObjectURL=u=>{window.livePreviewURLs.delete(u);revoke(u)}});
try{
 await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 await page.goto(base+'/#gallery?room=cover');await page.locator('.depth-0').waitFor();
 await expect.poll(()=>requests.filter(u=>u.includes('/media/display?')).length).toBeGreaterThanOrEqual(14);
 checks.push('Activity warmup actually requests all 14 previews with no original reads');
 await page.waitForFunction(()=>[...document.querySelectorAll('.depth-0 .photo-mosaic img')].every(i=>i.complete&&i.naturalWidth));
 await page.screenshot({path:out+'/cover.png'});
 const thumbRequests=requests.filter(u=>u.includes('/media/thumb?'));assert.equal(new Set(thumbRequests).size,thumbRequests.length);checks.push('Cover and reflection share one thumbnail request per URL');
 await page.locator('.depth-0').click();await page.locator('.wall-display.ready').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
 const wall=page.locator('.wall-photo').first();assert.ok(await wall.locator('img').first().evaluate(i=>i.naturalWidth>0));
 await page.screenshot({path:out+'/wall.png'});
 await page.getByRole('button',{name:'返回 Gallery',exact:true}).click();await page.locator('.depth-0').waitFor();
 await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
 checks.push('Thumbnail to 4K promotion and return retain decoded images');
 for(const room of ['calendar','gear','map','space','rings','constellation']){
  console.log('room',room);await page.goto('about:blank');await page.goto(base+'/#gallery?room='+room);await page.locator('.room,.spacetime-room').first().waitFor({state:'attached'});await page.waitForTimeout(1200);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
 }
 checks.push('Calendar, equipment, map, tunnel, rings and constellation render within viewport');
 assert.equal(requests.filter(u=>/\/original(?:-compatible)?\?/.test(u)).length,0);
 await page.goto('about:blank');await page.goto(base+'/#gallery?room=cover');await page.locator('.depth-0').waitFor();
 await page.mouse.move(1550,40);await page.getByRole('button',{name:'锁定',exact:true}).click();await page.getByLabel('馆主密码',{exact:true}).waitFor();
 await expect.poll(()=>page.evaluate(()=>window.livePreviewURLs.size)).toBe(0);
 checks.push('Lock releases all active Blob URLs; no original GET in multi-image browsing');
 const slow=await context.newPage();let release;const gate=new Promise(r=>release=r);
 try{
  await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
  await slow.route('**/media/display?**',async r=>{await gate;await r.continue().catch(()=>{})});
  await slow.goto(base+'/#gallery?room=cover');await slow.locator('.depth-0').click();
  await slow.waitForFunction(()=>[...document.querySelectorAll('.wall-thumb')].some(i=>i.complete&&i.naturalWidth&&getComputedStyle(i).opacity==='1'));
  assert.equal(await slow.locator('.wall-display.ready').count(),0);
  release();await slow.locator('.wall-display.ready').first().waitFor();
  checks.push('Delayed 4K leaves an opaque decoded thumbnail until promotion');
 }finally{release();await slow.close()}
 const failed=await context.newPage();
 await failed.route('**/media/display?**',r=>r.fulfill({status:503,body:'unavailable'}));
 await failed.goto(base+'/#gallery?room=cover');await failed.locator('.depth-0').click();
 await failed.locator('.wall-preview-status').first().waitFor();
 assert.ok(await failed.locator('.wall-thumb').first().evaluate(i=>i.complete&&i.naturalWidth>0));
 checks.push('Failed 4K retains the thumbnail and controlled failure label');await failed.close();
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/ui-checks.json',JSON.stringify({checks,errors},null,2));console.log(checks);
}finally{await browser.close()}
