# ADR 0001 — 本地数据底座与可替换分析

> 后续修订：[ADR 0003](0003-black-ochre-gallery-home.md)已取代本文的暖白/单canvas要求及A隧道延期顺序。本文保留历史；渐进媒体、推断和隐私约定仍有效。

日期：2026-10-24。状态：产品方向与技术路线已确认；接口细节为设计提案，尚未成为生产实现。

后续修订：[ADR 0002](0002-immersive-viewer-and-inference.md)将观展改为单canvas Three.js/WebGL，并加入渐进原图与近邻元数据补全。下面的React选择保留，但不再表示使用DOM相册作为观展实现。

## 已确认

用户决定：自托管 Mac/Linux/Docker；源 NAS 通过 WebDAV；识别必须本地；可下载模型；GPS 确需联网时可外部服务；OpenAI 只用于确需 agent 的功能。第一版先完成刮削、缓存和主题浏览。暖白 Swiss 主界面、暗色灯箱。浏览器密码登录，无用户名。

## 推荐技术边界

第二轮确认：接受 Python API＋独立 worker＋React；SQLite 在本地且不按年份拆表。先做好准确 SDR，再补原生 HDR。首版只设一个馆主密码，具有浏览与管理权限。

- API/worker：Python 3.11+，FastAPI；UI：TypeScript/React，正式实现时固定 Node LTS 与 lockfile。Python 生态覆盖 EXIF/图像/模型，繁重任务交给独立进程。P0 的 Python 工具无服务依赖，媒体实验使用单独可选依赖锁。
- SQLite 放本地持久卷，WAL，事务短小，单一写入调度。图片与视频是文件，数据库只保存索引。先不按年份拆表；用索引、分页、FTS 和查询基准判断瓶颈，再考虑独立向量库或 PostgreSQL。
- `sources / activities / assets / source_objects / activity_assets / capture_metadata / locations / people / faces / asset_tags / scores / selections / derivatives / jobs / scan_runs / provider_results` 是职责划分，不是所有表都要首版一次创建。
- 一个资产可以有静态图/视频伴随资源、多份源副本和多场活动归属。身份不能只用文件名、mtime 或目录名；源 URI/路径标识对象，后续强哈希与配对证据用于去重，不消灭历史归属。
- 本地缓存分可保留缩略图、可淘汰4K、按需原生媒体/转码和临时文件。索引、人工标签/精选和任务记录不是可随意清理的缓存。
- 每个耗时阶段输入指纹＋算法/参数版本唯一；成功结果幂等持久化。流程是确定性任务图，非“让agent自由遍历NAS”。
- WebDAV客户端管理Depth:1、认证、超时、TLS、重试和Range；应用不依赖挂载盘时的逐文件stat。RFC6578只在探测支持后使用，普通轮询是必备基础。
- 密码用 Argon2id 哈希，服务端会话 cookie；登录限速、CSRF防护、安全比较、HTTPS反向代理方案。首次密码通过本机CLI/本机初始化设置，不把首次初始化暴露到整个局域网。

## 待实测或小范围确认

- 默认展示“4K”暂定义长边3840、保留比例、不放大；缩略图640。WebP默认sRGB/SDR，原生HDR/广色域单独通道。质量值以样片肉眼验收后固定，不能只比压缩率。
- 全库盘点后，缓存硬上限建议初始80 GB（十进制），所有衍生图、原生文件、视频转码及临时处理文件计入；图片两档保守场景约35.16GB。预算由worker预留，防止并发写入越界。数据库和模型另列占用。详见容量实测。
- “十张代表作”首先尊重用户精选/锁定，再覆盖时间、场景与人物多样性，审美分只是其中一项。用户偏好训练等有足够反馈后再做。
- 现有 HTTPS WebDAV 证书检查曾报告过期。正式直连应修复服务证书或配置受信CA；不能把关闭校验作为部署默认值。此项不是修改NAS的授权。

更详细论证与公开来源见 [架构与provider](../research/architecture-providers.md)、[媒体管线](../research/media-pipeline.md)。
