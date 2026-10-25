import React,{useEffect,useState} from 'react';

// A bounded, cached-thumbnail light field makes the material visible over black.
// It is decorative and never falls back to an original or display download.
export function TimelineSurface({source}){
 const [image,setImage]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();let url='';
  const timer=setTimeout(async()=>{
   if(!source)return;
   try{
    const response=await fetch(source,{signal:controller.signal});if(!response.ok)throw Error('thumbnail');
    const blob=await response.blob();if(controller.signal.aborted)return;
    url=URL.createObjectURL(blob);setImage({source,url});
   }catch{/* Keep the quiet mineral gradients when a local thumbnail is unavailable. */}
  },120);
  return()=>{clearTimeout(timer);controller.abort();if(url)URL.revokeObjectURL(url)};
 },[source]);
 const current=image?.source===source?image.url:null;
 return <div className="timeline-material" aria-hidden="true"><div className="timeline-ambient">
  {current&&<img key={current} src={current} alt="" decoding="async" onError={e=>e.currentTarget.style.visibility='hidden'}/>}
 </div><div className="timeline-material-wash"/></div>;
}
