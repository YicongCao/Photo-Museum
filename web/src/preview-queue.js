// Only local, converted previews use this queue. No NAS originals or persistent JS cache.
export function createPreviewQueue({fetcher=(...a)=>fetch(...a),createURL=b=>URL.createObjectURL(b),revokeURL=u=>URL.revokeObjectURL(u),limit=6,backgroundLimit=2}={}){
 const jobs=new Map();let running=0,background=0,scheduled=false,nativeActive=0,quietUntil=0,wake=null;
 const abortError=()=>new DOMException('Preview released','AbortError');
 function pump(){
  scheduled=false;
  while(running<limit){
   const job=[...jobs.values()].filter(j=>j.state==='queued'&&(j.priority<3||background<backgroundLimit&&running===background&&nativeActive===0&&Date.now()>=quietUntil)).sort((a,b)=>a.priority-b.priority||a.order-b.order)[0];
   if(!job){
    if(jobs.size&&Date.now()<quietUntil&&!wake)wake=setTimeout(()=>{wake=null;schedule()},quietUntil-Date.now());
    break;
   }
   job.state='running';running++;const low=job.priority>=3;if(low)background++;
   Promise.resolve().then(()=>fetcher(job.src,{signal:job.controller.signal,credentials:'same-origin',priority:job.priority<=1?'high':'low'}))
    .then(r=>{if(!r.ok){const e=Error('Preview unavailable');e.status=r.status;throw e}return r.blob()})
    .then(blob=>{if(job.controller.signal.aborted)throw abortError();job.url=createURL(blob);job.state='ready';job.resolve(job.url)})
    .catch(e=>{job.state='failed';job.reject(e);if(jobs.get(job.src)===job)jobs.delete(job.src)})
    .finally(()=>{running--;if(low)background--;schedule()});
  }
 }
 function schedule(){if(!scheduled){scheduled=true;queueMicrotask(pump)}}
 let order=0;
 function acquire(src,priority=1){
  let job=jobs.get(src);
  if(!job){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});job={src,priority,order:order++,refs:0,state:'queued',controller:new AbortController(),promise,resolve,reject};jobs.set(src,job)}
  job.refs++;job.priority=Math.min(priority,job.priority);schedule();let released=false;
  return {promise:job.promise,promote(p){job.priority=Math.min(p,job.priority);schedule()},release(){if(released)return;released=true;if(--job.refs)return;
   if(jobs.get(src)===job)jobs.delete(src);job.controller.abort();if(job.url)revokeURL(job.url);if(job.state==='queued')job.reject(abortError());schedule();}};
 }
 function clear(){clearTimeout(wake);wake=null;for(const j of jobs.values()){j.controller.abort();if(j.url){revokeURL(j.url);j.url=null;}if(j.state==='queued')j.reject(abortError())}jobs.clear()}
 function nativeForeground(){nativeActive++;let ended=false;return()=>{if(!ended){ended=true;nativeActive--;if(!nativeActive)quietUntil=Date.now()+120;schedule()}}}
 return {acquire,clear,nativeForeground};
}
export const previews=createPreviewQueue();
