import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {WallImage} from "./wall-image";
import {PhotoLoading} from "./loading-mark";
import { Icon } from "./icons";
import {coverLayout,coverPose,coverWindow} from "./cover-layout";
import {planCoverMosaic} from './cover-mosaic';
import './cover-mosaic.css';
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
  { activities, index, onIndex, onOpen, style="classic" },
  ref,
) {
  const stage = useRef(null),
    scroll = useRef(null),
    pos = useRef(index),
    stride = useRef(720),
    gesture = useRef(null),
    frame = useRef(0),
    settleTimer = useRef(null),
    measuredWidth = useRef(null),
    resizing = useRef(false);
  const [position, setPosition] = useState(index),
    [viewport, setViewport] = useState({width:1000,height:700});
  const {width,height}=viewport;
  const goTo = (i) => {
    clearTimeout(settleTimer.current);
    scroll.current?.scrollTo({
      left: clamp(i, 0, activities.length - 1) * stride.current,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };
  const settle = () => {
    if (!gesture.current && scroll.current)
      goTo(Math.round(scroll.current.scrollLeft / stride.current));
  };
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
      // Each input interrupts settling; wait for the end of trackpad momentum.
      clearTimeout(settleTimer.current);
      scroll.current.scrollTo({left:scroll.current.scrollLeft + delta,behavior:"instant"});
      settleTimer.current=setTimeout(settle,180);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
      frame.current=0;
      clearTimeout(settleTimer.current);
    };
  }, [activities.length]);
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
    if(Math.abs(wanted-pos.current)>.0001){pos.current=wanted;scroll.current.scrollTo({left:wanted*stride.current,behavior:'instant'});setPosition(wanted)}
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
  const end = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    if (stage.current.hasPointerCapture(e.pointerId))
      stage.current.releasePointerCapture(e.pointerId);
    settle();
    if (e.type !== "pointercancel" && !g.moved && g.activity != null)
      onOpen(g.activity);
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
        clearTimeout(settleTimer.current);
        scroll.current.scrollTo({
          left: scroll.current.scrollLeft,
          behavior: "instant",
        });
        gesture.current = {
          id: e.pointerId,
          x: e.clientX,
          lastX: e.clientX,
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
        g.lastX = e.clientX;
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
                if (e.detail === 0) onOpen(a.id);
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
                    <img
                      src={p.thumbnail}
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
                      <img
                        src={p.thumbnail}
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

export function PhotoWall({ activity, api, onOpen, onError, warm, onCounts, endpoint, initialLeft=0, onPosition }) {
  const container = useRef(null),
    request=useRef(null),restoreTarget=useRef(initialLeft),
    drag = useRef(null),
    suppress = useRef(false),
    [items, setItems] = useState(warm?.data?.items || []),
    [total, setTotal] = useState(warm?.data?.total ?? null),
    [height, setHeight] = useState(500),
    [left, setLeft] = useState(0),
    [busy, setBusy] = useState(false);
  const state = useRef({
    offset: warm?.data?.items.length || 0,
    total: warm?.data?.total ?? Infinity,
    loading: false,
    stopped: false,
  });
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
      s.offset += d.items.length;
      s.total = d.total;
      setTotal(d.total);
      onCounts?.({photos:d.photos,videos:d.videos});
      setItems((p) => [...p, ...d.items]);
    } catch (e) {
      if (!s.stopped && e.name!=='AbortError') onError?.(e.message);
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
    setHeight(container.current.getBoundingClientRect().height);
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(container.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const node = container.current;
    const wheel = (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      node.scrollLeft +=
        (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientWidth : 1);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const rows = height < 400 ? 2 : 3,
    gap = 7,
    h = (height - (rows - 1) * gap) / rows,
    ends = Array(rows).fill(0);
  const layout = items.map((p) => {
      const row = ends.indexOf(Math.min(...ends));
      const ratio =
          p.info?.width && p.info?.height ? p.info.width / p.info.height : 1.5,
        w = h * ratio,
        x = ends[row];
      ends[row] += w + gap;
      return { p, x, y: row * (h + gap), w };
    }),
    extent = Math.max(...ends, 1);
  useLayoutEffect(()=>{
    const wanted=restoreTarget.current,node=container.current;
    if(!wanted || !items.length)return;
    node.scrollLeft=wanted;setLeft(node.scrollLeft);
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
      onScroll={(e) => {setLeft(e.currentTarget.scrollLeft);onPosition?.(e.currentTarget.scrollLeft)}}
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
          .map(({ p, x, y, w }) => (
            <button
              className="wall-photo"
              data-photo={p.id}
              key={p.id}
              style={{ left: x, top: y, width: w, height: h }}
              onClick={(e) => {
                if (suppress.current && e.detail !== 0) return;
                onOpen(p);
              }}
              aria-label={"查看 " + p.name}
            >
              {(p.preview || p.thumbnail) ? <WallImage photo={p} display={warm?.urls.get(p.id)}/> : <div className="video-index-card"><Icon name="video" />视频</div>}
              <span>{p.kind === "video_candidate" ? "▶" : ""}</span>
            </button>
          ))}
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
    {busy && <PhotoLoading compact className="gallery-photo-loading wall-photo-loading" label="加载照片"/>}
    <div className="wall-scroll-control"><input type="range" aria-label="照片流横向位置" min="0" max={Math.max(0,extent-(container.current?.clientWidth || 0))} step="1" value={Math.min(left,Math.max(0,extent-(container.current?.clientWidth || 0)))}
      onChange={e=>{container.current.scrollLeft=Number(e.target.value);setLeft(Number(e.target.value));onPosition?.(Number(e.target.value))}}/><output>{extent>(container.current?.clientWidth || 0)?Math.round(left/Math.max(1,extent-(container.current?.clientWidth || 0))*100):0}%</output></div>
    </>
  );
}
