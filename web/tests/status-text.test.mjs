import test from 'node:test';
import assert from 'node:assert/strict';
import {failureInfo,failureText} from '../src/status-text.js';
import {api} from '../src/api.js';

test('native exceptions and arbitrary payloads never become public copy',()=>{
 for(const raw of ['Failed to fetch','Load failed','NetworkError when attempting to fetch resource.'])assert.equal(failureInfo(raw).code,'connection');
 for(const raw of ['<html>proxy error /private/user</html>','sk-private-secret','处理 /Users/private failed','unexpected token','__proto__','constructor','clock'])assert.equal(failureText(raw),'操作未完成');
 assert.equal(failureInfo(new DOMException('cancelled','AbortError')),null);
 assert.equal(failureInfo(null),null);
});
test('approved domain states preserve meaning without relaying arbitrary strings',()=>{
 assert.equal(failureText('cache_budget_exceeded'),'缓存空间不足');
 assert.equal(failureText('设置已在其他页面更新，请重新读取'),'设置已在其他页面更新，请重新读取');
 assert.equal(failureInfo('暂时无法连接服务').code,'connection');
});
test('request failure, invalid JSON, timeout, external cancellation and password failure stay distinct',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw TypeError('Failed to fetch')};
  await assert.rejects(api('/gallery'),e=>e.code==='connection'&&e.message==='暂时无法连接服务');
  globalThis.fetch=async()=>new Response('<html>Bad Gateway private-secret</html>',{status:502});
  await assert.rejects(api('/settings'),e=>e.code==='response'&&!e.message.includes('private'));
  globalThis.fetch=async()=>new Response('<html>synthetic private</html>',{status:401});
  await assert.rejects(api('/state'),e=>e.code==='authentication');
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:'密码不正确'}),{status:401});
  await assert.rejects(api('/login','POST',{password:'synthetic'}),e=>e.code==='password');
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:'请先登录'}),{status:401});
  await assert.rejects(api('/state'),e=>e.code==='authentication');
  globalThis.fetch=async(_,o)=>new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('cancelled','AbortError'));if(o.signal.aborted)abort();else o.signal.addEventListener('abort',abort,{once:true})});
  await assert.rejects(api('/gallery','GET',undefined,{timeoutMs:5}),e=>e.code==='timeout');
  const c=new AbortController();c.abort();await assert.rejects(api('/gallery','GET',undefined,{signal:c.signal}),e=>e.name==='AbortError');
 }finally{globalThis.fetch=original}
});
test('successful JSON and empty 204 are preserved; failures never auto retry mutations',async()=>{
 const original=globalThis.fetch;let count=0;
 try{
  globalThis.fetch=async()=>new Response('{"ok":true}');assert.deepEqual(await api('/state'),{ok:true});
  globalThis.fetch=async()=>new Response(null,{status:204});assert.equal(await api('/logout','POST',{}),null);
  globalThis.fetch=async()=>{count++;throw Error('offline')};await assert.rejects(api('/curator/runs','POST',{}));assert.equal(count,1);
 }finally{globalThis.fetch=original}
});
