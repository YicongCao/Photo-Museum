import {PreviewImage} from './preview-image';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  memo,
} from "react";
import {WallImage} from "./wall-image";
import {PhotoLoading} from "./loading-mark";
import {StatusNotice} from "./system-status";
import { Icon } from "./icons";
import {coverLayout,coverPose,coverWindow} from "./cover-layout";
import {planCoverMosaic} from './cover-mosaic';
import './cover-mosaic.css';
import {CoverMotion} from './cover-motion';
export function FullscreenButton({ target, className = "" }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return (
    <button
      className={"fullscreen-button " + className}
      aria-label={active ? "退出全屏" : "全屏显示"}
      title={active ? "退出全屏" : "全屏显示"}
      aria-pressed={active}
      onClick={() => {
        const action = document.fullscreenElement
          ? document.exitFullscreen()
          : (target?.current || document.documentElement).requestFullscreen?.();
        action?.catch(() => {});
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        aria-hidden="true"
      >
        <path
          d={
            active
              ? "M3 9h6V3M15 3v6h6M21 15h-6v6M9 21v-6H3"
              : "M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6"
          }
        />
      </svg>
    </button>
  );
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const Tunnel = forwardRef(function Tunnel(
  { activities, index, onIndex, onOpen, style="classic", active=true },
  ref,
) {
  const stage = useRef(null),
    scroll = useRef(null),
    pos = useRef(index),
    stride = useRef(720),
    gesture = useRef(null),
    frame = useRef(0),
    motion = useRef(null),
    activityCount = useRef(activities.length),
    measuredWidth = useRef(null),
    resizing = useRef(false);
  const [position, setPosition] = useState(index),
    [viewport, setViewport] = useState({width:1000,height:700});
  const {width,height}=viewport;
  activityCount.current=activities.length;
  if(!motion.current)motion.current=new CoverMotion({
    read:()=>scroll.current?scroll.current.scrollLeft/stride.current:pos.current,
    write:p=>{if(scroll.current&&!resizing.current)scroll.current.scrollTo({left:p*stride.current,behavior:'instant'})},
    maximum:()=>Math.max(0,activityCount.current-1),
    reduced:()=>matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  const goTo = i=>motion.current.goTo(i);
  useImperativeHandle(
    ref,
    () => ({ goTo, move: (n) => goTo(((Math.round(pos.current)+n)%activities.length+activities.length)%activities.length) }),
    [activities.length],
  );
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w !== measuredWidth.current) {
        // A wider viewport may clamp scrollLeft before the spacer can grow.
        // Keep the logical position until React commits the new scroll range.
        resizing.current = true;
        measuredWidth.current = w;
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        stride.current = Math.round(Math.max(140, w * 0.24));
        if (gesture.current) {
          const g = gesture.current;
          g.start = pos.current * stride.current + (g.lastX - g.x);
        }
      }
      setViewport({width:w,height:entry.contentRect.height});
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = stage.current;
    const wheel = (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const delta =
        (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientWidth : 1);
      motion.current.wheel(delta/stride.current);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
      frame.current=0;
      motion.current.cancel();
    };
  }, [activities.length]);
  useEffect(()=>{
    const stopHidden=()=>{
      if(!document.hidden)return;
      motion.current.finish();
      const g=gesture.current;gesture.current=null;
      if(g&&stage.current?.hasPointerCapture(g.id))stage.current.releasePointerCapture(g.id);
    };
    document.addEventListener('visibilitychange',stopHidden);
    return()=>document.removeEventListener('visibilitychange',stopHidden);
  },[]);
  useEffect(()=>{
    if(active)return;
    motion.current.finish();
    const g=gesture.current;gesture.current=null;
    if(g&&stage.current?.hasPointerCapture(g.id))stage.current.releasePointerCapture(g.id);
  },[active]);
  useLayoutEffect(() => {
    scroll.current.scrollTo({left:pos.current * stride.current,behavior:"instant"});
    resizing.current = false;
  }, [viewport]);
  const previousActivities=useRef(activities);
  useLayoutEffect(()=>{
    const before=previousActivities.current,oldIndex=Math.round(pos.current),anchor=before[oldIndex]?.id;
    previousActivities.current=activities;
    const moved=before!==activities,next=activities.findIndex(a=>a.id===anchor);
    let wanted=pos.current;
    if(moved&&next===index&&next>=0)wanted=index+(pos.current-oldIndex);
    else if(Math.round(pos.current)!==index)wanted=index;
    if(Math.abs(wanted-pos.current)>.0001){motion.current.cancel();pos.current=wanted;scroll.current.scrollTo({left:wanted*stride.current,behavior:'instant'});setPosition(wanted)}
  },[index,activities]);
  const update = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      // Scroll events can precede ResizeObserver delivery. Never adopt a
      // browser-clamped offset while the rendered spacer still uses old width.
      if (resizing.current || measuredWidth.current == null ||
        Math.abs(stage.current.clientWidth - measuredWidth.current) > .5) return;
      const p = scroll.current.scrollLeft / stride.current;
      pos.current = p;
      setPosition(p);
      onIndex(clamp(Math.round(p), 0, activities.length - 1));
    });
  };
  useEffect(()=>{
    // Keep compositor hints only while moving, not throughout a static visit.
    const node=stage.current;
    node.dataset.moving='true';
    const timer=setTimeout(()=>{delete node.dataset.moving},240);
    return()=>{clearTimeout(timer);delete node.dataset.moving};
  },[position]);
  const end = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    if (stage.current.hasPointerCapture(e.pointerId))
      stage.current.releasePointerCapture(e.pointerId);
    if (e.type !== "pointercancel" && !g.moved && g.activity != null){
      motion.current.goTo(activities.findIndex(a=>a.id===g.activity));
      onOpen(g.activity);
    }
    else motion.current.settle(e.type!=='pointercancel'&&performance.now()-g.time<80?g.velocity:0);
  };
  const layout=coverLayout(width,height,activities.length,position,style),
    {count,cover:coverWidth,ratio,top}=layout,
    visible=coverWindow(activities.length,position,count).map(({index:i,d})=>({a:activities[i],i,d}));
  return (
    <section
      ref={stage}
      className={"tunnel-stage continuous-tunnel classic-coverflow cover-style-"+style}
      data-cover-count={count}
      style={{"--floor-y":`${top+coverWidth/ratio+14}px`}}
      aria-label="时光隧道"
      data-position={position.toFixed(3)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        motion.current.cancel();
        scroll.current.scrollTo({
          left: scroll.current.scrollLeft,
          behavior: "instant",
        });
        gesture.current = {
          id: e.pointerId,
          x: e.clientX,
          lastX: e.clientX,
          time: performance.now(),
          velocity: 0,
          start: scroll.current.scrollLeft,
          moved: false,
          activity: e.target.closest("[data-activity]")?.dataset.activity,
        };
        stage.current.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        const dx = e.clientX - g.x;
        const now=performance.now(),dt=now-g.time;
        if(dt>0){
          const speed=(g.lastX-e.clientX)/stride.current/Math.max(8,dt);
          g.velocity=dt>80?speed:g.velocity*.3+speed*.7;
        }
        g.lastX = e.clientX;g.time=now;
        if (Math.abs(dx) > 6) g.moved = true;
        if (g.moved) scroll.current.scrollLeft = g.start - dx;
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="tunnel-scroll"
        ref={scroll}
        onScroll={update}
        aria-hidden="true"
      >
        <div
          style={{
            width: (activities.length - 1) * stride.current + width,
            height: 1,
          }}
        />
      </div>
      <div className="tunnel-panels">
        {visible.map(({ a, i, d }) => {
          const {x,y,scale,angle,light,origin,z}=coverPose(d,layout,style);
          const mosaic=planCoverMosaic(a.selected,ratio);
          return (
            <button
              key={a.id}
              data-activity={a.id}
              data-cover-offset={d}
              className={
                "activity-panel depth-" +
                (i === index ? 0 : Math.max(1, i - index))
              }
              tabIndex={i === index ? 0 : -1}
              aria-label={"展开活动 " + a.event.theme}
              onClick={(e) => {
                if (e.detail === 0) {motion.current.goTo(i);onOpen(a.id);}
              }}
              style={{
                width:coverWidth,height:coverWidth/ratio,top,left:origin+"%",
                transform: `translateX(-50%) translate(${x}px,${y}px) perspective(${Math.max(900,coverWidth*4)}px) rotateY(${angle}deg) scale(${scale})`,
                opacity:1,
                "--cover-light":light,
                "--cover-height":`${coverWidth/ratio}px`,
                zIndex:z,
                "--reflection-height":`${Math.max(180,(height-coverWidth/ratio-top)/scale)}px`,
                pointerEvents:"auto",
              }}
            >
              <div className={mosaic.className} style={mosaic.style}>
                {!a.selected.length && <span className="cover-pending">{a.unscored ? "评分中" : "暂无精选照片"}</span>}
                {a.selected.map((p, j) => (
                  <div className={"mosaic-cell cell-" + j} key={p.id}>
                    <PreviewImage native
                      priority={Math.abs(d)<.5?0:1} src={p.thumbnail}
                      alt=""
                      draggable="false"
                      decoding="async"
                    />
                    <span>{p.kind === "video_candidate" ? "▶" : ""}</span>
                  </div>
                ))}
              </div>
              <div className="panel-reflection" aria-hidden="true">
                <div className={mosaic.className} style={mosaic.style}>
                  {a.selected.map((p, j) => (
                    <div className={"mosaic-cell cell-" + j} key={p.id}>
                      <PreviewImage native
                        priority={Math.abs(d)<.5?0:1} src={p.thumbnail}
                        alt=""
                        draggable="false"
                        decoding="async"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
});

export function PhotoWall({ activity, api, onOpen, warm, onCounts, endpoint, initialLeft=0, onPosition, moving=false, onSequence }) {
  const container = useRef(null),
    scrollFrame=useRef(null),scrollEnd=useRef(null),position=useRef(initialLeft),slider=useRef(null),percentage=useRef(null),positionCallback=useRef(onPosition),
    request=useRef(null),restoreTarget=useRef(initialLeft),
    drag = useRef(null),
    suppress = useRef(false),
    [items, setItems] = useState(warm?.data?.items || []),
    [total, setTotal] = useState(warm?.data?.total ?? null),
    [height, setHeight] = useState(500),
    [left, setLeft] = useState(0),
    [busy, setBusy] = useState(false),[loadError,setLoadError]=useState(null),[scrolling,setScrolling]=useState(false),[width,setWidth]=useState(1000);
  positionCallback.current=onPosition;
  const syncPosition=()=>{
    const node=container.current;if(!node)return;const x=node.scrollLeft,max=Math.max(0,node.scrollWidth-node.clientWidth);position.current=x;
    if(slider.current)slider.current.value=String(x);
    if(percentage.current)percentage.current.textContent=(max?Math.round(x/max*100):0)+'%';
    setLeft(Math.floor(x/256)*256);
  };
  const scroll=()=>{
    warm?.stopPreviews?.();
    if(scrollFrame.current===null)scrollFrame.current=requestAnimationFrame(()=>{scrollFrame.current=null;syncPosition()});
    setScrolling(true);clearTimeout(scrollEnd.current);
    scrollEnd.current=setTimeout(()=>{setScrolling(false);positionCallback.current?.(container.current?.scrollLeft || 0)},180);
  };
  useEffect(()=>()=>{cancelAnimationFrame(scrollFrame.current);clearTimeout(scrollEnd.current);positionCallback.current?.(position.current)},[]);
  const state = useRef({
    offset: warm?.data?.items.length || 0,
    total: warm?.data?.total ?? Infinity,
    loading: false,
    stopped: false,
  });
  const itemsRef=useRef(items);itemsRef.current=items;
  const sequenceCallback=useRef(onSequence);sequenceCallback.current=onSequence;
  useEffect(()=>{sequenceCallback.current?.({key:activity.id,items,total,busy,error:loadError,loadMore:load})},[items,total,busy,loadError]);
  const load = async () => {
    const s = state.current;
    if (s.loading || s.stopped || s.offset >= s.total) return;
    s.loading = true;
    setBusy(true);
    const controller=new AbortController();request.current=controller;
    try {
      const d = await api(
        (endpoint || "/gallery/" + activity.id) + (endpoint?.includes('?') ? '&' : '?') + "offset=" + s.offset + "&limit=200",'GET',undefined,{signal:controller.signal},
      );
      if (s.stopped) return;
      setLoadError(null);
      s.offset += d.items.length;
      s.total = d.total;
      setTotal(d.total);
      onCounts?.({photos:d.photos,videos:d.videos});
      itemsRef.current=[...itemsRef.current,...d.items];
      setItems(itemsRef.current);
      return itemsRef.current;
    } catch (e) {
      if (!s.stopped && e.name!=='AbortError') setLoadError(e);
    } finally {
      s.loading = false;
      if (!s.stopped) setBusy(false);
    }
  };
  useEffect(() => {
    state.current.stopped=false;
    onCounts?.({photos:warm?.data?.photos ?? activity.photos,videos:warm?.data?.videos ?? activity.videos});
    load();
    return () => {
      state.current.stopped = true;
      request.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    setHeight(container.current.getBoundingClientRect().height);setWidth(container.current.clientWidth);
    const ro = new ResizeObserver(([e]) => {setHeight(e.contentRect.height);setWidth(e.contentRect.width)});
    ro.observe(container.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const node = container.current;
    const wheel = (e) => {
      if (e.ctrlKey) return;
      if(Math.abs(e.deltaX)>Math.abs(e.deltaY)&&e.deltaMode===0)return;
      e.preventDefault();
      node.scrollLeft +=
        (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientWidth : 1);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const {layout,extent,h}=useMemo(()=>{
    const rows=height<400?2:3,gap=7,h=(height-(rows-1)*gap)/rows,ends=Array(rows).fill(0);
    const layout=items.map(p=>{const row=ends.indexOf(Math.min(...ends)),ratio=p.info?.width&&p.info?.height?p.info.width/p.info.height:1.5,w=h*ratio,x=ends[row];ends[row]+=w+gap;return {p,x,y:row*(h+gap),w}});
    return {layout,extent:Math.max(...ends,1),h};
  },[items,height]);
  useLayoutEffect(()=>{syncPosition()},[extent,width]);
  useLayoutEffect(()=>{
    const wanted=restoreTarget.current,node=container.current;
    if(!wanted || !items.length)return;
    node.scrollLeft=wanted;syncPosition();
    if(extent>=wanted+node.clientWidth || items.length>=state.current.total)restoreTarget.current=0;
    else load();
  },[extent,items.length]);
  useEffect(() => {
    if (extent - left < (container.current?.clientWidth || 0) * 2) load();
  }, [left, extent, total]);
  return (<>
    <section
      className="photo-wall horizontal-wall"
      ref={container}
      aria-label="活动照片墙"
      tabIndex="0"
      data-scrolling={scrolling}
      onScroll={scroll}
      onClickCapture={e=>positionCallback.current?.(e.currentTarget.scrollLeft)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          e.currentTarget.scrollBy({
            left:
              (e.key === "ArrowRight" ? 1 : -1) *
              e.currentTarget.clientWidth *
              0.7,
            behavior: "smooth",
          });
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        suppress.current = false;
        drag.current = {
          id: e.pointerId,
          x: e.clientX,
          left: e.currentTarget.scrollLeft,
        };
      }}
      onPointerMove={(e) => {
        const g = drag.current;
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.x;
        if (Math.abs(dx) > 6) {
          suppress.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.scrollLeft = g.left - dx;
        }
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        suppress.current = true;
      }}
    >
      <div
        className="wall-canvas"
        style={{
          width: extent + (total != null && items.length < total ? 180 : 0),
          height: "100%",
        }}
      >
        {layout
          .filter(
            ({ x, w }) =>
              x + w >= left - (container.current?.clientWidth || 1000) &&
              x <= left + 2 * (container.current?.clientWidth || 1000),
          )
          .map(({ p, x, y, w }) => <WallTile key={p.id} p={p} x={x} y={y} w={w} h={h} display={warm?.urls.get(p.id)} moving={moving||scrolling} promote={x+w>=left&&x<=left+width+256} onOpen={onOpen} suppress={suppress}/>)}
        {!busy && items.length < (total ?? Infinity) && (
          <button
            className="wall-load"
            style={{ left: extent }}
            disabled={busy}
            onClick={load}
          >
            继续展开
          </button>
        )}
      </div>
    </section>
    {loadError&&<div className="wall-data-notice"><StatusNotice error={loadError} scope="照片流" detail="保留已展开的照片" onRetry={load}/></div>}
    {busy && (items.length===0 || extent-left<=(container.current?.clientWidth || 0)+1) && <PhotoLoading size="small" className="gallery-photo-loading wall-photo-loading" label="加载照片"/>}
    <div className="wall-scroll-control"><input ref={slider} type="range" aria-label="照片流横向位置" min="0" max={Math.max(0,extent-width)} step="1" defaultValue={initialLeft}
      onChange={e=>{container.current.scrollLeft=Number(e.target.value);syncPosition();scroll()}}/><output ref={percentage}>0%</output></div>
    </>
  );
}

// Scroll frames only move the virtual window; unchanged tiles do not rerender.
const WallTile=memo(function WallTile({p,x,y,w,h,display,moving,promote,onOpen,suppress}){
 return <button className="wall-photo" data-photo={p.id} style={{left:x,top:y,width:w,height:h}} aria-label={'查看 '+p.name}
  onClick={e=>{if(suppress.current&&e.detail!==0)return;onOpen(p)}}>
  {(p.preview||p.thumbnail)?<WallImage photo={p} display={display} moving={moving} promote={promote}/>:<div className="video-index-card"><Icon name="video"/>视频</div>}
  <span>{p.kind==='video_candidate'?'▶':''}</span>
 </button>;
});
