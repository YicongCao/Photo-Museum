import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './icons';
import {StatusNotice,StatusPanel,SavedStatus} from './system-status';
import './people-settings.css';
import {FaceReview} from './face-review';

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
 const [picks,setPicks]=useState({}),[multi,setMulti]=useState(false),[target,setTarget]=useState(''),[proposal,setProposal]=useState(null),[matches,setMatches]=useState(null),[history,setHistory]=useState([]),[mergeError,setMergeError]=useState('');
 const selected=useRef(null),editor=useRef(null);selected.current=person?.id;
 const draftLabel=person?(drafts[person.id]??person.label).trim():'';
 useEffect(()=>{if(!person||!draftLabel||draftLabel===person.label)return;const controller=new AbortController(),timer=setTimeout(()=>{
  api('/people?'+new URLSearchParams({q:draftLabel,exact:true,limit:200}),'GET',undefined,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){const others=result.people.filter(p=>p.id!==person.id);setMatches(others.length?{label:draftLabel,people:others}:null)}}).catch(()=>{});
 },300);return()=>{clearTimeout(timer);controller.abort()}},[api,person?.id,person?.label,draftLabel]);
 useEffect(()=>{if(!proposal)return;const frame=requestAnimationFrame(()=>document.querySelector('.people-merge-confirm')?.scrollIntoView({block:'nearest',behavior:'instant'}));return()=>cancelAnimationFrame(frame)},[proposal]);
 useEffect(()=>{if(!person||!matchMedia('(max-width:1100px)').matches)return;const frame=requestAnimationFrame(()=>editor.current?.scrollIntoView({block:'start',behavior:'instant'}));return()=>cancelAnimationFrame(frame)},[person?.id]);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(text);setOffset(0)},220);return()=>clearTimeout(timer)},[text]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);
  Promise.all([api('/people?'+new URLSearchParams({q:query,named,offset,limit:24}),'GET',undefined,{signal:controller.signal}),api('/intelligence','GET',undefined,{signal:controller.signal}),api('/people/merges','GET',undefined,{signal:controller.signal})])
   .then(([value,status,events])=>{if(!controller.signal.aborted){setData(value);setOverview(status);setHistory(events.items);setError('')}})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[api,query,named,offset,revision]);
 useEffect(()=>{
  setFaces(null);setFaceError('');if(!person)return;
  const controller=new AbortController();api('/people/'+person.id+'/faces?'+new URLSearchParams({offset:faceOffset,limit:24}),'GET',undefined,{signal:controller.signal})
   .then(value=>{if(!controller.signal.aborted)setFaces(value)}).catch(e=>{if(!controller.signal.aborted)setFaceError(e.message)});
  return()=>controller.abort();
 },[api,person?.id,faceOffset,revision]);
 const refresh=()=>setRevision(v=>v+1),choose=p=>{setPerson(p);setFaceOffset(0);setSaved(null);setFaceError('');setMatches(null);setProposal(null)};
 async function save(e,keepSeparate=false){
  e.preventDefault();if(busy)return;const id=person.id,label=(drafts[id]??person.label).trim();setBusy(true);setFaceError('');
  try{
   if(label&&!keepSeparate){const result=await api('/people?'+new URLSearchParams({q:label,exact:true,limit:200}));const others=result.people.filter(p=>p.id!==id);if(others.length){if(selected.current===id)setMatches({label,people:others});return}}
   await api('/people/'+id,'POST',{label});setMatches(null);setPicks(p=>p[id]?{...p,[id]:{...p[id],label}}:p);if(selected.current===id){setPerson(p=>({...p,label}));setDrafts(d=>({...d,[id]:label}));setSaved(id)}refresh()}
  catch(e){if(selected.current===id)setFaceError(e.message)}finally{setBusy(false)}
 }
 async function assign(face,target){
  if(!target||busy)return;setBusy(true);setFaceError('');const id=person.id;
  try{await api('/faces/'+face.face_id+'/assign','POST',{person_id:target==='new'?null:target});if(selected.current===id)refresh()}
  catch(e){if(selected.current===id)setFaceError(e.message)}finally{setBusy(false)}
 }
 function togglePick(p){setPicks(current=>{const next={...current};if(next[p.id])delete next[p.id];else next[p.id]=p;return next});setProposal(null);setMergeError('')}
 async function confirmMerge(){
  if(!proposal||busy)return;setBusy(true);setMergeError('');
  try{const result=await api('/people/merges','POST',{target_id:proposal.target.id,source_ids:proposal.sources.map(p=>p.id)});setPicks({});setMulti(false);setTarget('');setMatches(null);setProposal(null);setOffset(0);setPerson({...proposal.target,...result.person});setFaceOffset(0);setDrafts(d=>({...d,[result.person.id]:result.person.label}));setSaved(null);refresh()}
  catch(e){setMergeError(e.message)}finally{setBusy(false)}
 }
 async function undoMerge(id){
  if(busy)return;setBusy(true);setMergeError('');
  try{await api('/people/merges/'+id+'/undo','POST',{});setPicks({});setProposal(null);setMatches(null);refresh()}
  catch(e){setMergeError(e.message)}finally{setBusy(false)}
 }
 const picked=Object.values(picks);
 const dirty=person&&(drafts[person.id]??person.label)!==person.label;
 return <section className="people-settings" aria-label="面孔与姓名">
  <div className="settings-section-title"><h2><Icon name="face"/>面孔与姓名</h2><button onClick={refresh} disabled={busy||loading} aria-label="刷新面孔"><Icon name="refresh"/></button></div>
  <div className="people-summary">{[['检测面孔',overview?.faces],['关联照片',overview?.photos_with_faces],['人物分组',overview?.people],['已命名',overview?.named_people]].map(([label,n])=><span key={label}><small>{label}</small><strong>{n==null?'—':n.toLocaleString()}</strong></span>)}</div>
  <FaceReview api={api} generation={revision} onChange={refresh}/>
  <div className="people-filters"><label><Icon name="face"/><input aria-label="搜索人物姓名" value={text} onChange={e=>setText(e.target.value)} maxLength={80} placeholder="搜索姓名"/></label><select aria-label="人物命名状态" value={named} onChange={e=>{setNamed(e.target.value);setOffset(0)}}><option value="all">全部人物</option><option value="unnamed">未命名</option><option value="named">已命名</option></select></div>
  <div className="people-selection-toolbar"><button disabled={busy} aria-pressed={multi} onClick={()=>{setMulti(v=>!v);setPicks({});setProposal(null);setMergeError('')}}>{multi?'取消多选':'多选合并'}</button>{multi&&<><span>已选 {picked.length} 组</span><select aria-label="合并到人物" value={picks[target]?target:''} disabled={busy} onChange={e=>{setTarget(e.target.value);setProposal(null)}}><option value="">选择保留的人物</option>{picked.map(p=><option key={p.id} value={p.id}>{title(p)} · {p.id.slice(0,6)}</option>)}</select><button disabled={busy||picked.length<2||!picks[target]} onClick={()=>setProposal({target:picks[target],sources:picked.filter(p=>p.id!==target)})}>合并所选分组</button></>}</div>
  {mergeError&&<StatusNotice error={mergeError}/>}
  {proposal&&<section className="people-merge-confirm" aria-label="确认合并"><h3>归入 {title(proposal.target)}</h3><p>{proposal.sources.length+1} 个分组 → 1 个人物 · 保留目标姓名</p><div className="merge-source-portraits">{[proposal.target,...proposal.sources].map(p=><span key={p.id}><Portrait src={p.portrait}/><small>{title(p)}</small></span>)}</div><div className="settings-actions"><button disabled={busy} onClick={confirmMerge}>{busy?'合并中':'确认合并'}</button><button disabled={busy} onClick={()=>setProposal(null)}>取消</button></div></section>}
  {!!history.length&&<details className="people-merge-history"><summary>最近合并记录</summary>{history.map(h=><div key={h.id}><span>{h.groups} 组 → {h.label||'未命名'}<small>{new Date(h.created*1000).toLocaleString()}</small></span>{h.undone?<small>已撤销</small>:h.can_undo?<button disabled={busy} onClick={()=>undoMerge(h.id)}>撤销合并</button>:<small>后续修订已保留</small>}</div>)}</details>}
  <p className="settings-note">本地检测与聚类 · 分组可能有误，姓名由你确认。头像仅取已有缩略图。</p>
  {error&&<StatusNotice error={error} onRetry={refresh} detail={data?'保留已读取的人物':undefined}/>}
  <div className="people-settings-layout"><div className="people-catalog" aria-busy={loading}>
   {!data&&!error?<StatusPanel loading label="读取面孔"/>:data&&!data.people.length?<StatusPanel empty={query||named!=='all'?'没有符合条件的人物':'暂无检测到的面孔'}/>:<div className="people-cards">{data?.people.map(p=><div className="person-card-wrap" key={p.id}>{multi&&<label className="person-pick"><input type="checkbox" aria-label={'选择分组 '+title(p)} checked={!!picks[p.id]} disabled={busy||loading||(!picks[p.id]&&picked.length>=200)} onChange={()=>togglePick(p)}/></label>}<button className="person-card" aria-pressed={person?.id===p.id} disabled={busy||loading} onClick={()=>choose(p)}><Portrait src={p.portrait}/><span>{title(p)}</span><small>{p.count} 张照片</small></button></div>)}</div>}
   {!!data?.total&&<div className="people-pages"><button disabled={!offset||loading||busy} onClick={()=>setOffset(Math.max(0,offset-24))} aria-label="上一页人物">←</button><span>{offset+1}–{Math.min(offset+24,data.total)} / {data.total}</span><button disabled={offset+24>=data.total||loading||busy} onClick={()=>setOffset(offset+24)} aria-label="下一页人物">→</button></div>}
  </div><aside className="person-editor" ref={editor}>
   {!person?<div className="person-editor-empty"><Icon name="face"/><span>选择面孔，编辑姓名</span></div>:<>
    <div className="person-editor-title"><Portrait src={person.portrait}/><h3>{title(person)}</h3><button onClick={()=>setPerson(null)} disabled={busy} aria-label="收起人物"><Icon name="close"/></button></div>
    <form onSubmit={save} className="person-name-form"><label>姓名<input aria-label="人物姓名" value={drafts[person.id]??person.label} onChange={e=>{setDrafts(d=>({...d,[person.id]:e.target.value}));setSaved(null);setMatches(null);setProposal(null)}} maxLength={80} autoComplete="off" disabled={busy} placeholder="留空表示未命名"/></label><div className="settings-actions"><button disabled={busy||!dirty}>{busy?'保存中':'保存姓名'}</button>{saved===person.id&&!dirty?<SavedStatus/>:dirty?<small>未保存</small>:null}</div></form>
    {matches&&<section className="person-name-matches" aria-label="同名人物"><h3>是否归入已有的人物？</h3>{matches.people.map(p=><div key={p.id}><Portrait src={p.portrait}/><span>{title(p)}<small>{p.count} 张照片 · {p.id.slice(0,6)}</small></span><button disabled={busy} onClick={()=>setProposal({target:p,sources:[person]})}>归入此人</button></div>)}<button disabled={busy} onClick={e=>save(e,true)}>仍保存同名，保持独立</button></section>}
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
