import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8796',out='docs/design/previews/gallery-refinement/final';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1586,height:992}}),page=await context.newPage(),errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const stable=async()=>{await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');await page.waitForTimeout(700)};
async function room(label){await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name:label,exact:true}).click();await stable()}
async function capture(file){await page.mouse.move(3,68);await page.waitForTimeout(450);await page.screenshot({path:out+'/'+file+'.png'})}
async function style(id,label){await page.goto(base+'/#settings?tab=display&from=gallery');await page.getByRole('radio',{name:label,exact:true}).check();await page.getByRole('button',{name:'保存偏好',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存'}).waitFor();await page.getByRole('link',{name:'Gallery',exact:true}).click();await stable();assert.equal(await page.locator('.gallery-shell').getAttribute('data-cover-style'),id)}
try{
await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();await stable();
const styles={classic:'经典镜面',framed:'金框画廊',depth:'纵深展廊',arc:'全景弧幕'};
for(const [id,label] of Object.entries(styles)){
 await style(id,label);await page.getByRole('button',{name:'下一场活动',exact:true}).click();await page.getByRole('button',{name:'下一场活动',exact:true}).click();await page.waitForTimeout(1100);
 await capture(id+'-1586');
 const matrix=await page.locator('.depth-0').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform));
 const angle=await page.locator('.depth-0').evaluate(el=>Math.abs(new DOMMatrix(getComputedStyle(el).transform).m13));assert.ok(angle<.002,id+' active upright');
 for(const [w,h] of [[390,720],[701,900],[844,390],[1280,640]]){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(300);const r=await page.locator('.depth-0').boundingBox();assert.ok(r.width>=110&&r.height>=60,id+' primary readable at '+w);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
  assert.ok(await page.locator('.gallery-nav').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight&&getComputedStyle(e).visibility==='visible'}));
  await capture(id+'-'+w);
  assert.ok(await page.locator('.dock-timeline').evaluate(root=>{const r=root.querySelector('button[aria-current="true"]').getBoundingClientRect(),b=root.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1}),id+' active timeline remains in view at '+w);
 }
 await page.setViewportSize({width:1586,height:992});checks.push(label+': Settings保存、主封面转正、5种屏幕尺寸无页面溢出');
}
await style('framed','金框画廊');await page.reload();await stable();assert.equal(await page.locator('.gallery-shell').getAttribute('data-cover-style'),'framed');checks.push('样式随服务端偏好重载恢复');
await page.getByRole('button',{name:'切换白天模式',exact:true}).click();await capture('framed-day');assert.equal(await page.locator('.gallery-shell').getAttribute('data-theme'),'light');
await page.getByRole('button',{name:'切换黑夜模式',exact:true}).click();
await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();await stable();await capture('wall');
await page.getByRole('button',{name:'返回 Gallery',exact:true}).click();await stable();assert.equal(await page.locator('.gallery-shell').getAttribute('data-cover-style'),'framed');checks.push('新样式仍复用活动墙并返回保位，日夜不反色');
for(const [label,id] of [['日历','calendar'],['地图','map'],['器材馆','gear'],['时空隧道','space'],['人生年轮','rings'],['记忆星图','constellation'],['记忆长卷','scroll'],['故地重游','revisit']]){await room(label);await capture(id);assert.equal(await page.locator('[data-scene-clone]').count(),0)}
checks.push('八展厅切换过渡完成后无残留飞散克隆');
await room('时空隧道');const slider=page.getByRole('slider',{name:'时空隧道位置'});await slider.fill('3');await slider.dispatchEvent('input');await page.waitForTimeout(1200);
assert.ok(await page.locator('.spacetime-board').evaluateAll(els=>els.every(e=>getComputedStyle(e).opacity==='1')),'space panels must occlude, never ghost');
const near=await page.locator('.space-current').boundingBox();assert.ok(near.y>=65&&near.x>=0,'current tunnel panel fits viewport');
assert.ok(await page.locator('.spacetime-board').evaluateAll(els=>{const current=els.findIndex(e=>e.classList.contains('space-current'));return els.slice(0,current).every(e=>e.getBoundingClientRect().right<=0)}),'departed panel is outside viewport');
await capture('space');await page.setViewportSize({width:390,height:720});await capture('space-mobile');assert.ok(await page.locator('.dock-timeline').evaluate(e=>e.getBoundingClientRect().top>innerHeight/2),'mobile tunnel timeline below scene');assert.ok(await page.locator('.spacetime-board').evaluateAll(els=>{const current=els.findIndex(e=>e.classList.contains('space-current'));return els.slice(0,current).every(e=>e.getBoundingClientRect().right<=0)}),'mobile previous panel left viewport');
const title=await page.locator('.gallery-caption').boundingBox(),prev=await page.getByRole('button',{name:'上一场活动',exact:true}).boundingBox();assert.ok(title.x>=prev.x+prev.width,'title clear of previous control');await page.setViewportSize({width:1586,height:992});checks.push('时空隧道透明重叠修复，前一画板完全退场，手机标题避让按钮');
assert.equal(requests.filter(u=>/\/original(?:-compatible)?\?/.test(u)).length,0);checks.push('全程只浏览展厅与墙：零原图请求');
await room('Cover Flow');await page.setViewportSize({width:1440,height:900});await page.mouse.move(600,300);await page.mouse.wheel(231,0);await page.waitForTimeout(1400);assert.ok(await page.locator('.depth-0').evaluate(el=>Math.abs(new DOMMatrix(getComputedStyle(el).transform).m13)<.002));checks.push('横向触控板停止后仍平滑归位转正');
await page.emulateMedia({reducedMotion:'reduce'});await room('人生年轮');await room('Cover Flow');assert.equal(await page.locator('[data-scene-clone]').count(),0);checks.push('减少动态效果时可直接切换且无残留');
await page.goto(base+'/#settings?tab=display');await page.locator('.cover-style-choice').first().waitFor();await capture('settings-styles');assert.ok(await page.locator('.cover-style-choice input').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().width===16&&e.getBoundingClientRect().height===16)),'style radio keeps compact16px geometry');
assert.equal(requests.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')&&!u.startsWith('data:')).length,0);assert.deepEqual(errors,[]);checks.push('零外部图片/地图/字体请求与未捕获错误');
await fs.writeFile('docs/research/gallery-refinement-browser-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,fixture:'synthetic photos; no private NAS data; screenshot layout evidence, not photo quality acceptance'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/gallery-refinement/failure.png'});await fs.writeFile('data/gallery-refinement/failure.json',JSON.stringify({error:String(e),errors,text:await page.locator('body').innerText()},null,2));throw e}finally{await browser.close()}
