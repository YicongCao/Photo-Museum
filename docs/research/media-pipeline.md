# 媒体管线与缓存实测

核验日期：2026-10-24（Asia/Shanghai）。状态：设计提案 + 本机小样本验证，尚不是生产媒体服务。所有原文件只读；未向外部服务发送照片。

## 一分钟读懂

- 成片判断应以目录规则和人工覆盖为主，格式只提供线索。HEIC 不等于原片，JPEG 也不保证是成片；顶层 ARW/DNG/HIF 混放必须进入明确规则或复核。
- 推荐默认缓存为 **sRGB、SDR、WebP，长边 3840 / 640 像素，不放大、不裁切**。这里“4K”指长边 3840，竖图不是强制横向 3840×2160；全屏墙的裁切由前端展示策略决定。
- 20 张照片、2 段视频的小样本共从 NAS 复制 **278.77 MB**。17 张照片可按 SDR 管线转换；3 张带 HDR/增益图需另行验证；2 段 MOV 都是 HDR，当前未生成合格的 SDR 视频缩略图。
- 17 张成功样本的两份缓存合计平均 **0.436 MB/张**，最大 **1.139 MB/张**。按此均值每 10 万张约 43.62 GB；容量规划建议另用 **1.5 MB/张** 的保守场景，再留 20% 余量，而不要把这 17 张当全库无偏样本。
- 文件名盘点得到 **19,536 个候选图片文件**。代入上述样本均值，双缓存约 **8.52 GB**，加 20% 约 **10.23 GB**；保守场景为 **35.16 GB**。这不包括视频转码、临时下载、数据库、人脸/向量索引，也不是已确认的去重成片数量，但静态缓存当前看来无需接近 200 GB。
- WebP 适合作为通用 SDR 层。保留成片的原始 HDR/广色域文件在 NAS 上；用户打开大图时才按设备能力请求原生版本或经验证的 HDR 派生版本。
- **降低位深不是 HDR→SDR 色调映射，贴上 sRGB 标签也不是色彩转换。** 此处故意将不确定 HDR 任务延期，防止“生成文件成功”掩盖灰白、过曝或暗片问题。

## 事实与实现边界

### 文件角色与内容识别

目录规则依次考虑：人工指定包含/排除 → 明确标注原片的子目录 → 文件实际容器/编码 → 顶层成片默认规则 → 待复核。排除目录保留一条规则及统计证据，不逐个解码其中 RAW。`.ARW/.DNG/.CR3/.NEF/.RAF` 等作为原片候选；`.HEIC/.HEIF/.HIF` 可以是相机直出或编辑导出的成片。应通过 ExifTool 或解码器确认实际格式，不能仅改后缀或只用 MIME 猜测。

一张照片可以有多个物理资源：显示静态图、Live Photo 动态部分、XMP/AAE 调整文件。照片资产与资源分别建模，避免将同一 Live Photo 计作两张照片，也避免丢失独立视频。目录名、EXIF 时间与文件修改时间应分别保存；目录年份不能覆盖实际拍摄日期，缺月份不能编造为 1 月。

#### 盘点中的特殊扩展名核验

2026-10-24 从只读 `data/inventory.sqlite3` 查询到 46 个 `.photo`，全部位于两个活动的 `Photomator/` 子目录，分别 36 / 10 个。每个活动抽一例：78,784,355 bytes 和 70,578,450 bytes；文件头均为 ZIP 的 `PK\x03\x04`，首项 `metadata.info` 是 SQLite 数据库。只读 ZIP 中央目录后确认它们分别有 5 / 4 个条目，包含 `data/*-OriginalContentSource`、`QuickLook/Thumbnail.webp`、`QuickLook/Icon.webp`。这是本地文件结构的实际观察，不能因后缀含“photo”就当作照片格式。

据此建议把 **`Photomator/*.photo` 标为编辑工程/附属资源**，保留到同 stem 成片/原片的关联候选，不索引内部原始内容为独立藏品，也不把 QuickLook 预览当最终成片。只抽查了两例、没有逐个解码 46 个文件；其他位置出现未知 `.photo` 时仍进入复核。抽查只读取头及归档目录，没有解压媒体；带读取计数的验证合计读取 1,801 bytes（应用层，WebDAV 挂载底层网络取数未测量）。证据保存在 ignored `data/research/media-photo-extension.json`。

另有 234 个 `.LRF` 和 151 个 `.SRT`，先按视频代理资源与字幕 sidecar 建模，不当独立藏品；后续按同目录 stem、时间和资源元数据映射到主视频，孤立资源保留未关联状态，不删除。5 个 `.webm` 应进入视频候选，随后探测容器和编码；不能因为不是 MP4/MOV 就遗漏。以上计数来自该次盘点，新增文件后需重查。

### 色域与动态范围是两条轴

Display P3 与 sRGB 都是色域/色彩空间选择；广色域不自动意味着 HDR。10-bit HEIF 也可能是 SDR，本次就读到了具有 sRGB transfer characteristics 的 10-bit HEIF。需记录 ICC、NCLX/CICP primaries、transfer、matrix、range、原始 bit depth、HDR/gain-map 标记和解析器版本。

有 ICC 时，用 LittleCMS/libvips 的 ICC transform 把像素从源空间变换到目标空间，再嵌入目标 ICC。无 ICC 时按照明确 NCLX 或标准 sRGB 声明处理；未知来源进入待复核，不悄悄套 sRGB。此次包含 Adobe RGB、Display P3、sRGB，Pillow 的 ImageCms 实际使用 LittleCMS2。[Pillow ImageCms](https://pillow.readthedocs.io/en/stable/reference/ImageCms.html) · [libvips ICC transform](https://www.libvips.org/API/current/method.Image.icc_transform.html)

WebP 容器能存 ICC；常规 WebP 缓存走 8-bit RGB(A) / SDR，不把它作为跨浏览器 HDR 交付格式。[WebP 容器规范](https://developers.google.com/speed/webp/docs/riff_container)

HEIF 解码能力来自 libheif 及其编解码插件，不是安装一个 Python 包就保证处理全部 HEIF 变种。Pillow-Heif 的 `convert_hdr_to_8bit` 文档只说明 10/12-bit 解码到 8-bit；不能据此声称做过正确的色调映射。[libheif 项目](https://github.com/strukturag/libheif) · [Pillow-Heif API](https://pillow-heif.readthedocs.io/en/latest/reference/API.html)

### HDR 处理提案

先区分 SDR 主图 + gain map、PQ/HLG 单层 HDR、元数据不完整三种输入。

1. SDR 主图 + gain map：如果已确认主图是合法 SDR 基底，可以直接从该基底做 SDR 缩略图；必须保留原始 gain map 资源。未经确认不能随意取第一帧/第一图像项作为 SDR。
2. PQ/HLG：在高精度线性域完成 tone map 和 gamut map，再输出 sRGB SDR。不能先截成 8-bit 再处理；需要参考亮度/headroom 策略和参考图验收。
3. 元数据缺失或冲突：任务状态为 `needs_review` / `unsupported_color`，展示占位及原因，不标记成完成。

Mac 可实现 ImageIO/Core Image provider，利用 Apple 的 gain-map、headroom 和系统 tone-map 接口；Linux/Docker 实现可依赖经构建验证的 libheif + 支持 zscale/libplacebo 的 FFmpeg 或专门 HDR 库。二者输出须用同一测试图集验证，不要求逐像素相同，但必须对曝光、高光、肤色和旋转达成可接受的一致性。[Apple HDR 工作流](https://developer.apple.com/videos/play/wwdc2024/10177/) · [Apple HDR rendering](https://developer.apple.com/documentation/coregraphics/adopting-advancements-in-hdr-image-rendering) · [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html)

本机 `ffmpeg -filters` 有 `colorspace` / `tonemap`，**没有 `zscale` / `libplacebo`**。所以目前不能直接验证常见的 `zscale → tonemap → zscale` 命令；尚未验证跨平台 HDR 缩略图。不要把这一实验结果升级为“Linux/Docker HDR 已支持”。

### 原生浏览器显示与回退

Safari 17 官方加入 HEIC 支持；Safari 26 在相应系统版本上加入 HDR 图片支持。两条能力不同，不能把“能解码 HEIC”当成“以 HDR 显示”。[Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) · [Safari 26 HDR images](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)

拟采用三层选择：常规主题列表统一 SDR WebP；大图先即时显示 4K WebP，再按能力与用户偏好请求原生成片；原生失败立即回退 WebP。用真实解码小样本探测 HEIC，结合 `dynamic-range`、`color-gamut`、视频 `MediaCapabilities`。CSS media query 只能说明显示能力的一部分，并不能证明当前文件的 codec/profile 可播放。用户可明确切换“兼容显示 / 原生画质”，让错误或耗时回退可理解。[Media Capabilities](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capabilities_API) · [dynamic-range](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/dynamic-range)

标准浏览与照片墙保持 SDR，避免 HDR 照片在混排中刺眼；沉浸大图可启用原生 HDR，并尊重系统减少动态效果、屏幕亮度和省电状态。对原生 HEIC/HDR 的支持最终需要在用户实际 Mac Safari、Chrome 与移动设备上验收；本次没有进行这些浏览器色彩验收。

### Live Photo 与视频

优先将静态图和 MOV 内的 Content Identifier 关联；同目录同 stem 是用户整理约定下的强线索，但若 metadata 冲突、多个同名派生或长度异常则留待复核。保留 `pair_method`、`confidence`、人工覆盖，重刮削不能覆盖人工确认。ExifTool 支持 Apple `ContentIdentifier`、`LivePhotoVideoIndex`，后者与对应 timescale 一起解释，不能直接当秒。[ExifTool Apple tag implementation](https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/Apple.pm) · [Apple pairedVideo](https://developer.apple.com/documentation/photos/phassetresourcetype/pairedvideo)

Web 上用静态图 + `<video playsinline>` 实现短暂播放，点击/按住播放并提供键盘按钮；自动预览默认静音，音轨由用户开启。优先直送浏览器支持的 MOV/MP4 资源；不支持时按需转 H.264/AAC MP4 SDR。不要把全部 Live Photo 视频预转码进主缓存。

独立视频需索引时长、编码、分辨率、旋转、帧率、音轨、色彩及 HDR 字段，默认抽取 `duration / 2` 的一帧；黑场可选检测后向附近寻找帧，并记录实际时间。转码与抽帧使用有限临时文件；避免通过 WebDAV 反复随机 seek 导致整段远程文件重复读取。播放端实现 Range/206、Content-Range、ETag/If-Range、416，以及取消请求后的上游中止；仅加 `Accept-Ranges` 响应头不算实现。[HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)

本次两段 MOV 的元数据读取成功，但均为 HLG/BT.2020，SDR 抽帧被暂缓。它们没有同 stem 成片，属于独立视频样本；**真实 Live Photo 配对、动态播放及兼容转码均未验证**。

## 小样本实验

工具：[tools/media_probe.py](../../tools/media_probe.py)。测试：[tests/test_media_probe.py](../../tests/test_media_probe.py)。输入清单与所有照片只保存在 ignored `data/research/`，不纳入 Git。没有调用外部照片分析 API。

可复现环境：Python 3.11.17、Pillow 12.2.0、pillow-heif 1.3.0（libheif 1.21.2 / libde265 1.0.16）、ExifTool 13.55、FFmpeg 9.0.1。这里是实验固定版本，不代表以后生产版本应不经安全更新持续锁死。

采样方法：从 2014、2019、2023、2024、2025、2026 的七个活动目录顶层，按排序挑首张及中间张 JPEG/HEIC，再加入四张 iPhone 候选。共 20 张照片、2 段小于 250 MB 的独立视频；无全库图像解码、未进入原片目录。它覆盖多种设备和分辨率，但不是按全库格式比例加权的随机样本，也没有覆盖所有夜景、连拍、超长全景、裁剪图或所有 HDR 变体。

结果：

- 源文件实际复制：278,773,687 bytes（278.77 MB，约 265.86 MiB）。
- 成功 SDR：17 张；HDR/gain-map 暂缓：3 张；HDR 视频暂缓：2 段。无已报告的解码/编码错误。
- 4K WebP（quality=78 / method=4）：平均 411,484.59 bytes，中位 356,254 bytes，最大 1,090,128 bytes。
- 640 WebP（quality=72 / method=4）：平均 24,753.29 bytes，中位 21,900 bytes，最大 49,332 bytes。
- 两份合计：平均 436,237.88 bytes，最大 1,139,460 bytes。
- 本机单张解码、色彩转换、缩放、两份编码平均 0.895 秒；**不含 NAS 下载时间、ExifTool、磁盘队列等待、人脸/语义分析**，不能据此承诺全库完成时间。
- 所有成功输出验证了：能重新解码、像素边长符合配置、不放大、存在 ICC、不携带源 EXIF。四组原始解码参考与 WebP 并排检查了方向和明显色偏，未发现明显异常；这不是精密色度测量或 HDR 显示验收。

完整实验记录：`data/research/media-probe/results.json`。视检图：`data/research/media-probe/contact-sheet.jpg`、`source-output-comparison.jpg`。第一张联系图覆盖初始 16 张；对比图覆盖 Adobe RGB、Display P3、10-bit sRGB HEIF 和高分辨率 JPEG。为避免误导，对比图中的“原始解码参考”已做正规 ICC→sRGB 以便同屏比较，并非 HDR 或原生广色域显示截图。

实验重跑：

```bash
uv run --extra media python -m unittest discover -s tests -p test_media_probe.py
uv run --extra media python tools/media_probe.py \
  --manifest data/research/media-manifest.json \
  --output data/research/media-probe
```

该工具以相对路径完成记录跳过已测文件，用于同一冻结样本的断点实验；**不是生产的变更侦测器**。源文件变更或编码策略变更需新建输出实验目录，生产系统须以源指纹和策略版本失效旧缓存。

## 缓存容量与生命周期提案

先用全库盘点得到成片数 `N` 和独立视频数 `V`。静态图缓存估计为 `N × (4K均值 + 缩略图均值)`；视频缩略图另加 `V × 缩略图均值`。Live Photo 的静态图只计一次，其 MOV 不计入永久 4K 图缓存。视频转码、临时源文件、数据库、人脸/向量数据要另算，不能藏在平均每张照片体积里。

在当前实验分布下，照片双缓存约 `N × 0.436 MB`。规划用 `N × 1.5 MB × 1.2` 作为更保守场景。例如 5 万张是 21.81 GB 的样本外推，保守场景为 90 GB；10 万张分别为 43.62 GB / 180 GB。这是场景计算而非置信区间；待全库按尺寸/格式分层抽样后再收窄范围。

当前 **19,536 个候选图片** 对应双缓存 **8.522 GB（7.937 GiB）**；样本外推加 20% 为 **10.227 GB**；保守场景 **35.165 GB**。正式缓存仍应先按格式和分辨率扩大抽样，特别是未通过 HDR 的图片，以实际编码后的持续累计值更新预测。`GB=10^9 bytes`，`GiB=2^30 bytes`；这些数字是静态图派生文件预算，不是全部服务数据占用。

全库盘点后统一建议先设 **80 GB缓存硬上限（十进制）**，主图/缩略图、按需原生文件、视频转码和下载/原子写入临时空间共享此预算，不能每个池都用满。数据库和模型另列占用。当前图片可考虑全量生成静态双缓存；未来接近预算时缩略图常驻、活动精选与收藏4K固定、其余4K用LRU。此预算是运维提案，不改变NAS文件；参考[汇总与预算](library-census.md)。

缓存 key 建议为 `asset fingerprint + derivative kind + dimensions + color policy + quality + encoder version`；同一次源文件下载尽量完成 EXIF、两个缩图、局部特征等阶段。写入 `.part` 后校验、原子重命名，再提交数据库完成状态。过期任务和 `.part` 有上限与清扫策略；服务重启不把半成品算完成。暂停停止领取新任务，安全完成当前短事务；失败按项重试。空间不足先停任务并告警，不能通过删除原片解围。

## 生产前必须通过的验证门槛

1. SDR 测试集：ICC P3/AdobeRGB/sRGB、无 ICC、有 NCLX、旋转、竖图、全景、小图、损坏文件、扩展名错误；核对色彩而非仅输出尺寸。
2. HDR 测试集：iPhone Apple gain map、ISO gain map、相机 PQ、HLG、导出后缺失 metadata；确认 SDR 基底或 tone-map 结果，并在实际屏幕上核验。
3. Live Photo：真实同 ID 配对、同名但不同 ID、跨文件名配对、多个派生、一半资源缺失、静音与音轨；最终一个逻辑资产呈现。
4. 视频：中点帧、旋转、VFR、黑场、HDR、超长文件；Safari/Chrome/移动端 Range seek、网络取消、按需转码队列可恢复。
5. 跨平台：Mac 与 Linux/Docker 的 healthcheck 报告真实 codec/filter 能力；SQLite/缓存位于本地磁盘；源只读；两个 worker 不重复占用同一任务或突破预算。

上述门槛除了小样本 SDR 转换、输出结构检查和条件延期测试，尚未完成。第一版应显式显示不可处理原因，避免让“目录刮削完成”掩盖媒体派生失败。
