import {failureInfo} from './status-text.js';
export class MuseumRequestError extends Error {
  constructor(code,status=0,detail=''){
    const info=failureInfo({code,status,message:detail});
    super(info.title);this.name='MuseumRequestError';this.code=info.code;this.status=status;
  }
}
export async function api(path,method='GET',data,options={}){
  const controller=new AbortController();
  const cancel=()=>controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)cancel();
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},options.timeoutMs ?? 30000);
  try{
    const response=await fetch('/api'+path,{method,signal:controller.signal,
      headers:data!==undefined?{'Content-Type':'application/json'}:{},body:data!==undefined?JSON.stringify(data):undefined});
    const code=path==='/login'&&response.status===401?'password':({401:'authentication',403:'permission',404:'missing',409:'conflict',413:'oversized',422:'validation',429:'rate_limit'})[response.status] || (response.status>=500?'response':'unknown');
    const body=await response.text();let value;
    try{value=body?JSON.parse(body):null}catch{throw new MuseumRequestError(response.ok?'response':code,response.status)}
    if(!response.ok)throw new MuseumRequestError(code,response.status,typeof value?.detail==='string'?value.detail:'');
    if(typeof window!=='undefined'&&method!=='GET'&&method!=='HEAD')window.dispatchEvent(new Event('museum-data-changed'));
    return value;
  }catch(error){
    if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(timedOut)throw new MuseumRequestError('timeout');
    if(error instanceof MuseumRequestError)throw error;
    if(error?.name==='AbortError')throw error;
    throw new MuseumRequestError('connection');
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel)}
}
