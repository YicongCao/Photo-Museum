import {coverCount,coverWindow} from './cover-layout.js';

// Cover metadata already comes from the scoped gallery catalogue. Warm the
// complete landing window (including its cyclic neighbours), never NAS originals.
export function randomCoverIndex(total,current,random=Math.random){
 if(total<2)return current;
 const pick=Math.min(total-2,Math.floor(random()*(total-1)));
 return pick>=current?pick+1:pick;
}
export function coverPreviewSources(activities,index,width,height,room='cover'){
 const count=coverCount(width,height,activities.length);
 const window=room==='space'?Array.from({length:count+1},(_,n)=>({index:index+n-1})).filter(x=>x.index>=0&&x.index<activities.length):coverWindow(activities.length,index,count);
 return [...new Set(window
  .flatMap(({index:i})=>activities[i].selected.map(p=>p.thumbnail).filter(Boolean)))];
}
export function prepareCover(sources,{imageFactory=()=>new Image(),timeout=20000}={}){
 const images=new Set();let stopped=false,next=0,rejectStop;
 const stopPromise=new Promise((_,reject)=>{rejectStop=reject});
 const dispose=()=>{if(stopped)return;stopped=true;clearTimeout(timer);for(const img of images){img.removeAttribute('src')}images.clear();rejectStop(new DOMException('Cancelled','AbortError'))};
 const timer=setTimeout(()=>{rejectStop(new Error('Preview timeout'));dispose()},timeout);
 const work=async()=>{
  while(!stopped&&next<sources.length){
   const src=sources[next++],img=imageFactory();images.add(img);img.decoding='async';img.fetchPriority='high';img.src=src;
   await img.decode();if(stopped)return;
  }
 };
 const promise=Promise.race([Promise.all(Array.from({length:Math.min(6,sources.length)},work)),stopPromise])
  .then(()=>{clearTimeout(timer);if(stopped)throw new DOMException('Cancelled','AbortError')})
  .catch(e=>{dispose();throw e});
 // Keep decoded images until the destination is painted; caller owns disposal.
 return {promise,dispose};
}
