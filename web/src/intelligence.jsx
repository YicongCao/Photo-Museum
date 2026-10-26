import React,{useEffect,useState} from 'react';
import {StatusNotice,StatusPanel} from './system-status';
export function Intelligence({api}){
 const [status,setStatus]=useState(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();api('/intelligence','GET',undefined,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setStatus(value)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[api]);
 return <section className="intelligence-panel section"><div className="section-title"><h2>本地策展室</h2></div>
  {!status&&!error&&<StatusPanel loading label="读取面孔"/>}{error&&<StatusNotice error={error}/>}
  {status&&<div className="intelligence-status"><span>{status.faces.toLocaleString()} 个面孔</span><span>{status.people.toLocaleString()} 个人物分组</span><span>{status.named_people.toLocaleString()} 个已命名</span></div>}
  <button onClick={()=>{location.hash='settings?tab=people&from=manage'}}>面孔与姓名 →</button>
 </section>;
}
