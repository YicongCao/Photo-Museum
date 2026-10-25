import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE || 'http://localhost:8795',out=process.env.MUSEUM_BROWSER_OUTPUT || 'docs/design/previews/p5';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1586,height:992}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.addInitScript(()=>{
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),urls=new Set();
 URL.createObjectURL=blob=>{const url=create(blob);urls.add(url);return url};URL.revokeObjectURL=url=>{urls.delete(url);revoke(url)};
 window.p5LiveBlobs=urls;
});
const originalCount=()=>requests.filter(u=>/\/original(?:-compatible)?\?/.test(u)).length;
async function room(name){await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name,exact:true}).click()}
async function settled(){await page.waitForTimeout(1200)}
async function shot(name){await page.mouse.move(8,60);await settled();await page.screenshot({path:out+'/'+name+'.png'})}
async function home(){await page.getByRole('button',{name:/返回 (日历|地图|器材馆|时空隧道)/}).click();await settled()}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁'}).click();await page.locator('.depth-0').waitFor();
 checks.push('Default Gallery remains classic Cover Flow');
 await room('日历');await page.locator('.calendar-cell img').first().waitFor();
 assert.equal(await page.locator('.calendar-cell').count(),42);assert.equal(originalCount(),0);checks.push('Calendar month displays dated local covers without original requests');await shot('calendar-month');
 await page.getByRole('button',{name:'年',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-cell').length===12);checks.push('Year grain has twelve month cells');await shot('calendar-year');
 await page.getByRole('button',{name:'月',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-cell').length===42);await page.getByRole('button',{name:'年',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-cell').length===12);checks.push('Year to month control selects an observed month without inventing a January bucket');
 await page.locator('.calendar-cell:has(img)').first().click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-cell').length===42);
 await page.getByRole('button',{name:'周',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-cell').length===7);checks.push('Month drilldown and week grain use real date buckets');
 await page.getByRole('button',{name:/全部日期未详/}).click();await page.locator('.wall-photo').first().waitFor();await settled();assert.equal(originalCount(),0);checks.push('Unknown dates are a separate photo collection rather than January first');
 await page.locator('.wall-photo').first().click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();await settled();assert.ok(originalCount()>0);
 await page.getByRole('button',{name:'返回照片墙',exact:true}).click();await page.locator('.wall-photo').first().waitFor();await home();assert.equal(await page.evaluate(()=>window.p5LiveBlobs.size),0);checks.push('Calendar collection shares the 4K/original viewer and returns to its source room, releasing staged previews');
 const beforeMap=originalCount();await room('地图');await page.locator('.world-country').first().waitFor();await page.locator('.place-list>button').first().waitFor();assert.equal(await page.locator('.world-country').count(),177);await shot('map-world');
 const matrix=await page.locator('.map-surface svg>g').getAttribute('transform');await page.getByRole('button',{name:'放大地图',exact:true}).click();assert.notEqual(await page.locator('.map-surface svg>g').getAttribute('transform'),matrix);checks.push('Offline world map has real geometry and controlled zoom');
 for(const label of ['省份','城市','活动']){await page.locator('.place-list>button').first().click();await page.locator('.map-panel-heading h2').getByText(label,{exact:true}).waitFor()}
 await shot('map-city');assert.equal(originalCount(),beforeMap);checks.push('Country/province/city/activity drilldown reads only local data');
 await page.getByRole('button',{name:/全部 \d+ 张照片/}).click();await page.locator('.wall-photo').first().waitFor();await settled();await home();checks.push('Place collections return with map hierarchy retained');
 await room('器材馆');await page.locator('.device-list button').filter({hasText:'ILCE-7CR'}).click();await page.locator('.gear-device-heading h2').getByText('SONY ILCE-7CR',{exact:true}).waitFor();await page.locator('.gear-hero').waitFor();await shot('gear-camera');
 assert.ok(await page.getByRole('img',{name:/ILCE-7CR · 结构示意/}).isVisible());checks.push('Equipment has distinct line drawings, actual usage counts and score-selected photos');
 assert.ok(await page.locator('.gear-photo-grid').evaluate(el=>[...el.children].every(c=>c.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom+1)));checks.push('Equipment collage has no implicit overflowing image rows');
 await page.getByRole('button',{name:'☆ 已标记',exact:true}).click();await page.locator('.gear-display[aria-busy="false"]').waitFor();assert.ok(await page.locator('.gear-hero').isVisible());checks.push('Equipment marked-photo filter is independent from Cover Flow ranking');
 await page.locator('.gear-hero').click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();await settled();await page.getByRole('button',{name:'返回器材馆',exact:true}).click();await page.locator('.gear-hero').waitFor();checks.push('Equipment photo closes back to the same selected device');
 await page.getByRole('button',{name:'镜头',exact:true}).click();await page.locator('.device-list button').filter({hasText:'FE 50mm F1.4 GM'}).click();await page.locator('.gear-device-heading h2').getByText('FE 50mm F1.4 GM',{exact:true}).waitFor();await shot('gear-lens');checks.push('Lens records have their own equipment view');
 await room('时空隧道');await page.locator('.space-current').waitFor();assert.ok(await page.locator('.spacetime-board').count()<=7);await shot('spacetime');
 const slider=page.getByRole('slider',{name:'时空隧道位置'});await slider.focus();await slider.press('Home');await settled();await slider.press('ArrowRight');await settled();assert.equal(await slider.inputValue(),'1');checks.push('Spacetime is a separate bounded depth scene with keyboard navigation');
 const id=await page.locator('.space-current').getAttribute('data-activity');await page.locator('.space-current').click();await page.locator('.wall-photo').first().waitFor();await settled();await home();assert.equal(await page.locator('.space-current').getAttribute('data-activity'),id);checks.push('Spacetime activity wall returns to the same activity');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);assert.equal(await page.locator('.spacetime-board').count(),1);checks.push('Reduced motion uses a single flat activity instead of flight');
 await page.setViewportSize({width:390,height:720});
 for(const name of ['日历','地图','器材馆','时空隧道']){await room(name);await settled();assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/mobile-'+name+'.png'})}
 checks.push('All four rooms stay within a 390 by 720 viewport');
 await page.setViewportSize({width:1280,height:720});for(const name of ['日历','地图','器材馆','时空隧道']){await room(name);await settled();assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth))}checks.push('All four rooms also fit a short 1280 by 720 desktop');
 await room('日历');await page.getByRole('button',{name:'年',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.calendar-cell').length===12);await page.waitForTimeout(250);await page.reload();await page.locator('.calendar-room').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.calendar-cell').length===12);checks.push('Room selection and calendar grain survive authenticated reload');
 await page.mouse.move(5,5);await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.p5LiveBlobs.size),0);checks.push('Leaving photo collections releases staged Blob URLs');
 await page.route('**/api/exhibitions/calendar?**',route=>route.fulfill({status:503,json:{detail:'测试读取失败'}}));await page.getByRole('button',{name:'下一时段',exact:true}).click();await page.getByRole('alert').filter({hasText:'测试读取失败'}).waitFor();assert.equal(await page.locator('.calendar-cell').count(),12);await page.unroute('**/api/exhibitions/calendar?**');await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});checks.push('A room fetch failure keeps the last view and can retry');
 const assetPage=await context.newPage();assetPage.on('pageerror',e=>errors.push(e.message));assetPage.on('request',r=>requests.push(r.url()));await assetPage.route('**/assets/world-*.js',route=>route.abort());await assetPage.goto(base+'/#gallery');await assetPage.getByRole('button',{name:'Gallery',exact:true}).click();await assetPage.getByRole('menuitemradio',{name:'地图',exact:true}).click();await assetPage.getByRole('alert').filter({hasText:'底图未载入'}).waitFor();await assetPage.locator('.place-list>button').first().waitFor();await assetPage.unroute('**/assets/world-*.js');await assetPage.getByRole('button',{name:'重新载入',exact:true}).click();await assetPage.locator('.world-country').first().waitFor();checks.push('A missing map asset has an explicit recovery while the local location list remains usable');await assetPage.close();
 assert.equal(requests.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')).length,0);checks.push('No external map, font, image or GPS service requests');
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE || 'docs/research/p5-browser-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,fixture:'synthetic photos and explicitly injected metadata; not real photo color or subjective selection acceptance'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/p5-validation/failure.png'});await fs.writeFile('data/p5-validation/failure.json',JSON.stringify({error:String(e),errors,text:await page.locator('body').innerText()},null,2));throw e}finally{await browser.close()}
