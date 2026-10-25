# 当前进度

更新：2026-10-25。**P2–P4 的本机软件链路已实现，持续真实刮削；当前交付等待用户检查。** P3物理HDR/真实移动设备验收与P4主观选片质量不能由自动测试代替，仍保留明确边界。入口：<http://127.0.0.1:8790/#manage>。

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

全库候选的目录枚举已完成，但全库媒体缓存/分析仍在后台继续；新策略不处理独立视频原文件和所有二级目录。未标记色域成片按 sRGB 假定入库并扣 15 分；超大图/视频用静态占位仅索引；尚未验证的 gain-map 等编码保留“需处理”，不伪造转换成功。真实NAS仍使用本次授权的HTTP5005，5006证书未修复。

原生HDR开关是受浏览器能力约束的路径，不代表Safari/Chromium、HDR物理屏幕与真实手机均已验证。缺省正式观展使用SDR；城市逆解析不制造街道/区域。技术分不是人类喜欢概率。P5的B/C/D/E及高级F展厅、P6可选agent尚未实现。

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
