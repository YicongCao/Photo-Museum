// Optional full-browser regression; deterministic trajectory coverage is cover-motion.test.mjs.
import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const position=()=>page.locator('.tunnel-stage').getAttribute('data-position').then(Number);
const straight=async target=>{await expect.poll(position).toBe(target);assert.match(await page.locator('.depth-0').getAttribute('style'),/rotateY\(0deg\)/)};
const traceStart=()=>page.evaluate(()=>{window.stopTrace=[];window.stopTraceActive=true;const sample=()=>{window.stopTrace.push(Number(document.querySelector('.tunnel-stage').dataset.position));if(window.stopTraceActive)requestAnimationFrame(sample)};sample()});
const traceEnd=()=>page.evaluate(()=>{window.stopTraceActive=false;return window.stopTrace});
const monotonic=(trace,sign)=>{for(let i=1;i<trace.length;i++)assert.ok((trace[i]-trace[i-1])*sign>=-.002,JSON.stringify(trace.slice(i-1,i+1)))};
try{
 await page.goto((process.env.MUSEUM_BROWSER_BASE||'http://localhost:8798')+'/#gallery');
 await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁',exact:true}).click();await page.locator('.depth-0').waitFor();
 await page.keyboard.press('ArrowRight');await straight(1);
 await page.mouse.move(500,300);await traceStart();await page.mouse.wheel(120,0);await straight(2);
 const forward=await traceEnd();monotonic(forward,1);assert.ok(new Set(forward).size>3);checks.push('Wheel landing is continuous, forward and exact with no pullback');
 await traceStart();await page.mouse.wheel(-120,0);await straight(1);const reverse=await traceEnd();monotonic(reverse,-1);checks.push('Reverse wheel landing is monotonic and exact');
 await page.keyboard.press('ArrowRight');await expect.poll(position).toBeGreaterThan(1.05);await page.mouse.wheel(-120,0);await expect.poll(async()=>{const p=await position();return Number.isInteger(p)&&p<2}).toBe(true);checks.push('Reverse input interrupts an in-flight landing');
 await page.mouse.move(600,300);await page.mouse.down();await page.mouse.move(410,300,{steps:8});const held=await position();await page.waitForTimeout(220);assert.equal(await position(),held);await page.mouse.up();await expect.poll(async()=>Number.isInteger(await position())).toBe(true);checks.push('Drag stays under the pointer until release and then settles');
 await page.emulateMedia({reducedMotion:'reduce'});const before=await position();await page.mouse.wheel(90,0);await straight(Math.min(5,before+1));checks.push('Reduced motion retains the same forward target without a coast');
 await page.mouse.wheel(9999,0);await straight(5);await page.mouse.wheel(-9999,0);await straight(0);checks.push('First and last covers are bounded');
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 const evidence=process.env.MUSEUM_BROWSER_EVIDENCE||'data/cover-stop-validation/browser-script.json';await fs.mkdir(new URL('../../data/cover-stop-validation/',import.meta.url),{recursive:true});
 await fs.writeFile(evidence,JSON.stringify({date:new Date().toISOString(),checks,errors,forward,reverse,fixture:'synthetic geometric photos'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
