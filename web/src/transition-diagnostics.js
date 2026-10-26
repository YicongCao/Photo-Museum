// Explicit local diagnostic mode. No photos, paths, resource URLs or network export.
let active=null;
export function markTransitionPhase(name){if(active)active.push({name,at:performance.now()})}
export function beginTransitionSample(){
 if(new URLSearchParams(location.search).get('diagnostics')!=='transitions')return ()=>{};
 const start=performance.now(),gaps=[],phases=[],longFrames=[];active=phases;
 let observer;
 if(PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')){observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longFrames.push({duration:e.duration,blocking:e.blockingDuration,renderStart:e.renderStart,styleStart:e.styleAndLayoutStart,scripts:e.scripts?.map(s=>({duration:s.duration,forcedLayout:s.forcedStyleAndLayoutDuration,function:s.sourceFunctionName,position:s.sourceCharPosition,invoker:s.invokerType}))})});observer.observe({type:'long-animation-frame'})}let frame=0,last=start,stopped=false;
 const tick=now=>{if(stopped)return;gaps.push(now-last);last=now;frame=requestAnimationFrame(tick)};
 frame=requestAnimationFrame(tick);
 return ()=>{
  stopped=true;cancelAnimationFrame(frame);observer?.disconnect();if(active===phases)active=null;
  const elapsed=performance.now()-start,sorted=gaps.filter(n=>n>0).sort((a,b)=>a-b);
  const node=document.querySelector('#transition-diagnostics')||Object.assign(document.createElement('output'),{id:'transition-diagnostics',hidden:true});
  if(!node.isConnected)document.body.append(node);
  const history=JSON.parse(node.textContent||'[]');
  history.push({phases:phases.map(p=>({name:p.name,ms:Math.round(p.at-start)})),longAnimationFrames:longFrames,durationMs:Math.round(elapsed),frames:gaps.length,p95Ms:Math.round((sorted[Math.floor(sorted.length*.95)]||0)*10)/10,maxMs:Math.round(Math.max(0,...gaps)*10)/10,longFrames:gaps.filter(n=>n>33.4).length});
  node.textContent=JSON.stringify(history.slice(-12));
 };
}
