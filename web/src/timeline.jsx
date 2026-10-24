import React, { useEffect, useRef } from "react";

export function ActivityTimeline({ activities, index, onSelect }) {
  const root = useRef(null), frame = useRef(0), pointer = useRef(null);
  const groups = [];
  activities.forEach((activity, i) => {
    const year = activity.event.year || "未知年份";
    const month = activity.event.month || "年度";
    let y = groups.find((g) => g.year === year);
    if (!y) groups.push(y = { year, months: [] });
    let m = y.months.find((g) => g.month === month);
    if (!m) y.months.push(m = { month, items: [] });
    m.items.push({ activity, i });
  });
  const reset = () => {
    pointer.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    root.current?.querySelectorAll("[data-dock]").forEach((el) => el.style.removeProperty("--dock"));
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const magnify = (e) => {
    if (e.pointerType === "touch" || !matchMedia("(hover: hover)").matches) return;
    pointer.current = e.clientY;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const y = pointer.current;
      if (y == null) return;
      root.current.querySelectorAll("[data-dock]").forEach((el) => {
        // Measure untransformed hit areas so scaling never chases its own geometry.
        const r = el.getBoundingClientRect();
        const distance = Math.abs(y - (r.top + r.height / 2));
        const weight = Math.max(0, 1 - distance / 82);
        el.style.setProperty("--dock", (weight * weight).toFixed(3));
      });
    });
  };
  return <aside ref={root} className="activity-timeline dock-timeline" aria-label="活动时间线"
    onPointerMove={magnify} onPointerLeave={reset} onScroll={reset}>
    {groups.map((year) => <section className="timeline-year-group" key={year.year} aria-label={String(year.year)}>
      <h2 data-dock className={"timeline-year " + (activities[index]?.event.year === year.year ? "selected" : "")}><span className="dock-label">{year.year}</span></h2>
      {year.months.map((month) => <section className="timeline-month-group" key={month.month} aria-label={month.month === "年度" ? "年度" : `${month.month}月`}>
        <h3 data-dock className="timeline-month"><span className="dock-label">{month.month}</span></h3>
        <ul>{month.items.map(({activity, i}) => <li data-dock key={activity.id}>
          <button aria-current={i === index ? "true" : undefined} className={i === index ? "selected" : ""}
            title={activity.event.theme} onClick={() => onSelect(i)}>
            <span className="dock-label"><span className="timeline-dot"/>{activity.event.theme}</span>
          </button>
        </li>)}</ul>
      </section>)}
    </section>)}
  </aside>;
}
