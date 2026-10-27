// Count received bytes without persisting the NAS original in browser caches.
import {failureInfo} from './status-text.js';

export function originalErrorText(error){
 const info=failureInfo(error);
 return !info||info.title==='操作未完成'?'原图暂不可用':info.title;
}

export async function originalFailure(response){
 let detail='';
 try{const body=await response.json();if(typeof body?.detail==='string')detail=body.detail}catch{}
 const info=failureInfo({status:response.status,message:detail});
 return Object.assign(new Error(info.title),{code:info.code,status:response.status});
}

export async function receiveOriginal(response, signal, report){
 const raw=response.headers.get('content-length'),length=Number(raw);
 const total=raw&&Number.isFinite(length)&&length>0?length:null;
 const reader=response.body?.getReader();
 if(!reader){const blob=await response.blob();signal.throwIfAborted();report(blob.size,total);return blob}
 const parts=[];let done=0;
 const cancel=()=>{reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});
 try{
  report(0,total);
  while(true){signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done)break;parts.push(item.value);done+=item.value.byteLength;report(done,total)}
  return new Blob(parts,{type:response.headers.get('content-type')||'application/octet-stream'});
 }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();parts.length=0}
}
