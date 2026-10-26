import {wallPromotions} from './preview-promotion.mjs';
import {PreviewImage} from './preview-image';
import {MediaStatus} from './system-status';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import './wall-image.css';
// Thumbnail paints first; the display layer is requested only after that paint.
// Unmounted virtual tiles release their elements and never request NAS originals.
export function WallImage({photo,display,moving=false,promote=true}){
 const [thumbReady,setThumbReady]=useState(!photo.thumbnail),[target,setTarget]=useState(null),[ready,setReady]=useState(false),[settled,setSettled]=useState(false),[failed,setFailed]=useState(false);
 const [permit,setPermit]=useState(false);
 const live=useRef(true),frames=useRef([]),image=useRef(null),thumb=useRef(null);
 const displayRef=useCallback(node=>{if(image.current&&image.current!==node)image.current.removeAttribute('src');image.current=node},[]);
 const thumbRef=useCallback(node=>{if(thumb.current&&thumb.current!==node)thumb.current.removeAttribute('src');thumb.current=node},[]);
 useEffect(()=>{live.current=true;return()=>{live.current=false;frames.current.forEach(cancelAnimationFrame)}},[]);
 useEffect(()=>{
  if(!thumbReady||moving||!promote||ready||failed||!photo.preview&&!display){setPermit(false);return}
  let release,active=true;
  const timer=setTimeout(()=>{release=wallPromotions.acquire(()=>{if(active){setTarget(photo.preview||display||null);setPermit(true)}})},80);
  return()=>{active=false;clearTimeout(timer);release?.();setPermit(false)};
 },[thumbReady,moving,promote,ready,failed,photo.preview,display]);
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
  catch{if(live.current&&image.current===img)fail();return}
  if(!live.current||image.current!==img)return;
  // Give the decoded surface a paint opportunity while the thumbnail stays opaque.
  frames.current[0]=requestAnimationFrame(()=>{frames.current[1]=requestAnimationFrame(()=>{if(live.current&&image.current===img)setReady(true)})});
 };
 return <>{photo.thumbnail&&<PreviewImage ref={thumbRef} priority={0} className={'wall-thumb '+(settled&&!moving?'retired':'')} fetchPriority="high" src={photo.thumbnail} alt={photo.name} aria-hidden={ready?true:undefined} draggable="false" decoding="async" onLoad={()=>setThumbReady(true)} onError={()=>setThumbReady(true)}/>}
  {target&&!failed&&(ready||permit&&!moving&&promote)&&<PreviewImage ref={displayRef} priority={1} className={'wall-display '+(ready?'ready ':'')+(settled?'settled':'')} fetchPriority="low" src={target} alt={ready?photo.name:''} draggable="false" decoding="async" onLoad={reveal} onError={fail}
   onTransitionEnd={e=>{if(e.target===e.currentTarget&&e.propertyName==='opacity'&&ready)setSettled(true)}}/>}
  {failed&&<MediaStatus failed className="wall-preview-status">4K 暂不可用</MediaStatus>}</>;
}
