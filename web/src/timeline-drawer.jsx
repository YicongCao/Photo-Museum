import React,{useEffect,useId,useRef,useState} from 'react';
import {Icon} from './icons';

// Measure the final panel box: its animated/offscreen rect is not a reveal zone.
export function TimelineDrawer({children,onClose,autoReveal=true}){
 const [open,setOpen]=useState(false),id=useId(),panel=useRef(null),toggle=useRef(null);
 const timer=useRef(null),manual=useRef(false),keyboard=useRef(false),dismissed=useRef(false),pointerType=useRef(null),callback=useRef(onClose),automatic=useRef(autoReveal);
 callback.current=onClose;
 automatic.current=autoReveal;
 const cancel=()=>{clearTimeout(timer.current);timer.current=null};
 const scheduleClose=()=>{if(!timer.current)timer.current=setTimeout(()=>{timer.current=null;setOpen(false);callback.current()},220)};
 const close=(restore=false)=>{cancel();manual.current=false;keyboard.current=false;dismissed.current=true;setOpen(false);callback.current();if(restore)toggle.current?.focus()};
 useEffect(()=>{if(!autoReveal)close()},[autoReveal]);
 useEffect(()=>{
  const move=e=>{
   if(e.pointerType==='touch'||e.buttons)return;
   const node=panel.current;if(!node)return;
   const parent=node.offsetParent?.getBoundingClientRect(),left=(parent?.left||0)+node.offsetLeft,top=(parent?.top||0)+node.offsetTop;
   const inside=e.clientX>=left&&e.clientX<=left+node.offsetWidth&&e.clientY>=top&&e.clientY<=top+node.offsetHeight;
   if(!inside)dismissed.current=false;
   if(!automatic.current){if(inside)dismissed.current=true;cancel();return}
   if(inside){cancel();if(!dismissed.current)setOpen(true)}
   else if(!manual.current&&!keyboard.current)scheduleClose();
  };
  const exit=e=>{if(e.relatedTarget==null&&!manual.current&&!keyboard.current){cancel();setOpen(false);callback.current()}};
  const escape=e=>{if(e.key==='Escape'){const focused=panel.current?.contains(document.activeElement);close(focused)}};
  window.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerout',exit);window.addEventListener('keydown',escape);
  return()=>{cancel();window.removeEventListener('pointermove',move);document.removeEventListener('pointerout',exit);window.removeEventListener('keydown',escape)};
 },[]);
 return <>
  <button ref={toggle} className="timeline-toggle" aria-label={open?'收起时间线':'显示时间线'} title={open?'收起时间线':'显示时间线'}
   aria-expanded={open} aria-controls={id} disabled={!autoReveal} onClick={()=>{if(open)close();else{cancel();dismissed.current=false;manual.current=true;setOpen(true)}}}>
   <Icon name={open?'close':'timeline'}/>
  </button>
  <div id={id} ref={panel} className={'timeline-glass-frame timeline-drawer '+(open?'is-open':'is-closed')} aria-hidden={!open} inert={!open||undefined}
   onFocusCapture={e=>{if(e.target.matches(':focus-visible')){cancel();keyboard.current=true;setOpen(true)}}}
   onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget)){keyboard.current=false;if(!manual.current)scheduleClose()}}}
   onPointerDownCapture={e=>{pointerType.current=e.pointerType;keyboard.current=false}}
   onClick={e=>{if(pointerType.current==='touch'&&e.target.closest('.dock-timeline button'))close(true)}}>
   {children}
  </div>
 </>;
}
