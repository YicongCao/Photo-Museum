import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='data/aesthetic-rollout/ui';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:940}}),errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
try{
 await page.route('**/api/preferences',async route=>{const r=await route.fetch();await route.fulfill({json:{...await r.json(),original_loading:'on_demand'}})});
 await page.goto('http://localhost:8797/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');
 await page.locator('.depth-0').waitFor();await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
 await page.locator('.wall-photo').first().click();await page.locator('.photo-analysis-archive').waitFor();
 await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
 const row=label=>page.locator('.photo-analysis-archive>div').filter({has:page.locator('dt').filter({hasText:label})});
 await expect(row('美学评分').locator('dd')).toContainText('6.8');await expect(row('技术评分').locator('dd')).toContainText('/ 100');
 assert.match(await row('美学评分').locator('dd').getAttribute('title'),/未按个人偏好校准/);
 assert.ok(await row('美学评分').locator('svg').count());
 await page.locator('.metadata-panel').evaluate(e=>e.scrollTop=e.scrollHeight);await expect(row('美学评分')).toBeVisible();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:out+'/archive.png'});
 checks.push('Neural aesthetics (one decimal) and original technical /100 appear separately with provenance tooltip and matching line icon');
 for(const [width,height] of [[390,844],[844,390]]){await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));}
 checks.push('Detail archive retains internal scrolling at phone and short landscape sizes');
 await page.goto('http://localhost:8797/#manage');await page.getByRole('link',{name:'Dashboard',exact:true}).waitFor();
 await expect(page.locator('body')).toContainText('美学评分');await page.screenshot({path:out+'/dashboard.png'});
 checks.push('Dashboard completed-file steps include aesthetics; no original download during metadata inspection');
 assert.equal(requests.filter(u=>/\/original(?:-compatible)?\?/.test(u)).length,0);assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/evidence.json',JSON.stringify({checks,errors,fixture:'Synthetic P5 images and deterministic fake neural scores, not model quality evidence'},null,2));console.log(JSON.stringify({checks,errors}));
}catch(e){await page.screenshot({path:out+'/failure.png'});throw e}finally{await browser.close()}
