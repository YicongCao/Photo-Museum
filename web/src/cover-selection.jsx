import React,{useEffect,useState} from 'react';
import {PreviewImage} from './preview-image';
import {StatusNotice} from './system-status';
import {PhotoLoading} from './loading-mark';
export function CoverSelectionPreview({api}){
 const [activities,setActivities]=useState([]),[id,setId]=useState(''),[data,setData]=useState(null),[error,setError]=useState(null);
 useEffect(()=>{const c=new AbortController();api('/gallery','GET',undefined,{signal:c.signal}).then(v=>{if(!c.signal.aborted){setActivities(v.activities);setId(v.activities[0]?.id||'')}}).catch(e=>{if(e.name!=='AbortError')setError(e)});return()=>c.abort()},[]);
 useEffect(()=>{if(!id)return;const c=new AbortController();setData(null);setError(null);api('/gallery/'+id+'/selection','GET',undefined,{signal:c.signal}).then(v=>{if(!c.signal.aborted)setData(v)}).catch(e=>{if(e.name!=='AbortError')setError(e)});return()=>c.abort()},[id]);
 return <section className="cover-selection-preview"><label>选片对比<select aria-label="对比活动" value={id} onChange={e=>setId(e.target.value)}>{activities.map(a=><option key={a.id} value={a.id}>{[a.event.year,a.event.month,a.event.theme].filter(Boolean).join(' · ')}</option>)}</select></label>{error?<StatusNotice error={error}/>:!data&&id?<PhotoLoading compact label="读取封面"/>:data&&<>{[['top10','评分 Top10'],['representative','活动代表性精选']].map(([key,label])=><div key={key}><h4>{label}</h4><div className="cover-selection-strip">{data[key].map(p=><figure key={p.id}><PreviewImage src={p.thumbnail} alt={p.name}/><figcaption>{p.score?.toFixed(1)}</figcaption></figure>)}</div></div>)}<p className="settings-note">{data.score_kind==='aesthetic'?'美学分':'技术分'} · {data.summary.alternatives} 张不同选片{data.aesthetic_pending?' · 美学补算中':''}</p></>}</section>
}
