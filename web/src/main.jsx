import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const labels = {
  queued: "等待开始",
  running: "正在刮削",
  paused: "已暂停",
  blocked: "需要处理",
  completed: "已完成",
  cancelled: "已取消",
};
const errors = {
  credentials_or_permission: "NAS 拒绝访问，请检查用户名、密码及目录权限。",
  network_unavailable: "暂时无法连接 NAS，可恢复后重试。",
  tls_verification_failed: "HTTPS 证书未通过验证，请修复证书或提供受信 CA。",
  partial_listing: "目录只返回了部分结果，本次未提交，也未标记缺失。",
  redirect_refused: "NAS 返回重定向，请直接填写最终服务地址。",
};
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: data !== undefined ? { "Content-Type": "application/json" } : {},
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const value = await r.json();
  if (!r.ok) {
    const e = new Error(
      errors[value.detail] ||
        (typeof value.detail === "string" ? value.detail : "输入格式不正确"),
    );
    e.status = r.status;
    throw e;
  }
  return value;
}
function App() {
  const [initialized, setInitialized] = useState(null),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [browse, setBrowse] = useState({}),
    [assets, setAssets] = useState([]),
    [sourceForm, setSourceForm] = useState(false);
  async function refresh() {
    try {
      setState(await api("/state"));
      setAssets((await api("/assets")).items);
    } catch (e) {
      if (e.status === 401) setState(null);
      else setError(e.message);
    }
  }
  useEffect(() => {
    api("/bootstrap").then((v) => setInitialized(v.initialized));
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, []);
  async function act(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function login(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = new FormData(form).get("password");
    act(async () => {
      await api(initialized ? "/login" : "/setup", "POST", { password });
      form.reset();
      setInitialized(true);
    });
  }
  async function saveSource(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = Object.fromEntries(f);
    body.allow_http = f.get("allow_http") === "on";
    body.ca_pem = body.ca_pem || null;
    await act(async () => {
      await api("/sources", "POST", body);
      form.reset();
      setSourceForm(false);
      setNotice("连接资料已保存。现在可以测试连接并选择活动。");
    });
  }
  return (
    <main>
      <header>
        <a className="wordmark" href="/">
          PHOTO
          <br />
          MUSEUM<span>人生照片集</span>
        </a>
        <div className="edition">
          馆务室 <span>01 / COLLECTION</span>
        </div>
        {state && (
          <button
            className="quiet"
            onClick={() =>
              act(async () => {
                await api("/logout", "POST", {});
                setState(null);
              })
            }
          >
            锁馆
          </button>
        )}
      </header>
      {error && (
        <div role="alert" className="message error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="message">
          {notice}
        </div>
      )}
      {!state ? (
        <section className="entrance">
          <div className="eyebrow">THE KEEPER'S ROOM</div>
          <h1>
            {initialized === false ? "为记忆，留一把钥匙。" : "欢迎回来。"}
          </h1>
          <p>从这里连接照片库，让每一段生活都有迹可循。</p>
          <form onSubmit={login}>
            <label>
              {initialized === false ? "设置馆主密码" : "馆主密码"}
              <input
                name="password"
                type="password"
                autoComplete={initialized ? "current-password" : "new-password"}
                minLength={initialized ? 1 : 12}
                maxLength="256"
                required
                autoFocus
                placeholder={initialized ? "输入密码" : "至少 12 个字符"}
              />
            </label>
            <button disabled={busy || initialized === null}>
              {initialized === false ? "创建并进入" : "进入馆务室"}{" "}
              <span>↗</span>
            </button>
          </form>
          <small>不需要用户名 · 密码仅保存在本机服务中</small>
        </section>
      ) : (
        <>
          <section className="intro">
            <div>
              <div className="eyebrow">COLLECTION / 管理照片源</div>
              <h1>
                生活的底稿，
                <br />
                正在归档。
              </h1>
            </div>
            <div className="metric">
              <strong>{state.asset_count.toLocaleString()}</strong>
              <span>已索引成片与视频</span>
              <small className={state.worker_online ? "online" : "offline"}>
                {state.worker_online ? "● 刮削进程在线" : "○ 刮削进程尚未连接"}
              </small>
            </div>
          </section>
          <section className="section">
            <div className="section-title">
              <h2>
                <em>01</em> 照片源
              </h2>
              <button
                className="quiet"
                onClick={() => setSourceForm(!sourceForm)}
              >
                ＋ 连接照片源
              </button>
            </div>
            {(sourceForm || !state.sources.length) && (
              <form className="source-form" onSubmit={saveSource}>
                <label>
                  名称
                  <input name="name" defaultValue="Farmer" required />
                </label>
                <label>
                  WebDAV 地址
                  <input
                    name="url"
                    type="url"
                    defaultValue="https://Farmer.local:5006"
                    required
                  />
                </label>
                <label>
                  照片根目录
                  <input name="root" defaultValue="/工程/拍照片" required />
                </label>
                <label>
                  NAS 用户名
                  <input
                    name="username"
                    defaultValue="pulsar"
                    autoComplete="off"
                    required
                  />
                </label>
                <label>
                  NAS 密码
                  <input
                    name="password"
                    type="password"
                    autoComplete="off"
                    required
                  />
                </label>
                <label>
                  受信 CA（HTTPS，可选）
                  <textarea name="ca_pem" placeholder="PEM 格式证书" rows="2" />
                </label>
                <label className="check">
                  <input name="allow_http" type="checkbox" />
                  允许明文 HTTP（仅限可信内网）
                </label>
                <div>
                  <button disabled={busy}>保存连接</button>
                  <small>
                    照片源只读。NAS 密码加密保存在此服务器，不会回显。
                  </small>
                </div>
              </form>
            )}
            {state.sources.map((s) => (
              <article className="source" key={s.id}>
                <div className="source-head">
                  <div>
                    <h3>{s.name}</h3>
                    <p>
                      {s.url} · {s.root}
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        setBrowse((b) => ({ ...b, [s.id]: null }));
                        const r = await api("/sources/" + s.id + "/browse");
                        setBrowse((b) => ({ ...b, [s.id]: r }));
                        setNotice("连接成功。选择一个活动开始验证。");
                      })
                    }
                  >
                    测试连接 / 选择活动
                  </button>
                </div>
                <details>
                  <summary>更新 NAS 密码或受信 CA</summary>
                  <form
                    className="credentials"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = new FormData(form);
                      act(async () => {
                        await api("/sources/" + s.id + "/credentials", "PUT", {
                          password: f.get("password"),
                          ca_pem: f.get("ca_pem") || null,
                        });
                        form.reset();
                        setNotice("凭据已更新，可恢复需要处理的任务。");
                      });
                    }}
                  >
                    <label>
                      新 NAS 密码
                      <input name="password" type="password" required />
                    </label>
                    <label>
                      CA（可选）
                      <textarea name="ca_pem" />
                    </label>
                    <button disabled={busy}>更新凭据</button>
                  </form>
                </details>
                {browse[s.id] && (
                  <form
                    className="scan-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const root = new FormData(e.currentTarget).get("root");
                      act(async () => {
                        await api("/jobs", "POST", { source_id: s.id, root });
                        setNotice("任务已加入队列。关闭网页不会中断刮削。");
                      });
                    }}
                  >
                    <label>
                      扫描范围
                      <select name="root">
                        {browse[s.id].directories.map((d) => (
                          <option key={d.path} value={d.path}>
                            {d.name}
                          </option>
                        ))}
                        <option value={s.root}>
                          整个照片根目录（含全部活动）
                        </option>
                      </select>
                    </label>
                    <button disabled={busy}>开始刮削</button>
                    <small>
                      每次重新枚举所选范围，发现新增与变更；不下载全库原图。
                    </small>
                  </form>
                )}
              </article>
            ))}
          </section>
          <section className="section">
            <div className="section-title">
              <h2>
                <em>02</em> 刮削任务
              </h2>
              <span>完成目录会持久保存</span>
            </div>
            {!state.jobs.length && (
              <p className="empty">选择一段生活，开始第一次归档。</p>
            )}
            {state.jobs.map((j) => (
              <article className="job" key={j.id}>
                <div>
                  <span className={"status " + j.status}>
                    {labels[j.status]}
                  </span>
                  <h3>{j.root.split("/").pop()}</h3>
                  <p>
                    {j.done_dirs} / {j.total_dirs} 个已发现目录 · 本次{" "}
                    {j.files_seen} 个成片与视频
                  </p>
                  {j.error && (
                    <small className="error-text">
                      {errors[j.error] || j.error}
                    </small>
                  )}
                  {j.status === "paused" && j.active_dirs > 0 && (
                    <small>
                      已暂停，正在结束当前网络读取；此目录恢复后会重新扫描。
                    </small>
                  )}
                </div>
                <div className="actions">
                  {["queued", "running"].includes(j.status) && (
                    <button
                      className="quiet"
                      onClick={() =>
                        act(() => api("/jobs/" + j.id + "/pause", "POST", {}))
                      }
                    >
                      暂停
                    </button>
                  )}
                  {["paused", "blocked"].includes(j.status) && (
                    <button
                      onClick={() =>
                        act(() => api("/jobs/" + j.id + "/resume", "POST", {}))
                      }
                    >
                      恢复
                    </button>
                  )}
                  {!["completed", "cancelled"].includes(j.status) && (
                    <button
                      className="quiet"
                      onClick={() =>
                        act(() => api("/jobs/" + j.id + "/cancel", "POST", {}))
                      }
                    >
                      取消
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="section">
            <div className="section-title">
              <h2>
                <em>03</em> 最近索引
              </h2>
              <span>展示前 50 项 · P1 文件级索引</span>
            </div>
            {assets.map((a) => (
              <div className="asset" key={a.id}>
                <span>{a.kind === "video_candidate" ? "▶" : "▧"}</span>
                <div>
                  <strong>{a.path.split("/").pop()}</strong>
                  <small>
                    {a.event.theme} ·{" "}
                    {a.version_quality === "strong_etag"
                      ? "强版本校验"
                      : "大小 / 时间辅助校验"}
                  </small>
                </div>
                <span>
                  {a.size === null
                    ? "未知大小"
                    : (a.size / 1048576).toFixed(1) + " MB"}
                </span>
                <a
                  className="original-link"
                  href={
                    "/api/assets/" + a.id + "/original?revision=" + a.revision
                  }
                  target="_blank"
                  rel="noopener"
                >
                  查看原文件 ↗
                </a>
              </div>
            ))}
            {!assets.length && (
              <p className="empty">刮削完成后，成片会在这里出现。</p>
            )}
          </section>
          <footer>
            PHOTO MUSEUM{" "}
            <span>
              P1 · 目录任务与文件索引。EXIF、4K 缓存和正式观展在 P2 接入。
            </span>
          </footer>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
