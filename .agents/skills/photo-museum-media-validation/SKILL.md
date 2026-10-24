---
name: photo-museum-media-validation
description: 复验 photo-museum 正式媒体缓存、Gallery、单图进度与本地策展；区分合成回归、真实 NAS、Docker 和 HDR 硬件证据。
---

# 正式媒体与馆务复验

先读 docs/STATUS.md、docs/operations/p2-p4-service.md 和 docs/decisions/0004-processing-and-local-curation.md。当前是 React/DOM + CSS 透视，不是历史整页 WebGL 原型。

- 用 `uv run --all-extras pytest -q` 验证协议、媒体、缓存、完成事件与人工数据保护；`npm run build --prefix web` 产出正式静态包。媒体依赖 ExifTool/ffprobe，HDR 视频另需带 zscale 的 FFmpeg。
- 独立运行 `PYTHONPATH=. uv run --all-extras python tools/p2_validation_server.py`（8793），再运行 `node web/tests/gallery.mjs`。它使用合成 JPEG 和 fixture WebDAV，不读真实凭据；公开截图在 docs/design/previews/gallery。
- 馆务检查重点：100dvh 无整页滚动，239 等目录数必须来自实际数据；扫描批次不是目录列表。每张完成事件逐根 0→100，所有子项点亮；跳过项仍注明无数据/未启用。底部最新 20 项、不漏掉快速完成事件、左移缓动、hover/点击 4K、Esc、减少动态效果、390px/720px 窗口都要覆盖。
- Gallery 检查同月多活动、年度无伪造月份、十图、4K 优先/原图解码后显影、关闭后焦点恢复。公开截图只用合成图；真实 NAS 截图写 data/。
- 旧 P1 UI 回归使用 tools/p1_validation_server.py（8791），进入“扫描批次”检查暂停/恢复。用环境变量将当前截图与证据写入 p1-current，避免覆盖历史报告。
- 模型下载单独运行 tools/prepare_models.py，锁定 manifest SHA-256；运行时不下载。真实识别只能验证本地运行及结果生成，不能声称人物聚类/审美已获用户认可。GeoNames 是近似城市，不是街道事实。
- Docker/TLS/备份按运行文档做隔离验证，不能用全量生产密码/私密照片构建镜像。当前基础镜像未含 PyTorch；Mac P4 推理不能算作 Docker AI 验收。

真实源沿用已保存的加密配置，不读取钥匙串、不打印凭据。HTTP:5005 的授权仅用于当前内网验证，不自动关闭 HTTPS 校验。结束时保留用户要求的正式服务及运行队列，打开 8790/#manage；停止自己的 fixture。报告以本轮结果为准，不把旧截图/旧测试数当成当前证据。

最新范围：仅照片根目录与一级主题直属文件；二级目录不能PROPFIND/GET。独立视频无同名成片时只做索引、零GET，新增同名成片后才重新入候选队列。tests/p1/test_scope.py 覆盖旧数据迁移、范围404和这些零下载断言。逐目录倒序等待分析完成的测试在 test_processing.py。历史239目录不是当前范围，应读取当前状态（本次为227主题＋根目录）。

容器内运行隔离pytest时需设置 `MUSEUM_HOSTS=testserver`，生产镜像默认只接受8792的loopback Host，不能把测试Host被拒绝误判成登录故障。测试依赖仅装入一次性容器，基础镜像不带pytest。等待fixture输出“ready”或HTTP可用后再开始浏览器脚本，避免把准备期间的连接拒绝当作页面失败。


缓存迁移与 HDR HEIC 复验先读 `docs/research/preview-cache-hdr-policy.md`：停 supervisor 后等待租约过期，先 dry-run `tools/apply_preview_policy.py`，再以 `--apply --receipt data/...json` 执行用户已授权的缓存清理和定向重试，随后恢复 supervisor。收据只放忽略目录。验证缓存账本仅 thumb/display、兼容原图响应后临时目录为空、占位文件零 GET 且不参与分析/精选。用真实主图 NCLX 区分 PQ 与辅助图误标；合成 HLG 灰阶测试不能当真实 HLG HEIC 或 HDR 屏幕验收。入队数量不能当完成数量，交付前重新按收据统计状态。
