import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {taskStatus} from '../src/task-status.mjs';
assert.equal(taskStatus(null).text,'加载进度中');
assert.equal(taskStatus(null,[],'offline').text,'进度加载失败');
assert.equal(taskStatus({counts:{ready:1},fully_done:1},[],'offline').text,'进度更新失败');
assert.equal(taskStatus({counts:{ready:1},fully_done:1,error_count:0}).text,'全部处理完成');
assert.equal(taskStatus({counts:{unsupported:1},fully_done:0,error_count:1}).text,'有待处理异常');
assert.equal(taskStatus({counts:{pending:1},fully_done:0}).text,'等待处理');
assert.equal(taskStatus({paused:true}).text,'媒体已暂停');
assert.equal(taskStatus({active:[{}]}).text,'任务进行中');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://127.0.0.1:8793');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'解锁'}).click();await page.locator('.depth-0').waitFor();
 let mode='slow',mock=null;
 await page.route('**/api/media/state*',async route=>{
  if(mode==='fail')return route.fulfill({status:503,json:{detail:'测试连接中断'}});
  if(mode==='slow')await new Promise(r=>setTimeout(r,1300));
  if(mock)return route.fulfill({json:mock});
  return route.continue();
 });
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByRole('status').filter({hasText:'加载进度中'}).waitFor();
 assert.equal(await page.locator('.keeper-header nav').innerText(),'Settings\nDashboard\nGallery');assert.equal(await page.getByRole('button',{name:'锁定',exact:true}).count(),1);
 await page.getByRole('status').filter({hasText:'全部处理完成'}).waitFor();
 const before=await page.locator('.keeper-metrics strong').first().innerText();
 mode='fail';await page.getByRole('status').filter({hasText:'进度更新失败'}).waitFor();
 assert.equal(await page.locator('.keeper-metrics strong').first().innerText(),before);assert.ok((await page.getByRole('alert').innerText()).includes('上次更新'));
 await page.reload();await page.getByRole('status').filter({hasText:'进度加载失败'}).waitFor();
 assert.equal(await page.locator('.keeper-metrics strong').first().innerText(),'—');
 mode='ok';await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.getByRole('status').filter({hasText:'全部处理完成'}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('dialog',{name:'Settings',exact:true}).waitFor();assert.ok(await page.getByRole('heading',{name:'照片源',exact:true}).isVisible());await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 const initial=await (await page.request.get('http://127.0.0.1:8793/api/media/state')).json();mock={...initial,counts:{ready:59,unsupported:1},fully_done:59,error_count:1,active:[]};await page.getByRole('status').filter({hasText:'有待处理异常'}).waitFor();
 await fs.mkdir('docs/design/previews/dashboard-status',{recursive:true});await page.screenshot({path:'docs/design/previews/dashboard-status/desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.keeper-header nav a[aria-current="page"]').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));await page.screenshot({path:'docs/design/previews/dashboard-status/mobile.png'});
 assert.deepEqual(errors,[]);const result={unitStates:8,browserChecks:7,errors,checks:['four header controls','explicit first loading','refresh failure preserves last counters','initial failure never means complete','retry recovers and clears error','source configuration inside Settings','exceptions distinct from done; mobile one viewport']};await fs.writeFile('docs/research/dashboard-status-evidence.json',JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close()}
