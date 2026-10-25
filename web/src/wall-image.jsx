import React,{useEffect,useRef,useState} from 'react';
// Thumbnail paints first; the display layer is requested only after that paint.
// Unmounted virtual tiles release their elements and never request NAS originals.
export function WallImage({photo,display}){
 const [thumbReady,setThumbReady]=useState(!photo.thumbnail),[promote,setPromote]=useState(false),[ready,setReady]=useState(false),[failed,setFailed]=useState(false);
 const live=useRef(true);useEffect(()=>()=>{live.current=false},[]);
 useEffect(()=>{if(!thumbReady)return;const timer=setTimeout(()=>setPromote(true),60);return()=>clearTimeout(timer)},[thumbReady]);
 const target=display || photo.preview;
 return <>{!ready&&photo.thumbnail&&<img className="wall-thumb" fetchPriority="high" src={photo.thumbnail} alt={photo.name} draggable="false" decoding="async" onLoad={()=>setThumbReady(true)} onError={()=>setThumbReady(true)}/>}
  {promote&&target&&!failed&&<img className={'wall-display '+(ready?'ready':'')} fetchPriority="low" src={target} alt={ready?photo.name:''} draggable="false" decoding="async" onLoad={async e=>{const img=e.currentTarget;try{await img.decode()}catch{}if(live.current)setReady(true)}} onError={()=>setFailed(true)}/>}</>;
}
