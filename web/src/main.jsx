import {adaptivePoll} from './adaptive-poll.mjs';
import {previews} from './preview-queue';
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
import './room-menu.css';
import {api} from './api';
import {StatusNotice,StatusPanel,ServiceHealthContext,MuseumBoundary} from './system-status';
import {failureInfo} from './status-text';
import './system-status.css';
function App() {
  const [initialized, setInitialized] = useState(null),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [pollError,setPollError]=useState(null),[checked,setChecked]=useState(false),[bootstrapError,setBootstrapError]=useState(null),
    [busy, setBusy] = useState(false),
    [autoUnlockAllowed, setAutoUnlockAllowed] = useState(true),
    [route, setRoute] = useState(location.hash);
  const passwordInput = useRef(null), loginPending = useRef(false), polling=useRef(false), stateRequest=useRef(null), sessionKnown=useRef(false), stateSignature=useRef(null);
  useEffect(() => {
    if (initialized !== true || state || !autoUnlockAllowed || !passwordInput.current) return;
    return watchAutoUnlock(passwordInput.current, () => !loginPending.current);
  }, [initialized, Boolean(state), autoUnlockAllowed, checked, Boolean(pollError)]);
  async function refresh(light=false) {
    light=light===true&&sessionKnown.current;
    if(polling.current)return;
    polling.current=true;const c=new AbortController();stateRequest.current=c;
    try {const value=await api(light?'/session':'/state','GET',undefined,{signal:c.signal});const signature=JSON.stringify(value),changed=!light&&signature!==stateSignature.current;if(!light){if(changed)setState(value);stateSignature.current=signature;sessionKnown.current=true;}setInitialized(true);setPollError(null);return changed||(!light&&value.jobs?.some(j=>['queued','running'].includes(j.status)))}
    catch(e){if(e.name!=='AbortError'){if(e.status===401){previews.clear();sessionKnown.current=false;stateSignature.current=null;setState(null);setPollError(null)}else setPollError(e)}return false}
    finally{if(!c.signal.aborted){setChecked(true);polling.current=false}}
  }
  const bootstrap=signal=>api('/bootstrap','GET',undefined,{signal}).then(v=>{setInitialized(v.initialized);setBootstrapError(null)}).catch(e=>{if(e.name!=='AbortError')setBootstrapError(e)});
  useEffect(() => {
    const c=new AbortController();bootstrap(c.signal);
    const poll=adaptivePoll(()=>refresh(!location.hash.startsWith('#manage')),{base:2500,max:30000});
    const f=()=>{setRoute(location.hash);poll.wake()};
    const visibility=()=>{document.documentElement.classList.toggle('museum-page-hidden',document.hidden)};
    visibility();document.addEventListener('visibilitychange',visibility);
    window.addEventListener('hashchange',f);
    return()=>{c.abort();stateRequest.current?.abort();poll.stop();document.removeEventListener('visibilitychange',visibility);document.documentElement.classList.remove('museum-page-hidden');window.removeEventListener('hashchange',f)};
  },[]);
  async function logout() {
    try {
      await api("/logout", "POST", {});
      previews.clear();sessionKnown.current=false;stateSignature.current=null;
      setAutoUnlockAllowed(false);
      setState(null);setError('');
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
    return <ServiceHealthContext.Provider value={failureInfo(pollError)}><PreferencesProvider api={api}>{pollError&&<div className="museum-service-banner"><StatusNotice global error={pollError} scope="服务连接" detail="保留当前画面 · 自动重连" onRetry={refresh}/></div>}{error&&!pollError&&<div className="museum-service-banner"><StatusNotice global error={error} onDismiss={()=>setError('')}/></div>}{route === "#manage" ? (
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
     )}</PreferencesProvider></ServiceHealthContext.Provider>;
  if(initialized===null||!checked||pollError)return <div className="entrance-status"><StatusPanel loading={!pollError&&!bootstrapError} label="读取展馆" error={pollError||bootstrapError} onRetry={()=>Promise.all([bootstrap(),refresh()])}/></div>;
  return (
    <main>
      <section className="entrance">
        <Icon name="lock" className="entrance-icon" />
        {error && (
          <StatusNotice error={error}/>
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
createRoot(document.getElementById("root")).render(<MuseumBoundary><App /></MuseumBoundary>);
