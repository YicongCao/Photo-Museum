import {PreviewImage} from '../preview-image';
import {StatusNotice} from '../system-status';
import {PhotoLoading} from '../loading-mark';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {RoomStatus,useRoomData} from './common';
import './memory-scroll.css';

const dateLabel=p=>p?.replaceAll('-',' · ') || '日期未详';
const motion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
function endpoint(id){return '/exhibitions/creative/photos?kind=chapter&key='+encodeURIComponent(id)}
function orderedChapters(chapters,saved){
 const lookup=new Map(chapters.map(c=>[c.id,c]));
 const order=saved.filter(c=>lookup.has(c.activity_id));
 const known=new Set(order.map(c=>c.activity_id));
 return [...order.map(s=>({...lookup.get(s.activity_id),customTitle:s.title,heroId:s.hero_id})),
  ...chapters.filter(c=>!known.has(c.id)).sort((a,b)=>(a.period==null)-(b.period==null)||String(a.period||'').localeCompare(String(b.period||''))||a.id.localeCompare(b.id))];
}
export function MemoryScrollRoom({api,state={},onState,onCollection,onPhoto}){
 const overview=useRoomData(api,'/exhibitions/creative'),saved=useRoomData(api,'/exhibitions/creative/scroll');
 const [draft,setDraft]=useState(null),[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[heroes,setHeroes]=useState({});
 const [size,setSize]=useState({width:1000,height:600}),[left,setLeft]=useState(state.left||0),[activeId,setActiveId]=useState(state.activeId||null);
 const viewport=useRef(null),editorBox=useRef(null),drag=useRef(null),suppress=useRef(false),frame=useRef(0),saveRequest=useRef(null),initial=useRef(true),lastState=useRef(state);
 lastState.current=state;
 const chapters=useMemo(()=>orderedChapters(overview.data?.chapters||[],draft?.chapters||saved.data?.chapters||[]),[overview.data,draft,saved.data]);
 const layouts=useMemo(()=>{let x=0;return chapters.map((chapter,i)=>{
  const hero=heroes[chapter.heroId]||saved.data?.heroes?.[chapter.heroId]||chapter.selected?.find(p=>p.id===chapter.heroId)||chapter.selected?.[0];
  const ratio=hero?.info?.width/hero?.info?.height||1.5;
  const heroFraction=ratio<1?.75:2.3/3.3;
  const width=size.width<650?Math.max(250,size.width*.86):Math.min(size.width*.62,Math.max(size.width*.2,(size.height-48)*heroFraction*ratio+18));
  const item={chapter,hero,x,width,index:i,portrait:ratio<1,heroHeight:Math.min(Math.max(120,size.height-48-100),(width-(size.width<650?12:18))/ratio)};x+=width+(size.width<650?24:44);return item;
 })},[chapters,size,heroes,saved.data]);
 // Every chapter can align with the reading edge, including a narrow last one.
 // Otherwise native scroll clamping silently selects the previous chapter.
 const active=layouts.find(c=>c.chapter.id===activeId)||layouts[0],extent=layouts.length?layouts.at(-1).x+Math.max(size.width,layouts.at(-1).width):1;
 const yearStops=layouts.filter((c,i)=>i===0||c.chapter.period?.slice(0,4)!==layouts[i-1].chapter.period?.slice(0,4)),maxLabels=Math.max(2,Math.floor((size.width-(size.width<650?60:300))/100));
 const railStops=yearStops.filter((c,i)=>yearStops.length<=maxLabels||i===yearStops.length-1||i%Math.ceil((yearStops.length-1)/(maxLabels-1))===0);
 const editor=useRoomData(api,editing&&active?endpoint(active.chapter.id)+'&sort=score&limit=60':null);
 useLayoutEffect(()=>{const el=viewport.current;if(!el)return;const ro=new ResizeObserver(([e])=>setSize({width:e.contentRect.width,height:e.contentRect.height}));ro.observe(el);return()=>ro.disconnect()},[]);
 useLayoutEffect(()=>{
  if(!layouts.length||!initial.current)return;
  const el=viewport.current;el.scrollLeft=lastState.current.left||0;setLeft(el.scrollLeft);initial.current=false;
 },[layouts]);
 useEffect(()=>{
  const el=viewport.current;if(!el)return;
  const wheel=e=>{if(e.ctrlKey||editing)return;e.preventDefault();el.scrollLeft+=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?el.clientWidth:1)};
  el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);
 },[editing]);
 useEffect(()=>()=>{cancelAnimationFrame(frame.current);saveRequest.current?.abort()},[]);
 useEffect(()=>{
  if(!editing)return;const previous=document.activeElement,box=editorBox.current;
  const frame=requestAnimationFrame(()=>box?.querySelector('button')?.focus());
  const key=e=>{if(e.key!=='Tab')return;const nodes=[...box.querySelectorAll('button:not(:disabled),select,input')],i=nodes.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();nodes.at(-1)?.focus()}else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0]?.focus()}};
  box?.addEventListener('keydown',key);return()=>{cancelAnimationFrame(frame);box?.removeEventListener('keydown',key);previous?.focus?.({preventScroll:true})};
 },[editing]);
 const update=()=>{if(frame.current)return;frame.current=requestAnimationFrame(()=>{frame.current=0;const x=viewport.current.scrollLeft;setLeft(x);const nearest=layouts.reduce((a,b)=>Math.abs(b.x-x)<Math.abs(a.x-x)?b:a,layouts[0]);if(nearest){setActiveId(nearest.chapter.id);onState({...lastState.current,left:x,activeId:nearest.chapter.id})}})};
 const go=item=>{if(item){setActiveId(item.chapter.id);viewport.current.scrollTo({left:item.x,behavior:editing?'instant':motion()})}};
 const beginEdit=()=>{setSaveError('');setDraft({revision:saved.data?.revision||0,chapters:chapters.map(c=>({activity_id:c.id,title:c.customTitle||null,hero_id:c.heroId||null}))});setEditing(true)};
 const change=(id,values)=>setDraft(d=>({...d,chapters:d.chapters.map(c=>c.activity_id===id?{...c,...values}:c)}));
 const reorder=delta=>{const idx=draft.chapters.findIndex(c=>c.activity_id===active.chapter.id),next=idx+delta;if(next<0||next>=draft.chapters.length)return;setDraft(d=>{const rows=[...d.chapters];[rows[idx],rows[next]]=[rows[next],rows[idx]];return {...d,chapters:rows}})};
 const save=async()=>{setSaving(true);setSaveError('');const c=new AbortController();saveRequest.current=c;try{await api('/exhibitions/creative/scroll','PUT',draft,{signal:c.signal});if(!c.signal.aborted){setEditing(false);setDraft(null);saved.retry()}}catch(e){if(e.name!=='AbortError')setSaveError(e.message)}finally{if(!c.signal.aborted)setSaving(false)}};
 const closeEdit=()=>{if(saving)return;setEditing(false);setDraft(null);setSaveError('')};
 const visible=layouts.filter(c=>c.x+c.width>left-size.width*.6&&c.x<left+size.width*1.7);
 return <section className="room memory-scroll-room" aria-label="记忆长卷展厅">
  <div className="scroll-toolbar"><span className="scroll-room-name">记忆长卷</span><button onClick={beginEdit} disabled={!active||saved.loading||Boolean(saved.error)}>编排章节</button></div>
  <div ref={viewport} className="memory-scroll-viewport" tabIndex="0" aria-label="横向章节" onScroll={update}
   onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();go(layouts[e.key==='Home'?0:e.key==='End'?layouts.length-1:Math.max(0,Math.min(layouts.length-1,(active?.index||0)+(e.key==='ArrowRight'?1:-1)))])}}}
   onPointerDown={e=>{if(e.button!==0)return;suppress.current=false;drag.current={id:e.pointerId,x:e.clientX,left:viewport.current.scrollLeft}}}
   onPointerMove={e=>{const g=drag.current;if(!g||g.id!==e.pointerId)return;if(Math.abs(e.clientX-g.x)>6){suppress.current=true;viewport.current.setPointerCapture(e.pointerId);viewport.current.scrollLeft=g.left-e.clientX+g.x}}}
   onPointerUp={e=>{drag.current=null;if(viewport.current.hasPointerCapture(e.pointerId))viewport.current.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>{drag.current=null;suppress.current=true}}>
   <div className="memory-scroll-track" style={{width:extent}}>
    {visible.map(({chapter,hero,x,width,index,portrait,heroHeight})=>{
     const detail=(chapter.selected||[]).filter(p=>p.id!==hero?.id).slice(0,2);
     return <article key={chapter.id} className={'memory-chapter '+(portrait?'chapter-portrait':'')+(chapter.id===active?.chapter.id?' chapter-active':'')} style={{left:x,width,'--scroll-hero-height':heroHeight+'px'}} data-chapter={chapter.id}>
      <header><span>{dateLabel(chapter.period?.slice(0,4))}</span><button onClick={()=>onCollection({id:'scroll-'+chapter.id,title:chapter.customTitle||chapter.label,dateLabel:dateLabel(chapter.period),endpoint:endpoint(chapter.id)})} aria-label={'展开章节 '+(chapter.customTitle||chapter.label)}>{chapter.customTitle||chapter.label}<span aria-hidden="true">↗</span></button></header>
      <div className={'memory-chapter-photos '+(!detail.length?'chapter-single':'')}>
       {hero&&<button className="memory-chapter-hero" aria-label={'查看 '+hero.name} onClick={e=>{if(!suppress.current||e.detail===0)onPhoto(hero,[hero,...detail])}}><PreviewImage src={hero.preview||hero.thumbnail} alt="" decoding="async" draggable="false"/></button>}
       {detail.map(p=><button key={p.id} className="memory-chapter-detail" aria-label={'查看 '+p.name} onClick={e=>{if(!suppress.current||e.detail===0)onPhoto(p,[hero,...detail])}}><PreviewImage src={p.preview||p.thumbnail} alt="" decoding="async" draggable="false"/></button>)}
      </div>
     </article>
    })}
   </div>
  </div>
  <footer className="memory-scroll-footer"><div className="scroll-current"><strong>{active?.chapter.customTitle||active?.chapter.label||'记忆长卷'}</strong><span>{active?.chapter.count||0} 张照片</span></div>
   <div className="scroll-year-rail" aria-label="章节导航"><i style={{width:(extent>size.width?Math.min(100,left/(extent-size.width)*100):100)+'%'}}/>
    {railStops.map(c=><button key={c.chapter.id} style={{left:Math.min(97,c.x/Math.max(1,extent-size.width)*100)+'%'}} onClick={()=>go(c)} aria-label={'跳至 '+dateLabel(c.chapter.period?.slice(0,4))}><span/>{dateLabel(c.chapter.period?.slice(0,4))}</button>)}
   </div><button className="scroll-next" aria-label="下一章节" onClick={()=>go(layouts[Math.min(layouts.length-1,(active?.index||0)+1)])} disabled={!active||active.index>=layouts.length-1}>→</button>
  </footer>
  <RoomStatus loading={overview.loading||saved.loading} error={overview.error||saved.error} retry={()=>{overview.retry();saved.retry()}} empty={!overview.loading&&!chapters.length}/>
  {editing&&active&&<div className="scroll-editor-backdrop" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();closeEdit()}}}><section ref={editorBox} className="scroll-editor" role="dialog" aria-modal="true" aria-label="编排章节" aria-busy={saving}>
   <header><h2>编排章节</h2><button onClick={closeEdit} aria-label="关闭章节编排" disabled={saving}>×</button></header>
   <div className="scroll-editor-selection" inert={saving||undefined}><label>章节<select aria-label="章节" value={active.chapter.id} onChange={e=>go(layouts.find(c=>c.chapter.id===e.target.value))}>{chapters.map(c=><option key={c.id} value={c.id}>{c.customTitle||c.label}</option>)}</select></label><div><button aria-label="章节前移" disabled={!active.index||saving} onClick={()=>reorder(-1)}>←</button><button aria-label="章节后移" disabled={active.index===chapters.length-1||saving} onClick={()=>reorder(1)}>→</button></div></div>
   <label className="scroll-editor-title">标题<input disabled={saving} maxLength="120" value={draft.chapters.find(c=>c.activity_id===active.chapter.id)?.title??active.chapter.label} onChange={e=>change(active.chapter.id,{title:e.target.value})}/></label>
   <div className="scroll-editor-images" aria-busy={editor.loading} inert={saving||editor.loading||Boolean(editor.error)||undefined} aria-label="选择章节主图">{(editor.data?.items||active.chapter.selected||[]).map(p=><button key={p.id} aria-label={'主图 '+p.name} aria-pressed={(active.chapter.heroId||active.hero?.id)===p.id} onClick={()=>{setHeroes(h=>({...h,[p.id]:p}));change(active.chapter.id,{hero_id:p.id})}}><PreviewImage src={p.thumbnail} alt="" decoding="async"/></button>)}</div>
   {editor.error&&<StatusNotice error={editor.error} onRetry={editor.retry}/>}
   {saveError&&<StatusNotice error={saveError} detail="编排尚未保存" onDismiss={()=>setSaveError('')}/>}
   <footer><span>{editor.loading?<PhotoLoading compact/>:editor.data?.total>60?'显示评分前 60 张':''}</span><button onClick={save} disabled={saving}>{saving?'保存中':'保存编排'}</button></footer>
  </section></div>}
 </section>;
}
