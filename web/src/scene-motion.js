import {previews as previewQueue} from './preview-queue';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

// One shared timeline, bounded to visible images; no canvas or persistent clone cache.
export function useSceneMotion(root) {
  const running = useRef(false), cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), []);
  const animate = async (selector, change, incoming, mode='scatter') => {
    if (running.current) cleanup.current();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { flushSync(change); return true; }
    running.current = true;
    if(['cover-wall','wall-cover','photo-close','fit'].includes(mode)){
      let active=true;const motions=[];
      const visible=el=>{const r=el.getBoundingClientRect();return getComputedStyle(el).visibility!=='hidden'&&r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight};
      const find=css=>[...root.current.querySelectorAll(css)].filter(visible).slice(0,40);
      const finish=()=>{active=false;motions.forEach(a=>a.cancel());if(cleanup.current===finish){running.current=false;cleanup.current=()=>{}}};cleanup.current=finish;
      if(mode==='fit'){
        const old=root.current.querySelector('.viewer-image-area')?.getBoundingClientRect();flushSync(change);
        const area=root.current.querySelector('.viewer-image-area'),next=area?.getBoundingClientRect();
        if(old&&next){const ratio=Number(getComputedStyle(root.current.querySelector('.photo-viewer')).getPropertyValue('--photo-ratio')) || 1.5;const scale=Math.min(old.width,old.height*ratio)/Math.max(1,Math.min(next.width,next.height*ratio));motions.push(area.animate([
          {translate:`${old.x+old.width/2-next.x-next.width/2}px ${old.y+old.height/2-next.y-next.height/2}px`,scale,opacity:.85},
          {translate:'0px 0px',scale:1,opacity:1}],{duration:460,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'}))}
        find('.metadata-panel').forEach(el=>motions.push(el.animate([{opacity:0,translate:'18px 0px'},{opacity:1,translate:'0px 0px'}],{duration:400,fill:'both'})));
      }else{
        const before=find(selector).sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x);
        before.forEach((el,i)=>{
          const r=el.getBoundingClientRect(),main=el.classList.contains('depth-0'),cover=el.classList.contains('activity-panel');
          const dx=cover?(main?innerWidth/2-r.x-r.width/2:(Number(el.dataset.coverOffset)<0?-1:1)*innerWidth*.65):70;
          motions.push(el.animate([{translate:'0px 0px',scale:1,opacity:1},{translate:`${dx}px 0px`,scale:main?.15:cover?.85:.94,opacity:0}],
            {duration:mode==='cover-wall'?300:220,delay:cover?0:Math.min(i,12)*5,easing:'cubic-bezier(.55,0,.8,.4)',fill:'forwards'}));
        });
        await Promise.allSettled(motions.map(a=>a.finished));if(!active)return false;
        flushSync(change);motions.forEach(a=>a.cancel());motions.length=0;
        const next=find(incoming).sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x||a.getBoundingClientRect().y-b.getBoundingClientRect().y);
        const left=next[0]?.getBoundingClientRect().x || 0;
        next.forEach((el,i)=>{
          const r=el.getBoundingClientRect(),cover=el.classList.contains('activity-panel'),main=el.classList.contains('depth-0');
          const delay=cover?Math.min(Math.abs(Number(el.dataset.coverOffset)),5)*24:Math.min(270,Math.max(0,r.x-left)*.14)+i%3*14;
          const from=cover?{opacity:0,translate:`${main?innerWidth/2-r.x-r.width/2:(Number(el.dataset.coverOffset)<0?-1:1)*innerWidth*.55}px 0px`,scale:main?.15:.8}
            :{opacity:0,transform:'perspective(1100px) translateX(-84px) rotateY(-25deg) scale(.90)',transformOrigin:'left center'};
          const to=cover?{opacity:1,translate:'0px 0px',scale:1}:{opacity:1,transform:'perspective(1100px) translateX(0px) rotateY(0deg) scale(1)',transformOrigin:'left center'};
          motions.push(el.animate([from,to],{duration:620,delay,easing:'cubic-bezier(.12,.72,.18,1)',fill:'both'}));
        });
      }
      await Promise.allSettled(motions.map(a=>a.finished));if(!active)return false;finish();return true;
    }
    if(mode==='room' || mode==='back'){
      let active=true;const motions=[];
      const visible=el=>getComputedStyle(el).visibility!=='hidden';
      const finish=()=>{active=false;motions.forEach(a=>a.cancel());if(cleanup.current===finish){running.current=false;cleanup.current=()=>{}}};cleanup.current=finish;
      const before=[...root.current.querySelectorAll(selector)].filter(visible);
      before.forEach(el=>motions.push(el.animate([{opacity:1,filter:'blur(0px)'},{opacity:0,filter:'blur(2px)'}],{duration:150,easing:'ease-out',fill:'forwards'})));
      await Promise.allSettled(motions.map(a=>a.finished));if(!active)return false;
      flushSync(change);motions.forEach(a=>a.cancel());motions.length=0;
      [...root.current.querySelectorAll(incoming)].filter(visible).forEach(el=>motions.push(el.animate(
        [{opacity:0,transform:mode==='back'?'scale(1.025)':'translateY(12px) scale(.99)',filter:'blur(2px)'},{opacity:1,transform:'none',filter:'blur(0px)'}],
        {duration:480,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'})));
      await Promise.allSettled(motions.map(a=>a.finished));finish();return true;
    }
    const animations = [], clones = [], cloneLeases=[];
    const width = innerWidth, height = innerHeight;
    const visible = el => { const r=el.getBoundingClientRect(); return getComputedStyle(el).visibility!=='hidden' && r.width>0 && r.height>0 && r.right>0 && r.left<width && r.bottom>0 && r.top<height; };
    const sources = [...root.current.querySelectorAll(selector)].filter(visible).slice(0,40);
    sources.forEach((el,i) => {
      if(!el.currentSrc&&!el.getAttribute('src'))return;
      if(el.dataset.previewSource){const lease=previewQueue.acquire(el.dataset.previewSource,0);lease.promise.catch(()=>{});cloneLeases.push(lease)}
      const r=el.getBoundingClientRect(), copy=document.createElement('img');
      copy.dataset.sceneClone='true';copy.src=el.currentSrc || el.src; copy.alt=''; copy.setAttribute('aria-hidden','true');
      Object.assign(copy.style,{position:'fixed',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`,objectFit:getComputedStyle(el).objectFit,borderRadius:getComputedStyle(el).borderRadius,zIndex:'100',pointerEvents:'none',margin:'0'});
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
    const finish=()=>{animations.forEach(a=>a.cancel());clones.forEach(el=>{el.removeAttribute('src');el.remove();});cloneLeases.forEach(l=>l.release());if(cleanup.current===finish){running.current=false;cleanup.current=()=>{}}};
    cleanup.current=finish;
    await Promise.allSettled(animations.map(a=>a.finished));finish();
    return true;
  };
  animate.cancel=()=>cleanup.current();
  return animate;
}

// Keep encoded 4K previews only. Never prefetch NAS originals or retain decoded Image objects.
export function createActivityWarmup(api,id,endpoint) {
  const controller=new AbortController(), urls=new Map(), leases=[];
  const item={id,urls,data:null,dispose(){controller.abort();leases.forEach(l=>l.release());urls.clear();}};
  item.promise=(async()=>{
    const data=await api(endpoint || `/gallery/${id}?limit=15`,'GET',undefined,{signal:controller.signal});
    item.data=data;
    const previews=data.previews || data.items;
    let next=0;
    const timer=setTimeout(()=>{controller.abort();leases.forEach(l=>l.release());urls.clear()},8000);
    item.previewPromise=(async()=>{try {
      await Promise.allSettled(Array.from({length:4},async()=>{
        while(next<previews.length && !controller.signal.aborted) {
          const p=previews[next++];if(!p.preview)continue;
          try {const lease=previewQueue.acquire(p.preview,3);leases.push(lease);
            const url=await lease.promise;if(!controller.signal.aborted)urls.set(p.id,url);
          }catch{/* A failed preview must not prevent opening the activity. */}
        }
      }));
    } finally {clearTimeout(timer);}})();
    item.previewPromise.catch(()=>{});
    return data;
  })();
  item.promise.catch(()=>{});
  return item;
}
