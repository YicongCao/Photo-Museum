import {PreviewImage} from '../preview-image';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useRoomData,RoomStatus} from './common';
import {constellationLayout} from './radial-layout';
import './constellation.css';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),names={topic:'摄影主题',style:'摄影风格',subject:'主体'};
const origin={x:0,y:0,k:1};
export function ConstellationRoom({api,state={},onState,onCollection,onPhoto}){
 const result=useRoomData(api,'/exhibitions/creative'),data=result.data,kind=state.kind || 'all';
 const groups=useMemo(()=>(data?.groups || []).filter(g=>kind==='all'||g.kind===kind),[data,kind]);
 const counts=kind==='all'?{visible:groups.length,total:data?.group_total ?? groups.length}:(data?.group_counts?.[kind] || {visible:groups.length,total:groups.length});
 const [compact,setCompact]=useState(false);
 const selected=groups.find(g=>g.id===state.group) || groups[0],layout=useMemo(()=>constellationLayout(groups,selected?.id,compact),[groups,selected?.id,compact]);
 const [view,setView]=useState(state.transform || origin),[fit,setFit]=useState(1),[detail,setDetail]=useState(false);
 const stage=useRef(null),drag=useRef(null),latest=useRef(view),stateRef=useRef(state),saveTimer=useRef(null),suppressed=useRef(false);latest.current=view;stateRef.current=state;
 const list=state.mode==='list';
 const persist=t=>onState({...stateRef.current,transform:t});
 const update=t=>{latest.current=t;setView(t)};
 const zoom=amount=>{const old=latest.current,k=clamp(old.k*amount,.75,2.25),t={x:old.x*k/old.k,y:old.y*k/old.k,k};update(t);persist(t)};
 useEffect(()=>{const node=stage.current;if(!node||list)return;const ro=new ResizeObserver(([entry])=>{
  const {width,height}=entry.contentRect;
  // Phones get a portrait composition with fewer nodes; short desktops retain a
  // readable close-up, rather than reducing the whole graph to illegible dots.
  setCompact(width<600);
  setFit(width<600?Math.min(width/420,height/560):Math.max(height<320?.45:0,Math.min(width/1440,height/800)));
 });ro.observe(node);return()=>ro.disconnect()},[list]);
 useEffect(()=>{
  const node=stage.current;if(!node||list)return;
  const wheel=e=>{if(e.ctrlKey)return;e.preventDefault();const old=latest.current,k=clamp(old.k*Math.exp(-e.deltaY*.0012),.75,2.25),t={x:old.x*k/old.k,y:old.y*k/old.k,k};update(t);clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>persist(t),180)};
  node.addEventListener('wheel',wheel,{passive:false});return()=>{node.removeEventListener('wheel',wheel);clearTimeout(saveTimer.current)};
 },[list]);
 const choose=g=>{update(origin);onState({...state,group:g.id,transform:origin});setDetail(false)};
 const open=g=>onCollection({id:'creative-group-'+g.id,title:g.label,dateLabel:g.basis || names[g.kind],endpoint:'/exhibitions/creative/photos?'+new URLSearchParams({kind:'group',key:g.id})});
 const down=e=>{if(e.button!==0)return;suppressed.current=false;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,view:latest.current}};
 const move=e=>{const g=drag.current;if(!g||g.id!==e.pointerId)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;if(Math.abs(dx)+Math.abs(dy)>6){suppressed.current=true;e.currentTarget.setPointerCapture(e.pointerId);update({...g.view,x:clamp(g.view.x+dx,-1200,1200),y:clamp(g.view.y+dy,-800,800)})}};
 const end=e=>{if(drag.current?.id!==e.pointerId)return;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);persist(latest.current)};
 const show=p=>{if(!suppressed.current)onPhoto(p)};
 return <section className="room constellation-room" aria-label="记忆星图展厅">
  <header className="constellation-heading"><div><span>记忆星图{data?.sample_records_omitted>0?' · 预览限量':''}</span><h1>{selected?.label || '—'}</h1></div>
   <div className="constellation-heading-actions"><button className="constellation-basis" aria-expanded={detail} onClick={()=>setDetail(v=>!v)}>{selected?.basis || '本地标签候选'} ⓘ</button>
    {counts.total>counts.visible&&<span className="constellation-group-count" role="status">分组 {counts.visible} / {counts.total}</span>}
    <button disabled={!selected} onClick={()=>open(selected)}>全部 {selected?.count || 0} 张 ↗</button></div>
  </header>
  {detail&&<div className="constellation-source" role="status"><span>{selected?.basis || '本地标签候选'} · {selected?.count || 0} 张</span><span>连线表示同一标签，不表示人物关系或相似度。</span><button aria-label="关闭标签依据" onClick={()=>setDetail(false)}>×</button></div>}
  {list?<div className="constellation-list" aria-label="标签分组列表">{groups.map(g=><section className="constellation-list-group" key={g.id}>
   <div><h2>{g.label}</h2><span>{g.basis} · {g.count} 张</span><button onClick={()=>open(g)}>展开 ↗</button></div>
   <div className="constellation-list-photos">{g.selected?.slice(0,5).map(p=><button key={p.id} onClick={()=>onPhoto(p)} aria-label={'查看 '+p.name}><PreviewImage src={p.thumbnail} alt="" loading="lazy" decoding="async"/></button>)}</div>
  </section>)}</div>:<div className="constellation-stage" ref={stage} tabIndex={0} role="group" aria-label="照片标签星图，可拖动和缩放"
   onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
   onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const t=latest.current,next={...t,x:clamp(t.x+(e.key==='ArrowLeft'?60:e.key==='ArrowRight'?-60:0),-1200,1200),y:clamp(t.y+(e.key==='ArrowUp'?60:e.key==='ArrowDown'?-60:0),-800,800)};update(next);persist(next)}if(e.key==='Home'){e.preventDefault();update(origin);persist(origin)}}}>
   <div className={'constellation-world '+(compact?'compact-constellation':'')} style={{width:compact?420:1440,height:compact?560:800,transform:`translate(-50%,-50%) translate(${view.x}px,${view.y}px) scale(${fit*view.k})`}}>
    <svg viewBox={compact?'0 0 420 560':'0 0 1440 800'} aria-hidden="true" className="constellation-links">{layout.edges.map((e,i)=>{const mid=(e.x1+e.x2)/2;return <g key={e.group+'-'+e.photo}><path d={`M ${e.x1} ${e.y1} C ${mid} ${e.y1},${mid} ${e.y2},${e.x2} ${e.y2}`} style={{animationDelay:Math.min(i*25,240)+'ms'}}/><circle cx={e.x1} cy={e.y1} r="3"/></g>})}</svg>
    {layout.groups.map(g=><button className={'constellation-hub '+(g.id===selected?.id?'selected-hub':'')} key={g.id} style={{left:g.x,top:g.y-14}} aria-label={'选择标签 '+g.label} aria-pressed={g.id===selected?.id} onClick={e=>{if(e.detail===0||!suppressed.current)choose(g)}}><span>{g.label}</span><small>{names[g.kind]} · {g.count}</small></button>)}
    {layout.nodes.map((node,i)=><button key={node.photo.id} className={'constellation-photo '+(node.hero?'constellation-hero':'')} style={{left:node.x,top:node.y,width:node.width,height:node.height,'--node-delay':Math.min(i*25,240)+'ms'}} onClick={e=>{if(e.detail===0)onPhoto(node.photo);else show(node.photo)}} aria-label={'查看 '+node.photo.name}>
     <PreviewImage src={node.hero?(node.photo.preview || node.photo.thumbnail):node.photo.thumbnail} alt="" draggable="false" decoding="async"/>
     {node.hero&&<span>{node.photo.period || '日期未详'}</span>}
    </button>)}
   </div>
  </div>}
  <footer className="constellation-controls"><div className="constellation-filters"><select aria-label="星图标签类型" value={kind} onChange={e=>{update(origin);onState({...state,kind:e.target.value,group:null,transform:origin})}}><option value="all">全部标签</option>{Object.entries(names).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
   <select aria-label="星图标签" value={selected?.id || ''} disabled={!groups.length} onChange={e=>choose(groups.find(g=>g.id===e.target.value))}>{!groups.length&&<option value="">暂无标签</option>}{groups.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></div>
   <div className="constellation-view-controls"><button aria-label={list?'切换星图':'切换标签列表'} aria-pressed={list} onClick={()=>onState({...state,mode:list?'graph':'list'})}>{list?'星图':'列表'}</button>
    {!list&&<><span className="constellation-control-divider"/><button aria-label="缩小星图" disabled={view.k<=.75} onClick={()=>zoom(1/1.2)}>−</button><button className="constellation-reset" aria-label="重置星图" onClick={()=>{update(origin);persist(origin)}}>{Math.round(view.k*100)}%</button><button aria-label="放大星图" disabled={view.k>=2.25} onClick={()=>zoom(1.2)}>＋</button></>}
   </div>
  </footer>
  <RoomStatus {...result}/>
  {!result.loading&&!result.error&&!groups.length&&<div className="room-status">{data?.total===0?'暂无可展示照片':counts.total>0?'当前总览没有此类分组':kind==='all'?'暂无有效标签':`${names[kind]}暂无有效标签`}</div>}
 </section>;
}
