import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { Tunnel, PhotoWall, FullscreenButton } from "./exhibition";
import "./gallery.css";
import { ActivityTimeline } from "./timeline";

export function Gallery({ api, onAdmin }) {
  const [loaded, setLoaded] = useState(false),
    [activities, setActivities] = useState([]),
    [index, setIndex] = useState(0),
    [view, setView] = useState("tunnel"),
    [photo, setPhoto] = useState(null),
    [error, setError] = useState("");
  const tunnel = useRef(null),
    lastFocus = useRef(null),
    selectedId = useRef(null);
  const current = activities[index];
  selectedId.current = current?.id;
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
  const goTo = (i) => {
    if (view === "tunnel") tunnel.current?.goTo(i);
    else setIndex(i);
  };
  const move = (n) => tunnel.current?.move(n);
  const openActivity = (id) => {
    const i = activities.findIndex((a) => a.id === id);
    if (i >= 0) {
      setIndex(i);
      setView("wall");
    }
  };
  useEffect(() => {
    const f = (e) => {
      if (photo || ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape" && view === "wall") {
        setView("tunnel");
        return;
      }
      if (view !== "tunnel") return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        move(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [photo, view]);
  const open = (p) => {
    lastFocus.current = document.activeElement;
    setPhoto(p);
  };
  const close = () => {
    setPhoto(null);
    requestAnimationFrame(() => lastFocus.current?.focus());
  };
  return (
    <div className={"gallery-shell gallery-view-" + view}>
      <nav className="gallery-nav">
        <div>
          <button
            className={view === "tunnel" ? "active" : ""}
            onClick={() => setView("tunnel")}
          >
            Gallery
          </button>
          <button onClick={onAdmin}>Dashboard</button>
          <FullscreenButton />
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
            <Tunnel
              ref={tunnel}
              activities={activities}
              index={index}
              onIndex={setIndex}
              onOpen={openActivity}
            />
          ) : (
            <PhotoWall
              key={current.id}
              activity={current}
              api={api}
              onOpen={open}
              onError={setError}
            />
          )}
          {view === "tunnel" && (
            <ActivityTimeline activities={activities} index={index} onSelect={goTo} />
          )}
          <div className="gallery-caption">
            <div>
              {current.event.year}
              {current.event.month
                ? " · " + String(current.event.month).padStart(2, "0")
                : ""}
            </div>
            <h1>{current.event.theme}</h1>
          </div>
          {view === "tunnel" && (
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

function metadataText(field, value) {
  if (value == null) return "未知";
  if (field === "gps" && typeof value === "object")
    return `${Number(value.latitude).toFixed(5)}, ${Number(value.longitude).toFixed(5)}`;
  if (field === "exposure" && Number(value) > 0)
    return Number(value) < 1
      ? `1/${Math.round(1 / Number(value))} s`
      : `${value} s`;
  if (field === "aperture") return `ƒ/${value}`;
  if (field === "focal_length") return `${value} mm`;
  if (field === "captured_at")
    return String(value).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  return String(value);
}

function Viewer({ photo, api, onClose, onChanged }) {
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
    [native, setNative] = useState(false);
  const viewerRef = useRef(null);
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
        else onClose();
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
    let url, decoded;
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
        if (m.placeholder) {
          setPhase(m.placeholder === "video" ? "此视频超大" : "此图片超大");
          return;
        }
        if (photo.kind === "video_candidate") {
          setPhase("视频封面");
          return;
        }
        // Load preview immediately, original independently; original only replaces after decode.
        const response = await fetch(
          native ? m.original : m.original_compatible || m.original,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw Error("原图暂不可用");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        if (controller.signal.aborted) return;
        setOriginal(url);
        setPhase(
          m.original_compatible && !native ? "原图 · SDR 兼容显示" : "原图",
        );
        decoded.removeAttribute("src");
        decoded = null;
      } catch (e) {
        if (!controller.signal.aborted) setPhase("保留 4K · 原图暂不可用");
      }
    })();
    return () => {
      controller.abort();
      decoded?.removeAttribute("src");
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.id, native]);
  return (
    <div
      ref={viewerRef}
      className={"photo-viewer " + (info ? "with-metadata" : "image-only")}
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
          <FullscreenButton target={viewerRef} />
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
              <p>{analysis.visual.data.score} / 100{analysis.visual.data.score_penalty_reason === "assumed_srgb" ? " · 色域假定 −15" : ""}</p>
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
        if (m.placeholder) {
          setPhase(m.placeholder === "video" ? "此视频超大" : "此图片超大");
          return;
        }
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
          {Object.entries(manifest?.effective_metadata || {})
            .filter(([field]) =>
              [
                "camera",
                "lens",
                "captured_at",
                "width",
                "height",
                "aperture",
                "exposure",
                "iso",
                "focal_length",
                "gps",
              ].includes(field),
            )
            .map(([field, f]) => (
              <div key={field}>
                <small>
                  {
                    {
                      camera: "相机",
                      lens: "镜头",
                      captured_at: "拍摄时间",
                      width: "宽度",
                      height: "高度",
                      aperture: "光圈",
                      exposure: "曝光时间",
                      iso: "ISO",
                      focal_length: "焦距",
                      gps: "GPS",
                    }[field]
                  }{" "}
                  ·{" "}
                  {f.layer === "observed"
                    ? "相机记录"
                    : f.layer === "manual"
                      ? "你已修订"
                      : "近邻推断"}
                </small>
                <p>{metadataText(field, f.value)}</p>
              </div>
            ))}
        </aside>
      )}
    </div>
  );
}
