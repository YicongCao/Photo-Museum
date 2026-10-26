import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base='http://127.0.0.1:8798',out='data/wall-stability/pagination';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),ctx=await browser.newContext({viewport:{width:800,height:1000}}),p=await ctx.newPage(),errors=[],checks=[];let release;
const gate=new Promise(r=>release=r);p.on('pageerror',e=>errors.push(e.message));let catalogueCalls=0;
p.on('request',r=>{if(new URL(r.url()).pathname==='/api/gallery')catalogueCalls++});
try{
 await ctx.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 await p.route('**/api/gallery/*',async route=>{const url=new URL(route.request().url()),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||100);const response=await route.fetch({url:url.origin+url.pathname+'?limit=200'}),data=await response.json();
 const items=Array.from({length:265},(_,i)=>({...data.items[i%data.items.length],id:'pagination-'+i}));if(offset>0)await gate;await route.fulfill({response,json:{...data,items:items.slice(offset,offset+limit),total:265,photos:265,videos:0}}).catch(()=>{});
 });
 await p.goto(base+'/#gallery?room=cover');await p.locator('.depth-0').waitFor();await p.locator('.depth-0').click();await p.locator('.gallery-photo-loading').waitFor();assert.equal(await p.locator('.wall-photo').count(),0);release();await p.locator('.wall-photo').first().waitFor();await p.waitForFunction(()=>document.querySelector('.gallery-shell').getAttribute('aria-busy')==='false');
 await expect(p.locator('.gallery-photo-loading:visible')).toHaveCount(0);checks.push('Complete geometry is staged before entering; no partial-length wall is exposed');
 const before=catalogueCalls;await p.waitForTimeout(15500);assert.equal(catalogueCalls,before);checks.push('Wall does not poll the full cover catalogue every 15 seconds');
 const slider=p.getByRole('slider',{name:'照片流横向位置'});const max=await slider.getAttribute('max');await slider.focus();await slider.press('End');await p.waitForTimeout(500);assert.equal(await slider.getAttribute('max'),max);assert.equal(await p.locator('.wall-scroll-control output').innerText(),'100%');assert.equal(await p.locator('.wall-photo-loading').count(),0);await p.screenshot({path:out+'/complete-edge.png'});checks.push('End remains 100% with stable total length and no additional metadata loader');
 release();await p.locator('.wall-photo-loading').waitFor({state:'detached'});await expect(p.locator('.gallery-caption')).toContainText('265');checks.push('Page completion removes loader and retains photo count');
 await p.getByRole('button',{name:'返回 Gallery',exact:true}).click();await p.locator('.activity-panel').first().waitFor();await expect(p.locator('.gallery-photo-loading:visible')).toHaveCount(0);checks.push('Return animation is not mislabeled as photo loading');
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/browser.json',JSON.stringify({checks,errors},null,2));console.log(checks);
}finally{release();await browser.close()}
