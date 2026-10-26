# Gallery 导航与时间线防误触

2026-10-26。沿用现有玻璃抽屉设计，按馆主连续反馈拆分控件显隐与时间线触发范围。视频工作暂停，本轮只交付代码与验证。

## 交互规则

- 鼠标进入视口右侧30%时，右上共享导航和时间线按钮220ms淡入；离开后延迟180ms淡出。隐藏控件不拦截照片点击，不增加透明遮罩，不改封面排版。快速靠近并点击也可命中。
- 时间线自动展开只看它最终占据的矩形：布局offset计算范围，不使用正在滑入/滑出的动画边界。右上导航与右下翻页区不触发。离开面板220ms后收起，显式关闭须离开再进入。
- Gallery下拉打开时收起时间线、暂停自动展开并禁用其入口。菜单覆盖面板范围也不会触发；关闭菜单后，仍在面板范围的鼠标须先离开再进入，避免刚关闭就弹出。
- 菜单/时间线已展开时保留导航入口；键盘focus-visible可唤出隐藏导航，触屏入口常显，减少动态效果关闭过渡。Dashboard、Settings导航不渐隐；照片墙左侧返回不隐藏。原有单图沉浸模式保持。

## 实现与验证

`useGalleryChrome`被动监听指针，不覆盖照片；`TimelineDrawer`独立判断面板范围和菜单许可。组件卸载移除监听、清理计时器；菜单关闭面板沿用预览取消及Blob释放。无依赖变更，无NAS原图预加载。

隔离构建：`npm run build --prefix web -- --outDir ../data/gallery-chrome/web-dist`。P5 fixture使用84张合成图片，8793端口，假策展接口；浏览器运行在独立context，不覆盖正式会话。

- `node web/tests/gallery-chrome.mjs`：11组通过，涵盖30%边界、面板矩形、上下操作区、打开菜单前已展开的面板、菜单重叠/关闭重入、键盘、快速点击、日夜、触屏、减少动态效果、照片墙返回和跨页常显。
- `MUSEUM_BROWSER_OUTPUT=data/gallery-chrome/timeline node web/tests/timeline-drawer.mjs`：13组通过，涵盖开合中间态、隐藏inert、封面不重排、玻璃像素响应、资源释放、滚动保位、手机/矮屏与日夜可读性。
- 两套浏览器验证无未捕获错误，未请求NAS原图。实际触屏设备尚未实机验收；本轮触屏为Chromium模拟。

快速点击测试使用真实坐标mouse.click以覆盖移动→命中，而非force点击。Playwright的locator.click会在移动前检查目标是否可命中；对隐藏且pointer-events:none的控件直接调用，会停在预检查阶段，不能据此推断实际鼠标事件丢失。

证据：[检查明细](gallery-chrome-evidence.json)、[默认隐藏](../design/previews/gallery-chrome/hidden.png)、[控件浮现](../design/previews/gallery-chrome/controls.png)、[菜单操作](../design/previews/gallery-chrome/menu.png)、[白天](../design/previews/gallery-chrome/day.png)、[触屏模拟](../design/previews/gallery-chrome/touch.png)。仅合成截图提交Git。

正式发布先复制带hash静态资源，再原子替换index，并核对HTTP内容；API及worker无需重启。正式照片截图只放忽略的data/gallery-chrome目录。

正式8790已在现有馆主会话核对：1884×1314窗口中菜单覆盖面板范围时面板保持收起、入口禁用；退出菜单后正常重入展开；右下翻页区域移动后收起。真实菜单截图留data/gallery-chrome/formal-menu.png。API仍为发布前同一进程，后台刮削未重启。
