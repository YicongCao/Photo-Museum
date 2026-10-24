import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
const size = (n) =>
  n == null
    ? "—"
    : n < 1048576
      ? `${(n / 1024).toFixed(0)} KiB`
      : `${(n / 1048576).toFixed(1)} MiB`;
const status = {
  running: "解析中",
  pending: "等待",
  skipped: "无数据 / 未启用",
  failed: "失败",
  unsupported: "待适配",
  done: "已完成",
};
export function CurrentInspection({ file, media, onClose }) {
  const [data, setData] = useState(null),
    [image, setImage] = useState(null),
    [error, setError] = useState("");
  const imageElement = useRef(null);
  useEffect(() => {
    if (!file?.asset_id || !file?.revision) return;
    let stopped = false,
      timer,
      infoRequest,
      imageRequest,
      objectURL = null,
      requested = "";
    const release = () => {
      imageElement.current?.removeAttribute("src");
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = null;
      if (!stopped) setImage(null);
    };
    const loadImage = async (url, label) => {
      if (url === requested) return;
      imageRequest?.abort();
      release();
      requested = url || "";
      if (!url) return;
      const controller = new AbortController();
      imageRequest = controller;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("preview");
        const blob = await response.blob();
        if (stopped || controller.signal.aborted) return;
        objectURL = URL.createObjectURL(blob);
        setImage({ url: objectURL, label });
      } catch {
        if (!stopped && !controller.signal.aborted) requested = "";
      }
    };
    const poll = async () => {
      infoRequest = new AbortController();
      try {
        const response = await fetch(
          `/api/assets/${file.asset_id}/inspection?revision=${encodeURIComponent(file.revision)}`,
          { signal: infoRequest.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("当前文件数据暂不可用");
        const value = await response.json();
        if (stopped) return;
        setData(value);
        setError("");
        loadImage(value.image, value.image_label);
      } catch (e) {
        if (!stopped) setError(e.message);
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      infoRequest?.abort();
      imageRequest?.abort();
      release();
    };
  }, [file?.asset_id, file?.revision]);
  const steps = data?.steps || {},
    meta = data?.metadata || {},
    info = data?.media || {};
  const value = (key) => meta[key]?.value;
  const note = (key) =>
    meta[key]?.is_estimated
      ? "（推断）"
      : meta[key]?.layer === "manual"
        ? "（人工）"
        : "";
  const dims =
    value("width") && value("height")
      ? `${value("width")} × ${value("height")}`
      : null;
  const exposure = value("exposure"),
    aperture = value("aperture"),
    iso = value("iso"),
    focal = value("focal_length");
  const shooting = [
    aperture && `ƒ/${aperture}`,
    exposure &&
      (exposure < 1 ? `1/${Math.round(1 / exposure)}s` : `${exposure}s`),
    iso && `ISO ${iso}`,
    focal && `${focal}mm`,
  ]
    .filter(Boolean)
    .join(" · ");
  const derivative = (profile) =>
    data?.derivatives?.find((d) => d.profile === profile);
  const row = (id, label, icon, content) => (
    <div className={"inspection-row " + (content ? "has-data" : "")} key={id}>
      <dt>
        <Icon name={icon} />
        {label}
      </dt>
      <dd>{content || status[steps[id]] || "等待"}</dd>
    </div>
  );
  const place = data?.place;
  const address =
    place &&
    [place.country, place.province, place.city].filter(Boolean).join(" · ");
  const knownGps = value("gps");
  return (
    <>
      <section className="inspection-photo">
        <div className="side-title">
          <h2>{file?.completed ? "最近处理" : "当前照片"}</h2>
          <button
            className="inspection-close"
            onClick={onClose}
            aria-label="关闭当前照片"
          >
            ×
          </button>
        </div>
        <div className="inspection-image">
          {image ? (
            <img
              ref={imageElement}
              src={image.url}
              alt={data?.name || "当前照片"}
              onError={() => {
                imageElement.current?.removeAttribute("src");
                URL.revokeObjectURL(image.url);
                setImage(null);
                setError("预览解码失败");
              }}
            />
          ) : (
            <span>
              <Icon
                name={file?.kind === "video_candidate" ? "video" : "photo"}
              />
              {!file
                ? "等待文件"
                : ["failed", "unsupported"].includes(data?.status)
                  ? "预览待适配"
                  : info.metadata_only
                    ? "视频仅索引"
                    : steps.download === "done"
                      ? "生成兼容预览"
                      : "取回原图"}
            </span>
          )}
        </div>
        <div className="inspection-caption">
          <strong title={data?.name}>
            {data?.name || file?.path?.split("/").pop() || "—"}
          </strong>
          <small>
            {image?.label || (file?.kind === "video_candidate" ? "视频" : "")}
          </small>
        </div>
      </section>
      <section className="inspection-details">
        <h2>解析数据</h2>
        <dl className="inspection-data" aria-label="当前照片解析数据">
          {row(
            "download",
            "原文件",
            "download",
            data &&
              `${data.name.split(".").pop().toUpperCase()} · ${size(data.size)}`,
          )}
          {row(
            "exif",
            "EXIF",
            "metadata",
            [
              value("camera"),
              dims,
              shooting,
              value("captured_at") &&
                `${value("captured_at")}${note("captured_at")}`,
              value("lens"),
            ]
              .filter(Boolean)
              .join("\n"),
          )}
          {row(
            "display",
            "4K 小图",
            "display",
            derivative("display") &&
              `${size(derivative("display").size)} · WebP · sRGB · SDR`,
          )}
          {row(
            "thumb",
            "缩略图",
            "thumbnail",
            derivative("thumb") && `${size(derivative("thumb").size)} · WebP`,
          )}
          {row(
            "publish",
            "索引",
            "server",
            steps.publish === "done" &&
              (info.metadata_only ? "视频仅索引" : "已写入"),
          )}
          {row(
            "address",
            "地址",
            "pin",
            address
              ? `${address}\n最近城市 · ${Math.round((place.distance_m || 0) / 1000)} km${note("gps")}`
              : knownGps
                ? `${Number(knownGps.latitude).toFixed(4)}, ${Number(knownGps.longitude).toFixed(4)}${note("gps")}`
                : null,
          )}
          {row(
            "subject",
            "主体",
            "subject",
            data?.tags
              ?.slice(0, 3)
              .map((t) => `${t.label} ${Math.round(t.confidence * 100)}%`)
              .join("\n"),
          )}
          {row(
            "faces",
            "人脸",
            "face",
            data?.faces != null ? `${data.faces} 张人脸` : null,
          )}
          {row(
            "score",
            "技术 / 构图分",
            "score",
            data?.score != null ? `${data.score} / 100` : null,
          )}
          {steps.compatible &&
            row(
              "compatible",
              "兼容原图",
              "color",
              derivative("compatible") &&
                `${size(derivative("compatible").size)} · JPEG · SDR`,
            )}
          {steps.frame &&
            row(
              "frame",
              "视频中帧",
              "frame",
              info.duration && `时长 ${info.duration.toFixed(1)}s`,
            )}
          {steps.playback &&
            row(
              "playback",
              "视频转码",
              "video",
              derivative("playback") &&
                `${size(derivative("playback").size)} · H.264 · SDR`,
            )}
          {data?.analysis_error && (
            <div role="status">分析失败：{data.analysis_error}</div>
          )}
          {error && <div role="status">{error}</div>}
        </dl>
        <div className="inspection-cache">
          <span>
            <Icon name="server" />
            缓存占用
          </span>
          <strong>
            {media
              ? `${(media.cache_bytes / 1024 ** 3).toFixed(2)} / ${(media.budget_bytes / 1024 ** 3).toFixed(0)} GiB`
              : "—"}
          </strong>
          <progress
            aria-label="缓存占用"
            value={media?.cache_bytes || 0}
            max={media?.budget_bytes || 1}
          />
        </div>
      </section>
    </>
  );
}
