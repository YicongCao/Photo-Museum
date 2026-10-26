import React,{useEffect,useLayoutEffect,useRef} from 'react';
import {PreviewImage} from './preview-image';
import {previews} from './preview-queue';

export function ViewerPageButtons({onTurn,previous,next,busy}){
 return <>{[-1,1].map(direction=><button key={direction} className={'viewer-page '+(direction<0?'previous':'next')} aria-label={direction<0?'上一张照片':'下一张照片'} disabled={busy||!(direction<0?previous:next)} onClick={e=>{e.stopPropagation();onTurn(direction)}}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d={direction<0?'m14 5-7 7 7 7':'m10 5 7 7-7 7'}/></svg>
 </button>)}</>;
}

export function ViewerFilmstrip({photo,sequence,onSelect,busy}){
 const track=useRef(null),index=sequence.items.findIndex(p=>p.id===photo.id);
 const items=index<0?[photo]:sequence.items.slice(Math.max(0,index-5),index+6);
 // Only two neighboring converted displays. Leases expire with this selection.
 useEffect(()=>{
  const leases=[sequence.items[index-1],sequence.items[index+1]].filter(p=>p?.preview).map(p=>previews.acquire(p.preview,2));
  leases.forEach(l=>l.promise.catch(()=>{}));return()=>leases.forEach(l=>l.release());
 },[photo.id,sequence.items[index-1]?.preview,sequence.items[index+1]?.preview]);
 useLayoutEffect(()=>{
  const node=track.current,current=node?.querySelector('[aria-current="true"]');
  if(!current)return;
  const center=()=>{node.scrollLeft=current.offsetLeft+current.clientWidth/2-node.clientWidth/2};center();
  const resize=new ResizeObserver(center);resize.observe(node);return()=>resize.disconnect();
 },[photo.id,items.length]);
 return <section className="viewer-filmstrip" aria-label="相邻照片">
  <div className="viewer-filmstrip-track" ref={track}>{items.map(p=><button key={p.id} aria-current={p.id===photo.id?'true':undefined} aria-label={'查看 '+p.name} title={p.name} disabled={busy} onClick={()=>onSelect(p)}>
   {(p.thumbnail||p.preview)&&<PreviewImage src={p.thumbnail||p.preview} priority={1} alt=""/>}
   {p.kind==='video_candidate'&&<svg className="filmstrip-video" viewBox="0 0 24 24" aria-label="视频"><path d="m9 6 9 6-9 6Z" fill="currentColor"/></svg>}
  </button>)}</div>
  <div className="filmstrip-counter" aria-live="polite">{index<0?'—':index+1}<span> / </span>{sequence.total??(sequence.items.length||1)}
   {sequence.error&&<button onClick={()=>sequence.loadMore?.()}>重试后续照片</button>}
   {sequence.busy&&<span> · 读取后续照片</span>}
  </div>
 </section>;
}
