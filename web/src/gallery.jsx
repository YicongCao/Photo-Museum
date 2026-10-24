import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import "./gallery.css";

export function Gallery({ api, onAdmin, onLogout }) {
  const [loaded, setLoaded] = useState(false);
  const [activities, setActivities] = useState([]),
    [index, setIndex] = useState(0),
    [view, setView] = useState("tunnel"),
    [wall, setWall] = useState([]),
    [photo, setPhoto] = useState(null),
    [error, setError] = useState("");
  const lastFocus = useRef(null),
    wheelTime = useRef(0),
    selectedId = useRef(null);
  selectedId.current = activities[index]?.id || null;
  const current = activities[index];
  const reload = () =>
    api("/gallery")
      .then((d) => {
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
  useEffect(() => {
    if (index >= activities.length)
      setIndex(Math.max(0, activities.length - 1));
  }, [activities, index]);
  useEffect(() => {
    let cancelled = false;
    setWall([]);
    if (view === "wall" && current)
      api("/gallery/" + current.id + "?limit=200")
        .then((d) => {
          if (!cancelled) setWall(d.items);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [view, current?.id]);
  const move = (n) =>
    setIndex((i) => Math.max(0, Math.min(activities.length - 1, i + n)));
  useEffect(() => {
    const f = (e) => {
      if (photo || ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [photo, activities.length]);
  const open = (a) => {
    lastFocus.current = document.activeElement;
    setPhoto(a);
  };
  const close = () => {
    setPhoto(null);
    requestAnimationFrame(() => lastFocus.current?.focus());
  };
  return (
    <div className="gallery-shell">
      <nav className="gallery-nav">
        <div>
          <button
            className={view === "tunnel" ? "active" : ""}
            onClick={() => setView("tunnel")}
          >
            Gallery
          </button>
          <button
            className={view === "wall" ? "active" : ""}
            onClick={() => setView("wall")}
          >
            照片墙
          </button>
          <button
            onClick={() =>
              document.documentElement.requestFullscreen?.().catch(() => {})
            }
            aria-label="全屏"
          >
            ⛶
          </button>
          <button onClick={onAdmin}>馆务</button>
          <button aria-label="锁馆" onClick={onLogout}>
            <Icon name="lock" />
          </button>
        </div>
      </nav>
      {error && (
        <p role="alert" className="gallery-error">
          {error}
        </p>
      )}
      {!current ? (
        <div className="gallery-empty">
          <Icon name="photo" />
          <p>{loaded ? "尚无可展示照片" : "读取照片"}</p>
          <button onClick={onAdmin}>查看刮削进度 →</button>
        </div>
      ) : (
        <>
          {view === "tunnel" ? (
            <section
              aria-label="时光隧道"
              className="tunnel-stage"
              onWheel={(e) => {
                if (
                  Math.abs(e.deltaY) > 20 &&
                  Date.now() - wheelTime.current > 650
                ) {
                  wheelTime.current = Date.now();
                  move(e.deltaY > 0 ? 1 : -1);
                }
              }}
            >
              {activities.slice(index, index + 5).map((a, depth) => (
                <div
                  key={a.id}
                  className={"activity-panel depth-" + depth}
                  aria-hidden={depth > 0}
                >
                  <div className={"photo-mosaic count-" + a.selected.length}>
                    {a.selected.map((p, i) => (
                      <button
                        key={p.id}
                        tabIndex={depth ? -1 : 0}
                        className={"mosaic-cell cell-" + i}
                        onClick={() =>
                          depth ? setIndex(index + depth) : open(p)
                        }
                        aria-label={"查看 " + p.name}
                      >
                        <img
                          src={p.thumbnail}
                          alt={depth ? "" : p.name}
                          decoding="async"
                        />
                        <span>{p.kind === "video_candidate" ? "▶" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <section className="photo-wall" aria-label="活动照片墙">
              {wall.map((p) => (
                <button key={p.id} onClick={() => open(p)}>
                  <img src={p.thumbnail} alt={p.name} loading="lazy" />
                  <span>{p.kind === "video_candidate" ? "▶" : ""}</span>
                </button>
              ))}
              {wall.length >= 200 && (
                <button
                  onClick={() =>
                    api(
                      "/gallery/" +
                        current.id +
                        "?offset=" +
                        wall.length +
                        "&limit=200",
                    ).then((d) => setWall((w) => [...w, ...d.items]))
                  }
                >
                  继续展开
                </button>
              )}
            </section>
          )}
          <aside className="activity-timeline" aria-label="活动时间线">
            {activities.map((a, i) => (
              <React.Fragment key={a.id}>
                {(i === 0 || a.event.year !== activities[i - 1].event.year) && (
                  <div
                    className={
                      "timeline-year " +
                      (current.event.year === a.event.year ? "selected" : "")
                    }
                  >
                    {a.event.year || "未知年份"}
                  </div>
                )}
                <button
                  aria-current={i === index ? "true" : undefined}
                  className={i === index ? "selected" : ""}
                  title={a.event.theme}
                  onClick={() => setIndex(i)}
                >
                  <span className="timeline-dot" />
                  {a.event.month
                    ? String(a.event.month).padStart(2, "0")
                    : "年度"}
                  -{a.event.theme}
                </button>
              </React.Fragment>
            ))}
          </aside>
          <div className="gallery-caption">
            <div>
              {current.event.year}
              {current.event.month
                ? " · " + String(current.event.month).padStart(2, "0")
                : ""}
            </div>
            <h1>{current.event.theme}</h1>
            <p>
              <Icon name="photo" /> {current.selected.length} 张精选{" "}
              <span>／ {current.count} 件藏品</span>
            </p>
          </div>
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
        </>
      )}
      {photo && (
        <Viewer
          key={photo.id}
          photo={photo}
          api={api}
          onClose={close}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function Viewer({ photo, api, onClose, onChanged }) {
  const [suggestions, setSuggestions] = useState([]),
    [mutationError, setMutationError] = useState("");
  const [manifest, setManifest] = useState(null),
    [source, setSource] = useState(photo.preview),
    [original, setOriginal] = useState(null),
    [phase, setPhase] = useState("4K 读取中"),
    [zoom, setZoom] = useState(false),
    [info, setInfo] = useState(false),
    [pinned, setPinned] = useState(photo.pinned),
    [play, setPlay] = useState(false),
    [analysis, setAnalysis] = useState(null),
    [native, setNative] = useState(false);
  const closeRef = useRef(null),
    previewRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const f = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const buttons = [
          ...document.querySelectorAll(
            ".photo-viewer button,.photo-viewer video",
          ),
        ].filter((x) => !x.disabled);
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
  useEffect(() => {
    const controller = new AbortController();
    let url;
    setOriginal(null);
    setPhase("4K · 原图读取中");
    (async () => {
      try {
        api("/assets/" + photo.id + "/suggestions")
          .then((d) => {
            if (!controller.signal.aborted) setSuggestions(d.items);
          })
          .catch(() => {});
        api("/assets/" + photo.id + "/analysis")
          .then((a) => {
            if (!controller.signal.aborted) setAnalysis(a);
          })
          .catch(() => {});
        const m = await api("/assets/" + photo.id + "/manifest");
        if (controller.signal.aborted) return;
        setManifest(m);
        if (photo.kind === "video_candidate") {
          setPhase("视频封面");
          return;
        }
        // Load preview immediately, original independently; original only replaces after decode.
        const response = await fetch(
          native ? m.original : m.compatible || m.original,
          { signal: controller.signal },
        );
        if (!response.ok) throw Error("原图暂不可用");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        if (controller.signal.aborted) return;
        setOriginal(url);
        setPhase(m.compatible && !native ? "全分辨率 SDR" : "原图");
      } catch (e) {
        if (!controller.signal.aborted) setPhase("保留 4K · 原图暂不可用");
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.id, native]);
  return (
    <div
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="照片细看"
    >
      <div className="viewer-toolbar">
        <span>{photo.name}</span>
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
            {pinned ? "★ 已固定精选" : "☆ 固定精选"}
          </button>
          <button onClick={() => setNative(!native)}>
            {native ? "原生色彩" : "SDR"}
          </button>
          <button onClick={() => setInfo(!info)} aria-expanded={info}>
            照片档案
          </button>
          <button ref={closeRef} onClick={onClose} aria-label="关闭照片">
            ✕
          </button>
        </div>
      </div>
      <div
        className={"viewer-image-area " + (zoom ? "zoomed" : "")}
        onClick={() => !play && setZoom(!zoom)}
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
            onClick={() => setZoom(!zoom)}
            aria-label={zoom ? "适合窗口" : "放大"}
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
          {analysis?.visual?.data?.score != null && (
            <div>
              <small>技术评分</small>
              <p>{analysis.visual.data.score} / 100</p>
            </div>
          )}
          {analysis?.visual?.data?.tags && (
            <div>
              <small>本地主体识别</small>
              <p>
                {analysis.visual.data.tags
                  .slice(0, 3)
                  .map((t) => t.label)
                  .join(" · ")}
              </p>
            </div>
          )}
          {analysis?.places && (
            <div>
              <small>近似城市 · GeoNames</small>
              <p>
                {["country", "province", "city"]
                  .map((k) => analysis.places.data[k])
                  .filter(Boolean)
                  .join(" · ")}
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
          {Object.entries(manifest?.effective_metadata || {}).map(
            ([field, f]) => (
              <div key={field}>
                <small>
                  {field} ·{" "}
                  {f.layer === "observed"
                    ? "相机记录"
                    : f.layer === "manual"
                      ? "你已修订"
                      : "近邻推断"}
                </small>
                <p>
                  {typeof f.value === "object"
                    ? JSON.stringify(f.value)
                    : String(f.value ?? "未知")}
                </p>
              </div>
            ),
          )}
        </aside>
      )}
    </div>
  );
}
