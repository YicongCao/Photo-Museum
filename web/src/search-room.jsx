import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './icons';
import {PreviewImage} from './preview-image';
import {StatusNotice} from './system-status';
import {PhotoLoading} from './loading-mark';
import './search-room.css';

const initial={query:'',subject_mode:'primary',country:[],province:[],city:[],camera:[],person:'',date_from:null,date_to:null,keyword_ids:[],include_estimated:true,pinned:null};
const domains={subject:'主体',topic:'摄影主题',city:'近似城市',style:'摄影风格'};
function KeywordEvidence({photo,selected=[],disabled,onMark}){
 const [expanded,setExpanded]=useState(false);
 const tags=[...photo.evidence.tags].sort((a,b)=>Number(selected.includes(b.id))-Number(selected.includes(a.id)));
 return <div className="search-evidence">{(expanded?tags:tags.slice(0,5)).map(t=><span key={t.id} title={t.confirmed?'馆主确认':t.rank?'模型候选第 '+t.rank+' 位 · 非正确率':'模型候选'}>{t.label}<small>{t.confirmed?'已确认':t.rank?'#'+t.rank:'候选'}</small>{!t.confirmed&&<><button disabled={disabled} onClick={()=>onMark(photo,t,1)} aria-label={'确认 '+t.label}>✓</button><button disabled={disabled} onClick={()=>onMark(photo,t,-1)} aria-label={'排除 '+t.label}>×</button></>}</span>)}{tags.length>5&&<button className="search-more-tags" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>{expanded?'收起':'全部标签'}</button>}</div>;
}
export function SearchRoom({api,state,onState,onCollection,onPhoto}){
 const [form,setForm]=useState(state.form||initial),[result,setResult]=useState(state.result||null),[chips,setChips]=useState(state.chips||[]),[order,setOrder]=useState(state.order||'time');
 const [expanded,setExpanded]=useState(!state.result),[busy,setBusy]=useState(false),[error,setError]=useState(null),[term,setTerm]=useState(''),[domain,setDomain]=useState('subject'),[cursor,setCursor]=useState(null),[suggestions,setSuggestions]=useState(null),[facets,setFacets]=useState({}),[reviews,setReviews]=useState([]),[reviewBusy,setReviewBusy]=useState(false);
 const request=useRef(null),generation=useRef(0),scroll=useRef(null);
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=0},[result?.id,result?.offset]);
 useEffect(()=>{onState({form,result,chips,order})},[form,result,chips,order]);
 useEffect(()=>{const c=new AbortController();if(state.result?.id){setBusy(true);api('/search/collections/'+state.result.id+'?offset='+(state.result.offset||0)+'&limit=36','GET',undefined,{signal:c.signal}).then(v=>{if(!c.signal.aborted)setResult({...state.result,...v})}).catch(e=>{if(e.name!=='AbortError')setError(e)}).finally(()=>{if(!c.signal.aborted)setBusy(false)})}Promise.all(['country','province','camera'].map(async field=>[field,(await api('/search/facets?field='+field,'GET',undefined,{signal:c.signal})).values])).then(v=>{if(!c.signal.aborted)setFacets(Object.fromEntries(v))}).catch(e=>{if(e.name!=='AbortError')setError(e)});api('/search/reviews','GET',undefined,{signal:c.signal}).then(v=>setReviews(v.items)).catch(e=>{if(e.name!=='AbortError')setError(e)});return()=>{c.abort();request.current?.abort();generation.current++}},[]);
 useEffect(()=>{if(!term.trim()){setSuggestions(null);return}const c=new AbortController();const timer=setTimeout(()=>api('/lexicon?domain='+domain+'&query='+encodeURIComponent(term)+(cursor?'&cursor='+encodeURIComponent(cursor):''),'GET',undefined,{signal:c.signal}).then(setSuggestions).catch(e=>{if(e.name!=='AbortError')setError(e)}),220);return()=>{clearTimeout(timer);c.abort()}},[term,domain,cursor]);
 const set=(key,value)=>setForm(p=>({...p,[key]:value}));
 async function search(offset=null){request.current?.abort();const c=new AbortController();request.current=c;const id=++generation.current;setBusy(true);setError(null);try{
  const value=offset!==null&&result?await api('/search/collections/'+result.id+'?offset='+offset+'&limit=36','GET',undefined,{signal:c.signal}):await api('/search','POST',{filters:form,order,limit:36},{signal:c.signal});
  if(id===generation.current){setExpanded(false);setResult({...value,id:value.id||result.id,offset:offset||0,filters:offset!==null?result.filters:value.filters,order:offset!==null?result.order:value.order});}
 }catch(e){if(id===generation.current&&e.name!=='AbortError')setError(e)}finally{if(id===generation.current)setBusy(false)}}
 async function mark(photo,tag,verdict){setReviewBusy(true);setError(null);try{await api('/search/reviews/'+photo.id,'PUT',{revision:photo.revision,keyword_id:tag.id,verdict});setReviews((await api('/search/reviews')).items);await search(result?.offset||0)}catch(e){setError(e)}finally{setReviewBusy(false)}}
 async function undo(token){setReviewBusy(true);try{await api('/search/reviews/'+token+'/undo','POST',{});setReviews((await api('/search/reviews')).items);if(result)await search(result?.offset||0)}catch(e){setError(e)}finally{setReviewBusy(false)}}
 const add=t=>{if(form.keyword_ids.includes(t.id))return;set('keyword_ids',[...form.keyword_ids,t.id]);setChips(v=>[...v,{id:t.id,label:t.display_name,domain:t.domain}]);setTerm('')};
 const changed=result&&(Object.keys(form).some(k=>JSON.stringify(result.filters[k])!==JSON.stringify(form[k]))||result.order!==order);
 return <section className="search-room"><div className="search-heading"><h1>检索</h1><span>本地照片库</span></div>
 <form className="search-controls" onSubmit={e=>{e.preventDefault();search()}}>
  <div className="search-query"><Icon name="search"/><input aria-label="搜索文字" value={form.query} maxLength={160} onChange={e=>set('query',e.target.value)} placeholder="活动、地点或关键词 · 空格分隔"/><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>筛选条件</button><button disabled={busy}>检索</button></div>
  <div className="search-refinements" hidden={!expanded}>
  <div className="search-filters">
   {['country','province','camera'].map((key,i)=><label key={key}><span><Icon name={i===2?'camera':'pin'}/>{['国家','省份','相机'][i]}</span><select aria-label={['国家','省份','相机'][i]} value={form[key][0]||''} onChange={e=>set(key,e.target.value?[e.target.value]:[])}><option value="">全部</option>{facets[key]?.map(v=><option key={v.value} value={v.value}>{v.value} · {v.count}</option>)}</select></label>)}
   <label><span><Icon name="face"/>姓名</span><input aria-label="姓名" value={form.person} maxLength={80} onChange={e=>set('person',e.target.value)} placeholder="已命名人物"/></label>
   <label><span><Icon name="clock"/>开始日期</span><input aria-label="开始日期" type="date" value={form.date_from||''} onChange={e=>set('date_from',e.target.value||null)}/></label>
   <label><span>结束日期</span><input aria-label="结束日期" type="date" value={form.date_to||''} onChange={e=>set('date_to',e.target.value||null)}/></label>
  </div>
  <div className="search-keywords"><select aria-label="关键词分类" value={domain} onChange={e=>{setDomain(e.target.value);setCursor(null);setSuggestions(null)}}>{Object.entries(domains).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><div className="search-suggest"><input aria-label="查询关键词词库" value={term} maxLength={120} onChange={e=>{setTerm(e.target.value);setCursor(null)}} placeholder="从词库选择中英文关键词"/>{suggestions&&<div className="search-suggestions">{suggestions.items.length?suggestions.items.map(t=><button type="button" key={t.id} onClick={()=>add(t)}>{t.display_name}<small>{[t.parents?.country,t.parents?.province].filter(Boolean).join(' · ')||t.id} · 全部候选 {t.photo_count} 张</small></button>):<p>{suggestions.complete?'未找到词条':'词库更新中，结果暂不完整'}</p>}{suggestions.next_cursor&&<button type="button" onClick={()=>setCursor(suggestions.next_cursor)}>更多词条 →</button>}{cursor&&<button type="button" onClick={()=>setCursor(null)}>返回首组</button>}{!suggestions.complete&&suggestions.items.length>0&&<small>词库更新中 · 暂不完整</small>}</div>}</div>
   <select aria-label="主体匹配方式" value={form.subject_mode} onChange={e=>set('subject_mode',e.target.value)}><option value="primary">首选候选</option><option value="all">全部候选</option><option value="confirmed">仅人工确认主体</option></select>
   <select aria-label="结果排序" value={order} onChange={e=>setOrder(e.target.value)}><option value="time">时间顺序</option><option value="score">评分顺序</option><option value="diverse">跨活动均衡</option></select>
   <label><input type="checkbox" checked={form.pinned===true} onChange={e=>set('pinned',e.target.checked?true:null)}/>仅已标记</label>
   <label><input type="checkbox" checked={form.include_estimated} onChange={e=>set('include_estimated',e.target.checked)}/>含已采纳推断</label>
  </div>
  </div>
  <div className="search-chips">{['country','province','camera'].flatMap(k=>(form[k]||[]).map(v=><button key={k+v} type="button" onClick={()=>set(k,form[k].filter(x=>x!==v))}>{v} ×</button>))}{[['person','姓名'],['date_from','从'],['date_to','至']].filter(([k])=>form[k]).map(([k,label])=><button key={k} type="button" onClick={()=>set(k,k==='person'?'':null)}>{label} · {form[k]} ×</button>)}{form.pinned===true&&<button type="button" onClick={()=>set('pinned',null)}>仅已标记 ×</button>}{!form.include_estimated&&<button type="button" onClick={()=>set('include_estimated',true)}>不含推断 ×</button>}{chips.map(t=><button key={t.id} type="button" onClick={()=>{set('keyword_ids',form.keyword_ids.filter(id=>id!==t.id));setChips(chips.filter(x=>x.id!==t.id))}}>{domains[t.domain]} · {t.label} ×</button>)}</div>
 </form>
 {error&&<StatusNotice error={error} scope="检索" onDismiss={()=>setError(null)}/>}
 <div className="search-result-heading"><span>{result?`${result.total} 张 · ${{primary:'首选候选',all:'全部候选',confirmed:'人工确认主体'}[result.filters.subject_mode]}`:'选择条件开始检索'}{changed&&' · 条件已修改，待检索'}</span>{result?.total>0&&<button disabled={busy||changed} onClick={()=>onCollection({id:'search-'+result.id,title:'检索结果',dateLabel:result.total+' 张',endpoint:'/search/collections/'+result.id+'?view=wall'})}>展开照片流 →</button>}</div>
 <div className="search-scroll" ref={scroll}>{busy&&<PhotoLoading label="读取照片"/>}<div className="search-results">{result?.items.map(p=><article key={p.id} className="search-result"><button className="search-photo" aria-label={'查看 '+p.name} onClick={()=>onPhoto(p,result.items)}><PreviewImage src={p.thumbnail} alt={p.event.theme||p.name}/></button><header><span>{p.event.theme}</span><small>{p.period||'日期未知'}</small></header><p>{p.evidence.place?'近似城市 · '+(p.evidence.place.city||'未详'):p.camera||'地点未知'}</p><KeywordEvidence photo={p} selected={result.filters.keyword_ids} disabled={reviewBusy||busy} onMark={mark}/></article>)}</div>
 {result&&!result.total&&!busy&&<p className="search-empty">没有符合这些条件的照片</p>}
 {result&&result.total>36&&<div className="search-pagination"><button disabled={busy||changed||!result.offset} onClick={()=>search(Math.max(0,result.offset-36))}>上一页</button><span>{Math.floor((result.offset||0)/36)+1} / {Math.ceil(result.total/36)}</span><button disabled={busy||changed||(result.offset||0)+36>=result.total} onClick={()=>search((result.offset||0)+36)}>下一页</button></div>}
 {reviews.length>0&&<details className="search-reviews"><summary>最近关键词修订 · {reviews.length}</summary>{reviews.map(r=><div key={r.token}><PreviewImage src={r.thumbnail} alt={r.name||'修订照片'}/><span>{r.name}<br/>{r.label} · {r.verdict===1?'已确认':'已排除'}</span><button disabled={reviewBusy} onClick={()=>undo(r.token)}>撤销</button></div>)}</details>}
 </div></section>;
}
