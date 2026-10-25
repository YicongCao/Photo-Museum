import React,{createContext,useContext,useEffect,useState} from 'react';

export const RoomRefreshContext=createContext(0);

export function useRoomData(api,path) {
 const revision=useContext(RoomRefreshContext);
 const [result,setResult]=useState({data:null,error:'',loading:true}),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!path){setResult({data:null,error:'',loading:false});return}
  const c=new AbortController();setResult(r=>({...r,error:'',loading:true}));
  api(path,'GET',undefined,{signal:c.signal}).then(data=>{if(!c.signal.aborted)setResult({data,error:'',loading:false})})
   .catch(e=>{if(!c.signal.aborted)setResult(r=>({...r,error:e.message,loading:false}))});
  return()=>c.abort();
 },[api,path,retry,revision]);
 return {...result,retry:()=>setRetry(n=>n+1)};
}
export function RoomStatus({loading,error,retry,empty}) {
 if(error)return <div className="room-status" role="alert">{error}<button onClick={retry}>重试</button></div>;
 if(loading)return <div className="room-status" role="status">读取照片</div>;
 return empty ? <div className="room-status">暂无可展示照片</div> : null;
}
export function query(values) {
 return new URLSearchParams(Object.entries(values).filter(([,v])=>v!=null&&v!==false&&v!=='')).toString();
}
export function collection(title,filters,dateLabel='') {
 const search=query(filters);
 return {id:'collection-'+search,title,dateLabel,endpoint:'/exhibitions/photos?'+search};
}
export function stepPeriod(anchor,scale,amount) {
 const p=(anchor || new Date().toISOString().slice(0,10)).split('-').map(Number);
 const d=new Date(Date.UTC(p[0],(p[1] || 1)-1,scale==='week'?(p[2] || 1):1));
 if(scale==='year')d.setUTCFullYear(d.getUTCFullYear()+amount);
 else if(scale==='week')d.setUTCDate(d.getUTCDate()+7*amount);
 else d.setUTCMonth(d.getUTCMonth()+amount);
 return d.toISOString().slice(0,scale==='year'?4:scale==='week'?10:7);
}
