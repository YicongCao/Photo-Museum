import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Icon} from './icons';
import {FullscreenButton} from './exhibition';
import './curator.css';
export const exhibitionRooms={cover:'Cover Flow',wall:'照片墙',calendar:'日历',map:'地图',gear:'器材馆',space:'时空隧道',rings:'人生年轮',constellation:'记忆星图',scroll:'记忆长卷',revisit:'故地重游'};
const statuses={queued:'等待中',running:'策展中',preparing:'准备展厅',completed:'已结束',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const terminal=s=>['completed','failed','cancelled','interrupted'].includes(s);
const tools={catalog_schema:['metadata','读取字段'],library_overview:['server','图库概况'],list_facets:['topic','分类检索'],search_photos:['subject','筛选照片'],photo_details:['photo','候选详情'],create_exhibition:['frame','展览草案']};
export function Curator({api}){
 const [provider,setProvider]=useState(null),[history,setHistory]=useState([]),
 [run,setRun]=useState(null),[events,setEvents]=useState([]),[prompt,setPrompt]=useState(''),[room,setRoom]=useState('auto'),
 [showRoom,setShowRoom]=useState('wall'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connection,setConnection]=useState(''),
 [exhibition,setExhibition]=useState(null),[follow,setFollow]=useState(false),[imageStates,setImageStates]=useState({});
 const [runId,setRunId]=useState(()=>new URLSearchParams(location.hash.split('?')[1]).get('run'));
 const currentId=useRef(runId),seen=useRef(new Set()),scroll=useRef(null),stick=useRef(true),processScroll=useRef(null),processStick=useRef(true),thoughtScroll=useRef(null),thoughtStick=useRef(true);currentId.current=runId;
 const refreshHistory=()=>api('/curator/runs').then(d=>setHistory(d.items));
 useEffect(()=>{const c=new AbortController();Promise.all([api('/curator/provider','GET',undefined,{signal:c.signal}),api('/curator/runs','GET',undefined,{signal:c.signal})]).then(([p,h])=>{
  setProvider(p);setHistory(h.items);if(!currentId.current&&h.items.length)setRunId(h.items[0].id)
 }).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[]);
 useEffect(()=>{
  if(!runId)return;const c=new AbortController();seen.current=new Set();stick.current=true;processStick.current=true;thoughtStick.current=true;setEvents([]);setExhibition(null);setImageStates({});setError('');setConnection('连接中');
  window.history.replaceState(null,'','#curator?run='+encodeURIComponent(runId));
  const load=async()=>{const r=await api('/curator/runs/'+runId,'GET',undefined,{signal:c.signal});if(c.signal.aborted)return;setRun(r);
   if(r.exhibition_id){const d=await api('/curator/exhibitions/'+r.exhibition_id,'GET',undefined,{signal:c.signal});if(!c.signal.aborted){setExhibition(d);setShowRoom(d.room)}}
  };
  load().catch(e=>{if(!c.signal.aborted)setError(e.message)});
  const source=new EventSource('/api/curator/runs/'+encodeURIComponent(runId)+'/stream');
  source.onopen=()=>setConnection('已连接');source.onerror=()=>{if(!c.signal.aborted)setConnection('重连中')};
  source.onmessage=e=>{if(c.signal.aborted)return;try{const item=JSON.parse(e.data);if(seen.current.has(item.id))return;seen.current.add(item.id);setEvents(p=>[...p,item].slice(-4000));
   if(item.kind==='phase')setRun(p=>p?{...p,status:item.data.stage==='preparing'?'preparing':'running'}:p);
   if(item.kind==='done')setRun(p=>p?{...p,status:item.data.status,error:item.data.error || null}:p);
  }catch{setConnection('事件格式异常')}};
  source.addEventListener('settled',()=>{source.close();setConnection('已结束');load().then(refreshHistory).catch(e=>{if(!c.signal.aborted)setError(e.message)})});
  return()=>{c.abort();source.close()};
 },[runId]);
 const thinking=useMemo(()=>events.filter(e=>e.kind==='thinking').map(e=>e.data.text).join(''),[events]);
 const answer=useMemo(()=>events.filter(e=>e.kind==='answer').map(e=>e.data.text).join(''),[events]);
 const calls=useMemo(()=>{const map=new Map();for(const e of events){if(e.kind==='tool_start')map.set(e.data.call_id,{...e.data});if(e.kind==='tool_end')map.set(e.data.call_id,{...map.get(e.data.call_id),...e.data,ended:true})}return [...map.values()]},[events]);
 const progress=events.filter(e=>e.kind==='preparation').at(-1)?.data;
 const usage=events.filter(e=>e.kind==='usage').reduce((n,e)=>n+(e.data.total_tokens || 0),0);
 const phase=events.filter(e=>e.kind==='phase').at(-1)?.data;
 const active=run&&!terminal(run.status),thumbnails=Object.values(imageStates),loaded=thumbnails.filter(v=>v==='loaded').length;
 useEffect(()=>{if(scroll.current&&stick.current)scroll.current.scrollTop=scroll.current.scrollHeight},[answer,exhibition,progress?.checked]);
 useEffect(()=>{if(processScroll.current&&processStick.current)processScroll.current.scrollTop=processScroll.current.scrollHeight;if(thoughtScroll.current&&thoughtStick.current)thoughtScroll.current.scrollTop=thoughtScroll.current.scrollHeight},[events]);
 async function submit(e){e.preventDefault();if(!prompt.trim()||active||busy)return;setBusy(true);setError('');try{
  const r=await api('/curator/runs','POST',{prompt,room,...(follow&&run?.id?{parent_run_id:run.id}:{})});setRun(r);setRunId(r.id);setPrompt('');setFollow(false);refreshHistory()
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 async function cancel(){setError('');try{setRun(await api('/curator/runs/'+runId+'/cancel','POST',{}))}catch(e){setError(e.message)}}
 function show(){if(!exhibition)return;location.hash='gallery?exhibit='+exhibition.id+'&room='+showRoom}
 return <div className="curator-shell">
  <header className="curator-header"><div><h1>策展助理</h1><button className="curator-provider-button" aria-label={'Provider '+(provider?.model || '')} onClick={()=>{location.hash='settings?tab=llm&from='+encodeURIComponent(location.hash.slice(1))}} disabled={!provider}><Icon name="server"/><span className="curator-provider-model">{provider?.model || 'Provider'}</span><span>{provider?.configured&&provider?.enabled?'已配置':'待配置'}</span></button></div>
   <nav><a href="#manage">Dashboard</a><a href="#gallery">Gallery</a><FullscreenButton/></nav>
  </header>
  <div className="curator-layout"><section className="curator-conversation" aria-label="策展对话">
   <div className="curator-conversation-head"><select aria-label="策展记录" value={runId || ''} onChange={e=>{setRunId(e.target.value);setFollow(false)}}><option value="">策展记录</option>{history.map(r=><option key={r.id} value={r.id}>{new Date(r.created*1000).toLocaleDateString()} · {r.prompt.slice(-40).replaceAll('\n',' ')}</option>)}</select>{run&&<span className={'curator-state '+run.status}><Icon name={active?'pulse':run.status==='completed'?'check':'alert'}/>{statuses[run.status]}</span>}</div>
   <div className="curator-messages" ref={scroll} onScroll={e=>{const n=e.currentTarget;stick.current=n.scrollHeight-n.scrollTop-n.clientHeight<60}}>
    {run&&<article className="curator-user"><small>要求</small><p>{run.prompt}</p></article>}
    {(answer||run?.answer)&&<article className="curator-response"><small>策展结果</small><p>{run?.status==='completed'?(run.answer || answer):answer || run?.answer}</p></article>}
    {progress&&<section className="curator-preparation" aria-label="展厅数据准备"><div><Icon name="thumbnail"/><span>本地缓存检查</span><output>{progress.checked} / {progress.total}</output></div><progress max={progress.total || 1} value={progress.checked}/><small>可用 {progress.ready}{progress.skipped>0&&` · 已失效 ${progress.skipped}`}</small></section>}
    {exhibition&&<section className="curator-result" aria-label="展览草案"><header><h2>{exhibition.title}</h2><span>{exhibition.count} 张照片</span></header><div className="curator-result-images">{exhibition.covers.map(p=><img key={p.id} src={p.thumbnail} alt="" decoding="async" onLoad={()=>setImageStates(s=>({...s,[p.id]:'loaded'}))} onError={()=>setImageStates(s=>({...s,[p.id]:'failed'}))}/>)}</div><small>预览 {loaded} / {exhibition.covers.length}{thumbnails.includes('failed')&&' · 部分预览不可用'}</small><div className="curator-show"><select aria-label="展示展厅" value={showRoom} onChange={e=>setShowRoom(e.target.value)}>{Object.entries(exhibitionRooms).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select><button onClick={show} disabled={exhibition.count===0}>Show ↗</button></div></section>}
    {active&&<div className="curator-active" role="status"><Icon name="pulse"/>{phase?.label || '等待模型'}</div>}
    {(error||run?.error)&&<p className="curator-error" role="alert">{error || run.error}</p>}
   </div>
   <form className="curator-composer" onSubmit={submit}><textarea aria-label="策展要求" placeholder="按时间、地点、器材、摄影风格或主题筛选…" value={prompt} maxLength={4000} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.currentTarget.form.requestSubmit()}}}/><div>
    <select aria-label="目标展厅" value={room} onChange={e=>setRoom(e.target.value)}><option value="auto">助理建议展厅</option>{Object.entries(exhibitionRooms).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
    {run&&['completed','failed'].includes(run.status)&&<label className="curator-follow"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>延续本轮</label>}
    {active?<button type="button" onClick={cancel}>取消</button>:<button disabled={busy||!prompt.trim()||!provider?.configured||!provider?.enabled}>开始策展 ↗</button>}
   </div></form>
  </section><aside className="curator-process" aria-label="策展运行过程"><header><h2>运行过程</h2><span>{connection || '—'}</span></header><div className="curator-process-scroll" ref={processScroll} onScroll={e=>{const n=e.currentTarget;processStick.current=n.scrollHeight-n.scrollTop-n.clientHeight<60}}>
   <details className="curator-thinking" open><summary><Icon name="style"/>模型思考 <small>provider 返回</small></summary><pre ref={thoughtScroll} onScroll={e=>{const n=e.currentTarget;thoughtStick.current=n.scrollHeight-n.scrollTop-n.clientHeight<40}}>{thinking || (active?'等待返回':run?'未返回思考内容':'—')}</pre></details>
   <div className="curator-tool-list">{calls.map(call=>{const [icon,label]=tools[call.name] || ['metadata',call.name];return <details key={call.call_id} className={'curator-tool '+(call.ended?'ended':'working')}><summary><Icon name={icon}/><span>{label}<small>{call.name}</small></span><span>{call.ended?(call.result?.error?'失败':`${call.duration_ms} ms`):'执行中'}</span></summary><pre>{JSON.stringify({arguments:call.arguments,...(call.ended?{result:call.result}:{})},null,2).slice(0,10000)}</pre></details>})}</div>
  </div><footer><span>{calls.length} 次工具调用</span><span>{usage.toLocaleString()} tokens</span>{provider&&<span>T {provider.temperature} · 深度思考 high</span>}</footer></aside></div>
 </div>
}
