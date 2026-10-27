import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const out='data/filmstrip-wide';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const settle=()=>page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
try{
 await page.route('**/api/preferences',async r=>{const response=await r.fetch();await r.fulfill({response,json:{...await response.json(),original_loading:'on_demand'}})});
 await page.addInitScript(()=>{const animate=Element.prototype.animate;window.stripMotions=[];Element.prototype.animate=function(frames,options){if(this.classList.contains('viewer-filmstrip-row'))window.stripMotions.push({frames,options});return animate.call(this,frames,options)}});
 await page.goto('http://localhost:8798/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();await settle();
 await page.locator('.depth-0').click({position:{x:20,y:50}});await page.locator('.wall-photo').first().waitFor();await settle();await page.locator('.wall-photo').first().click();await page.locator('.viewer-filmstrip').waitFor();await settle();
 for(const [width,height] of [[1920,1080],[1440,900],[390,844],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);
  const dims=await page.locator('.viewer-filmstrip').evaluate(e=>{const t=e.querySelector('.viewer-filmstrip-track'),last=t.querySelector('button:last-child'),r=t.getBoundingClientRect(),l=last.getBoundingClientRect();return {track:r.width,section:e.getBoundingClientRect().width,last:l.right,edge:r.right,first:t.querySelector('button').getBoundingClientRect().left,left:r.left,count:t.querySelectorAll('button').length}});
  assert.ok(dims.track>dims.section-70,JSON.stringify(dims));
  assert.ok(dims.last>=dims.edge-20,JSON.stringify(dims));
  assert.ok(dims.first<=dims.left+10,JSON.stringify(dims));
  assert.ok(await page.locator('.viewer-filmstrip [aria-current=true]').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}));
  await page.screenshot({path:`${out}/${width}x${height}.png`});
 }
 await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(100);
 await page.getByRole('button',{name:'下一张照片',exact:true}).click();await settle();
 await page.waitForFunction(()=>window.stripMotions.length>0);
 let motions=await page.evaluate(()=>window.stripMotions);assert.ok(parseFloat(motions.at(-1).frames[0].transform.match(/-?[\d.]+/)[0])>0);
 await page.keyboard.press('ArrowLeft');await settle();motions=await page.evaluate(()=>window.stripMotions);
 assert.ok(parseFloat(motions.at(-1).frames[0].transform.match(/-?[\d.]+/)[0])<0);
 assert.equal(motions.at(-1).options.duration,180);
 const before=motions.length;await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('ArrowRight');await settle();
 assert.equal((await page.evaluate(()=>window.stripMotions)).length,before);
 assert.deepEqual(errors,[]);assert.equal(requests.filter(u=>/\/original(?:-compatible)?\?/.test(u)).length,0);
 console.log('Full-width strip, both motion directions, reduced motion, responsive layouts and local previews verified.');
}finally{await browser.close()}
