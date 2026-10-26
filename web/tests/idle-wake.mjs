import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8798',browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 const catalogue=await (await context.request.get(base+'/api/gallery')).json(),photo=catalogue.activities[0].selected[0],initial=await (await context.request.get(base+'/api/media/state')).json();
 const file={asset_id:photo.id,revision:photo.revision,path:'/synthetic/test.jpg',kind:'image_candidate',steps:{download:'running'},bytes_done:50,bytes_total:100};
 let data={...initial,active:[],completion_events:[],paused:true};
 await page.route('**/api/media/state*',r=>r.fulfill({json:data}));
 await page.goto(base+'/#manage');await page.locator('.directory-segments').waitFor();
 await page.evaluate(()=>{window.values=[];const el=document.querySelector('.directory-segments');new MutationObserver(()=>window.values.push(Number(el.getAttribute('aria-label').match(/\d+/)[0]))).observe(el,{attributes:true,attributeFilter:['aria-label']})});
 data={...data,active:[file],paused:false};await page.evaluate(()=>window.dispatchEvent(new Event('museum-data-changed')));
 await page.waitForFunction(()=>Number(document.querySelector('.directory-segments').getAttribute('aria-label').match(/\d+/)[0])>0);
 await page.waitForTimeout(300);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
 assert.equal(await page.locator('.subitem.running .icon').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
 const steps=Object.fromEntries(['download','exif','display','thumb','publish','address','subject','faces','score'].map(s=>[s,'done']));
 data={...data,active:[],completion_cursor:999999,completion_events:[{...file,steps,completion_id:999999,thumbnail:photo.thumbnail}]};
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
 await page.getByRole('img',{name:'单图全部子任务 100%',exact:true}).waitFor();
 const values=await page.evaluate(()=>window.values);assert.equal(Math.max(...values),100);assert.ok(values.every((n,i)=>i===0||n-values[i-1]<=1),'completion still lights each bar in order');
 assert.equal(await page.locator('.segment-done').count(),100);
 assert.deepEqual(errors,[]);await fs.writeFile('data/idle-efficiency/wake.json',JSON.stringify({checks:['idle progress wakes on data','hidden running pulse pauses','visibility restores and receives completion','all bars reach 100 one by one'],samples:values.length,errors},null,2));console.log('Idle progress wake and hidden/resume passed');
}finally{await browser.close()}
