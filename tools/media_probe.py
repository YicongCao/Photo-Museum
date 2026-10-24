#!/usr/bin/env python3
"""Bounded, read-only media experiment, not the production HDR pipeline.

Run with Pillow + pillow-heif in an isolated environment. Input is an explicit
JSON manifest {root, photos, videos}; no recursive NAS traversal is performed.
Private inputs and derivatives belong in ignored data/research/.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import platform
import shutil
import statistics
import subprocess
import time
from pathlib import Path

PHOTO_TAGS = ["FileType", "BitsPerSample", "ColorSpace", "ProfileDescription",
              "ColorPrimaries", "TransferCharacteristics", "MatrixCoefficients",
              "ImageWidth", "ImageHeight", "Make", "Model", "LensModel",
              "HDRHeadroom", "HDRGain", "HDRImageType", "ContentIdentifier",
              "LivePhotoVideoIndex", "Duration", "VideoFrameRate", "Rotation"]


def target_size(width: int, height: int, edge: int) -> tuple[int, int]:
    if min(width, height, edge) <= 0:
        raise ValueError("Dimensions and edge must be positive")
    scale = min(1.0, edge / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def hdr_reason(metadata: dict, nclx: dict | None = None, auxiliary_types: list[str] | None = None) -> str | None:
    """Conservatively defer HDR/gain-map sources until reference QA exists."""
    nclx = nclx or {}
    transfer = nclx.get("transfer_characteristics")
    if transfer in (16, 18) or metadata.get("TransferCharacteristics") in (16, 18):
        return "pq_or_hlg_transfer"
    if any("gainmap" in name.lower() or "gain-map" in name.lower() for name in auxiliary_types or []):
        return "gainmap_requires_sdr_base_validation"
    text = " ".join(str(metadata.get(k, "")) for k in
                    ("TransferCharacteristics", "ProfileDescription" )).lower()
    if any(value in text for value in ("pq", "2084", "hlg", "arib")):
        return "pq_or_hlg_profile"
    if any(metadata.get(k) is not None for k in ("HDRHeadroom", "HDRGain", "HDRImageType")):
        return "hdr_metadata_requires_sdr_base_or_tonemap_validation"
    return None


def metadata_for(path: Path) -> dict:
    cmd = ["exiftool", "-json", "-n", *["-" + x for x in PHOTO_TAGS], str(path)]
    row = json.loads(subprocess.check_output(cmd, timeout=45))[0]
    row.pop("SourceFile", None)
    if "ContentIdentifier" in row:
        row["has_content_identifier"] = bool(row.pop("ContentIdentifier"))
    return row


def convert_photo(path: Path, destination: Path, metadata: dict) -> dict:
    from PIL import Image, ImageCms, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()
    nclx = {}
    auxiliary_types = []
    bit_depth = None
    if path.suffix.lower() in {".heic", ".heif", ".hif"}:
        heif = pillow_heif.open_heif(path, convert_hdr_to_8bit=False)
        nclx = heif.info.get("nclx_profile", {})
        auxiliary_types = list(heif.info.get("aux", {}).keys())
        bit_depth = heif.info.get("bit_depth")
    reason = hdr_reason(metadata, nclx, auxiliary_types)
    if reason:
        return {"status": "deferred_hdr", "reason": reason, "nclx": nclx,
                "auxiliary_types": auxiliary_types, "bit_depth": bit_depth}
    started = time.perf_counter()
    with Image.open(path) as source:
        profile_bytes = source.info.get("icc_profile")
        image = ImageOps.exif_transpose(source)
        source_size = image.size
        srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
        if profile_bytes:
            source_profile = ImageCms.ImageCmsProfile(io.BytesIO(profile_bytes))
            image = ImageCms.profileToProfile(image, source_profile, srgb,
                                             renderingIntent=0, outputMode="RGB")
            color_action = "icc_to_srgb"
        elif metadata.get("ColorSpace") == 1 or (
            nclx.get("color_primaries") == 1 and nclx.get("transfer_characteristics") == 13
        ):
            image = image.convert("RGB")
            color_action = "declared_srgb"
        else:
            return {"status": "deferred_color", "reason": "missing_or_unknown_source_profile"}
        sizes = {}
        destination.mkdir(parents=True, exist_ok=True)
        for variant, edge, quality in [("display", 3840, 78), ("thumb", 640, 72)]:
            resized = image.copy()
            resized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            output = destination / (variant + ".webp")
            resized.save(output, format="WEBP", quality=quality, method=4,
                         icc_profile=srgb.tobytes(), exif=b"", xmp=b"")
            with Image.open(output) as check:
                check.load()
                if max(check.size) > edge or check.size != target_size(*source_size, edge):
                    raise ValueError("Unexpected output size")
                if not check.info.get("icc_profile") or check.getexif():
                    raise ValueError("ICC missing or source EXIF retained")
                sizes[variant] = {"width": check.width, "height": check.height,
                                  "bytes": output.stat().st_size, "quality": quality}
    return {"status": "ok_sdr", "source_width": source_size[0],
            "source_height": source_size[1], "color_action": color_action,
            "nclx": nclx, "outputs": sizes,
            "bit_depth": bit_depth, "auxiliary_types": auxiliary_types,
            "decode_color_resize_encode_seconds": round(time.perf_counter() - started, 4)}


def probe_video(path: Path, destination: Path) -> dict:
    raw = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,pix_fmt,color_space,color_transfer,color_primaries:stream_side_data=rotation",
        "-of", "json", str(path)], timeout=60))
    streams = [s for s in raw.get("streams", []) if s.get("codec_type") == "video"]
    duration = float(raw.get("format", {}).get("duration", 0))
    result = {"duration_seconds": duration, "streams": streams}
    if not streams or duration <= 0:
        return dict(result, status="deferred_video", reason="no_video_or_unknown_duration")
    stream = streams[0]
    if stream.get("color_transfer") in {"smpte2084", "arib-std-b67"}:
        return dict(result, status="deferred_hdr_video", reason="reference_tonemap_not_validated")
    # Unknown profiles must not be relabelled sRGB. This proof only accepts BT.709.
    if stream.get("color_primaries") != "bt709" or stream.get("color_transfer") != "bt709":
        return dict(result, status="deferred_video_color", reason="unknown_source_color")
    destination.mkdir(parents=True, exist_ok=True)
    frame = destination / "midpoint.png"
    # Explicit BT.709 -> sRGB conversion; swscale alone is not a transfer conversion.
    command = ["ffmpeg", "-v", "error", "-y", "-ss", str(duration / 2), "-i", str(path),
               "-frames:v", "1", "-vf", "colorspace=all=bt709:trc=iec61966-2-1:format=yuv444p,format=rgb24",
               str(frame)]
    subprocess.run(command, check=True, timeout=90, capture_output=True)
    result.update(convert_photo(frame, destination, {"ColorSpace": 1}))
    result["frame_time_seconds"] = duration / 2
    return result


def aggregate(records: list[dict]) -> dict:
    photos = [r for r in records if r.get("kind") == "photo" and r.get("status") == "ok_sdr"]
    stats = {}
    for variant in ("display", "thumb"):
        values = sorted(r["outputs"][variant]["bytes"] for r in photos)
        if values:
            stats[variant] = {"mean_bytes": statistics.mean(values),
                              "median_bytes": statistics.median(values),
                              "min_bytes": min(values), "max_bytes": max(values)}
    combined = [sum(r["outputs"][v]["bytes"] for v in ("display", "thumb")) for r in photos]
    return {"successful_sdr_photos": len(photos), "variant_bytes": stats,
            "mean_combined_bytes": statistics.mean(combined) if combined else None,
            "max_combined_bytes": max(combined) if combined else None,
            "mean_conversion_seconds": statistics.mean(r["decode_color_resize_encode_seconds"] for r in photos) if photos else None}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-source-bytes", type=int, default=1_000_000_000)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    root = Path(manifest["root"]).resolve()
    output = args.output.resolve()
    if output == root or root in output.parents:
        raise SystemExit("Output must not be inside source")
    output.mkdir(parents=True, exist_ok=True)
    result_path = output / "results.json"
    old = json.loads(result_path.read_text()) if result_path.exists() else {}
    records = old.get("records", [])
    done = {r["relative_path"] for r in records}
    consumed = sum(r.get("source_bytes", 0) for r in records)
    import PIL, pillow_heif
    report = {"experiment": "bounded-media-probe-v1", "python": platform.python_version(),
              "pillow": PIL.__version__, "pillow_heif": pillow_heif.__version__,
              "libheif": pillow_heif.libheif_info(), "source_budget_bytes": args.max_source_bytes,
              "records": records}
    def save():
        report["source_bytes_copied"] = consumed
        report["summary"] = aggregate(records)
        temporary = result_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        temporary.replace(result_path)
    for kind, paths, limit in [("photo", manifest.get("photos", []), 24),
                               ("video", manifest.get("videos", []), 2)]:
        for relative in paths[:limit]:
            if relative in done:
                continue
            source = (root / relative).resolve()
            if root not in source.parents:
                raise SystemExit("Manifest escapes source root")
            key = hashlib.sha256(relative.encode()).hexdigest()[:16]
            folder = output / key
            row = {"relative_path": relative, "id": key, "kind": kind}
            try:
                size = source.stat().st_size
                if size > args.max_source_bytes - consumed:
                    row.update(status="skipped_budget", source_bytes=0)
                else:
                    folder.mkdir(parents=True, exist_ok=True)
                    local = folder / ("source" + source.suffix.lower())
                    start = time.perf_counter()
                    shutil.copyfile(source, local)
                    consumed += local.stat().st_size
                    row.update(source_bytes=local.stat().st_size,
                               copy_seconds=round(time.perf_counter() - start, 4))
                    meta = metadata_for(local)
                    row["metadata"] = meta
                    row.update(convert_photo(local, folder, meta) if kind == "photo" else probe_video(local, folder))
            except Exception as exc:
                row.update(status="error", error=str(exc))
            records.append(row)
            save()
            print(json.dumps({"completed": len(records), "id": key, "kind": kind,
                              "status": row["status"], "source_bytes_copied": consumed}), flush=True)
    save()
    print(json.dumps(report["summary"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
