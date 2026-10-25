import React from 'react';
import './loading-mark.css';
export function MuseumMark({animated=false,className=''}){
 return <svg className={'museum-mark '+(animated?'is-folding ':'')+className} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <g className="museum-leaf leaf-left"><path d="M8 18 24 10v38L8 56Z"/><path d="m12 42 5-9 7 8M17 24v.01"/></g>
  <g className="museum-leaf leaf-center"><path d="m24 10 16 8v38l-16-8"/><path d="m28 37 5-7 7 11M33 24v.01"/></g>
  <g className="museum-leaf leaf-right"><path d="m40 18 16-8v38l-16 8"/><path d="m44 32 5-7 3 5M49 18v.01"/></g>
 </svg>;
}
export function PhotoLoading({label='读取照片',compact=false,className=''}){
 return <span role="status" className={'photo-loading '+(compact?'compact ':'')+className}><MuseumMark animated/><span>{label}</span></span>;
}
