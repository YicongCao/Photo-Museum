import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const position=()=>page.locator('.tunnel-stage').getAttribute('data-position').then(Number);
const straight=async()=>{await expect.poll(async()=>{const p=await position();return p===Math.round(p)}).toBe(true);assert.match(await page.locator('.depth-0').getAttribute('style'),/rotateY\(0deg\)/);};
try {
 await page.goto('http://127.0.0.1:8793/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁'}).click();await page.locator('.depth-0').waitFor();
 await page.getByRole('button',{name:'四季片段',exact:true}).click();await expect.poll(position).toBe(3);await straight();
 await page.mouse.move(500,300);await page.mouse.wheel(120,0);await page.waitForTimeout(70);const intermediate=await position();assert.ok(intermediate>3&&intermediate<3.5);
 // Sample animation frames: settling must contain intermediate values, not jump straight.
 await page.evaluate(()=>{window.settleTrace=[];const start=performance.now();const sample=()=>{window.settleTrace.push(Number(document.querySelector('.tunnel-stage').dataset.position));if(performance.now()-start<900)requestAnimationFrame(sample)};sample()});
 await page.waitForTimeout(1000);await straight();assert.equal(await position(),3);
 const trace=await page.evaluate(()=>window.settleTrace);assert.ok(new Set(trace.filter(p=>p>3&&p<intermediate)).size>=3);checks.push('Wheel idle animates through intermediate positions to exact zero-degree front cover');
 await page.mouse.wheel(190,0);await page.waitForTimeout(210);await page.mouse.wheel(-150,0);await straight();assert.equal(await position(),3);checks.push('New wheel input interrupts settling and chooses latest nearest cover');
 await page.mouse.move(600,300);await page.mouse.down();await page.mouse.move(410,300,{steps:8});await page.waitForTimeout(250);const held=await position();assert.ok(held>3.5&&held<4);await page.waitForTimeout(200);assert.equal(await position(),held);await page.mouse.up();await straight();assert.equal(await position(),4);checks.push('Drag remains fractional while held and settles on release');
 await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.wheel(-90,0);await page.waitForTimeout(260);await straight();checks.push('Reduced motion settles immediately after idle');
 await page.mouse.wheel(9999,0);await straight();assert.equal(await position(),5);await page.mouse.wheel(-9999,0);await straight();assert.equal(await position(),0);checks.push('First and last covers remain within bounds');
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await fs.writeFile('docs/research/coverflow-settle-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,trace,fixture:'synthetic geometric photos'},null,2));console.log(JSON.stringify({checks,errors},null,2));
} finally {await browser.close()}
