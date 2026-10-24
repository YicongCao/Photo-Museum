# photo-museum

一部可以不断重看的“人生照片集”。以活动主题作为展览，将照片、Live Photo 和视频组织成个人博物馆。服务目标是自托管于 Mac、内网 Linux 或 Docker，从 NAS WebDAV 只读取得成片。

**当前阶段：P0 调研、全库文件名盘点、媒体实验和交互概念已完成；正式 Webserver 尚未实现。** 当前静态概念不读取真实照片，也不是无密码的照片服务。进度与验收结果见 [STATUS](docs/STATUS.md)。

## 先看这里

- [库规模与缓存预算](docs/research/library-census.md)：227活动、19,536图片候选；图片双缓存约8.52GB样本外推／35.16GB保守规划场景。
- [离线交互概念](docs/design/concepts.html)：暖白Swiss主方案、暗色灯箱、隧道与照片墙演示。
- [产品约定](docs/PRODUCT.md) · [推进路线](docs/ROADMAP.md) · [已确认决策](docs/decisions/0001-foundations.md)。
- [索引、WebDAV与provider研究](docs/research/architecture-providers.md) · [格式、色彩与媒体实验](docs/research/media-pipeline.md)。

技术方向已确认：Python API＋独立worker＋React；SQLite放本地盘，暂不拆年表；识别在本地运行；先SDR后原生HDR；首版单馆主密码。

## 本轮可运行工具

需要Python3.11+与uv。只有媒体实验需要系统`exiftool`、`ffmpeg`、`ffprobe`；Python媒体依赖锁定于`uv.lock`。本机核验版本与覆盖范围见媒体报告。

```bash
uv sync --extra media
uv run --extra media python -m unittest discover -s tests -v
uv run python tools/inventory.py --root '/Volumes/Farmer.local/工程/拍照片' --workers 4
# 中断后加 --resume；新快照不加 --resume
uv run python tools/report_inventory.py
```

报告生成需要已完成的`data/research/inventory.json`与媒体实验`results.json`。媒体实验使用明确样本manifest，详见 [发现与容量验证skill](.agents/skills/photo-museum-discovery/SKILL.md)。生产增量刮削、Range续传、网站鉴权、视频播放与Docker尚待实施。

概念可直接打开`docs/design/concepts.html`；若需本地预览：

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs
```

浏览器访问`http://127.0.0.1:8765/design/concepts.html`。仅服务docs，不暴露私密数据目录。验收方法见 [设计复审skill](.agents/skills/photo-museum-design-review/SKILL.md)。

所有原始清单、元数据、小样图片、缓存、凭据和本地SQLite均不得提交Git；项目根`AGENTS.md`记录常驻约定。
