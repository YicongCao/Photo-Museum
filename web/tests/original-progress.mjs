import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://127.0.0.1:8798',out='data/original-progress';
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];
async function scene({unknown=false,fail=false,compatible=false,reduced=false}={}){
 const c=await browser.newContext({viewport:{width:1500,height:940},reducedMotion:reduced?'reduce':'no-preference'}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 await c.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 await p.route('**/api/preferences',async r=>{const response=await r.fetch();await r.fulfill({response,json:{...await response.json(),original_loading:'on_demand'}})});
 await p.route('**/manifest',async r=>{const response=await r.fetch(),m=await response.json();await r.fulfill({response,json:{...m,original_compatible:compatible?m.original.replace('/original?','/original-compatible?'):null}})});
 await p.addInitScript(({unknown,fail,compatible})=>{
  const real=window.fetch.bind(window);window.finishTransfer=false;window.cancelledTransfer=false;window.litHistory=[];window.progressFade=null;
  new MutationObserver(()=>{const n=document.querySelector('.original-progress');if(n){if(n.classList.contains('dismiss'))window.progressFade=getComputedStyle(n).transitionDuration;const v=Number(n.dataset.lit);if(window.litHistory.at(-1)!==v)window.litHistory.push(v)}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-lit','class']});
  window.fetch=async(input,options)=>{
   const url=String(input);
   if(url.includes('/original-progress?'))return new Response(JSON.stringify({stage:'download',done:650,total:1000}),{headers:{'Content-Type':'application/json'}});
   if(!/\/original(?:-compatible)?\?/.test(url))return real(input,options);
   if(compatible)await new Promise(r=>setTimeout(r,850));
   const response=await real(url.replace('/original-compatible?','/original?'),options);if(!response.ok)return response;
   const bytes=new Uint8Array(await response.arrayBuffer()),headers={'Content-Type':response.headers.get('content-type')};if(!unknown)headers['Content-Length']=String(bytes.length);
   let offset=0;
   return new Response(new ReadableStream({async pull(controller){
    if(offset>=bytes.length){controller.close();return}
    if(offset>0){while(!window.finishTransfer){if(options.signal.aborted)return;await new Promise(r=>setTimeout(r,20))}}
    if(fail&&offset){controller.error(Error('synthetic transfer interruption'));return}
    const end=offset?bytes.length:Math.floor(bytes.length*.65);controller.enqueue(bytes.slice(offset,end));offset=end;
   },cancel(){window.cancelledTransfer=true}}),{headers});
  };
 },{unknown,fail,compatible});
 await p.goto(base+'/#gallery');await p.locator('.depth-0').waitFor();await p.locator('.depth-0').click();await p.locator('.wall-photo').first().waitFor();await p.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');await p.locator('.wall-photo').first().click();await p.getByRole('button',{name:'加载原图',exact:true}).waitFor();await p.getByRole('button',{name:'加载原图',exact:true}).click();
 return {c,p};
}
try{
 let {c,p}=await scene();await p.waitForFunction(()=>Number(document.querySelector('.original-progress')?.dataset.percent)>=60);await p.screenshot({path:out+'/download-desktop.png'});
 assert.ok(await p.locator('.preview-layer').evaluate(n=>n.naturalWidth>0));assert.equal(await p.locator('.viewer-bottom .photo-loading').count(),0);await p.getByRole('button',{name:'照片档案',exact:true}).click();assert.ok((await p.locator('.viewer-image-area').boundingBox()).width>=1498);await p.getByRole('button',{name:'照片档案',exact:true}).click();
 for(const size of [{width:390,height:844},{width:844,height:390}]){await p.setViewportSize(size);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));const b=await p.getByRole('progressbar',{name:'原图读取进度'}).boundingBox();await p.screenshot({path:out+"/layout-"+size.width+".png"});assert.ok(b.width>100&&b.y+b.height<=size.height,JSON.stringify({size,b,css:await p.locator(".viewer-bottom").evaluate(n=>[n,...n.querySelectorAll(".original-progress,.original-progress-labels,.original-progress-stage,.original-progress-percent")].map(e=>({c:e.className,h:e.getBoundingClientRect().height,y:e.getBoundingClientRect().y,g:getComputedStyle(e).gap,p:getComputedStyle(e).padding,l:getComputedStyle(e).lineHeight})))}));await p.screenshot({path:out+'/download-'+size.width+'.png'})}
 await p.evaluate(()=>window.finishTransfer=true);await p.waitForFunction(()=>document.querySelector('.original-progress')?.dataset.lit==='160');await p.locator('.original-layer').waitFor();
 const history=await p.evaluate(()=>window.litHistory);assert.equal(history[0],0);assert.equal(history.at(-1),160);assert.ok(history.every((n,i)=>!i||n-history[i-1]===1),JSON.stringify(history));checks.push('Real stream reader drives 0→100, every rendered bar increases by exactly one despite a 65% chunk jump; 4K remains visible and original is decoded');
 await p.locator('.original-progress').waitFor({state:'detached'});assert.ok((await p.evaluate(()=>window.progressFade))?.includes('0.28')); await expect(p.locator('.original-progress-done')).toBeVisible();checks.push('Completed bars briefly hold at 100 then fade and retire; original remains visible');
 checks.push('Desktop, phone and short landscape footer stays in one page and leaves controls clickable');await c.close();
 ({c,p}=await scene({unknown:true}));await p.waitForFunction(()=>document.querySelector('.original-progress-labels')?.textContent.includes('KB'));assert.equal(await p.getByRole('progressbar').getAttribute('aria-valuenow'),null);assert.equal(await p.locator('.original-progress').getAttribute('data-lit'),'0');await p.getByRole('button',{name:'返回照片墙',exact:true}).click();await p.waitForFunction(()=>window.cancelledTransfer);assert.equal(await p.locator('.original-progress').count(),0);checks.push('Unknown length reports received bytes without fake percentage; leaving cancels stream and removes progress');await c.close();
 ({c,p}=await scene({fail:true}));await p.waitForFunction(()=>Number(document.querySelector('.original-progress')?.dataset.lit)>10);await p.evaluate(()=>window.finishTransfer=true);await p.locator('.original-progress.failed').waitFor();const stopped=await p.locator('.original-progress').getAttribute('data-lit');await p.waitForTimeout(150);assert.equal(await p.locator('.original-progress').getAttribute('data-lit'),stopped);await expect(p.getByRole('button',{name:'重新读取原图',exact:true})).toBeVisible();checks.push('Interrupted transfer freezes the bars, keeps 4K and offers retry instead of false completion');await c.close();
 ({c,p}=await scene({compatible:true,reduced:true}));await p.waitForFunction(()=>document.querySelector('.original-progress')?.dataset.percent==='58');await p.waitForFunction(()=>Number(document.querySelector('.original-progress')?.dataset.percent)>=95);await p.evaluate(()=>window.finishTransfer=true);await p.locator('.original-progress-done').waitFor();assert.equal(await p.locator('.original-progress').count(),0);checks.push('Compatible path joins server NAS-byte progress to browser delivery/decode; reduced motion follows actual targets directly');await c.close();
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/browser.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
