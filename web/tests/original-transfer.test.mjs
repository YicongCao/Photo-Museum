import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiveOriginal,originalFailure,originalErrorText} from '../src/original-transfer.mjs';
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
test('original errors distinguish NAS, conversion, source change, limits and authentication',async()=>{
 for(const [status,detail,wanted] of [[502,'network_unavailable','暂时无法连接 NAS'],[502,'NAS 原图读取失败','NAS 原图读取失败'],
  [503,'原图转换忙，请稍后重试','原图转换忙，请稍后重试'],[409,'NAS 文件版本变化，请重新扫描','NAS 文件版本变化，请重新扫描'],
  [413,'原图超过单次转换上限','原图超过单次转换上限'],[415,'原图色彩格式待适配','原图色彩格式待适配'],[401,'','需要重新解锁']]){
  const error=await originalFailure(Response.json({detail},{status}));
  assert.equal(originalErrorText(error),wanted);assert.equal(error.status,status);
 }
 assert.equal(originalErrorText(new Error('原图无法解码')),'原图无法解码');
});
test('untrusted response bodies and exceptions never leak into original status',async()=>{
 for(const body of ['<html>secret /private/photo.jpg</html>',JSON.stringify({detail:'secret /private/photo.jpg'}),JSON.stringify({detail:{password:'secret'}})]){
  const error=await originalFailure(new Response(body,{status:502}));assert.equal(originalErrorText(error),'服务响应暂不可用');
 }
 assert.equal(originalErrorText(new Error('secret /private/photo.jpg')),'原图暂不可用');
 assert.equal(originalErrorText(new TypeError('Failed to fetch')),'暂时无法连接服务');
});
