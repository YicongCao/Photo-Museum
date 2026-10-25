# 当前进度

更新：2026-10-25。**P2–P5 本机链路及P6策展助理首版已实现，持续真实刮削；等待用户检查。** 策展入口：<http://127.0.0.1:8790/#curator>；Gallery菜单也可进入。首次观展仍为经典Cover Flow。物理HDR/真实手机和主观选片质量不能由软件测试代替。

## 当前可验收

- P1：只读WebDAV、馆主密码、持久扫描队列、暂停/恢复、增量发现与强ETag字节续传继续可用。
- P2：EXIF/ICC sRGB、4K＋640px WebP、HEIF/HDR SDR主图兼容全图、已验证HLG/P3视频路径、活动Gallery时光隧道、逐月逐主题时间线、照片墙、4K→原图暗房、保守近邻推断与采纳/忽略。
- 馆务：一屏固定布局、纯黑黄褐、品牌只留管理页、无slogan。单图所有子任务统一进度，逐根0→100；固定20项照片条、缓动左移、hover/点按本地4K。真实全目录列表与扫描批次分开。
- 范围/顺序：按目录名倒序逐个处理，只处理一级主题直属文件。独立视频不下载整段，只记录文件元数据；同名照片的视频才进入Live候选。当前227个一级主题＋根目录、20,137候选，11个二级目录/1,462文件已退出范围且未被标记为NAS删除。
- P3：Mac运行、Debian容器构建/启动、受信测试证书TLS、在线备份和新目录恢复已实跑；基础Docker镜像含媒体，不含PyTorch智能依赖。
- P4：本地YuNet/SFace人物聚类与人工改组、MobileNetV3主体标签、技术/构图评分、严格分数Top10、照片标记、GeoNames离线近似城市。模型和人工数据分层、版本化。

馆务最新数据语义与当前照片检查器已更新，见 [数据复审](research/management-data-review.md)。

## 证据入口

[本轮验收报告](research/p2-p4-validation.md) · [运行、限制与部署](operations/p2-p4-service.md) · [实施日志](logs/2026-10-24-p2-p4-engineering.md) · [复验skill](../.agents/skills/photo-museum-media-validation/SKILL.md)。公开截图只包含合成图；真实照片、GPS、人脸与真实界面截图只保存在忽略的data目录。

## 不混称为已完成的事项

全库候选的目录枚举已完成，但全库媒体缓存/分析仍在后台继续；新策略不处理独立视频原文件和所有二级目录。未标记色域成片按 sRGB 假定入库并扣 15 分；超大图/视频用静态占位仅索引；非原生后端尚未适配的 HDR 基底 gain-map 等编码保留“需处理”，不伪造转换成功。真实NAS仍使用本次授权的HTTP5005，5006证书未修复。

原生HDR开关是受浏览器能力约束的路径，不代表Safari/Chromium、HDR物理屏幕与真实手机均已验证。缺省正式观展使用SDR；城市逆解析不制造街道/区域。技术分不是人类喜欢概率。P5的B长卷/高级F屏保仍未实现；四展厅不冒充这些范围全部完成。P6首版基于索引文字与本地候选，不能称为云端看图或准确率验收。

P0/P0.5/P1历史验收保留在 [路线图](ROADMAP.md)、[P0.5报告](research/p05-validation.md)、[P1报告](research/p1-validation.md)。历史单canvas和暖白概念不再是当前约束。

## Gallery 本轮交互交付

连续隧道（键盘/横向滚轮/拖动）、底部倒影、活动整板入口、原比例4K横向照片墙、左图右信息暗房、按需NAS兼容原图及全屏已落地。见 [交互验证](research/gallery-interaction-validation.md)。最新验收入口为 <http://127.0.0.1:8790/#gallery>。

Gallery时间线已改为年/月/主题三级及Dock邻近放大；同月按拍摄时间倒排。见 [时间线验证](research/timeline-validation.md)。

Dashboard导航及进度加载语义已简化；异常分类与缓存建议见 [待处理统计](research/dashboard-backlog-review.md)，统计为2026-10-25的时间点快照，正常队列持续变化。


缓存已改为仅常驻缩略图/4K；全尺寸兼容 JPEG 按需临时转换。926 张原 PQ/HLG 报错 HEIC 验证后定向重试，正常队列继续。清理释放 63.38 GiB，见 [本轮策略与验证](research/preview-cache-hdr-policy.md)。

Gallery已采用用户选择的经典Cover Flow：5–20封面、增强长倒影/毛玻璃、严格分数Top10、预热15张4K、两层飞散入场、返回保位与合并照片档案。75项后端测试和16项浏览器检查通过。见[本轮验收](research/classic-coverflow-validation.md)，入口 <http://127.0.0.1:8790/#gallery>。

Cover Flow滑动结束后自动以动画归位到最近活动、中央封面转正；新输入立即打断，减少动态效果时直接定位。构建及6项专项浏览器检查通过，见[归位记录](research/classic-coverflow-validation.md#2026-10-25滑动结束自动转正)。

Cover Flow倒影已改为真实前后遮挡并压暗，展签去底色；照片墙主题与数量横排、黄褐线分隔，缩减底部占位。6项视觉检查＋6项归位回归通过，见[本轮复审](research/coverflow-polish-validation.md)。

Cover Flow主封面与活动标题已按视口中轴居中，左右切换移至左下/右下；1280px及390px人工验证通过。见[布局记录](research/coverflow-center-validation.md)。

Timeline已增加统一尺寸的评分Top3–5照片气泡、向左弹出/收起与键盘预览，并放大年/月/主题字号。3项拼贴测试、13项气泡浏览器检查、6项Dock回归通过，见[验收记录](research/timeline-preview-validation.md)。

地址/主体已加入离线中文显示：China→中国，按GeoNames ID转换中国省市，ImageNet类别表转换主体；保留原始字段/置信度，未知与歧义回退原文，仍为近似城市。79项后端测试与6项浏览器检查通过，见[中文显示验收](research/chinese-labels-validation.md)。

HDR/gain-map SDR 高光修复已上线：Mac使用Apple原生SDR解码，便携PQ/HLG修正参考白；87项后端测试通过。1,219张旧HDR预览定向重建，09:32快照已有52张新缓存、分析及完成事件（含27张检出gain map），该批暂无失败，剩余继续后台处理。普通SDR不重刮，缓存仅thumb/display。详见[验证、Apple来源和跨平台边界](research/gainmap-sdr-validation.md)。

摄影style/topic已接入独立本地CLIP进程：14种风格、19种主题、多标签候选、允许未确定，Dashboard及单图档案显示并纳入单图完成进度。已有缓存自动逐目录补分析，不额外取NAS原图、不重跑主体/人脸/评分。93项后端测试、7项浏览器检查通过；禁网实测24张缓存成功。正式上线复查快照已有421条结果及对应完成事件，后台继续；原视觉版本、人工分组和标记保持不变。见[方法、许可、样本边界与复验](research/photography-style-topic.md)。

登录页支持密码自动填充/粘贴后自动解锁，错误不循环重试，手动输入、首次设置与显式锁定保留原有控制。前端专项验证见[自动解锁](research/auto-unlock.md)，正式刮削无需重启。


## P5 四展厅

日历（年/月/周与日期未详）、本地离线地图（国家/省州/城市/活动）、器材馆（相机/镜头、标记筛选、使用年代与线稿）、独立纵深时空隧道已接通共享照片墙与暗房。保留返回位置、会话展厅选择、减少动态效果和一屏布局；不预取NAS原图。99项后端回归、26项四展厅检查、7项键盘/空状态检查及17项原CoverFlow回归通过。来源、截图及边界见[P5验收报告](research/p5-exhibition-validation.md)。


## P6 策展助理首版

TokenHub/hy4-preview、高强度深度思考与temperature1.1已通过真实合成小样；六个受限tools、本机加密配置、SSE过程/重连/取消、缓存核对进度和六种集合Show已实现。107项全量后端测试及最后8项策展专项通过；P6交互11项、P5回归26项、拼贴10项、矮窗口3项通过。真实库仅作禁网只读验证，未上传私密照片。见[P6报告](research/p6-curation-assistant.md)。

## 统一 Settings

文件源、LLM Provider、GPS地址、原图/HDR显示与缓存预算已集中至独立Settings页；Dashboard、Gallery菜单和策展页Provider入口共用。默认行为及已保存凭据保留，按需原图零自动下载、离线地址可增量重算，设置冲突不会静默覆盖。111项后端测试、11项Settings浏览器检查及11项P6及7项Dashboard回归通过。正式服务已更新并打开Settings入口；正常解锁后可用，后台处理继续。见[验证记录](research/unified-settings-validation.md)。

## Cover Flow 日夜模式

Cover Flow首页新增太阳/月亮SVG切换，支持当前浏览器记忆；白底标题、时间线、预览气泡、按钮和不透明倒影均已适配，照片不反色。照片墙/暗房及其他展厅仍为黑底。12项专项与26项P5回归通过，正式前端已更新，后台刮削保持运行。见[验证](research/coverflow-light-validation.md)。

## Gallery 概念复审与四款样式（本轮）

四款 Cover Flow 已加入 Settings → 照片显示：经典镜面、金框画廊、纵深展廊、全景弧幕。各自调整透视、比例、描边、十图布局和倒影；日夜模式保留。手机/矮屏/超宽屏保持浏览位置，时间线跟随当前活动，修复尺寸突跳与离场画板透明叠加。

人生年轮、记忆星图、记忆长卷、故地重游已实现，带共享暗房、可打断过渡、集合约束及本地持久化；P6可Show至新增四厅。故地重游仍为同城候选＋人工同地点确认，不包含自动同机位配准。横向记忆长卷不等同于原计划B的纵向主题/横向照片双轴体验，F高级屏保仍未交付。

[概念与实装对照](design/gallery-refinement-review.html) · [细节、动画与验收记录](research/gallery-concept-refinement.md) · [数据接口与边界](research/creative-gallery-data.md)。正式SQLite已备份并迁移到schema9，服务已启动。真实图库聚合首次约6–8秒，界面有读取状态；用户主观视觉验收仍待确认。
