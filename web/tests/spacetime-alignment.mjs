import {chromium,expect} from '../../prototype/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const base='http://127.0.0.1:8798',out='data/spacetime-alignment';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const title=()=>page.locator('.gallery-caption').evaluate(el=>{const h=getComputedStyle(el.querySelector('h1')),d=getComputedStyle(el.querySelector('.caption-date')),r=el.getBoundingClientRect();return {font:h.font,color:h.color,spacing:h.letterSpacing,dateFont:d.font,dateColor:d.color,center:r.x+r.width/2,after:getComputedStyle(el,'::after').content}});
const loaded=()=>page.waitForFunction(()=>[...document.querySelectorAll('.space-current>.photo-mosaic img')].length>0&&[...document.querySelectorAll('.space-current>.photo-mosaic img')].every(i=>i.complete&&i.naturalWidth));
try{
 await context.request.post(base+'/api/login',{headers:{Origin:base},data:{password:'synthetic-owner-password'}});
 for(const [w,h] of [[1600,900],[390,844],[844,390]]){
  await page.setViewportSize({width:w,height:h});await page.goto('about:blank');await page.goto(base+'/#gallery?room=cover');await page.locator('.depth-0').waitFor();const cover=await title();
  await page.goto('about:blank');await page.goto(base+'/#gallery?room=space');await loaded();const space=await title();
  for(const key of ['font','color','spacing','dateFont','dateColor'])assert.equal(space[key],cover[key],key);
  assert.ok(Math.abs(space.center-w/2)<1);assert.ok(['none','normal'].includes(space.after));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth));
  const slider=page.getByRole('slider',{name:'时空隧道位置'});await slider.focus();await slider.press('Home');await expect(slider).toHaveValue('0');await slider.press('ArrowRight');await expect(slider).toHaveValue('1');
  const geometry=await page.evaluate(()=>{const s=document.querySelector('.spacetime-position'),r=s.getBoundingClientRect(),c=document.querySelector('.gallery-caption').getBoundingClientRect(),input=s.querySelector('input').getBoundingClientRect();return {clear:getComputedStyle(s).backgroundColor,overlap:r.top<c.bottom,hit:document.elementFromPoint(input.x+input.width/2,input.y+input.height/2)?.tagName}});
  assert.equal(geometry.clear,'rgba(0, 0, 0, 0)');assert.equal(geometry.overlap,false);assert.equal(geometry.hit,'INPUT');
  // Focus exposes the same explicit keyboard/touch entry at every viewport size.
  const toggle=page.locator('.timeline-toggle');await toggle.focus();await toggle.press('Enter');await expect(page.locator('.timeline-drawer')).toHaveClass(/is-open/);
  await page.waitForTimeout(450);
  assert.notEqual(await page.locator('.timeline-glass-frame').evaluate(e=>getComputedStyle(e).backdropFilter),'none');
  assert.equal(await page.locator('.timeline-year').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  const b=await page.locator('.timeline-drawer').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=w&&b.y>=0&&b.y+b.height<=h);
  await page.screenshot({path:`${out}/space-${w}.png`});await page.keyboard.press('Escape');await expect(page.locator('.timeline-drawer')).toHaveClass(/is-closed/);
  checks.push(`${w}x${h}: matching caption, no underline, clear usable slider, glass drawer and no page overflow`);
 }
 await page.setViewportSize({width:1600,height:900});await page.mouse.move(1580,35);await page.waitForTimeout(300);await expect(page.locator('.timeline-drawer')).toHaveClass(/is-closed/);
 await page.mouse.move(1400,400);await expect(page.locator('.timeline-drawer')).toHaveClass(/is-open/);
 await page.getByRole('button',{name:'Gallery',exact:true}).click();await expect(page.locator('.timeline-drawer')).toHaveClass(/is-closed/);assert.ok(await page.locator('.timeline-toggle').isDisabled());await page.keyboard.press('Escape');
 checks.push('Navigation does not open the drawer; room menu suspends automatic reveal');
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.timeline-toggle').focus();await page.locator('.timeline-toggle').press('Enter');assert.equal(await page.locator('.timeline-drawer').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 checks.push('Reduced motion disables drawer animation');assert.deepEqual(errors,[]);assert.equal(requests.filter(u=>/\/original(?:-compatible)?\?/.test(u)).length,0);
 await fs.writeFile(out+'/evidence.json',JSON.stringify({checks,errors},null,2));console.log(checks);
}finally{await browser.close()}
