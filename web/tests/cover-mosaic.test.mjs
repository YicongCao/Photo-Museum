import test from 'node:test';import assert from 'node:assert/strict';
import {planCoverMosaic} from '../src/cover-mosaic.js';
const photos=ratio=>Array.from({length:10},(_,i)=>({id:String(i),score:100-i,info:{width:ratio*1000,height:1000}}));
test('Normal, portrait and square heroes never use the panoramic template',()=>{
 for(const aspect of [1.5,1.72])for(const [ratio,shape] of [[2/3,'portrait'],[.8,'portrait'],[1,'square'],[1.1,'square'],[1.5,'landscape'],[1.8,'landscape'],[3,'wide']]){
  const input=photos(ratio),before=JSON.stringify(input),plan=planCoverMosaic(input,aspect);
  assert.ok(plan.className.endsWith('hero-'+shape));assert.equal(JSON.stringify(input),before);
  let slot;
  if(shape==='portrait')slot=parseFloat(plan.style['--cover-hero-width'])/100*aspect;
  else{const row=parseFloat(plan.style['--cover-hero-row']),rows=shape==='square'?3:2,remainder=shape==='wide'?2:1,height=rows*row/(rows*row+remainder);slot=aspect*(shape==='wide'?1:shape==='square'?.5:.6)/height}
  assert.ok(Math.min(slot/ratio,ratio/slot)>.95,`${aspect} hero ${ratio} into ${slot}`);
 }
});
test('Missing or invalid dimensions choose the safe landscape layout without fabricating a panorama',()=>{
 for(const info of [{},{width:0,height:10},{width:Infinity,height:3},{width:100,height:NaN}])assert.ok(planCoverMosaic([{info}],1.5).className.endsWith('hero-landscape'));
 assert.ok(planCoverMosaic([]).className.includes('count-0'));assert.ok(planCoverMosaic(photos(1.5).slice(0,3)).className.includes('count-3'));
});
