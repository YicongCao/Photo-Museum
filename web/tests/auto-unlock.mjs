import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://127.0.0.1:8791',password='synthetic-owner-password';
const output=process.env.MUSEUM_BROWSER_OUTPUT||'docs/design/previews/auto-unlock';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];
async function scenario(name,run) {
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();
 const requests=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/login'))requests.push(r)});
 page.on('pageerror',e=>errors.push(e.message));
 try{await run(page,requests);checks.push(name)}finally{await context.close()}
}
async function ready(page) {
 await page.goto(base+'/#manage');await page.getByRole('button',{name:'解锁'}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.entrance button').disabled);
}
async function silentFill(page,value) {
 await page.locator('input[name="password"]').evaluate((input,value)=>{input.value=value},value);
}
async function unlocked(page) {await page.getByRole('link',{name:'Settings',exact:true}).waitFor()}
try {
 await scenario('Value present before bootstrap automatically unlocks the requested Dashboard',async(page,requests)=>{
  await page.route('**/api/bootstrap',async route=>{await new Promise(r=>setTimeout(r,350));await route.continue()});
  await page.goto(base+'/#manage');await silentFill(page,password);await unlocked(page);
  assert.equal(requests.length,1);assert.ok(page.url().endsWith('#manage'));
 });
 await scenario('Silent delayed password-manager fill needs no input event or button click',async(page,requests)=>{
  await ready(page);await silentFill(page,password);await unlocked(page);await page.waitForTimeout(1100);
  assert.equal(requests.length,1);await page.screenshot({path:output+'/unlocked.png'});
 });
 await scenario('Replacement and paste events submit once even when emitted repeatedly',async(page,requests)=>{
  await ready(page);await page.locator('input[name="password"]').evaluate((input,value)=>{
   input.value=value;
   for(const type of ['insertReplacementText','insertFromPaste','insertReplacementText'])
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:type,data:value}));
  },password);await unlocked(page);assert.equal(requests.length,1);
 });
 await scenario('Automatic unlock also opens Gallery and preserves its route',async(page,requests)=>{
  await page.goto(base+'/#gallery');await page.waitForFunction(()=>!document.querySelector('.entrance button').disabled);
  await silentFill(page,password);await page.locator('.gallery-nav').waitFor();
  assert.ok(page.url().endsWith('#gallery'));assert.equal(requests.length,1);
 });
 await scenario('Typing pauses do not submit partial passwords; Enter still unlocks',async(page,requests)=>{
  await ready(page);const input=page.getByLabel('馆主密码',{exact:true});
  await input.pressSequentially('synthetic-',{delay:30});await page.waitForTimeout(1300);assert.equal(requests.length,0);
  await input.pressSequentially('owner-password',{delay:15});await input.press('Enter');await unlocked(page);assert.equal(requests.length,1);
 });
 await scenario('Wrong autofill is attempted once, preserves error and accepts corrected fill',async(page,requests)=>{
  await ready(page);await silentFill(page,'fixture-wrong-password');await page.getByRole('alert').waitFor();
  await page.waitForTimeout(1400);assert.equal(requests.length,1);
  assert.ok(await page.getByRole('button',{name:'解锁'}).isEnabled());await page.screenshot({path:output+'/wrong-password.png'});
  await silentFill(page,password);await unlocked(page);assert.equal(requests.length,2);
 });
 await scenario('Concurrent automatic and manual submission cannot create duplicate requests',async(page,requests)=>{
  await page.route('**/api/login',async route=>{await new Promise(r=>setTimeout(r,850));await route.continue()});
  await ready(page);await silentFill(page,password);
  await page.waitForFunction(()=>document.querySelector('.entrance button')?.disabled);
  await page.locator('form').evaluate(form=>form.requestSubmit());await unlocked(page);assert.equal(requests.length,1);
 });
 await scenario('Explicit lock stays locked after autofill; manual unlock remains available',async(page,requests)=>{
  await ready(page);await silentFill(page,password);await unlocked(page);
  await page.getByRole('button',{name:'锁定',exact:true}).click();await page.getByLabel('馆主密码',{exact:true}).waitFor();
  await silentFill(page,password);await page.waitForTimeout(1400);assert.equal(requests.length,1);
  await page.getByRole('button',{name:'解锁'}).click();await unlocked(page);assert.equal(requests.length,2);
 });
 await scenario('First-time password setup never submits an automatically populated field',async(page)=>{
  let setups=0;
  await page.route('**/api/bootstrap',route=>route.fulfill({json:{initialized:false}}));
  await page.route('**/api/setup',route=>{setups++;return route.fulfill({status:400,json:{detail:'fixture_only'}})});
  await page.goto(base+'/#manage');await page.getByLabel('设置馆主密码',{exact:true}).waitFor();
  await silentFill(page,password);await page.waitForTimeout(1400);assert.equal(setups,0);
  await page.getByRole('button',{name:'创建并进入'}).click();await page.getByRole('alert').waitFor();assert.equal(setups,1);
 });
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE||'docs/research/auto-unlock-browser-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,fixture:'isolated synthetic credentials; silent DOM fill and input events simulate password managers; no real saved passwords read'},null,2));
 console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
