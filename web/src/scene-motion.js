import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

// One shared timeline, bounded to visible images; no canvas or persistent clone cache.
export function useSceneMotion(root) {
  const running = useRef(false), cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), []);
  return async (selector, change, incoming) => {
    if (running.current) return false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { flushSync(change); return true; }
    running.current = true;
    const animations = [], clones = [];
    const width = innerWidth, height = innerHeight;
    const visible = el => { const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && r.right>0 && r.left<width && r.bottom>0 && r.top<height; };
    const sources = [...root.current.querySelectorAll(selector)].filter(visible).slice(0,40);
    sources.forEach((el,i) => {
      const r=el.getBoundingClientRect(), copy=document.createElement('img');
      copy.src=el.currentSrc || el.src; copy.alt=''; copy.setAttribute('aria-hidden','true');
      Object.assign(copy.style,{position:'fixed',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`,objectFit:getComputedStyle(el).objectFit,zIndex:'100',pointerEvents:'none',margin:'0'});
      document.body.append(copy); clones.push(copy);
      let dx=r.x+r.width/2-width/2, dy=r.y+r.height/2-height/2;
      if (Math.hypot(dx,dy)<80) {dx=Math.cos(i*2.4)*100;dy=Math.sin(i*2.4)*100;}
      const distance=Math.hypot(dx,dy), reach=Math.hypot(width,height)*.8;
      animations.push(copy.animate([{transform:'translate(0,0) scale(1)',opacity:1,filter:'blur(0)'},{transform:`translate(${dx/distance*reach}px,${dy/distance*reach}px) scale(1.12) rotate(${i%2 ? 7:-7}deg)`,opacity:0,filter:'blur(5px)'}],{duration:600,easing:'cubic-bezier(.45,0,.8,.3)',fill:'forwards'}));
    });
    flushSync(change);
    const targets=[...root.current.querySelectorAll(incoming)].filter(visible).slice(0,40);
    targets.forEach((el,i)=>{
      const r=el.getBoundingClientRect();
      const archive=el.classList.contains('metadata-panel');
      animations.push(el.animate(archive ? [{opacity:0,transform:'translateX(18px)'},{opacity:1,transform:'none'}] : [
        {opacity:0,transform:`translate(${width/2-r.x-r.width/2}px,${height/2-r.y-r.height/2}px) scale(.08)`,filter:'blur(5px)'},
        {opacity:1,transform:'translate(0,0) scale(1)',filter:'blur(0)'}],
        {duration:760,delay:180+Math.min(i,14)*13,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'}));
    });
    const finish=()=>{animations.forEach(a=>a.cancel());clones.forEach(el=>{el.removeAttribute('src');el.remove();});running.current=false;};
    cleanup.current=finish;
    await Promise.allSettled(animations.map(a=>a.finished));finish();
    return true;
  };
}

// Keep encoded 4K previews only. Never prefetch NAS originals or retain decoded Image objects.
export function createActivityWarmup(api,id) {
  const controller=new AbortController(), urls=new Map();
  const item={id,urls,data:null,dispose(){controller.abort();urls.forEach(URL.revokeObjectURL);urls.clear();}};
  item.promise=(async()=>{
    const data=await api(`/gallery/${id}?limit=15`,'GET',undefined,{signal:controller.signal});
    item.data=data;
    const previews=data.previews || data.items;
    let next=0;
    const timer=setTimeout(()=>controller.abort(),8000);
    try {
      await Promise.allSettled(Array.from({length:4},async()=>{
        while(next<previews.length && !controller.signal.aborted) {
          const p=previews[next++];if(!p.preview)continue;
          try {const response=await fetch(p.preview,{signal:controller.signal});if(!response.ok)continue;
            const blob=await response.blob();if(!controller.signal.aborted)urls.set(p.id,URL.createObjectURL(blob));
          }catch{/* A failed preview must not prevent opening the activity. */}
        }
      }));
    } finally {clearTimeout(timer);}
    return data;
  })();
  item.promise.catch(()=>{});
  return item;
}
