import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CoverMotion,coverStop,coverStopPosition} from '../src/cover-motion.js';

function rig(initial=4,{reduced=false,max=20}={}){
  let time=0,position=initial,id=0;const frames=new Map(),timers=new Map(),trace=[];
  const motion=new CoverMotion({read:()=>position,write:p=>{position=p;trace.push({time,p})},maximum:()=>max,reduced:()=>reduced,
    now:()=>time,raf:fn=>{frames.set(++id,fn);return id},caf:i=>frames.delete(i),
    later:(fn,ms)=>{timers.set(++id,{at:time+ms,fn});return id},clear:i=>timers.delete(i)});
  const advance=(ms,step=8)=>{
    const end=time+ms;
    while(time<end){time=Math.min(time+step,end);
      for(const [i,t] of [...timers])if(t.at<=time){timers.delete(i);t.fn()}
      const batch=[...frames];frames.clear();for(const [,fn] of batch)fn(time);
    }
  };
  return {motion,advance,trace,get position(){return position},get pending(){return frames.size+timers.size}};
}
const monotonic=(trace,direction)=>{for(let i=1;i<trace.length;i++)assert.ok((trace[i].p-trace[i-1].p)*direction>=-1e-9,JSON.stringify(trace.slice(i-1,i+1)))};

test('fitted deceleration stops exactly at a cover with zero final velocity and no overshoot',()=>{
  for(const direction of [-1,1])for(const speed of [.0002,.002,.02])for(const fraction of [.01,.2,.65,.99]){
    const from=8+fraction,plan=coverStop(from,direction*speed,20,{projection:direction*.6});
    const values=Array.from({length:101},(_,i)=>({p:coverStopPosition(plan,plan.duration*i/100)}));
    monotonic(values,direction);assert.equal(values.at(-1).p,plan.target);
    assert.ok(Number.isInteger(plan.target));assert.ok(plan.duration>=120&&plan.duration<=380);
    assert.ok(Math.abs(plan.initialVelocity-plan.deceleration*plan.duration)<1e-12);
    assert.equal(coverStopPosition(plan,plan.duration+100),plan.target);
  }
});
test('decreasing OS momentum is captured before the input ends and consumed once',()=>{
  const r=rig();
  for(const delta of [.3,.25,.19,.13]){r.motion.wheel(delta);r.advance(16)}
  assert.ok(r.motion.burst.captured);assert.ok(r.motion.plan,'coast starts during the tail, not after an idle timeout');
  const target=r.motion.plan.target;
  for(const delta of [.09,.06,.035,.016,.006,.002]){r.motion.wheel(delta);r.advance(16)}
  r.advance(500);assert.equal(r.position,target);monotonic(r.trace,1);assert.equal(r.pending,0);
  r.advance(5000);assert.equal(r.position,target);assert.equal(r.pending,0);
});
test('small abrupt wheel input lands ahead instead of pulling back behind the gesture',()=>{
  const r=rig(5);r.motion.wheel(.15);r.advance(64);assert.equal(r.motion.plan.target,6);
  r.advance(400);assert.equal(r.position,6);monotonic(r.trace,1);assert.equal(r.pending,0);
});
test('direction reversal interrupts a coast immediately and rejects its old landing',()=>{
  const r=rig();for(const d of [.3,.25,.19,.13]){r.motion.wheel(d);r.advance(16)}
  const old=r.motion.plan.target,before=r.position;r.motion.wheel(-.2);
  assert.ok(r.position<before);const start=r.trace.length-1;
  r.advance(500);assert.ok(r.position<old);assert.ok(Number.isInteger(r.position));monotonic(r.trace.slice(start),-1);assert.equal(r.pending,0);
});
test('fresh stronger same-direction input interrupts the captured OS tail',()=>{
  const r=rig();for(const d of [.3,.25,.19,.13]){r.motion.wheel(d);r.advance(16)}
  const before=r.position;r.motion.wheel(.4);assert.ok(r.position>=before+.39);assert.equal(r.motion.burst.captured,false);
  r.advance(500);assert.ok(Number.isInteger(r.position));assert.equal(r.pending,0);
});
test('drag release uses current velocity, paused drag settles nearby, and cancellation stops all work',()=>{
  const fast=rig(4.3);fast.motion.settle(.003);fast.advance(500);assert.equal(fast.position,5);monotonic(fast.trace,1);
  const slow=rig(4.3);slow.motion.settle(0);slow.advance(500);assert.equal(slow.position,4);monotonic(slow.trace,-1);
  const r=rig();r.motion.wheel(.3);r.advance(70);r.motion.cancel();const p=r.position;r.advance(1000);assert.equal(r.position,p);assert.equal(r.pending,0);
});
test('goTo, hidden completion, reduced motion and ends have exact bounded results',()=>{
  const r=rig();r.motion.goTo(12);r.advance(48);r.motion.goTo(2);const start=r.trace.length;r.advance(500);
  assert.equal(r.position,2);monotonic(r.trace.slice(start),-1);assert.equal(r.pending,0);
  r.motion.goTo(7);r.advance(16);r.motion.finish();assert.equal(r.position,7);assert.equal(r.pending,0);
  const quiet=rig(4,{reduced:true});quiet.motion.wheel(.15);quiet.advance(64);assert.equal(quiet.position,5);assert.equal(quiet.pending,0);
  for(const [initial,delta,wanted] of [[0,-2,0],[20,3,20]]){const end=rig(initial);end.motion.wheel(delta);end.advance(500);assert.equal(end.position,wanted);assert.equal(end.pending,0)}
});
