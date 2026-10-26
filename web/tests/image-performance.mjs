import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const label=process.argv[2]||'baseline',base='http://127.0.0.1:8798',out='data/image-performance';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[],errors=[];
try{
for(const network of ['loopback','lan100']){
 const context=await browser.newContext({viewport:{width:1600,height:900}});
 await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 const page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 if(network==='lan100')await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:10,downloadThroughput:12500000,uploadThroughput:12500000});
 page.on('pageerror',e=>errors.push(e.message));
 let responses=[],bytes=0,active=new Set(),peak=0;
 cdp.on('Network.requestWillBeSent',e=>{if(/\/media\/(thumb|display)/.test(e.request.url)){active.add(e.requestId);peak=Math.max(peak,active.size)}});
 cdp.on('Network.responseReceived',e=>{if(/\/media\/(thumb|display)/.test(e.response.url))responses.push({status:e.response.status,disk:!!e.response.fromDiskCache})});
 cdp.on('Network.loadingFinished',e=>{if(active.delete(e.requestId))bytes+=e.encodedDataLength});cdp.on('Network.loadingFailed',e=>active.delete(e.requestId));
 for(let round=0;round<3;round++)for(const scenario of (process.env.MUSEUM_PERF_SCENARIOS||'cover,wall,calendar,gear,map').split(','))for(const temperature of ['cold','warm']){
  await page.goto('about:blank');if(temperature==='cold')await cdp.send('Network.clearBrowserCache');
  responses=[];bytes=0;active.clear();peak=0;
  const start=performance.now();
  await page.goto(base+'/#gallery?room='+ (scenario==='wall'?'cover':scenario),{waitUntil:'domcontentloaded'});
  if(scenario==='wall'){await page.locator('.depth-0').waitFor();await page.locator('.depth-0').click()}
  const selector={cover:'.photo-mosaic img',wall:'.wall-photo img',calendar:'.calendar-cell img',gear:'.gear-photo-grid img',map:'.place-list img'}[scenario];
  console.log('begin',network,round,scenario,temperature);
  await page.waitForFunction(selector=>{const imgs=[...document.querySelectorAll(selector)].filter(i=>{const r=i.getBoundingClientRect();return r.width&&r.height&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight});return imgs.length>0&&imgs.every(i=>i.complete&&i.naturalWidth)},selector,{timeout:45000}).catch(async e=>{console.log((await page.locator('body').innerText()).slice(0,600));console.log(await page.locator(selector).evaluateAll(xs=>xs.filter(i=>!i.complete||!i.naturalWidth).map(i=>({src:i.getAttribute('src'),done:i.complete}))));throw e});
  // For wall, measure the 4K layer too, not only the quickly painted thumbnails.
  if(scenario==='wall')await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('.wall-photo .wall-display')];return imgs.length>0&&imgs.every(i=>i.complete&&i.naturalWidth&&i.classList.contains('ready'))},null,{timeout:45000});
  const readyMs=performance.now()-start;
  await page.waitForTimeout(700);
  results.push({network,round,scenario,temperature,readyMs:+readyMs.toFixed(1),bytes,requests:responses.length,peakScheduled:peak,diskHits:responses.filter(r=>r.disk).length});
  console.log(JSON.stringify(results.at(-1)));
 }
 await context.close();
}
assert.deepEqual(errors,[]);await fs.writeFile(out+'/'+label+'.json',JSON.stringify({label,viewport:[1600,900],rounds:3,results,errors},null,2));
}finally{await browser.close()}
