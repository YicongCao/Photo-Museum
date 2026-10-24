# P2–P4 本轮软件验收记录

2026-10-24。本轮交付包含持续运行的本机服务、真实只读NAS队列、正式Gallery和馆务、本地分析及部署工具。用户尚未进行最终主观验收；本记录区分已自动/手工验证的事实和保留门槛。

## 真实库与最新范围

原始只读盘点为239目录、21,599候选。按用户最后要求收紧后，保留227个一级主题目录＋照片库根目录，20,137个直属文件；11个二级目录及1,462个文件通过scope_excluded退出本轮处理，不当作源删除。原文件没有写入、改名或删除。

队列顺序为目录路径倒序、目录内文件名倒序；等待本目录媒体与本地分析结束再切换。失败/待适配文件单列供重试。没有同名成片的独立视频只记录现有文件/主题信息，零GET；不生成新的封面或做识别。有同名成片的视频仍按Live候选处理，内容标识一致才称为确认配对。

媒体缓存/全库分析尚在持续执行，不将全库目录完成混称为媒体全部完成。真实进度在馆务页实时显示，公开文档不保存照片名、精确GPS、人脸向量或真实页面截图。

## 代码与浏览器验证

Python套件覆盖认证、CSRF/Host、WebDAV断线/完整枚举、版本校验、强弱ETag、暂停重启、故障隔离、缓存淘汰、模型版本、人工人物/精选、Live候选与内容标识、单图持久完成事件、逐目录等待分析、零GET视频、二级目录范围和旧库迁移。最终命令与结果写在下方最终运行记录中。

Chrome 155 的当前Gallery脚本覆盖25组检查，证据在 [p2-browser-evidence.json](p2-browser-evidence.json)。其中直接观察DOM变化序列，确认每张完整成功照片的0–100点亮每次只增加1根；结束时全部9项点亮。并覆盖最新20项、整宽固定底条、cubic-bezier左移、4K hover/点击/关闭、无NAS原图请求、减弱动态效果和手机/矮窗口无整页滚动。

P1当前UI回归16组，见 [p1-current-browser-evidence.json](p1-current-browser-evidence.json)：照片源设置、批次暂停/刷新/恢复、馆主登录/锁馆、范围排除、鉴权原图Range、图表分母。公开 [Gallery截图](../design/previews/gallery/) 和 [P1截图](../design/previews/p1-current/) 均是合成素材；不是实际HDR屏幕证据。

## 媒体与本地模型

实际处理过JPEG、HEIC的ICC转换、Apple gain map容器主图、P3/BT709 MOV，以及22.82秒HLG样片的中帧和SDR H.264。记录原始色域、采用的SDR主图/假设或tonemap路径；不将无标记色域称为准确已知色域。解码失败、无色域HEIC或图像尺寸超过保护阈值保留为待处理。用户后来要求独立视频仅索引，历史视频样本证明codec路径，不表示当前还会全量下载独立视频。

YuNet/SFace、MobileNetV3和技术构图分已在真实缓存照片上运行，结果只留本地；没有向OpenAI或其他服务发送照片、人脸、GPS。模型版本与SHA见 [manifest](model-manifest.json)，许可证见 [licenses](../licenses/)。GeoNames离线最近城市输出保留输入来源与精度，城市之外不编造街道/区县。

人脸检测/聚类有人工确认与拆组入口；技术评分是清晰度、曝光、对比度、构图启发式，不是人类偏好概率。用户固定精选优先于自动多样性排序。自动测试证明人工记录保存，不证明主观选片质量已获认可。

## 部署、私密备份和边界

Mac正式服务实跑；Debian Bookworm ARM64基础容器构建、迁移、初始化、登录与退出实跑。服务TLS测试使用显式受信CA验证，没有绕过证书验证，且确认Secure会话cookie；见 [deployment-evidence.json](deployment-evidence.json)。真实NAS仍按授权用HTTP5005，HTTPS5006证书未修复。

SQLite在线备份（含凭据加密密钥）与新目录恢复实跑；会话被删除、缓存队列重建、源和人工数据保留。备份/恢复产物在私密data目录，不能提交或公开。

基础镜像不含PyTorch，因此Docker证据不包含P4模型推理；完整P4本次在Mac all-extras环境验证。Safari、物理HDR屏幕、真实手机、街道级逆解析、所有稀有编码与超大图都没有被本轮headless测试替代。P5其他展厅和P6 agent未实现。

## 最终运行记录

- `uv run --all-extras pytest -q`：57 passed（34.44 秒）。
- `npm run build --prefix web`：通过。
- Gallery 浏览器：25 项通过、无未捕获错误；P1 当前 UI：16 项通过。
- Debian ARM64 容器隔离服务/媒体/范围回归：28 passed（24.67 秒）；显式设置测试 Host。
- 最终基础镜像 `photo-museum:p4` 构建成功。
- 真实数据库迁移至 schema 6；二级目录的 pending/running 媒体任务为 0，媒体队列未暂停。

完整日志保留在被忽略的 `data/p2-verification/`；以上是测试结果，不代表全库缓存已经完成。
