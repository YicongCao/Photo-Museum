#!/usr/bin/env python3
"""Build bounded, local-only P0.5 fixtures, never traverse or write the NAS.

All generated media, including synthetic fixtures, live under ignored data/.
Private examples are opt-in and reuse the P0 experiment's local SDR sources.
This prepares fixtures eagerly; it is not the production on-demand tile worker.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw, ImageFont, ImageOps

VERSION = "p05-fixtures-v2"
TILE_SIZE = 1024
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
ICC = SRGB.tobytes()


class FixtureWriter:
    def __init__(self, root: Path, max_bytes: int):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_bytes
        self.used = sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file())
        self.files: dict[str, dict] = {}

    def write(self, relative: str, payload: bytes) -> None:
        target = (self.root / relative).resolve()
        if self.root not in target.parents:
            raise ValueError("Output escapes fixture root")
        old_bytes = target.stat().st_size if target.exists() else 0
        # Temporary replacement bytes also count toward the peak.
        if self.used + len(payload) > self.max_bytes:
            raise ValueError("Fixture disk budget exceeded before write")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".partial")
        try:
            temporary.write_bytes(payload)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        self.used += len(payload) - old_bytes

    def image(self, image: Image.Image, asset_id: str, revision: str,
              variant: str, fmt: str = "JPEG", quality: int = 93) -> str:
        suffix = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}[fmt]
        relative = f"assets/{asset_id}/{revision}/{variant}.{suffix}"
        stream = io.BytesIO()
        options = {"icc_profile": ICC}
        if fmt == "JPEG":
            options.update(quality=quality, subsampling=0, optimize=True)
        elif fmt == "WEBP":
            options.update(quality=quality, method=4)
        image.save(stream, format=fmt, **options)
        self.write(relative, stream.getvalue())
        url = f"/media/{asset_id}/{revision}/{variant}"
        self.files[url] = {"path": relative, "revision": revision,
                           "contentType": {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[fmt]}
        return url


def gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    from PIL import ImageColor
    a, b = ImageColor.getrgb(top), ImageColor.getrgb(bottom)
    strip = Image.new("RGB", (1, size[1]))
    strip.putdata([tuple(round(a[c] + (b[c] - a[c]) * y / max(1, size[1] - 1))
                         for c in range(3)) for y in range(size[1])])
    return strip.resize(size)


def landscape(size: tuple[int, int], family: int, index: int) -> Image.Image:
    """Procedural, non-photographic landscapes; no remote imagery or licenses."""
    w, h = size
    palettes = [
        ("#dadfd9", "#f2cfb2", ["#9faeab", "#657e7e", "#38585d", "#173b43"]),
        ("#a5bec5", "#eee2c5", ["#cda17a", "#ba7956", "#965239", "#633929"]),
        ("#dbe0c5", "#ecdfaa", ["#93a48b", "#657d60", "#435d43", "#293c30"]),
        ("#e4d6c8", "#dcc2b1", ["#c0a28d", "#9a837c", "#6c6364", "#3a454b"]),
    ]
    top, bottom, hills = palettes[family]
    image = gradient(size, top, bottom)
    draw = ImageDraw.Draw(image)
    phase = index * 0.54
    sun_x, sun_y = w * (.68 - .12 * index), h * .26
    radius = h * (.08 + .012 * index)
    draw.ellipse((sun_x-radius, sun_y-radius, sun_x+radius, sun_y+radius), fill="#f9edd2")
    for layer, color in enumerate(hills):
        points = [(0, h)]
        for step in range(361):
            x = w * step / 360
            base = .48 + layer * .115
            y = h * (base + .10 * math.sin(x / w * 5.7 + phase + layer * .9)
                     + .036 * math.cos(x / w * 12 + layer + phase))
            points.append((round(x), round(y)))
        points.append((w, h))
        draw.polygon(points, fill=color)
    # Fine lines remain resolvable only at the original's pixel density.
    rng = random.Random(family * 20 + index)
    if family == 0:
        for line in range(38):
            y = round(h * (.70 + line * .007))
            x = round(w * rng.uniform(.02, .7))
            draw.line((x, y, x + w * rng.uniform(.03, .2), y), fill="#849a94", width=max(1, w // 3000))
    elif family == 1:
        for line in range(55):
            y = round(h * (.70 + line * .005))
            draw.arc((w * -.08, y-h*.13, w*1.4, y+h*.22), 180, 260, fill="#cf9770", width=max(1, w // 3000))
    elif family == 2:
        for tree in range(38):
            x = int(w * rng.uniform(.02, .98)); y = int(h * rng.uniform(.68, 1.05))
            height = h * rng.uniform(.04, .2)
            draw.polygon([(x,y-height), (x-height*.24,y), (x+height*.24,y)], fill="#203c34")
    else:
        for building in range(16):
            x = w * building / 15; bw = w * .055
            y = h * rng.uniform(.67, .88)
            draw.rectangle((x, y, x+bw, h), fill="#3e4a4e")
            for wy in range(int(y+h*.02), h, max(4, h//55)):
                draw.line((x+bw*.2, wy, x+bw*.75, wy), fill="#b6a899", width=max(1,w//2200))
    font = ImageFont.load_default(size=max(15, w//180))
    draw.text((w*.035, h*.94), f"SYNTHETIC STUDY  {family+1:02d} / {index+1:02d}",
              fill="#e9dfca", font=font)
    return image


def resolution_chart(size: tuple[int, int]) -> Image.Image:
    w, h = size
    image = Image.new("RGB", size, "#ece8df")
    draw = ImageDraw.Draw(image)
    colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#06b6d4"]
    for column, color in enumerate(colors):
        x0, x1 = round(w*column/6), round(w*(column+1)/6)
        draw.rectangle((x0, 0, x1, h*.19), fill=color)
    for x in range(0, w, 256):
        draw.line((x, h*.24, x, h), fill="#c2bdb3", width=2)
    for y in range(round(h*.24), h, 256):
        draw.line((0, y, w, y), fill="#c2bdb3", width=2)
    large = ImageFont.load_default(size=w//31)
    draw.text((w*.055, h*.26), "60.2 MP", fill="#253635", font=large)
    draw.text((w*.06, h*.36), f"{w} x {h} / sRGB / FULL RESOLUTION", fill="#253635",
              font=ImageFont.load_default(size=w//125))
    for band, spacing in enumerate((2, 4, 8, 16, 32, 64)):
        start = round(w*(.06+band*.148)); stop = round(start+w*.12)
        y0, y1 = round(h*.51), round(h*.86)
        draw.rectangle((start, y0, stop, y1), fill="#ffffff")
        for x in range(start, stop, spacing):
            draw.line((x,y0,x,y1), fill="#101820", width=max(1, spacing//2))
        draw.text((start,y1+40), f"{spacing}px", fill="#253635", font=ImageFont.load_default(size=w//150))
    return image


def tile_dimensions(width: int, height: int, preview_size: tuple[int, int]) -> list[tuple[int, int]]:
    """Include the exact encoded preview size so fit never needs a blurrier LOD.

    Receive the measured thumbnail() result instead of reproducing its integer
    aspect rounding. This matters for odd source dimensions near the 4K boundary.
    """
    if min(width, height, *preview_size) <= 0:
        raise ValueError("Image dimensions must be positive")
    if preview_size[0] > width or preview_size[1] > height or max(preview_size) > 3840:
        raise ValueError("Preview must be bounded to 4K without upscaling")
    dimensions = {(width, height), preview_size}
    previous = (width, height)
    while max(previous) > 3000:
        previous = ((previous[0] + 1) // 2, (previous[1] + 1) // 2)
        dimensions.add(previous)
    return sorted(dimensions, key=lambda size: (max(size), size[0], size[1]))


def add_asset(writer: FixtureWriter, image: Image.Image, *, asset_id: str, event_id: str,
              title: str, revision: str, source_kind: str, source_format: str,
              lossless: bool = False, force_tiles: bool = False) -> dict:
    width, height = image.size
    variants = {}
    preview_size = image.size
    for variant, edge, quality in (("thumb",640,75), ("preview",3840,82)):
        small = image.copy()
        small.thumbnail((edge,edge), Image.Resampling.LANCZOS)
        variants[variant] = writer.image(small,asset_id,revision,variant,"WEBP",quality)
        if variant == "preview": preview_size = small.size
        small.close()
    original_format = "PNG" if lossless else "JPEG"
    original = writer.image(image,asset_id,revision,"original",original_format)
    tiled = force_tiles or max(width,height) > 4096 or width*height > 16_000_000
    detail: dict = {"kind":"tiles" if tiled else "image", "url":original,
                    "compatible":source_kind == "private", "colorSpace":"srgb", "hdr":False}
    if tiled:
        levels = []
        for level, (lw,lh) in enumerate(tile_dimensions(width,height,preview_size)):
            reduced = image if (lw,lh)==image.size else image.resize((lw,lh),Image.Resampling.LANCZOS)
            cols,rows=math.ceil(lw/TILE_SIZE),math.ceil(lh/TILE_SIZE)
            for y in range(rows):
                for x in range(cols):
                    tile=reduced.crop((x*TILE_SIZE,y*TILE_SIZE,min(lw,(x+1)*TILE_SIZE),min(lh,(y+1)*TILE_SIZE)))
                    writer.image(tile,asset_id,revision,f"tile/{level}/{x}/{y}",original_format)
                    tile.close()
            levels.append({"level":level,"width":lw,"height":lh,"cols":cols,"rows":rows,
                           "urlTemplate":f"/media/{asset_id}/{revision}/tile/{level}/{{x}}/{{y}}"})
            if reduced is not image: reduced.close()
        detail.update(tileSize=TILE_SIZE,levels=levels)
    return {"id":asset_id,"eventId":event_id,"title":title,"width":width,"height":height,
            "revision":revision,"thumbnail":variants["thumb"],"preview":variants["preview"],
            "detail":detail,"sourceKind":source_kind,"format":source_format,
            "displayFormat":"sRGB PNG" if lossless else "sRGB JPEG"}


def private_image(source: Path, row: dict) -> Image.Image:
    import pillow_heif
    pillow_heif.register_heif_opener()
    with Image.open(source) as opened:
        profile=opened.info.get("icc_profile")
        image=ImageOps.exif_transpose(opened)
        if profile:
            image=ImageCms.profileToProfile(image,ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                                           SRGB,renderingIntent=0,outputMode="RGB")
        elif row.get("color_action")=="declared_srgb":
            image=image.convert("RGB")
        else:
            raise ValueError("Previously accepted source now lacks an interpretable color profile")
        image.load()
        return image.copy()


def prepare(root: Path, *, include_private: bool = False, max_bytes: int = 500_000_000,
            probe_root: Path = Path("data/research/media-probe")) -> dict:
    writer=FixtureWriter(root,max_bytes)
    titles=[("潮汐之间","2019.06","海面、微光，以及缓慢的时间。"),
            ("沿着风的方向","2021.10","在沙丘的弧线上，留住一束光。"),
            ("林间日常","2023.04","在绿色深处，重新发现平凡。"),
            ("城市余温","2025.11","街道安静下来，记忆仍有温度。")]
    events=[]; assets=[]
    for family,(title,date,description) in enumerate(titles):
        event_id=f"study-{family+1}"
        ids=[]
        for index in range(3):
            asset_id=f"demo-{family+1}-{index+1}"
            size=(4096,2731) if index!=1 else (2731,4096)
            image=landscape(size,family,index)
            revision=hashlib.sha256(f"{VERSION}/{asset_id}/{size}".encode()).hexdigest()[:12]
            assets.append(add_asset(writer,image,asset_id=asset_id,event_id=event_id,
                                    title=f"{title} · {index+1:02d}",revision=revision,
                                    source_kind="demo",source_format="Procedural sRGB"))
            ids.append(asset_id);image.close()
        events.append({"id":event_id,"title":title,"date":date,"description":description,"assetIds":ids})
    chart_id="resolution-61mp"
    chart=resolution_chart((9504,6336))
    revision=hashlib.sha256(f"{VERSION}/{chart_id}".encode()).hexdigest()[:12]
    assets.append(add_asset(writer,chart,asset_id=chart_id,event_id="study-resolution",title="原图细节 · 60.2 MP",
                            revision=revision,source_kind="demo",source_format="sRGB resolution chart",
                            lossless=True,force_tiles=True));chart.close()
    events.append({"id":"study-resolution","title":"看见每一个像素","date":"P0.5",
                   "description":"60.2 MP 合成分辨率与色彩测试图；不代表真实照片。","assetIds":[chart_id]})
    collections={"demo":{"events":events,"assets":assets,"collection":"demo",
                          "notice":"演示藏品为程序生成的合成画面；本地 P0.5 原型，无生产账号系统。"}}
    private_assets=[]
    if include_private:
        probe_root=probe_root.resolve()
        report=json.loads((probe_root/"results.json").read_text())
        rows=[row for row in report["records"] if row.get("kind")=="photo" and row.get("status")=="ok_sdr"]
        # Sample JPEG and HEIC plus portrait/large sources without revealing filenames.
        rows.sort(key=lambda row:(row.get("metadata",{}).get("FileType",""),row["id"]))
        selected=[]
        for filetype in sorted({row.get("metadata",{}).get("FileType","") for row in rows}):
            selected.extend([row for row in rows if row.get("metadata",{}).get("FileType","")==filetype][:3])
        for index,row in enumerate(selected[:6],1):
            folder=(probe_root/row["id"]).resolve()
            if probe_root not in folder.parents: raise ValueError("Probe folder escapes root")
            candidates=list(folder.glob("source.*"))
            if len(candidates)!=1: raise ValueError("Expected exactly one local source copy")
            source=candidates[0].resolve()
            if probe_root not in source.parents: raise ValueError("Local source escapes probe root")
            image=private_image(source,row)
            asset_id=f"private-{index:02d}"
            digest=hashlib.sha256(VERSION.encode())
            with source.open("rb") as handle:
                for chunk in iter(lambda:handle.read(1024*1024),b""):digest.update(chunk)
            private_assets.append(add_asset(writer,image,asset_id=asset_id,event_id="private-samples",
                                            title=f"真实小样 {index:02d}",revision=digest.hexdigest()[:12],
                                            source_kind="private",source_format=row.get("metadata",{}).get("FileType","Image")))
            image.close()
    collections["private"]={"collection":"private","assets":private_assets,
        "events":[{"id":"private-samples","title":"真实照片小样","date":"本机私密",
                   "description":"来自此前只读媒体实验的本地副本；高分辨率画面是 sRGB 兼容转换。",
                   "assetIds":[a["id"] for a in private_assets]}] if private_assets else [],
        "notice":"仅本机私密小样；未接入生产 WebDAV 或馆主登录。"}
    manifest={"version":VERSION,"collections":collections,"files":writer.files,
              "budgetBytes":max_bytes,"mediaBytes":writer.used}
    writer.write("manifest.json",json.dumps(manifest,ensure_ascii=False,indent=2).encode())
    return {"demoAssets":len(assets),"privateAssets":len(private_assets),"bytes":writer.used,
            "budgetBytes":max_bytes,"files":len(writer.files)}


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=Path("data/prototype"))
    parser.add_argument("--include-private",action="store_true")
    parser.add_argument("--probe-root",type=Path,default=Path("data/research/media-probe"))
    parser.add_argument("--max-bytes",type=int,default=500_000_000)
    args=parser.parse_args()
    print(json.dumps(prepare(args.output,include_private=args.include_private,
                             max_bytes=args.max_bytes,probe_root=args.probe_root)))


if __name__ == "__main__":main()
