import React,{useEffect,useRef,useState,useId} from 'react';
import {Icon} from './icons';
import './original-progress.css';
import {originalErrorText} from './original-transfer.mjs';
const BARS=160;
const bytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
export function OriginalProgress({state,label='原图就绪'}){
 const [lit,setLit]=useState(0),current=useRef(0),latest=useRef(state);latest.current=state;
 const [dismiss,setDismiss]=useState(false),[hidden,setHidden]=useState(false);
 const gradient='transfer-'+useId().replaceAll(':','');
 const target=state.status==='failed'?current.current:Math.floor((state.percent||0)*BARS/100);
 const percent=state.status==='ready'?100:Math.min(99,Math.max(0,Math.floor(state.percent||0)));
 useEffect(()=>{
  if(state.status==='failed'||target<=current.current)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){current.current=target;setLit(target);return}
  let frame;
  const from=current.current,start=performance.now(),duration=state.status==='ready'?120:220;
  const tick=now=>{
   if(latest.current.status==='failed')return;
   // A continuous ordered front, bounded by elapsed time rather than refresh rate.
   // Fast transfers may illuminate several adjacent ticks in one painted frame.
   const next=Math.min(target,from+Math.floor((target-from)*Math.min(1,(now-start)/duration)));
   if(next!==current.current){current.current=next;setLit(next)}
   if(current.current<target)frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[target,state.status]);
 useEffect(()=>{
  if(state.status!=='ready'||lit<BARS)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){setHidden(true);return}
  const start=setTimeout(()=>setDismiss(true),80),end=setTimeout(()=>setHidden(true),280);
  return()=>{clearTimeout(start);clearTimeout(end)};
 },[state.status,lit]);
 if(hidden)return <span className="original-progress-done" role="status">{label}</span>;
 const labels={waiting:'连接原图',download:'取回原图',convert:'转换中',delivery:'接收原图',decode:'解码中',ready:'原图就绪',failed:state.error?originalErrorText(state.error):'原图暂不可用'};
 return <div className={'original-progress '+state.status+(dismiss?' dismiss':'')} data-lit={lit} data-percent={percent}>
  <div className="original-progress-labels"><span className="original-progress-stage" role="status"><Icon name={state.status==='failed'?'connection':state.status==='ready'?'check':'download'}/>{labels[state.status]}</span><span className="original-progress-bytes">{state.done>0?bytes(state.done)+(state.total?' / '+bytes(state.total):''):''}</span><span className="original-progress-percent">{state.total||state.status==='ready'?<>{percent}<small>%</small></>:'—'}</span></div>
  <svg className="original-progress-track" viewBox="0 0 640 12" preserveAspectRatio="none" role="progressbar" aria-label="原图读取进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.total||['decode','ready'].includes(state.status)?percent:undefined} aria-valuetext={labels[state.status]}>
   <defs><linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" x2={Math.max(4,lit*4)} y1="0" y2="0"><stop stopColor="#775533"/><stop offset=".68" stopColor="#ba8b53"/><stop offset="1" stopColor="#efd2a5"/></linearGradient></defs>
   {Array.from({length:BARS},(_,i)=><rect key={i} x={i*4} y="0" width="1.35" height="12" rx=".675" style={i<lit?{fill:state.status==='failed'?'#87765f':i===lit-1?'#f0d6ae':`url(#${gradient})`}:undefined} className={i<lit?'segment-done'+(i===lit-1?' segment-leading':''):'segment-wait'}/>)}
  </svg>
 </div>;
}
