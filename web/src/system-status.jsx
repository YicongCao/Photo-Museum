import React,{createContext,useContext,useState} from 'react';
import {Icon} from './icons';
import {MuseumMark,PhotoLoading} from './loading-mark';
import {failureInfo} from './status-text';

export const ServiceHealthContext=createContext(null);
export function StatusNotice({error,title,detail,onRetry,retryLabel='重新读取',onDismiss,scope='',className='',global=false,tone='error'}){
  const health=useContext(ServiceHealthContext),[retrying,setRetrying]=useState(false);
  const info=error?failureInfo(error):null;
  if(error&&!info)return null;
  if(!global&&info&&health&&['connection','timeout','response'].includes(info.code)&&health.code===info.code)return null;
  const retry=async()=>{if(retrying)return;setRetrying(true);try{await onRetry()}catch{/* Caller retains the failure state. */}finally{setRetrying(false)}};
  return <div onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(['Enter',' '].includes(e.key)&&e.target.closest('button'))e.stopPropagation()}} className={'museum-status-notice '+className} data-tone={tone} data-status-code={info?.code} role={tone==='error'?'alert':'status'}>
    <span className="museum-status-symbol"><Icon name={info?.icon || (tone==='success'?'check':'clock')}/></span>
    <div className="museum-status-copy">{scope&&<span className="museum-status-scope">{scope}</span>}<strong>{title || info?.title}</strong>{(detail??info?.detail)&&<small>{detail??info?.detail}</small>}</div>
    {(onRetry||onDismiss)&&<div className="museum-status-actions">{onRetry&&<button type="button" disabled={retrying} onClick={retry}><Icon name="refresh" className={retrying?'status-is-retrying':''}/><span>{retrying?'读取中':retryLabel}</span></button>}{onDismiss&&<button type="button" onClick={onDismiss} aria-label="关闭提示"><Icon name="close"/></button>}</div>}
  </div>;
}
export function StatusPanel({loading=false,label='读取图片',error,onRetry,empty='暂无可展示照片',action,className=''}){
  return <div className={'museum-status-panel '+className}>
    {loading&&!error?<PhotoLoading label={label}/>:<><MuseumMark/>{error?<StatusNotice error={error} onRetry={onRetry}/>:<><span className="museum-empty-label">{empty}</span>{action}</>}</>}
  </div>;
}
export function SavedStatus({children='已保存'}){return <span className="museum-saved" role="status"><Icon name="check"/>{children}</span>}

export class MuseumBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<div className="entrance-status"><StatusPanel error="页面暂不可用" onRetry={()=>location.reload()}/></div>:this.props.children}
}

export function MediaStatus({children,failed=false,className=''}){return <span className={'museum-media-status '+className} data-failed={failed?'true':undefined} role="status"><Icon name={failed?'alert':'photo'}/><span>{children}</span></span>}
