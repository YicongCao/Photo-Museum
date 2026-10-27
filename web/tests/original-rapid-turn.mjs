import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';

const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.route('**/api/preferences',async r=>{const response=await r.fetch();await r.fulfill({response,json:{...await response.json(),original_loading:'auto'}})});
 await page.addInitScript(()=>{
  const real=window.fetch.bind(window);window.originalStarts=[];window.originalAborts=[];
  window.fetch=(url,options={})=>{
   if(/\/original(?:-compatible)?\?/.test(String(url))){
    const value=String(url);window.originalStarts.push(value);
    return new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>real(url,options).then(resolve,reject),1800);
     options.signal?.addEventListener('abort',()=>{clearTimeout(timer);window.originalAborts.push(value);reject(new DOMException('cancelled','AbortError'))},{once:true});
    });
   }
   return real(url,options);
  };
 });
 await page.goto('http://localhost:8798/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');
 await page.locator('.depth-0').waitFor();await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
 await page.locator('.wall-photo').first().click();await page.locator('.viewer-filmstrip').waitFor();
 await page.waitForFunction(()=>window.originalStarts.length===1);
 for(let i=0;i<3;i++){
  await page.getByRole('button',{name:'下一张照片',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');
 }
 await page.waitForFunction(()=>window.originalStarts.length===2);
 assert.equal(await page.evaluate(()=>window.originalAborts.length),1);
 assert.equal(await page.evaluate(()=>window.originalStarts.length),2);
 await expect(page.locator('.photo-viewer')).not.toContainText('原图转换忙');
 await expect(page.locator('.image-stack .original-layer')).toBeVisible({timeout:10000});
 await expect(page.locator('.photo-viewer')).not.toContainText('原图转换忙');
 assert.deepEqual(errors,[]);console.log('Rapid turns abort the first request; intermediate photos start no original requests; final photo loads successfully.');
}finally{await browser.close()}
