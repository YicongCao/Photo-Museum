import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const output='docs/design/previews/coverflow-polish';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:8793/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁'}).click();await page.locator('.depth-0').waitFor();
 await page.getByRole('button',{name:'山间露营',exact:true}).click();await expect.poll(()=>page.locator('.tunnel-stage').getAttribute('data-position')).toBe('2.000');
 await page.waitForFunction(()=>[...document.querySelectorAll('.depth-0 img')].every(i=>i.complete&&i.naturalWidth));
 const surfaces=await page.locator('.activity-panel').evaluateAll(els=>els.map(el=>{const r=el.querySelector('.panel-reflection'),s=getComputedStyle(r);return {opacity:getComputedStyle(el).opacity,reflectionOpacity:s.opacity,mask:s.maskImage,background:s.backgroundColor,filter:getComputedStyle(r.firstElementChild).filter,coverHeight:el.getBoundingClientRect().height,mirrorHeight:r.firstElementChild.getBoundingClientRect().height}}));
 assert.ok(surfaces.every(s=>s.opacity==='1'&&s.reflectionOpacity==='1'&&s.mask==='none'&&s.background==='rgb(0, 0, 0)'));assert.ok(surfaces.every(s=>s.filter.includes('blur')&&s.filter.includes('brightness')));assert.ok(Math.abs(surfaces[2].coverHeight-surfaces[2].mirrorHeight)<1);checks.push('Opaque layered reflections with dark blurred images and preserved mirror proportions');
 const caption=await page.locator('.gallery-caption').evaluate(el=>({background:getComputedStyle(el).backgroundColor,blur:getComputedStyle(el).backdropFilter}));assert.equal(caption.background,'rgba(0, 0, 0, 0)');assert.equal(caption.blur,'none');checks.push('Caption has no rectangular background or backdrop blur');
 await page.screenshot({path:output+'/coverflow-desktop.png'});
 // Pixel test: changing only rear reflections cannot change pixels inside the front mirror.
 const style=await page.addStyleTag({content:'.panel-reflection .mosaic-cell{visibility:hidden}.panel-reflection>.photo-mosaic{background:#00ff00!important}.depth-0 .panel-reflection>.photo-mosaic{background:#ff0000!important}'});
 const r=await page.locator('.depth-0 .panel-reflection').boundingBox(),clip={x:Math.ceil(r.x)+10,y:Math.ceil(r.y)+10,width:Math.floor(r.width)-20,height:Math.min(100,Math.floor(900-r.y)-20)};
 const green=await page.screenshot({clip});
 const rear=await page.addStyleTag({content:'.activity-panel:not(.depth-0) .panel-reflection>.photo-mosaic{background:#0000ff!important}'});
 const blue=await page.screenshot({clip});assert.ok(green.equals(blue),'Rear colors must not bleed through front mirror');
 const hide=await page.addStyleTag({content:'.depth-0 .panel-reflection{visibility:hidden}'});const uncoveredBlue=await page.screenshot({clip});await rear.evaluate(el=>el.remove());const uncoveredGreen=await page.screenshot({clip});assert.ok(!uncoveredBlue.equals(uncoveredGreen),'Control proves rear mirrors occupy the tested region');
 await hide.evaluate(el=>el.remove());await style.evaluate(el=>el.remove());checks.push('Pixel occlusion regression: rear colors cannot bleed through front reflection');
 await page.locator('.depth-0').click();await page.locator('.wall-scene:not(.scene-inactive)').waitFor();await page.waitForTimeout(1200);
 for(const [w,h] of [[1440,900],[390,844]]){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(150);
  const theme=await page.locator('.caption-main h1').boundingBox(),count=await page.locator('.activity-counts').boundingBox();assert.ok(theme.x+theme.width<=count.x);assert.ok(Math.abs(theme.y+theme.height/2-count.y-count.height/2)<2);
  const c=await page.locator('.activity-counts').evaluate(el=>({border:getComputedStyle(el).borderLeftWidth,color:getComputedStyle(el).borderLeftColor}));assert.equal(c.border,'2px');assert.equal(c.color,'rgb(184, 139, 74)');
  const wall=await page.locator('.photo-wall').boundingBox(),label=await page.locator('.gallery-caption').boundingBox();assert.ok(wall.y+wall.height<label.y);assert.ok(label.height<70);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
  await page.screenshot({path:output+`/wall-${w}.png`});
 }checks.push('Desktop/mobile horizontal theme and counts, gold divider, compact non-overlapping footer');
 // Explicit synthetic video count and long title exercise wrapping without real media downloads.
 await page.route('**/api/gallery/**',async route=>{const response=await route.fetch();const d=await response.json();await route.fulfill({json:{...d,videos:2}})});
 await page.getByRole('button',{name:'返回 Gallery',exact:true}).click();await page.getByRole('button',{name:'四季片段',exact:true}).click();await expect.poll(()=>page.locator('.tunnel-stage').getAttribute('data-position')).toBe('3.000');await page.locator('.depth-0').click();await page.locator('.activity-counts').getByText('· 2 个视频',{exact:false}).waitFor();
 assert.ok(await page.locator('.activity-counts span').isVisible());checks.push('Nonzero video count remains visible beside photo count on mobile');
 await page.getByRole('button',{name:'返回 Gallery',exact:true}).click();await page.screenshot({path:output+'/coverflow-mobile.png'});
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await fs.writeFile('docs/research/coverflow-polish-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,surfaces,caption,fixtures:'synthetic geometry; video count is a controlled UI fixture'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
