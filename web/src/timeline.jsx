import React, { useEffect, useRef, useState } from "react";

import {createPortal} from "react-dom";
import {TimelinePreview} from "./timeline-preview";
import {TimelineSurface} from "./timeline-surface";

const monthLabels=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function ActivityTimeline({ activities, index, onSelect, theme="dark", material=false }) {
  const root = useRef(null), frame = useRef(0), pointer = useRef(null),pointerFocus=useRef(false);
  const [preview,setPreview]=useState(null);
  const showTimer=useRef(null),closeTimer=useRef(null),removeTimer=useRef(null),pendingFocus=useRef(null);
  const closePreview=()=>{
    pendingFocus.current=null;
    clearTimeout(showTimer.current);clearTimeout(closeTimer.current);clearTimeout(removeTimer.current);
    setPreview(p=>p ? {...p,closing:true} : null);
    removeTimer.current=setTimeout(()=>setPreview(null),matchMedia('(prefers-reduced-motion:reduce)').matches ? 0 : 160);
  };
  const leavePreview=()=>{
    pendingFocus.current=null;
    clearTimeout(showTimer.current);clearTimeout(closeTimer.current);
    closeTimer.current=setTimeout(closePreview,70);
  };
  const showPreview=(activity,element,keyboard=false)=>{
    pendingFocus.current=keyboard ? {activity,element} : null;
    clearTimeout(showTimer.current);clearTimeout(closeTimer.current);clearTimeout(removeTimer.current);
    const switching=preview && preview.activity.id!==activity.id;
    if(switching)setPreview(p=>p ? {...p,closing:true} : null);
    showTimer.current=setTimeout(()=>{
      pendingFocus.current=null;
      if(!element.isConnected)return;
      const r=element.getBoundingClientRect(),rail=root.current.getBoundingClientRect();
      setPreview({activity,anchor:{x:r.x,y:r.y,width:r.width,height:r.height,railLeft:rail.left},closing:false});
    },switching ? 160 : 110);
  };
  const groups = [];
  activities.forEach((activity, i) => {
    const year = activity.event.year || "未知年份";
    const month = activity.event.month || "年度";
    let y = groups.find((g) => g.year === year);
    if (!y) groups.push(y = { year, months: [] });
    let m = y.months.find((g) => g.month === month);
    if (!m) y.months.push(m = { month, items: [] });
    m.items.push({ activity, i });
  });
  const reset = () => {
    pointer.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    root.current?.querySelectorAll("[data-dock]").forEach((el) => el.style.removeProperty("--dock"));
  };
  useEffect(()=>()=>{cancelAnimationFrame(frame.current);clearTimeout(showTimer.current);clearTimeout(closeTimer.current);clearTimeout(removeTimer.current);},[]);
  useEffect(()=>{
    const dismiss=e=>{if(e.key==='Escape')closePreview();};
    const resize=()=>closePreview();
    window.addEventListener('keydown',dismiss);window.addEventListener('resize',resize);
    return ()=>{window.removeEventListener('keydown',dismiss);window.removeEventListener('resize',resize);};
  },[]);
  useEffect(()=>{
    const node=root.current;let timer;
    const reveal=()=>{
      if(!pointerFocus.current && node?.contains(document.activeElement) && document.activeElement.matches(':focus-visible'))return;
      const item=node?.querySelector('button[aria-current="true"]');if(!item)return;
      // The narrow layout has two independent scrollers: month items and the year rail.
      for(const container of [item.closest('.timeline-month-group'),node]){
        const r=item.getBoundingClientRect(),b=container.getBoundingClientRect(),style=getComputedStyle(container);
        const horizontal=/(auto|scroll)/.test(style.overflowX),vertical=/(auto|scroll)/.test(style.overflowY);
        const left=horizontal?(r.left<b.left?r.left-b.left:r.right>b.right?r.right-b.right:0):0;
        const top=vertical?(r.top<b.top?r.top-b.top:r.bottom>b.bottom?r.bottom-b.bottom:0):0;
        if(left||top)container.scrollBy({left,top,behavior:'instant'});
      }
    };
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(reveal,180)};
    const observer=new ResizeObserver(schedule);observer.observe(node);schedule();
    return()=>{clearTimeout(timer);observer.disconnect()};
  },[index,activities[index]?.id,activities.length,material]);
  const magnify = (e) => {
    if (e.pointerType === "touch" || !matchMedia("(hover: hover)").matches) return;
    pointer.current = e.clientY;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const y = pointer.current;
      if (y == null) return;
      root.current.querySelectorAll("[data-dock]").forEach((el) => {
        // Measure untransformed hit areas so scaling never chases its own geometry.
        const r = el.getBoundingClientRect();
        const distance = Math.abs(y - (r.top + r.height / 2));
        const weight = Math.max(0, 1 - distance / 82);
        el.style.setProperty("--dock", (weight * weight).toFixed(3));
      });
    });
  };
  const rail=<aside ref={root} className="activity-timeline dock-timeline" aria-label="活动时间线"
    onPointerDown={()=>{pointerFocus.current=true;}} onKeyDown={()=>{pointerFocus.current=false;}} onBlur={()=>{pointerFocus.current=false;}}
    onPointerMove={magnify} onPointerLeave={()=>{reset();leavePreview();}} onScroll={()=>{
      // Native focus can scroll both narrow-layout rails before its preview opens.
      const focused=pendingFocus.current;
      reset();closePreview();
      if(focused && document.activeElement===focused.element)showPreview(focused.activity,focused.element,true);
    }}>
    {groups.map((year) => <section className="timeline-year-group" key={year.year} aria-label={String(year.year)}>
      <h2 data-dock className={"timeline-year " + (activities[index]?.event.year === year.year ? "selected" : "")}><span className="dock-label">{year.year}</span></h2>
      {year.months.map((month) => <section className="timeline-month-group" key={month.month} aria-label={month.month === "年度" ? "年度" : `${month.month}月`}>
        <h3 data-dock className="timeline-month"><span className="dock-label">{monthLabels[Number(month.month)-1] || month.month}</span></h3>
        <ul>{month.items.map(({activity, i}) => <li data-dock key={activity.id}>
          <button aria-current={i === index ? "true" : undefined} className={i === index ? "selected" : ""}
            aria-describedby={preview?.activity.id===activity.id && !preview.closing ? 'timeline-photo-preview' : undefined}
            onPointerEnter={e=>{if(e.pointerType!=='touch')showPreview(activity,e.currentTarget);}}
            onPointerLeave={leavePreview} onFocus={e=>showPreview(activity,e.currentTarget,true)} onBlur={leavePreview}
            onClick={()=>{closePreview();onSelect(i);}}>
            <span className="dock-label"><span className="timeline-dot"/>{activity.event.theme}</span>
          </button>
        </li>)}</ul>
      </section>)}
    </section>)}
  </aside>;
  return <>{material?<div className="timeline-glass-frame"><TimelineSurface source={activities[index]?.selected?.[0]?.thumbnail}/>{rail}</div>:rail}{preview && createPortal(<TimelinePreview key={preview.activity.id} activity={preview.activity} anchor={preview.anchor} closing={preview.closing} theme={theme}/>,document.body)}</>;
}
