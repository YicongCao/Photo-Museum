import {adaptivePoll} from './adaptive-poll.mjs';
import {PreviewImage} from './preview-image';
import React, { useEffect, useRef, useState } from "react";
import { Icon, statusIcon } from "./icons";
import { FileProcessing, RecentStrip } from "./processing";
import { CurrentInspection } from "./inspection";
import { Intelligence } from "./intelligence";
import "./manager.css";
import {MuseumNav} from "./museum-nav";
import {StatusNotice} from "./system-status";
import {failureText} from "./status-text";
import { taskStatus } from "./task-status.mjs";
const labels = {
  queued: "等待开始",
  running: "进行中",
  paused: "已暂停",
  blocked: "需要处理",
  completed: "枚举完成",
  cancelled: "已取消",
  ready: "已就绪",
  pending: "等待处理",
  failed: "处理失败",
  unsupported: "待适配",
};
const stageNames = {
  download: "取回文件",
  metadata: "读取 EXIF",
  cache: "生成预览",
  publish: "发布藏品",
  analysis: "本地分析",
  photography: "摄影风格 / 主题",
  aesthetics: "美学评分",
};
const fmt = (n) => Number(n || 0).toLocaleString();
export function Manager({ api, state, refresh, onLogout }) {
  const [media, setMedia] = useState(null),
    [tab, setTab] = useState("directories"),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [pollError, setPollError] = useState(""),
    [updatedAt, setUpdatedAt] = useState(null),
    [directoryError, setDirectoryError] = useState(""),
    [directoryLoaded, setDirectoryLoaded] = useState(false),
    [assets, setAssets] = useState([]),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(null),
    [inspectOpen, setInspectOpen] = useState(false);
  const [wide, setWide] = useState(
    () => matchMedia("(min-width: 901px)").matches,
  );
  useEffect(() => {
    const q = matchMedia("(min-width: 901px)");
    const change = () => setWide(q.matches);
    q.addEventListener("change", change);
    return () => q.removeEventListener("change", change);
  }, []);
  const cursor = useRef(null),
    polling = useRef(false),
    request = useRef(null),
    mounted = useRef(true), signatures=useRef({});
  const [directories, setDirectories] = useState([]),
    [currentDirectory, setCurrentDirectory] = useState(null),
    [recent, setRecent] = useState(null);
  const poll = async () => {
    if (polling.current) return;
    polling.current = true;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    const message = (e) => controller.signal.aborted ? "请求超时" : e.message;
    let changed=false,active=false;
    try {
      await Promise.allSettled([
        api("/media/state" + (cursor.current === null ? "" : "?after=" + cursor.current), "GET", undefined, { signal: controller.signal })
          .then((m) => {
            if (!mounted.current) return;
            cursor.current = m.completion_cursor;
            const signature=JSON.stringify(m);changed ||= signature!==signatures.current.media;
            if(signature!==signatures.current.media)setMedia(m);signatures.current.media=signature;
            active=!!m.active?.length||!!m.completion_events?.length;
            setPollError(""); setUpdatedAt(new Date());
            setRecent((r) => r === null ? m.recent : r);
          }).catch((e) => { if (mounted.current) setPollError(message(e)); }),
        api("/media/directories", "GET", undefined, { signal: controller.signal })
          .then((d) => {
            if (!mounted.current) return;
            const signature=JSON.stringify(d);changed ||= signature!==signatures.current.directories;
            if(signature!==signatures.current.directories){setDirectories(d.items);setCurrentDirectory(d.current)}signatures.current.directories=signature;
            setDirectoryLoaded(true); setDirectoryError("");
          }).catch((e) => { if (mounted.current) setDirectoryError(message(e)); }),
      ]);
      return changed||active;
    } finally {
      clearTimeout(timeout); polling.current = false;
    }
  };
  const completed = (item) =>
    item.thumbnail &&
    setRecent((rows) =>
      [...(rows || []).filter((a) => a.id !== item.id), item].slice(-20),
    );
  useEffect(() => {
    mounted.current = true;
    const scheduler = adaptivePoll(poll,{base:2500,max:30000});
    return () => { mounted.current = false; scheduler.stop(); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (tab === "assets")
      api("/assets?offset=" + offset)
        .then((d) => setAssets(d.items))
        .catch((e) => setError(e.message));
  }, [tab, offset]);
  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await Promise.all([refresh(), poll()]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const control = (action) =>
    act(() => api("/media/control", "POST", { action }));
  const total = directories.length,
    done = directories.filter(
      (d) => d.state === "done" && d.done === d.total && !d.errors && !d.error,
    ).length;
  const counts = media?.counts || {},
    mediaTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  const jobs = state.jobs.filter(
    (j) =>
      filter === "all" ||
      (filter === "active"
        ? ["running", "queued"].includes(j.status)
        : j.status === filter),
  );
  const loading = media === null;
  const status = taskStatus(media, state.jobs, pollError);
  return (
    <div className="keeper-shell">
      <header className="keeper-header">
        <a href="#gallery">PHOTO MUSEUM</a>
        <MuseumNav current="dashboard" onLogout={onLogout}/>
      </header>
      <div className="keeper-body">
        <div className="keeper-main">
          <div className="keeper-metrics">
            <div>
              <Icon name="photo" />
              <span>
                <small>完整处理文件</small>
                <strong>{loading ? "—" : fmt(media.fully_done)}</strong>
              </span>
            </div>
            <div>
              <Icon name="server" />
              <span>
                <small>待处理文件</small>
                <strong>
                  {loading
                    ? "—"
                    : fmt(
                        Math.max(
                          0,
                          mediaTotal -
                            media.fully_done -
                            (media.error_count || 0),
                        ),
                      )}
                </strong>
              </span>
            </div>
            <div>
              <Icon name={status.icon} />
              <span>
                <small>任务状态</small>
                <strong className="keeper-state" role="status">{status.text}</strong>
              </span>
            </div>
          </div>
          {(pollError || directoryError)&&<StatusNotice error={pollError||directoryError} scope={pollError?'刮削进度':'目录列表'} detail={updatedAt?`上次更新 ${updatedAt.toLocaleTimeString()} · 保留已有数据`:undefined} onRetry={poll}/>}
          {error&&<StatusNotice error={error} scope="刮削操作" onDismiss={()=>setError('')}/>}
          <section className="keeper-progress" aria-label="刮削进度">
            <div
              className="keeper-ring"
              title="目录枚举完成，且直属文件全部完成处理、没有错误；无直属文件的目录也计入完成。"
            >
              <svg
                viewBox="0 0 120 120"
                role="img"
                aria-label={directoryLoaded ? `已完成处理目录 ${done} / ${total}` : "正在加载目录进度"}
              >
                <circle cx="60" cy="60" r="52" className="ring-track" />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  className="ring-fill"
                  pathLength="100"
                  strokeDasharray={`${total ? (done / total) * 100 : 0} 100`}
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <div>
                <strong>
                  {directoryLoaded ? done : "—"} <i>/ {directoryLoaded ? total : "—"}</i>
                </strong>
                <small>已完成 / 已发现目录</small>
              </div>
            </div>
            <div className="keeper-bars">
              <FileProcessing
                media={media}
                workerOnline={state.worker_online}
                onCompleted={completed}
                onCurrent={setInspecting}
              />
            </div>
          </section>
          <section className="keeper-list-area">
            <div className="keeper-list-heading">
              <nav aria-label="馆务列表">
                <button
                  className={tab === "directories" ? "selected" : ""}
                  onClick={() => {
                    setTab("directories");
                    setFilter("all");
                  }}
                >
                  刮削目录
                </button>
                <button
                  className={tab === "jobs" ? "selected" : ""}
                  onClick={() => {
                    setTab("jobs");
                    setFilter("all");
                  }}
                >
                  扫描批次
                </button>
                <button
                  className={tab === "assets" ? "selected" : ""}
                  onClick={() => setTab("assets")}
                >
                  文件索引
                </button>
                <button
                  className={tab === "errors" ? "selected" : ""}
                  onClick={() => setTab("errors")}
                >
                  需处理 ({media?.error_count || 0})
                </button>
                <button
                  className={tab === "people" ? "selected" : ""}
                  onClick={() => setTab("people")}
                >
                  本地策展
                </button>
              </nav>
              <div className="keeper-queue-actions">
                <button className="mobile-source" onClick={() => setInspectOpen(true)}>当前照片</button>
                <button
                  onClick={() => control(media?.paused ? "resume" : "pause")}
                >
                  <Icon name={media?.paused ? "play" : "pause"} />
                  {media?.paused ? "恢复媒体处理" : "暂停媒体处理"}
                </button>
              </div>
            </div>
            {tab === "directories" && (
              <>
                {currentDirectory && (
                  <div className="keeper-current-directory">
                    <Icon name="folder" />
                    <span>
                      <small>当前目录</small>
                      <strong title={currentDirectory.path}>
                        {currentDirectory.relative_path}
                      </strong>
                    </span>
                    <div>
                      <small>
                        {currentDirectory.done} / {currentDirectory.total}
                        {currentDirectory.errors
                          ? " · 需处理 " + currentDirectory.errors
                          : ""}
                      </small>
                      <progress
                        value={currentDirectory.done}
                        max={currentDirectory.total || 1}
                      />
                    </div>
                  </div>
                )}
                <div className="keeper-filters">
                  {[
                    ["all", "全部"],
                    ["running", "进行中"],
                    ["pending", "待刮削"],
                    ["completed", "已完成"],
                    ["failed", "需处理"],
                  ].map(([id, title]) => (
                    <button
                      key={id}
                      className={filter === id ? "selected" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {title} (
                      {
                        directories.filter(
                          (d) => id === "all" || d.status === id,
                        ).length
                      }
                      )
                    </button>
                  ))}
                </div>
                <div className="task-table-header directory-table-header">
                  <span>目录</span>
                  <span>状态</span>
                  <span>完整处理 / 文件</span>
                </div>
                <div
                  className="keeper-scroll"
                  tabIndex="0"
                  aria-label="全部刮削目录列表"
                >
                  {directories
                    .filter((d) => filter === "all" || d.status === filter)
                    .map((d) => (
                      <article
                        className={
                          "keeper-directory " + (d.active ? "active" : "")
                        }
                        key={d.source_id + ":" + d.path}
                      >
                        <div className="directory-name">
                          <Icon name="folder" />
                          <span>
                            <strong title={d.path}>{d.relative_path}</strong>
                            {d.current_file && d.active && (
                              <small>{d.current_file.split("/").pop()}</small>
                            )}
                          </span>
                        </div>
                        <div className="job-state">
                          <Icon
                            name={
                              d.active
                                ? "pulse"
                                : d.status === "completed"
                                  ? "check"
                                  : d.status === "failed"
                                    ? "alert"
                                    : "clock"
                            }
                          />
                          {d.status === "completed"
                            ? d.total
                              ? "已完成"
                              : "无直属文件"
                            : d.status === "pending"
                              ? "待刮削"
                              : labels[d.status]}
                        </div>
                        <div className="job-progress">
                          <small>
                            {d.done} / {d.total}
                            {d.cached > d.done ? " · 缓存 " + d.cached : ""}
                          </small>
                          <progress
                            value={
                              d.total
                                ? d.done
                                : d.status === "completed"
                                  ? 1
                                  : 0
                            }
                            max={d.total || 1}
                          />
                        </div>
                      </article>
                    ))}
                </div>
              </>
            )}
            {tab === "jobs" && (
              <>
                <div className="keeper-filters">
                  {[
                    ["all", "全部"],
                    ["active", "进行中"],
                    ["paused", "已暂停"],
                    ["completed", "已完成"],
                    ["blocked", "等待重试"],
                  ].map(([id, title]) => (
                    <button
                      key={id}
                      className={filter === id ? "selected" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {title} (
                      {
                        state.jobs.filter(
                          (j) =>
                            id === "all" ||
                            (id === "active"
                              ? ["running", "queued"].includes(j.status)
                              : j.status === id),
                        ).length
                      }
                      )
                    </button>
                  ))}
                </div>
                <div className="task-table-header">
                  <span>相册 / 目录</span>
                  <span>状态</span>
                  <span>目录枚举</span>
                  <span>操作</span>
                </div>
                <div
                  className="keeper-scroll"
                  tabIndex="0"
                  aria-label="刮削任务列表"
                >
                  {jobs.map((j) => (
                    <article className="keeper-job" key={j.id}>
                      <div className="job-name">
                        <div className="job-cover">
                          <Icon name="folder" />
                          {j.cover && (
                            <PreviewImage
                              src={j.cover}
                              alt="活动封面"
                              loading="lazy"
                              onError={(e) =>
                                (e.currentTarget.style.visibility = "hidden")
                              }
                            />
                          )}
                        </div>
                        <span>
                          <strong>{j.root.split("/").pop()}</strong>
                          <small>{fmt(j.files_seen)} 个文件候选</small>
                        </span>
                      </div>
                      <div className="job-state">
                        <Icon name={statusIcon[j.status]} />
                        {labels[j.status]}
                      </div>
                      <div className="job-progress">
                        <small>
                          {j.done_dirs} / {j.total_dirs} 个目录
                        </small>
                        <progress value={j.done_dirs} max={j.total_dirs || 1} />
                        {j.error && (
                          <small className="error-text">{failureText(j.error)}</small>
                        )}
                      </div>
                      <div className="job-buttons">
                        {["queued", "running"].includes(j.status) && (
                          <button
                            onClick={() =>
                              act(() =>
                                api("/jobs/" + j.id + "/pause", "POST", {}),
                              )
                            }
                          >
                            <Icon name="pause" />
                            暂停
                          </button>
                        )}
                        {["paused", "blocked"].includes(j.status) && (
                          <button
                            onClick={() =>
                              act(() =>
                                api("/jobs/" + j.id + "/resume", "POST", {}),
                              )
                            }
                          >
                            <Icon name="play" />
                            恢复
                          </button>
                        )}
                        {["completed", "cancelled"].includes(j.status) ? (
                          <span>—</span>
                        ) : (
                          <button
                            onClick={() =>
                              act(() =>
                                api("/jobs/" + j.id + "/cancel", "POST", {}),
                              )
                            }
                            aria-label="取消任务"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                  {!jobs.length && <p className="empty">这里还没有任务。</p>}
                </div>
              </>
            )}
            {tab === "assets" && (
              <>
                <div className="file-pagination">
                  <span>
                    第 {offset + 1}–{offset + assets.length} 项
                  </span>
                  <button
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 50))}
                  >
                    上一页
                  </button>
                  <button
                    disabled={assets.length < 50}
                    onClick={() => setOffset(offset + 50)}
                  >
                    下一页
                  </button>
                </div>
                <div
                  className="keeper-scroll"
                  tabIndex="0"
                  aria-label="文件索引列表"
                >
                  {assets.map((a) => (
                    <article className="indexed-row" key={a.id}>
                      <Icon
                        name={a.kind === "video_candidate" ? "video" : "photo"}
                      />
                      <span>
                        <strong>{a.path.split("/").pop()}</strong>
                        <small>{a.event.theme}</small>
                      </span>
                      <small>
                        {a.size == null
                          ? "大小未知"
                          : (a.size / 1048576).toFixed(1) + " MB"}
                      </small>
                      <a
                        target="_blank"
                        rel="noopener"
                        href={
                          "/api/assets/" +
                          a.id +
                          "/original?revision=" +
                          a.revision
                        }
                      >
                        原文件 ↗
                      </a>
                    </article>
                  ))}
                </div>
              </>
            )}
            {tab === "errors" && (
              <>
                <div className="file-pagination">
                  <span>最多显示 100 项</span>
                  <button onClick={() => control("retry")}>
                    重试未完成文件
                  </button>
                </div>
                <div
                  className="keeper-scroll"
                  tabIndex="0"
                  aria-label="错误文件列表"
                >
                  {media?.errors.map((e) => (
                    <article className="indexed-row" key={e.asset_id}>
                      <Icon name="alert" />
                      <span>
                        <strong>{e.path.split("/").pop()}</strong>
                        <small>
                          {stageNames[e.stage]} ·{" "}
                          {failureText(e.error)}
                        </small>
                      </span>
                      <small>{labels[e.status]}</small>
                    </article>
                  ))}
                  {!media?.errors.length && (
                    <p className="empty">暂时没有需要处理的文件。</p>
                  )}
                </div>
              </>
            )}
            {tab === "people" && (
              <div
                className="keeper-scroll"
                tabIndex="0"
                aria-label="本地策展列表"
              >
                <Intelligence api={api} />
              </div>
            )}
          </section>
        </div>
        {(wide || inspectOpen) && (
          <aside
            className={
              "keeper-sidebar inspection-sidebar" +
              (inspectOpen ? " inspection-open" : "")
            }
          >
            <CurrentInspection
              key={inspecting?.asset_id + ":" + inspecting?.revision}
              file={inspecting}
              media={media}
              onClose={() => setInspectOpen(false)}
            />
          </aside>
        )}
      </div>
      <RecentStrip items={recent || []} />
    </div>
  );
}
