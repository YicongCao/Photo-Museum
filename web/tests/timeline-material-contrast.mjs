import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';import bundle from '../../prototype/node_modules/playwright-core/lib/utilsBundle.js';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base='http://localhost:8793',browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage({viewport:{width:1500,height:940}}),checks=[];
const white=bundle.PNG.sync.write({width:2,height:2,data:Buffer.alloc(16,255)});
function luminance(rgb){const c=rgb.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
async function measure(){
 const frame=await page.locator('.timeline-glass-frame').boundingBox();
 const labels=await page.locator('.dock-timeline .dock-label').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {color:getComputedStyle(e.closest('h2,h3,button')).color,x:r.x,y:r.y,w:r.width,h:r.height}}));
 const hide=await page.addStyleTag({content:'.dock-timeline .dock-label{visibility:hidden!important}'});const png=bundle.PNG.sync.read(await page.locator('.timeline-glass-frame').screenshot());await hide.evaluate(e=>e.remove());
 let minimum=100;
 for(const r of labels){if(r.y<frame.y+3||r.y+r.h>frame.y+frame.height-3)continue;const fg=luminance(r.color.match(/[\d.]+/g).slice(0,3).map(Number));
  for(let y=Math.max(3,Math.ceil(r.y-frame.y)+2);y<Math.min(png.height-3,r.y-frame.y+r.h-2);y+=3)for(let x=Math.max(3,Math.ceil(r.x-frame.x)+2);x<Math.min(png.width-3,r.x-frame.x+r.w-2);x+=3){const k=(y*png.width+x)*4,bg=luminance([png.data[k],png.data[k+1],png.data[k+2]]);minimum=Math.min(minimum,(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05))}
 }return minimum;
}
try{
 await page.route('**/media/thumb?**',r=>r.fulfill({body:white,contentType:'image/png'}));await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();await page.waitForFunction(()=>document.querySelector('.timeline-ambient img')?.naturalWidth===2);await page.waitForTimeout(400);
 const night=await measure();await page.getByLabel('切换白天模式',{exact:true}).click();const day=await measure();assert.ok(night>=4.5&&day>=4.5,JSON.stringify({night,day}));checks.push('Year, month, events and selected row all retain at least 4.5:1 against the rendered material with an entirely white source thumbnail');
 await page.getByLabel('切换黑夜模式',{exact:true}).click();await page.route('**/media/thumb?**',r=>r.fulfill({status:404,body:'No local thumbnail'}));await page.locator('.dock-timeline').getByRole('button',{name:'城市漫步',exact:true}).click();await page.waitForTimeout(500);assert.equal(await page.locator('.timeline-ambient img').count(),0);const fallback=await measure();assert.ok(fallback>=4.5);checks.push('Missing cached thumbnail retains the mineral fallback surface and readable text, without original fallback');
 await fs.writeFile('docs/research/timeline-material-contrast.json',JSON.stringify({checks,night,day,fallback,method:'Measured foreground computed RGB against underlying rendered pixels in each label area after hiding only label contents; synthetic all-white source stresses maximum photo brightness.'},null,2));console.log(JSON.stringify({checks,night,day,fallback},null,2));
}finally{await browser.close()}
