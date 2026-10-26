import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PhotoLoading} from './loading-mark';
import './loading-preview.css';

// Public component preview: generated landscape shapes, no catalog or network API.
const modes={center:'中央读取',small:'照片流',inline:'原图读取',preview:'预览浮层'};
function Landscape({index=0}){return <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="600" height="800" fill={['#34494d','#40524a','#625c4b'][index%3]}/><circle cx="418" cy="176" r="65" fill="#d8ae72"/><path d="M0 610 230 250 460 620 600 420v380H0Z" fill="#203933"/><path d="m0 680 300-180 300 245v55H0Z" fill="#92806a"/><path d="M0 745q280-180 600-20v75H0Z" fill="#465d61"/></svg>}
function Preview(){
 const [theme,setTheme]=useState('dark'),[mode,setMode]=useState('center');
 return <main className="gallery-shell loading-preview" data-theme={theme} data-mode={mode}>
  <header className="loading-preview-tools"><nav aria-label="加载场景">{Object.entries(modes).map(([id,label])=><button key={id} aria-pressed={mode===id} onClick={()=>setMode(id)}>{label}</button>)}</nav><button onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?'白天':'黑夜'}</button><a href="/#gallery">Gallery</a></header>
  <div className="loading-preview-scene" aria-hidden="true">{[0,1,2,3,4].map(index=><div className="loading-preview-panel" key={index}><Landscape index={index}/></div>)}</div>
  {mode==='center'&&<div className="loading-preview-center"><PhotoLoading/></div>}
  {mode==='small'&&<PhotoLoading size="small" className="loading-preview-small" label="加载照片"/>}
  {mode==='inline'&&<div className="loading-preview-inline"><PhotoLoading compact label="4K · 原图读取中"/></div>}
  {mode==='preview'&&<div className="loading-preview-photo"><Landscape/><div><PhotoLoading size="small" label="读取 4K"/></div></div>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
