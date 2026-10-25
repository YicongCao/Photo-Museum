import React,{useEffect,useState} from 'react';
import {Icon} from './icons';
import {PhotoLoading} from './loading-mark';
import {StatusNotice,StatusPanel} from './system-status';
import './lexicon-settings.css';
const domains={subject:['subject','主体'],topic:['topic','摄影主题'],style:['style','摄影风格'],city:['pin','城市']};
const providers={visual:'主体识别',photography:'摄影分析',places:'地址解析'};
const aliasSource=value=>value.startsWith('imagenet1k/')?'ImageNet 词表':value.startsWith('geonames/')?'GeoNames 词表':({'observed-label':'原始标签','observed-id':'原始 ID','place-observation':'原始地名','place-display':'中文地名','photography-taxonomy-id':'主题词表 ID'}[value]||value);
export function LexiconSettings({api}){
 const [domain,setDomain]=useState('subject'),[text,setText]=useState(''),[query,setQuery]=useState(''),[pages,setPages]=useState([null]),[data,setData]=useState(null),[lastStatus,setLastStatus]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[rebuilding,setRebuilding]=useState(false);
 const cursor=pages.at(-1);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(text.trim()),280);return()=>clearTimeout(timer)},[text]);
 useEffect(()=>{
  const c=new AbortController();let first=true;
  async function read(){if(first)setLoading(true);try{const value=await api('/lexicon?'+new URLSearchParams({query,domain,limit:'20',...(cursor?{cursor}:{})}),'GET',undefined,{signal:c.signal});if(!c.signal.aborted){setData(value);setLastStatus(value.status);setError('')}}catch(e){if(!c.signal.aborted)setError(e.message)}finally{if(!c.signal.aborted)setLoading(false);first=false}}
  read();const timer=setInterval(()=>{if(!cursor)read()},5000);return()=>{c.abort();clearInterval(timer)};
 },[api,domain,query,cursor,revision]);
 const reset=()=>{setPages([null]);setRevision(n=>n+1)};
 async function rebuild(){setRebuilding(true);setError('');try{await api('/lexicon/rebuild','POST',{});reset()}catch(e){setError(e.message)}finally{setRebuilding(false)}}
 const status=data?.status||lastStatus,waiting=loading||text.trim()!==query;
 return <section className="lexicon-settings" aria-label="全局关键词词库">
  <div className="settings-section-title"><h2>关键词词库</h2><button disabled={rebuilding||status?.building} onClick={rebuild}><Icon name="refresh"/>{rebuilding?'排队中':'重建词库'}</button></div>
  {status&&<><div className="lexicon-metrics">{Object.entries(domains).map(([id,[icon,label]])=><button key={id} aria-pressed={domain===id} onClick={()=>{setDomain(id);setPages([null]);setData(null)}}><Icon name={icon}/><span><small>{label}</small><strong>{status.domains[id].toLocaleString()}</strong></span></button>)}</div>
   <div className="lexicon-health"><span><Icon name={!status.worker_recent?'clock':status.pending||status.building||status.stale?'pulse':'check'}/>{!status.worker_recent?'等待词库进程':status.building||status.stale?'构建中':status.pending?'增量更新中':'已同步'}</span><span>别名 {status.aliases.toLocaleString()}</span><span>歧义 {status.ambiguous}</span><span>待更新 {status.pending}</span><span>有词条照片 {status.photos.toLocaleString()}</span><span>版本 {status.generation}.{status.revision}</span></div>
   {status.updated>0&&<p className="lexicon-updated">上次索引 {new Date(status.updated*1000).toLocaleString()}</p>}</>}
  <div className="lexicon-search"><label><Icon name="subject"/><input aria-label="查找关键词" value={text} onChange={e=>{setText(e.target.value);setPages([null])}} maxLength={160} placeholder="中文、英文、别名或标准 ID"/></label>{waiting&&data&&<PhotoLoading compact label="读取词库"/>}</div>
  {error&&<StatusNotice error={error} scope="关键词词库" onRetry={reset}/>}
  {!data?<StatusPanel loading={!error} label="读取词库" error={error} onRetry={reset}/>:<>
   <div className="lexicon-result-head"><span>{domains[domain][1]} · {data.total} 个词条</span><span>照片数按不同照片计数</span></div>
   <div className="lexicon-rows" aria-busy={waiting} inert={waiting||undefined}>{data.items.map(item=><article className="lexicon-word" key={item.id}>
    <div className="lexicon-word-head"><div><h3>{item.display_name}{item.ambiguous&&<span className="lexicon-ambiguity"><Icon name="alert"/>同名需区分</span>}</h3><code>{item.id}</code>{item.domain==='city'&&<p>{[item.parents.country,item.parents.province].filter(Boolean).join(' · ')} <span>近似城市</span></p>}</div><output>{item.photo_count.toLocaleString()}<small>照片</small></output></div>
    <details><summary>来源与别名</summary><div className="lexicon-aliases">{item.aliases.map(a=><span key={a.value} title={(a.sources||[a.source]).map(aliasSource).join(' · ')}>{a.value}</span>)}</div><dl>{item.sources.map((s,i)=><div key={i}><dt>{providers[s.provider]||s.provider}</dt><dd>{s.model_version||'版本未记录'}{s.media_version&&<small>{s.media_version}</small>}</dd></div>)}</dl></details>
   </article>)}</div>
   {!data.items.length&&!waiting&&<StatusPanel empty={status.ready?'没有匹配词条':'首次词库构建中'}/>}
   <div className="lexicon-pages"><button disabled={pages.length===1||waiting} onClick={()=>setPages(p=>p.slice(0,-1))}>上一页</button><span>第 {pages.length} 页</span><button disabled={!data.next_cursor||waiting} onClick={()=>setPages(p=>[...p,data.next_cursor])}>下一页</button></div>
  </>}
 </section>
}
