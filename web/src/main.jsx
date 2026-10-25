import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./style.css";
import { Icon } from "./icons";
import { Gallery } from "./gallery";
import { Manager } from "./manager";
import { Curator } from './curator';
import { Settings } from './settings';
import { PreferencesProvider } from './preferences';
import { watchAutoUnlock } from "./auto-unlock";
import './title-typography.css';
import './museum-nav.css';
const errors = {
  credentials_or_permission: "NAS 拒绝访问，请检查凭据与目录权限。",
  network_unavailable: "暂时无法连接 NAS。",
  tls_verification_failed: "HTTPS 证书未通过验证，请提供受信 CA。",
  partial_listing: "目录返回不完整，本次未提交，也未标记缺失。",
};
async function api(path, method = "GET", data, options = {}) {
  const r = await fetch("/api" + path, {
    method,
    signal: options.signal,
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
    [busy, setBusy] = useState(false),
    [autoUnlockAllowed, setAutoUnlockAllowed] = useState(true),
    [route, setRoute] = useState(location.hash);
  const passwordInput = useRef(null), loginPending = useRef(false);
  useEffect(() => {
    if (initialized !== true || state || !autoUnlockAllowed || !passwordInput.current) return;
    return watchAutoUnlock(passwordInput.current, () => !loginPending.current);
  }, [initialized, Boolean(state), autoUnlockAllowed]);
  async function refresh() {
    try {
      setState(await api("/state"));
    } catch (e) {
      if (e.status === 401) setState(null);
      else setError(e.message);
    }
  }
  useEffect(() => {
    api("/bootstrap")
      .then((v) => setInitialized(v.initialized))
      .catch((e) => setError(e.message));
    refresh();
    const t = setInterval(refresh, 2500);
    const f = () => setRoute(location.hash);
    window.addEventListener("hashchange", f);
    return () => {
      clearInterval(t);
      window.removeEventListener("hashchange", f);
    };
  }, []);
  async function logout() {
    try {
      await api("/logout", "POST", {});
      setAutoUnlockAllowed(false);
      setState(null);
    } catch (e) {
      setError(e.message);
    }
  }
  async function login(e) {
    e.preventDefault();
    if (loginPending.current || initialized === null) return;
    loginPending.current = true;
    setBusy(true);
    setError("");
    const form = e.currentTarget;
    try {
      await api(initialized ? "/login" : "/setup", "POST", {
        password: new FormData(form).get("password"),
      });
      form.reset();
      setInitialized(true);
      setAutoUnlockAllowed(true);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      loginPending.current = false;
      setBusy(false);
    }
  }
  if (state)
    return <PreferencesProvider api={api}>{route === "#manage" ? (
      <Manager api={api} state={state} refresh={refresh} onLogout={logout} />
    ) : route.startsWith('#settings') ? <Settings api={api} onLogout={logout}/> : route.startsWith('#curator') ? <Curator api={api} onLogout={logout}/> : (
      <Gallery
        key={new URLSearchParams(route.split('?')[1]).get('exhibit') || 'library'}
        exhibitionId={new URLSearchParams(route.split('?')[1]).get('exhibit')}
        roomHint={new URLSearchParams(route.split('?')[1]).get('room')}
        api={api}
        onAdmin={() => (location.hash = "manage")}
        onLogout={logout}
      />
    )}</PreferencesProvider>;
  return (
    <main>
      <section className="entrance">
        <Icon name="lock" className="entrance-icon" />
        {error && (
          <div role="alert" className="message error">
            {error}
          </div>
        )}
        <form onSubmit={login}>
          <label>
            {initialized === false ? "设置馆主密码" : "馆主密码"}
            <input
              ref={passwordInput}
              name="password"
              type="password"
              autoComplete={initialized === false ? "new-password" : "current-password"}
              minLength={initialized ? 1 : 12}
              maxLength="256"
              required
              autoFocus
              placeholder={initialized ? "输入密码" : "至少 12 个字符"}
            />
          </label>
          <button disabled={busy || initialized === null}>
            {initialized === false ? "创建并进入" : "解锁"}{" "}
            <span>↗</span>
          </button>
        </form>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
