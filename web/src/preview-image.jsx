import React,{forwardRef,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {previews} from './preview-queue';
// Observe the real transformed tile, so a long wall cannot flood the network.
export const PreviewImage=forwardRef(function PreviewImage({src,priority=1,onError,onLoad,loading,as:Tag='img',native=false,...props},forwarded){
 const node=useRef(null),lease=useRef(null),error=useRef(onError),rank=useRef(priority),[loaded,setLoaded]=useState(null);
 error.current=onError;rank.current=priority;
 const bind=useCallback(el=>{node.current=el;if(typeof forwarded==='function')forwarded(el);else if(forwarded)forwarded.current=el},[forwarded]);
 const direct=native||!src||!src.startsWith('/api/assets/')||!src.includes('/media/');
 useLayoutEffect(()=>{
  const img=node.current;
  if(!native||!src||!img||img.complete&&img.naturalWidth)return;
  const done=previews.nativeForeground();
  img.addEventListener('load',done);img.addEventListener('error',done);
  return()=>{img.removeEventListener('load',done);img.removeEventListener('error',done);done()};
 },[src,native]);
 useLayoutEffect(()=>{
  if(direct||!node.current)return;
  let active=true;
  const begin=p=>{
   if(lease.current){lease.current.promote(p);return}
   const current=previews.acquire(src,p);lease.current=current;
   current.promise.then(url=>{if(active)setLoaded({src,url})}).catch(e=>{if(active&&e.name!=='AbortError')error.current?.(e)});
  };
  const onScreen=r=>r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;
  // Request already-visible tiles during commit; no extra observer-frame latency.
  if(onScreen(node.current.getBoundingClientRect()))begin(rank.current);
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)begin(onScreen(entry.boundingClientRect)?rank.current:2)}},{rootMargin:'160px'});
  observer.observe(node.current);
  const visible=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))lease.current?.promote(rank.current)});visible.observe(node.current);
  return()=>{active=false;observer.disconnect();visible.disconnect();node.current?.removeAttribute('src');node.current?.removeAttribute('href');lease.current?.release();lease.current=null};
 },[src,direct]);
 useEffect(()=>{lease.current?.promote(priority)},[priority]);
 const value=direct?src:loaded?.src===src?loaded.url:undefined;
 // A queued <img> without src otherwise paints the browser's broken-image
 // icon/alt text even though no network request has failed. Keep its geometry
 // for IntersectionObserver; only hide the unpainted image surface.
 const [painted,setPainted]=useState(null);
 const pending=!direct&&painted!==value;
 return <Tag fetchPriority={priority===0?'high':'auto'} {...props} ref={bind} data-preview-source={direct?undefined:src} data-preview-pending={!direct&&(!value||pending)?'true':undefined}
  style={{...props.style,...(!direct&&(!value||pending)?{visibility:'hidden'}:{})}}
  {...(Tag==='image'?{href:value}:{src:value,decoding:'async'})}
  onLoad={e=>{setPainted(value);onLoad?.(e)}} onError={e=>{setPainted(null);onError?.(e)}}/>;
});

export function PreviewSVG({href,...props}){return <PreviewImage {...props} as="image" src={href}/>;}
