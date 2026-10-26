import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiveOriginal} from '../src/original-transfer.mjs';
test('counts actual streamed bytes, supports unknown length, retains image content',async()=>{
 for(const known of [true,false]){
  const chunks=[new Uint8Array([1,2]),new Uint8Array([3,4,5])],events=[];
  const response=new Response(new ReadableStream({pull(c){chunks.length?c.enqueue(chunks.shift()):c.close()}}),{headers:{'content-type':'image/jpeg',...(known?{'content-length':'5'}:{})}});
  const blob=await receiveOriginal(response,new AbortController().signal,(done,total)=>events.push([done,total]));
  assert.deepEqual(events,[[0,known?5:null],[2,known?5:null],[5,known?5:null]]);
  assert.equal(blob.type,'image/jpeg');assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[1,2,3,4,5]);
 }
});
test('abort cancels the stream and never returns an incomplete original',async()=>{
 const c=new AbortController();let cancelled=false;
 const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]))},cancel(){cancelled=true}}));
 await assert.rejects(receiveOriginal(response,c.signal,done=>{if(done)c.abort()}),{name:'AbortError'});assert.ok(cancelled);
});
