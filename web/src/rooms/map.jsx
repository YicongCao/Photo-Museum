import {PreviewImage} from '../preview-image';
import {StatusNotice} from '../system-status';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {geoNaturalEarth1,geoPath} from 'd3-geo';
import {useRoomData,RoomStatus,collection} from './common';

const initial={k:1,x:0,y:0},clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function MapRoom({api,state,onState,onCollection}) {
 const result=useRoomData(api,'/exhibitions/map'+(state.parent?'?parent='+encodeURIComponent(state.parent):''));
 const [world,setWorld]=useState(null),[worldError,setWorldError]=useState(false),[transform,setTransform]=useState(state.transform || initial),[screenScale,setScreenScale]=useState(1);
 const [previewId,setPreviewId]=useState(null);
 const svg=useRef(null),points=useRef(new Map()),gesture=useRef(null),suppress=useRef(false),latest=useRef(transform),saveTimer=useRef(null),stateRef=useRef(state);
 latest.current=transform;stateRef.current=state;
 const data=result.data;
 const preview=data?.groups.find(g=>g.id===previewId) || data?.groups[0],largest=Math.max(1,...(data?.groups || []).map(g=>g.count));
 useEffect(()=>{let stopped=false;import('./world.json').then(m=>{if(!stopped)setWorld(m.default)}).catch(()=>{if(!stopped)setWorldError(true)});return()=>{stopped=true;clearTimeout(saveTimer.current)}},[]);
 const projection=useMemo(()=>geoNaturalEarth1().fitExtent([[18,18],[1032,522]],{type:'Sphere'}),[]);
 const paths=useMemo(()=>world?.features.map(f=>({id:f.properties.ADM0_A3,path:geoPath(projection)(f)})) || [],[world,projection]);
 const xy=(x,y)=>{const point=svg.current.createSVGPoint();point.x=x;point.y=y;return point.matrixTransform(svg.current.getScreenCTM().inverse())};
 const update=t=>{latest.current=t;setTransform(t)};
 const zoom=(factor,p={x:525,y:270})=>{
  const old=latest.current,k=clamp(old.k*factor,1,16),ratio=k/old.k;
  const next=k===1?initial:{k,x:p.x-(p.x-old.x)*ratio,y:p.y-(p.y-old.y)*ratio};update(next);return next;
 };
 const save=t=>onState({...stateRef.current,transform:t});
 useEffect(()=>{
  const node=svg.current;
  const measure=()=>setScreenScale(node.getScreenCTM()?.a || 1);
  const ro=new ResizeObserver(measure);ro.observe(node);measure();
  const wheel=e=>{e.preventDefault();const next=zoom(Math.exp(-e.deltaY*.002),xy(e.clientX,e.clientY));clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>save(next),180)};
  node.addEventListener('wheel',wheel,{passive:false});
  return()=>{ro.disconnect();node.removeEventListener('wheel',wheel);clearTimeout(saveTimer.current)};
 },[]);
 const enter=group=>{
  if(data?.level==='activities'){
   onCollection(collection(group.label,{place:data.parent,activity:group.id},data.breadcrumbs.at(-1)?.label || '地图'));return;
  }
  const p=projection([group.longitude,group.latitude]),k=Math.min(12,latest.current.k*2.2),next={k,x:525-p[0]*k,y:270-p[1]*k};
  update(next);onState({...state,parent:group.id,transform:next});
 };
 const parent=id=>{update(initial);onState({...state,parent:id,transform:initial})};
 const down=e=>{
  if(e.button!==0)return;
  suppress.current=false;points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const a=[...points.current.values()];gesture.current={start:a,view:latest.current};
 };
 const move=e=>{
  if(!points.current.has(e.pointerId))return;
  points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const a=[...points.current.values()],g=gesture.current;
  if(!g)return;
  if(a.length>1&&g.start.length>1){
   for(const id of points.current.keys())e.currentTarget.setPointerCapture(id);
   const before=Math.hypot(g.start[0].x-g.start[1].x,g.start[0].y-g.start[1].y),after=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
   const origin=xy((g.start[0].x+g.start[1].x)/2,(g.start[0].y+g.start[1].y)/2),now=xy((a[0].x+a[1].x)/2,(a[0].y+a[1].y)/2);
   const k=clamp(g.view.k*after/Math.max(1,before),1,16),ratio=k/g.view.k;
   update({k,x:now.x-(origin.x-g.view.x)*ratio,y:now.y-(origin.y-g.view.y)*ratio});suppress.current=true;
  }else{
   const origin=xy(g.start[0].x,g.start[0].y),now=xy(a[0].x,a[0].y),dx=now.x-origin.x,dy=now.y-origin.y;
   if(Math.abs(dx)+Math.abs(dy)>4){suppress.current=true;e.currentTarget.setPointerCapture(e.pointerId)}
   update({...g.view,x:g.view.x+dx,y:g.view.y+dy});
  }
 };
 const up=e=>{points.current.delete(e.pointerId);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);gesture.current=null;save(latest.current)};
 const label={country:'国家',province:'省份',city:'城市',activities:'活动'}[data?.level] || '地点';
 return <section className="room map-room" aria-label="地图展厅">
  <header className="room-heading"><div className="room-title"><h1>{data?.breadcrumbs.at(-1)?.label || '世界'}</h1></div>
   <div className="map-breadcrumbs"><button onClick={()=>parent(null)}>世界</button>{data?.breadcrumbs.map(b=><button key={b.id} onClick={()=>parent(b.id)}>{b.label}</button>)}</div>
  </header>
  <div className="map-layout">
   <div className="map-surface">
    {worldError&&<StatusNotice className="map-load-error" error="底图未载入" onRetry={()=>location.reload()}/>}
    <svg ref={svg} viewBox="0 0 1050 540" role="group" aria-label="离线照片地图" tabIndex={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const t=latest.current;const next={...t,x:t.x+(e.key==='ArrowLeft'?35:e.key==='ArrowRight'?-35:0),y:t.y+(e.key==='ArrowUp'?35:e.key==='ArrowDown'?-35:0)};update(next);save(next)}}}>
     <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
      {paths.map(p=><path className="world-country" key={p.id} d={p.path}/>)}
      {data?.groups.map(g=>{const p=projection([g.longitude,g.latitude]),unit=1/(transform.k*screenScale);return <g key={g.id} transform={`translate(${p[0]} ${p[1]})`} className="map-marker" role="button" tabIndex={0}
       aria-label={`${g.label} · ${g.count} 张照片`} onPointerEnter={()=>setPreviewId(g.id)} onFocus={()=>setPreviewId(g.id)} onClick={e=>{e.stopPropagation();if(!suppress.current || e.detail===0)enter(g)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();enter(g)}}}>
       <circle r={22*unit} fill="transparent" stroke="none"/><circle className="marker-dot" r={Math.min(22,11+Math.log2(g.count+1))*unit}/>
       <text textAnchor="middle" dominantBaseline="central" fontSize={11*unit}>{g.count}</text><title>{g.label} · 聚合位置 · 最近城市</title>
      </g>})}
     </g>
    </svg>
    {preview?.cover&&<button className="map-photo-preview" onClick={()=>enter(preview)} aria-label={'进入 '+preview.label}>
     <PreviewImage key={preview.id} src={preview.cover.thumbnail} alt="" decoding="async"/><span>{preview.label}<small>{preview.count.toLocaleString()} 张照片</small><b aria-hidden="true">↗</b></span>
    </button>}
    <div className="map-zoom"><button aria-label="放大地图" onClick={()=>save(zoom(1.6))}>＋</button><button aria-label="缩小地图" onClick={()=>save(zoom(1/1.6))}>−</button><button aria-label="重置地图" onClick={()=>{update(initial);save(initial)}}>↺</button></div>
    <div className="map-credit"><a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">Natural Earth</a> · <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> · 离线 · WGS84</div>
   </div>
   <aside className="map-place-panel">
    <div className="map-panel-heading"><h2>{label}</h2><span>{data?.count || 0} 张</span></div>
    <p className="map-precision">最近城市{data?.estimated>0&&` · ${data.estimated} 张推断位置`}</p>
    {data?.parent&&<button className="room-primary" onClick={()=>onCollection(collection(data.breadcrumbs.at(-1).label,{place:data.parent},'地图'))}>全部 {data.count} 张照片 ↗</button>}
    <div className="place-list">{data?.groups.map(g=><button key={g.id} className={preview?.id===g.id?'place-preview-active':''} onPointerEnter={()=>setPreviewId(g.id)} onFocus={()=>setPreviewId(g.id)} onClick={()=>enter(g)}>
      {g.cover&&<PreviewImage src={g.cover.thumbnail} alt="" loading="lazy"/>}<span className="place-row-label">{g.label}<small>{g.count.toLocaleString()} 张照片</small><i className="place-count-track" aria-hidden="true"><i style={{width:(g.count/largest*100)+'%'}}/></i></span><span aria-hidden="true">↗</span>
    </button>)}{data?.groups.length===0&&!result.loading&&<p>暂无有效定位</p>}</div>
   </aside>
  </div>
  <footer className="room-footer">
   {!!data?.missing_gps&&<button onClick={()=>onCollection(collection('未定位照片',{missing_gps:true},'地图'))}>未定位 {data.missing_gps}</button>}
   {!!data?.unresolved&&<button onClick={()=>onCollection(collection('地址未解析',{unresolved_gps:true},'地图'))}>地址未解析 {data.unresolved}</button>}
  </footer>
  <RoomStatus {...result}/>
 </section>;
}
