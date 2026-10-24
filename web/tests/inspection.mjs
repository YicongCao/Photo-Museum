import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:8793';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1586,height:992}});const page=await context.newPage();
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  window.blobAudit={live:new Set(),max:0,created:0,revoked:0};
  URL.createObjectURL=blob=>{const u=create(blob);const a=window.blobAudit;a.live.add(u);a.created++;a.max=Math.max(a.max,a.live.size);return u};
  URL.revokeObjectURL=u=>{window.blobAudit.live.delete(u);window.blobAudit.revoked++;revoke(u)};
});
try {
 await page.goto(base);await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.getByRole('button',{name:'进入馆务室'}).click();await page.locator('.depth-0 > .photo-mosaic img').first().waitFor();
 const initial=await (await context.request.get(base+'/api/media/state')).json();
 let mock={...initial,active:[],completion_events:[]};
 await page.route('**/api/media/state*',route=>route.fulfill({json:mock}));
 let nasOriginals=0;page.on('request',r=>{if(r.url().includes('/original?'))nasOriginals++});
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByRole('img',{name:'已完成处理目录 7 / 7',exact:true}).waitFor();
 assert.equal(await page.getByText('已索引成片与视频',{exact:true}).count(),0);
 assert.equal(await page.getByText('已连接来源',{exact:true}).count(),0);
 assert.equal(await page.getByText('当前任务阶段',{exact:true}).count(),0);
 assert.equal(await page.locator('.keeper-metrics').innerText().then(t=>t.includes('完整处理文件\n60')),true);
 checks.push('Counters represent fully processed files/directories; static source and format panels removed');
 for (const [i,item] of initial.recent.slice(-3).entries()) {
   mock={...mock,completion_cursor:100+i,completion_events:[{...item,asset_id:item.id,path:'/fixture/'+item.name,completed:true,completion_id:100+i,steps:Object.fromEntries(['download','exif','display','thumb','publish','address','subject','faces','score'].map(s=>[s,'done']))}]};
   await page.waitForFunction(name=>document.querySelector('.inspection-caption strong')?.textContent===name,item.name);
   await page.waitForFunction(()=>document.querySelector('.inspection-image img')?.naturalWidth>0);
   await page.waitForFunction(count=>window.blobAudit.created>=count,i+1);
 }
 assert.equal(nasOriginals,0);assert.ok(await page.locator('.inspection-data').innerText().then(t=>t.includes('1200 × 800')&&t.includes('WebP')));
 let audit=await page.evaluate(()=>({max:blobAudit.max,live:blobAudit.live.size,created:blobAudit.created,revoked:blobAudit.revoked}));
 assert.equal(audit.max,1);assert.equal(audit.live,1);assert.equal(audit.revoked,audit.created-1);
 checks.push('Three sequential decoded photos use local cache, zero NAS originals, at most one live Blob URL');
 await fs.mkdir('docs/design/previews/inspection',{recursive:true});
 await page.screenshot({path:'docs/design/previews/inspection/desktop.png'});
 for (const viewport of [{width:1280,height:720},{width:390,height:844}]) {
   await page.setViewportSize(viewport);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth));
   if(viewport.width<901){
     await page.waitForFunction(()=>blobAudit.live.size===0);
     await page.getByRole('button',{name:'当前照片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.inspection-image img')?.naturalWidth>0);
     assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));
     await page.screenshot({path:'docs/design/previews/inspection/mobile.png'});
     await page.getByRole('button',{name:'关闭当前照片',exact:true}).click();await page.waitForFunction(()=>blobAudit.live.size===0);
   } else await page.screenshot({path:'docs/design/previews/inspection/short-window.png'});
 }
 checks.push('Desktop, 720px and mobile stay one page; mobile inspector opens and releases image on close');
 await page.setViewportSize({width:1586,height:992});await page.waitForFunction(()=>blobAudit.live.size===1);
 const slow=initial.recent.at(-4);
 await page.route('**/inspection-image?**', async route=>{await new Promise(r=>setTimeout(r,1200));try{await route.continue()}catch{}});
 const pending=page.waitForRequest(r=>r.url().includes(`/assets/${slow.id}/inspection-image`));
 mock={...mock,completion_events:[{...slow,asset_id:slow.id,path:'/fixture/'+slow.name,completed:true,completion_id:104,steps:Object.fromEntries(['download','exif','display','thumb','publish','address','subject','faces','score'].map(s=>[s,'done']))}],completion_cursor:104};
 await pending;
 const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().includes(`/assets/${slow.id}/inspection-image`)});
 await page.getByRole('link',{name:'返回 Gallery ↗',exact:true}).click();await page.locator('.depth-0 > .photo-mosaic img').first().waitFor();
 await aborted;
 await page.waitForFunction(()=>blobAudit.live.size===0);checks.push('Leaving management aborts an in-flight image request, revokes final URL and removes image element');
 assert.deepEqual(errors,[]);
 await fs.writeFile('docs/research/inspection-browser-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,audit,errors,scope:'Synthetic fixture. Object URL lifecycle assertions, not a claim that browser GC immediately returns all resident memory.'},null,2));
 console.log(JSON.stringify({checks:checks.length,audit,errors}));
} finally {await browser.close()}
