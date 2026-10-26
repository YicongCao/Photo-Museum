import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8793',dist=process.env.MUSEUM_BROWSER_DIST,out=process.env.MUSEUM_BROWSER_OUTPUT;
if(out)await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:778}}),checks=[],errors=[];
let style='classic';page.on('pageerror',e=>errors.push(e.message));
// Optionally serve an isolated build to this browser while the shared fixture
// remains unchanged for other visual checks. Only HTML/static assets are local.
if(dist)await page.route(base+'/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname!=='/'&&!/^\/assets\/[\w.-]+$/.test(url.pathname))return route.fallback();
 const file=path.join(dist,url.pathname==='/'?'index.html':url.pathname.slice(1));
 await route.fulfill({body:await fs.readFile(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript'});
});
await page.route('**/api/preferences',async route=>{
 if(route.request().method()!=='GET')return route.fallback();
 const response=await route.fetch(),values=await response.json();
 await route.fulfill({response,json:{...values,cover_style:style}});
});
const stage=page.locator('.classic-coverflow');
async function at(position){
 await stage.evaluate((node,position)=>{node.querySelector('.tunnel-scroll').scrollTo({left:Math.round(Math.max(140,node.clientWidth*.24))*position,behavior:'instant'})},position);
 await page.waitForFunction(position=>Math.abs(Number(document.querySelector('.classic-coverflow')?.dataset.position)-position)<.008,position);
}
async function resize(width,height){await page.setViewportSize({width,height});await page.waitForTimeout(100)}
async function choose(next){style=next;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.cover-style-'+style).waitFor()}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();
 await at(2);checks.push('Initial viewport matching the component defaults still permits scrolling');
 for(const next of ['classic','framed','depth','arc']){
  await choose(next);await resize(1280,800);await at(2);
  const id=await page.locator('.depth-0').getAttribute('data-activity');
  await resize(3440,1440);assert.equal(await stage.getAttribute('data-position'),'2.000');assert.equal(await page.locator('.depth-0').getAttribute('data-activity'),id);
  await resize(1280,800);await at(2.375);
  for(const [width,height] of [[3440,1440],[390,720],[1100,600],[1101,600],[701,541],[844,390],[1280,800]]){
   await resize(width,height);assert.ok(Math.abs(Number(await stage.getAttribute('data-position'))-2.375)<.008,`${next} ${width}×${height}`);
   assert.equal(await page.locator('.depth-0').getAttribute('data-activity'),id);
  }
 }
 checks.push('All four styles preserve settled selection and fractional scroll across phone, short, breakpoint and ultra-wide resizes');
 await at(2);await resize(1586,992);await page.mouse.move(600,350);await page.mouse.wheel(210,0);
 for(const next of ['depth','framed','arc','classic'])await choose(next);
 await page.waitForTimeout(900);assert.equal(await stage.getAttribute('data-position'),'3.000');assert.ok((await page.locator('.depth-0').getAttribute('style')).includes('rotateY(0deg)'));
 checks.push('Rapid style changes during wheel input retain the destination and settle the main cover upright');
 await resize(390,720);await choose('depth');const box=await page.locator('.depth-0').boundingBox();assert.ok(box.x>=0);assert.ok(Math.abs(box.x+box.width/2-195)<1);
 if(out)await page.screenshot({path:path.join(out,'depth-390.png')});
 checks.push('Depth main cover is fully visible and centered on phone');
 await resize(701,541);for(const next of ['classic','framed','depth','arc']){
  await choose(next);const before=await page.locator('.depth-0').boundingBox();await page.getByRole('button',{name:'显示时间线',exact:true}).press('Enter');await page.locator('.timeline-drawer.is-open').waitFor();const after=await page.locator('.depth-0').boundingBox();assert.deepEqual(after,before,`${next} resized when timeline opened`);await page.getByRole('button',{name:'收起时间线',exact:true}).press('Enter');
  if(out)await page.screenshot({path:path.join(out,next+'-701-541.png')});
 }
 checks.push('Floating timeline leaves main cover geometry unchanged at the short-screen breakpoint');
 await page.mouse.move(300,180);await page.mouse.wheel(70,0);await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name:'日历',exact:true}).click();await page.locator('.calendar-room').waitFor();await page.waitForTimeout(400);
 assert.deepEqual(errors,[]);checks.push('Leaving during pending scroll settling cleans up without uncaught browser errors');
 console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
