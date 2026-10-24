import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const scale=el=>{const t=getComputedStyle(el).transform;return t==='none'?1:Number(t.match(/matrix\(([^,]+)/)[1]);};
try {
 await page.goto('http://127.0.0.1:8793');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'进入馆务室'}).click();
 const group=page.locator('.timeline-year-group').first();await group.waitFor();
 assert.equal(await group.locator('h2').innerText(),'2024');
 assert.deepEqual(await group.locator('h3').allTextContents(),['10','年度']);
 assert.equal(await group.locator('.timeline-month-group').first().locator('li').count(),3);
 const labels=group.locator('li .dock-label');const first=labels.nth(0),second=labels.nth(1);
 await group.locator('li').nth(0).hover();await page.waitForTimeout(280);
 assert.ok(await first.evaluate(scale)>1.29);assert.ok(await second.evaluate(scale)>1.02);
 const before=await first.evaluate(scale);await group.locator('li').nth(1).hover();await page.waitForTimeout(70);
 const mid=[await first.evaluate(scale),await second.evaluate(scale)];assert.ok(mid[0]<before&&mid[0]>1);assert.ok(mid[1]>1.1);
 await page.waitForTimeout(230);assert.ok(await second.evaluate(scale)>1.29);
 await fs.mkdir('docs/design/previews/timeline',{recursive:true});await page.screenshot({path:'docs/design/previews/timeline/dock-hover.png'});
 await page.mouse.move(400,60);await page.waitForTimeout(280);assert.equal(await first.evaluate(scale),1);assert.equal(await second.evaluate(scale),1);
 await group.locator('li button').nth(1).click();const theme=await group.locator('li button').nth(1).innerText();await page.getByRole('heading',{name:theme,exact:true}).waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});await group.locator('li').nth(0).hover();assert.equal(await first.evaluate(scale),1);
 await page.setViewportSize({width:390,height:844});assert.ok(await group.locator('h2').isVisible());assert.ok(await group.locator('h3').first().isVisible());
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));await page.screenshot({path:'docs/design/previews/timeline/mobile.png'});
 assert.deepEqual(errors,[]);
 const result={checks:6,errors,verified:['year/month/activity hierarchy and annual group','hover focal and neighboring magnification','old label shrinks while new label grows','pointer leave resets and click selects correct activity','reduced motion disables scaling','mobile hierarchy remains one viewport']};
 await fs.writeFile('docs/research/timeline-browser-evidence.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
