# Gallery 展厅宫格

2026-10-26。将原纵向文字列表改为三列九个展厅，加一格横跨底部的策展助理。先绘制[独立HTML概念](../design/gallery-menu-grid-concept.html)，检查[概念渲染](../design/previews/gallery-menu-grid/concept.png)，再用于正式React菜单。

十个SVG图标共用馆徽的64单位画布、1.35细线、圆端点、空心轮廓与黄褐色。Cover Flow直接沿用馆徽折页图形；其他分别用日历、折叠地图与定位点、相机、透视画框、回游定位、全景长卷、年轮、星点连线和策展星芒表达。全部项目保留名称，不让用户只凭图猜测。图标为项目内手绘矢量，没有新增字体、图片或外部依赖。

## 布局与操作

桌面菜单宽368px，手机最多视口减24px，三列保持稳定；常规展厅格最小高度98px、手机86px、矮屏78px。策展入口为全宽62px。固定在右上导航下方，矮窗口仅菜单内部滚动，页面仍固定一屏。日夜各自适配文字、描边、图标、选中与玻璃底色。

当前展厅使用黄褐细描边和轻底色，悬停图标微升2px；菜单180ms淡入并轻移，减少动态效果关闭动画。方向键左右逐项、上下跨三列，Home/End定位首尾，Esc关闭并返回Gallery按钮。保留菜单语义、名称和选中状态。

原右30%导航渐隐与时间线防误触保持；菜单打开期间，时间线收起且禁止自动展开，并隐藏时间线入口以免遮住宫格。菜单关闭后入口恢复，鼠标仍须离开时间线范围再进入。

## 验证

隔离构建到data/gallery-menu-grid/web-dist，8793 P5 fixture使用84张合成图与假provider。`node web/tests/room-menu.mjs`七组通过：十图标与三列几何、方向键/首尾/Esc、日夜、390/320/844×390布局及内部滚动、九个展厅逐一切换和选中状态、减少动态效果和策展入口、零原图/零创建策展任务/零未捕获错误。`web/tests/gallery-chrome.mjs`十一组回归通过，覆盖导航渐隐、菜单重叠与时间线抑制、快速点击、键盘、触屏和跨页。

公开[合成证据](gallery-menu-grid-evidence.json)：[夜间](../design/previews/gallery-menu-grid/night.png)、[白天](../design/previews/gallery-menu-grid/day.png)、[320px](../design/previews/gallery-menu-grid/layout-320.png)、[390px](../design/previews/gallery-menu-grid/layout-390.png)、[矮屏](../design/previews/gallery-menu-grid/layout-844.png)。真实手机尚未实机验收。

正式8790已发布静态资源并在1884×1314窗口核对三列、十图标、菜单内时间线保持收起且入口隐藏。现有活动位置保留；API/worker未重启。真实截图仅data/gallery-menu-grid/formal-menu.png，不提交Git。
