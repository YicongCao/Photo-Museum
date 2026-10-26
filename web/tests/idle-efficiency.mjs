// Synthetic catalogue only. Trace without rAF sampling: the observer must not keep GPU frames alive.
import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8798',label=process.argv[2]||'after',root='data/idle-efficiency',dist=path.resolve(root+'/'+(label==='before'?'baseline-dist':'after-dist'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),requests=[],errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(new URL(r.url()).pathname)});
await page.addInitScript(()=>{
 window.idleCounts={timeout:0,interval:0};
 for(const [api,key] of [['setTimeout','timeout'],['setInterval','interval']]){const native=window[api];window[api]=(f,ms,...args)=>native(()=>{window.idleCounts[key]++;if(typeof f==='function')f(...args)},ms)}
});
await page.route(base+'/**',async route=>{
 const pathname=new URL(route.request().url()).pathname;
 if(pathname==='/api/media/state'){
  const response=await route.fetch(),data=await response.json();Object.assign(data,{active:[],completion_events:[],paused:true});return route.fulfill({response,json:data});
 }
 if(pathname.startsWith('/api/'))return route.continue();
 const file=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(dist+'/'))return route.abort();
 try{await route.fulfill({path:file})}catch{await route.continue()}
});
const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('LayerTree.enable');let layers=[];
cdp.on('LayerTree.layerTreeDidChange',x=>layers=x.layers||[]);
const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
async function sample(scene,ms){
 await page.waitForTimeout(2200);const before=await metrics(),q=requests.length;await page.evaluate(()=>window.idleCounts={timeout:0,interval:0});
 let trace=[];const record=e=>trace.push(...e.value);cdp.on('Tracing.dataCollected',record);
 await cdp.send('Tracing.start',{categories:'devtools.timeline,cc,benchmark',transferMode:'ReportEvents'});await page.waitForTimeout(ms);
 const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await done;cdp.off('Tracing.dataCollected',record);
 const after=await metrics(),dom=await page.evaluate(()=>({timers:window.idleCounts,animations:document.getAnimations().filter(a=>a.playState==='running').map(a=>a.animationName),hints:[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).willChange!=='auto').length}));
 results.push({scene,seconds:ms/1000,taskMilliseconds:Math.round((after.TaskDuration-before.TaskDuration)*1000),paints:trace.filter(x=>x.name==='Paint').length,drawFrames:trace.filter(x=>x.name==='DrawFrame').length,layers:layers.length,requests:requests.slice(q),...dom});
}
try{
 await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 await page.goto(base+'/#gallery');await page.locator('.depth-0').waitFor();await sample('cover',45000);
 await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();await sample('wall',10000);
 await page.mouse.move(1580,30);await page.waitForTimeout(300);await page.getByRole('link',{name:'Dashboard',exact:true}).click();await page.locator('.directory-segments').waitFor();await sample('dashboard-idle',10000);
 // Hold the document hidden: no periodic reads or animation should survive (after only).
 if(label==='after'){
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
  await sample('hidden-dashboard',6000);assert.equal(results.at(-1).requests.length,0);assert.equal(results.at(-1).animations.length,0);
  const count=requests.length;await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(750);
  assert.ok(requests.length>count,'visible tab refreshes immediately');
 }
 await fs.writeFile(root+'/'+label+'-browser.json',JSON.stringify({results,errors},null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors},null,2));
}finally{await browser.close()}
