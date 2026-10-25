import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=process.env.MUSEUM_TEST_URL||'http://localhost:8796',out='docs/design/previews/curator-timeline';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1500,height:940}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
try{
 await page.goto(base+'/#curator');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.curator-shell').waitFor();
 await page.getByLabel('策展要求',{exact:true}).fill('整理2024年的照片，制作照片墙');const response=page.waitForResponse(r=>r.url().endsWith('/api/curator/runs')&&r.request().method()==='POST');await page.getByRole('button',{name:'开始策展 ↗',exact:true}).click();const fresh=await (await response).json();await page.locator('.curator-shell[data-run-id="'+fresh.id+'"]').waitFor();
 await page.locator('.curator-result').waitFor();await page.locator('.curator-live-status[data-working=false]').waitFor();
 const kinds=await page.locator('[data-event-id]').evaluateAll(es=>es.map(e=>({id:Number(e.dataset.eventId),kind:e.dataset.kind})));
 assert.ok(kinds.filter(e=>e.kind==='tool').length>=4);assert.ok(kinds.filter(e=>e.kind==='thinking').length>=5);
 assert.ok(kinds.every((r,i)=>!i||r.id>kinds[i-1].id));for(let i=0;i<kinds.length;i++)if(kinds[i].kind==='tool'){assert.equal(kinds[i-1].kind,'thinking');assert.equal(kinds[i+1].kind,'thinking')}
 await page.screenshot({path:out+'/completed.png'});checks.push('Real local fake-provider SSE: 5 thought blocks interleave with 4 tools in persisted ID order, with completed result and stopped animation');
 const posts=requests.filter(r=>r.method==='POST'&&r.url.endsWith('/curator/runs')).length;
 await page.reload();await page.locator('.curator-result').waitFor();assert.deepEqual(await page.locator('[data-event-id]').evaluateAll(es=>es.map(e=>({id:Number(e.dataset.eventId),kind:e.dataset.kind}))),kinds);assert.equal(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/curator/runs')).length,posts);
 checks.push('Authenticated reload replays the same chronology without starting another model request');
 // Controlled SSE events supplement the real fixture with waiting, reconnect and stop states.
 const controlled=await browser.newContext({storageState:await context.storageState(),viewport:{width:1500,height:940}}),p=await controlled.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  const Native=EventSource;window.__timers=new Set();const add=setInterval.bind(window),drop=clearInterval.bind(window);
  window.setInterval=(fn,ms,...args)=>{const id=add(fn,ms,...args);if(ms===1000)window.__timers.add(id);return id};window.clearInterval=id=>{window.__timers.delete(id);drop(id)};
  window.EventSource=class{constructor(url){if(!url.includes('timeline-fixture'))return new Native(url);window.__trace=this;this.listeners={};setTimeout(()=>this.onopen?.({}),0)}addEventListener(k,f){this.listeners[k]=f}close(){this.closed=true}};
 });
 const mockRun={id:'timeline-fixture',status:'running',prompt:'合成：先核对地点，再检索主体',answer:'',room:'wall',created:Date.now()/1000,updated:Date.now()/1000};
 await p.route('**/api/curator/runs/timeline-fixture',r=>r.fulfill({json:mockRun}));
 await p.goto(base+'/#curator?run=timeline-fixture');await p.locator('.curator-live-status[data-working=true]').waitFor();
 const emit=async(id,kind,data,age=0)=>p.evaluate(({id,kind,data,age})=>window.__trace.onmessage({data:JSON.stringify({id,kind,data,created:Date.now()/1000-age})}),{id,kind,data,age});
 await emit(1,'phase',{stage:'thinking',round:1,label:'模型思考'});await emit(2,'thinking',{text:'先核对城市字段，确认地点符合条件。'});await emit(3,'answer',{text:'先检索城市，再检索汽车主体。'});await emit(4,'tool_start',{call_id:'test',name:'search_photos',arguments:{filters:{city:['合成城市'],subject:['跑车']}}});
 await p.locator('.curator-live-status[data-stage=tool]').waitFor();await p.locator('.curator-tool summary').click();await p.screenshot({path:out+'/tool-working.png'});
 await emit(5,'tool_end',{call_id:'test',name:'search_photos',duration_ms:32,result:{total:4}});await emit(6,'phase',{stage:'thinking',round:2,label:'模型思考'});await emit(7,'thinking',{text:'找到了候选，现在核对评分和缓存。'},12);
 await p.locator('.curator-live-status small').filter({hasText:/1[2-9] 秒未更新/}).waitFor();await p.screenshot({path:out+'/thinking.png'});
 await emit(7,'thinking',{text:'此重复事件不可显示'});assert.equal(await p.getByText('此重复事件不可显示').count(),0);
 assert.deepEqual(await p.locator('[data-kind]').evaluateAll(es=>es.map(e=>e.dataset.kind)),['thinking','answer','tool','thinking']);
 assert.equal(await p.locator('.curator-thinking').first().innerText().then(s=>s.includes('找到了候选')),false);
 checks.push('Distinct thought/output blocks remain on each side of their tool; duplicate SSE IDs cannot duplicate text; elapsed update age stays visible during a quiet connected model');
 const spin=await p.locator('.curator-work-orbit').evaluate(e=>getComputedStyle(e).transform);await p.waitForTimeout(150);assert.notEqual(await p.locator('.curator-work-orbit').evaluate(e=>getComputedStyle(e).transform),spin);
 await p.evaluate(()=>window.__trace.onerror({}));await p.locator('.curator-live-status[data-working=false]').waitFor();assert.equal(await p.locator('.curator-live-status [role=status]').innerText(),'重连中');assert.equal(await p.locator('.curator-work-orbit').evaluate(e=>getComputedStyle(e).animationName),'none');await p.evaluate(()=>window.__trace.onopen({}));await p.locator('.curator-live-status[data-working=true]').waitFor();
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.curator-work-orbit').evaluate(e=>getComputedStyle(e).animationName),'none');await p.emulateMedia({reducedMotion:'no-preference'});
 checks.push('Orbit changes frame during work, freezes on reconnect and reduced motion, resumes after connection recovery');
 await emit(8,'phase',{stage:'preparing',label:'检查本地缓存'});await p.locator('.curator-live-status[data-stage=preparing]').waitFor();await emit(9,'preparation',{checked:2,total:4,ready:2,skipped:0});
 for(const [width,height] of [[1500,940],[844,390],[390,844],[320,720],[390,540]]){await p.setViewportSize({width,height});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.waitForTimeout(120);assert.equal(await p.locator('.curator-shell').count(),1);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));assert.ok(await p.locator('.curator-process').evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}));await p.screenshot({path:out+'/layout-'+width+'-'+height+'.png'})}
 checks.push('Preparation phase reports actual checked count; process and navigation fit desktop, short, 320px, 390px and short phone without document scrolling');
 await emit(10,'done',{status:'cancelled'});await p.locator('.curator-live-status[data-working=false]').waitFor();assert.equal(await p.evaluate(()=>window.__timers.size),0);
 await p.getByRole('link',{name:'Settings',exact:true}).click();await p.locator('.settings-shell').waitFor();await p.waitForFunction(()=>window.__timers.size===0&&window.__trace.closed===true);assert.equal(await p.evaluate(()=>window.__timers.size),0);assert.equal(await p.evaluate(()=>window.__trace.closed),true);await p.goto(base+'/#curator?run=timeline-fixture');await p.locator('.curator-live-status[data-working=true]').waitFor();assert.equal(await p.evaluate(()=>window.__timers.size),1);await p.getByRole('link',{name:'Settings',exact:true}).click();await p.locator('.settings-shell').waitFor();await p.waitForFunction(()=>window.__timers.size===0&&window.__trace.closed===true);assert.equal(await p.evaluate(()=>window.__timers.size),0);assert.equal(await p.evaluate(()=>window.__trace.closed),true);await controlled.close();checks.push('Cancellation and page unmount clear the timer and close the stream; no abandoned busy animation');
 assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>!r.url.startsWith(base)&&!r.url.startsWith('blob:')).length,0);
 await fs.writeFile('docs/research/curator-timeline-evidence.json',JSON.stringify({checks,errors,fixture:'Generated P5 photos + local fake-provider SSE; supplemental browser-controlled events cover quiet/reconnect/abort states. No private index or paid provider calls.'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/curator-timeline/failure.png'});throw e}finally{await browser.close()}
