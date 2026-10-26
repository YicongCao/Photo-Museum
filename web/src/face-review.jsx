import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './icons';
import {StatusNotice,StatusPanel} from './system-status';
import './face-review.css';

function Sample({src,alt}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);
 return failed?<span className="review-sample-missing"><Icon name="face"/></span>:<img src={src} alt={alt} onError={()=>setFailed(true)} decoding="async"/>;
}
export function FaceReview({api,generation,onChange}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[loading,setLoading]=useState(false),[scanned,setScanned]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),[history,setHistory]=useState([]);
 const skipped=useRef(new Set()),requests=useRef(new Map()),alive=useRef(true),changed=useRef(onChange);changed.current=onChange;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();setLoading(true);setError('');setScanned(0);setData(null);
  (async()=>{
   const h=await api('/face-review/history','GET',undefined,{signal:controller.signal});if(controller.signal.aborted)return;setHistory(h.items);
   let after='',examined=0;
   do{
    const result=await api('/face-review?'+new URLSearchParams({after}),'GET',undefined,{signal:controller.signal});if(controller.signal.aborted)return;
    examined+=result.examined;setScanned(examined);result.items=result.items.filter(q=>!skipped.current.has(q.face_id+'|'+q.person_id));
    if(result.items.length||!result.next_cursor){setData(result);return}
    after=result.next_cursor;
   }while(!controller.signal.aborted);
  })().catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[api,open,generation,version]);
 const question=data?.items[0];
 async function answer(decision){
  if(!question||busy)return;setBusy(true);setError('');
  const key=question.face_id+'|'+question.person_id+'|'+decision;
  if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID());
  const payload=Object.fromEntries(['face_id','person_id','source_person_id','model','revision','target_updated'].map(k=>[k,question[k]]));
  try{await api('/face-review','POST',{...payload,request_id:requests.current.get(key),decision});if(alive.current){requests.current.delete(key);changed.current();setVersion(n=>n+1)}}
  catch(e){if(alive.current)setError(e.message)}finally{if(alive.current)setBusy(false)}
 }
 async function undo(id){
  if(busy)return;setBusy(true);setError('');
  try{await api('/face-review/'+id+'/undo','POST',{});if(alive.current){changed.current();setVersion(n=>n+1)}}
  catch(e){if(alive.current)setError(e.message)}finally{if(alive.current)setBusy(false)}
 }
 function skip(){skipped.current.add(question.face_id+'|'+question.person_id);if(data.items.length>1)setData(d=>({...d,items:d.items.slice(1)}));else setVersion(v=>v+1)}
 return <section className="face-review" aria-label="面孔确认">
  <button className="face-review-toggle" aria-expanded={open} disabled={busy} onClick={()=>setOpen(v=>!v)}><Icon name="face"/><span>面孔确认</span><small>是 / 不是</small><span aria-hidden="true">{open?'−':'＋'}</span></button>
  {open&&<div className="face-review-content">
   {error&&<StatusNotice error={error} onRetry={()=>setVersion(v=>v+1)}/>}
   {loading?<StatusPanel loading label={scanned?'已检查 '+scanned+' 个面孔':'查找待确认面孔'}/>:question?<>
    <div className="face-review-heading"><h3>这是 {question.label} 吗？</h3><span title="余弦相似度未经身份正确率校准">匹配相似度 {question.similarity.toFixed(2)}</span></div>
    <div className="face-review-comparison"><div className="face-review-query"><Sample src={question.thumbnail} alt="待确认照片"/><span className="face-review-crop"><Sample src={question.portrait} alt="待确认面孔"/></span></div><div className="face-review-reference"><span>已确认的 {question.label}</span><div>{question.examples.map(src=><Sample key={src} src={src} alt="已确认参考面孔"/>)}</div><small>{question.sample_count} 个参考样本 · 相似度不代表身份正确率</small></div></div>
    <div className="face-review-actions"><button disabled={busy} onClick={()=>answer('yes')}><Icon name="check"/>是，归入此人</button><button disabled={busy} onClick={()=>answer('no')}><Icon name="close"/>不是</button><button disabled={busy} onClick={skip}>暂时跳过</button><small>仅确认这一张面孔</small></div>
   </>:!error?<StatusPanel empty={data?.status==='needs_samples'?'先为人物命名或确认样本':data?.status==='unavailable'?'本地面孔匹配未启用':'暂时没有待确认面孔'} detail={data?.status==='needs_samples'?'后续照片会参考同一模型下的已确认面孔':undefined}/>:null}
   {!!history.length&&<details className="face-review-history"><summary>最近确认记录</summary>{history.map(h=><div key={h.id}><span>{h.decision==='yes'?'是':'不是'} · {h.label}</span>{h.undone?<small>已撤销</small>:h.can_undo?<button disabled={busy} onClick={()=>undo(h.id)}>撤销确认</button>:<small>已有后续修订</small>}</div>)}</details>}
  </div>}
 </section>;
}
