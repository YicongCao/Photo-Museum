import React,{createContext,useCallback,useContext,useEffect,useState} from 'react';
export const defaults={gps_mode:'offline',gps_use_inferred:true,gps_max_distance_km:100,original_loading:'auto',hdr_display:'sdr',cover_style:'classic',revision:0};
const Context=createContext({values:defaults,ready:false,error:'',refresh:()=>{},update:()=>{}});
export const usePreferences=()=>useContext(Context);
export function PreferencesProvider({api,children}){
 const [state,setState]=useState({values:defaults,ready:false,error:''});
 const refresh=useCallback(async signal=>{try{const values=await api('/preferences','GET',undefined,{signal});if(!signal?.aborted)setState({values,ready:true,error:''});return values}catch(e){if(!signal?.aborted)setState(p=>({...p,error:e.message}));throw e}},[api]);
 useEffect(()=>{const c=new AbortController();refresh(c.signal).catch(()=>{});const focus=()=>refresh(c.signal).catch(()=>{});window.addEventListener('focus',focus);return()=>{c.abort();window.removeEventListener('focus',focus)}},[refresh]);
 return <Context.Provider value={{...state,refresh,update:values=>setState({values,ready:true,error:''})}}>{children}</Context.Provider>
}
