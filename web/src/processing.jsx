import {PreviewImage} from './preview-image';
import {MediaStatus} from './system-status';
import {PhotoLoading} from './loading-mark';
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
export const processingSteps = [
  ["exif", "EXIF", "metadata"],
  ["frame", "视频中帧", "frame"],
  ["display", "4K 小图", "display"],
  ["thumb", "缩略图", "thumbnail"],
  ["compatible", "兼容原图", "color"],
  ["playback", "视频转码", "video"],
  ["publish", "写入索引", "server"],
  ["address", "地址", "pin"],
  ["subject", "主体识别", "subject"],
  ["style", "摄影风格", "style"],
  ["topic", "摄影主题", "topic"],
  ["faces", "人脸", "face"],
  ["score", "技术评分", "score"],
  ["aesthetic", "美学评分", "score"],
];
const statusLabels = {
  running: "处理中",
  done: "完成",
  skipped: "无数据 / 未启用",
  pending: "等待",
  failed: "失败",
  unsupported: "待适配",
  ready: "完成",
};
const bytes = (n) =>
  n == null
    ? "—"
    : n < 1048576
      ? (n / 1024).toFixed(0) + " KiB"
      : (n / 1048576).toFixed(1) + " MiB";
function itemSteps(file) {
  if (file?.metadata_only) return [["publish", "文件索引", "server"]];
  const steps = file?.steps || {},
    video = file?.kind === "video_candidate";
  return [
    ["download", "原图", "download"],
    ...processingSteps.filter(([id]) =>
      id === "aesthetic" && !file?.aesthetics_enabled && !steps[id] ? false :
      (id === "style" || id === "topic") && !file?.photography_enabled && !steps[id]
        ? false
        : id === "frame" || id === "playback"
        ? video
        : id === "compatible"
          ? Boolean(steps.compatible) ||
            /\.(heic|heif|hif)$/i.test(file?.path || "")
          : true,
    ),
  ];
}
function targetPercent(file) {
  if (file.completed) return 100;
  const items = itemSteps(file),
    steps = file.steps || {};
  let amount = items.filter(([id]) =>
    ["done", "skipped"].includes(steps[id]),
  ).length;
  if (steps.download === "running" && file.bytes_total)
    amount += Math.min(1, file.bytes_done / file.bytes_total);
  return Math.min(99, Math.floor((amount / items.length) * 100));
}
export function FileProcessing({
  media,
  workerOnline,
  onCompleted,
  onCurrent,
}) {
  const machine = useRef({
      current: null,
      queue: [],
      seen: new Set(),
      finished: new Set(),
      active: [],
      paused: false,
    }),
    callback = useRef(onCompleted);
  const [frame, setFrame] = useState(null);
  callback.current = onCompleted;
  useEffect(() => {
    const m = machine.current;
    m.active = media?.active || [];
    m.paused = media?.paused;
    for (const event of media?.completion_events || []) {
      if (m.seen.has(event.completion_id)) continue;
      m.seen.add(event.completion_id);
      const key = event.asset_id + ":" + event.revision;
      const next = { ...event, key, completed: true };
      if (m.current?.key === key) {
        Object.assign(m.current, next);
        m.current.target = 100;
      } else if (!m.queue.some((x) => x.completion_id === event.completion_id))
        m.queue.push({ ...next, value: 0, target: 100 });
    }
    if (m.current && !m.current.completed) {
      const active = m.active.find(
        (a) => a.asset_id + ":" + a.revision === m.current.key,
      );
      if (active) {
        Object.assign(m.current, active);
        m.current.target = Math.max(m.current.target, targetPercent(active));
      }
      if (media?.errors?.some((a) => a.asset_id === m.current.asset_id))
        m.current.failed = true;
    }
  }, [media]);
  useEffect(() => {
    let timer,
      stopped = false;
    const tick = () => {
      if (stopped) return;
      const m = machine.current;
      if (!m.current) {
        m.current = m.queue.shift() || null;
        if (!m.current) {
          const active = m.active.find(
            (a) => !m.finished.has(a.asset_id + ":" + a.revision),
          );
          if (active)
            m.current = {
              ...active,
              key: active.asset_id + ":" + active.revision,
              value: 0,
              target: targetPercent(active),
            };
        }
        if (m.current) {
          setFrame({ ...m.current });
          timer = setTimeout(tick, 20);
          return;
        }
      }
      const cur = m.current;
      if (cur) {
        if (cur.value < cur.target) {
          cur.value =
            cur.metadata_only ||
            matchMedia("(prefers-reduced-motion: reduce)").matches
              ? cur.target
              : cur.value + 1;
          setFrame({ ...cur });
        }
        if ((cur.completed && cur.value === 100) || cur.failed) {
          cur.finishedAt ??= performance.now();
          if (performance.now() - cur.finishedAt >= 90) {
            if (cur.completed) callback.current?.(cur);
            m.finished.add(cur.key);
            m.current = null;
          }
        }
      }
      timer = setTimeout(tick, m.queue.length > 2 ? 4 : 8);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    onCurrent?.(frame);
  }, [frame?.asset_id, frame?.revision, media]);
  const current = frame,
    items = itemSteps(current || {aesthetics_enabled:media?.aesthetics_enabled,photography_enabled:media?.photography_enabled}),
    steps = current?.steps || {};
  const count = items.filter(
    ([id], i) =>
      ["done", "skipped"].includes(steps[id]) &&
      (current?.value || 0) >= ((i + 1) / items.length) * 100 - 1,
  ).length;
  const live = media?.active?.[0];
  const directory = live?.path?.slice(0, live.path.lastIndexOf("/"));
  return (
    <div className="file-processing">
      <div className="processing-transfer-label">
        <span>
          <Icon name="metadata" />
          单图进度
        </span>
        <span>
          {current
            ? `${current.value}% · ${count} / ${items.length}`
            : media?.paused
              ? "已暂停"
              : workerOnline
                ? "等待文件"
                : "进程离线"}
        </span>
      </div>
      <svg
        className="directory-segments"
        viewBox="0 0 120 12"
        preserveAspectRatio="none"
        role="img"
        aria-label={`单图全部子任务 ${current?.value || 0}%`}
      >
        {Array.from({ length: 100 }, (_, i) => (
          <rect
            key={i}
            x={i * 1.2}
            y="0"
            width=".7"
            height="12"
            className={
              i < (current?.value || 0) ? "segment-done" : "segment-wait"
            }
          />
        ))}
      </svg>
      <div className="processing-current">
        <Icon name="photo" />
        <span title={current?.path}>
          {current?.path?.split("/").pop() || "—"}
        </span>
        {current?.completed && (
          <small>{current.metadata_only ? "仅索引" : "完成"}</small>
        )}
        {current?.failed && <small>需处理</small>}
        {media?.paused && <small>暂停中</small>}
      </div>
      <div className="processing-subitems" aria-label="当前文件子任务">
        {items.map(([id, label, icon], i) => {
          const lit =
            ["done", "skipped"].includes(steps[id]) &&
            (current?.value || 0) >= ((i + 1) / items.length) * 100 - 1;
          const state = lit
            ? "done"
            : steps[id] === "running"
              ? "running"
              : "pending";
          const description = lit
            ? steps[id] === "skipped"
              ? "已检查 · 无数据 / 未启用"
              : "完成"
            : statusLabels[steps[id]] || "等待";
          return (
            <span
              key={id}
              className={"subitem " + state}
              title={label + " · " + description}
              aria-label={label + " " + description}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </span>
          );
        })}
      </div>
      <div className="processing-directory" title={directory}>
        <Icon name="folder" />
        <span>{directory || "—"}</span>
        {live?.stage === "download" && (
          <small>
            {bytes(live.bytes_done)} / {bytes(live.bytes_total)}
          </small>
        )}
      </div>
    </div>
  );
}
export function RecentStrip({ items = [] }) {
  const root = useRef(null),
    positions = useRef(new Map()),
    previewRef = useRef(null),
    trigger = useRef(null);
  const [preview, setPreview] = useState(null),
    [pinned, setPinned] = useState(false),
    [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  const close = () => {
    setPreview(null);
    setPinned(false);
  };
  useLayoutEffect(() => {
    const next = new Map();
    for (const node of root.current?.querySelectorAll("[data-recent-key]") ||
      []) {
      const key = node.dataset.recentKey,
        x = node.getBoundingClientRect().left,
        old = positions.current.get(key);
      next.set(key, x);
      if (
        !matchMedia("(prefers-reduced-motion: reduce)").matches &&
        positions.current.size
      ) {
        const shift =
          old === undefined
            ? root.current.getBoundingClientRect().right - x
            : old - x;
        if (shift)
          node.animate(
            [
              {
                transform: `translateX(${shift}px)`,
                opacity: old === undefined ? 0 : 1,
              },
              { transform: "translateX(0)", opacity: 1 },
            ],
            { duration: 650, easing: "cubic-bezier(.18,.8,.22,1)" },
          );
      }
    }
    positions.current = next;
  }, [items.map((a) => a.id + ":" + a.revision).join("|")]);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [preview?.id, preview?.revision]);
  useEffect(() => {
    if (!preview) return;
    const escape = (e) => {
      if (e.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    const outside = (e) => {
      if (
        pinned &&
        !previewRef.current?.contains(e.target) &&
        !root.current?.contains(e.target)
      )
        close();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [preview, pinned]);
  const show = (a, event, pin = false) => {
    trigger.current = event.currentTarget;
    setPreview(a);
    if (pin) setPinned(true);
  };
  return (
    <>
      <section
        className="recent-strip"
        aria-label="最近处理成功的 20 张照片和视频"
        ref={root}
        onMouseLeave={() => {
          if (!pinned) close();
        }}
      >
        {Array.from({ length: Math.max(0, 20 - items.length) }, (_, i) => (
          <span className="recent-empty" key={"empty" + i} aria-hidden="true" />
        ))}
        {items.map((a) => (
          <button
            key={a.id + ":" + a.revision}
            data-recent-key={a.id + ":" + a.revision}
            className="recent-item"
            aria-label={"预览 " + a.name}
            onMouseEnter={(e) => {
              if (!pinned) show(a, e);
            }}
            onFocus={(e) => {
              if (!pinned) show(a, e);
            }}
            onBlur={() => {
              if (!pinned) close();
            }}
            onClick={(e) => show(a, e, true)}
          >
            <PreviewImage src={a.thumbnail} alt="" />
            {a.kind === "video_candidate" && <Icon name="video" />}
          </button>
        ))}
      </section>
      {preview && (
        <aside
          className="recent-preview"
          ref={previewRef}
          aria-label={"4K 预览 " + preview.name}
          role={pinned ? "dialog" : "region"}
        >
          <div className="recent-preview-image">
            <PreviewImage
              className="recent-preview-placeholder"
              src={preview.thumbnail}
              alt=""
            />
            <PreviewImage
              key={preview.id + preview.revision}
              className={loaded ? "recent-4k loaded" : "recent-4k"}
              src={preview.preview}
              alt={preview.name}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
            {(!loaded || failed) && (
              <span className={'recent-preview-state'+(!failed?' is-loading':'')}>
                {failed ? <MediaStatus failed>4K 暂不可用</MediaStatus> : <PhotoLoading size="small" label="读取 4K"/>}
              </span>
            )}
          </div>
          <div className="recent-preview-caption">
            <span>{preview.name}</span>
            <small>4K · SDR</small>
            {pinned && (
              <button
                onClick={() => {
                  close();
                  trigger.current?.focus();
                }}
                aria-label="关闭 4K 预览"
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
