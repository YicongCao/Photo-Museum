import React from 'react';
import {Icon} from './icons';
import {FullscreenButton} from './exhibition';

// Keep section order and tools identical across page hosts; Gallery owns its room menu.
export function MuseumNav({current,onLogout,galleryControl,theme,onTheme}){
 const settings=current==='settings'?location.hash:'#settings?from='+encodeURIComponent(location.hash.slice(1));
 return <div className="museum-nav" role="navigation" aria-label="主导航">
  <div className="museum-nav-pages">
   <a href="#manage" aria-current={current==='dashboard'?'page':undefined}>Dashboard</a>
   <a href={settings} aria-current={current==='settings'?'page':undefined}>Settings</a>
   {galleryControl || <a href="#gallery" aria-current={current==='gallery'?'page':undefined}>Gallery</a>}
  </div>
  <div className="museum-nav-tools">
   {onTheme&&<button className="cover-theme-button museum-nav-tool" aria-label={theme==='dark'?'切换白天模式':'切换黑夜模式'} title={theme==='dark'?'切换白天模式':'切换黑夜模式'} aria-pressed={theme==='light'} onClick={onTheme}><Icon name={theme==='dark'?'sun':'moon'}/></button>}
   <button className="museum-nav-tool" onClick={onLogout} aria-label="锁定" title="锁定"><Icon name="lock"/></button>
   <FullscreenButton className="museum-nav-tool"/>
  </div>
 </div>;
}
