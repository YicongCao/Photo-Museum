import {test} from 'node:test';import assert from 'node:assert/strict';
import {randomCoverIndex,coverPreviewSources,prepareCover} from '../src/random-cover.js';
test('random choice excludes current and handles empty/single catalogue',()=>{
 for(let i=0;i<12;i++)for(let n=0;n<100;n++){const j=randomCoverIndex(12,i,()=>n/100);assert.notEqual(i,j);assert.ok(j>=0&&j<12)}assert.equal(randomCoverIndex(1,0),0);
});
test('landing window warms symmetric cyclic neighbours and deduplicates thumbnails',()=>{
 const items=Array.from({length:20},(_,i)=>({selected:[{thumbnail:'thumb-'+i},{thumbnail:'shared'}]}));
 const urls=coverPreviewSources(items,0,1600,900);assert.equal(urls.length,10);assert.ok(urls.includes('thumb-16')&&urls.includes('thumb-4'));assert.ok(!urls.includes('thumb-5'));
 const space=coverPreviewSources(items,0,1600,900,'space');assert.ok(space.includes('thumb-8'));assert.ok(!space.includes('thumb-19'));
});
test('bounded six decodes, wait for every image and release sources',async()=>{
 let running=0,max=0,removed=0;const job=prepareCover(Array.from({length:20},(_,i)=>''+i),{imageFactory:()=>({removeAttribute(){removed++},async decode(){max=Math.max(max,++running);await new Promise(r=>setTimeout(r,3));running--}})});
 await job.promise;assert.equal(max,6);assert.equal(removed,0);job.dispose();assert.equal(removed,20);
});
test('cancel and decode failure release all staged images',async()=>{
 let removed=0;const job=prepareCover(['a','b'],{imageFactory:()=>({removeAttribute(){removed++},decode:()=>new Promise(()=>{})})});job.dispose();await assert.rejects(job.promise,{name:'AbortError'});assert.equal(removed,2);
 const bad=prepareCover(['broken'],{imageFactory:()=>({removeAttribute(){removed++},decode:()=>Promise.reject(Error('bad image'))})});await assert.rejects(bad.promise,/bad image/);assert.equal(removed,3);
});
test('timeout does not leave a pending loader',async()=>{const job=prepareCover(['slow'],{timeout:5,imageFactory:()=>({removeAttribute(){},decode:()=>new Promise(()=>{})})});await assert.rejects(job.promise,/timeout/)});
