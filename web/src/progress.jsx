import React from "react";
import { Icon, statusIcon } from "./icons";

export function DirectoryBar({ done, total }) {
  const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <svg
      className="directory-bar"
      viewBox="0 0 300 5"
      preserveAspectRatio="none"
      role="img"
      aria-label={`已发现目录中，${done} 个完成，共 ${total} 个`}
    >
      <rect className="chart-track" width="300" height="5" />
      <rect className="chart-fill" width={fraction * 300} height="5" />
    </svg>
  );
}

export function CollectionOverview({ state }) {
  const job =
    state.jobs.find((j) =>
      ["running", "queued", "paused", "blocked"].includes(j.status),
    ) || state.jobs[0];
  const done = job?.done_dirs || 0,
    total = job?.total_dirs || 0;
  const fraction = total ? Math.min(1, Math.max(0, done / total)) : 0;
  const count = state.jobs.length;
  const groups = [
    ["running", "进行"],
    ["queued", "等待"],
    ["paused", "暂停"],
    ["blocked", "需处理"],
    ["completed", "完成"],
    ["cancelled", "取消"],
  ];
  return (
    <section className="collection-overview" aria-label="馆藏与任务概况">
      <div className="directory-overview">
        <div className="directory-ring">
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={`当前展示任务已完成 ${done} 个目录，共发现 ${total} 个目录`}
          >
            <circle className="chart-ring-track" cx="60" cy="60" r="50" />
            <circle
              className="chart-ring-value"
              cx="60"
              cy="60"
              r="50"
              pathLength="100"
              strokeDasharray={`${fraction * 100} 100`}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div>
            <strong>{done}</strong>
            <span>/ {total}</span>
          </div>
        </div>
        <div className="directory-copy">
          <h2>
            <Icon name="folder" />
            已发现目录
          </h2>
          <p>{job ? job.root.split("/").pop() : "等待第一场展览"}</p>
          <small>
            {job
              ? `${done} 个完成 · ${Math.max(0, total - done)} 个未完成`
              : "开始刮削后呈现真实进度"}
          </small>
          <small>
            {job?.status === "completed"
              ? "所选范围枚举完成"
              : "目录可能继续发现，不代表全库进度"}
          </small>
        </div>
      </div>
      <div className="task-distribution">
        <div className="overview-heading">
          <h2>
            <Icon name="pulse" />
            任务分布
          </h2>
          <small>最近 {count} 个任务 · 最多 30 个</small>
        </div>
        <div className="distribution-bars">
          {groups.map(([key, label]) => {
            const n = state.jobs.filter((j) => j.status === key).length;
            return (
              <div className="distribution-item" key={key}>
                <span>
                  <Icon name={statusIcon[key]} />
                  {label}
                </span>
                <svg
                  viewBox="0 0 100 5"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <rect className="chart-track" width="100" height="5" />
                  <rect
                    className={`chart-fill ${key}`}
                    width={count ? (n / count) * 100 : 0}
                    height="5"
                  />
                </svg>
                <strong>{n}</strong>
              </div>
            );
          })}
        </div>
        <div className="source-summary">
          <Icon name="server" />
          <span>{state.sources.length} 个照片源已配置</span>
          <Icon name={state.worker_online ? "check" : "alert"} />
          <span>{state.worker_online ? "进程在线" : "进程离线"}</span>
        </div>
      </div>
    </section>
  );
}
