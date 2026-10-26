---
name: photo-museum-design-system
description: 修改 photo-museum 页面视觉或加载、错误、空状态、连接反馈时，复用项目设计语言并做跨页状态验证；不代替媒体色彩、模型质量或 NAS 协议验收。
---

# Photo Museum 界面设计

先读项目 AGENTS.md、docs/STATUS.md 和与任务有关的 docs/design/visual-language.md 段落；状态/文案工作以 docs/design/system-status-language.md 为当前规范。时间线现版先读 docs/research/timeline-drawer.md：Gallery导航/时间线按钮在右30%淡入，Cover Flow仅最终面板矩形触发玻璃纵栏，菜单打开时收起并暂停；真实照片伸到其后方，不复制缩略图当背景，年份/活动无背景块。旧timeline-smoke-glass为历史概念，不能据此恢复固定色块。

## 实作判断

- 先明确用户看到的状态、已有内容应否保留、真实恢复动作，再修改布局。首次读取、后台刷新、未解锁、空结果、部分失败不能共用一个布尔值。刷新后等待鉴权检查，不因短暂初始化误判密码失效。
- 共享导航用 MuseumNav；读取用 PhotoLoading/MuseumMark；错误用 StatusNotice，首次/空状态用 StatusPanel，保存完成用 SavedStatus，局部媒体降级用 MediaStatus。不要复制 SVG、错误段落或各造一套颜色。管理页允许品牌字样，观展/登录不加品牌和口号。
- 错误在 api.js 分类、status-text.js 公共文案白名单映射；未知异常安全回退。新增业务错误只加入已审阅的公开文案，不直接显示异常、HTML 或私密路径。
- 只读重试与写入/策展提交分开。失败保留可看的照片、位置与草稿；恢复清除对应错误；主动取消不报错。全局服务提示与局部同类错误去重。已有细节日志保留供用户主动展开，不冒充用户状态说明。
- 材质有实际底色才可见；日间黑字、夜间浅字独立于背景图片。尽量复用局部材质和现有语义变量，不给图片套滤镜，不为状态图层读取 NAS 原图。

## 已跑通的复验

1. 按 media-validation skill 的隔离 P5 fixture 方法构建到 data/<本轮>/web-dist，端口8793，正式8790不注入故障。fixture可启用 MUSEUM_VALIDATION_CREATIVE=1 和 MUSEUM_VALIDATION_CURATOR=1；模型是本地假接口。
2. `node --test web/tests/status-text.test.mjs` 验证连接/超时/HTTP/非JSON/取消/密码和未知文案边界。`node web/tests/status-system.mjs` 验证跨页故障→恢复，输出合成截图到 docs/design/previews/system-status 和本轮证据 JSON。`node web/tests/status-media.mjs` 另验证分页、单图预览降级/双失败与缓存重试，零NAS原图请求。先检查脚本端口与输出位置，保留历史证据。
3. 围绕修改跑有意义的回归：主导航 museum-nav.mjs；观展层级 gallery-navigation.mjs；策展 p6.mjs。查看各脚本环境变量，避免连接正式provider或覆盖历史截图；镜面像素测试串行。
4. 对截图自审：状态位置、文字层级、长文换行、图标/按钮、日夜对比、390/320手机与844×390矮屏、无整页滚动、44px目标、减少动态效果。真实点击恢复按钮，不能只看 DOM 已存在；历史加载容器的 pointer-events:none 曾导致内部重试不可点击。
5. 记录具体测试与失败边界，公开只放合成图。正式前端先复制带hash资源，再原子替换index；不因静态更新重启worker。用现有会话查看正式页面，截图仅 data/。不要锁定用户会话或为重试触发付费策展。

不把合成故障注入当成真实断网根因修复。结束保留用户当前正式页面和后台任务，停止自己的fixture；交付附规范、验证与截图的绝对路径。

抽屉时间线复验：隔离P5 fixture（84张生成图）运行web/tests/timeline-drawer.mjs及cover-layout.test.mjs；再跑timeline-preview.mjs、coverflow-resize.mjs和coverflow-light.mjs。输出用MUSEUM_BROWSER_OUTPUT/MUSEUM_BROWSER_EVIDENCE指向data/<本轮>，不覆盖历史。关闭后需把鼠标移出最终面板矩形再进入才能重触发；键盘按.timeline-toggle的Enter可固定展开。旧timeline-material脚本依赖已移除的复制缩略图层，只适用于历史版本。检查玻璃像素响应真实后方封面、无色块、关闭释放预览、隐藏inert、触屏选中收起及开合不重排，不能只查blur属性。

导航渐隐专项：隔离fixture运行`node web/tests/gallery-chrome.mjs`，验证30%边界、面板最终矩形（用offset排除自身离屏动画）、导航/翻页区排除、菜单开启时已展开面板收起及关闭后重入、日夜、Tab、触屏、快速点击、照片墙返回与跨页常显。隐藏控件pointer-events:none；Playwright locator.click会在移动前检查命中，测试快速靠近应先取boundingBox再用mouse.click坐标，不能force绕过命中检查。截图只用合成图库。

展厅宫格：先查看docs/design/gallery-menu-grid-concept.html与docs/research/gallery-menu-grid.md。图标由room-menu-icons.mjs统一路径、RoomMenuIcon渲染，保持馆徽64单位/1.35细线；不另加图标库。隔离fixture运行web/tests/room-menu.mjs（十图标、二维键盘、日夜、320/390/矮屏、九展厅切换和策展入口），再回归gallery-chrome.mjs。菜单开时隐藏时间线入口以免遮挡宫格；源码CSS在museum-nav之后引入以覆盖旧列表布局。

圆环加载复验：见docs/research/loading-circle.md，隔离构建后运行web/tests/loading-circle.mjs。覆盖真读取→成功消失、双缓存失败→重试、原图底栏保留4K、Dashboard预览、展厅/Settings、日夜与窄屏/矮屏和减少动态效果；故障注入用新context避免已解码图片绕过网络。PhotoLoading标准/size=small/compact分别用于主区域、浮层、行内；不复制馆徽与动画。正式/brand/loading-preview.html由Vite第二HTML入口直接引用实际组件，持续展示仅为组件预览，不添加业务假等待。
