import React,{useEffect,useState} from 'react';
import {Icon} from './icons';
import {ProviderForm} from './settings-provider';
import {usePreferences} from './preferences';
import './settings.css';
const tabs={sources:['folder','文件源'],llm:['server','LLM Provider'],gps:['pin','GPS 地址'],display:['display','照片显示'],cache:['thumbnail','缓存']};
const gib=n=>(n/1024**3).toFixed(2);
function SourceCard({source:s,api,reload}){
 const [form,setForm]=useState({name:s.name,username:s.username,password:'',ca_pem:s.ca_pem || ''}),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[browse,setBrowse]=useState(null);
 const set=(k,v)=>{setSaved(false);setForm(p=>({...p,[k]:v}))};
 async function act(fn){setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <article className="settings-source"><header><h3>{s.name}</h3><button onClick={()=>{setEditing(v=>!v);setForm(p=>({...p,password:''}))}}>{editing?'收起':'编辑'}</button></header><p className="settings-source-url">{s.url}<br/>{s.root}</p><div className="settings-data"><span>WebDAV · 只读</span><span>{s.allow_http?'内网 HTTP':'HTTPS'}</span><span>{s.username}</span></div>
  <button disabled={busy} onClick={()=>act(async()=>setBrowse((await api('/sources/'+s.id+'/browse')).directories))}>测试连接 / 选择活动</button>
  {browse&&<form className="settings-scan" onSubmit={e=>{e.preventDefault();const root=new FormData(e.currentTarget).get('root');act(async()=>{await api('/jobs','POST',{source_id:s.id,root});location.hash='manage'})}}><label>连接成功 · {browse.length} 个一级目录<select name="root"><option value={s.root}>整个照片库（增量核对）</option>{browse.map(d=><option key={d.path} value={d.path}>{d.name}</option>)}</select></label><button disabled={busy}>开始刮削</button></form>}
  {editing&&<form className="settings-form" onSubmit={e=>{e.preventDefault();act(async()=>{await api('/settings/sources/'+s.id,'PUT',{...form,ca_pem:form.ca_pem || null});setForm(p=>({...p,password:''}));setSaved(true);await reload()})}}>
   <label>名称<input value={form.name} required maxLength={80} onChange={e=>set('name',e.target.value)}/></label><label>NAS 用户名<input value={form.username} required maxLength={256} onChange={e=>set('username',e.target.value)}/></label>
   <label>NAS 密码<small>已保存 · 留空保留</small><input type="password" autoComplete="off" value={form.password} maxLength={1024} onChange={e=>set('password',e.target.value)}/></label>
   <label>受信 CA（PEM，可选）<textarea value={form.ca_pem} maxLength={16000} onChange={e=>set('ca_pem',e.target.value)}/></label><p className="settings-note">更换地址或根目录请新建文件源，保留已有索引。</p><div className="settings-actions"><button disabled={busy}>保存文件源</button>{saved&&<span role="status">已保存</span>}</div>
  </form>}{error&&<p role="alert">{error}</p>}
 </article>
}
function Sources({sources,api,reload}){
 const [adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function add(e){e.preventDefault();const f=e.currentTarget,data=new FormData(f),body=Object.fromEntries(data);body.allow_http=data.get('allow_http')==='on';body.ca_pem=body.ca_pem || null;setBusy(true);setError('');try{await api('/sources','POST',body);f.reset();setAdding(false);await reload()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <><div className="settings-section-title"><h2>文件源</h2><button onClick={()=>setAdding(v=>!v)}>＋ 新建文件源</button></div>{sources.map(s=><SourceCard key={s.id} source={s} api={api} reload={reload}/>)}
 {(adding||!sources.length)&&<form className="settings-form settings-new-source" onSubmit={add}><h3>连接 WebDAV</h3>{[['name','名称',''],['url','WebDAV 地址','https://nas.local:5006'],['root','照片根目录','/'],['username','NAS 用户名',''],['password','NAS 密码','']].map(([name,label,placeholder])=><label key={name}>{label}<input name={name} type={name==='password'?'password':name==='url'?'url':'text'} placeholder={placeholder} required autoComplete={name==='password'?'off':undefined}/></label>)}<label>受信 CA（PEM，可选）<textarea name="ca_pem" maxLength={16000}/></label><label className="settings-check"><input name="allow_http" type="checkbox"/>允许内网 HTTP 明文连接</label>{error&&<p role="alert">{error}</p>}<button disabled={busy}>保存连接</button></form>}
 </>
}
function PreferenceForm({kind,api,reload,geography,paused}){
 const preferences=usePreferences(),[form,setForm]=useState(preferences.values),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[queued,setQueued]=useState(false);
 useEffect(()=>{if(preferences.ready)setForm(preferences.values)},[preferences.ready]);
 const set=(k,v)=>{setSaved(false);setForm(p=>({...p,[k]:v}))};
 async function save(e){e.preventDefault();setBusy(true);setError('');try{const value=await api('/preferences','PUT',form);preferences.update(value);setForm(value);setSaved(true);await reload()}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function refresh(){setBusy(true);setError('');try{await api('/settings/geography/refresh','POST',{});setQueued(true);await reload()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <><h2>{kind==='gps'?'GPS 地址':'照片显示'}</h2><form className="settings-form" onSubmit={save}>
 {kind==='gps'?<>
  <label>地址解析<select aria-label="地址解析" value={form.gps_mode} onChange={e=>set('gps_mode',e.target.value)}><option value="offline">本地 GeoNames</option><option value="disabled">暂停解析（保留已有地址）</option></select></label>
  <label className="settings-check"><input type="checkbox" checked={form.gps_use_inferred} onChange={e=>set('gps_use_inferred',e.target.checked)}/>使用已接受的近邻推断 GPS</label>
  <label>最近城市距离上限（km）<input type="number" min="1" max="500" step="1" required value={form.gps_max_distance_km} onChange={e=>set('gps_max_distance_km',Number(e.target.value))}/></label>
  <p className="settings-note">离线解析，不上传 GPS；地址为最近城市，不制造街道。保存后在本地增量更新已有地址，不读取 NAS。</p>
 </>:<>
  <label>原图读取<select aria-label="原图读取" value={form.original_loading} onChange={e=>set('original_loading',e.target.value)}><option value="auto">4K 后自动读取原图</option><option value="on_demand">点按后读取原图</option></select></label>
  <label>HDR / 原文件显示<select aria-label="HDR / 原文件显示" value={form.hdr_display} onChange={e=>set('hdr_display',e.target.value)}><option value="sdr">准确 SDR 优先</option><option value="native_if_supported">设备支持时尝试原生 HDR（实验）</option></select></label>
  <p className="settings-note">缩略图与 4K 始终为 sRGB / SDR。原生模式按设备能力尝试，解码失败回退 SDR；不改变缓存、不重刮。</p>
 </>}
 <div className="settings-actions"><button disabled={busy||!preferences.ready}>保存偏好</button>{saved&&<span role="status">已保存</span>}</div>{error&&<p role="alert">{error}<button type="button" className="settings-inline" onClick={async()=>{try{const value=await preferences.refresh();setForm(value);setError('')}catch(e){setError(e.message)}}}>重新读取</button></p>}
 </form>
 {kind==='gps'&&geography&&<section className="settings-geography"><h3>地址处理</h3><div className="settings-data"><span>{!geography.available?'离线数据或分析进程未就绪':geography.paused?'地址解析已暂停':paused?'随媒体处理暂停':geography.awaiting_worker?'等待进程应用设置':geography.pending?'后台更新中':'当前规则已处理'}</span></div>{geography.pending!=null&&<><progress value={geography.completed} max={geography.total||1}/><p>{geography.completed} / {geography.total} · 待处理 {geography.pending}</p></>}<button disabled={busy||!geography.available||geography.paused} onClick={refresh}>重新解析已有 GPS</button>{queued&&<p role="status">已排队 · 仅本地地址计算</p>}</section>}
 </>
}
function CacheSettings({api,data,reload}){
 const [budget,setBudget]=useState(Math.round(data.budget_bytes/1024**3)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 async function act(fn){setBusy(true);setError('');setSaved(false);try{await fn();await reload()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <><h2>缓存</h2><section className="settings-cache"><div className="settings-cache-total"><Icon name="thumbnail"/><strong>{gib(data.used_bytes)} <small>GiB 预览缓存</small></strong><span>/ {gib(data.budget_bytes)} GiB 预算</span></div><progress value={data.used_bytes} max={data.budget_bytes}/><p className="settings-note">常驻仅缩略图和 4K；原文件不常驻。预算还需容纳处理中临时文件。</p></section><form className="settings-form" onSubmit={e=>{e.preventDefault();act(async()=>{await api('/cache/budget','POST',{gib:Number(budget)});setSaved(true)})}}><label>缓存预算（GiB）<input type="number" min="4" max="200" step="1" required value={budget} onChange={e=>{setSaved(false);setBudget(e.target.value)}}/></label><p className="settings-note">修改预算前需暂停媒体处理；不会自动清理已有缓存。</p><div className="settings-actions"><button type="button" disabled={busy} onClick={()=>act(()=>api('/media/control','POST',{action:data.paused?'resume':'pause'}))}>{data.paused?'继续媒体处理':'暂停媒体处理'}</button><button disabled={busy||!data.paused}>保存预算</button>{saved&&<span role="status">已保存</span>}</div>{error&&<p role="alert">{error}</p>}</form></>
}
export function Settings({api,onLogout}){
 const query=new URLSearchParams(location.hash.split('?')[1]),wanted=query.get('tab'),from=query.get('from');
 const [tab,setTab]=useState(tabs[wanted]?wanted:'sources'),[data,setData]=useState(null),[error,setError]=useState('');
 const preferences=usePreferences();
 const reload=async()=>{const value=await api('/settings');setData(value);setError('');return value};
 useEffect(()=>{let stopped=false;const fetch=()=>api('/settings').then(d=>{if(!stopped){setData(d);setError('')}}).catch(e=>{if(!stopped)setError(e.message)});fetch();const timer=setInterval(fetch,5000);return()=>{stopped=true;clearInterval(timer)}},[]);
 const navigate=id=>{setTab(id);window.history.replaceState(null,'','#settings?tab='+id+(from?'&from='+encodeURIComponent(from):''))};
 const back=()=>{location.hash=from&&/^(manage|gallery|curator)(\?|$)/.test(from)?from:'manage'};
 return <div className="settings-shell"><header className="settings-header"><div><button className="settings-back" onClick={back}>← 返回</button><h1>Settings</h1></div><nav><a href="#manage">Dashboard</a><a href="#gallery">Gallery</a><button aria-label="锁定" onClick={onLogout}><Icon name="lock"/></button></nav></header><div className="settings-layout"><nav className="settings-tabs" aria-label="设置分类">{Object.entries(tabs).map(([id,[icon,label]])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>navigate(id)}><Icon name={icon}/>{label}</button>)}</nav><main className="settings-content">
 {error&&<p role="alert">{error}<button className="settings-inline" onClick={()=>reload().catch(e=>setError(e.message))}>重试</button></p>}
 {!data?<p role="status">读取设置</p>:tab==='sources'?<Sources sources={data.sources} api={api} reload={reload}/>:tab==='llm'?<><div className="settings-section-title"><h2>LLM Provider</h2><span>{data.provider.configured?data.provider.enabled?'已配置':'已停用':'待配置'}</span></div><ProviderForm api={api} initial={data.provider} onSaved={()=>reload().catch(e=>setError(e.message))}/></>:tab==='cache'?<CacheSettings api={api} data={data.cache} reload={reload}/>:<PreferenceForm key={tab} kind={tab} api={api} reload={reload} geography={data.geography} paused={data.cache.paused}/>}
 {preferences.error&&<p role="alert">偏好读取失败：{preferences.error}</p>}
 </main></div></div>
}
