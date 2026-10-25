import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE || 'http://localhost:8795';
const output=process.env.MUSEUM_RADIAL_OUTPUT || 'docs/design/previews/creative-radial';
const evidence=process.env.MUSEUM_RADIAL_EVIDENCE || 'docs/research/creative-radial-browser-evidence.json';
await fs.mkdir(output,{recursive:true});await fs.mkdir('data/creative-validation',{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1586,height:992}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const originals=()=>requests.filter(u=>/\/original(?:-compatible)?\?/.test(u)).length;
const settle=()=>page.waitForTimeout(850);
async function room(name){await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name,exact:true}).click();await settle()}
async function screenshot(name){await page.mouse.move(3,70);await settle();await page.screenshot({path:output+'/'+name+'.png'})}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();
 await room('人生年轮');await page.locator('.year-ring').first().waitFor();assert.ok(await page.locator('.year-ring').count()<=5);assert.ok(await page.locator('.ring-photo').count()<=60);assert.equal(originals(),0);
 assert.ok(await page.locator('.rings-scene').evaluate(scene=>{const box=scene.getBoundingClientRect();return [...scene.querySelectorAll('.year-ring')].every(el=>{const b=el.getBoundingClientRect();return b.top>=box.top-1&&b.bottom<=box.bottom+1})}));
 checks.push('Rings render bounded actual year sectors using only local thumbnails and 4K previews');await screenshot('rings-desktop');
 const years=page.getByLabel('年轮年份',{exact:true}),options=await years.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
 assert.ok(options.length>1);await years.selectOption(options.at(-1));await settle();assert.equal(await years.inputValue(),options.at(-1));
 assert.equal(await page.locator('.rings-center>text').first().textContent(),options.at(-1));checks.push('Year navigation changes selection without inventing month or day');
 await page.locator('.rings-detail-images button').first().click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();await settle();await page.getByRole('button',{name:'返回人生年轮',exact:true}).click();await page.locator('.rings-room').waitFor();await settle();assert.equal(await years.inputValue(),options.at(-1));checks.push('Rings opens shared darkroom and returns to the same year');
 await page.getByRole('button',{name:'展开活动照片',exact:true}).click();await page.locator('.wall-photo').first().waitFor();await settle();await page.getByRole('button',{name:'返回 人生年轮',exact:true}).click();await page.locator('.rings-room').waitFor();checks.push('A year activity opens the filtered collection and returns to its ring');
 const before=originals();await room('记忆星图');await page.locator('.constellation-photo').first().waitFor();assert.ok(await page.locator('.constellation-photo').count()<=15);assert.ok(await page.locator('.constellation-hub').count()<=3);assert.equal(originals(),before);await screenshot('constellation-desktop');checks.push('Constellation is bounded to three label groups with no source downloads');
 const world=page.locator('.constellation-world'),transform=await world.getAttribute('style');await page.getByRole('button',{name:'放大星图',exact:true}).click();assert.notEqual(await world.getAttribute('style'),transform);await page.getByRole('button',{name:'重置星图',exact:true}).click();
 await page.locator('.constellation-basis').click();await page.getByText('连线表示同一标签，不表示人物关系或相似度。',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭标签依据',exact:true}).click();checks.push('Zoom/reset work and explanatory label provenance is inspectable');
 const label=await page.getByLabel('星图标签',{exact:true}).inputValue();await page.locator('.constellation-hero').click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();await settle();await page.getByRole('button',{name:'返回记忆星图',exact:true}).click();await page.locator('.constellation-room').waitFor();assert.equal(await page.getByLabel('星图标签',{exact:true}).inputValue(),label);checks.push('Constellation photo returns from shared viewer to selected label');
 await page.getByRole('button',{name:'切换标签列表',exact:true}).click();await page.locator('.constellation-list-group').first().waitFor();await screenshot('constellation-list');await page.getByRole('button',{name:'切换星图',exact:true}).click();checks.push('A structured list is available as an alternate to spatial navigation');
 for(const size of [{width:390,height:720},{width:844,height:390}]){
  await page.setViewportSize(size);
  for(const [label,slug] of [['人生年轮','rings'],['记忆星图','constellation']]){
   await room(label);assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth));
   const toolbar=await page.locator(label==='人生年轮'?'.rings-toolbar':'.constellation-controls').boundingBox();assert.ok(toolbar.x>=0&&toolbar.y>=0&&toolbar.x+toolbar.width<=size.width+1&&toolbar.y+toolbar.height<=size.height+1);
   await screenshot(slug+'-'+size.width);
  }
 }
 checks.push('Both rooms and their controls fit 390×720 and 844×390 without page scrolling');
 await page.emulateMedia({reducedMotion:'reduce'});await room('人生年轮');assert.equal(await page.locator('.rings-detail-images').evaluate(el=>getComputedStyle(el).animationName),'none');await room('记忆星图');assert.equal(await page.locator('.constellation-photo').first().evaluate(el=>getComputedStyle(el).animationName),'none');checks.push('Reduced motion disables sector-detail and star-photo entrance animation');
 const actual=await (await page.request.get(base+'/api/exhibitions/creative')).json(),clipped=structuredClone(actual);
 const targetYear=clipped.years.find(y=>y.activities.filter(a=>a.selected.length).length>1),[target,other]=targetYear.activities.filter(a=>a.selected.length);
 const expected=await (await page.request.get(base+'/api/exhibitions/creative/photos?'+new URLSearchParams({kind:'chapter',key:target.id,year:targetYear.year,sort:'score',limit:3}))).json();
 target.selected=[];targetYear.selected=other.selected;clipped.sample_records_omitted=100;
 const clippedRoute=route=>route.fulfill({status:200,json:clipped});await page.route('**/api/exhibitions/creative',clippedRoute);
 const fetches=[];const previewRoute=async route=>{const url=new URL(route.request().url());if(url.searchParams.get('kind')==='chapter'&&url.searchParams.get('key')===target.id){fetches.push(url);await new Promise(r=>setTimeout(r,500));await route.fulfill({status:200,json:expected})}else await route.continue()};
 await page.route('**/api/exhibitions/creative/photos?**',previewRoute);await room('人生年轮');await page.getByLabel('年轮年份',{exact:true}).selectOption(String(targetYear.year));
 await page.locator('select[aria-label="年轮活动"]').selectOption(target.id);
 await page.waitForFunction(id=>document.querySelector('.rings-detail-images')?.dataset.previewActivity===id,target.id);
 assert.equal(await page.locator('.rings-detail-images [data-asset]').count(),0);
 await page.locator('.rings-detail-images [data-asset]').first().waitFor();assert.deepEqual(await page.locator('.rings-detail-images [data-asset]').evaluateAll(nodes=>nodes.map(n=>n.dataset.asset)),expected.items.map(p=>p.id));
 assert.ok(fetches.some(url=>url.searchParams.get('year')===String(targetYear.year)&&url.searchParams.get('limit')==='3'&&url.searchParams.get('sort')==='score'));
 await page.locator('select[aria-label="年轮活动"]').selectOption(other.id);assert.deepEqual(await page.locator('.rings-detail-images [data-asset]').evaluateAll(nodes=>nodes.map(n=>n.dataset.asset)),other.selected.slice(0,3).map(p=>p.id));
 await page.unroute('**/api/exhibitions/creative/photos?**',previewRoute);await page.unroute('**/api/exhibitions/creative',clippedRoute);checks.push('A clipped ring activity fetches its own bounded year-filtered preview and never borrows a different activity');
 const limited=structuredClone(actual);limited.group_counts=Object.fromEntries(['style','topic','subject'].map(kind=>[kind,{visible:limited.groups.filter(g=>g.kind===kind).length,total:99}]));limited.group_total=297;
 const groupRoute=route=>route.fulfill({status:200,json:limited});await page.route('**/api/exhibitions/creative',groupRoute);await room('记忆星图');await page.getByText(`分组 ${limited.groups.length} / 297`,{exact:true}).waitFor();await page.getByLabel('星图标签类型',{exact:true}).selectOption('style');await page.getByText(`分组 ${limited.group_counts.style.visible} / 99`,{exact:true}).waitFor();assert.ok(await page.locator('.constellation-hub').count()>0);
 await page.getByLabel('星图标签类型',{exact:true}).selectOption('all');await page.unroute('**/api/exhibitions/creative',groupRoute);checks.push('Tag type filters retain independent groups and display visible versus total counts when capped');
 await page.route('**/api/exhibitions/creative',route=>route.fulfill({status:200,json:{total:12,unknown:12,years:[],chapters:[],groups:[],places:[]}}));await room('人生年轮');await page.getByRole('button',{name:'日期未详 12',exact:true}).waitFor();assert.equal(await page.locator('.year-ring').count(),0);await room('记忆星图');await page.getByText('暂无有效标签',{exact:true}).waitFor();checks.push('Unknown dates and missing current tags stay explicit rather than fabricated');
 assert.equal(requests.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')).length,0);assert.deepEqual(errors,[]);checks.push('No external requests or uncaught browser errors');
 await fs.writeFile(evidence,JSON.stringify({date:new Date().toISOString(),checks,errors,fixture:'Synthetic media, explicitly injected metadata and local candidate tags; not real semantic quality acceptance'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/creative-validation/radial-failure.png'});await fs.writeFile('data/creative-validation/radial-failure.json',JSON.stringify({error:String(e),errors,text:await page.locator('body').innerText()},null,2));throw e}finally{await browser.close()}
