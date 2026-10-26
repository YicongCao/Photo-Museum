import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './icons';
import {StatusNotice,StatusPanel,SavedStatus} from './system-status';
import './people-settings.css';

function Portrait({src}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[src]);
 return <span className="person-portrait">{src&&!failed?<img src={src} loading="lazy" decoding="async" alt="面孔样本" onError={()=>setFailed(true)}/>:<Icon name="face"/>}</span>;
}
const title=p=>p.label||'未命名 · '+p.id.slice(0,6);
export function PeopleSettings({api}){
 const [text,setText]=useState(''),[query,setQuery]=useState(''),[named,setNamed]=useState('all'),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [data,setData]=useState(null),[overview,setOverview]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [person,setPerson]=useState(null),[drafts,setDrafts]=useState({}),[faces,setFaces]=useState(null),[faceOffset,setFaceOffset]=useState(0),[faceError,setFaceError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(null);
 const selected=useRef(null),editor=useRef(null);selected.current=person?.id;
 useEffect(()=>{if(!person||!matchMedia('(max-width:1100px)').matches)return;const frame=requestAnimationFrame(()=>editor.current?.scrollIntoView({block:'start',behavior:'instant'}));return()=>cancelAnimationFrame(frame)},[person?.id]);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(text);setOffset(0)},220);return()=>clearTimeout(timer)},[text]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);
  Promise.all([api('/people?'+new URLSearchParams({q:query,named,offset,limit:24}),'GET',undefined,{signal:controller.signal}),api('/intelligence','GET',undefined,{signal:controller.signal})])
   .then(([value,status])=>{if(!controller.signal.aborted){setData(value);setOverview(status);setError('')}})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[api,query,named,offset,revision]);
 useEffect(()=>{
  setFaces(null);setFaceError('');if(!person)return;
  const controller=new AbortController();api('/people/'+person.id+'/faces?'+new URLSearchParams({offset:faceOffset,limit:24}),'GET',undefined,{signal:controller.signal})
   .then(value=>{if(!controller.signal.aborted)setFaces(value)}).catch(e=>{if(!controller.signal.aborted)setFaceError(e.message)});
  return()=>controller.abort();
 },[api,person?.id,faceOffset,revision]);
 const refresh=()=>setRevision(v=>v+1),choose=p=>{setPerson(p);setFaceOffset(0);setSaved(null);setFaceError('')};
 async function save(e){
  e.preventDefault();if(busy)return;const id=person.id,label=(drafts[id]??person.label).trim();setBusy(true);setFaceError('');
  try{await api('/people/'+id,'POST',{label});if(selected.current===id){setPerson(p=>({...p,label}));setDrafts(d=>({...d,[id]:label}));setSaved(id)}refresh()}
  catch(e){if(selected.current===id)setFaceError(e.message)}finally{setBusy(false)}
 }
 async function assign(face,target){
  if(!target||busy)return;setBusy(true);setFaceError('');const id=person.id;
  try{await api('/faces/'+face.face_id+'/assign','POST',{person_id:target==='new'?null:target});if(selected.current===id)refresh()}
  catch(e){if(selected.current===id)setFaceError(e.message)}finally{setBusy(false)}
 }
 const dirty=person&&(drafts[person.id]??person.label)!==person.label;
 return <section className="people-settings" aria-label="面孔与姓名">
  <div className="settings-section-title"><h2><Icon name="face"/>面孔与姓名</h2><button onClick={refresh} disabled={busy||loading} aria-label="刷新面孔"><Icon name="refresh"/></button></div>
  <div className="people-summary">{[['检测面孔',overview?.faces],['关联照片',overview?.photos_with_faces],['人物分组',overview?.people],['已命名',overview?.named_people]].map(([label,n])=><span key={label}><small>{label}</small><strong>{n==null?'—':n.toLocaleString()}</strong></span>)}</div>
  <div className="people-filters"><label><Icon name="face"/><input aria-label="搜索人物姓名" value={text} onChange={e=>setText(e.target.value)} maxLength={80} placeholder="搜索姓名"/></label><select aria-label="人物命名状态" value={named} onChange={e=>{setNamed(e.target.value);setOffset(0)}}><option value="all">全部人物</option><option value="unnamed">未命名</option><option value="named">已命名</option></select></div>
  <p className="settings-note">本地检测与聚类 · 分组可能有误，姓名由你确认。头像仅取已有缩略图。</p>
  {error&&<StatusNotice error={error} onRetry={refresh} detail={data?'保留已读取的人物':undefined}/>}
  <div className="people-settings-layout"><div className="people-catalog" aria-busy={loading}>
   {!data&&!error?<StatusPanel loading label="读取面孔"/>:data&&!data.people.length?<StatusPanel empty={query||named!=='all'?'没有符合条件的人物':'暂无检测到的面孔'}/>:<div className="people-cards">{data?.people.map(p=><button className="person-card" key={p.id} aria-pressed={person?.id===p.id} disabled={busy} onClick={()=>choose(p)}><Portrait src={p.portrait}/><span>{title(p)}</span><small>{p.count} 张照片</small></button>)}</div>}
   {!!data?.total&&<div className="people-pages"><button disabled={!offset||loading||busy} onClick={()=>setOffset(Math.max(0,offset-24))} aria-label="上一页人物">←</button><span>{offset+1}–{Math.min(offset+24,data.total)} / {data.total}</span><button disabled={offset+24>=data.total||loading||busy} onClick={()=>setOffset(offset+24)} aria-label="下一页人物">→</button></div>}
  </div><aside className="person-editor" ref={editor}>
   {!person?<div className="person-editor-empty"><Icon name="face"/><span>选择面孔，编辑姓名</span></div>:<>
    <div className="person-editor-title"><Portrait src={person.portrait}/><h3>{title(person)}</h3><button onClick={()=>setPerson(null)} disabled={busy} aria-label="收起人物"><Icon name="close"/></button></div>
    <form onSubmit={save} className="person-name-form"><label>姓名<input aria-label="人物姓名" value={drafts[person.id]??person.label} onChange={e=>{setDrafts(d=>({...d,[person.id]:e.target.value}));setSaved(null)}} maxLength={80} autoComplete="off" disabled={busy} placeholder="留空表示未命名"/></label><div className="settings-actions"><button disabled={busy||!dirty}>{busy?'保存中':'保存姓名'}</button>{saved===person.id&&!dirty?<SavedStatus/>:dirty?<small>未保存</small>:null}</div></form>
    {faceError&&<StatusNotice error={faceError} onRetry={refresh}/>}
    {!faces&&!faceError?<StatusPanel loading label="读取分组照片"/>:faces&&<>
     <div className="person-photo-header"><h3>分组照片</h3><span>{faces.total} 个面孔</span></div>
     <div className="person-face-grid">{faces.items.map(f=><article key={f.face_id}><img src={f.thumbnail} loading="lazy" decoding="async" alt="分组照片"/><Portrait src={f.portrait}/><select aria-label="调整人物分组" value="" disabled={busy} onChange={e=>assign(f,e.target.value)}><option value="">纠正分组…</option><option value="new">拆为新人物组</option>{data?.people.filter(p=>p.id!==person.id).map(p=><option key={p.id} value={p.id}>{title(p)}</option>)}</select></article>)}</div>
     {faces.total>24&&<div className="people-pages"><button disabled={!faceOffset||busy} onClick={()=>setFaceOffset(Math.max(0,faceOffset-24))} aria-label="上一页分组照片">←</button><span>{faceOffset+1}–{Math.min(faceOffset+24,faces.total)} / {faces.total}</span><button disabled={faceOffset+24>=faces.total||busy} onClick={()=>setFaceOffset(faceOffset+24)} aria-label="下一页分组照片">→</button></div>}
     <p className="settings-note">纠正目标随左侧姓名搜索更新；拆组和改组保留人工修订。</p>
    </>}
   </>}
  </aside></div>
 </section>;
}
