import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const output='docs/design/previews/photography';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1586,height:992}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
try {
 await page.goto('http://localhost:8793/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁'}).click();await page.locator('.depth-0').waitFor();
 const gallery=await (await context.request.get('http://localhost:8793/api/gallery')).json(),photo=gallery.activities[0].selected[0];
 const state=await (await context.request.get('http://localhost:8793/api/media/state')).json();
 assert.equal(state.fully_done,60);checks.push('All synthetic files complete only with photography results');
 const active={asset_id:photo.id,revision:photo.revision,path:'/synthetic/风格主题/IMG_0000.jpg',kind:'image_candidate',photography_enabled:true,stage:'topic',lane:'photography',steps:{download:'done',exif:'done',display:'done',thumb:'done',publish:'done',address:'done',subject:'done',faces:'done',score:'done',style:'done',topic:'running'}};
 await page.route('**/api/media/state**',route=>route.fulfill({json:{...state,active:[active],completion_events:[],paused:false}}));
 await page.getByRole('link',{name:'Dashboard',exact:true}).click();
 await page.locator('.inspection-row[data-task="style"]').getByText('极简留白',{exact:true}).waitFor();
 await page.locator('.inspection-row[data-task="topic"]').getByText('自然风光',{exact:true}).waitFor();
 checks.push('Dashboard displays separate Chinese style and topic candidates');
 assert.equal(await page.locator('.processing-subitems button,.processing-subitems span').filter({hasText:'摄影风格'}).count()>0,true);
 assert.ok(await page.locator('.processing-subitems').getByText('摄影主题',{exact:true}).isVisible());checks.push('Both subtasks have icons and participate in the single-file progress');
 assert.equal(requests.filter(u=>u.includes('/original?')).length,0);checks.push('Dashboard classification display requests no original');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));await page.screenshot({path:output+'/dashboard.png'});
 await page.getByRole('link',{name:'Gallery',exact:true}).click();await page.locator('.depth-0').waitFor();await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();await page.waitForTimeout(1100);await page.locator('.wall-photo').first().click();
 await page.locator('.metadata-panel .photography-labels').getByText('极简留白',{exact:true}).waitFor();await page.locator('.metadata-panel .photography-labels').getByText('自然风光',{exact:true}).waitFor();
 assert.ok((await page.locator('.photography-labels dd').first().getAttribute('title')).includes('相似度 0.31'));
 checks.push('Photo archive shows candidates with similarity rather than a correctness percentage');await page.waitForTimeout(1100);await page.screenshot({path:output+'/archive.png'});
 await page.setViewportSize({width:390,height:720});await page.waitForTimeout(250);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));checks.push('Desktop and short mobile viewport retain no page scrolling');
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await fs.writeFile('docs/research/photography-browser-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,fixture:'synthetic geometric photos, controlled local classification labels and active progress'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){
 await page.screenshot({path:output+'/failure.png'});
 await fs.writeFile('data/photography-validation/browser-failure.txt',await page.locator('body').innerText());
 await fs.writeFile('data/photography-validation/browser-errors.json',JSON.stringify(errors));
 throw e;
}finally{await browser.close()}
