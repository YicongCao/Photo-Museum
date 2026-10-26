import {test} from 'node:test';import assert from 'node:assert/strict';
import {completeWallCatalogue} from '../src/wall-catalogue.mjs';import {createPromotionQueue} from '../src/preview-promotion.mjs';
const data=Array.from({length:688},(_,i)=>({id:String(i)}));
test('All ordered metadata is staged; filtered endpoint preserved and no media requests',async()=>{
 const calls=[],signal=new AbortController().signal;
 const result=await completeWallCatalogue(async(url,method,body,opts)=>{const u=new URL(url,'http://local');calls.push(url);assert.equal(u.pathname,'/exhibitions/photos');assert.equal(u.searchParams.get('place'),'abc');assert.equal(opts.signal,signal);const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));return {items:data.slice(offset,offset+limit),total:688}},'/exhibitions/photos?place=abc&sort=time&limit=15',{items:data.slice(0,15),total:688},signal);
 assert.deepEqual(result.items,data);assert.equal(calls.length,4);
});
test('Server may return fewer than requested without skipping entries',async()=>{let offset=1;const result=await completeWallCatalogue(async()=>({items:data.slice(offset,++offset),total:4}),'/gallery/a',{items:data.slice(0,1),total:4});assert.deepEqual(result.items,data.slice(0,4))});
test('Changed counts, duplicate IDs and empty pages reject unstable geometry',async()=>{for(const page of [{items:[],total:4},{items:[data[0]],total:4},{items:[data[1]],total:5}])await assert.rejects(completeWallCatalogue(async()=>page,'/gallery/a',{items:[data[0]],total:4}))});
test('Cancelled collection does not publish stale items',async()=>{const c=new AbortController();await assert.rejects(completeWallCatalogue(async()=>{c.abort();return {items:[data[1]],total:2}},'/gallery/a',{items:[data[0]],total:2},c.signal),{name:'AbortError'})});
test('Complete catalogue does not request again',async()=>{await completeWallCatalogue(()=>{throw Error('Unexpected request')},'/gallery/a',{items:data,total:688})});
test('Only two decode/paint promotions run; releasing allows next and cancelled waiters disappear',async()=>{const q=createPromotionQueue(),started=[];const a=q.acquire(()=>started.push('a')),b=q.acquire(()=>started.push('b')),c=q.acquire(()=>started.push('c')),d=q.acquire(()=>started.push('d'));await Promise.resolve();assert.deepEqual(started,['a','b']);c();a();assert.deepEqual(started,['a','b','d']);a();b();d()});
