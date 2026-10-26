import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptivePoll} from '../src/adaptive-poll.mjs';
function harness(read,opts={}){
 const doc=new EventTarget(),win=new EventTarget(),tasks=new Map();let seq=0,now=0;
 doc.hidden=false;
 const poll=adaptivePoll(read,{base:10,max:40,doc,win,setTimer:(fn,ms)=>{tasks.set(++seq,{fn,ms});return seq},clearTimer:id=>tasks.delete(id),...opts});
 return {doc,win,tasks,poll,async next(){assert.equal(tasks.size,1);const [id,t]=[...tasks][0];tasks.delete(id);now+=t.ms;t.fn();await new Promise(r=>setImmediate(r));return t.ms}};
}
test('quiet reads back off, activity resets, bounded error recovery',async()=>{
 let result=false;const h=harness(async()=>{if(result==='error')throw Error();return result});
 assert.equal(await h.next(),0);assert.equal(await h.next(),20);assert.equal(await h.next(),40);
 result=true;await h.next();assert.equal(await h.next(),10);
 result='error';await h.next();assert.equal(await h.next(),20);assert.equal(await h.next(),40);h.poll.stop();assert.equal(h.tasks.size,0);
});
test('hidden tabs have no timer; visible/focus/mutation wakes without polling overlap',async()=>{
 let resolve,calls=0;const h=harness(()=>{calls++;return new Promise(r=>resolve=r)});
 await h.next();assert.equal(calls,1);h.win.dispatchEvent(new Event('museum-data-changed'));assert.equal(h.tasks.size,0);
 resolve(false);await new Promise(r=>setImmediate(r));assert.equal(await h.next(),0);assert.equal(calls,2);
 h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));resolve(false);await new Promise(r=>setImmediate(r));assert.equal(h.tasks.size,0);
 h.doc.hidden=false;h.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(await h.next(),0);assert.equal(calls,3);
 h.poll.stop();resolve(true);await new Promise(r=>setImmediate(r));assert.equal(h.tasks.size,0);
 h.win.dispatchEvent(new Event('focus'));assert.equal(h.tasks.size,0);
});
test('disabled views do no reads and resume when explicitly woken',async()=>{
 let enabled=false,calls=0;const h=harness(async()=>{calls++;return false},{enabled:()=>enabled});
 await h.next();await h.next();assert.equal(calls,0);enabled=true;h.poll.wake();assert.equal(await h.next(),0);assert.equal(calls,1);h.poll.stop();
});
