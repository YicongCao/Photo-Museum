import React from "react";
const paths = {
  download: "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
  metadata: "M5 2h10l4 4v16H5zM14 2v5h5M8 11h8M8 15h8M8 19h5",
  frame:
    "M3 3h18v18H3zM3 7h18M3 17h18M7 3v4M17 3v4M7 17v4M17 17v4M10 10l5 2-5 2z",
  display: "M2 3h20v15H2zM8 22h8M12 18v4M5 13l4-4 3 3 4-5 3 6",
  thumbnail: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  color:
    "M12 2c-5 0-10 4-10 9s4 10 10 10h2a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 0-8zM6 9h.01M9 6h.01M14 6h.01",
  pin: "M19 9c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 14 0M12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  subject: "M8 2H2v6M16 2h6v6M2 16v6h6M22 16v6h-6M7 7h10v10H7z",
  face: "M8 2H2v6M16 2h6v6M2 16v6h6M22 16v6h-6M8 9h.01M16 9h.01M9 15q3 3 6 0",
  score: "M3 21V11M9 21V7M15 21V3M21 21V9M2 22h20",

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
