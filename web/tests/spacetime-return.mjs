import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const base='http://127.0.0.1:8798',out='data/spacetime-return';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext(),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{
 const animate=Element.prototype.animate;window.boardMotions=[];
 Element.prototype.animate=function(frames,options){
  if(this.matches('.spacetime-board'))window.boardMotions.push({frames,options,width:this.offsetWidth,roomWidth:this.closest('.spacetime-room').clientWidth,roomHeight:this.closest('.spacetime-room').clientHeight});
  return animate.call(this,frames,options);
 };
 window.sampleReturn=()=>{window.samples=[];const until=performance.now()+1500;const tick=()=>{const e=document.querySelector('.space-current');if(e){const r=e.getBoundingClientRect();window.samples.push({t:performance.now(),x:r.x,y:r.y,w:r.width,id:e.dataset.activity})}if(performance.now()<until)requestAnimationFrame(tick)};requestAnimationFrame(tick)};
});
try{
 await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 for(const [w,h] of [[1600,900],[390,844],[844,390]]){
  await page.setViewportSize({width:w,height:h});await page.goto('about:blank');await page.goto(base+'/#gallery?room=space');await page.locator('.space-current').waitFor();await page.waitForTimeout(650);
  const slider=page.getByRole('slider',{name:'时空隧道位置'});await slider.focus();await slider.press('Home');await expect(slider).toHaveValue('0');await page.waitForTimeout(650);await slider.press('ArrowRight');await expect(slider).toHaveValue('1');await page.waitForTimeout(650);
  const before=await page.locator('.space-current').evaluate(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.activity,x:r.x,y:r.y,w:r.width}});
  for(const back of ['button','history']){
   await page.locator('.space-current').click();await page.locator('.wall-photo').first().waitFor();await page.waitForTimeout(1200);
   await page.evaluate(()=>{window.boardMotions=[];window.sampleReturn()});
   if(back==='button')await page.getByRole('button',{name:'返回 时空隧道',exact:true}).click();else await page.goBack();
   await page.waitForTimeout(1600);
   const proof=await page.evaluate(()=>({motions:window.boardMotions,samples:window.samples}));
   assert.ok(proof.motions.length>0,'return animates tunnel boards');
   for(const m of proof.motions){assert.ok(m.frames.every(f=>!('transform'in f)),'return must preserve perspective transform');const expected=Math.min(m.roomWidth*(m.roomWidth<700?.75:.51),m.roomHeight*.99,820);assert.ok(Math.abs(m.width-expected)<1,'geometry measured before animation');}
   const after=await page.locator('.space-current').evaluate(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.activity,x:r.x,y:r.y,w:r.width}});
   assert.equal(after.id,before.id);for(const k of ['x','y','w'])assert.ok(Math.abs(after[k]-before[k])<1,'restored '+k);
   // Final frames include animation cleanup: there must be no snap back to layout.
   const late=proof.samples.filter(s=>s.t>proof.samples[0].t+700);for(let i=1;i<late.length;i++)assert.ok(Math.hypot(late[i].x-late[i-1].x,late[i].y-late[i-1].y)<3,'no final-frame teleport');
   checks.push(`${w}x${h} ${back}: perspective, mount geometry, activity and final-frame continuity`);
  }
  await page.screenshot({path:`${out}/return-${w}.png`});
 }
 // Reverse while incoming boards are still animating, then return again.
 await page.locator('.space-current').click();await page.locator('.wall-photo').first().waitFor();await page.waitForTimeout(1200);await page.goBack();await page.locator('.space-current').waitFor();await page.waitForTimeout(100);await page.goForward();await page.locator('.wall-photo').first().waitFor();await page.waitForTimeout(1200);await page.goBack();await page.locator('.space-current').waitFor();await page.waitForTimeout(1200);
 assert.equal(await page.locator('.spacetime-board').evaluateAll(es=>es.flatMap(e=>e.getAnimations()).length),0);assert.equal(await page.locator('[data-scene-clone]').count(),0);checks.push('interrupted Back/Forward cleans animations and clones');
 await page.goto('about:blank');await page.goto(base+'/#gallery?room=cover');await page.locator('.depth-0').waitFor();await page.waitForTimeout(650);const coverId=await page.locator('.depth-0').getAttribute('data-activity');await page.locator('.depth-0').click();await page.locator('.wall-photo').first().waitFor();await page.waitForTimeout(1200);await page.goBack();await page.locator('.depth-0').waitFor();await page.waitForTimeout(1200);assert.equal(await page.locator('.depth-0').getAttribute('data-activity'),coverId);checks.push('Cover Flow return retains selection');
 await page.goto('about:blank');await page.goto(base+'/#gallery?room=space');await page.locator('.space-current').waitFor();await page.waitForTimeout(650);
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.space-current').click();await page.locator('.wall-photo').first().waitFor();await page.getByRole('button',{name:'返回 时空隧道',exact:true}).click();await page.locator('.space-current').waitFor();assert.equal(await page.locator('.space-current').evaluate(e=>e.getAnimations().length),0);checks.push('reduced motion returns immediately');
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/evidence.json',JSON.stringify({checks,errors},null,2));console.log(checks);
}finally{await browser.close()}
