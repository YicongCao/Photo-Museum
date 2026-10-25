---
name: photo-museum-media-validation
description: 复验 photo-museum 媒体缓存、Gallery/P5展厅、P6策展助理与本地策展；区分合成回归、真实 NAS、真实provider和硬件证据。
---

# 正式媒体与馆务复验

少量媒体失败的实测诊断见docs/research/failed-media-compatibility-diagnosis.md：先只读当前media_jobs和entries确认状态，再在独立TemporaryDirectory用现有WebDAV下载器复现metadata/still完整异常；私密消息/路径留data。ValueError/OSError不是根因。JPEG的“bytes not processed”不等于缺失字节数；检查主流EOI并只对临时副本补标记复测，不全局打开容错。HEIF区分容器引用限额、主图NCLX/ICC和HDR，不把辅助信息当主图；原生成功须再生成并重开thumb/display验证。保留正常队列，清理诊断原文件；Mac成功不代表Linux/Docker通过，诊断不自动授权全库重刮。


烟色玻璃时间线复验见docs/research/timeline-smoke-glass.md：隔离P5 fixture运行web/tests/timeline-material.mjs与timeline-material-contrast.mjs，检查黑底实测像素、全白/缺失缩略图对比度、月份固定、源图切换和Blob撤销。再用timeline-preview.mjs与coverflow-light.mjs回归。字体/材质截图须等待对应图片解码及自身淡入完成；镜面像素比较串行运行，沿用既有容差，不因并行GPU抖动随意放宽。

正式页刷新后先等鉴权和图库初始化完成再判断会话是否失效；当前App初始化期间可能短暂渲染密码表单，不能据此立即要求馆主重新解锁。不要读取密码、cookie或钥匙串来验证会话。

档案字段与风格覆盖复验见docs/research/archive-refinement.md：隔离P5 fixture运行node web/tests/archive-refinement.mjs，区分SDR/HDR标签、等效焦距缺失、城市/GPS记录变更、无坐标文本及EXIF/生成数据同样式。tools/audit_photography_style.py只读正式SQLite和本地缓存，禁网抽样复测当前模型门槛，不写回标签；明细留data，仅汇总入docs。截图须等待入场完成，不能把DOM存在误当已绘制。

统一主导航复验见docs/research/navigation-unification.md：隔离P5 fixture运行node web/tests/museum-nav.mjs，覆盖三大入口及策展页、5种视口、日夜、全屏跨页和锁定。只能在合成会话测试登出；不要锁定用户正式浏览器来验证按钮。旧测试中的Dashboard/Settings现在用语义link选择器，Gallery在自身页面仍为展厅menu按钮。

四款Cover Flow、概念截图对照及四个创意展厅见[创意展厅复验](references/creative-gallery.md)。

统一文件源、LLM、GPS、原图/HDR和缓存偏好的隔离验证见[Settings复验](references/settings.md)。

P5日历、离线地图、器材馆与独立时空隧道的隔离构建、fixture及回归见[四展厅复验](references/p5.md)。真实用户密码由用户输入；公开证据仅合成图库。

P6自然语言策展、TokenHub流式tools、集合范围与真实接口小样见[策展助理复验](references/p6.md)。真实LLM测试只发送合成索引，私密图库检索使用禁网只读模式，不能把界面展示当作模型选片质量通过。

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

经典Cover Flow专项复验：`PYTHONPATH=. uv run --all-extras python tools/coverflow_validation_server.py`（8794，24活动/432合成图，准备需数分钟），ready后运行 `node web/tests/coverflow.mjs`。覆盖5–20封面、严格Top10后端测试、预取15项不取原图、飞散/中心落位及克隆清理、返回保位、档案合并、浏览器内铺满和减少动态效果。公开证据只用合成图。用户要求验收Gallery时留8790/#gallery，后台刮削继续；真实截图仅存data。

手动IAB验证fixture时使用 `http://localhost:8793` / `http://localhost:8794`；正式页使用 `127.0.0.1:8790`。Cookie不区分端口，同主机名的fixture登录会覆盖正式会话；自动Playwright须始终使用独立browser context。倒影/展签专项运行 `node web/tests/coverflow-polish.mjs`，以像素遮挡与桌面/390px横排位置检查确认，不只检查CSS值。

Timeline气泡复验：`node --test web/tests/timeline-collage.test.mjs` 与 `node web/tests/timeline-preview.mjs`（8793合成fixture），再跑既有 `web/tests/timeline.mjs` 检查Dock。重点确认评分顺序、3/4/5拼贴统一尺寸、列表裁切之外的锚定、快切/收起Blob释放、零NAS原图请求、720px可读性、键盘与减少动态效果。

中文显示复验见docs/research/chinese-labels-validation.md：后端tests/p1/test_localization.py验证原数据/置信度不变、歧义回退与GPS过期隔离。以MUSEUM_VALIDATION_CHINESE=1启动8793 fixture后运行web/tests/chinese-labels.mjs，核对Dashboard及单图档案。词表再生工具只读公共数据，须核验来源SHA-256并保留GeoNames/Chinese-CLIP/timm许可；不为显示翻译升级模型版本或触发全量重刮。

HDR/gain-map SDR 修复见 docs/research/gainmap-sdr-validation.md，运行 tests/p1/test_hdr_sdr.py。Mac 原生 helper 需 macOS14+/Swift，显式请求 SDR，不先展开 gain map；编译物在数据目录，转换 PNG 在临时目录。合成 HEIC 编码须使用 transfer_characteristics（复数）并读回 NCLX 断言，文档中的单数参数会被 pillow-heif 忽略。真实对照分别检查 SDR 基底 gain-map 与纯 PQ，不将两者混称；白色比例只是同图辅助指标。定向重建用 tools/apply_hdr_sdr_policy.py，停 supervisor 等租约过期后先 dry-run 再 apply，保留私密收据；HDR 单独版本，不能升级全局 VERSION 导致全库重刮。完成后确认新版本 ready、分析重算、完成事件、thumb/display 账本和正常队列继续，入队数量不是已完成数量。

摄影风格/主题见 docs/research/photography-style-topic.md。显式执行tools/prepare_photography.py准备独立权重，核验官方SHA-256后转换safetensors，运行时禁止下载。tests/p1/test_photography.py验证独立版本补分析、暂停/重试、目录等待、过期预览竞争、缺失缓存零GET及人工/既有视觉结果不变。MUSEUM_VALIDATION_PHOTOGRAPHY=1启动8793 fixture，ready后运行web/tests/photography.mjs；等待入场动画结束再截图，不把DOM可见误当作视觉稳定。真实样本只读本地thumb/display并阻止网络，记录未知比例，不能把覆盖率当准确率。摄影pipeline参与完整处理计数；未知候选是已检查，错误不能冒充完成。结束时停止fixture并保留正式supervisor和用户当前Gallery页面。

Cover Flow日夜模式专项：先隔离构建至data/cover-light-validation/web-dist，以MUSEUM_FIXTURE_PORT=8798、MUSEUM_WEB_DIST指向该目录及PYTHONPATH=.运行tools/p5_validation_server.py，ready后执行node web/tests/coverflow-light.mjs。核对白底文字≥4.5:1、照片裁片像素不变、倒影不透后图、Portal气泡主题、重载/墙返回保位、390px和矮窗口、禁用storage及键盘操作。范围仅Cover Flow首页，暗房等仍黑底。公开截图仅合成源，结束停止8798，保留正式8790 Gallery；记录见docs/research/coverflow-light-validation.md。
