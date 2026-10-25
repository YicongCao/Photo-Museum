import React,{useEffect} from 'react';
import {useRoomData,RoomStatus,collection,stepPeriod} from './common';
import {Icon} from '../icons';

export function CalendarRoom({api,anchor,setAnchor,state,onState,onCollection}) {
 const wanted=state.scale || (anchor?.length===4?'year':'month');
 const result=useRoomData(api,'/exhibitions/calendar?'+new URLSearchParams({...(anchor?{anchor}:{}),scale:wanted}));
 const data=result.data,current=anchor || data?.anchor,scale=data?.scale || wanted;
 const years=[...new Set([...(data?.years || []),...(current?[Number(current.slice(0,4))]:[])])].sort((a,b)=>b-a);
 const knownMonth=scale==='year'?data?.cells.filter(c=>c.count>0).at(-1)?.period:null;
 useEffect(()=>{if(!anchor && data?.anchor){setAnchor(data.anchor);if(data.anchor.length===4)onState({...state,scale:'year'})}},[data?.anchor,anchor]);
 const changeScale=s=>{onState({...state,scale:s});if(s==='year'&&current)setAnchor(current.slice(0,4));else if(current?.length===4&&knownMonth)setAnchor(knownMonth)};
 const open=c=>{
  if(!c.count)return;
  if(scale==='year'){setAnchor(c.period);onState({...state,scale:'month'});return}
  setAnchor(c.period);onCollection(collection(c.period.replaceAll('-',' · '),{day:c.period},'日历'));
 };
 return <section className={'room calendar-room calendar-'+scale} aria-label="日历展厅">
  <header className="room-heading">
   <div className="room-title"><h1>{(data?.anchor || current || '—').slice(0,scale==='year'?4:7).replace('-',' · ')}</h1></div>
   <div className="calendar-navigation">
    <button aria-label="上一时段" disabled={!current} onClick={()=>setAnchor(stepPeriod(current,scale,-1))}>〈</button>
    <select aria-label="年份" value={(current || '').slice(0,4)} onChange={e=>{setAnchor(e.target.value);onState({...state,scale:'year'})}}>
     {!years.length&&<option value="">—</option>}{years.map(y=><option key={y}>{y}</option>)}
    </select>
    <button aria-label="下一时段" disabled={!current} onClick={()=>setAnchor(stepPeriod(current,scale,1))}>〉</button>
   </div>
   <div className="room-segments" aria-label="日历粒度">{[['year','年'],['month','月'],['week','周']].map(([s,label])=><button key={s} aria-pressed={scale===s} disabled={s!=='year'&&scale==='year'&&!knownMonth} onClick={()=>changeScale(s)}>{label}</button>)}</div>
  </header>
  {scale!=='year'&&<div className="calendar-weekdays" aria-hidden="true">{'一二三四五六日'.split('').map(d=><span key={d}>{d}</span>)}</div>}
  <div className="calendar-grid" aria-busy={result.loading} inert={result.loading || undefined}>
   {data?.cells.map(c=><button className={'calendar-cell '+(c.period===current?'is-selected ':'')+(!c.period.startsWith(data.anchor.slice(0,7))&&scale==='month'?'outside-month':'')}
     key={c.period} aria-label={c.period+' · '+c.count+' 张照片'} disabled={!c.count} onClick={()=>open(c)}>
     {c.cover&&<img src={c.cover.thumbnail} alt="" decoding="async"/>}
     <span className="calendar-date">{scale==='year'?Number(c.period.slice(5,7))+' 月':Number(c.period.slice(8,10))}</span>
     {c.count>0&&<span className="calendar-count"><Icon name="photo"/>{c.count}{c.estimated>0&&<span title="包含接受的推断日期"> ◇</span>}</span>}
   </button>)}
  </div>
  <footer className="room-footer">
   <span>{data?.total?.toLocaleString() || 0} 张照片</span>
   {!!data?.period_unknown&&<button onClick={()=>onCollection(collection('日期未详',scale==='year'?{year:Number(current.slice(0,4)),undated:'period'}:{month:current.slice(0,7),undated:'period'},scale==='year'?current.slice(0,4):current.slice(0,7)))}>{scale==='year'?'年内':'本月'}日期未详 {data.period_unknown}</button>}
   {!!data?.undated&&<button onClick={()=>onCollection(collection('日期未详',{undated:'all'},'日历'))}>全部日期未详 {data.undated}</button>}
  </footer>
  <RoomStatus {...result} empty={data?.total===0}/>
 </section>;
}
