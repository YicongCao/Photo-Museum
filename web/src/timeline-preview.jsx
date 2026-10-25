import React, {useEffect,useState} from 'react';
import {planTimelineCollage} from './timeline-collage';

export function TimelinePreview({activity,anchor,closing,theme="dark"}) {
  const width=Math.min(336,innerWidth-24), height=236;
  const plan=planTimelineCollage(activity.selected,(width-18)/180);
  const [sources,setSources]=useState({});
  const [failed,setFailed]=useState({});
  const key=plan.photos.map(p=>p.id+'|'+p.thumbnail).join(',');
  useEffect(()=>{
    const controller=new AbortController(),urls=[];
    setSources({});setFailed({});
    plan.photos.forEach(async p=>{
      try {
        const response=await fetch(p.thumbnail,{signal:controller.signal});
        if(!response.ok)throw new Error('preview');
        const blob=await response.blob();if(controller.signal.aborted)return;
        const url=URL.createObjectURL(blob);urls.push(url);
        setSources(s=>({...s,[p.id]:url}));
      }catch{if(!controller.signal.aborted)setFailed(s=>({...s,[p.id]:true}));}
    });
    return ()=>{controller.abort();urls.forEach(url=>URL.revokeObjectURL(url));};
  },[key]);
  const clamp=(value,min,max)=>Math.max(min,Math.min(Math.max(min,max),value));
  const leftward=anchor.railLeft>=width+28;
  const left=leftward ? anchor.railLeft-width-16 : clamp(anchor.x+anchor.width/2-width/2,12,innerWidth-width-12);
  const top=leftward ? clamp(anchor.y+anchor.height/2-height/2,78,innerHeight-height-72)
    : clamp(anchor.y-height-16,78,innerHeight-height-72);
  const arrow=leftward ? clamp(anchor.y+anchor.height/2-top,18,height-18)
    : clamp(anchor.x+anchor.width/2-left,18,width-18);
  return <div id="timeline-photo-preview" role="tooltip" aria-label={`${activity.event.theme} · 评分前${plan.count}张照片`}
    data-activity={activity.id} data-photo-count={plan.count}
    data-theme={theme} className={`timeline-preview ${leftward ? 'from-left' : 'from-above'} ${closing ? 'closing' : ''}`}
    style={{left,top,width,height,'--preview-arrow':`${arrow}px`}}>
    <div className={`timeline-preview-mosaic layout-${plan.count}`} aria-busy={plan.photos.some(p=>!sources[p.id]&&!failed[p.id])}>
      {plan.photos.map((p,i)=><div className={`timeline-preview-cell preview-cell-${i}`} key={p.id} data-score={p.score}>
        {sources[p.id] && !failed[p.id] ? <img src={sources[p.id]} alt="" decoding="async" onError={()=>setFailed(s=>({...s,[p.id]:true}))}/> :
          <span className={failed[p.id] ? 'preview-unavailable' : 'preview-loading'}>{failed[p.id] ? '暂不可用' : ''}</span>}
      </div>)}
      {!plan.count && <span className="timeline-preview-empty">{activity.unscored ? '评分中' : '暂无精选照片'}</span>}
    </div>
    <div className="timeline-preview-label"><span>{activity.event.theme}</span><small>{activity.event.year}{activity.event.month ? ` · ${String(activity.event.month).padStart(2,'0')}` : ''}</small></div>
  </div>;
}
