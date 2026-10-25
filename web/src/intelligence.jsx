import React, { useEffect, useState } from "react";
import {StatusNotice} from "./system-status";
function FaceImage({ src, box, alt }) {
  const [x, y, w, h] = box || [0, 0, 1, 1];
  return (
    <div className="face-image">
      <img src={src} alt={alt} />
      <span
        style={{
          left: x * 100 + "%",
          top: y * 100 + "%",
          width: w * 100 + "%",
          height: h * 100 + "%",
        }}
      />
    </div>
  );
}
export function Intelligence({ api }) {
  const [status, setStatus] = useState(null),
    [people, setPeople] = useState([]),
    [person, setPerson] = useState(null),
    [faces, setFaces] = useState([]),
    [error, setError] = useState("");
  const refresh = () =>
    Promise.all([
      api("/intelligence").then(setStatus),
      api("/people").then((d) => setPeople(d.people)),
    ]).then(()=>setError('')).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, []);
  const choose = (p) => {
    setPerson(p);
    api("/people/" + p.id + "/faces")
      .then((d) => setFaces(d.items))
      .catch((e) => setError(e.message));
  };
  return (
    <section className="intelligence-panel section">
      <div className="section-title">
        <h2>本地策展室</h2>
        <span>本地</span>
      </div>
      <div className="intelligence-status">
        <span>
          {status?.providers.reduce((n, p) => n + p.count, 0) || 0} 份分析
        </span>
        <span>{status?.faces || 0} 张人脸</span>
      </div>
      {error && <StatusNotice error={error} scope="本地策展" onDismiss={()=>setError('')}/> }
      <div className="people-strip">
        {people.map((p, i) => (
          <button key={p.id} onClick={() => choose(p)}>
            <FaceImage src={p.thumbnail} box={p.box} alt="人物分组样本" />
            <span>{p.label || "人物组 " + (i + 1)}</span>
            <small>{p.count} 张照片</small>
          </button>
        ))}
      </div>
      {person && (
        <div className="people-review">
          <div className="section-title">
            <h3>确认人物</h3>
            <button className="quiet" onClick={() => setPerson(null)}>
              收起
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const label = new FormData(e.currentTarget).get("label");
              api("/people/" + person.id, "POST", { label })
                .then(() => {
                  setPerson({ ...person, label });
                  refresh();
                })
                .catch((e) => setError(e.message));
            }}
          >
            <label>
              人物名称
              <input
                key={person.id}
                name="label"
                defaultValue={person.label}
                maxLength="80"
                placeholder="由你命名"
              />
            </label>
            <button>保存标签</button>
          </form>
          <div className="face-review-grid">
            {faces.map((f) => (
              <article key={f.face_id}>
                <FaceImage
                  src={f.thumbnail}
                  box={f.box}
                  alt="待确认的分组照片"
                />
                <select
                  aria-label="调整人物分组"
                  defaultValue={person.id}
                  onChange={(e) =>
                    api("/faces/" + f.face_id + "/assign", "POST", {
                      person_id: e.target.value || null,
                    })
                      .then(() => {
                        choose(person);
                        refresh();
                      })
                      .catch((e) => setError(e.message))
                  }
                >
                  <option value="">拆为新人物组</option>
                  {people.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      {p.label || "人物组 " + (i + 1)}
                    </option>
                  ))}
                </select>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
