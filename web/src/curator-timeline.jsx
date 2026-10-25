import React,{useEffect,useState} from 'react';
import {Icon} from './icons';
import {curatorWorkState} from './curator-timeline.js';
import './curator-timeline.css';

const tools={catalog_schema:['metadata','读取字段'],library_overview:['server','图库概况'],list_facets:['topic','分类检索'],search_photos:['subject','筛选照片'],photo_details:['photo','候选详情'],create_exhibition:['frame','展览草案']};
const states={completed:'已结束',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const stamp=value=>value?new Date(value*1000).toLocaleTimeString('zh-CN',{hour12:false}):'';

export function CuratorWorkingMark({working}){
 return <svg className={'curator-working-mark'+(working?' is-working':'')} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
  <circle className="curator-work-core" cx="14" cy="14" r="2"/>
  <g className="curator-work-orbit"><path d="M14 4a10 10 0 0 1 10 10M14 24A10 10 0 0 1 4 14"/><path opacity=".45" d="M8 14a6 6 0 0 1 6-6M20 14a6 6 0 0 1-6 6"/></g>
 </svg>;
}

export function CuratorActivity({events,run,connection}){
 const [now,setNow]=useState(Date.now());
 const work=curatorWorkState(events,run?.status),active=!!work;
 useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active,run?.id]);
 const connected=connection==='已连接';
 const last=events.at(-1)?.created || run?.updated || run?.created;
 const age=last?Math.max(0,Math.floor((now-last*1000)/1000)):0;
 const label=active?(connected?(work.kind==='tool'?(tools[work.name]?.[1] || work.label):work.label):connection || '连接中'):(states[run?.status] || connection || '—');
 return <div className="curator-live-status" data-working={active&&connected?'true':'false'} data-stage={work?.kind || 'idle'}>
  <CuratorWorkingMark working={active&&connected}/><div><span role="status">{label}</span>
   <small aria-live="off">{active?(connected?(age<2?'刚刚更新':`${age} 秒未更新`):'等待连接恢复'):connection || '—'}</small></div>
 </div>;
}

export function CuratorTimeline({rows,run,active}){
 return <div className="curator-event-list" role="log" aria-label="按时间顺序的模型与工具记录" aria-live="off">
  {rows.map(row=>{
   if(row.kind==='phase')return <div className="curator-phase-entry" key={row.id}><span>{row.stage==='thinking'&&row.round?`第 ${row.round} 轮`:row.label}</span><time>{stamp(row.created)}</time></div>;
   if(row.kind==='done')return <div className={'curator-phase-entry curator-done-entry '+row.status} key={row.id}><Icon name={row.status==='completed'?'check':row.status==='cancelled'?'close':'alert'}/><span>{states[row.status] || row.status}</span><time>{stamp(row.created)}</time></div>;
   if(row.kind==='thinking'||row.kind==='answer')return <details className={'curator-stream-entry '+(row.kind==='thinking'?'curator-thinking':'curator-output')} data-event-id={row.id} data-kind={row.kind} key={row.id} open>
    <summary><Icon name={row.kind==='thinking'?'style':'metadata'}/><span>{row.kind==='thinking'?'模型思考':'模型输出'}</span><time>{stamp(row.created)}</time></summary><pre>{row.text}</pre>
   </details>;
   const [icon,label]=tools[row.name] || ['metadata',row.name || '工具调用'];
   return <details key={row.id} data-event-id={row.id} data-kind="tool" className={'curator-tool '+(row.ended?'ended':'working')}>
    <summary><Icon name={icon}/><span>{label}<small>{row.name}</small></span><span className={row.result?.error?'curator-tool-error':''}>{row.ended?(row.result?.error?'失败':`${row.duration_ms ?? '—'} ms`):(active?'执行中':run?.status==='cancelled'?'已取消':run?.status==='interrupted'?'已中断':'未收到结果')}</span><time>{stamp(row.created)}</time></summary>
    <pre>{JSON.stringify({arguments:row.arguments,...(row.ended?{result:row.result}:{})},null,2).slice(0,10000)}</pre>
   </details>;
  })}
  {!rows.length&&<div className="curator-process-empty">{active?'等待模型返回':run?'未记录运行过程':'—'}</div>}
 </div>;
}
