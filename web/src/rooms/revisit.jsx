import {PreviewImage} from '../preview-image';
import {StatusNotice} from '../system-status';
import {PhotoLoading} from '../loading-mark';
import React,{useContext,useEffect,useMemo,useRef,useState} from 'react';
import {RoomRefreshContext,RoomStatus,useRoomData,query} from './common';
import './revisit.css';

const label=p=>p?.period?.replaceAll('-',' · ')||'日期未详';
const reference=p=>p&&typeof p.id==='string'&&p.id.length&&typeof p.revision==='string'&&p.revision.length?{id:p.id,revision:p.revision}:null;
const draft=p=>p?{id:p.id||null,title:typeof p.title==='string'?p.title:'',confirmed:p.confirmed===true,left:reference(p.left),right:reference(p.right)}:null;
function sourcePath(kind,id){return kind==='all'?'/exhibitions/photos?sort=time':'/exhibitions/creative/photos?'+query({kind,key:id,sort:'time'})}

export function RevisitRoom({api,state={},onState,onPhoto,onCollection}){
 const overview=useRoomData(api,'/exhibitions/creative'),pairs=useRoomData(api,'/exhibitions/creative/pairs');
 const [pair,setPair]=useState(state.pair?.confirmed?null:draft(state.pair)),[mode,setMode]=useState(state.mode||'side'),[split,setSplit]=useState(state.split??50),[picker,setPicker]=useState(false),[target,setTarget]=useState('left');
 const [kind,setKind]=useState('all'),[source,setSource]=useState(''),[offset,setOffset]=useState(0),[saving,setSaving]=useState(false),[error,setError]=useState(''),[title,setTitle]=useState(state.pair?.title||'');
 const [selectedSaved,setSelectedSaved]=useState(state.savedId||null),[focusedPlace,setFocusedPlace]=useState(state.placeId||null);
 const mounted=useRef(true),saveRequest=useRef(null),pickerBox=useRef(null),previousFocus=useRef(null);
 const refresh=useContext(RoomRefreshContext),[resolveRetry,setResolveRetry]=useState(0),[resolved,setResolved]=useState({key:null,items:{},error:''});
 const places=overview.data?.places||[],chapters=overview.data?.chapters||[],saved=pairs.data?.items||[];
 const chosenSaved=saved.find(p=>p.id===selectedSaved),place=places.find(p=>p.id===focusedPlace)||places[0];
 const film=useMemo(()=>{
  if(place){const grouped=[...(place.years||[])].sort((a,b)=>a.year-b.year).flatMap(y=>y.selected?.length?[y.selected[0]]:[]);return grouped.length?grouped.filter((p,i)=>grouped.length<=16||i===grouped.length-1||i%Math.ceil((grouped.length-1)/15)===0):(place.selected||[])}
  return chapters.slice(0,12).map(c=>c.selected?.[0]).filter(Boolean).sort((a,b)=>String(a.period||'z').localeCompare(String(b.period||'z')));
 },[place,chapters]);
 const firstPair=useMemo(()=>{
  if(saved.length)return saved[0];
  if(film.length>1)return {left:film[0],right:film.at(-1),title:place?.label||'',confirmed:false};
  if(film.length===1)return {left:film[0],right:null,title:'',confirmed:false};
  return null;
 },[saved,film,place]);
 const candidate=pair||chosenSaved||firstPair;
 const refKey=JSON.stringify({left:reference(candidate?.left),right:reference(candidate?.right)}),resolveKey=refresh+':'+resolveRetry+':'+refKey;
 const validationReady=resolved.key===resolveKey;
 const resolveSide=side=>{const wanted=reference(candidate?.[side]),found=wanted&&resolved.items[wanted.id];return validationReady&&found&&found.revision===wanted.revision?found:null};
 // Session storage contains identities only. A fresh scoped lookup is the sole
 // source of preview URLs, and a refresh hides old sides until revalidated.
 const shown=candidate?{...candidate,left:resolveSide('left'),right:resolveSide('right')}:null,confirmed=shown?.confirmed===true;
 const resolving=Boolean(reference(candidate?.left)||reference(candidate?.right))&&!validationReady;
 useEffect(()=>{
  const refs=JSON.parse(refKey),ids=[...new Set(Object.values(refs).filter(Boolean).map(p=>p.id))],controller=new AbortController();
  if(!ids.length){setResolved({key:resolveKey,items:{},error:''});return()=>controller.abort()}
  api('/exhibitions/creative/resolve?ids='+encodeURIComponent(ids.join(',')),'GET',undefined,{signal:controller.signal}).then(data=>{
   if(controller.signal.aborted)return;
   const items=Object.fromEntries((data.items||[]).map(p=>[p.id,p]));setResolved({key:resolveKey,items,error:''});
   setPair(previous=>{
    if(!previous||JSON.stringify({left:reference(previous.left),right:reference(previous.right)})!==refKey)return previous;
    const valid=side=>{const p=refs[side];return p&&items[p.id]?.revision===p.revision?p:null};
    if(valid('left')&&valid('right'))return previous;
    if(previous.left===null&&previous.right===null)return previous;
    return {...draft(previous),left:valid('left'),right:valid('right'),confirmed:false,id:null};
   });
  }).catch(e=>{if(!controller.signal.aborted)setResolved({key:resolveKey,items:{},error:e.message})});
  return()=>controller.abort();
 },[api,refKey,resolveKey]);
 const photos=useRoomData(api,picker?sourcePath(kind,source)+'&offset='+offset+'&limit=40':null);
 useEffect(()=>{
  if(!pairs.data||!pair?.confirmed||!pair.id)return;
  const current=pairs.data.items.find(p=>p.id===pair.id);
  setPair(current||null);if(!current)setSelectedSaved(null);
 },[pairs.data]);
 const persisted=JSON.stringify({pair:draft(validationReady&&!resolved.error?shown:candidate),mode,split,savedId:selectedSaved,placeId:focusedPlace});
 useEffect(()=>{onState(JSON.parse(persisted))},[persisted]);
 useEffect(()=>()=>{mounted.current=false;saveRequest.current?.abort()},[]);
 useEffect(()=>{
  if(!picker)return;previousFocus.current=document.activeElement;
  const timer=requestAnimationFrame(()=>pickerBox.current?.querySelector('button')?.focus());
  const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setPicker(false)}if(e.key==='Tab'){const nodes=[...pickerBox.current.querySelectorAll('button:not(:disabled),select,input')],i=nodes.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();nodes.at(-1)?.focus()}else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0]?.focus()}}};
  const node=pickerBox.current;node?.addEventListener('keydown',key);return()=>{cancelAnimationFrame(timer);node?.removeEventListener('keydown',key);previousFocus.current?.focus?.({preventScroll:true})};
 },[picker]);
 const choose=(p,side=target)=>{setPair({...draft(candidate),[side]:reference(p),confirmed:false,id:null,title:title||candidate?.title||''});setSelectedSaved(null);setError('');if(side==='left')setTarget('right')};
 const changeSource=value=>{const [nextKind,...rest]=value.split(':');setKind(nextKind);setSource(rest.join(':'));setOffset(0)};
 const openPicker=side=>{setTarget(side);setTitle(shown?.title||'');setPicker(true);setError('')};
 const save=async()=>{
  if(!shown?.left||!shown?.right||shown.left.id===shown.right.id)return;
  setSaving(true);setError('');const c=new AbortController();saveRequest.current=c;
  try{const data=await api('/exhibitions/creative/pairs','POST',{left_id:shown.left.id,right_id:shown.right.id,title:title||shown.title||'',confirmed:true},{signal:c.signal});if(!c.signal.aborted){setPair(data);setSelectedSaved(data.id);pairs.retry();setPicker(false)}}
  catch(e){if(e.name!=='AbortError')setError(e.message)}finally{if(mounted.current&&!c.signal.aborted)setSaving(false)}
 };
 const remove=async()=>{if(!shown?.id)return;setSaving(true);setError('');const c=new AbortController();saveRequest.current=c;try{await api('/exhibitions/creative/pairs/'+encodeURIComponent(shown.id),'DELETE',{}, {signal:c.signal});if(!c.signal.aborted){setPair(null);setSelectedSaved(null);pairs.retry()}}catch(e){if(e.name!=='AbortError')setError(e.message)}finally{if(mounted.current&&!c.signal.aborted)setSaving(false)}};
 const selectSaved=id=>{const p=saved.find(p=>p.id===id);setPair(p);setSelectedSaved(id);setTitle(p?.title||'');setError('')};
 const selectPlace=id=>{setFocusedPlace(id);const p=places.find(p=>p.id===id);const items=(p?.years||[]).flatMap(y=>y.selected?.length?[y.selected[0]]:[]);setPair({left:items[0]||p?.selected?.[0],right:items.at(-1)||p?.selected?.[1],confirmed:false,title:p?.label||''});setTitle(p?.label||'');setSelectedSaved(null)};
 return <section className="room revisit-room" aria-label="故地重游展厅">
  <header className="revisit-heading"><div className="revisit-heading-label"><span>故地重游</span>{confirmed?<small>已确认同地点</small>:<small>{place&&shown?.title===place.label?'同城候选 · 待确认同地点':'手动配对 · 待确认'}</small>}</div>
   <div className="room-segments revisit-modes" aria-label="对照方式">{[['side','并排'],['wipe','滑动'],['blend','叠化']].map(([value,text])=><button key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{text}</button>)}</div>
   <button onClick={()=>openPicker('left')} className="revisit-select">选片</button>
  </header>
  <div className={'revisit-comparison revisit-'+mode} key={(shown?.left?.id||'')+'-'+(shown?.right?.id||'')+'-'+mode}>
   {['left','right'].map(side=>shown?.[side]?<button key={side} className={'revisit-image revisit-'+side} aria-label={'查看'+(side==='left'?'左侧':'右侧')+'照片 '+shown[side].name} style={mode==='wipe'&&side==='right'?{clipPath:`inset(0 0 0 ${split}%)`}:mode==='blend'&&side==='right'?{opacity:split/100}:undefined} onClick={()=>onPhoto(shown[side],[shown.left,shown.right])}><PreviewImage src={shown[side].preview||shown[side].thumbnail} alt="" decoding="async" draggable="false"/></button>:<button key={side} className={'revisit-image revisit-'+side+' revisit-empty'} onClick={()=>openPicker(side)}><span>＋</span>选择{side==='left'?'第一':'第二'}张照片</button>)}
   {mode==='wipe'&&shown?.left&&shown?.right&&<><div className="revisit-divider" style={{left:split+'%'}}><span>‹ ›</span></div><input className="revisit-wipe-input" aria-label="照片对照分界" type="range" min="0" max="100" step=".2" value={split} onChange={e=>setSplit(Number(e.target.value))}/></>}
   {mode==='blend'&&shown?.left&&shown?.right&&<label className="revisit-blend-control"><span>{Math.round(split)}%</span><input aria-label="叠化比例" type="range" min="0" max="100" value={split} onChange={e=>setSplit(Number(e.target.value))}/></label>}
  </div>
  <div className="revisit-caption"><button onClick={()=>onPhoto(shown.left,[shown.left,shown.right])} disabled={!shown?.left} aria-label="查看左侧照片详情">{label(shown?.left)}</button><div><strong>{shown?.title||'照片对照'}</strong>{!confirmed&&shown?.left&&shown?.right&&<button disabled={saving||shown.left.id===shown.right.id} onClick={save}>确认同地点并保存</button>}{confirmed&&<button onClick={remove} disabled={saving} aria-label="移除已保存配对">移除配对</button>}</div><button onClick={()=>onPhoto(shown.right,[shown.left,shown.right])} disabled={!shown?.right} aria-label="查看右侧照片详情">{label(shown?.right)}</button></div>
  <div className="revisit-bottom"><div className="revisit-source-controls">{saved.length>0&&<label>已保存<select aria-label="已保存配对" value={selectedSaved||''} onChange={e=>{if(e.target.value)selectSaved(e.target.value)}}><option value="">选择配对</option>{saved.map(p=><option value={p.id} key={p.id}>{p.title||label(p.left)+' / '+label(p.right)}</option>)}</select></label>}{places.length>0&&<label>同城候选<select aria-label="选择候选城市" value={place?.id||''} onChange={e=>selectPlace(e.target.value)}>{places.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</select></label>}</div>
   <div className="revisit-filmstrip" aria-label="跨年照片"><div>{film.map(p=><button key={p.id} aria-label={'选择对照照片 '+p.name} aria-pressed={p.id===shown?.left?.id||p.id===shown?.right?.id} onClick={()=>{setTitle(shown?.title||'');choose(p,shown?.left?.id===p.id?'right':target)}}><PreviewImage src={p.thumbnail} alt="" decoding="async"/><span>{label(p)}</span></button>)}</div></div>
  </div>
  {error&&<StatusNotice className="revisit-error" error={error} onDismiss={()=>setError('')}/>}
  <RoomStatus loading={overview.loading||pairs.loading||resolving} error={overview.error||pairs.error||(validationReady?resolved.error:"")} retry={()=>{overview.retry();pairs.retry();setResolveRetry(n=>n+1)}} empty={!overview.loading&&!pairs.loading&&overview.data?.total===0}/>
  {picker&&<div className="revisit-picker-backdrop"><section ref={pickerBox} className="revisit-picker" role="dialog" aria-modal="true" aria-label="选择对照照片" aria-busy={saving}><header><h2>选择对照照片</h2><button aria-label="关闭选片" disabled={saving} onClick={()=>setPicker(false)}>×</button></header>
   <div className="revisit-picker-pair" inert={saving||undefined}>{['left','right'].map(side=><button key={side} aria-pressed={target===side} onClick={()=>setTarget(side)}>{shown?.[side]?.thumbnail&&<PreviewImage src={shown[side].thumbnail} alt=""/>}<span>{side==='left'?'第一张':'第二张'}<small>{label(shown?.[side])}</small></span></button>)}</div>
   <div className="revisit-picker-filters" inert={saving||undefined}><select aria-label="选片范围" value={kind==='all'?'all':kind+':'+source} onChange={e=>changeSource(e.target.value)}><option value="all">全部照片</option>{places.length>0&&<optgroup label="同城候选">{places.map(p=><option key={p.id} value={'place:'+p.id}>{p.label}</option>)}</optgroup>}<optgroup label="活动">{chapters.map(c=><option key={c.id} value={'chapter:'+c.id}>{c.label}</option>)}</optgroup></select><label>名称<input value={title} maxLength="120" onChange={e=>{setTitle(e.target.value);setPair({...draft(candidate),title:e.target.value,confirmed:false,id:null})}} placeholder="对照名称"/></label></div>
   <div className="revisit-picker-grid" aria-busy={photos.loading} inert={photos.loading||saving||undefined}>{photos.data?.items.map(p=><button key={p.id} aria-label={'选用 '+p.name} aria-pressed={p.id===shown?.left?.id||p.id===shown?.right?.id} onClick={()=>choose(p)}><PreviewImage src={p.thumbnail} alt="" loading="lazy"/><span>{label(p)}</span></button>)}</div>
   {photos.error&&<StatusNotice error={photos.error} onRetry={photos.retry}/>}{error&&<StatusNotice error={error} onDismiss={()=>setError('')}/>}
   <footer><div className="revisit-picker-pages"><button disabled={offset===0||photos.loading} onClick={()=>setOffset(Math.max(0,offset-40))} aria-label="上一页照片">←</button><span>{photos.loading?<PhotoLoading compact/>:photos.data?.total?`${offset+1}–${Math.min(offset+40,photos.data.total)} / ${photos.data.total}`:'暂无照片'}</span><button disabled={photos.loading||offset+40>=(photos.data?.total||0)} onClick={()=>setOffset(offset+40)} aria-label="下一页照片">→</button></div><button onClick={save} disabled={saving||!shown?.left||!shown?.right||shown.left.id===shown.right.id}>{saving?'保存中':'确认同地点并保存'}</button></footer>
  </section></div>}
 </section>;
}
