import {PreviewImage,PreviewSVG} from '../preview-image';
import React,{useId,useMemo} from 'react';
import {useRoomData,RoomStatus} from './common';
import {ringGeometry} from './radial-layout';
import './rings.css';

const title=a=>a?.label || a?.title || a?.event?.theme || '未命名活动';
function descriptor(kind,key,label,year){return {id:`creative-${kind}-${key}-${year || ''}`,title:label,dateLabel:year?String(year):'人生年轮',endpoint:'/exhibitions/creative/photos?'+new URLSearchParams({kind,key,...(year?{year}:{})})}}

function ActivityPictures({api,activity,year,onPhoto}){
 const matches=p=>p.activity_id===activity.id&&(p.period || '').slice(0,4)===String(year).padStart(4,'0');
 const selected=(activity.selected || []).filter(matches);
 const result=useRoomData(api,selected.length?null:'/exhibitions/creative/photos?'+new URLSearchParams({kind:'chapter',key:activity.id,year:String(year),sort:'score',limit:'3'}));
 const photos=selected.length?selected:(result.data?.items || []).filter(matches);
 return <div className="rings-detail-images" data-preview-activity={activity.id} aria-busy={!selected.length&&result.loading}>
  {photos.slice(0,3).map(p=><button key={p.id} data-asset={p.id} aria-label={'查看 '+p.name} onClick={()=>onPhoto(p,photos.slice(0,3))}><PreviewImage src={p.preview || p.thumbnail} alt="" decoding="async"/></button>)}
  {!selected.length&&<RoomStatus {...result} empty={!result.loading&&!photos.length}/>}
 </div>;
}

export function RingsRoom({api,state={},onState,onCollection,onPhoto}){
 const result=useRoomData(api,'/exhibitions/creative'),data=result.data,years=data?.years || [];
 const selected=years.find(y=>String(y.year)===String(state.year)) || years[0],year=selected?.year;
 const activity=selected?.activities?.find(a=>a.id===state.activity) || selected?.activities?.[0];
 const rings=useMemo(()=>ringGeometry(years,year),[years,year]),prefix=useId().replaceAll(':','');
 const choose=(y,a)=>onState({...state,year:y,activity:a?.id || null});
 const selectedIndex=years.findIndex(y=>y.year===year);
 const openYear=()=>year&&onCollection(descriptor('year',String(year),String(year)));
 return <section className="room rings-room" aria-label="人生年轮展厅">
  <header className="rings-toolbar"><span className="rings-room-label">人生年轮</span>
   <div className="rings-year-navigation"><button aria-label="较新的年份" disabled={selectedIndex<=0} onClick={()=>choose(years[selectedIndex-1].year)}>‹</button>
    <select aria-label="年轮年份" value={year || ''} onChange={e=>choose(Number(e.target.value))}>{!years.length&&<option value="">—</option>}{years.map(y=><option key={y.year} value={y.year}>{y.year}</option>)}</select>
    <button aria-label="较早的年份" disabled={selectedIndex<0||selectedIndex>=years.length-1} onClick={()=>choose(years[selectedIndex+1].year)}>›</button>
   </div>
   {!!data?.unknown&&<button className="rings-unknown" onClick={()=>onCollection(descriptor('year','unknown','日期未详'))}>日期未详 {data.unknown}</button>}
  </header>
  <div className="rings-layout">
   <div className="rings-scene">
    <svg viewBox="0 0 1000 1000" className="rings-art" role="group" aria-label="年度照片环">
     <defs>{rings.flatMap(r=>r.photos.map((item,i)=><clipPath id={`${prefix}-${r.year.year}-${i}`} key={`${r.year.year}-${i}`}><path d={item.path}/></clipPath>))}</defs>
     {rings.map((ring,ri)=><g key={ring.year.year} className={'year-ring '+(ring.year.year===year?'selected-ring':'')} data-year={ring.year.year}>
      <circle cx="464" cy="500" r={(ring.inner+ring.outer)/2} className="ring-track" strokeWidth={ring.outer-ring.inner}/>
      {ring.photos.map((item,i)=><g className={'ring-photo '+(ring.year.year===year&&item.activity?.id===activity?.id?'selected-sector':'')}
       key={item.photo.id} role="button" tabIndex={0} aria-pressed={ring.year.year===year&&item.activity?.id===activity?.id}
       aria-label={`${ring.year.year} · ${title(item.activity)} · 选择活动`} onClick={()=>choose(ring.year.year,item.activity)}
       onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(ring.year.year,item.activity)}}}>
       <PreviewSVG href={item.photo.thumbnail} x={item.x} y={item.y} width={item.width} height={item.height} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${prefix}-${ring.year.year}-${i})`}/>
       <path d={item.path} className="ring-photo-outline"/>
      </g>)}
      <g className="ring-year-label" role="button" tabIndex={0} aria-label={'选择 '+ring.year.year+' 年'} onClick={()=>choose(ring.year.year)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(ring.year.year)}}}>
       <path d={`M ${464+ring.outer*.87} ${500-ring.outer*.49} L 929 ${120+ri*125}`}/><circle cx="929" cy={120+ri*125} r="3"/><text x="942" y={126+ri*125}>{ring.year.year}</text>
      </g>
     </g>)}
     <g className="rings-center"><text x="464" y="493" textAnchor="middle">{year || (data?.unknown?'日期未详':'—')}</text><path d="M444 517 H484"/><text className="rings-center-count" x="464" y="548" textAnchor="middle">{(selected?.count || data?.unknown || 0).toLocaleString()} 张照片</text></g>
    </svg>
   </div>
   <aside className="rings-detail" aria-label="年轮活动">
    <div className="rings-detail-heading"><div><small>{activity?.period || year || '—'}</small><h1>{activity?title(activity):year?`${year} 年`:'日期未详'}</h1></div>
     <button className="rings-open" aria-label="展开活动照片" disabled={!activity} onClick={()=>onCollection(descriptor('chapter',activity.id,title(activity),year))}>↗</button>
    </div>
    {(selected?.activities?.length || 0)>1&&<select className="rings-activity-select" aria-label="年轮活动" value={activity?.id || ''} onChange={e=>choose(year,selected.activities.find(a=>a.id===e.target.value))}>{selected.activities.map(a=><option key={a.id} value={a.id}>{title(a)}</option>)}</select>}
    {activity?<ActivityPictures key={`${year}-${activity.id}`} api={api} activity={activity} year={year} onPhoto={onPhoto}/>:<div className="rings-detail-images"/>}
    <div className="rings-detail-footer"><span>{activity?.count || selected?.count || 0} 张照片{data?.sample_records_omitted>0?' · 预览限量':''}</span><button disabled={!year} onClick={openYear}>{year} 全部 ↗</button></div>
   </aside>
  </div>
  <RoomStatus {...result} empty={data?.total===0}/>
 </section>;
}
