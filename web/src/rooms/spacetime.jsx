import {PreviewImage} from '../preview-image';
import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import './spacetime.css';
import {coverCount} from '../cover-layout.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const SpacetimeRoom=forwardRef(function SpacetimeRoom({activities,index,onIndex,onOpen,state,onState},ref){
 const initial=clamp(state.position ?? index,0,activities.length-1),[position,setPosition]=useState(initial),[size,setSize]=useState({w:1200,h:700}),
  [reduced,setReduced]=useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
 const root=useRef(null),pos=useRef(initial),target=useRef(initial),frame=useRef(0),idle=useRef(null),gesture=useRef(null),suppress=useRef(false),lastIndex=useRef(index),callbacks=useRef({onIndex,onState});
 callbacks.current={onIndex,onState};
 const publish=n=>{pos.current=n;setPosition(n);const i=Math.round(n);if(i!==lastIndex.current){lastIndex.current=i;callbacks.current.onIndex(i)}};
 const settle=()=>callbacks.current.onState({position:pos.current});
 const animate=()=>{
  cancelAnimationFrame(frame.current);
  const tick=()=>{
   const delta=target.current-pos.current;
   if(Math.abs(delta)<.001){publish(target.current);settle();return}
   publish(pos.current+delta*.18);frame.current=requestAnimationFrame(tick);
  };frame.current=requestAnimationFrame(tick);
 };
 const goTo=n=>{target.current=clamp(n,0,activities.length-1);if(reduced){publish(Math.round(target.current));settle()}else animate()};
 useImperativeHandle(ref,()=>({goTo,move:n=>goTo(Math.round(target.current)+n)}));
 useEffect(()=>{
  const node=root.current,ro=new ResizeObserver(([e])=>setSize({w:e.contentRect.width,h:e.contentRect.height}));ro.observe(node);
  const wheel=e=>{e.preventDefault();if(e.ctrlKey)return;const d=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?node.clientHeight:1);
   goTo(target.current+d/600);clearTimeout(idle.current);idle.current=setTimeout(()=>goTo(Math.round(target.current)),180)};
  node.addEventListener('wheel',wheel,{passive:false});
  return()=>{ro.disconnect();node.removeEventListener('wheel',wheel);cancelAnimationFrame(frame.current);clearTimeout(idle.current)};
 },[activities.length,reduced]);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),f=()=>setReduced(media.matches);media.addEventListener('change',f);return()=>media.removeEventListener('change',f)},[]);
 useEffect(()=>{if(Math.round(pos.current)!==index&&!gesture.current)goTo(index)},[index]);
 const boardWidth=Math.min(size.w*(size.w<700?.75:.51),size.h*.99,820),boardHeight=boardWidth/1.5;
 const count=coverCount(size.w,size.h+(size.w<700?300:140),activities.length);
 const visible=activities.map((a,i)=>({a,i,d:i-position})).filter(({d,i})=>reduced?i===Math.round(position):d>=-1.35&&d<=count-1);
 const end=e=>{gesture.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);goTo(Math.round(target.current))};
 return <section className="spacetime-room" aria-label="时空隧道展厅" ref={root}
  onPointerDown={e=>{if(e.button!==0)return;suppress.current=false;gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,pos:pos.current};cancelAnimationFrame(frame.current)}}
  onPointerMove={e=>{const g=gesture.current;if(!g||g.id!==e.pointerId)return;const dx=g.x-e.clientX,dy=g.y-e.clientY;if(Math.max(Math.abs(dx),Math.abs(dy))>6){suppress.current=true;e.currentTarget.setPointerCapture(e.pointerId);target.current=clamp(g.pos+(Math.abs(dx)>Math.abs(dy)?dx:dy)/350,0,activities.length-1);publish(target.current)}}}
  onPointerUp={end} onPointerCancel={end}>
  <small className="spacetime-room-label">时空隧道</small>
  <div className="spacetime-floor" aria-hidden="true"><svg viewBox="0 0 1200 500" preserveAspectRatio="none"><path d="M600 0L0 500M600 0L300 500M600 0L600 500M600 0L900 500M600 0L1200 500M0 140h1200M0 300h1200M0 490h1200"/></svg></div>
  <div className="spacetime-boards">
   {visible.map(({a,i,d})=>{
    const scale=reduced?1:Math.pow(.71,d),origin=size.w<700?size.w*.43:size.w*.30,
      vanish=size.w*(size.w<700?.90:.98),center=vanish-(vanish-origin)*scale-Math.max(0,-d)*size.w*.90,
      y=size.h*.44+(1-scale)*size.h*.015,angle=reduced?0:-14;
    return <button key={a.id} data-activity={a.id} data-cover-offset={d} className={'spacetime-board '+(i===index?'space-current':'')} tabIndex={i===index?0:-1}
     aria-label={'展开活动 '+a.event.theme} onClick={e=>{if(suppress.current&&e.detail!==0)return;if(i!==Math.round(pos.current)){goTo(i);return}onOpen(a.id)}}
     style={{width:boardWidth,height:boardHeight,left:reduced?'50%':center,top:y,zIndex:1000-i,
      transform:`translate(-50%,-50%) perspective(1800px) rotateY(${angle}deg) scale(${scale})`,'--space-light':Math.max(.3,1-Math.max(0,d)*.13),'--space-height':boardHeight+'px'}}>
     <div className={'photo-mosaic count-'+a.selected.length}>{a.selected.length?a.selected.map((p,j)=><div key={p.id} className={'mosaic-cell cell-'+j}><PreviewImage src={p.thumbnail} alt="" draggable="false" decoding="async"/></div>):<span className="cover-pending">评分中</span>}</div>
     <div className="space-reflection" aria-hidden="true"><div className={'photo-mosaic count-'+a.selected.length}>{a.selected.map((p,j)=><div key={p.id} className={'mosaic-cell cell-'+j}><PreviewImage src={p.thumbnail} alt="" draggable="false" decoding="async"/></div>)}</div></div>
    </button>
   })}
  </div>
  <div className="spacetime-position" onPointerDown={e=>e.stopPropagation()}><span>{String(index+1).padStart(2,'0')}</span><input aria-label="时空隧道位置" type="range" min="0" max={Math.max(0,activities.length-1)} step="1" value={index} onChange={e=>goTo(Number(e.target.value))}/><span>{activities.length}</span></div>
 </section>;
});
