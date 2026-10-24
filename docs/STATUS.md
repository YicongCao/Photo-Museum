# 当前进度

更新：2026-10-24（Asia/Shanghai）。阶段：**P0完成；P0.5按用户接受的方向继续；P1请求功能已实现、验证完成，待用户验收**。正式本机服务 <http://127.0.0.1:8790> 已接 NAS WebDAV、馆主密码与持久刮削队列；原型 8787 保留。EXIF/近邻推断执行、4K缓存与正式观展接入留在P2。

## P1最新交付

- Python API＋独立worker＋React馆务室；本地SQLite迁移、租约、退避、暂停/恢复/取消、只读WebDAV、鉴权manifest/原文件Range。
- 原始/推断/人工/effective、供体版本与原始记录ID、历史及提取状态已有底座；真实EXIF和推断算法尚未运行。
- Python 39项（含P1新增21项）、P0.5 TypeScript 13项、P1浏览器12组通过；真实NAS两活动54个候选已索引，小活动10项重复扫描稳定。
- 实际文件在128KiB处取消后通过强ETag续传；与独立完整GET的SHA-256相同。真实浏览器原图显示与匿名401通过。
- 本次HTTP5005经用户授权；HTTPS证书仍未修复。P1不是HDR/全库媒体缓存/Linux-Docker验收。

[验收报告](research/p1-validation.md) · [运行和用户验收](operations/p1-service.md) · [P1日志](logs/2026-10-24-p1-service.md) · [P1验证skill](../.agents/skills/photo-museum-p1-validation/SKILL.md)

## 最新计划修订

[ADR 0003](decisions/0003-black-ochre-gallery-home.md)确认：取消整页canvas；所有页面纯黑底与黄褐主题，增加有意义的图标/图表。A时光隧道提升为P2首个可浏览版本的Gallery首页，右侧按年份分组，逐项显示`MM-活动主题`；无月活动显示`年度-主题`。

[统一设计语言](design/visual-language.md)与[体验规范](design/experience.md)覆盖登录、Gallery、馆务、墙和后续展厅。[运行时](architecture/viewer-runtime.md)改为React/DOM、CSS透视、原生媒体及局部渲染。P0.5继续保留为历史原型，复用加载/取消/资源经验，不把单canvas作为新功能验收条件。

本轮已同步P1登录与馆务的黑底黄褐主题、图标及真实目录图表，16组浏览器检查通过；Gallery隧道仍是P2首版交付要求，概念图不表示已实现。见[修订与验证日志](logs/2026-10-24-black-ochre-gallery.md)及[新版概念](design/imagegen-2026-10-24-v2/README.md)。

## 已完成与证据

- [产品范围](PRODUCT.md)、[路线图](ROADMAP.md)、[ADR](decisions/0001-foundations.md) 已记录两轮用户决定；后续无需重复询问已选技术栈、视觉、隐私、HDR顺序和单密码模式。
- 只读盘点成功：227个活动，239个目录完成列举，12个原片目录及1个系统目录排除，无读取目录错误。19,536图片候选、2,063视频候选、1,173唯一同名MOV配对候选与5组歧义。完整证据在本地忽略的`data/research/inventory.json`；[公开汇总](research/library-census.md)。
- 20照片＋2视频小样本：17SDR成功、3HDR照片延期、2HDR视频延期。Python媒体处理依赖已锁定；[实验与限制](research/media-pipeline.md)。
- [历史概念页](design/concepts.html)使用虚构主题和SVG示意；此前1440×1000与390×844检查、灯箱/切换/随机排列验证只适用于旧DOM研究。它已标为色彩参考，不再作为新WebGL方案的验收证据。
- P0阶段的8项Python行为测试通过；当时两项项目skills结构校验通过。独立审查发现并修复空活动漏计、活动名误排原片两项问题。

## P0.5交付与验证

- 13张合成演示素材、6张既有真实SDR小样；B/F/单图同canvas，4K优先、暗房显影、按需瓦片及128MiB纹理预算。
- TypeScript 13项行为测试、Python合计18项测试通过；浏览器22组检查通过。含2万模拟元数据、100次浏览、60.2MP色条/瓦片、源故障、取消、全屏、焦点、触摸和context恢复。
- 1440×1000桌面与390×844/DPR2模拟手机；8张公开截图。手机硬件、Safari、HDR、真实NAS和生产鉴权不在通过范围。
- 可复验入口见[原型说明](../prototype/README.md)与[WebGL验证skill](../.agents/skills/photo-museum-webgl-validation/SKILL.md)，实测数字与证据见[验收报告](research/p05-validation.md)。

## 本轮不宣称完成

全库EXIF提取/去重/文件字节统计；HDR色调映射；真实Live Photo配对播放；视频中帧SDR输出；本地识别模型推理；原生HDR跨浏览器；Linux/Docker部署与性能验收。

盘点的resume只接续既有队列；它不是生产增量任务系统。静态概念中的日历、足迹、器材是未来入口，SVG的LIVE标志不是实际播放能力。缓存预算是小样本外推加显式保守假设，不是全库编码实测。

## 当前验收与下一阶段

1. 在8790验收登录/锁馆、NAS连接、活动扫描、暂停后刷新与恢复、原文件读取。已保存的源配置和馆主密码继续使用。
2. P2实施EXIF/准确SDR缓存，交付Gallery时光隧道首页及活动时间线，再完成近邻补全、Live Photo/视频与4K→原图暗房流程。
3. P3继续可信TLS、HDR、跨浏览器/实机、Linux/Docker与备份恢复，当前不标为通过。

P0日志：[发现与方案](logs/2026-10-24-discovery.md) · [全屏计划修订](logs/2026-10-24-viewer-plan-revision.md)。P0.5日志：[全画布原型](logs/2026-10-24-p05-prototype.md)。
