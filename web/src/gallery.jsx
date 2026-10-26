import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import {MuseumNav} from "./museum-nav";
import {RoomMenuIcon} from './room-menu-icon';
import { Tunnel, PhotoWall, FullscreenButton } from "./exhibition";
import "./gallery.css";
import { useSceneMotion, createActivityWarmup } from "./scene-motion";
import {PhotoLoading} from "./loading-mark";
import {StatusNotice,StatusPanel,MediaStatus} from "./system-status";
import {useGalleryHistory} from "./gallery-history";
import { PhotoArchive } from "./photo-archive";
import {PhotoAnalysisArchive} from "./photo-analysis";
import { ActivityTimeline } from "./timeline";
import { CalendarRoom } from './rooms/calendar';
import { MapRoom } from './rooms/map';
import { GearRoom } from './rooms/gear';
import { SpacetimeRoom } from './rooms/spacetime';
import { RingsRoom } from './rooms/rings';
import { ConstellationRoom } from './rooms/constellation';
import { MemoryScrollRoom } from './rooms/memory-scroll';
import { RevisitRoom } from './rooms/revisit';
import { RoomRefreshContext } from './rooms/common';
import './rooms/rooms.css';
import {usePreferences} from './preferences';
import './cover-theme.css';
import './gallery-refinement.css';
import './gallery-navigation.css';
import './gallery-cover-polish.css';
import './gallery-timeline-glass.css';
import {useGalleryChrome} from './gallery-chrome';
import './gallery-chrome.css';

const roomNames={cover:'Cover Flow',calendar:'日历',map:'地图',gear:'器材馆',space:'时空隧道',revisit:'故地重游',scroll:'记忆长卷',rings:'人生年轮',constellation:'记忆星图'};
const creativeRooms={rings:RingsRoom,constellation:ConstellationRoom,scroll:MemoryScrollRoom,revisit:RevisitRoom};
function savedRooms(key='museum.rooms'){try{return JSON.parse(sessionStorage.getItem(key) || '{}')}catch{return {}}}

export function Gallery({ api:baseApi, onAdmin,onLogout,exhibitionId=null,roomHint=null }) {
  const {values:preferences}=usePreferences();
  const coverStyle=preferences.cover_style || 'classic';
  const storageKey=exhibitionId?'museum.rooms.'+exhibitionId:'museum.rooms';
  const initialGalleryHistory=useRef(history.state?.museumGallery);
  const api=useMemo(()=>exhibitionId?((path,...args)=>baseApi((path==='/gallery'||path.startsWith('/gallery/')||path.startsWith('/exhibitions/'))?'/curator/exhibitions/'+encodeURIComponent(exhibitionId)+path:path,...args)):baseApi,[baseApi,exhibitionId]);
  const [scopeMeta,setScopeMeta]=useState(null);
  const [coverTheme,setCoverTheme]=useState(()=>{try{return localStorage.getItem('museum.cover-theme')==='light'?'light':'dark'}catch{return 'dark'}});
  const toggleCoverTheme=()=>setCoverTheme(previous=>{const next=previous==='dark'?'light':'dark';try{localStorage.setItem('museum.cover-theme',next)}catch{}return next});
  const [loaded, setLoaded] = useState(false),
    [activities, setActivities] = useState([]),
    [index, setIndex] = useState(0),
    [view, setView] = useState("tunnel"),
    [photo, setPhoto] = useState(null),
    [error, setError] = useState(""),
    [loadError,setLoadError]=useState(null),
    [wallId,setWallId]=useState(null),
    [counts,setCounts]=useState(null),
    [opening,setOpening]=useState(false),[immersive,setImmersive]=useState(false);
  const [room,setRoom]=useState(()=>roomNames[roomHint]?roomHint:roomNames[savedRooms(storageKey).room]?savedRooms(storageKey).room:'cover'),[roomMenu,setRoomMenu]=useState(false),
    [anchor,setAnchor]=useState(()=>savedRooms(storageKey).anchor || null),[roomStates,setRoomStates]=useState(()=>savedRooms(storageKey).states || {}),
    [collection,setCollection]=useState(null);
  const roomMenuRef=useRef(null),wallPositions=useRef({});
  const [roomRevision,setRoomRevision]=useState(0);
  useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({room,anchor,states:roomStates,activityId:activities[index]?.id || savedRooms(storageKey).activityId}))}catch{}},[room,anchor,roomStates,activities[index]?.id]);
  useEffect(()=>{
    if(!roomMenu)return;
    const focus=requestAnimationFrame(()=>roomMenuRef.current?.querySelector('[aria-checked="true"]')?.focus());
    const close=e=>{if(!roomMenuRef.current?.contains(e.target))setRoomMenu(false)};
    const key=e=>{if(e.key==='Escape'){setRoomMenu(false);roomMenuRef.current?.querySelector('button')?.focus()}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(focus);document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key)};
  },[roomMenu]);
  const tunnel = useRef(null),
    lastFocus = useRef(null),
    selectedId = useRef(null);
  const shell=useRef(null), warm=useRef(null), openingRef=useRef(false);
  const chromeVisible=useGalleryChrome(shell,{menuOpen:roomMenu});
  const animate=useSceneMotion(shell);
  const transition=useRef(0),sceneRef=useRef(null),navigationRequest=useRef(null),pendingFocus=useRef(null);
  const current = activities[index];
  const CreativeRoom=creativeRooms[room];
  const wallActivity=activities.find(a=>a.id===wallId);
  useEffect(()=>{
    if (!current || view!=='tunnel' || !['cover','space'].includes(room) || openingRef.current) return;
    const timer=setTimeout(()=>{
      if(openingRef.current || warm.current?.id===current.id)return;
      warm.current?.dispose();warm.current=createActivityWarmup(api,current.id);
    },280);
    return ()=>clearTimeout(timer);
  },[current?.id,view,room]);
  useEffect(()=>()=>warm.current?.dispose(),[]);
  useEffect(()=>{
    if(opening||photo||!pendingFocus.current)return;
    const pending=pendingFocus.current;pendingFocus.current=null;
    const frame=requestAnimationFrame(()=>{const focus=pending.element?.isConnected?pending.element:[...shell.current.querySelectorAll('[data-photo]')].find(e=>e.dataset.photo===pending.id);focus?.focus({preventScroll:true})});
    return()=>cancelAnimationFrame(frame);
  },[opening,photo]);
  const displayedActivity=collection && view==='wall' ? {event:{theme:collection.title}} : view==="wall" && wallActivity ? wallActivity : current;
  const scene={room,view,wallId,collection,photo:photo?{id:photo.id,revision:photo.revision}:null,immersive,activityId:current?.id,anchor,
    wallLeft:wallPositions.current[collection?.id || wallId] || 0};
  sceneRef.current=scene;
  const capture=patch=>({...sceneRef.current,wallLeft:wallPositions.current[sceneRef.current.collection?.id || sceneRef.current.wallId] || 0,...patch});
  const navigation=useGalleryHistory(storageKey,loaded,scene,(target,options)=>restoreScene(target,{...options,record:false}));
  useEffect(()=>{if(loaded&&!openingRef.current)navigation.sync(capture())},[loaded,room,view,wallId,collection,photo?.id,immersive,current?.id,anchor,opening]);
  useEffect(()=>()=>{transition.current++;navigationRequest.current?.abort();warm.current?.dispose()},[]);
  async function restoreScene(target,{record=true,initial=false,photoRecord=null,selector='.wall-scene .wall-photo img'}={}){
    const origin=capture(),token=++transition.current;
    animate.cancel();navigationRequest.current?.abort();const request=new AbortController();navigationRequest.current=request;openingRef.current=true;setOpening(true);setError('');
    if(record){navigation.sync(origin);navigation.push(target)}
    try{
      let nextPhoto=photoRecord;
      if(target.view==='tunnel'&&!['cover','space'].includes(target.room)){warm.current?.dispose();warm.current=null}
      const nextIndex=Math.max(0,activities.findIndex(a=>a.id===target.activityId));
      if(target.view==='wall'){
        const id=target.collection?.id || target.wallId;
        if(!target.collection&&!activities.some(a=>a.id===id))throw Error('活动已不可用');
        if(warm.current?.id!==id){warm.current?.dispose();warm.current=createActivityWarmup(api,id,target.collection?target.collection.endpoint+'&limit=15':undefined)}
        const staged=warm.current,data=await staged.promise;if(token!==transition.current)return;
        setCounts({photos:data.photos,videos:data.videos});
      }
      if(target.photo){
        if(photo?.id===target.photo.id)nextPhoto=photo;
        else if(!nextPhoto){const resolved=await api('/exhibitions/creative/resolve?ids='+encodeURIComponent(target.photo.id),'GET',undefined,{signal:request.signal});nextPhoto=resolved.items.find(p=>p.id===target.photo.id&&p.revision===target.photo.revision);if(!nextPhoto)throw Error('照片已失效或不属于当前展览')}
      }
      if(token!==transition.current)return;
      if(target.view==='wall'){const id=target.collection?.id || target.wallId;wallPositions.current[id]=wallPositions.current[id] ?? target.wallLeft ?? 0;}
      const commit=()=>{
        setRoom(target.room);setView(target.view);setWallId(target.wallId || null);setCollection(target.collection || null);
        setPhoto(nextPhoto || null);setImmersive(Boolean(target.immersive));setIndex(nextIndex);if(target.anchor)setAnchor(target.anchor);
      };
      if(initial){commit();return}
      let before='.gallery-room-host,.cover-scene:not(.scene-inactive),.spacetime-room,.wall-scene:not(.scene-inactive)',incoming='.gallery-room-host,.cover-scene:not(.scene-inactive),.spacetime-room',mode='room';
      if(origin.photo&&target.photo?.id===origin.photo.id){before='.viewer-image-area';incoming=before;mode='fit'}
      else if(target.photo){before=selector;incoming='.viewer-image-area,.photo-viewer .metadata-panel';mode='scatter'}
      else if(origin.photo){before='.viewer-image-area,.photo-viewer .metadata-panel';incoming=target.view==='wall'?'.wall-scene .wall-photo':'.gallery-room-host,.cover-scene .activity-panel,.spacetime-board';mode='photo-close'}
      else if(origin.view==='tunnel'&&target.view==='wall'){
        before=origin.room==='cover'?'.cover-scene .activity-panel':'.room img,.spacetime-board';incoming='.wall-scene .wall-photo';mode=origin.room==='cover'?'cover-wall':'scatter';
      }else if(origin.view==='wall'&&target.view==='tunnel'){
        before='.wall-scene .wall-photo';incoming=target.room==='cover'?'.cover-scene .activity-panel':'.gallery-room-host,.spacetime-board';mode=target.room==='cover'?'wall-cover':'photo-close';
      }
      await animate(before,commit,incoming,mode);
      if(token===transition.current&&origin.photo&&!target.photo){
        pendingFocus.current={element:lastFocus.current,id:origin.photo.id};lastFocus.current=null;
      }
    }catch(e){if(token===transition.current&&e.name!=='AbortError'){setError(e.message);navigation.replace(origin)}}
    finally{if(token===transition.current){openingRef.current=false;setOpening(false)}}
  }
  const changeRoom=next=>{setRoomMenu(false);if(next===room&&view==='tunnel')return;return restoreScene(capture({room:next,view:'tunnel',photo:null,immersive:false}))};
  const openCollection=(descriptor,options)=>restoreScene(capture({view:'wall',wallId:null,collection:descriptor,photo:null,immersive:false,wallLeft:wallPositions.current[descriptor.id] || 0}),options);
  useEffect(()=>{
    if(!exhibitionId)return;const controller=new AbortController();
    baseApi('/curator/exhibitions/'+encodeURIComponent(exhibitionId),'GET',undefined,{signal:controller.signal}).then(meta=>{
      if(controller.signal.aborted)return;setScopeMeta(meta);
      if(roomHint==='wall'&&initialGalleryHistory.current?.scope!==storageKey)openCollection({id:'curated-'+exhibitionId,title:meta.title,dateLabel:'策展',endpoint:'/exhibitions/photos?sort=time'},{record:false,initial:true});
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
    return()=>controller.abort();
  },[exhibitionId]);
  const returnCurator=()=>{location.hash='curator'+(scopeMeta?.run_id?'?run='+scopeMeta.run_id:'')};
  const rootWall=exhibitionId&&collection?.id==='curated-'+exhibitionId&&roomHint==='wall';
  selectedId.current = current?.id || savedRooms(storageKey).activityId;
  const catalogueRequest=useRef(null);
  const reload = async () => {
    if(catalogueRequest.current)return;
    const c=new AbortController();catalogueRequest.current=c;
    try{
      const d=await api('/gallery','GET',undefined,{signal:c.signal});
      if(c.signal.aborted)return;
      setLoadError(null);setRoomRevision(n=>n+1);setLoaded(true);
      const next=d.activities.findIndex(a=>a.id===selectedId.current);
      setActivities(d.activities);setIndex(i=>next<0?Math.min(i,Math.max(0,d.activities.length-1)):next);
    }catch(e){if(!c.signal.aborted)setLoadError(e)}
    finally{if(catalogueRequest.current===c)catalogueRequest.current=null}
  };
  useEffect(()=>{reload();const timer=setInterval(reload,15000);return()=>{clearInterval(timer);catalogueRequest.current?.abort()}},[]);
  const goTo = (i) => {
    if (view === "tunnel") tunnel.current?.goTo(i);
    else setIndex(i);
  };
  const move = (n) => tunnel.current?.move(n);
  const backGallery=()=>navigation.back(capture({view:'tunnel',photo:null,immersive:false}));
  const openActivity=id=>restoreScene(capture({activityId:id,view:'wall',wallId:id,collection:null,photo:null,immersive:false,wallLeft:wallPositions.current[id] || 0}));
  useEffect(() => {
    const f = (e) => {
      if (photo || openingRef.current || ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape" && view === "wall") {
        backGallery();
        return;
      }
      if (view !== "tunnel" || !['cover','space'].includes(room) || roomMenu) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        move(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [photo, view,room,roomMenu]);
  const open=(p,selector='.wall-scene .wall-photo img')=>{
    lastFocus.current=document.activeElement;
    return restoreScene(capture({photo:{id:p.id,revision:p.revision},immersive:false,anchor:p.period || anchor}),{photoRecord:p,selector});
  };
  const close=()=>navigation.back(capture({photo:null,immersive:false}));
  const toggleImmersive=()=>immersive?navigation.back(capture({immersive:false})):restoreScene(capture({immersive:true}));
  const displayTheme=room==='cover'&&view==='tunnel'&&!photo?coverTheme:'dark';
  return (
    <RoomRefreshContext.Provider value={roomRevision}><div ref={shell} className={"gallery-shell gallery-room-"+room+" gallery-view-" + view + (opening ? " opening-activity" : "")} aria-busy={opening} data-theme={displayTheme} data-cover-style={coverStyle} data-chrome-visible={chromeVisible}>
      <header className="gallery-nav" inert={!!photo || opening}>
        {view === "wall" && <button className="gallery-back" onClick={rootWall?returnCurator:backGallery} aria-label={rootWall?'返回策展助理':room==='cover'?'返回 Gallery':'返回 '+roomNames[room]}>← {rootWall?'策展助理':room==='cover'?'Gallery':roomNames[room]}</button>}
        {exhibitionId&&view==='tunnel'&&<><button className="gallery-curated-back" onClick={returnCurator}>← 策展助理</button><span className="gallery-curated-context">{scopeMeta?.title}</span></>}
        <MuseumNav current="gallery" onLogout={onLogout}
          theme={coverTheme} onTheme={room==='cover'&&view==='tunnel'?toggleCoverTheme:undefined}
          galleryControl={
          <div ref={roomMenuRef} className="gallery-room-switch"><button
            aria-current="page"
            onClick={()=>setRoomMenu(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setRoomMenu(true)}}} aria-haspopup="menu" aria-expanded={roomMenu}
          >
            Gallery <svg className="nav-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>
          </button>{roomMenu&&<div className="gallery-room-menu" role="menu" aria-label="展厅" onKeyDown={e=>{
            if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
            e.preventDefault();const items=[...e.currentTarget.querySelectorAll('[role^="menuitem"]')],i=items.indexOf(document.activeElement);
            const next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?Math.min(i+3,items.length-1):e.key==='ArrowUp'?Math.max(i-3,0):(i+(e.key==='ArrowRight'?1:-1)+items.length)%items.length;
            items[next]?.focus();
          }}>
            {Object.entries(roomNames).map(([id,name])=><button className="room-menu-tile" role="menuitemradio" key={id} aria-checked={room===id} onClick={()=>changeRoom(id)}><RoomMenuIcon room={id}/><span>{name}</span></button>)}
            <button role="menuitem" className="room-menu-tile curator-menu-entry" onClick={()=>{location.hash='curator'}}><RoomMenuIcon room="curator"/><span>策展助理</span></button>
          </div>}</div>
          }/>
      </header>
      {(error||(loadError&&current))&&<div className="gallery-status-banner"><StatusNotice error={error||loadError} scope={error?'浏览操作':'图库更新'} detail={!error&&current?'保留当前画面':undefined} onRetry={!error?reload:undefined} onDismiss={error?()=>setError(''):undefined}/></div>}
      {view==='tunnel'&&room==='calendar'&&<div className="gallery-room-host"><CalendarRoom api={api} anchor={anchor} setAnchor={setAnchor} state={roomStates.calendar || {}} onState={s=>setRoomStates(p=>({...p,calendar:s}))} onCollection={openCollection}/></div>}
      {view==='tunnel'&&room==='map'&&<div className="gallery-room-host"><MapRoom api={api} state={roomStates.map || {}} onState={s=>setRoomStates(p=>({...p,map:s}))} onCollection={openCollection}/></div>}
      {view==='tunnel'&&room==='gear'&&<div className="gallery-room-host" inert={!!photo} style={photo?{visibility:'hidden'}:undefined}><GearRoom api={api} anchor={anchor} state={roomStates.gear || {}} onState={s=>setRoomStates(p=>({...p,gear:s}))} onCollection={openCollection} onPhoto={p=>open(p,'.room img')}/></div>}
      {view==='tunnel'&&CreativeRoom&&<div className="gallery-room-host" inert={!!photo} style={photo?{visibility:'hidden'}:undefined}><CreativeRoom api={api} state={roomStates[room] || {}} onState={s=>setRoomStates(p=>({...p,[room]:s}))} onCollection={openCollection} onPhoto={p=>open(p,'.room img')}/></div>}
      {!current && ['cover','space'].includes(room) ? (
        <div className={'gallery-empty'+(!loaded?' gallery-initial-loading':'')}>
          <StatusPanel loading={!loaded&&!loadError} error={loadError} onRetry={reload} empty="尚无可展示照片" action={<button onClick={onAdmin}>查看刮削进度 →</button>}/>
        </div>
      ) : current || collection ? (
        <>
          {room==='cover'&&<div className={"cover-scene scene-layer " + (view!=="tunnel" || photo ? "scene-inactive" : "")} inert={view!=="tunnel" || !!photo}>
            <Tunnel
              ref={tunnel}
              style={coverStyle}
              activities={activities}
              index={index}
              onIndex={setIndex}
              onOpen={openActivity}
            />
          </div>}
          {room==='space'&&view==='tunnel'&&!photo&&<SpacetimeRoom ref={tunnel} activities={activities} index={index} onIndex={setIndex} onOpen={openActivity} state={roomStates.space || {}} onState={s=>setRoomStates(p=>({...p,space:s}))}/>}
          {(wallActivity || collection) && view==='wall' && <div className={"wall-scene scene-layer " + (photo ? "scene-inactive" : "")} inert={!!photo || opening}>
            <PhotoWall
              key={collection?.id || wallActivity.id}
              activity={collection ? {id:collection.id,photos:counts?.photos,videos:0} : wallActivity}
              endpoint={collection?.endpoint}
              initialLeft={wallPositions.current[collection?.id || wallActivity?.id] || 0}
              onPosition={x=>{wallPositions.current[collection?.id || wallActivity?.id]=x;if(!openingRef.current)navigation.sync(capture())}}
              warm={warm.current?.id===(collection?.id || wallActivity.id) ? warm.current : null}
              onCounts={setCounts}
              api={api}
              onOpen={open}
            />
          </div>}
          {view === "tunnel" && ['cover','space'].includes(room) && (
            <ActivityTimeline activities={activities} index={index} onSelect={goTo} theme={displayTheme} drawer autoReveal={!roomMenu} />
          )}
          {(view==='wall'||['cover','space'].includes(room))&&displayedActivity&&<div className="gallery-caption">
            <div className="caption-date">
              {collection && view==='wall' ? collection.dateLabel : displayedActivity.event.year}
              {displayedActivity.event.month
                ? " · " + String(displayedActivity.event.month).padStart(2, "0")
                : ""}
            </div>
            <div className="caption-main">
              <h1 title={displayedActivity.event.theme}>{displayedActivity.event.theme}</h1>
              {view==='wall' && <p className="activity-counts">{counts?.photos ?? displayedActivity.photos ?? 0} 张照片{(counts?.videos ?? displayedActivity.videos)>0 && <span> · {counts?.videos ?? displayedActivity.videos} 个视频</span>}</p>}
            </div>
          </div>}
          {opening && (view==='wall'||['cover','space'].includes(room)) && <PhotoLoading size="small" className="gallery-photo-loading" label="加载照片"/>}
          {view === "tunnel" && ['cover','space'].includes(room) && (
            <div className="tunnel-controls">
              <button
                onClick={() => move(-1)}
                disabled={room==='cover'?activities.length<2:!index}
                aria-label="上一场活动"
              >
                〈
              </button>
              <button
                onClick={() => move(1)}
                disabled={room==='cover'?activities.length<2:index === activities.length - 1}
                aria-label="下一场活动"
              >
                〉
              </button>
            </div>
          )}
        </>
      ) : null}
      {photo && (
        <Viewer
          key={photo.id}
          photo={photo}
          api={api}
          onClose={close}
          onChanged={reload}
          immersive={immersive}
          onImmersiveChange={toggleImmersive}
          returnLabel={view==='wall'?'返回照片墙':'返回'+roomNames[room]}
        />
      )}
    </div></RoomRefreshContext.Provider>
  );
}

function Viewer({ photo, api, onClose, onChanged,immersive:zoom,onImmersiveChange,returnLabel='返回照片墙' }) {
  const preferences=usePreferences();
  const [requested,setRequested]=useState(false),[retryOriginal,setRetryOriginal]=useState(0),[nativeFallback,setNativeFallback]=useState(false);
  const [suggestions, setSuggestions] = useState([]),
    [mutationError, setMutationError] = useState("");
  const [manifest, setManifest] = useState(null),
    [source, setSource] = useState(photo.preview),
    [original, setOriginal] = useState(null),
    [previewReady,setPreviewReady]=useState(false),[previewFailed,setPreviewFailed]=useState(false),
    [phase, setPhase] = useState("4K 读取中"),
    [info, setInfo] = useState(true),
    [pinned, setPinned] = useState(photo.pinned),
    [play, setPlay] = useState(false),
    [analysis, setAnalysis] = useState(null),
    [native, setNative] = useState(null);
  const nativeChoice=native ?? (preferences.ready && preferences.values.hdr_display==='native_if_supported' && matchMedia('(dynamic-range: high)').matches);
  const viewerRef = useRef(null), zoomRef=useRef(zoom);
  zoomRef.current=zoom;
  const toggleImmersive=()=>{if(zoom)setInfo(true);onImmersiveChange();};
  useEffect(()=>{if(!zoom)setInfo(true)},[zoom]);
  const callbacks=useRef({onClose,onImmersiveChange});callbacks.current={onClose,onImmersiveChange};
  const closeRef = useRef(null),
    previewRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const f = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (document.fullscreenElement === viewerRef.current)
          document.exitFullscreen();
        else if(zoomRef.current){callbacks.current.onImmersiveChange();setInfo(true);}
        else callbacks.current.onClose();
      }
      if (e.key === "Tab") {
        const buttons = [
          ...document.querySelectorAll(
            '.photo-viewer button,.photo-viewer video,.photo-viewer [tabindex="0"]',
          ),
        ].filter((x) => !x.disabled && x.getClientRects().length);
        const idx = buttons.indexOf(document.activeElement);
        if (e.shiftKey && idx === 0) {
          e.preventDefault();
          buttons.at(-1)?.focus();
        } else if (!e.shiftKey && idx === buttons.length - 1) {
          e.preventDefault();
          buttons[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, []);
  useEffect(()=>{
    const c=new AbortController();
    for(const [path,set] of [['manifest',setManifest],['suggestions',d=>setSuggestions(d.items)],['analysis',setAnalysis]])
      api('/assets/'+photo.id+'/'+path,'GET',undefined,{signal:c.signal}).then(d=>{if(!c.signal.aborted)set(d)}).catch(()=>{if(path==='manifest'&&!c.signal.aborted)setPhase('保留 4K · 元数据暂不可用')});
    return()=>c.abort();
  },[photo.id,api]);
  useEffect(()=>{
    const c=new AbortController();let url,decoded;
    setOriginal(null);setNativeFallback(false);
    const m=manifest;if(!m)return()=>c.abort();
    if(m.placeholder){setPhase(m.placeholder==='video'?'此视频超大':'此图片超大');return()=>c.abort()}
    if(photo.kind==='video_candidate'){setPhase('视频封面');return()=>c.abort()}
    if(!requested&&(!preferences.ready||preferences.values.original_loading==='on_demand')){
      setPhase(preferences.error?'偏好暂不可用 · 保留 4K':'4K · 原图按需读取');return()=>c.abort();
    }
    setPhase('4K · 原图读取中');
    const acquire=async target=>{
      const response=await fetch(target,{signal:c.signal,cache:'no-store'});
      if(!response.ok)throw Error('原图暂不可用');
      const blob=await response.blob();if(c.signal.aborted)return;
      url=URL.createObjectURL(blob);decoded=new Image();decoded.src=url;
      try{await decoded.decode()}catch(error){decoded.removeAttribute('src');decoded=null;URL.revokeObjectURL(url);url=null;throw Object.assign(Error('原图无法解码'),{decodeFailed:true})}
      decoded.removeAttribute('src');decoded=null;
    };
    (async()=>{try{
      try{await acquire(nativeChoice?m.original:m.original_compatible||m.original)}catch(e){
        if(!c.signal.aborted&&nativeChoice&&e.decodeFailed&&m.original_compatible){await acquire(m.original_compatible);if(!c.signal.aborted){setNativeFallback(true);setPhase('原生不可用 · SDR 原图')}}else throw e;
      }
      if(c.signal.aborted)return;setOriginal(url);
      if(!nativeChoice)setPhase(m.original_compatible?'原图 · SDR 兼容显示':'原图');
      else setPhase(p=>p==='原生不可用 · SDR 原图'?p:'原图 · 原生色彩');
    }catch(e){if(!c.signal.aborted)setPhase('保留 4K · 原图暂不可用')}})();
    return()=>{c.abort();decoded?.removeAttribute('src');if(url)URL.revokeObjectURL(url)};
  },[photo.id,manifest,nativeChoice,requested,retryOriginal,preferences.ready,preferences.values.original_loading,preferences.ready?'':preferences.error]);
  const visiblePhase=original?phase:previewFailed?'预览暂不可用':source===photo.thumbnail&&source!==photo.preview&&previewReady?'保留缩略图 · 4K 暂不可用':phase;
  return (
    <div
      ref={viewerRef}
      className={"photo-viewer " + (zoom ? "immersive " : "") + (info ? "with-metadata" : "image-only")}
      style={{"--photo-ratio":photo.info?.width && photo.info?.height ? photo.info.width/photo.info.height : 1.5}}
      role="dialog"
      aria-modal="true"
      aria-label="照片细看"
    >
      <div className="viewer-toolbar">
        <button ref={closeRef} className="viewer-back" onClick={onClose} aria-label={returnLabel}>← 返回</button>
        <div>
          <button
            onClick={() => {
              setPinned(!pinned);
              api("/assets/" + photo.id + "/curation", "POST", {
                pinned: !pinned,
              })
                .then(onChanged)
                .catch((e) => {
                  setPinned(pinned);
                  setMutationError(e.message);
                });
            }}
          >
            {pinned ? "★ 已标记" : "☆ 标记照片"}
          </button>
          {manifest?.original&&photo.kind!=='video_candidate'&&!manifest?.placeholder&&!requested&&(!preferences.ready||preferences.values.original_loading==='on_demand')&&<button onClick={()=>setRequested(true)}>加载原图</button>}
          {manifest?.original&&phase.includes('原图暂不可用')&&<button onClick={()=>{setRequested(true);setRetryOriginal(n=>n+1)}}>重新读取原图</button>}
          <button onClick={() => {setRequested(true);setNative(!nativeChoice)}}>
            {nativeFallback?'SDR 回退':nativeChoice?'原生色彩':'SDR'}
          </button>
          <button onClick={() => setInfo(!info)} aria-expanded={info}>
            照片档案
          </button>
          <FullscreenButton target={viewerRef} />
          <button onClick={onClose} aria-label="关闭照片">
            ✕
          </button>
        </div>
      </div>
      <div
        className="viewer-image-area"
        role="button" tabIndex={0} aria-label={zoom ? "返回照片档案" : "铺满浏览器"}
        onKeyDown={e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();toggleImmersive();}}}
        onClick={() => !play && toggleImmersive()}
      >
        {play ? (
          <video
            src={manifest?.playback || manifest?.live?.playback}
            controls
            autoPlay
            playsInline
          />
        ) : (
          <div className="image-stack">
            {!previewReady&&<PhotoLoading className="viewer-photo-loading"/>}
            {previewFailed&&!original&&<StatusPanel error="预览暂不可用" onRetry={()=>{setPreviewFailed(false);setPreviewReady(false);setSource(photo.preview)}}/>}
            {source&&<img
              ref={previewRef}
              className="preview-layer"
              src={source}
              alt={photo.name}
              onLoad={() => {setPreviewReady(true);setPhase((p) => (p === "4K 读取中" ? "4K · 原图读取中" : p))}}
              onError={() => {
                if(photo.thumbnail&&source!==photo.thumbnail){setSource(photo.thumbnail);setPhase("保留缩略图 · 4K 暂不可用")}
                else{setSource(null);setPreviewReady(true);setPreviewFailed(true);setPhase('预览暂不可用')}
              }}
            />}
            {original && previewReady && (
              <img
                key={original}
                className="original-layer darkroom-reveal"
                onAnimationEnd={e=>{e.currentTarget.style.willChange="auto"}}
                src={original}
                alt=""
              />
            )}
          </div>
        )}
      </div>
      <div className="viewer-bottom">
        <span aria-live="polite">{visiblePhase.includes("读取中")?<PhotoLoading compact label={visiblePhase}/>:<MediaStatus failed={/暂不可用|失败|无法/.test(visiblePhase)}>{visiblePhase}</MediaStatus>}</span>
        <span>
          <button
            onClick={toggleImmersive}
            aria-label={zoom ? "返回照片档案" : "铺满浏览器"}
          >
            {zoom ? "⊖" : "⊕"}
          </button>{" "}
          {(manifest?.playback || manifest?.live?.playback) && (
            <button onClick={() => setPlay(!play)}>
              {play
                ? "返回照片"
                : "▶ 播放" + (manifest.live ? " Live Photo" : "视频")}
            </button>
          )}
        </span>
      </div>
      {info && (
        <aside className="metadata-panel">
          <h2>照片档案</h2>
          {mutationError && <StatusNotice error={mutationError} scope="照片档案"/>}
          <p>{photo.name}</p>
          <h3 className="archive-section-title">EXIF</h3>
          <PhotoArchive metadata={manifest?.effective_metadata || {}} media={manifest?.media || photo.info || {}} size={manifest?.size} place={analysis?.places?.data}/>
          <PhotoAnalysisArchive analysis={analysis}/>
          {suggestions
            .filter((s) => !s.info.accepted)
            .map((s) => (
              <div key={s.record_id}>
                <small><Icon name="metadata"/>{s.field==='gps'?'近似城市':s.field==='captured_at'?'拍摄时间':s.field} · 近邻建议</small>
                <p>{s.field==='gps'?'位置建议 · 待城市解析':JSON.stringify(s.value)}</p>
                <button
                  onClick={() =>
                    api(
                      "/assets/" +
                        photo.id +
                        "/suggestions/" +
                        s.record_id +
                        "/accept",
                      "POST",
                      {},
                    )
                      .then(() => api("/assets/" + photo.id + "/manifest"))
                      .then((m) => {
                        setManifest(m);
                        setSuggestions((xs) =>
                          xs.filter((x) => x.record_id !== s.record_id),
                        );
                      })
                      .catch((e) => setMutationError(e.message))
                  }
                >
                  采用
                </button>
                <button
                  onClick={() =>
                    api(
                      "/assets/" +
                        photo.id +
                        "/suggestions/" +
                        s.record_id +
                        "/reject",
                      "POST",
                      {},
                    )
                      .then(() =>
                        setSuggestions((xs) =>
                          xs.filter((x) => x.record_id !== s.record_id),
                        ),
                      )
                      .catch((e) => setMutationError(e.message))
                  }
                >
                  忽略
                </button>
              </div>
            ))}

        </aside>
      )}
    </div>
  );
}
