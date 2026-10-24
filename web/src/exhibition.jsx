import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "./icons";
export function FullscreenButton({ target, className = "" }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return (
    <button
      className={"fullscreen-button " + className}
      aria-label={active ? "退出全屏" : "全屏显示"}
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
function pose(depth) {
  const keys = [
    [-2, -210, 1.25, 8, 0],
    [-1, -108, 1.16, 12, 1],
    [0, 0, 1, 24, 1],
    [1, 72, 0.66, 57, 0.76],
    [2, 95, 0.46, 61, 0.54],
    [3, 110, 0.31, 63, 0.38],
    [4, 120, 0.2, 65, 0.23],
    [5, 127, 0.12, 66, 0],
  ];
  const d = clamp(depth, -2, 5),
    i = Math.min(keys.length - 2, Math.floor(d + 2)),
    a = keys[i],
    b = keys[i + 1],
    t = d - a[0];
  return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t);
}
export const Tunnel = forwardRef(function Tunnel(
  { activities, index, onIndex, onOpen },
  ref,
) {
  const stage = useRef(null),
    scroll = useRef(null),
    pos = useRef(index),
    stride = useRef(720),
    gesture = useRef(null),
    frame = useRef(0);
  const [position, setPosition] = useState(index),
    [width, setWidth] = useState(1000);
  const goTo = (i) =>
    scroll.current?.scrollTo({
      left: clamp(i, 0, activities.length - 1) * stride.current,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  useImperativeHandle(
    ref,
    () => ({ goTo, move: (n) => goTo(Math.round(pos.current) + n) }),
    [activities.length],
  );
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      stride.current = Math.max(220, w * 0.65);
      setWidth(w);
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
      scroll.current.scrollLeft += delta;
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useLayoutEffect(() => {
    scroll.current.scrollLeft = pos.current * stride.current;
  }, [width]);
  const previousActivities = useRef(activities);
  useLayoutEffect(() => {
    const before = previousActivities.current,
      oldIndex = Math.round(pos.current),
      anchor = before[oldIndex]?.id;
    previousActivities.current = activities;
    const next = activities.findIndex((a) => a.id === anchor);
    if (next >= 0 && next !== oldIndex) {
      pos.current += next - oldIndex;
      scroll.current.scrollLeft = pos.current * stride.current;
      setPosition(pos.current);
      onIndex(next);
    }
  }, [activities]);
  const update = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
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
    if (e.type !== "pointercancel" && !g.moved && g.activity != null)
      onOpen(g.activity);
  };
  const base = Math.floor(position),
    visible = activities
      .map((a, i) => ({ a, i }))
      .slice(Math.max(0, base - 2), base + 7);
  return (
    <section
      ref={stage}
      className="tunnel-stage continuous-tunnel"
      aria-label="时光隧道"
      data-position={position.toFixed(3)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        scroll.current.scrollTo({
          left: scroll.current.scrollLeft,
          behavior: "instant",
        });
        gesture.current = {
          id: e.pointerId,
          x: e.clientX,
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
        {visible.map(({ a, i }) => {
          const d = i - position,
            [x, scale, angle, opacity] = pose(d);
          return (
            <button
              key={a.id}
              data-activity={a.id}
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
                transform: `translateX(${x}%) scale(${scale}) perspective(1800px) rotateY(${angle}deg)`,
                opacity,
                zIndex: 100 - Math.round(d * 10),
                pointerEvents: opacity > 0.05 ? "auto" : "none",
              }}
            >
              <div className={"photo-mosaic count-" + a.selected.length}>
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
                <div className={"photo-mosaic count-" + a.selected.length}>
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

export function PhotoWall({ activity, api, onOpen, onError }) {
  const container = useRef(null),
    drag = useRef(null),
    suppress = useRef(false),
    [items, setItems] = useState([]),
    [total, setTotal] = useState(null),
    [height, setHeight] = useState(500),
    [left, setLeft] = useState(0),
    [busy, setBusy] = useState(false);
  const state = useRef({
    offset: 0,
    total: Infinity,
    loading: false,
    stopped: false,
  });
  const load = async () => {
    const s = state.current;
    if (s.loading || s.stopped || s.offset >= s.total) return;
    s.loading = true;
    setBusy(true);
    try {
      const d = await api(
        "/gallery/" + activity.id + "?offset=" + s.offset + "&limit=200",
      );
      if (s.stopped) return;
      s.offset += d.items.length;
      s.total = d.total;
      setTotal(d.total);
      setItems((p) => [...p, ...d.items]);
    } catch (e) {
      if (!s.stopped) onError(e.message);
    } finally {
      s.loading = false;
      if (!s.stopped) setBusy(false);
    }
  };
  useEffect(() => {
    load();
    return () => {
      state.current.stopped = true;
    };
  }, []);
  useLayoutEffect(() => {
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
  useEffect(() => {
    if (extent - left < (container.current?.clientWidth || 0) * 2) load();
  }, [left, extent, total]);
  return (
    <section
      className="photo-wall horizontal-wall"
      ref={container}
      aria-label="活动照片墙"
      tabIndex="0"
      onScroll={(e) => setLeft(e.currentTarget.scrollLeft)}
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
              key={p.id}
              style={{ left: x, top: y, width: w, height: h }}
              onClick={(e) => {
                if (suppress.current && e.detail !== 0) return;
                onOpen(p);
              }}
              aria-label={"查看 " + p.name}
            >
              <img
                src={p.preview || p.thumbnail}
                alt={p.name}
                draggable="false"
                decoding="async"
              />
              <span>{p.kind === "video_candidate" ? "▶" : ""}</span>
            </button>
          ))}
        {items.length < (total ?? Infinity) && (
          <button
            className="wall-load"
            style={{ left: extent }}
            disabled={busy}
            onClick={load}
          >
            {busy ? "读取照片" : "继续展开"}
          </button>
        )}
      </div>
    </section>
  );
}
