import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8795';
const out=process.env.MUSEUM_BROWSER_OUTPUT||'docs/design/previews/gallery-refinement/editorial';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1586,height:992}}),page=await context.newPage(),checks=[],errors=[],requests=[];
await page.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),live=new Set();URL.createObjectURL=blob=>{const url=create(blob);live.add(url);return url};URL.revokeObjectURL=url=>{live.delete(url);revoke(url)};window.editorialLiveBlobs=live});
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
const originals=()=>requests.filter(r=>/\/original(?:-compatible)?\?/.test(r.url)).length;
const pause=()=>page.waitForTimeout(950);
async function room(name){await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name,exact:true}).click();await pause()}
async function capture(name){await page.mouse.move(5,58);await pause();await page.screenshot({path:out+'/'+name+'.png'})}
try{
 await page.goto(base+'/#gallery');
 if(await page.getByLabel('馆主密码',{exact:true}).count()){await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password')}
 await page.locator('.depth-0').waitFor();
 await room('记忆长卷');await page.locator('.memory-chapter').first().waitFor();
 assert.ok(await page.locator('.memory-chapter').count()<=8);assert.equal(originals(),0);checks.push('Scroll mounts only nearby chapters and uses cache previews, with zero original requests');
 await page.getByRole('button',{name:'编排章节',exact:true}).click();const lastChapter=await page.getByLabel('章节',{exact:true}).locator('option').last().getAttribute('value');await page.getByLabel('章节',{exact:true}).selectOption(lastChapter);await pause();assert.equal(await page.getByLabel('章节',{exact:true}).inputValue(),lastChapter);assert.equal(await page.locator('.chapter-active').getAttribute('data-chapter'),lastChapter);await page.getByRole('button',{name:'关闭章节编排',exact:true}).click();await page.locator('.memory-scroll-viewport').focus();await page.locator('.memory-scroll-viewport').press('Home');await pause();await page.locator('.memory-scroll-viewport').press('End');await pause();assert.equal(await page.locator('.chapter-active').getAttribute('data-chapter'),lastChapter);assert.ok(await page.getByRole('button',{name:'下一章节',exact:true}).isDisabled());await page.locator('.memory-scroll-viewport').press('Home');await pause();checks.push('Last chapter remains selected through editor selection and End, without native scroll clamping changing the active chapter');
 await capture('scroll-desktop');
 const first=await page.locator('.chapter-active').getAttribute('data-chapter');await page.getByRole('button',{name:'下一章节',exact:true}).click();await pause();
 assert.notEqual(await page.locator('.chapter-active').getAttribute('data-chapter'),first);checks.push('Chapter button navigates the horizontal editorial layout');
 await page.getByRole('button',{name:'编排章节',exact:true}).click();await page.getByRole('dialog',{name:'编排章节'}).waitFor();
 const reorderedId=await page.getByLabel('章节',{exact:true}).inputValue();
 await page.getByLabel('标题',{exact:true}).fill('合成 · 章节编排验收');
 const thumbs=page.locator('.scroll-editor-images button');await thumbs.first().waitFor();await thumbs.last().click();
 await page.getByRole('button',{name:'章节前移',exact:true}).click();
 await page.getByRole('button',{name:'保存编排',exact:true}).click();await page.getByRole('dialog',{name:'编排章节'}).waitFor({state:'hidden'});
 const savedLayout=await page.evaluate(()=>fetch('/api/exhibitions/creative/scroll').then(r=>r.json()));assert.equal(savedLayout.chapters[0].activity_id,reorderedId);
 await page.reload();await page.locator('.memory-scroll-room').waitFor();await page.getByRole('button',{name:'编排章节',exact:true}).click();await page.getByLabel('章节',{exact:true}).selectOption(reorderedId);
 assert.equal(await page.getByLabel('标题',{exact:true}).inputValue(),'合成 · 章节编排验收');await page.locator('.scroll-editor-images button[aria-pressed=true]').waitFor();assert.equal(await page.locator('.scroll-editor-images button[aria-pressed=true]').count(),1);
 checks.push('Chapter order, title and selected hero persist on server across browser reload');
 await page.getByRole('button',{name:'关闭章节编排',exact:true}).click();
 await page.locator('.chapter-active .memory-chapter-hero').click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();await pause();assert.ok(originals()>0);
 await page.getByRole('button',{name:'返回记忆长卷',exact:true}).click();await page.locator('.memory-scroll-room').waitFor();await pause();checks.push('Scroll photo enters shared darkroom and returns to the retained chapter');
 await room('故地重游');await page.locator('.revisit-comparison img').first().waitFor();
 assert.equal(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/creative/pairs')).length,0);checks.push('City candidates remain unconfirmed and never auto-save pairs');
 await capture('revisit-desktop');
 await page.getByRole('button',{name:'选片',exact:true}).click();await page.getByRole('dialog',{name:'选择对照照片'}).waitFor();await page.locator('.revisit-picker-grid button').nth(1).waitFor();
 await page.locator('.revisit-picker-pair button').first().click();await page.locator('.revisit-picker-grid button').first().click();await page.locator('.revisit-picker-grid button').nth(1).click();
 await page.getByLabel('名称',{exact:true}).fill('合成 · 同地点确认');
 await page.getByRole('dialog',{name:'选择对照照片'}).getByRole('button',{name:'确认同地点并保存',exact:true}).click();await page.getByRole('dialog',{name:'选择对照照片'}).waitFor({state:'hidden'});
 await page.getByText('已确认同地点',{exact:true}).waitFor();await page.reload();await page.getByText('已确认同地点',{exact:true}).waitFor();assert.ok(await page.locator('.revisit-caption').getByText('合成 · 同地点确认',{exact:true}).isVisible());checks.push('Manual photo choice requires explicit confirmation and survives reload');
 await page.getByRole('button',{name:'滑动',exact:true}).click();await page.getByLabel('照片对照分界',{exact:true}).fill('37.2');assert.equal(await page.getByLabel('照片对照分界',{exact:true}).inputValue(),'37.2');
 assert.ok((await page.locator('.revisit-right').getAttribute('style')).includes('37.2%'));await capture('revisit-wipe');
 await page.getByRole('button',{name:'叠化',exact:true}).click();await page.getByLabel('叠化比例',{exact:true}).fill('64');assert.ok((await page.locator('.revisit-right').getAttribute('style')).includes('0.64'));
 assert.ok(await page.locator('.revisit-image img').evaluateAll(imgs=>imgs.every(img=>getComputedStyle(img).objectFit==='contain')));checks.push('Wipe and blend controls retain original aspect ratio without image stretching');
 for(let i=0;i<3;i++){
  await page.locator('.gallery-shell[aria-busy="false"]').waitFor();await page.getByRole('button',{name:'查看左侧照片详情',exact:true}).click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();
  assert.ok(await page.evaluate(()=>document.getAnimations().some(a=>a.playState==='running'&&(a.effect?.target?.closest?.('.viewer-image-area')||a.effect?.target?.matches?.('[data-scene-clone]')))),'Return regression must interrupt a live entry animation');
  await page.getByRole('button',{name:'返回故地重游',exact:true}).click();await page.getByRole('dialog',{name:'照片细看'}).waitFor({state:'hidden'});await page.locator('.revisit-room').waitFor();await page.locator('.gallery-shell[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('[data-scene-clone]').count(),0);assert.equal(await page.evaluate(()=>window.editorialLiveBlobs.size),0);
 }
 checks.push('Three immediate returns interrupt active photo entry animations, restore the pair and release every scene clone and Blob URL');
 await page.getByRole('button',{name:'查看左侧照片详情',exact:true}).click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();await page.getByRole('button',{name:'返回故地重游',exact:true}).click();await page.getByRole('dialog',{name:'照片细看'}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('menuitemradio',{name:'记忆长卷',exact:true}).click();await page.locator('.memory-scroll-room').waitFor();await page.locator('.gallery-shell[aria-busy="false"]').waitFor();assert.equal(await page.locator('[data-scene-clone]').count(),0);checks.push('Immediate room navigation after return waits for the inverse transition and reaches the requested room');
 await page.locator('.chapter-active .memory-chapter-hero').click();await page.getByRole('dialog',{name:'照片细看'}).waitFor();await page.evaluate(()=>{location.hash='manage'});await page.locator('.keeper-shell').waitFor();await page.waitForTimeout(180);assert.equal(await page.locator('[data-scene-clone]').count(),0);assert.equal(await page.evaluate(()=>window.editorialLiveBlobs.size),0);await page.evaluate(()=>{location.hash='gallery'});await page.locator('.memory-scroll-room').waitFor();checks.push('Leaving Gallery mid-entry unmounts animations and releases cloned images and Blob URLs');
 for(const size of [{width:390,height:720},{width:1280,height:640}]){
  await page.setViewportSize(size);
  for(const name of ['记忆长卷','故地重游']){await room(name);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));if(name==='记忆长卷')assert.ok(await page.locator('.scroll-current strong').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}));await capture(name+'-'+size.width)}
 }
 checks.push('Both rooms stay within mobile and short desktop viewports');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.revisit-comparison').evaluate(el=>getComputedStyle(el).animationName),'none');await room('记忆长卷');assert.equal(await page.locator('.memory-chapter').first().evaluate(el=>getComputedStyle(el).animationName),'none');checks.push('Reduced-motion disables entry animations');
 assert.equal(requests.filter(r=>!r.url.startsWith(base)&&!r.url.startsWith('blob:')).length,0);assert.deepEqual(errors,[]);checks.push('No external requests or uncaught browser errors');
 const evidence={date:new Date().toISOString(),fixture:'Synthetic local fixture only; no real photo or subjective aesthetic acceptance',checks,errors};await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE||'docs/research/creative-editorial-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error(await page.locator('body').innerText());throw e}finally{await browser.close()}
