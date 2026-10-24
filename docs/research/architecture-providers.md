# Photo Museum：索引、可恢复流水线与可插拔分析

核验日期：2026-10-24（Asia/Shanghai）。这是实施前的架构调研与建议，不代表相关功能已经实现或在 Farmer 上验证。本项架构调研未读取照片内容，未向外部分析 API 发送照片、人脸或 GPS；本轮另有本地媒体小样本实验。

用户随后已确认：Python API＋独立worker＋React，本地SQLite且暂不拆年表；先准确SDR后原生HDR；首版一个馆主密码。文中细节接口仍是实施提案。

最新修订：[ADR 0002](../decisions/0002-immersive-viewer-and-inference.md)要求A–F观展全部在一个Three.js/WebGL画布内；React负责登录/管理与语义辅助。原图加载采用4K→NAS原始成片的受控升级；元数据首次schema即加入[原始/推断/人工/effective四层](../architecture/metadata-inference.md)。以下早期“列表/灯箱”措辞不指定DOM相册架构。

## 一分钟读懂

- **建议使用本地 SQLite，先不按年份拆表。** 对个人照片库，更早遇到的瓶颈通常是 NAS 往返、解码、缩略图生成和模型推理。数据库选择应由本项目实测规模和查询延迟验证；SQLite 的理论容量不是性能承诺。
- **刮削器应直接使用 WebDAV，每个目录一次 `PROPFIND Depth: 1` 批量取属性。** Finder 挂载可用于初步验证，但不能把逐文件 `stat`／`HEAD` 作为正式扫描方案。
- **可靠入库与 AI 增强分开。** 即使人脸、地址或评分失败，已确认的成片仍能进入展厅；失败阶段可以单独重试。每项结果保留来源、版本、置信度和人工覆盖。
- **用户已选本地优先：识别算法必须本地运行，模型可以下载；GPS 等确有需要时可接在线服务；只有确需 agent 的功能才接 OpenAI。** 第一版先完成可靠刮削、缓存和主题展览。视觉采用暖白 Swiss 排版，沉浸看图转暗色。
- **先做“展品建议分”，不要声称预测人类喜爱概率。** 一次活动的十张代表图要兼顾清晰、不同场景、时间覆盖、人物与用户收藏，不能只是模型分数前十。

## 1. 系统边界与技术栈建议

建议初始结构：浏览器 → Python API → 本地 SQLite／本地派生图缓存；独立worker访问只读WebDAV与本地provider。前端采用React＋TypeScript管理界面和Three.js/WebGL单画布观展运行时，场景共享媒体调度、纹理预算与输入。API与worker是独立进程，数据库和缓存位于同一服务宿主机本地磁盘；Docker使用本地持久卷。

选择Python的理由是EXIF、图像处理、ONNX／PyTorch等能力容易连接；React负责管理交互与展厅宿主生命周期，Three.js负责观展渲染。代价是Python与Node两套开发依赖。部署时前端编译为静态资源，由API或反向代理提供，运行环境不必常驻Node。版本应在正式基础设施提交时统一锁定，不能因本机已有新版本就直接认定所有解码器和模型兼容。

替代路线：全 TypeScript 服务减少语言数量，但媒体／ML 仍可能需要 Python sidecar；Go 服务便于分发，模型集成成本更高；现成 Immich 适合照片管理参照，其外部库会扫描外部文件，但当前文档提示路径移动可能丢失库内追加元数据。Photo Museum 对“原片排除、活动十图、叙事展览、可恢复 WebDAV”的组合要求更适合自建薄核心。该判断是产品取舍，非对现有产品整体能力的评价。[Immich 外部库](https://docs.immich.app/features/libraries/)

FastAPI 自带 `BackgroundTasks` 适合轻量请求后任务，官方也建议重计算考虑独立任务系统。这里应自建最小 SQLite 持久队列或选可验证的队列库，不能依赖 Web 请求内存来记住数小时刮削进度。首版不必为了单机引入 Redis、Kubernetes 或多机队列。[FastAPI Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)

## 2. SQLite：组织数据，不按年份分裂数据

### 已核验事实

SQLite 官方把设备本地、低写入并发的存储列为合适用途。默认 4096 字节页面下，现代版本默认页数上限对应约 17.5 TB；这是数据库文件理论边界，与本照片库性能无直接等价关系。WAL 要求使用者在同一主机，不能放到网络文件系统；读写可以并行，但同一时刻仅有一个 writer。[适用范围](https://sqlite.org/whentouse.html) · [容量限制](https://sqlite.org/limits.html) · [WAL](https://sqlite.org/wal.html)

### 本项目提案

单个 `catalog.sqlite` 保存结构化记录，照片／视频字节不放数据库。按实体分表，不按年份分表：

- `sources`、`source_entries`：来源、规范相对路径、资源类型、大小、ETag、修改时间、最近完整扫描批次、可用状态。凭据只存 secret 引用。
- `events`：活动原始目录名、展示主题、年份、可空月份、实际拍摄时间范围、目录解析规则版本。月份缺失就保留未知，不伪造一月一日。
- `assets`、`asset_files`：逻辑照片／视频与物理文件的关系。Live Photo 的静态图和 MOV 是同一逻辑展品的两个组件；同名仅是候选，关系另存 `match_method`、`confidence`、人工确认状态。
- `photo_metadata`、`video_metadata`、`devices`：常用 EXIF 字段与归一化设备，原始 metadata JSON 留作追溯。时间分别保存原始时间、已知时区偏移、可空 UTC 和推断来源；文件 mtime 不等于拍摄时间。
- `places`、`asset_places`：规范化地址层级与坐标；允许同一照片具有原始 GPS、人工地点和 provider 结果，不互相覆盖。
- `faces`、`people`、`person_assignments`：检测框、模型向量、私有人物标签、人工合并／拆分历史。
- `analysis_results`：provider、模型／配置版本、输入指纹、结果 schema、置信度、生成时间和失败状态。
- `representative_sets`、`representative_members`：每活动至多十张，保留选中原因、自动版本、用户置顶／排除。
- `jobs`、`scan_runs`、`scan_directories`、`cache_entries`：租约、重试、阶段进度、派生文件和空间预算。

优先索引 `(event_id, capture_time, id)`、`(capture_time, id)`、`(source_id, relative_path)` 唯一键、设备筛选、国家／行政区／城市 ID、任务可领取状态。分页用稳定排序键与游标，不让深页 `OFFSET` 越翻越慢。先测试十万级／百万级合成记录的主题、日期、设备、地理筛选，再决定是否需要调整。

中文主题搜索要单独验证。FTS5 `unicode61` 不能当作自动完成中文分词；trigram 可做子串检索，但少于三个 Unicode 字符的全文查询不会匹配。因此“两字城市／人物名”不能只交给 trigram；可采用应用侧中文分词／别名字段，结构化筛选优先，短文本检索另设受限路径。[FTS5 tokenizer 文档](https://sqlite.org/fts5.html#tokenizers)

向量属于可重建派生数据，最初可按模型放独立向量文件或单独表。以 100,000 张 × 768 维 × float32 为纯向量估算约 307 MB，不含索引、重复版本和人脸向量；不要先引入独立向量服务器。模型升级时必须分命名空间，不能混用不同维数／归一化方式的向量。

**升级触发条件**：真实查询 P95 未达项目目标、写锁持续争用、多台宿主机同时写、备份恢复窗口不可接受，再考虑 PostgreSQL／独立向量索引。按年份拆表会增加跨年活动、人物、地图查询和迁移复杂度，不作为默认优化。活跃数据库备份使用 SQLite Online Backup API；不能只复制正被写入的主文件而忽略 WAL。[SQLite Backup API](https://sqlite.org/backup.html)

## 3. WebDAV：发现增量与传输断点是两件事

### 已核验事实

`PROPFIND` 是 WebDAV 的属性读取方法，响应可能逐属性返回不同状态，服务器可以拒绝 `Depth: infinity`。`getetag` 是 HTTP 资源版本标记，不是通用内容哈希。RFC 6578 提供 `sync-collection`／`sync-token` 增量同步扩展，但要先检查 `supported-report-set`；不能假设每台 NAS 支持。[RFC 4918](https://www.rfc-editor.org/rfc/rfc4918.html) · [RFC 6578](https://www.rfc-editor.org/rfc/rfc6578.html)

### 正式适配器提案

1. 来源配置保存 HTTPS endpoint、根路径与用户名，密码由用户配置到受限 secret；不读取 macOS 钥匙串来导出已保存凭据。当前挂载能访问不代表 Docker 已持有可用凭据。
2. 根目录 `Depth: 1` 得到活动集合；每个待扫描子目录一次请求批量取 `resourcetype`、`getcontentlength`、`getlastmodified`、`getetag`。有限并发、连接复用、超时与退避。避免逐文件 `HEAD`、逐文件挂载 `stat`。
3. 目录进入排队后立即持久化；每个完整目录枚举带 `scan_generation`。只对成功完整列举的目录比对缺失文件。单次断网、认证失败或部分 `207` 错误不能被解释为全库删除。
4. 活动原片子目录按精确名称／可配置规则跳过；RAW 扩展名独立排除；HEIC／JPEG 不能仅凭扩展名判断成片。未知子目录进入待审查，规则命中理由可见。
5. 内容版本优先用 ETag，缺失时用大小与 mtime 作弱指纹，明确它不能证明内容未变。下载时计算内容哈希；在哈希匹配后才合并跨路径重复关系或确认重命名，不盲目按名字合并。
6. 支持 `sync-token` 时持久化每目录 token；失效时回退全量目录列表。即使有 token，也保留周期完整核对。若只看父目录 mtime，会漏掉部分后代文件修改；不能据此永久跳过旧活动。
7. 新目录发现与旧目录增量检查分别安排；最近活动优先，老活动轮巡。UI 显示“上次发现目录”“该活动最后核对”“该文件版本”，避免把“任务队列空了”说成整个来源实时一致。

**任务恢复**：一个文件的 `metadata`、`preview`、`thumbnail`、`faces`、`places`、`scoring` 分别拥有幂等任务键 `asset_revision + stage + provider_version + config_hash`。worker 领取短租约并续期；崩溃后租约过期即可重领。I/O 与推理在事务外，结果写入使用短事务。交付语义是“可重复执行、结果幂等”，不宣称分布式 exactly-once。

**字节续传**：大视频的 `.part` 记录下载字节、预期大小和资源版本。仅在服务支持 Range 且版本验证可靠时续传；收到 `200`、ETag 变化或 `416` 时按规则重启／核对，不拼接不同版本。小照片失败重下通常更简单。下载完校验大小和解码，再原子更名；随后写缓存记录，崩溃后由对账任务处理孤儿文件。暂停应在安全边界保存进度，取消不能清空已成功的结果。

默认只读来源：不改 NAS 原目录名、不写 EXIF、不删除原片、不写 sidecar。用户整理的主题名是事实输入，AI 标题是独立建议字段。

## 4. Provider 合约：最小而明确

以下为待实现接口草案，不是现有代码：

```python
class AnalysisProvider(Protocol):
    def manifest(self) -> ProviderManifest: ...
    def health(self) -> HealthResult: ...
    def analyze(self, request: AnalysisRequest) -> AnalysisResult: ...
```

`ProviderManifest` 至少声明：`id`、`version`、`tasks`、输入／输出 schema 版本、支持媒体格式、是否离线、所需运行资源、模型 ID／SHA-256／许可证、最大并发。`AnalysisRequest` 传内部 asset ID、版本、受限本地派生图路径、所需 metadata 和参数；不要向 provider 直接开放数据库连接或任意 NAS 路径。

统一结果信封：`provider_id`、`model_id`、`model_digest`、`input_fingerprint`、`config_hash`、`schema_version`、`status`、`data`、可选 `confidence`、`warnings`、`duration_ms`。结果模型与执行后端分开：例如同一模型可在 CPU／CoreML／CUDA 运行，但要记录实际后端与预处理版本。ONNX Runtime 官方列出了这些 Execution Providers；可用不等于所有模型在各后端数值／速度一致，仍须实测。[ONNX Runtime Execution Providers](https://onnxruntime.ai/docs/execution-providers/)

首版按 Python entry point／静态 registry 注册可信插件即可；HTTP sidecar 是后续隔离重依赖的可选适配层。下载模型后校验哈希，把模型 manifest 和许可存到本地，运行时不偷偷下载其他权重。任务输出必须通过 schema 校验；超时、限流、模型缺失、暂不可用分别返回可判断状态。

持久化结果与人工值分离：人工命名人物、改地点、改活动十图优先，重新刮削不会覆盖。provider 更新只重跑受影响任务，不重建全库 EXIF 和缩略图。

## 5. 本地模型候选与边界

### 人脸检测、聚类、标记

推荐先验证 OpenCV Zoo 的 **YuNet 检测 + SFace 向量**：其对应目录明确标注 MIT 和 Apache 2.0 许可，可用作 CPU 基线；正式锁定时记录具体文件哈希与许可证。检测负责找脸，向量／聚类负责建议“可能是同一人”，用户负责命名、合并、拆分。不能把一个余弦阈值当所有年龄、姿态、光线通用的身份保证。[YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) · [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface)

InsightFace 可以作为另一个 provider 候选，但官方区分代码 MIT 与公开预训练模型的非商业研究许可。个人家庭展示是否符合某模型许可不能由“非商业”三个字直接推断，项目不默认捆绑；可在明确适用授权后接入同一合约。[InsightFace 许可说明](https://github.com/deepinsight/insightface#license)

验证集应覆盖同一人跨多年、多人合照、小脸、侧脸、遮挡、儿童成长、相似脸。UI 用“待确认人物群”，保留未知；不由通用模型猜真实姓名、年龄或其他无关属性。人脸向量与缩略脸留在本地。

### 主体、相似度与语义搜索

OpenCLIP 可从本地图片生成语义向量，支持与文本／图片比较；明确选定权重模型卡后再发布。示例 `CLIP-ViT-B-32-laion2B-s34B-b79K` 模型卡标注 MIT，但使用英文数据训练，不能假设中文检索表现理想。可先用中文标签映射／人工词表测试，再比较多语种模型；模型输出是检索相似度，不是内容事实概率。[OpenCLIP](https://github.com/mlfoundations/open_clip) · [该权重模型卡](https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K)

DINOv2 基础代码与模型权重的官方说明为 Apache 2.0，可评估为视觉相似／多样性向量候选。它与 CLIP 的任务不同，不直接替代文本搜索。该仓库含其他后续模型和许可，锁定时只对选中的 DINOv2 文件作判断，不能把仓库中所有权重一概视为相同许可。[DINOv2](https://github.com/facebookresearch/dinov2#license)

### 技术质量、审美与构图

第一版先做廉价指标：解码失败、方向、分辨率、模糊估计、近重复、曝光分布；指标给解释和排序建议，不能自动删图。浅景深、夜景、运动模糊和颗粒风格可能被简单指标误伤。

LAION Aesthetic Predictor 是建立在 CLIP embedding 上的评分器，代码仓库 MIT；可作为可替换审美 provider。它估计训练分布中的审美偏好，不能预测某个家庭成员会不会喜欢，也不衡量人生意义。应记录模型原始分与活动内分位数，避免把 `8.2` 展示成“82% 的人喜欢”。[LAION Aesthetic Predictor](https://github.com/LAION-AI/aesthetic-predictor)

构图可先给出主体位置、地平线、脸部裁切风险等可解释建议；“三分法符合度”不应成为唯一审美标准。更复杂主体检测／分割等模型待首批样本证明有用后再加入，而非为了功能列表一次装齐。

## 6. 每活动十张：策展算法而非排行榜

提案采用可解释的两阶段选择：

1. 建立候选：仅索引成片，排除损坏／人工隐藏项；Live Photo 作为一个候选。先按内容哈希、感知相似、时间近邻形成连拍／近重复组。
2. 计算建议特征：技术质量、可选审美分、拍摄时间区段、场景／主体、已确认人物、用户收藏。任何一项缺失都不能把照片直接判为零价值。
3. 优先保留用户置顶；剩余位用贪心多样性选择，例如“候选基础分 + 新场景／时间覆盖收益 − 与已选图片相似惩罚”。权重是待调参数，由真实活动验证，不包装为科学定论。
4. 每近重复组默认只选一张；对多日旅行保证时间跨度，单主题静物活动则不要强行制造人物／地点多样性。
5. 产出 `min(10, 有效可选数)` 张，不靠重复凑十。记录“代表了哪一天／哪个场景、为何未选更高分的相似图”。用户可固定、替换、重排；后续增量只更新自动部分。

目录完成 metadata + 基础派生图后，可以先生成“基础策展”版本；本地 AI 跑完再产生可比较的新建议，不阻塞看图，不覆盖人工策展。验收看用户替换比例、场景覆盖、连拍冗余率，不能只看模型平均分。

## 7. GPS 与地址：层级化、允许缺失、保留来源

原始 GPS 保留数值、精度信息和坐标参考。通常照片 GPS 以 WGS84 处理，但要保留 `GPSMapDatum` 等原始字段与异常状态；转换坐标单独保存，不能覆盖原始值。地理 provider 输出规范结构：

```text
country_code, country_name
admin1_code, admin1_name     # 省／州／都道府县等
admin2_code, admin2_name     # 地级行政区等，可空
locality                    # 城市／镇，不强制等于 admin2
sub_locality, district      # 社区／城区，可空
street_admin, road          # 行政街道与道路分开
display_name, language, source_id, provider_version
coordinate_system, precision, confidence, resolved_at
```

“国家、省、城市、街道、区域全部有字符串”不能成为填满数据库的硬要求：海上、荒野、边界附近、无 GPS 或数据缺失时必须为空或标为近似。活动目录名可给出活动地点建议，但不能自动补成逐照片精确地址。

**本地第一层**：GeoNames 下载数据及行政编码可做离线城市级近似，并缓存到 SQLite；其数据采用 CC BY 4.0。最近城市不代表确切行政归属，尤其跨境／海岸／郊外，需设置距离上限和近似标签；它不能满足全球街道地址完整性。[GeoNames 数据说明](https://download.geonames.org/export/dump/)

**详细第二层**：可选本地／自托管区域 Nominatim，或可配置商业逆地理编码 provider。Nominatim 返回的是附近适合检索的 OSM 对象的地址，文档明确说明可能产生意外结果；地图注点和地址文本都要保留这种不确定性。全球离线街道库需要独立评估导入成本和磁盘，不能顺手算进 200 GB 图片缓存预算。[Nominatim Reverse API](https://nominatim.org/release-docs/latest/api/Reverse/) · [自托管安装](https://nominatim.org/release-docs/latest/admin/Installation/)

**公共 Nominatim 不能作为全库周期刮削默认后端。** 其政策要求最多 1 请求／秒、识别应用、缓存和署名；长期／周期批任务受更严格限制，超过一天或定期运行的脚本限制为每分钟 4 次。适合少量人工触发验证，不适合把数万照片后台逐张发送。[公共服务使用政策](https://operations.osmfoundation.org/policies/nominatim/)

**中国地址 provider**：高德逆地理接口返回国家、省、市、区、乡镇街道、道路门牌等；直辖市 `city` 可能为空，应以规范规则处理。其坐标转换接口要求把非高德坐标转换后再用于高德服务，GPS 与高德坐标要明确区分（WGS84／GCJ-02）；同一底图与标记必须使用匹配坐标系。香港、澳门和海外的覆盖与地址层级要独立抽样验证，不把大陆映射规则套到所有国家。[高德坐标转换](https://lbs.amap.com/api/webservice/guide/api/convert) · [高德逆地理](https://lbs.amap.com/api/webservice/guide/api/georegeo)

网络 geocoder 只发送所需坐标／语言，不发送图像、姓名和目录主题。缓存键包含 provider、坐标系、语言、版本和精度策略；粗粒度聚类可减少请求，但街道边界附近不能把几十米内所有点无条件归为同一地址。用户允许配置此类服务，但当前研究没有执行任何 GPS 请求。

## 8. 是否需要 LLM／agent

**首版不需要。** 扫描、断点、EXIF、人脸聚类、缩略图、结构化筛选和十图选择都能用确定性逻辑与本地模型完成。自然语言主题名已来自用户整理的目录，不能为每张图都付费调用 LLM。

后续真正适合 agent 的例子：“帮我策划一次跨年份的海边旅行展，必须覆盖不同相机，再让我审阅”。它需要多轮查询、比较候选、构造展览草案。只让模型调用受限工具：

```text
search_assets(filters, cursor)
get_event_summary(event_id)
get_asset_analysis(asset_ids)
propose_exhibition(asset_ids, rationale)
```

结果是可审阅草案，不提供任意 SQL、shell、NAS 写入或凭据读取工具。普通标题润色／摘要如果后来确有需求，可使用单次本地模型输出，不必引入长期运行 agent。OpenAI provider 仅在该类确需 agent 的功能启用时使用，密钥由服务器 secret 提供，浏览器不接触；发送内容由功能配置限定并可预览。

官方 OpenAI 文档区分 function calling 与 structured outputs：前者连接应用工具，后者约束输出 schema。建议使用 Responses 的受限工具调用和结构化策展草案，并对工具参数再做服务端校验。预算限制按请求次数、图像数、token、重试次数和每日金额控制；超预算停止该增强功能，不影响本地浏览。[OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling) · [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

API 数据控制需要按接入时实际账户与端点再次核验；不能把“默认不用于训练”理解成“完全不留存”。`store=false` 也不能等同保证所有日志零保留。当前不选定付费模型、不估造每张照片的固定费用、不调用 API。[OpenAI 数据控制](https://developers.openai.com/api/docs/guides/your-data)

## 9. 密码入口与管理面

用户要求“输入密码、无需用户名”可直接实现为单馆访问密码：使用成熟库生成 Argon2id 密码哈希，服务端随机会话，HTTPS 下使用 Secure／HttpOnly／SameSite cookie，过期／登出、登录限速。密码既不是 NAS 密码也不是 OpenAI key，不把它们复用成同一个配置项。[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) · [会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

所有资源入口都鉴权：缩略图、4K 图、原图 Range 请求、视频、搜索／EXIF／位置、人脸、任务 API。不能只给首页加密码而让静态缓存路径裸露。内网多设备访问也应提供 HTTPS 部署方案；开发预览默认 loopback。

首版同一位馆主可管理刮削；如果以后与家人共用一个看图密码，可再分“参观密码”和“管理密码”，仍不需要用户名。是否现在就做两种密码属于待定产品选择，不影响先跑通本地数据层。

## 10. 建议阶段与验收门槛

1. **盘点与格式验证**：只读目录数量、成片／视频／候选 Live Photo、例外规则；用分层样本测解码、缩略图体积、传输吞吐。报告应标记未完成目录，不能把抽样误写成全库结论。
2. **最小可靠管道**：直连 WebDAV、SQLite 任务状态、基础 EXIF、二级缓存、主题浏览与密码。测试断网／重启后不重复入库，新增目录可见，原片不进入展览，失败不导致误删除。
3. **媒体与策展**：验证 Live Photo 配对、独立视频、HDR／色彩回退；生成基础十图并允许人工替换。AI 增强任务可暂停而不阻塞浏览。
4. **本地分析**：在用户选定的少量多样活动上比较检测／聚类／语义／美学，记录正确率、错误案例、CPU／内存与秒／张；然后再扩大到全库。
5. **地理与扩展展厅**：城市级离线索引先行，详细地址按 provider 预算；地图、日历、相机馆和屏保复用相同查询 API。
6. **可选 agent**：等具体跨事件策展需求与工具集合明确后再实现；不是首版的先决条件。

特别测试：同名不同内容、文件移动、弱／缺失 ETag、URL 中文与转义、完整扫描中断、旧文件变更但父目录未变、Live Photo 重名误配、无时区 EXIF、跨月活动、中文两字搜索、provider 升级、人工覆盖保留、缓存磁盘满与坏文件。

## 11. 尚需决定或实测

- 真实目录例外：成片子目录、原片目录的命名集合，以及“素材”是否统一排除；不要仅凭宽泛子串过滤。
- 日期冲突时的排序策略：活动目录日期与 EXIF 跨年不一致，默认分别保存并显式展示冲突。
- 本地人脸／向量模型最终版本，必须经本库样本效果、许可证和设备速度验证。
- 逆地理服务选择及地址精度：离线近似城市优先；若要全球街道级细节，需要另行权衡空间／网络服务。
- 首版一个馆主密码已确认；当前范围是本机／内网，没有公网部署需求。
- SQLite 不拆年表、Python API + 独立 worker + React 已获用户确认；正式实现锁定应用依赖版本。
