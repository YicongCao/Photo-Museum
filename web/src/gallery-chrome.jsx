import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';

// Watch the viewport without placing an invisible hit target over photographs.
export function useGalleryChrome(root,{menuOpen=false}={}){
 const [near,setNear]=useState(false);
 const [touch,setTouch]=useState(()=>matchMedia('(hover: none)').matches);
 const timer=useRef(null),nearNow=useRef(false);
 useEffect(()=>{
  const media=matchMedia('(hover: none)');
  const cancel=()=>{clearTimeout(timer.current);timer.current=null};
  const controls=target=>target instanceof Element&&root.current?.contains(target)&&target.closest('.museum-nav,.timeline-toggle');
  const hide=()=>{if(!timer.current)timer.current=setTimeout(()=>{timer.current=null;nearNow.current=false;setNear(false)},180)};
  const move=e=>{
   if(e.pointerType==='touch'){cancel();setTouch(true);return}
   if(e.buttons)return;
   setTouch(media.matches);
   if(e.clientX>=innerWidth*.7||controls(e.target)){cancel();if(!nearNow.current){nearNow.current=true;flushSync(()=>setNear(true))}}else hide();
  };
  const leave=e=>{if(e.relatedTarget==null)hide()};
  const capability=()=>setTouch(media.matches);
  window.addEventListener('pointermove',move,{passive:true});
  document.addEventListener('pointerdown',eTouch,{passive:true});
  function eTouch(e){if(e.pointerType==='touch'){cancel();setTouch(true)}}
  document.addEventListener('pointerout',leave);
  media.addEventListener('change',capability);
  return()=>{cancel();window.removeEventListener('pointermove',move);document.removeEventListener('pointerdown',eTouch);document.removeEventListener('pointerout',leave);media.removeEventListener('change',capability)};
 },[root]);
 return near||touch||menuOpen;
}
