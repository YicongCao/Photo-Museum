import {chromium} from '../../prototype/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=process.env.MUSEUM_BROWSER_BASE||'http://localhost:8793',out=process.env.MUSEUM_BROWSER_OUTPUT||'docs/design/previews/cover-hero';await fs.mkdir(out,{recursive:true});await fs.mkdir('data/cover-hero',{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}}),checks=[],measurements=[],errors=[],requests=[];
let style='framed',ratio=1.5,total=10,expected=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.route('**/api/preferences',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,cover_style:style}})});
await page.route('**/api/gallery',async route=>{
 const response=await route.fetch(),data=await response.json();
 for(const a of data.activities){a.selected=a.selected.slice(0,total);if(a.selected[0])a.selected[0]={...a.selected[0],thumbnail:base+'/synthetic-hero.svg?ratio='+ratio,info:{...a.selected[0].info,width:ratio*900,height:900}}}
 expected=data.activities[0]?.selected.map(p=>p.thumbnail) || [];
 await route.fulfill({response,json:data});
});
// A generated vector fixture with visible edge markers: metadata and intrinsic
// image ratio agree; no private photo is altered or fetched.
await page.route('**/synthetic-hero.svg?**',async route=>{
 const r=Number(new URL(route.request().url()).searchParams.get('ratio')),w=Math.round(r*900),h=900;
 const body=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#35484a"/><circle cx="${w*.77}" cy="170" r="72" fill="#d8ae72"/><path d="M0 900V650L${w*.3} 240 ${w*.6} 700 ${w*.8} 420 ${w} 650V900Z" fill="#263e34"/><rect x="12" y="12" width="${w-24}" height="876" rx="4" fill="none" stroke="#d8ae72" stroke-width="8"/><path d="M0 450H${w}M${w/2} 0V900" stroke="#d8ae72" opacity=".3" stroke-width="3"/></svg>`;
 await route.fulfill({contentType:'image/svg+xml',body});
});
async function loaded(){await page.locator('.depth-0').waitFor();await page.waitForFunction(()=>document.querySelector('.gallery-shell')?.getAttribute('aria-busy')==='false');if(total)await page.waitForFunction(()=>[...document.querySelectorAll('.activity-panel img')].every(p=>p.complete&&p.naturalWidth>0))}
async function geometry(shape){
 const data=await page.locator('.depth-0').evaluate(e=>{
  const front=e.querySelector(':scope>.photo-mosaic'),mirror=e.querySelector('.panel-reflection>.photo-mosaic'),hero=front.querySelector('.cell-0'),box=front.getBoundingClientRect(),r=hero.getBoundingClientRect();
  const cells=[...front.querySelectorAll('.mosaic-cell')].map(c=>{const b=c.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}});
  return {className:front.className,mirrorClass:mirror.className,frontStyle:front.getAttribute('style'),mirrorStyle:mirror.getAttribute('style'),slot:r.width/r.height,source:hero.querySelector('img').naturalWidth/hero.querySelector('img').naturalHeight,heroWidth:r.width,boardWidth:box.width,cells,board:{x:box.x,y:box.y,width:box.width,height:box.height}};
 });
 assert.ok(data.className.includes('hero-'+shape));assert.equal(data.className,data.mirrorClass);assert.equal(data.frontStyle,data.mirrorStyle);
 assert.ok(Math.min(data.slot/data.source,data.source/data.slot)>.90,`${style} ${shape}: source ${data.source}, slot ${data.slot}`);
 if(shape!=='wide')assert.ok(data.slot<2&&data.heroWidth<data.boardWidth*.75,'Non-panoramic hero must not become a full-width ribbon');
 for(const c of data.cells)assert.ok(c.x>=data.board.x-1&&c.y>=data.board.y-1&&c.x+c.width<=data.board.x+data.board.width+1&&c.y+c.height<=data.board.y+data.board.height+1,'All ten cells stay inside the cover');
 for(let i=0;i<data.cells.length;i++)for(let j=i+1;j<data.cells.length;j++){
  const a=data.cells[i],b=data.cells[j];assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<1||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<1,'Mosaic cells must not overlap');
 }
 const ids=await page.locator('.depth-0>.photo-mosaic .mosaic-cell').evaluateAll(es=>es.map(e=>e.querySelector('img')?.getAttribute('src')));
 assert.equal(ids.length,10);assert.deepEqual(ids,expected,'Keep the exact server-ranked Top10 order');
 measurements.push({style,shape,viewport:page.viewportSize(),sourceRatio:data.source,heroRatio:data.slot});
}
try{
 await page.goto(base+'/#gallery');await page.getByLabel('馆主密码',{exact:true}).fill('synthetic-owner-password');await loaded();
 for(style of ['classic','framed','depth','arc'])for(const [r,shape] of [[1.5,'landscape'],[2/3,'portrait'],[1,'square'],[3,'wide']]){
  ratio=r;await page.reload();await loaded();await geometry(shape);
  if(style==='framed'||style==='arc')await page.screenshot({path:out+'/'+style+'-'+shape+'.png'});
 }
 checks.push('All four styles preserve normal, portrait, square and panoramic hero shapes; non-wide photos never use the full-width ribbon');
 checks.push('Actual image intrinsic ratios match synthetic metadata; measured hero crop retains at least 90% in all sixteen desktop combinations');
 checks.push('Every ten-photo layout fits without overlapping cells, and reflection shares exactly the same layout class and parameters');
 style='framed';await page.setViewportSize({width:390,height:844});
 for(const [r,shape] of [[1.5,'landscape'],[2/3,'portrait'],[1,'square'],[3,'wide']]){ratio=r;await page.reload();await loaded();await geometry(shape);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));await page.screenshot({path:out+'/mobile-'+shape+'.png'})}
 checks.push('Phone covers retain the same hero aspect rules and one-page layout');
 ratio=1.5;await page.setViewportSize({width:1500,height:940});
 for(total of [0,1,2,3,7,9]){await page.reload();await loaded();assert.equal(await page.locator('.depth-0>.photo-mosaic .mosaic-cell').count(),total);if(total)assert.ok(await page.locator('.depth-0>.photo-mosaic .cell-0').evaluate(e=>e.clientWidth/e.clientHeight<2))}
 checks.push('Empty and smaller selections keep their real photo counts and do not force a panoramic hero');
 total=10;await page.reload();await loaded();await page.getByRole('button',{name:'切换白天模式',exact:true}).click();await geometry('landscape');await page.screenshot({path:out+'/framed-day.png'});
 checks.push('Day mode preserves the corrected composition');
 assert.equal(requests.filter(u=>/\/original(?:-compatible)?(?:\?|$)/.test(u)).length,0);assert.deepEqual(errors,[]);checks.push('Zero original-file requests and uncaught browser errors');
 await fs.writeFile(process.env.MUSEUM_BROWSER_EVIDENCE||'docs/research/cover-hero-evidence.json',JSON.stringify({date:new Date().toISOString(),checks,errors,measurements,fixture:'Public synthetic SVG hero with intrinsic aspect matching injected metadata; remaining photos use the synthetic catalog. No private NAS images or ranking changes.'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:'data/cover-hero/failure.png'});throw e}finally{await browser.close()}
