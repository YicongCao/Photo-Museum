// Isolated synthetic page only. rAF measures frame scheduling, not physical GPU utilization.
import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.MUSEUM_BROWSER_BASE||'http://127.0.0.1:8798',label=process.argv[2]||'baseline',out='data/transition-perf';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage();
const errors=[],http=[],results=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)http.push({status:r.status(),url:new URL(r.url()).pathname})});
await page.addInitScript(()=>{
 window.framesLog=[];window.tracking=false;
 window.startFrames=()=>{window.framesLog=[];window.sceneMetric={};window.tracking=true;const token=window.frameToken=(window.frameToken||0)+1;let last=performance.now();const f=t=>{
  if(!window.tracking||token!==window.frameToken)return;
  window.framesLog.push(t-last);last=t;
  const ms=t-window.clickedAt,m=window.sceneMetric;
  if(m.firstMotionMs==null&&document.getAnimations().some(a=>a.playState==='running'&&a.effect?.target?.matches?.('.activity-panel,.wall-photo,.viewer-image-area,.metadata-panel,[data-scene-clone]')))m.firstMotionMs=ms;
  const el=document.querySelector(window.measureSelector);
  if(el&&getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height){
    m.visibleMs??=ms;
    if([...el.querySelectorAll('img')].some(i=>i.naturalWidth&&getComputedStyle(i).visibility!=='hidden'&&Number(getComputedStyle(i).opacity)>0))m.firstImageMs??=ms;
  }
  if(document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false')m.settledMs??=ms;
  requestAnimationFrame(f);
 };requestAnimationFrame(f)};
 window.stopFrames=()=>{window.tracking=false;const v=window.framesLog.filter(x=>x>0).sort((a,b)=>a-b);return {frames:v.length,p95:v[Math.floor(v.length*.95)],max:Math.max(...v),over33:v.filter(x=>x>33.4).length,fps:1000*v.length/v.reduce((a,b)=>a+b,0)}};
});
async function measure(name,click,selector){
 await page.evaluate(selector=>{window.measureSelector=selector;window.clickedAt=null;document.addEventListener("pointerup",()=>{window.clickedAt=performance.now();window.startFrames()},{once:true,capture:true})},selector);await click();
 await page.locator(selector).first().waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
 await page.waitForTimeout(50);
 const data=await page.evaluate(()=>({...window.sceneMetric,...window.stopFrames()}));
 results.push({name,...data});
}
try{
 if(process.env.MUSEUM_WEB_TEST_DIST){const dist=path.resolve(process.env.MUSEUM_WEB_TEST_DIST);await page.route(base+'/**',async r=>{
  const pathname=new URL(r.request().url()).pathname;if(pathname.startsWith('/api/'))return r.continue();
  const file=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(dist+'/'))return r.abort();
  try{await r.fulfill({path:file})}catch{await r.continue()}
 })}
 await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 await page.goto(base+'/#gallery');await page.locator('.depth-0').waitFor();await page.waitForTimeout(2500);
 // No rAF observer during idle: tracing must not itself force continuous drawing.
 const cdp=await context.newCDPSession(page);let trace=[];cdp.on('Tracing.dataCollected',e=>trace.push(...e.value));
 await cdp.send('Tracing.start',{categories:'devtools.timeline,cc,benchmark',transferMode:'ReportEvents'});await page.waitForTimeout(5000);
 const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await done;
 const idle={drawFrames:trace.filter(x=>x.name==='DrawFrame').length,paints:trace.filter(x=>x.name==='Paint').length,activeAnimations:await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').map(a=>({target:a.effect?.target?.className,name:a.animationName}))) };
 for(let i=0;i<3;i++){
  await measure('cover-wall',()=>page.locator('.depth-0').click(),'.wall-photo');
  await page.waitForFunction(()=>[...document.querySelectorAll('.wall-photo img')].some(i=>i.naturalWidth));
  await measure('wall-photo',()=>page.locator('.wall-photo').first().click(),'.photo-viewer');
  await measure('photo-wall',()=>page.getByRole('button',{name:'返回照片墙',exact:true}).click(),'.wall-scene:not(.scene-inactive)');
  await measure('wall-cover',()=>page.getByRole('button',{name:'返回 Gallery',exact:true}).click(),'.cover-scene:not(.scene-inactive)');
 }
 // Simulate a slow local preview fetch: waiting must not display native broken images.
 await page.route('**/media/thumb?**',async r=>{await new Promise(r=>setTimeout(r,800));await r.continue().catch(()=>{})});
 await page.reload();await page.locator('.depth-0').waitFor();await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();
 const placeholders=await page.locator('.wall-photo img').evaluateAll(xs=>xs.filter(i=>!i.naturalWidth&&getComputedStyle(i).visibility!=='hidden'&&getComputedStyle(i).opacity!=='0').map(i=>({hasSrc:!!i.getAttribute('src'),class:i.className})));
 await page.screenshot({path:out+'/'+label+'-wall.png'});
 await fs.writeFile(out+'/'+label+'.json',JSON.stringify({label,idle,results,placeholders,errors,http},null,2));console.log(JSON.stringify({idle,results,placeholders,errors,http},null,2));
}finally{await browser.close()}
