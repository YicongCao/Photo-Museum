import {useEffect,useRef} from 'react';
const key='museumGallery';
// Same-URL entries preserve private photo identifiers outside the address bar.
export function useGalleryHistory(scope,ready,snapshot,onRestore){
 const current=useRef(snapshot),restore=useRef(onRestore),initialized=useRef(false),pending=useRef(null),timer=useRef(null);current.current=snapshot;restore.current=onRestore;
 const manager=useRef(null);
 const cancel=()=>{clearTimeout(timer.current);timer.current=null;pending.current=null};
 const write=next=>{const old=history.state?.[key];history.replaceState({...history.state,[key]:{version:1,scope,entry:old?.scope===scope?old.entry || crypto.randomUUID():crypto.randomUUID(),depth:old?.scope===scope?old.depth:0,snapshot:next}},'')};
 const flush=()=>{const next=pending.current,entry=history.state?.[key];cancel();if(next&&entry?.scope===scope&&entry.entry===next.entry)write(next.snapshot)};
 if(!manager.current)manager.current={
  push(next){flush();const old=history.state?.[key];history.pushState({...history.state,[key]:{version:1,scope,entry:crypto.randomUUID(),depth:old?.scope===scope?old.depth+1:1,snapshot:next}},'');},
  replace(next){cancel();write(next)},
  back(fallback){flush();const old=history.state?.[key];if(old?.scope===scope&&old.depth>0)history.back();else{manager.current.replace(fallback);restore.current(fallback,{initial:false})}},
  sync(next){if(!initialized.current)return;pending.current={entry:history.state?.[key]?.entry,snapshot:next};if(!timer.current)timer.current=setTimeout(flush,500)}
 };
 useEffect(()=>{
  const pop=e=>{cancel();const old=e.state?.[key];if(old?.version===1&&old.scope===scope)restore.current(old.snapshot,{initial:false})};
  // Reload captures its destination before pagehide; flush coalesced selection
  // earlier too, without preventing unload or showing a confirmation dialog.
  window.addEventListener('popstate',pop);window.addEventListener('pagehide',flush);window.addEventListener('beforeunload',flush);
  return()=>{flush();window.removeEventListener('popstate',pop);window.removeEventListener('pagehide',flush);window.removeEventListener('beforeunload',flush)};
 },[scope]);
 useEffect(()=>{
  if(!ready||initialized.current)return;initialized.current=true;
  const old=history.state?.[key];
  if(old?.version===1&&old.scope===scope)restore.current(old.snapshot,{initial:true});
  else manager.current.replace(current.current);
 },[ready,scope]);
 return manager.current;
}
