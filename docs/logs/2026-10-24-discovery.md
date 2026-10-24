# 2026-10-24：发现、实测和方案

初始仓库为空、无提交、无依赖锁。用户提供只读NAS源并要求整体规划与关键决策征询。按研究、媒体小样与体验概念并行推进；源目录没有写入、重命名或删除。

## 决策记录

第一轮：识别算法必须本地，模型可下载；GPS必要可联网；仅确需agent才OpenAI。首版可靠刮削＋缓存＋主题展览；暖白Swiss、暗色看图。

第二轮：Python API＋独立worker＋React；SQLite本地且不拆年表。先准确SDR再原生HDR；一个馆主密码。

## 实测

- 文件名扫描UTC10:34:22—10:38:59（本地18:34—18:38），4并发，SQLite逐目录提交。239目录完成、13排除、0目录错误。227活动，其中226排除后有文件。
- 初始分类漏列`.webm`，从既有清单重新分类5视频；LRF234与SRT151归附属资源。没有为了修正分类重新读取所有照片。
- 独立审查复现：空活动丢失于统计、主题名含“底片”误触排除。修复汇总初始化和规则作用范围，新增行为测试；实际12个原片排除项均为明确原片目录，修正规则没有改变本轮排除范围。
- 46个`.photo`全在Photomator子目录；两例只读头/ZIP目录证实编辑工程，未将其计入独立照片。
- 媒体实验显式复制278,773,687 bytes；这不是挂载文件系统的精确网络流量。17SDR双缓存均值436,237.88 bytes；3HDR照片与2HLG视频延期。4组原图ICC解码/输出对比未见明显方向或色偏，不能代替全分辨率质量与HDR实机验收。

## 验证记录

```text
uv sync --extra media
uv run --extra media python -m unittest discover -s tests -v
结果：8 tests，OK

uv run python tools/report_inventory.py
结果：19536 × 436237.8824 bytes ≈ 8.52GB
保守场景：19536 × 1500000 × 1.2 ≈ 35.16GB

quick_validate.py .agents/skills/photo-museum-discovery
quick_validate.py .agents/skills/photo-museum-design-review
结果：均 Skill is valid
```

系统Python最初缺媒体依赖，全部测试入口调整为`uv run --extra media`。skill验证器需要PyYAML，以隔离`uv run --with PyYAML==6.0.3`运行，没有添加不必要的运行依赖。

浏览器：静态docs服务返回200；1440×1000、390×844检查。手机documentWidth=390，无横向溢出；灯箱、翻页、收藏、关灯箱焦点恢复、三种展示模式和墙随机排列通过，error/warn列表为空。截图：`docs/design/previews/warm-desktop.png`和`warm-mobile.png`。概念数据均虚构。

## 后续约束

P0工具不替代正式可恢复WebDAV管线。文件大小总量、全库EXIF、live内容标识、真实视频播放、HDR转换及Linux/Docker尚未验证。下一步按ROADMAP的P1进行；用户已经确认的方向沿用。
