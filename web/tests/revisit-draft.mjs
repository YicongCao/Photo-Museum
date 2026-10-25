import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8793';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),requests=[],errors=[],checks=[];
page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
let hidden=null;
async function curate(photo,excluded){return page.evaluate(async({photo,excluded})=>{const r=await fetch('/api/assets/'+photo.id+'/curation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({excluded,pinned:excluded?false:Boolean(photo.pinned)})});if(!r.ok)throw Error('fixture curation failed '+r.status)}, {photo,excluded})}
async function enterDraft(left,right){await page.evaluate(({left,right})=>{sessionStorage.setItem('museum.rooms',JSON.stringify({room:'revisit',states:{revisit:{pair:{title:'合成草稿',confirmed:false,left,right},mode:'side'}}}))},{left,right});await page.reload();await page.locator('.revisit-room').waitFor()}
const persisted=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('museum.rooms')).states.revisit.pair);
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await page.locator('.depth-0').waitFor();
 const photos=await page.evaluate(()=>fetch('/api/exhibitions/photos?limit=2').then(r=>r.json()).then(d=>d.items));assert.equal(photos.length,2);
 const poisoned=photos.map(p=>({...p,preview:'/stale-draft-preview-'+p.id,thumbnail:'/stale-draft-thumb-'+p.id}));
 await enterDraft(poisoned[0],poisoned[1]);await page.locator('.revisit-left img').waitFor();await page.locator('.revisit-right img').waitFor();
 assert.equal(await page.locator('.revisit-left img').getAttribute('src'),photos[0].preview);assert.equal(await page.locator('.revisit-right img').getAttribute('src'),photos[1].preview);
 const kept=await persisted();assert.deepEqual(Object.keys(kept.left).sort(),['id','revision']);assert.deepEqual(Object.keys(kept.right).sort(),['id','revision']);assert.equal(kept.left.revision,photos[0].revision);
 checks.push('Valid draft identities restore from the scoped resolver; session preview URLs and metadata are discarded and storage contains only id/revision per photo');
 hidden=photos[0];await curate(hidden,true);
 await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('museum.rooms')).states.revisit.pair.left===null,null,{timeout:22000});await page.locator('.revisit-right img').waitFor();assert.equal(await page.locator('.revisit-left img').count(),0);
 checks.push('A currently displayed draft revalidates on Gallery refresh and clears a newly hidden photo while preserving the valid side');
 await curate(hidden,false);hidden=null;
 await enterDraft({...poisoned[0],revision:photos[0].revision+'-stale'},poisoned[1]);
 await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('museum.rooms')).states.revisit.pair.left===null);await page.locator('.revisit-right img').waitFor();assert.equal(await page.locator('.revisit-left img').count(),0);
 checks.push('A draft with an old source revision cannot reuse the current photo or its old preview URL');
 const unavailable=route=>route.fulfill({status:503,json:{detail:'测试范围读取失败'}});await page.route('**/api/exhibitions/creative/resolve?**',unavailable);await enterDraft(poisoned[0],poisoned[1]);await page.getByRole('alert').filter({hasText:'测试范围读取失败'}).waitFor();assert.equal(await page.locator('.revisit-comparison img').count(),0);assert.equal((await persisted()).left.id,photos[0].id);await page.unroute('**/api/exhibitions/creative/resolve?**',unavailable);await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();await page.locator('.revisit-left img').waitFor();await page.locator('.revisit-right img').waitFor();checks.push('Resolver failure hides unvalidated previews but preserves identities for a successful retry');
 await page.route('**/api/exhibitions/creative',route=>route.fulfill({json:{total:0,unknown:0,chapters:[],places:[],years:[],groups:[]}}));
 await page.route('**/api/exhibitions/creative/pairs',route=>route.fulfill({json:{items:[]}}));
 await page.route('**/api/exhibitions/creative/resolve?**',route=>route.fulfill({json:{items:[]}}));
 await enterDraft(poisoned[0],poisoned[1]);await page.waitForFunction(()=>{const p=JSON.parse(sessionStorage.getItem('museum.rooms')).states.revisit.pair;return p.left===null&&p.right===null});assert.equal(await page.locator('.revisit-comparison img').count(),0);
 checks.push('An empty scoped catalog and resolver response cannot resurrect either photo from session storage');
 assert.equal(requests.filter(url=>url.includes('/stale-draft-')).length,0);assert.equal(requests.filter(url=>/\/original(?:-compatible)?\?/.test(url)).length,0);assert.deepEqual(errors,[]);
 checks.push('No poisoned preview request, NAS original request or uncaught browser error');
 const evidence={date:new Date().toISOString(),fixture:'Synthetic fixture; hidden-photo API mutation restored. Empty scoped result is injected; backend scope behavior has separate Python coverage.',checks,errors};
 await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE||'docs/research/revisit-draft-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{if(hidden)await curate(hidden,false);await browser.close()}
