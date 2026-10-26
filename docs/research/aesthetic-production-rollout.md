# 神经美学正式接入与定向重试

2026-10-26，用户已确认独立试验排序更好并授权正式接入及重跑已完成任务。当前为正式后台补算，不是全库已经完成。

## 评分与排序

复用试验确认的 OpenAI CLIP ViT-B/32 QuickGELU＋LAION V1 预测头，固定使用本地 display 的标准中心裁切；不混入三裁块均值，不用 thumb 替代缺失 display。权重、来源提交及 MIT 许可校验记录在 `aesthetic-model-manifest.json`，方法与已知偏差见 `aesthetic-neural-trial-2026-10-26.md`。

独立 `aesthetics` provider 与 worker 保存原始预测值、模型/预处理版本、媒体版本及缓存更新时间。照片档案与 Dashboard 显示一位小数的“美学评分”；原百分制技术分继续独立保存。神经预测名义十分制，不裁切到0–10、不乘10当百分制、不冒充喜欢概率或个人校准模型。未标色域的−15仍保留在技术分中，不混入神经原始预测。

Cover Flow及共用活动封面按美学分Top10。同一活动补分未完整时整组保留原技术Top10，返回明确 `technical-top10-backfill` 与待评分数量；补齐后整组切换 `aesthetic-top10`。两种尺度不在一组混排；人工标记仍不覆盖排名。其他展厅及策展的评分排序使用有效美学分，未补分为未知。历史策展 `min_score` 保留0–100技术分语义，新 `min_aesthetic_score` 筛神经美学，结果同时携带两类值和 `score_kind`。

## 补算边界与恢复

服务根据 `data/models/aesthetics/head.safetensors` 启动独立进程。权重由 `tools/prepare_aesthetics.py` 显式安装，可从已校验试验目录导入；运行时不下载。进程沿用目录倒序、暂停恢复、版本驱动增量和完整完成事件机制。只有当前媒体版本/更新时间仍匹配才提交；缺少display报需处理，不自动请求NAS。失败不忙转，可通过原重试入口重试。

新评分加入完整处理文件/目录及单图子任务判断，所以启用后完成计数暂时回落是新增工作，并非旧照片消失。补算不重跑EXIF、主体、摄影标签或人脸，不改名字、人工合并/分组、标记或原技术分。视频记录为不适用；独立视频保持仅索引，超大文件和占位图不进入推理。

首轮计划为18,251张可展示照片（另有1,178个已有缓存的视频记录无需神经推理），708个仅索引条目不重取文件。计数为本轮发布快照，持续变化以Dashboard为准。

## 历史失败兼容

发布前只读审计为4个failed、1个unsupported、19,424个ready及708个indexed；当前范围没有分析错误，ready双缓存账本完整。

复用此前五个真实样本诊断，三张JPEG只在临时副本补EOI，再严格解码；不打开全局截断容错。一张HEIF引用数触及libheif安全限额，在确认文件≤256MiB、已知尺寸≤1.1亿像素后调用独立Apple进程，不关闭libheif限制。一张已声明P3 SDR NCLX且无ICC的HEIC交给原生色彩转换，不误标HDR或假定sRGB。

结果记录 `recovery`/`recovery_version`/实际renderer，档案展示兼容标签。JPEG可解码不证明源文件从无数据缺失，源文件未修复也未改写。Mac原生路径成功不等于Linux/Docker已覆盖这两类HEIC；不支持的平台仍保留需处理。

`tools/retry_validated_media.py` 默认dry-run。只对私密诊断清单中ID、路径、大小与错误仍匹配的记录定向入队；不按错误类型全库盲重试，不把私人文件名写进工具源码。已做在线索引/密钥备份，再停supervisor、定向处理五张并恢复原服务。**五张均已生成双预览，失败数降为0**；人物/面孔/人工策展及合并记录前后哈希一致，临时原图残留0。其余缺失GPS、风格未确定不冒充错误，也不靠重刮伪造新标签。

## 验证与证据

- 完整后端回归：180 passed；覆盖暂停/恢复、版本更新、预览竞争拒绝旧结果、缺缓存零NAS、活动整组换榜、两种筛选尺度、JPEG/HEIF受控恢复，以及既有人脸/词库/策展回归。
- 正式provider以真实本地display禁网小样运行成功；正式模型推理与试验一致，不上传照片。
- 前端构建成功。隔离P5合成页面验证两种评分分行、一位小数/百分制标签、说明与SVG、手机/矮窗口、Dashboard美学子项，零原图下载与浏览器错误。截图等待进出场完成，不能把DOM出现当绘制完成。
- 快速补分时active列表可能正好为空，任务状态额外依据本轮新增完成事件；无事件时仍显示等待、暂停/错误/全部完成优先级保留。`web/tests/aesthetic-status.test.mjs`覆盖这条状态边界。
- 真实服务已恢复并实际持续写入新评分，真实Dashboard已展示新子任务、目录和新分数；后台运行不依赖页面停留。

私密收据、备份、日志和截图：`data/aesthetic-rollout/`，不提交Git。需要检查当前进度时，按当前版本且媒体时间戳匹配统计，不能引用试验256张或部署入队数量冒充正式完成数。

复验命令：

```sh
uv run --all-extras pytest -q tests
npm run build --prefix web
node --test web/tests/aesthetic-status.test.mjs
MUSEUM_FIXTURE_PORT=8797 MUSEUM_WEB_DIST="$PWD/web/dist" MUSEUM_VALIDATION_AESTHETICS=1 PYTHONPATH=. uv run --all-extras python tools/p5_validation_server.py
# 等fixture ready后，在另一终端执行：
node web/tests/aesthetics.mjs
```

合成fixture中的6.75仅用于界面与流程测试，不是美学效果证据。个人偏好层仍待真实A/B反馈与留出评估，本次没有伪造反馈或自动训练个人模型。
