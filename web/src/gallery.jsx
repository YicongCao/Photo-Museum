import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import {placeLabel,subjectLabel} from "./localized-labels";
import { Tunnel, PhotoWall, FullscreenButton } from "./exhibition";
import "./gallery.css";
import { useSceneMotion, createActivityWarmup } from "./scene-motion";
import { PhotoArchive } from "./photo-archive";
import { PhotographyLabels } from "./photography-labels";
import { ActivityTimeline } from "./timeline";
import { CalendarRoom } from './rooms/calendar';
import { MapRoom } from './rooms/map';
import { GearRoom } from './rooms/gear';
import { SpacetimeRoom } from './rooms/spacetime';
import { RoomRefreshContext } from './rooms/common';
import './rooms/rooms.css';
import {usePreferences} from './preferences';
import './cover-theme.css';

const roomNames={cover:'Cover Flow',calendar:'日历',map:'地图',gear:'器材馆',space:'时空隧道'};
function savedRooms(key='museum.rooms'){try{return JSON.parse(sessionStorage.getItem(key) || '{}')}catch{return {}}}

export function Gallery({ api:baseApi, onAdmin,exhibitionId=null,roomHint=null }) {
  const storageKey=exhibitionId?'museum.rooms.'+exhibitionId:'museum.rooms';
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
    [wallId,setWallId]=useState(null),
    [counts,setCounts]=useState(null),
    [opening,setOpening]=useState(false);
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
  const animate=useSceneMotion(shell);
  const current = activities[index];
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
  const displayedActivity=collection && view==='wall' ? {event:{theme:collection.title}} : view==="wall" && wallActivity ? wallActivity : current;
  const changeRoom=next=>{
    setRoomMenu(false);warm.current?.dispose();warm.current=null;setPhoto(null);setView('tunnel');setRoom(next);
    roomMenuRef.current?.querySelector('button')?.focus();
  };
  const openCollection=async descriptor=>{
    if(openingRef.current)return;
    openingRef.current=true;setOpening(true);setError('');
    try{
      warm.current?.dispose();const staged=createActivityWarmup(api,descriptor.id,descriptor.endpoint+'&limit=15');warm.current=staged;
      const data=await staged.promise;if(warm.current!==staged)return;setCounts({photos:data.photos,videos:data.videos});
      await animate('.room img',()=>{setCollection(descriptor);setWallId(null);setView('wall')},'.wall-scene .wall-photo');
    }catch(e){if(e.name!=='AbortError')setError(e.message)}
    finally{openingRef.current=false;setOpening(false)}
  };
  useEffect(()=>{
    if(!exhibitionId)return;const controller=new AbortController();
    baseApi('/curator/exhibitions/'+encodeURIComponent(exhibitionId),'GET',undefined,{signal:controller.signal}).then(meta=>{
      if(controller.signal.aborted)return;setScopeMeta(meta);
      if(roomHint==='wall')openCollection({id:'curated-'+exhibitionId,title:meta.title,dateLabel:'策展',endpoint:'/exhibitions/photos?sort=time'});
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
    return()=>controller.abort();
  },[exhibitionId]);
  const returnCurator=()=>{location.hash='curator'+(scopeMeta?.run_id?'?run='+scopeMeta.run_id:'')};
  const rootWall=exhibitionId&&collection?.id==='curated-'+exhibitionId&&roomHint==='wall';
  selectedId.current = current?.id || savedRooms(storageKey).activityId;
  const reload = () =>
    api("/gallery")
      .then((d) => {
        setRoomRevision(n=>n+1);
        setLoaded(true);
        const next = d.activities.findIndex((a) => a.id === selectedId.current);
        setActivities(d.activities);
        setIndex((i) =>
          next < 0 ? Math.min(i, Math.max(0, d.activities.length - 1)) : next,
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, []);
  const goTo = (i) => {
    if (view === "tunnel") tunnel.current?.goTo(i);
    else setIndex(i);
  };
  const move = (n) => tunnel.current?.move(n);
  const backGallery=()=>{
    if(openingRef.current || !['cover','space'].includes(room)){warm.current?.dispose();warm.current=null;}
    setPhoto(null);setView('tunnel');

  };
  const openActivity = async (id) => {
    if(openingRef.current)return;
    const i=activities.findIndex(a=>a.id===id);if(i<0)return;
    openingRef.current=true;setOpening(true);setError("");
    try {
      if(warm.current?.id!==id){warm.current?.dispose();warm.current=createActivityWarmup(api,id);}
      const staged=warm.current,data=await staged.promise;if(warm.current!==staged)return;
      setCollection(null);setIndex(i);
      setCounts({photos:data.photos,videos:data.videos});
      await animate(`[data-activity="${id}"] > .photo-mosaic img`,()=>{setWallId(id);setView('wall');},'.wall-scene .wall-photo');
    }catch(e){warm.current?.dispose();warm.current=null;if(e.name!=='AbortError')setError(e.message);}
    finally{openingRef.current=false;setOpening(false);}
  };
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
  const open = (p,selector='.wall-scene .wall-photo img') => {
    if(p.period)setAnchor(p.period);
    if(p.activity_id){const i=activities.findIndex(a=>a.id===p.activity_id);if(i>=0)setIndex(i)}
    lastFocus.current = document.activeElement;
    animate(selector,()=>setPhoto({...p,preview:warm.current?.urls.get(p.id) || p.preview}),".viewer-image-area,.photo-viewer .metadata-panel");
  };
  const close = () => {
    setPhoto(null);
    const focus=lastFocus.current;lastFocus.current=null;
    requestAnimationFrame(() => {if(focus?.isConnected)focus.focus({preventScroll:true})});
  };
  const displayTheme=room==='cover'&&view==='tunnel'&&!photo?coverTheme:'dark';
  return (
    <RoomRefreshContext.Provider value={roomRevision}><div ref={shell} className={"gallery-shell gallery-room-"+room+" gallery-view-" + view + (opening ? " opening-activity" : "")} aria-busy={opening} data-theme={displayTheme}>
      <nav className="gallery-nav" inert={!!photo}>
        {view === "wall" && <button className="gallery-back" onClick={rootWall?returnCurator:backGallery} aria-label={rootWall?'返回策展助理':room==='cover'?'返回 Gallery':'返回 '+roomNames[room]}>← {rootWall?'策展助理':room==='cover'?'Gallery':roomNames[room]}</button>}
        {exhibitionId&&view==='tunnel'&&<><button className="gallery-curated-back" onClick={returnCurator}>← 策展助理</button><span className="gallery-curated-context">{scopeMeta?.title}</span></>}
        <div>
          <button onClick={onAdmin}>Dashboard</button>
          <div ref={roomMenuRef} className="gallery-room-switch"><button
            className={view === "tunnel" ? "active" : ""}
            onClick={()=>setRoomMenu(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setRoomMenu(true)}}} aria-haspopup="menu" aria-expanded={roomMenu}
          >
            Gallery
          </button>{roomMenu&&<div className="gallery-room-menu" role="menu" aria-label="展厅" onKeyDown={e=>{
            if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
            e.preventDefault();const items=[...e.currentTarget.querySelectorAll('[role^="menuitem"]')],i=items.indexOf(document.activeElement);
            items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
          }}>
            {Object.entries(roomNames).map(([id,name])=><button role="menuitemradio" key={id} aria-checked={room===id} onClick={()=>changeRoom(id)}>{name}</button>)}
            <button role="menuitem" className="curator-menu-entry" onClick={()=>{location.hash='curator'}}>策展助理</button>
            <button role="menuitem" onClick={()=>{location.hash='settings?from='+encodeURIComponent(location.hash.slice(1))}}>Settings</button>
          </div>}</div>
          {room==='cover'&&view==='tunnel'&&<button className="cover-theme-button" aria-label={coverTheme==='dark'?'切换白天模式':'切换黑夜模式'} title={coverTheme==='dark'?'切换白天模式':'切换黑夜模式'} aria-pressed={coverTheme==='light'} onClick={toggleCoverTheme}><Icon name={coverTheme==='dark'?'sun':'moon'}/></button>}
          <FullscreenButton />
        </div>
      </nav>
      {error && (
        <p role="alert" className="gallery-error">
          {error}
        </p>
      )}
      {view==='tunnel'&&room==='calendar'&&<div className="gallery-room-host"><CalendarRoom api={api} anchor={anchor} setAnchor={setAnchor} state={roomStates.calendar || {}} onState={s=>setRoomStates(p=>({...p,calendar:s}))} onCollection={openCollection}/></div>}
      {view==='tunnel'&&room==='map'&&<div className="gallery-room-host"><MapRoom api={api} state={roomStates.map || {}} onState={s=>setRoomStates(p=>({...p,map:s}))} onCollection={openCollection}/></div>}
      {view==='tunnel'&&room==='gear'&&<div className="gallery-room-host" inert={!!photo} style={photo?{visibility:'hidden'}:undefined}><GearRoom api={api} anchor={anchor} state={roomStates.gear || {}} onState={s=>setRoomStates(p=>({...p,gear:s}))} onCollection={openCollection} onPhoto={p=>open(p,'.room img')}/></div>}
      {!current && ['cover','space'].includes(room) ? (
        <div className="gallery-empty">
          <Icon name="photo" />
          <p>{loaded ? "尚无可展示照片" : "读取照片"}</p>
          <button onClick={onAdmin}>查看刮削进度 →</button>
        </div>
      ) : current || collection ? (
        <>
          {room==='cover'&&<div className={"cover-scene scene-layer " + (view!=="tunnel" || photo ? "scene-inactive" : "")} inert={view!=="tunnel" || !!photo}>
            <Tunnel
              ref={tunnel}
              activities={activities}
              index={index}
              onIndex={setIndex}
              onOpen={openActivity}
            />
          </div>}
          {room==='space'&&view==='tunnel'&&!photo&&<SpacetimeRoom ref={tunnel} activities={activities} index={index} onIndex={setIndex} onOpen={openActivity} state={roomStates.space || {}} onState={s=>setRoomStates(p=>({...p,space:s}))}/>}
          {(wallActivity || collection) && view==='wall' && <div className={"wall-scene scene-layer " + (photo ? "scene-inactive" : "")} inert={!!photo}>
            <PhotoWall
              key={collection?.id || wallActivity.id}
              activity={collection ? {id:collection.id,photos:counts?.photos,videos:0} : wallActivity}
              endpoint={collection?.endpoint}
              initialLeft={wallPositions.current[collection?.id || wallActivity?.id] || 0}
              onPosition={x=>{wallPositions.current[collection?.id || wallActivity?.id]=x}}
              warm={warm.current?.id===(collection?.id || wallActivity.id) ? warm.current : null}
              onCounts={setCounts}
              api={api}
              onOpen={open}
              onError={setError}
            />
          </div>}
          {view === "tunnel" && ['cover','space'].includes(room) && (
            <ActivityTimeline activities={activities} index={index} onSelect={goTo} theme={displayTheme} />
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
            {opening && <p role="status">读取照片</p>}
          </div>}
          {view === "tunnel" && ['cover','space'].includes(room) && (
            <div className="tunnel-controls">
              <button
                onClick={() => move(-1)}
                disabled={!index}
                aria-label="上一场活动"
              >
                〈
              </button>
              <button
                onClick={() => move(1)}
                disabled={index === activities.length - 1}
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
          returnLabel={view==='wall'?'返回照片墙':'返回'+roomNames[room]}
        />
      )}
    </div></RoomRefreshContext.Provider>
  );
}

function Viewer({ photo, api, onClose, onChanged,returnLabel='返回照片墙' }) {
  const preferences=usePreferences();
  const [requested,setRequested]=useState(false),[retryOriginal,setRetryOriginal]=useState(0),[nativeFallback,setNativeFallback]=useState(false);
  const [suggestions, setSuggestions] = useState([]),
    [mutationError, setMutationError] = useState("");
  const [manifest, setManifest] = useState(null),
    [source, setSource] = useState(photo.preview),
    [original, setOriginal] = useState(null),
    [phase, setPhase] = useState("4K 读取中"),
    [zoom, setZoom] = useState(false),
    [info, setInfo] = useState(true),
    [pinned, setPinned] = useState(photo.pinned),
    [play, setPlay] = useState(false),
    [analysis, setAnalysis] = useState(null),
    [native, setNative] = useState(null);
  const nativeChoice=native ?? (preferences.ready && preferences.values.hdr_display==='native_if_supported' && matchMedia('(dynamic-range: high)').matches);
  const viewerRef = useRef(null), zoomRef=useRef(zoom);
  zoomRef.current=zoom;
  const toggleImmersive=()=>{if(zoom)setInfo(true);setZoom(!zoom);};
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
        else if(zoomRef.current){setZoom(false);setInfo(true);}
        else onClose();
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
            <img
              ref={previewRef}
              className="preview-layer"
              src={source}
              alt={photo.name}
              onLoad={() =>
                setPhase((p) => (p === "4K 读取中" ? "4K · 原图读取中" : p))
              }
              onError={() => {
                setSource(photo.thumbnail);
                setPhase("保留缩略图 · 4K 暂不可用");
              }}
            />
            {original && (
              <img
                className="original-layer darkroom-reveal"
                src={original}
                alt=""
              />
            )}
          </div>
        )}
      </div>
      <div className="viewer-bottom">
        <span aria-live="polite">{phase}</span>
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
          {mutationError && <p role="alert">{mutationError}</p>}
          <p>{photo.name}</p>
          <PhotoArchive metadata={manifest?.effective_metadata || {}} media={manifest?.media || photo.info || {}} />
          {analysis?.visual?.data?.score != null && (
            <div>
              <small>技术评分</small>
              <p>{analysis.visual.data.score} / 100{analysis.visual.data.score_penalty_reason === "assumed_srgb" ? " · 色域假定 −15" : ""}</p>
            </div>
          )}
          {analysis?.visual?.data?.tags?.length > 0 && (
            <div>
              <small>本地主体识别</small>
              <p>
                {analysis.visual.data.tags
                  .slice(0, 3)
                  .map(subjectLabel)
                  .join(" · ")}
              </p>
            </div>
          )}
          <PhotographyLabels analysis={analysis?.photography} />
          {analysis?.places && (
            <div>
              <small>近似城市 · GeoNames</small>
              <p>
                {placeLabel(analysis.places.data)}
              </p>
            </div>
          )}
          {suggestions
            .filter((s) => !s.info.accepted)
            .map((s) => (
              <div key={s.record_id}>
                <small>{s.field} · 近邻建议</small>
                <p>{JSON.stringify(s.value)}</p>
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
