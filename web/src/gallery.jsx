import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { Tunnel, PhotoWall, FullscreenButton } from "./exhibition";
import "./gallery.css";
import { useSceneMotion, createActivityWarmup } from "./scene-motion";
import { PhotoArchive } from "./photo-archive";
import { ActivityTimeline } from "./timeline";

export function Gallery({ api, onAdmin }) {
  const [loaded, setLoaded] = useState(false),
    [activities, setActivities] = useState([]),
    [index, setIndex] = useState(0),
    [view, setView] = useState("tunnel"),
    [photo, setPhoto] = useState(null),
    [error, setError] = useState(""),
    [wallId,setWallId]=useState(null),
    [counts,setCounts]=useState(null),
    [opening,setOpening]=useState(false);
  const tunnel = useRef(null),
    lastFocus = useRef(null),
    selectedId = useRef(null);
  const shell=useRef(null), warm=useRef(null), openingRef=useRef(false);
  const animate=useSceneMotion(shell);
  const current = activities[index];
  const wallActivity=activities.find(a=>a.id===wallId);
  useEffect(()=>{
    if (!current || view!=='tunnel' || openingRef.current) return;
    const timer=setTimeout(()=>{
      if(warm.current?.id===current.id)return;
      warm.current?.dispose();warm.current=createActivityWarmup(api,current.id);
    },280);
    return ()=>clearTimeout(timer);
  },[current?.id,view]);
  useEffect(()=>()=>warm.current?.dispose(),[]);
  const displayedActivity=view==="wall" && wallActivity ? wallActivity : current;
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
  const backGallery=()=>{
    if(openingRef.current){warm.current?.dispose();warm.current=null;}
    setPhoto(null);setView('tunnel');

  };
  const openActivity = async (id) => {
    if(openingRef.current)return;
    const i=activities.findIndex(a=>a.id===id);if(i<0)return;
    openingRef.current=true;setOpening(true);setError("");
    try {
      if(warm.current?.id!==id){warm.current?.dispose();warm.current=createActivityWarmup(api,id);}
      const data=await warm.current.promise;
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
    animate(".wall-scene .wall-photo img",()=>setPhoto({...p,preview:warm.current?.urls.get(p.id) || p.preview}),".viewer-image-area,.photo-viewer .metadata-panel");
  };
  const close = () => {
    setPhoto(null);
    requestAnimationFrame(() => lastFocus.current?.focus({preventScroll:true}));
  };
  return (
    <div ref={shell} className={"gallery-shell gallery-view-" + view + (opening ? " opening-activity" : "")} aria-busy={opening}>
      <nav className="gallery-nav">
        {view === "wall" && <button className="gallery-back" onClick={backGallery} aria-label="返回 Gallery">← Gallery</button>}
        <div>
          <button onClick={onAdmin}>Dashboard</button>
          <button
            className={view === "tunnel" ? "active" : ""}
            onClick={backGallery}
          >
            Gallery
          </button>
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
          <div className={"cover-scene scene-layer " + (view!=="tunnel" || photo ? "scene-inactive" : "")} inert={view!=="tunnel" || !!photo}>
            <Tunnel
              ref={tunnel}
              activities={activities}
              index={index}
              onIndex={setIndex}
              onOpen={openActivity}
            />
          </div>
          {wallActivity && <div className={"wall-scene scene-layer " + (view!=="wall" || photo ? "scene-inactive" : "")} inert={view!=="wall" || !!photo}>
            <PhotoWall
              key={wallActivity.id}
              activity={wallActivity}
              warm={warm.current?.id===wallActivity.id ? warm.current : null}
              onCounts={setCounts}
              api={api}
              onOpen={open}
              onError={setError}
            />
          </div>}
          {view === "tunnel" && (
            <ActivityTimeline activities={activities} index={index} onSelect={goTo} />
          )}
          <div className="gallery-caption">
            <div>
              {displayedActivity.event.year}
              {displayedActivity.event.month
                ? " · " + String(displayedActivity.event.month).padStart(2, "0")
                : ""}
            </div>
            <h1>{displayedActivity.event.theme}</h1>
            {view==='wall' && <p className="activity-counts">{counts?.photos ?? displayedActivity.photos ?? 0} 张照片{(counts?.videos ?? displayedActivity.videos)>0 && <span> · {counts?.videos ?? displayedActivity.videos} 个视频</span>}</p>}
            {opening && <p role="status">读取照片</p>}
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
      className={"photo-viewer " + (zoom ? "immersive " : "") + (info ? "with-metadata" : "image-only")}
      style={{"--photo-ratio":photo.info?.width && photo.info?.height ? photo.info.width/photo.info.height : 1.5}}
      role="dialog"
      aria-modal="true"
      aria-label="照片细看"
    >
      <div className="viewer-toolbar">
        <button ref={closeRef} className="viewer-back" onClick={onClose} aria-label="返回照片墙">← 返回</button>
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
          <button onClick={() => setNative(!native)}>
            {native ? "原生色彩" : "SDR"}
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

        </aside>
      )}
    </div>
  );
}
