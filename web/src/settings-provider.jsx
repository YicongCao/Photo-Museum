import React,{useState} from 'react';
import {StatusNotice,SavedStatus} from './system-status';
export function ProviderForm({api,initial,onSaved}){
 const [form,setForm]=useState({...initial,api_key:''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const set=(k,v)=>{setSaved(false);setForm(p=>({...p,[k]:v}))};
 async function save(e){e.preventDefault();setBusy(true);setError('');try{const value=await api('/curator/provider','PUT',{base_url:form.base_url,model:form.model,temperature:Number(form.temperature),enabled:form.enabled,api_key:form.api_key});setForm({...value,api_key:''});onSaved(value);setSaved(true)}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <form className="settings-form" onSubmit={save}>
  <label>API 地址<input value={form.base_url} onChange={e=>set('base_url',e.target.value)} required type="url" maxLength={2048}/></label>
  <label>模型<input value={form.model} onChange={e=>set('model',e.target.value)} required maxLength={100}/></label>
  <label>API key{initial.configured&&<small>已加密保存 · 留空保留</small>}<input aria-label="API key" type="password" autoComplete="off" value={form.api_key} onChange={e=>set('api_key',e.target.value)} maxLength={2048}/></label>
  <label>Temperature <output>{form.temperature}</output><input aria-label="Temperature" type="range" min="0" max="2" step="0.1" value={form.temperature} onChange={e=>set('temperature',e.target.value)}/></label>
  <label className="settings-check"><input type="checkbox" checked={form.enabled} onChange={e=>set('enabled',e.target.checked)}/>启用策展 Provider</label>
  <p className="settings-note">深度思考 · high。发送策展要求与精简索引；原图、精确 GPS 和人脸特征留在本机。</p>
  {error&&<StatusNotice error={error} scope="Provider 设置"/>}<div className="settings-actions"><button disabled={busy}>保存 Provider</button>{saved&&<SavedStatus/>}</div>
 </form>
}
