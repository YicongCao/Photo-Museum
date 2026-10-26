import React,{useEffect,useId,useRef,useState} from 'react';
import {Icon} from './icons';

// The right fifth is a reveal region, not an input-catching overlay over photos.
export function TimelineDrawer({children,onClose}){
 const [open,setOpen]=useState(false),id=useId(),panel=useRef(null),toggle=useRef(null);
 const timer=useRef(null),manual=useRef(false),keyboard=useRef(false),dismissed=useRef(false),pointerType=useRef(null),callback=useRef(onClose);
 callback.current=onClose;
 const cancel=()=>{clearTimeout(timer.current);timer.current=null};
 const scheduleClose=()=>{if(!timer.current)timer.current=setTimeout(()=>{timer.current=null;setOpen(false);callback.current()},220)};
 const close=(restore=false)=>{cancel();manual.current=false;keyboard.current=false;dismissed.current=true;setOpen(false);callback.current();if(restore)toggle.current?.focus()};
 useEffect(()=>{
  const move=e=>{
   if(e.pointerType==='touch'||e.buttons)return;
   const inside=panel.current?.contains(e.target)||toggle.current?.contains(e.target),edge=e.clientX>=innerWidth*.8;
   if(!edge&&!inside)dismissed.current=false;
   if(inside||edge){cancel();if(!dismissed.current)setOpen(true)}
   else if(!manual.current&&!keyboard.current)scheduleClose();
  };
  const exit=e=>{if(e.relatedTarget==null&&!manual.current&&!keyboard.current){cancel();setOpen(false);callback.current()}};
  const escape=e=>{if(e.key==='Escape'){const focused=panel.current?.contains(document.activeElement);close(focused)}};
  window.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerout',exit);window.addEventListener('keydown',escape);
  return()=>{cancel();window.removeEventListener('pointermove',move);document.removeEventListener('pointerout',exit);window.removeEventListener('keydown',escape)};
 },[]);
 return <>
  <button ref={toggle} className="timeline-toggle" aria-label={open?'收起时间线':'显示时间线'} title={open?'收起时间线':'显示时间线'}
   aria-expanded={open} aria-controls={id} onClick={()=>{if(open)close();else{cancel();dismissed.current=false;manual.current=true;setOpen(true)}}}>
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
