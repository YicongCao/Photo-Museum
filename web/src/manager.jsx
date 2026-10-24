import React, { useEffect, useRef, useState } from "react";
import { Icon, statusIcon } from "./icons";
import { FileProcessing, RecentStrip } from "./processing";
import { CurrentInspection } from "./inspection";
import { Intelligence } from "./intelligence";
import "./manager.css";
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
};
const errorNames = {
  media_DecompressionBombError: "图像尺寸超过安全上限",
  pq_or_hlg_transfer: "HDR 传递函数待适配",
  unknown_color_profile: "缺少色域标记",
  unknown_video_color: "视频色域待适配",
  hdr_metadata_requires_sdr_base_or_tonemap_validation: "HDR 编码待适配",
  codec_timeout: "转码超时",
  network_unavailable: "NAS 连接中断",
  source_exceeds_2gib_limit: "原文件超过 2 GiB",
  cache_budget_exceeded: "缓存空间不足",
};
const fmt = (n) => Number(n || 0).toLocaleString();
export function Manager({ api, state, refresh, onLogout }) {
  const [media, setMedia] = useState(null),
    [tab, setTab] = useState("directories"),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false),
    [browse, setBrowse] = useState({}),
    [assets, setAssets] = useState([]),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [sourceForm, setSourceForm] = useState(false);
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
    polling = useRef(false);
  const [directories, setDirectories] = useState([]),
    [currentDirectory, setCurrentDirectory] = useState(null),
    [recent, setRecent] = useState(null);
  const poll = async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const [m, d] = await Promise.all([
        api(
          "/media/state" +
            (cursor.current === null ? "" : "?after=" + cursor.current),
        ),
        api("/media/directories"),
      ]);
      cursor.current = m.completion_cursor;
      setMedia(m);
      setDirectories(d.items);
      setCurrentDirectory(d.current);
      setRecent((r) => (r === null ? m.recent : r));
    } catch (e) {
      setError(e.message);
    } finally {
      polling.current = false;
    }
  };
  const completed = (item) =>
    item.thumbnail &&
    setRecent((rows) =>
      [...(rows || []).filter((a) => a.id !== item.id), item].slice(-20),
    );
  useEffect(() => {
    poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
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
  const running = Boolean(
    media?.active?.length ||
      state.jobs.some((j) => ["running", "queued"].includes(j.status)),
  );
  return (
    <div className="keeper-shell">
      <header className="keeper-header">
        <a href="#gallery">PHOTO MUSEUM</a>
        <nav>
          <button onClick={() => setSettings(true)}>照片源</button>
          <button
            className="mobile-source"
            onClick={() => setInspectOpen(true)}
          >
            当前照片
          </button>
          <span>
            <Icon name="server" /> 馆务室
          </span>
          <a href="#gallery">返回 Gallery ↗</a>
          <button onClick={onLogout} aria-label="锁馆">
            <Icon name="lock" />
          </button>
        </nav>
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
              <Icon
                name={media?.paused ? "pause" : running ? "clock" : "check"}
              />
              <span>
                <small>任务状态</small>
                <strong className="keeper-state">
                  {loading
                    ? "读取中"
                    : media?.paused
                      ? "媒体已暂停"
                      : running
                        ? "任务进行中"
                        : mediaTotal >
                            (media?.fully_done || 0) + (media?.error_count || 0)
                          ? "等待处理"
                          : "空闲"}
                </strong>
              </span>
            </div>
          </div>
          {error && (
            <div role="alert" className="keeper-alert">
              {error}
              <button onClick={() => setError("")} aria-label="关闭提示">
                ×
              </button>
            </div>
          )}
          <section className="keeper-progress" aria-label="刮削进度">
            <div
              className="keeper-ring"
              title="目录枚举完成，且直属文件全部完成处理、没有错误；无直属文件的目录也计入完成。"
            >
              <svg
                viewBox="0 0 120 120"
                role="img"
                aria-label={`已完成处理目录 ${done} / ${total}`}
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
                  {done} <i>/ {total}</i>
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
                            <img
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
                          <small className="error-text">{j.error}</small>
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
                          {errorNames[e.error] || e.error}
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
      {settings && (
        <div
          className="keeper-modal"
          role="dialog"
          aria-modal="true"
          aria-label="照片源设置"
          onKeyDown={(e) => {
            if (e.key === "Escape") setSettings(false);
          }}
        >
          <div className="settings-card">
            <div className="side-title">
              <h2>照片源设置</h2>
              <button
                autoFocus
                onClick={() => setSettings(false)}
                aria-label="关闭设置"
              >
                ✕
              </button>
            </div>
            <div className="settings-scroll">
              {error && <p role="alert">{error}</p>}
              {state.sources.map((s) => (
                <section className="source-setting" key={s.id}>
                  <h3>{s.name}</h3>
                  <p>
                    {s.url} · {s.root}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const b = await api("/sources/" + s.id + "/browse");
                        setBrowse((v) => ({ ...v, [s.id]: b.directories }));
                      })
                    }
                  >
                    测试连接 / 选择活动
                  </button>
                  {browse[s.id] && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const root = new FormData(e.currentTarget).get("root");
                        act(async () => {
                          await api("/jobs", "POST", { source_id: s.id, root });
                          setSettings(false);
                        });
                      }}
                    >
                      <label>
                        扫描范围
                        <select name="root">
                          <option value={s.root}>整个照片库（增量核对）</option>
                          {browse[s.id].map((d) => (
                            <option key={d.path} value={d.path}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button disabled={busy}>开始刮削</button>
                    </form>
                  )}
                  <details>
                    <summary>更新 NAS 密码或受信 CA</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = e.currentTarget;
                        const data = new FormData(f);
                        act(async () => {
                          await api(
                            "/sources/" + s.id + "/credentials",
                            "PUT",
                            {
                              password: data.get("password"),
                              ca_pem: data.get("ca_pem") || null,
                            },
                          );
                          f.reset();
                        });
                      }}
                    >
                      <label>
                        NAS 密码
                        <input
                          name="password"
                          type="password"
                          required
                          autoComplete="new-password"
                        />
                      </label>
                      <label>
                        受信 CA（PEM，可选）
                        <textarea name="ca_pem" />
                      </label>
                      <button>更新凭据</button>
                    </form>
                  </details>
                </section>
              ))}
              <button
                className="quiet"
                onClick={() => setSourceForm(!sourceForm)}
              >
                ＋ 连接照片源
              </button>
              {(sourceForm || !state.sources.length) && (
                <form
                  className="source-create"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    const values = new FormData(f);
                    const body = Object.fromEntries(values);
                    body.allow_http = values.get("allow_http") === "on";
                    body.ca_pem = body.ca_pem || null;
                    act(async () => {
                      await api("/sources", "POST", body);
                      f.reset();
                      setSourceForm(false);
                    });
                  }}
                >
                  {[
                    ["name", "名称", "Farmer"],
                    ["url", "WebDAV 地址", "https://Farmer.local:5006"],
                    ["root", "照片根目录", "/工程/拍照片"],
                    ["username", "NAS 用户名", "pulsar"],
                    ["password", "NAS 密码", ""],
                  ].map(([name, title, value]) => (
                    <label key={name}>
                      {title}
                      <input
                        name={name}
                        defaultValue={value}
                        type={name === "password" ? "password" : "text"}
                        required
                      />
                    </label>
                  ))}
                  <label>
                    受信 CA（PEM，可选）
                    <textarea name="ca_pem" />
                  </label>
                  <label className="check">
                    <input name="allow_http" type="checkbox" />
                    允许本次内网 HTTP 明文连接
                  </label>
                  <button disabled={busy}>保存连接</button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
