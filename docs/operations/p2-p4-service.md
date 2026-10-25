# 媒体、展览与本地策展运行

当前入口为 `http://127.0.0.1:8790`，`#manage` 打开馆务。只读 WebDAV；密码、源配置、SQLite、模型、照片和截图放被忽略的 `data/`。首次设置馆主密码由用户在网页完成。

## Mac / Linux

```bash
uv sync --locked --all-extras
npm ci --prefix web
npm run build --prefix web
uv run --all-extras python tools/prepare_models.py
uv run --all-extras python tools/prepare_geography.py
uv run --all-extras python tools/prepare_photography.py
uv run --all-extras python -m photo_museum
```

系统需要 ExifTool、ffprobe、包含 zscale/libx264 的 FFmpeg。Mac 本次采用 Homebrew `ffmpeg-full`，程序优先使用 `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`，没有修改全局 ffmpeg 链接。可通过 `MUSEUM_FFMPEG` 指定其他构建。Linux 可安装发行版 ffmpeg、libimage-exiftool-perl。Python、前端依赖由 `uv.lock` / `web/package-lock.json` 锁定。

模型下载是明确的独立步骤，校验 `docs/research/model-manifest.json` 的 SHA-256；模型推理阶段不联网。GeoNames 下载公共城市数据，不上传照片或 GPS。未安装智能依赖/权重时媒体服务仍能运行，相关子项显示已检查/未启用；不会生成假的识别结果。

摄影风格/主题使用可选的独立CLIP模型及worker，来源锁在photography-model-manifest.json。已有照片只用本地预览补分析，不重跑主体/人脸/评分、不重新下载NAS原图；缺失缓存记录需处理。候选和相似度不是确定事实或正确率。见[实现与复验](../research/photography-style-topic.md)。

API、目录 worker、媒体 worker、智能 worker 分进程。停止 supervisor 会停止其子进程；媒体 codec 子进程也会终止。恢复使用相同数据目录。文件下载只有强 ETag 才接续字节；否则安全重下。一次未完成文件不发布半成品缓存。

## 管理页

- 默认“刮削目录”显示成功发现的全部目录，不再将少量扫描批次误作目录列表。每行统计一级主题目录直接包含的文件，所有二级目录及其中的文件都不列出、不处理。原片目录按既有排除规则不出现。
- “扫描批次”保留原任务暂停/恢复/取消。“暂停媒体处理”控制媒体与智能队列；正在执行的不可分割 codec/模型调用在安全边界停下。
- 圆环是完整处理目录 / 已发现目录；须枚举完成且直属文件全部完成、无错误才计入分子。无直属文件目录按空任务完成。顶部完整处理和待处理文件数反映媒体与分析进度。
- 竖条是单张照片全部子任务合并后的进度。下载占一个子项，以实际字节分数计算；其他子项完成才贡献计数，不伪造模型或编码的内部百分比。它表示工作项完成度，不表示剩余耗时。
- 后台持久保存完整文件完成事件，前端按游标接收。每张从 0 到 100 逐根点亮，再显示下一张；完成事件积压时缩短点亮间隔，不阻塞后台。当前正在读的目录另外显示在图表下方。开启系统减少动态效果时直接完成定位。
- EXIF、4K、缩略图、写入索引、地址、主体、人脸、构图评分全部检查结束才产生完整完成事件。无 GPS 或未启用模型的子项也点亮，但 tooltip 明确“无数据/未启用”。未发现人脸不等于识别失败。
- 最近 20 项照片条固定在屏幕底部、铺满宽度。完成动画结束后推入新项并向左缓动。hover / 键盘焦点临时预览；点击固定，Esc/关闭按钮/点外部关闭。只加载本地转换的 4K SDR，不访问 NAS 原文件。视频预览是中帧静态图。
- 整页不滚动，目录/文件/错误/人物和设置面板内部滚动。纯黑黄褐，所有 slogan 删除，品牌仅在管理页。

## 缓存与格式

默认 80 GiB，可通过 `/api/cache/budget` 设置 4–200 GiB；需暂停媒体写入后修改。缓存预算包含临时下载/编码空间。常驻仅显示图（最长边 3840、WebP quality 80）和缩略图（640、quality 74），不放大低分辨率源。兼容全尺寸 JPEG 仅在暗房请求时临时生成，响应结束/取消即删除。

ICC 转 sRGB；Mac 的 HDR/gain-map 成片优先用 Apple 原生 SDR 解码（macOS14+、Command Line Tools），纯 PQ/HLG 的便携路径保留高位深并使用 203 参考白。不能用辅助图标签误判 SDR 主图，也不能把 SDR gain-map 基底再次展开并映射。HDR 基底 gain map 在无可靠解码器时保持需适配。缺失色域标记的成片按 sRGB 假定并降 15 分，原始分数保留。策略、环境边界和定向重建见 [SDR 修复](../research/gainmap-sdr-validation.md)。

超大图片（>256 MiB 或 >1.1 亿像素）和超大视频（>2 GiB）仅索引并使用预制 SVG 占位；已知大小超限不 GET，不做主体/人脸/评分或精选。普通 Live 候选可抽取 SDR 中帧，不再预制播放转码；播放按需从 NAS 原路径读取，依赖浏览器原生解码。原图浏览代理仍限制单请求 256 MiB / 120 秒；未提供按需视频转码。

满预算淘汰可重建预览，近期访问有保护时间；索引与人工修订不被淘汰。迁移、版本边界及已验证的清理/定向重试命令见 [缓存与 HDR 策略](../research/preview-cache-hdr-policy.md)。全库后台处理完成度必须另查当前状态。

## 本地策展

YuNet 检测、SFace 特征聚类、MobileNetV3 主体标签在本机运行。人物组默认匿名，用户命名、拆组或移组；框线标识被分组的具体人脸。人工分组和名字不会被模型升级覆盖。

评分是公开的清晰度、曝光、对比度、三分构图启发式；不是人类喜爱概率，也不是训练过的审美模型。Cover Flow封面严格采用有效技术分Top10，人工标记不改写排名；器材馆可另外筛选已标记照片。照片档案中可查看推断来源，接受/忽略近邻建议。未来模型可替换 provider，不要求 OpenAI API。

P5四展厅从Gallery菜单进入；离线世界几何随前端打包，不需要地图API key或联网瓦片。数据只从本地索引/双缓存聚合，无需重新扫描。详细来源、验证与首版范围见[P5报告](../research/p5-exhibition-validation.md)。隔离验证可用可信本地环境变量`MUSEUM_WEB_DIST`指定另一个Vite构建目录，默认仍为`web/dist`；正式运行不设置此覆盖值。

GeoNames 只提供最近城市（默认距离上限 100 km，可在 Settings 调整），国家/省/城市；没有街道和区域证据就保留空值。地址保留 GPS 输入记录、原始/推断层与精度；GPS 改动后旧地址不作为当前有效结果。数据署名：GeoNames，CC BY 4.0，https://www.geonames.org/export/ 。

## Docker

```bash
docker build -t photo-museum:p4 .
docker compose up -d
```

默认只发布 `127.0.0.1:8792`，容器非 root，数据使用具名卷。镜像提供目录、SDR媒体、Gallery和管理页；基础镜像不安装体积很大的 PyTorch 智能依赖，完整 P4 在本次 Mac 的 all-extras 环境运行。自定义 CPU/GPU 智能镜像的依赖与性能仍应单独验证，不能把 Mac 结果当作 Docker 智能推理结果。

容器首次初始化仅在 loopback 发布的前提下使用 `MUSEUM_CONTAINER_SETUP=1`；不要将未初始化服务直接发布到外网。LAN 部署需配置正确的 `MUSEUM_HOSTS` 和受信 TLS。

本次测试创建了专用 Colima profile `photo-museum`、context `colima-photo-museum`；不会部署到其他 Docker 主机。VM DNS 启动时缺少 systemd-resolved 的目标文件，在该专用 VM 内补了解析器配置；宿主 DNS 未修改。若重启后再次失效，修复此 profile 的 DNS 再构建。

## TLS 与备份恢复

```bash
MUSEUM_HOSTS='museum.example:8790' uv run --all-extras python -m photo_museum \
  --host 0.0.0.0 --certfile /path/cert.pem --keyfile /path/key.pem
uv run --all-extras python -m photo_museum.backup backup data/server /private/backup-new
uv run --all-extras python -m photo_museum.backup restore /private/backup-new /private/restored-new
```

备份包含 SQLite 与 NAS 凭据加密密钥，必须私下保存；不包含派生缓存。会去掉会话。恢复目标必须不存在；校验 SHA-256 和 SQLite 完整性，租约/缓存队列重建，保留源与馆主密码、人工策展。

本次只验证服务端 TLS、明确受信测试证书和 Secure cookie；没有修复 Farmer:5006 的证书，真实 NAS 沿用用户授权的内网 HTTP:5005。Safari/Chromium HDR 物理亮度、HDR 屏幕和真实移动设备需单独验收；当前正式基线仍是 SDR。

## 最新范围与顺序（覆盖上文较宽的初版行为）

目录路径倒序，同一目录文件名倒序；等当前目录的媒体与本地分析结束后再进入下一目录。缓存/分析失败为终态“需处理”，保留重试入口，不阻塞下一目录。列表上方固定显示当前目录和完整完成数量。

只扫描照片根目录和一级主题目录的直属文件。主题内 `跑山视频`、`Photomator` 等所有二级目录都不列举、不处理其中任何文件。迁移006将已有越界条目标记 `scope_excluded`，移出任务/API/图库；没有标记为NAS删除，也不删除已保留的本地历史或NAS内容。本次范围变为227个一级主题＋根目录，20,137个直属候选；旧快照中的11个二级目录及1,462个文件退出范围。

同目录没有同名成片的视频只保留WebDAV得到的文件名、大小、修改时间、版本和主题，状态为 `indexed`。不会GET原视频、ffprobe、抽帧、转码、主体/人脸分析；没有缓存就只在文件索引出现。已有同名成片的视频保留完整处理，仍需内容标识验证才能把配对称为已确认Live Photo。以后新增同名成片时，原先仅索引的视频会重新进入候选处理队列。

## 统一 Settings

`/#settings` 集中文件源、Provider、GPS、显示和缓存。已有凭据不会回填；密码/key留空保留。Provider地址改变需重填key；文件源地址/根目录改变需新建源。GPS规则保存后由分析进程增量重算本地地址，无NAS GET；媒体暂停时一同暂停。按需原图和HDR只影响查看请求，缓存保持SDR，不引发重刮。详见[Settings验证](../research/unified-settings-validation.md)。
