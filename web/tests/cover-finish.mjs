import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assertPixelDifferenceAtMost} from './pixels.mjs';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8793';
const out=process.env.MUSEUM_BROWSER_OUTPUT||'docs/design/previews/cover-finish';
await fs.mkdir(out,{recursive:true});await fs.mkdir('data/cover-finish',{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}}),checks=[],errors=[],requests=[];
let style='classic';
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
// Expand only the synthetic fixture's covers, reusing synthetic assets. This
// isolates responsive residency from the fixture's six real activity records.
await page.route('**/api/gallery',async route=>{
 const response=await route.fetch(),data=await response.json(),original=data.activities;
 data.activities=Array.from({length:25},(_,i)=>i<original.length?original[i]:{
  ...original[i%original.length],id:'synthetic-cover-'+i,
  event:{...original[i%original.length].event,theme:'合成活动 '+String(i+1).padStart(2,'0')},
 });
 await route.fulfill({response,json:data});
});
await page.route('**/api/preferences',async route=>{
 if(route.request().method()!=='GET')return route.fallback();
 const response=await route.fetch(),values=await response.json();await route.fulfill({response,json:{...values,cover_style:style}});
});
const stable=async()=>{await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');await page.waitForTimeout(500)};
async function shot(name){await page.mouse.move(3,70);await page.waitForTimeout(300);await page.screenshot({path:out+'/'+name+'.png'})}
async function choose(next){style=next;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.cover-style-'+next).waitFor();await stable()}
async function room(label){await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name:label,exact:true}).click();await stable()}
async function finish(front,mirror,theme){
 const values=await page.locator(front).first().evaluate(e=>{
  const c=getComputedStyle(e),cell=getComputedStyle(e.querySelector('.mosaic-cell'));
  return {outline:c.outlineWidth,color:c.outlineColor,border:c.borderTopWidth,inner:c.borderTopColor,radius:c.borderRadius,cell:cell.borderRadius,shadow:c.boxShadow,filter:c.filter};
 });
 assert.equal(values.outline,'2px');assert.equal(values.color,'rgb(184, 139, 74)');assert.equal(values.border,'3px');
 assert.equal(values.inner,theme==='light'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
 assert.equal(values.radius,'6px');assert.equal(values.cell,'3px');assert.notEqual(values.shadow,'none');assert.equal(values.filter,'none');
 const reflection=await page.locator(mirror).first().evaluate(e=>{
  const c=getComputedStyle(e),image=getComputedStyle(e.querySelector('.photo-mosaic'));
  return {gap:parseFloat(c.top)-e.parentElement.clientHeight,radius:c.borderRadius,border:c.borderTopWidth,outline:c.outlineStyle,
   photoBorder:image.borderTopWidth,photoOutline:image.outlineStyle,photoShadow:image.boxShadow,filter:image.filter,opacity:c.opacity,background:c.backgroundColor};
 });
 assert.ok(reflection.gap>=13&&reflection.gap<=15,JSON.stringify(reflection));assert.equal(reflection.radius,'6px');
 for(const key of ['border','photoBorder'])assert.equal(reflection[key],'0px',key);
 for(const key of ['outline','photoOutline'])assert.equal(reflection[key],'none',key);
 assert.equal(reflection.photoShadow,'none');assert.ok(reflection.filter.includes('blur(5px)'));assert.equal(reflection.opacity,'1');
 assert.equal(reflection.background,theme==='light'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();await stable();
 await page.waitForFunction(()=>[...document.querySelectorAll('.depth-0>.photo-mosaic img')].every(i=>i.complete&&i.naturalWidth));
 for(const next of ['classic','framed','depth','arc']){
  await choose(next);await finish('.depth-0>.photo-mosaic','.depth-0 .panel-reflection','dark');await shot(next+'-night');
  const visible=await page.evaluate(()=>{
   const found=new Set();
   for(let y=150;y<780;y+=16)for(let x=250;x<1670;x+=4){const cover=document.elementFromPoint(x,y)?.closest('.activity-panel');if(cover)found.add(cover.dataset.activity)}
   return found.size;
  });assert.equal(visible,9,next+' must visibly expose all nine covers, not only mount them');
  await page.getByRole('button',{name:'切换白天模式',exact:true}).click();await finish('.depth-0>.photo-mosaic','.depth-0 .panel-reflection','light');await shot(next+'-day');
  await page.getByRole('button',{name:'切换黑夜模式',exact:true}).click();
 }
 checks.push('Four cover styles in both themes: 2px gold, 3px black/white inset, 6px frame and 3px photo corners, all-around shadow; mirrors have no border/outline/shadow, 14px gap and 5px blur');
 await choose('classic');
 for(const [width,height,count] of [[1280,720,9],[1440,810,9],[1600,900,9],[1920,1080,9],[390,844,5],[820,1180,7],[844,390,7],[2560,1440,13],[3440,1440,19]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(250);
  assert.equal(await page.locator('.activity-panel').count(),count,`${width}×${height}`);
  const offsets=await page.locator('.activity-panel').evaluateAll(es=>es.map(e=>Number(e.dataset.coverOffset)));
  assert.equal(offsets.filter(n=>n<0).length,offsets.filter(n=>n>0).length);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
  if([390,844,3440].includes(width))await shot('classic-'+width);
 }
 checks.push('1280/1440/1600/1920 16:9 = 9 covers; phone 5, tablet/short landscape 7, wide 13, ultra-wide 19; equal wings and no document overflow');
 await page.setViewportSize({width:1920,height:1080});await stable();
 // Pixel occlusion: changing rear reflections must not change the front mirror.
 const hide=await page.addStyleTag({content:'.panel-reflection .mosaic-cell{visibility:hidden}.panel-reflection>.photo-mosaic{background:#00ff00!important}.depth-0 .panel-reflection>.photo-mosaic{background:#ff0000!important}'});
 const r=await page.locator('.depth-0 .panel-reflection').boundingBox();const clip={x:Math.ceil(r.x)+64,y:Math.ceil(r.y)+40,width:Math.floor(r.width)-128,height:80};
 const before=await page.screenshot({clip}),rear=await page.addStyleTag({content:'.activity-panel:not(.depth-0) .panel-reflection>.photo-mosaic{background:#0000ff!important}'});
 const after=await page.screenshot({clip});
 if(!before.equals(after)){await fs.writeFile('data/cover-finish/mirror-before.png',before);await fs.writeFile('data/cover-finish/mirror-after.png',after)}
 assertPixelDifferenceAtMost(before,after);await rear.evaluate(e=>e.remove());await hide.evaluate(e=>e.remove());
 checks.push('Pixel check: blurred mirrors still occlude rear colors instead of adding them');
 await room('时空隧道');await page.locator('.space-current').waitFor();await finish('.space-current>.photo-mosaic','.space-current .space-reflection','dark');
 assert.equal(await page.locator('.spacetime-board').count(),9);
 assert.equal(await page.locator('.space-current>.photo-mosaic').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(184, 139, 74)');
 await shot('spacetime-desktop');
 for(const [width,height] of [[390,844],[844,390]]){
  await page.setViewportSize({width,height});await stable();await finish('.space-current>.photo-mosaic','.space-current .space-reflection','dark');
  const slider=await page.getByRole('slider',{name:'时空隧道位置'}).evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e});assert.ok(slider);await shot('spacetime-'+width);
 }
 checks.push('Spacetime shares the finish and nine desktop boards; opaque gold gutters remain, phone/short-screen slider stays above reflections');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelectorAll('.spacetime-board').length===1);await room('Cover Flow');assert.equal(await page.locator('[data-scene-clone]').count(),0);
 checks.push('Reduced motion retains direct room navigation without leftover animation clones');
 for(let i=1;i<=3;i++){
  await page.getByRole('button',{name:'下一场活动',exact:true}).click();
  await expect.poll(()=>page.locator('.tunnel-stage').getAttribute('data-position')).toBe(i.toFixed(3));
  const id=await page.locator('.depth-0').getAttribute('data-activity');await page.reload();
  await expect.poll(()=>page.locator('.depth-0').getAttribute('data-activity')).toBe(id);
 }
 checks.push('Three immediate reloads after cover changes preserve the selected activity before the coalescing timer expires');
 assert.equal(requests.filter(u=>/\/original(?:-compatible)?(?:\?|$)/.test(u)).length,0);assert.deepEqual(errors,[]);
 checks.push('Zero original-file requests and uncaught browser errors');
 await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE||'docs/research/cover-finish-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,fixture:'Synthetic assets; 25 cover records expanded only in browser response, no private NAS data. Visual layout evidence, not real photo color acceptance.'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/cover-finish/failure.png'});throw e}finally{await browser.close()}
