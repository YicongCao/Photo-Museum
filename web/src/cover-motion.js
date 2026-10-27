// Positions and velocities use covers and covers/ms, independent of viewport size.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function coverStop(from,velocity,max,{target,projection=0}={}) {
  from=clamp(from,0,max);
  if(target==null){
    target=Math.round(from+projection);
    // A moving gesture lands ahead, rather than stopping then pulling backwards.
    if(Math.abs(velocity)>.0001)
      target=velocity>0?Math.max(target,Math.ceil(from-1e-7)):Math.min(target,Math.floor(from+1e-7));
  }
  target=clamp(Math.round(target),0,max);
  const distance=target-from;
  const speed=Math.abs(velocity)>.0001?Math.abs(velocity):Math.max(Math.abs(distance)/150,.001);
  const duration=distance?clamp(2*Math.abs(distance)/speed,120,380):0;
  // Fit the remaining distance: v(t)=v0-at, a=v0²/(2d), v(T)=0.
  // Bound duration for very slow/stale input instead of dragging out the landing.
  const initialVelocity=duration?2*distance/duration:0;
  return {from,target,duration,initialVelocity,deceleration:duration?initialVelocity/duration:0};
}

export function coverStopPosition(plan,elapsed){
  if(elapsed>=plan.duration||!plan.duration)return plan.target;
  const t=Math.max(0,elapsed);
  return plan.from+plan.initialVelocity*t-plan.deceleration*t*t/2;
}

export class CoverMotion {
  constructor({read,write,maximum,reduced=()=>false,now=()=>performance.now(),
    raf=fn=>requestAnimationFrame(fn),caf=id=>cancelAnimationFrame(id),
    later=(fn,ms)=>setTimeout(fn,ms),clear=id=>clearTimeout(id)}){
    Object.assign(this,{read,write,maximum,reduced,now,raf,caf,later,clear});
    this.frame=null;this.timer=null;this.burst=null;this.plan=null;
  }
  cancel(){
    if(this.frame!=null)this.caf(this.frame);
    if(this.timer!=null)this.clear(this.timer);
    this.frame=this.timer=null;this.burst=null;this.plan=null;
  }
  coast(velocity=0,options={}){
    if(this.frame!=null)this.caf(this.frame);
    const plan=coverStop(this.read(),velocity,this.maximum(),options);
    this.plan=plan;
    if(!plan.duration||this.reduced()){
      this.write(plan.target);this.frame=null;this.plan=null;return;
    }
    const start=this.now();
    const tick=()=>{
      const elapsed=this.now()-start;
      this.write(coverStopPosition(plan,elapsed));
      if(elapsed<plan.duration)this.frame=this.raf(tick);
      else {this.frame=null;this.plan=null;}
    };
    this.frame=this.raf(tick);
  }
  goTo(target){this.cancel();this.coast(0,{target});}
  settle(velocity=0){
    this.cancel();
    this.coast(velocity,{projection:clamp(velocity*70,-2,2)});
  }
  finish(){const p=this.plan?.target??Math.round(this.read());this.cancel();this.write(clamp(p,0,this.maximum()));}
  wheel(delta){
    if(!Number.isFinite(delta)||!delta)return;
    const now=this.now(),direction=Math.sign(delta),magnitude=Math.abs(delta),old=this.burst;
    const fresh=!old||now-old.time>140||old.direction!==direction;
    // Larger input or a reversal is a new action, not the remaining OS momentum.
    const renewed=old?.captured&&magnitude>old.magnitude*1.35+.003;
    if(fresh||renewed)this.cancel();
    const previous=this.burst;
    if(this.timer!=null)this.clear(this.timer);
    if(previous?.captured){
      this.burst={...previous,time:now,magnitude};
      // Consume the OS tail once: the fitted coast already owns this movement.
      this.timer=this.later(()=>{this.timer=null;this.burst=null;},140);
      return;
    }
    if(this.frame!=null)this.caf(this.frame);
    this.frame=null;this.plan=null;
    const dt=previous?clamp(now-previous.time,8,80):16;
    const speed=previous?previous.speed*.35+magnitude/dt*.65:magnitude/dt;
    const slowing=previous&&magnitude<previous.magnitude*.98?previous.slowing+1:0;
    const deceleration=previous?Math.max(0,(previous.speed-speed)/dt):0;
    this.write(clamp(this.read()+delta,0,this.maximum()));
    const burst=this.burst={time:now,direction,magnitude,speed,slowing,captured:false};
    if(slowing>=2){
      burst.captured=true;
      const remaining=clamp(deceleration>1e-7?speed*speed/(2*deceleration):speed*70,0,2);
      this.coast(direction*speed,{projection:direction*remaining});
      this.timer=this.later(()=>{this.timer=null;this.burst=null;},140);
    }else{
      // Detented wheels/abrupt finger lifts have no detectable momentum tail.
      this.timer=this.later(()=>{
        this.timer=null;
        if(this.burst!==burst)return;
        burst.captured=true;
        this.coast(direction*speed);
      },64);
    }
  }
}
