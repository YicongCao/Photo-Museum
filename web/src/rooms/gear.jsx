import React,{useEffect} from 'react';
import {useRoomData,RoomStatus,collection} from './common';
import {CameraDrawing,drawing} from './gear-icons';
import './gear.css';
export function GearRoom({api,state,onState,onCollection,onPhoto,anchor}) {
 const kind=state.kind || 'camera',result=useRoomData(api,'/exhibitions/gear?kind='+kind),data=result.data?.kind===kind?result.data:null;
 const current=data?.devices.find(d=>d.id===state.selected?.[kind]) || data?.devices[0];
 const details=useRoomData(api,current?'/exhibitions/gear/'+current.id+'?pinned='+Boolean(state.pinned):null);
 const detail=details.data?.device?.id===current?.id?details.data:null,max=Math.max(1,...(detail?.years || []).map(y=>y.count)),glyph=drawing(current);
 useEffect(()=>{if(current && state.selected?.[kind]!==current.id)onState({...state,selected:{...state.selected,[kind]:current.id}})},[current?.id]);
 const openAll=()=>onCollection(collection(current.name,{[kind]:current.id,pinned:Boolean(state.pinned)},'器材馆'));
 return <section className="room gear-room" aria-label="器材展厅">
  <header className="room-heading"><div className="room-title"><h1>器材馆</h1></div>
   <div className="room-segments" aria-label="器材类型">{[['camera','相机'],['lens','镜头']].map(([id,name])=><button key={id} aria-pressed={kind===id} onClick={()=>onState({...state,kind:id})}>{name}</button>)}</div>
   <button aria-pressed={Boolean(state.pinned)} className="gear-pinned" onClick={()=>onState({...state,pinned:!state.pinned})}>☆ 已标记</button>
  </header>
  <div className="gear-layout"><aside className="device-list" aria-label="器材列表">
   {data?.devices.map(d=><button key={d.id} aria-pressed={d.id===current?.id} onClick={()=>onState({...state,selected:{...state.selected,[kind]:d.id}})}>
    <CameraDrawing device={d} decorative/><span>{d.name}<small>{d.count.toLocaleString()} 张照片{d.builtin?' · 内置':''}</small></span>
   </button>)}
  </aside><div className="gear-display" inert={details.loading || undefined} aria-busy={details.loading}>
   <div className="gear-apparatus">
   {current&&<div className="gear-device-heading"><CameraDrawing device={current}/><div><h2>{current.name}</h2><p>{detail?.count ?? current.count} 张照片 · {current.years.length?(current.years.length===1?current.years[0]:current.years[0]+' — '+current.years.at(-1)):'日期未详'}</p><small>{glyph.source?'结构示意':'类型示意'}</small></div><button onClick={openAll}>全部照片 ↗</button></div>}
   <div className="gear-statistics"><section className="gear-years"><h3>拍摄年份</h3><div className="gear-year-bars" aria-label="器材使用年份">
    {detail?.years.map(y=><button key={y.year} className={anchor?.startsWith(String(y.year))?'anchor-year':''} title={`${y.year} · ${y.count} 张照片`} onClick={()=>onCollection(collection(current.name,{[kind]:current.id,year:y.year,pinned:Boolean(state.pinned)},String(y.year)))}>
     <span className="gear-bar-count">{y.count}</span><i style={{height:Math.max(3,y.count/max*58)+'px'}}/><span>{y.year}</span>
    </button>)}
   </div></section><section className="gear-related"><h3>{kind==='camera'?'镜头':'相机'}</h3><div>{detail?.related.map(d=><button key={d.id} onClick={()=>onCollection(collection(d.name,{[kind]:current.id,[d.kind]:d.id,pinned:Boolean(state.pinned)},current.name))}>{d.name}<small>{d.count}</small></button>)}</div></section></div>
   </div>
   {detail?.selected.length>0?<div className="gear-photo-grid">{detail.selected.slice(0,5).map((p,i)=><button key={p.id} className={i===0?'gear-hero':''} onClick={()=>onPhoto(p)} aria-label={'查看 '+p.name}>
    <img src={i===0?p.preview:p.thumbnail} alt="" decoding="async"/><span>{p.score!=null?'技术分 '+p.score:'未评分'}</span>
   </button>)}</div>:current&&!details.loading&&<div className="gear-no-photos">{state.pinned?'暂无已标记照片':'暂无可展示照片'}</div>}
  </div></div>
  <footer className="room-footer"><span>{data?.devices.length || 0} {kind==='camera'?'种设备来源':'种镜头记录'}</span>{!!detail?.date_unknown&&<span>日期未详 {detail.date_unknown}</span>}</footer>
  <RoomStatus loading={result.loading || details.loading} error={result.error || details.error} retry={()=>{result.retry();details.retry()}} empty={!result.loading&&data?.devices.length===0}/>
 </section>;
}
