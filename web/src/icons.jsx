import React from "react";
const paths = {
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v11H5zM12 15v3",
  folder: "M3 6h7l2 3h9v12H3zM3 6V3h7l2 3h8v3",
  photo: "M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M15 8h.01",
  video: "M3 4h18v16H3zM10 8l6 4-6 4z",
  server: "M4 3h16v7H4zM4 14h16v7H4zM7 6h.01M7 17h.01M11 6h6M11 17h6",
  pulse: "M2 12h4l3-8 6 16 3-8h4",
  pause: "M8 5v14M16 5v14",
  play: "M7 4l14 8-14 8z",
  check: "M4 12l5 5L20 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 6v6l4 2",
  alert: "M12 3L2 21h20zM12 9v5M12 17h.01",
  close: "M5 5l14 14M19 5L5 19",
};
export function Icon({ name, className = "" }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name] || paths.folder} />
    </svg>
  );
}
export const statusIcon = {
  queued: "clock",
  running: "pulse",
  paused: "pause",
  blocked: "alert",
  completed: "check",
  cancelled: "close",
};
