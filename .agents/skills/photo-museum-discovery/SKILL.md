---
name: photo-museum-discovery
description: 在 photo-museum 中只读盘点照片源、续跑目录队列、验证小样本色彩和缓存预算；用于实现前验证与容量复测，不是生产增量刮削器。
---

# 照片源实测

先读 `docs/STATUS.md` 与 `docs/research/library-census.md`，确认本轮范围。源只读，输出放项目被忽略的 `data/`，绝不把逐文件路径、EXIF/GPS、照片或凭据提交Git。

## 已验证入口

```bash
uv sync --extra media
uv run --extra media python -m unittest discover -s tests -v
uv run python tools/inventory.py --root '/实际/只读照片根目录' --workers 4
```

盘点SQLite在本机 `data/inventory.sqlite3`。中断后加`--resume`接续未完成目录；新一轮不加`--resume`，保留历史run。只运行一个盘点进程。`--max-directories`可做受控小批；未完成退出码2，成功0。

这是文件名清单，已知媒体后缀不逐文件stat，目录中未验证文件/特殊文件、同名配对都只能称“候选”。排除原片子目录内部不计数；活动名称包含“底片”等词不应触发跳过。检查排除清单、错误、空活动和未知后缀。恢复不是实时增量，已完成目录有新增需新run。

## 媒体样本

在`data/research/`建立私密manifest：`{"root":"绝对源路径","photos":["活动/文件"],"videos":["活动/文件"]}`。按时期、相机、格式/色域挑少量样本；工具最多24照片、2视频，默认显式复制总预算1GB。

```bash
uv run --extra media python tools/media_probe.py --manifest data/research/media-manifest.json --output data/research/media-probe
uv run python tools/report_inventory.py
```

需要系统`exiftool`和`ffmpeg`/`ffprobe`，版本与能力记录在报告。实验输出目录继续运行会跳过已有条目；参数/算法或源内容改变时用新的实验目录，不能把旧结果当新验证。

HDR/gain-map和未知色彩会明确延期；降位深不等于tone mapping。检验方向、不放大、输出ICC与EXIF剥离，并比较小样原图的正规ICC解码与输出。统计只使用`ok_sdr`，把HDR覆盖不足单独写出。

发布前运行报告生成器，仅将汇总Markdown/数值JSON加入docs。外推不是全库转码实测；视频、模型、临时文件单列预算。更新STATUS、阶段日志和验证限制，不能将P0工具声称为正式webserver。
