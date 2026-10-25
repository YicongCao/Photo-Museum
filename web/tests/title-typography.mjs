import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8793',out=process.env.MUSEUM_BROWSER_OUTPUT||'docs/design/previews/typography/app';await fs.mkdir(out,{recursive:true});await fs.mkdir('data/title-typography',{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1500,height:940}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const fonts=async()=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(120)};
async function fit(selector){
 const result=await page.locator(selector).evaluate(e=>{
  const controls=[...e.querySelectorAll('a,button')].filter(n=>n.getClientRects().length),boxes=controls.map(n=>({text:n.textContent.trim(),r:n.getBoundingClientRect()}));
  return {inside:boxes.every(({r})=>r.x>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight),overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.r.right,b.r.right)-Math.max(a.r.x,b.r.x)>1&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.y,b.r.y)>1))};
 });assert.ok(result.inside&&!result.overlap,selector+' '+JSON.stringify(result));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
}
async function shot(name){await page.mouse.move(3,65);await page.screenshot({path:out+'/'+name+'.png'})}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();await fonts();
 const face=await page.evaluate(()=>[...document.fonts].filter(f=>f.family.includes('Museum Editorial')).map(f=>({family:f.family,status:f.status,weight:f.weight,unicodeRange:f.unicodeRange})));assert.equal(face.length,1);assert.equal(face[0].status,'loaded');
 assert.ok(await page.getByRole('button',{name:'Gallery',exact:true}).evaluate(e=>getComputedStyle(e).fontFamily.includes('Museum Editorial')));
 checks.push('Local 23KB Cormorant medium face loads and supplies the English section titles');
 const glyphs=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=90;const c=canvas.getContext('2d'),ui=getComputedStyle(document.documentElement).fontFamily,display=getComputedStyle(document.querySelector('.gallery-shell')).getPropertyValue('--gallery-display-font');
  const draw=(text,font)=>{c.clearRect(0,0,600,90);c.font=font;c.fillStyle='#fff';c.fillText(text,10,60);return {pixels:c.getImageData(0,0,600,90).data.slice(),width:c.measureText(text).width}};
  return [ui,display].flatMap((fallback,stack)=>[300,400].flatMap(weight=>['香港·故地重游','2026 · 10 0123456789','Hong Kong'].map(text=>{
   const before=draw(text,`${weight} 32px ${fallback}`),after=draw(text,`${weight} 32px "Museum Editorial",${fallback}`);
   return {stack,weight,text,samePixels:before.pixels.every((v,i)=>v===after.pixels[i]),widthBefore:before.width,widthAfter:after.width};
  })));
 });
 for(const g of glyphs)assert.equal(g.samePixels,g.text!=='Hong Kong',JSON.stringify(g));
 checks.push('Chinese and numeral glyph pixels and widths remain identical in UI/display stacks at original light and regular weights; English glyphs change');
 for(const [width,height] of [[1500,940],[390,844],[320,720],[844,390]]){await page.setViewportSize({width,height});await fonts();await fit('.gallery-nav');await shot('gallery-'+width)}
 checks.push('Gallery titles and controls fit desktop, phone, narrow phone and short landscape');
 await page.setViewportSize({width:1500,height:940});await page.getByRole('button',{name:'切换白天模式',exact:true}).click();await fonts();await fit('.gallery-nav');await shot('gallery-day');
 await page.getByRole('button',{name:'切换黑夜模式',exact:true}).click();
 for(const [hash,header,title] of [['manage','.keeper-header','Dashboard'],['settings?tab=display&from=gallery','.settings-header','Settings'],['curator','.curator-header','Curator']]){
  await page.goto(base+'/#'+hash);await page.locator(header).waitFor();await fonts();
  for(const [width,height] of [[1500,940],[390,844],[320,720]]){await page.setViewportSize({width,height});await fonts();await fit(header);await shot(title+'-'+width)}
 }
 checks.push('Dashboard brand, Settings headline and Curator navigation use the heading face without header overlap on desktop and 320/390px screens');
 const blocked=await browser.newContext({storageState:await context.storageState(),viewport:{width:320,height:720}}),fallback=await blocked.newPage();fallback.on('pageerror',e=>errors.push(e.message));await fallback.route('**/*.woff2',r=>r.abort());
 await fallback.goto(base+'/#gallery');await fallback.locator('.depth-0').waitFor();assert.ok(await fallback.getByRole('button',{name:'Gallery',exact:true}).isVisible());assert.ok(await fallback.locator('.gallery-nav').evaluate(e=>[...e.querySelectorAll('button')].filter(n=>n.getClientRects().length).every(n=>n.getBoundingClientRect().right<=innerWidth)));await blocked.close();
 checks.push('Blocked font requests retain usable existing fallback typography');
 assert.equal(requests.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')&&!u.startsWith('data:')).length,0);assert.deepEqual(errors,[]);checks.push('No external runtime font/image requests or uncaught browser errors; no LLM request is sent');
 await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE||'docs/research/title-typography-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,face,glyphs,fixture:'Synthetic catalog and local font assets. Glyph comparison uses browser canvas at identical coordinates, not system font-family assumptions.'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/title-typography/failure.png'});throw e}finally{await browser.close()}
