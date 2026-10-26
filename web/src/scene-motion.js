import {markTransitionPhase} from './transition-diagnostics';
import {previews as previewQueue} from './preview-queue';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

// One shared timeline, bounded to visible images; no canvas or persistent clone cache.
export function useSceneMotion(root) {
  const running = useRef(false), cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), []);
  const animate = async (selector, change, incoming, mode='scatter') => {
    markTransitionPhase('motion-start');
    if (running.current) cleanup.current();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { flushSync(change); return true; }
    running.current = true;
    if(mode==='photo-next'||mode==='photo-previous'){
      let active=true;const motions=[],sign=mode==='photo-next'?-1:1;
      const finish=()=>{active=false;motions.forEach(a=>a.cancel());if(cleanup.current===finish){running.current=false;cleanup.current=()=>{}}};cleanup.current=finish;
      const turn=async(from,to,duration)=>{const el=root.current?.querySelector('.image-stack');if(!el)return;
        const motion=el.animate([{transform:`perspective(1400px) rotateY(${from}deg)`},{transform:`perspective(1400px) rotateY(${to}deg)`}],{duration,easing:'cubic-bezier(.4,0,.6,1)',fill:'both'});
        motions.push(motion);await Promise.allSettled([motion.finished]);};
      await turn(0,sign*90,150);if(!active)return false;
      flushSync(change);motions.forEach(a=>a.cancel());motions.length=0;
      await turn(-sign*90,0,180);if(!active)return false;finish();return true;
    }
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
          const r=el.getBoundingClientRect(),main=el.classList.contains('depth-0'),cover=el.classList.contains('activity-panel'),viewer=el.classList.contains('viewer-image-area')||el.classList.contains('metadata-panel');
          const dx=cover?(main?innerWidth/2-r.x-r.width/2:(Number(el.dataset.coverOffset)<0?-1:1)*innerWidth*.65):70;
          motions.push(el.animate([{translate:'0px 0px',scale:1,opacity:1},{translate:`${viewer?0:dx}px 0px`,scale:viewer?1:main?.15:cover?.85:.94,opacity:0}],
            {duration:mode==='cover-wall'?180:160,delay:cover?0:Math.min(i,12)*3,easing:'cubic-bezier(.55,0,.8,.4)',fill:'forwards'}));
        });
        await Promise.allSettled(motions.map(a=>a.finished));if(!active)return false;
        markTransitionPhase('before-commit');flushSync(change);markTransitionPhase('after-commit');motions.forEach(a=>a.cancel());motions.length=0;
        const next=find(incoming).sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x||a.getBoundingClientRect().y-b.getBoundingClientRect().y);
        const left=next[0]?.getBoundingClientRect().x || 0;
        next.forEach((el,i)=>{
          const r=el.getBoundingClientRect(),cover=el.classList.contains('activity-panel'),main=el.classList.contains('depth-0');
          const delay=cover?Math.min(Math.abs(Number(el.dataset.coverOffset)),5)*16:Math.min(100,Math.max(0,r.x-left)*.06)+i%3*8;
          // Keep the tunnel's layout-owned perspective throughout the transition.
          const space=el.classList.contains('spacetime-board');
          const from=space?{opacity:0,translate:'60px 0px',scale:.92}:cover?{opacity:0,translate:`${main?innerWidth/2-r.x-r.width/2:(Number(el.dataset.coverOffset)<0?-1:1)*innerWidth*.55}px 0px`,scale:main?.15:.8}
            :{opacity:0,transform:'perspective(1100px) translateX(-84px) rotateY(-25deg) scale(.90)',transformOrigin:'left center'};
          const to=(cover||space)?{opacity:1,translate:'0px 0px',scale:1}:{opacity:1,transform:'perspective(1100px) translateX(0px) rotateY(0deg) scale(1)',transformOrigin:'left center'};
          motions.push(el.animate([from,to],{duration:420,delay,easing:'cubic-bezier(.12,.72,.18,1)',fill:'both'}));
        });
      }
      markTransitionPhase('incoming-ready');await Promise.allSettled(motions.map(a=>a.finished));if(!active)return false;markTransitionPhase('motion-finished');finish();return true;
    }
    if(mode==='room' || mode==='back'){
      let active=true;const motions=[];
      const visible=el=>getComputedStyle(el).visibility!=='hidden';
      const finish=()=>{active=false;motions.forEach(a=>a.cancel());if(cleanup.current===finish){running.current=false;cleanup.current=()=>{}}};cleanup.current=finish;
      const before=[...root.current.querySelectorAll(selector)].filter(visible);
      before.forEach(el=>motions.push(el.animate([{opacity:1,filter:'blur(0px)'},{opacity:0,filter:'blur(2px)'}],{duration:150,easing:'ease-out',fill:'forwards'})));
      await Promise.allSettled(motions.map(a=>a.finished));if(!active)return false;
      markTransitionPhase('before-commit');flushSync(change);markTransitionPhase('after-commit');motions.forEach(a=>a.cancel());motions.length=0;
      [...root.current.querySelectorAll(incoming)].filter(visible).forEach(el=>motions.push(el.animate(
        [{opacity:0,transform:mode==='back'?'scale(1.025)':'translateY(12px) scale(.99)',filter:'blur(2px)'},{opacity:1,transform:'none',filter:'blur(0px)'}],
        {duration:480,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'})));
      await Promise.allSettled(motions.map(a=>a.finished));finish();return true;
    }
    const animations = [], clones = [], cloneLeases=[];
    const width = innerWidth, height = innerHeight;
    const visible = el => { const r=el.getBoundingClientRect(); return getComputedStyle(el).visibility!=='hidden' && r.width>0 && r.height>0 && r.right>0 && r.left<width && r.bottom>0 && r.top<height; };
    const sources = [...root.current.querySelectorAll(selector)].filter(el=>{if(el.classList.contains('wall-thumb'))return visible(el.closest('.wall-photo'));return visible(el)}).filter(el=>{
      if(!el.naturalWidth)return false;
      const tile=el.closest('.wall-photo');
      if(!tile)return true;
      const thumb=tile.querySelector('.wall-thumb'),display=tile.querySelector('.wall-display.ready');
      return el===(thumb?.naturalWidth?thumb:display);
    }).slice(0,24);
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
      animations.push(copy.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx/distance*reach}px,${dy/distance*reach}px) scale(1.12) rotate(${i%2 ? 7:-7}deg)`,opacity:0}],{duration:420,easing:'cubic-bezier(.45,0,.8,.3)',fill:'forwards'}));
    });
    markTransitionPhase('before-commit');flushSync(change);markTransitionPhase('after-commit');
    const targets=[...root.current.querySelectorAll(incoming)].filter(visible).slice(0,40);
    targets.forEach((el,i)=>{
      const r=el.getBoundingClientRect();
      const archive=el.classList.contains('metadata-panel');
      animations.push(el.animate(archive ? [{opacity:0,transform:'translateX(18px)'},{opacity:1,transform:'none'}] : [
        {opacity:0,transform:`translate(${width/2-r.x-r.width/2}px,${height/2-r.y-r.height/2}px) scale(.08)`},
        {opacity:1,transform:'translate(0,0) scale(1)'}],
        {duration:480,delay:40+Math.min(i,14)*8,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'}));
    });
    const finish=()=>{animations.forEach(a=>a.cancel());clones.forEach(el=>{el.removeAttribute('src');el.remove();});cloneLeases.forEach(l=>l.release());if(cleanup.current===finish){running.current=false;cleanup.current=()=>{}}};
    cleanup.current=finish;
    markTransitionPhase('incoming-ready');await Promise.allSettled(animations.map(a=>a.finished));markTransitionPhase('motion-finished');finish();
    return true;
  };
  animate.cancel=()=>cleanup.current();
  return animate;
}

// Keep encoded 4K previews only. Never prefetch NAS originals or retain decoded Image objects.
export function createActivityWarmup(api,id,endpoint) {
  const controller=new AbortController(), urls=new Map(), leases=[];
  const item={id,urls,data:null,promote(){if(item.promoted)return;item.promoted=true;for(const p of item.data?.items || []){if(p.thumbnail){const l=previewQueue.acquire(p.thumbnail,0);leases.push(l);l.promise.catch(()=>{})}}},dispose(){controller.abort();leases.forEach(l=>l.release());urls.clear();}};
  item.promise=(async()=>{
    const data=await api(endpoint || `/gallery/${id}?limit=15`,'GET',undefined,{signal:controller.signal});
    item.data=data;
    for(const p of data.items){if(p.thumbnail){const l=previewQueue.acquire(p.thumbnail,3);leases.push(l);l.promise.catch(()=>{})}}
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
