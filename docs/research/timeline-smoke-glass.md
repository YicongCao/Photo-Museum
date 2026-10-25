# Cover Flow时间线：烟色玻璃重设计

2026-10-26。用户反馈旧毛玻璃在黑底几乎不可见，左侧黄褐竖线也不协调。本轮先生成概念，再对照时间线部分落地与复查。

## 概念与实装

使用内置imagegen生成，无CLI/API fallback。[原始概念PNG](../design/concepts/timeline-smoke-glass/concept-v1.png)与[完整提示词](../design/concepts/timeline-smoke-glass/prompt.txt)已复制到仓库。生成图采用虚构照片与示例活动，没有将私人照片发送给图像生成服务。

对齐五项视觉约定：悬浮圆角烟色玻璃、细浅色边缘、内部冷暖漫反射、局部琥珀色选中块与光点、右侧低对比细滚动条。取消左侧黄褐竖线及投光。概念中的主封面排布、照片内容和示例活动是风格背景，本轮保留正式Gallery的Top10拼贴、封面密度及视口居中。

材质分三层：矿物色渐变、当前活动最高评分照片的本地缩略图、控制可读性的蒙层。缩略图34px强模糊、低饱和、受控亮度；文字在独立清晰层。外框24px backdrop blur不再是材质的唯一来源。缺图仍有受控底色，不回退NAS原图。

桌面宽210–260px、16px圆角，距顶部96px、右侧24px、底部112px。窄屏变128/132px高横条，矮横屏保留170px宽纵栏。年月活动三层、Dock命中区域、三字母月份保留；手机月份标题固定，避免被内部活动列表卷掉。预览保留336×236与Top评分3–5图，采用匹配的10px圆角与浅色边缘。

白天改象牙底、深灰文字、棕色强调。复查发现旧Dock字色过渡滞后于背景，已去掉颜色过渡，保留位移/缩放；减少动态效果时关闭装饰图淡入及控件过渡。

## 媒体与生命周期

`TimelineSurface`只用于Cover Flow。活动稳定120ms后读取thumbnail URL，不取4K或原图；切换取消旧请求并撤销Blob，离开Cover Flow释放图片。最多一张装饰图，旧源不会继续出现在新活动下；失败用渐变，不增加加载文字。切换时空隧道时重新绑定尺寸观察器，避免持有旧滚动节点。

## 验证

隔离构建在data/timeline-smoke-glass/web-dist，P5合成fixture监听8793。公开截图只用合成图，真实截图只存data。

- `node web/tests/timeline-material.mjs`：8组材质、选中态、源图切换/撤销、日夜、减少动态效果、5种视口、月份标题和离开Cover Flow释放检查通过。[证据](timeline-material-evidence.json)。采样黑底上空白边沟像素，确认材质有实际亮度和色调变化，而非只验证CSS属性。
- `node web/tests/timeline-material-contrast.mjs`：2组最亮缩略图与缺图回退通过。用全白缩略图，隐藏字形后测量对应区域实际背景像素；年/月/活动/选中行最低对比度夜间5.50:1、白天5.79:1，缺图6.82:1。[方法与数值](timeline-material-contrast.json)。合成边界测试不等同于所有物理显示器实测。
- `node web/tests/timeline-preview.mjs`：15项评分顺序、拼贴、Dock字号、开合、键盘/Esc、滚动、窄屏露出与Blob撤销回归通过。
- `node web/tests/coverflow-light.mjs`：12项日夜、照片像素保持、镜面遮挡、保位、其他展厅、矮屏/手机与减少动态效果回归通过。镜面原1单位像素容差未放宽，最终串行复验通过。回归输出在忽略的data/timeline-smoke-glass/，未覆盖历史记录。

逐图复查：[夜间](../design/previews/timeline-material/night.png)、[白天](../design/previews/timeline-material/day.png)、[手机](../design/previews/timeline-material/layout-390.png)。对照概念，实装保留更窄的导航比例，采用克制的玻璃高光与局部选中反光，让材质可见并保留照片主体。

界面改动只涉及静态前端，本身不要求重启API/刮削进程，不改源配置、照片、模型或缓存策略。本设计替代旧左侧分隔线/黄褐投光规范。

发布校验时发现旧正式supervisor已退出：扫描worker在`BEGIN IMMEDIATE`遇到`sqlite3.OperationalError: database is locked`，触发整个supervisor关闭。已沿用data/server、原模型与8790端口恢复服务，并校验新版静态包可访问；没有更改数据库结构或凭据。这是既有稳定性问题的运行恢复，不代表锁冲突根因已修复。
