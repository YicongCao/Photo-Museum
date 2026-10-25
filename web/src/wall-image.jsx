import {MediaStatus} from './system-status';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import './wall-image.css';
// Thumbnail paints first; the display layer is requested only after that paint.
// Unmounted virtual tiles release their elements and never request NAS originals.
export function WallImage({photo,display}){
 const [thumbReady,setThumbReady]=useState(!photo.thumbnail),[target,setTarget]=useState(null),[ready,setReady]=useState(false),[settled,setSettled]=useState(false),[failed,setFailed]=useState(false);
 const live=useRef(true),frames=useRef([]),image=useRef(null),thumb=useRef(null);
 const displayRef=useCallback(node=>{if(image.current&&image.current!==node)image.current.removeAttribute('src');image.current=node},[]);
 const thumbRef=useCallback(node=>{if(thumb.current&&thumb.current!==node)thumb.current.removeAttribute('src');thumb.current=node},[]);
 useEffect(()=>{live.current=true;return()=>{live.current=false;frames.current.forEach(cancelAnimationFrame)}},[]);
 useEffect(()=>{
  if(!thumbReady||target)return;
  // Choose once: a late warm-up Blob is an alias of this same preview. Replacing
  // an already displayed src with it forces another decode and can flash.
  const timer=setTimeout(()=>setTarget(display || photo.preview || null),60);
  return()=>clearTimeout(timer);
 },[thumbReady,target,display,photo.preview]);
 useEffect(()=>{
  if(!ready||failed)return;
  if(matchMedia('(prefers-reduced-motion:reduce)').matches){setSettled(true);return}
  // Hidden scenes can suppress transitionend. Retire only an opaque display.
  const timer=setTimeout(()=>{if(image.current&&Number(getComputedStyle(image.current).opacity)>=.999)setSettled(true)},420);
  return()=>clearTimeout(timer);
 },[ready,failed]);
 const fail=()=>{if(live.current){frames.current.forEach(cancelAnimationFrame);setFailed(true);setReady(false);setSettled(false)}};
 const reveal=async e=>{
  const img=e.currentTarget;
  try{if(img.decode)await img.decode();if(!img.complete||!img.naturalWidth)throw Error('Preview did not decode')}
  catch{fail();return}
  if(!live.current||image.current!==img)return;
  // Give the decoded surface a paint opportunity while the thumbnail stays opaque.
  frames.current[0]=requestAnimationFrame(()=>{frames.current[1]=requestAnimationFrame(()=>{if(live.current&&image.current===img)setReady(true)})});
 };
 return <>{!settled&&photo.thumbnail&&<img ref={thumbRef} className="wall-thumb" fetchPriority="high" src={photo.thumbnail} alt={photo.name} aria-hidden={ready?true:undefined} draggable="false" decoding="async" onLoad={()=>setThumbReady(true)} onError={()=>setThumbReady(true)}/>}
  {target&&!failed&&<img ref={displayRef} className={'wall-display '+(ready?'ready ':'')+(settled?'settled':'')} fetchPriority="low" src={target} alt={ready?photo.name:''} draggable="false" decoding="async" onLoad={reveal} onError={fail}
   onTransitionEnd={e=>{if(e.target===e.currentTarget&&e.propertyName==='opacity'&&ready)setSettled(true)}}/>}
  {failed&&<MediaStatus failed className="wall-preview-status">4K 暂不可用</MediaStatus>}</>;
}
