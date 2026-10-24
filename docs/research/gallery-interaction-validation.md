# Gallery 交互验证 · 2026-10-25

## 实现

首页每场活动最多十图，整板点击进入全部可展示照片的横向瀑布照片墙。照片墙使用4K派生图和原比例，按200项分页，临近末端继续加载；视口外图片卸载。尚未完成刮削的文件不会冒充已可展示照片。

隧道按连续滚动位置插值透视/缩放/透明度，支持键盘、触控板横滚、鼠标/触屏拖动。画板保留至退出视口，底部复用缩略图做翻转渐隐倒影。浏览有首尾边界，不是循环播放。

导航仅 Gallery、Dashboard、全屏。日期和主题保留，精选数量删除。单图先4K，随后NAS按需原图，左图右侧主要EXIF，支持照片全屏、Escape和关闭后焦点恢复。

## 原图生命周期

原生兼容文件走既有NAS流式接口；需要SDR兼容的原图使用新 original-compatible 接口，单并发、256MiB上限，以服务器 view-work 临时目录完成转换。响应 no-store；成功、转换失败及发送阶段断开均清理临时目录/文件句柄/并发槽位。前端换图/关闭取消请求、撤销Blob URL并清除解码对象引用。

转换期间断开不会立刻中断底层同步解码，转换结束后清理；进程被强杀的临时目录恢复清理不属于本次验证。此次没有重写刮削器既有 compatible/playback 缓存政策，也没有删除已有缓存；不能把本接口的临时转换解释为全服务只存4K和缩略图。

## 验证证据

- 浏览器专项8组通过：左右键中间位置、离场画板、横向滚轮、鼠标与CDP触屏拖动、整板入口、原比例4K、241项跨页及虚拟卸载、NAS显影、全屏与焦点、手机一屏。证据：exhibition-browser-evidence.json；合成截图：../design/previews/exhibition/。
- 既有Gallery/馆务浏览器回归25项通过：p2-browser-evidence.json。
- Python全套61项通过（35.95s）；新增按需NAS读取、无持久兼容缓存写入、转换失败清理、旧revision拒绝、登录保护、发送阶段断开清理测试。
- 真实NAS：HEIC原图读取并完成SDR显影，完成后view-work为空；真实截图仅保存被忽略的data/p2-verification/gallery-continuous-tunnel.png、gallery-horizontal-wall.png、gallery-photo-detail.png。

真实物理触屏/HDR屏幕未在本轮验收，CDP触屏输入不能代替硬件验证。未将有限流程验证描述为长期堆内存无泄漏证明。

## 复验

运行 .venv/bin/pytest -q；npm run build --prefix web。启动 tools/p2_validation_server.py 后运行 node web/tests/exhibition.mjs 与 node web/tests/gallery.mjs；fixture必须隔离真实凭据，公开截图只使用合成照片。
