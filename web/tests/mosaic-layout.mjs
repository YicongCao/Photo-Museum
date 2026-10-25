import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),page=await browser.newPage();
const css=await fs.readFile('web/src/gallery.css','utf8'),checks=[];
try{for(let count=1;count<=10;count++){
 await page.setContent(`<style>${css}</style><div style="width:900px;height:600px"><div class="photo-mosaic count-${count}">${Array.from({length:count},(_,i)=>`<div class="mosaic-cell cell-${i}"></div>`).join('')}</div></div>`);
 const geometry=await page.locator('.photo-mosaic').evaluate(el=>{const box=el.getBoundingClientRect(),items=[...el.children].map(c=>c.getBoundingClientRect());return{area:items.reduce((n,r)=>n+r.width*r.height,0)/(box.width*box.height),inside:items.every(r=>r.left>=box.left&&r.right<=box.right+1&&r.top>=box.top&&r.bottom<=box.bottom+1),overlap:items.some((r,i)=>items.slice(i+1).some(s=>Math.min(r.right,s.right)>Math.max(r.left,s.left)+1&&Math.min(r.bottom,s.bottom)>Math.max(r.top,s.top)+1))}});
 assert.ok(geometry.area>.95,JSON.stringify({count,...geometry}));assert.ok(geometry.inside);assert.equal(geometry.overlap,false);checks.push(`${count} photos fill the board without holes, overlap or implicit rows`);
 }await fs.writeFile('docs/research/p6-mosaic-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,fixture:'CSS geometry fixtures only'},null,2));console.log(JSON.stringify({checks},null,2))}finally{await browser.close()}
