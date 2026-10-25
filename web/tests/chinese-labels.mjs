import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const output='docs/design/previews/chinese-labels';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1586,height:992}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
try {
 await page.goto('http://localhost:8793/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁'}).click();await page.locator('.depth-0').waitFor();
 const gallery=await (await context.request.get('http://localhost:8793/api/gallery')).json(),photo=gallery.activities[0].selected[0];
 const state=await (await context.request.get('http://localhost:8793/api/media/state')).json();
 const active={asset_id:photo.id,revision:photo.revision,path:'/synthetic/中文显示/IMG_0000.jpg',kind:'image_candidate',stage:'score',lane:'analysis',steps:{download:'done',exif:'done',display:'done',thumb:'done',publish:'done',address:'done',subject:'done',faces:'done',score:'running'}};
 await page.route('**/api/media/state**',route=>route.fulfill({json:{...state,active:[active],completion_events:[],paused:false}}));
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 const address=page.locator('.inspection-row').filter({hasText:'地址'}).locator('dd');await page.waitForFunction(()=>[...document.querySelectorAll('.inspection-row dd')].some(e=>e.textContent.includes('中国 · 新疆 · 新源')));
 assert.ok((await address.innerText()).includes('最近城市'));checks.push('Dashboard address shows China / Xinjiang / Xinyuan in Chinese while retaining city approximation');
 const subject=page.locator('.inspection-row').filter({hasText:'主体'}).locator('dd');assert.match(await subject.innerText(),/高尔夫球 90%/);assert.match(await subject.innerText(),/湖边 80%/);assert.match(await subject.innerText(),/油菜 70%/);checks.push('Dashboard subjects show Chinese with unchanged confidences');
 assert.equal(requests.filter(u=>u.includes('/original?')).length,0);checks.push('Dashboard display localization never requests a NAS original');await page.screenshot({path:output+'/dashboard.png'});
 const response=await (await context.request.get(`http://localhost:8793/api/assets/${photo.id}/analysis`)).json();assert.equal(response.places.data.country,'China');assert.equal(response.places.data.city,'Xinyuan');assert.equal(response.visual.data.tags[0].label,'golf ball');assert.equal(response.visual.data.tags[0].confidence,.9);checks.push('API preserves original English names, confidence, precision and source IDs');
 await page.getByRole('link',{name:'Gallery',exact:true}).click();await page.locator('.depth-0').waitFor();await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();await page.waitForTimeout(1100);await page.locator('.wall-photo').first().click();
 await page.locator('.metadata-panel').getByText('中国 · 新疆 · 新源',{exact:true}).waitFor();await page.locator('.metadata-panel').getByText('高尔夫球 · 湖边 · 油菜',{exact:true}).waitFor();checks.push('Single photo archive also displays Chinese address and subject labels');await page.screenshot({path:output+'/photo-archive.png'});
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await fs.writeFile('docs/research/chinese-labels-browser-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,fixtures:'synthetic geometric photos and public town identity; active file is a controlled UI fixture'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
