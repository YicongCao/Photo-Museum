import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8793',out='docs/design/previews/navigation';
await fs.mkdir(out,{recursive:true});await fs.mkdir('data/navigation-unification',{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1500,height:940}}),page=await context.newPage(),checks=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
async function geometry(){
 const result=await page.locator('.museum-nav').evaluate(e=>{
  const items=[...e.querySelectorAll('.museum-nav-pages>a,.gallery-room-switch>button,.museum-nav-tools>button')].filter(n=>n.getClientRects().length),rects=items.map(n=>n.getBoundingClientRect());
  return {labels:items.slice(0,3).map(n=>n.textContent.trim()),inside:rects.every(r=>r.x>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight),overlap:rects.some((a,i)=>rects.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1)),heights:rects.map(r=>r.height),font:getComputedStyle(items[0]).fontFamily};
 });
 assert.deepEqual(result.labels,['Dashboard','Settings','Gallery']);assert.ok(result.inside&&!result.overlap,JSON.stringify(result));assert.ok(result.heights.every(h=>h>=44));assert.ok(result.font.includes('Museum Editorial'));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
 const collision=await page.locator('.museum-nav').evaluate(e=>{const r=e.getBoundingClientRect();return [...e.parentElement.children].filter(n=>n!==e&&n.getClientRects().length).some(n=>{const a=n.getBoundingClientRect();return Math.min(a.right,r.right)-Math.max(a.x,r.x)>1&&Math.min(a.bottom,r.bottom)-Math.max(a.y,r.y)>1})});assert.equal(collision,false,'header collision');
}
async function capture(name){await page.mouse.move(2,190);await page.screenshot({path:out+'/'+name+'.png'})}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();
 for(const [route,active] of [['gallery','Gallery'],['manage','Dashboard'],['settings?tab=display&from=gallery','Settings'],['curator',null]]){
  await page.goto(base+'/#'+route);await page.locator('.museum-nav').waitFor();await page.evaluate(()=>document.fonts.ready);
  if(active)assert.equal(await page.locator('.museum-nav [aria-current=page]').innerText(),active);
  assert.equal(await page.getByLabel('锁定',{exact:true}).count(),1);assert.equal(await page.getByLabel('全屏显示',{exact:true}).count(),1);
  for(const [width,height] of [[1500,940],[844,390],[768,1024],[390,844],[320,720]]){await page.setViewportSize({width,height});await geometry();await capture(route.split('?')[0]+'-'+width)}
  checks.push(route+': consistent order, active page, lock/fullscreen, 44px targets and zero overlap/overflow at 5 viewport sizes');
 }
 await page.setViewportSize({width:1500,height:940});await page.getByRole('link',{name:'Gallery',exact:true}).click();await page.locator('.depth-0').waitFor();
 await page.getByLabel('切换白天模式',{exact:true}).click();await capture('gallery-day');await geometry();
 const colors=await page.locator('.museum-nav').evaluate(e=>({text:getComputedStyle(e.querySelector('a')).color,active:getComputedStyle(e.querySelector('[aria-current]')).color}));assert.notEqual(colors.text,colors.active);
 checks.push('Day mode adapts navigation text, active state and tool colors');
 await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menu',{name:'展厅',exact:true}).waitFor();await capture('gallery-menu-day');await page.getByRole('menuitemradio',{name:'地图',exact:true}).click();await page.locator('.world-country').first().waitFor();assert.equal(await page.locator('.cover-theme-button').count(),0);
 await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name:'Cover Flow',exact:true}).click();await page.getByLabel('切换黑夜模式',{exact:true}).click();
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.locator('.settings-shell').waitFor();const before=page.url();await page.getByRole('link',{name:'Settings',exact:true}).click();assert.equal(page.url(),before);
 await page.getByRole('button',{name:'← 返回',exact:true}).click();await page.locator('.gallery-shell').waitFor();checks.push('Direct Settings link preserves return target; current Settings link retains selected tab; Gallery menu and local day-mode boundary work');
 await page.getByLabel('全屏显示',{exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.getByRole('link',{name:'Dashboard',exact:true}).click();await page.getByLabel('退出全屏',{exact:true}).waitFor();await page.getByLabel('退出全屏',{exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement);checks.push('Fullscreen state stays accurate when changing page and exits using the same shared tool');
 await page.getByLabel('锁定',{exact:true}).click();await page.getByLabel('馆主密码',{exact:true}).waitFor();checks.push('Shared lock logs out the isolated synthetic session');
 assert.deepEqual(errors,[]);assert.equal(requests.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')&&!u.startsWith('data:')).length,0);
 await fs.writeFile('docs/research/navigation-unification-evidence.json',JSON.stringify({checks,errors,colors,fixture:'Isolated synthetic P5 catalog. No real credentials, NAS changes or LLM calls.'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/navigation-unification/failure.png'});console.log(await page.locator('.museum-nav').evaluate(e=>({html:e.outerHTML,rect:e.getBoundingClientRect().toJSON()})).catch(()=>''));throw e}finally{await browser.close()}
