# Cover Flow：可收起的玻璃时间线

2026-10-26。按馆主的新布局想法实现，参考现有时空隧道的三级时间线，而不是继续使用选中胶囊和固定标题色块。本轮以已有隧道设计和馆主的布局描述为依据，直接用渲染截图逐次复审；[旧烟色玻璃概念](timeline-smoke-glass.md)保留为历史。

## 最终交互

Cover Flow的时间线默认收在屏幕右侧。鼠标进入面板最终占据的矩形时，面板向左滑入；离开该矩形后延迟220ms收起，避免在交界处来回闪动。面板内移动及滚动保持展开，收起后保留滚动位置。右侧触发区域只是被动pointer监听，不铺一层会拦截照片点击的透明元素；拖动画板时不触发。

保留一个44px矢量入口。键盘Enter可显式打开，Esc关闭并从面板返回入口；隐藏内容使用inert及aria-hidden退出交互/辅助技术。触屏点击入口打开，选择活动后收起并回到封面。显式关闭后，需要离开面板最终矩形再进入才自动弹出，避免关闭动作立即被鼠标位置撤销。减少动态效果直接开合，其余模式380ms位移及240ms透明过渡。离开展厅移除监听、计时器与预览，隐藏不持有照片预览Blob。

年、月、活动仍由共享ActivityTimeline生成。Cover Flow和时空隧道共用排序、三字母月份、Dock标签缩放、真实选中项和Top3–5预览；时空隧道保留原入口及布局。Cover Flow所有尺寸采用纵向三级结构，年份/月/活动无背景块，取消固定标题的背景条，选中仅改变文字及光点。手机不再为了时间线占用底部横栏。

## 空间与玻璃

Cover Flow取消为时间线预留的左右186–246px裁切，仅保留对称14–52px边距；主封面在适合的视口中适度放大，两翼延伸到玻璃后方。开关面板完全不改变主封面中轴、画板尺寸和滚动位置。四款样式仍保留，16:9标准9封面及两翼平衡策略不变。

面板直接对后方实际展板做24px backdrop blur，不再复制当前活动缩略图当装饰背景，删除TimelineSurface及其专门请求。黑夜使用透明度72%的烟色底，白天使用透明度74%的白底；文字与强调色单独适配，并清除旧day规则的颜色覆盖。薄边、微弱高光和12px圆角限定材质边缘。玻璃后没有照片时也保留可读底色，不为材质取原图。

桌面宽220–282px，顶部96px、右侧24px、底部112px；手机宽min(76vw,272px)，顶部80px、底部106px；矮横屏顶部80px、底部82px、宽226px。列表在面板内部滚动，整页固定一屏。外部评分预览继续使用Portal避免裁切，并在收起后播放退出动画、取消请求及撤销Blob。

## 本轮验证

隔离前端位于data/timeline-drawer/web-dist，P5 fixture使用84张生成图片，无真实照片或provider；正式8790只发布静态资源，API及后台worker没有重启。

- `node --test web/tests/cover-layout.test.mjs web/tests/cover-mosaic.test.mjs`：9项通过，覆盖16:9数量、宽高变化连续、四种透视有限、左右对称及主图构图。
- `node web/tests/timeline-drawer.mjs`：13组通过，覆盖20%边界、默认隐藏/inert、位移中间态、封面不重排、背景块清除、玻璃像素变化、延迟收起/资源撤销、滚动保位、键盘/Esc、日夜、手机/矮屏、减少动态效果、触屏选择及离开清理。
- `web/tests/timeline-preview.mjs`：15组回归通过。相同Top3–5、排序/拼贴、快速切换、键盘/滚动及Blob释放保留；针对新纵栏更新手机滚动测试。
- `web/tests/coverflow-resize.mjs`：6组通过，四款样式的活动/小数位置在320–3440px变化中保留，滑动后转正，打开抽屉不改变封面边界。
- `web/tests/coverflow-light.mjs`：12组通过，照片像素不反色、倒影遮挡、日夜/位置保留、照片墙及其他展厅仍暗色、键盘和受限storage均保留。

玻璃专项在真实渲染的封面单元之间切换红/蓝色，比较面板左侧无文字边沟像素，确认材质响应其后方画面；不是只检查CSS写了blur。日夜对比按纯白/纯黑照片背景与实际面板alpha合成计算，四类标签最低均超过4.5:1；此为软件计算，不冒充物理显示器或真实手机验收。逐项数值和合成截图见[汇总证据](timeline-drawer-evidence.json)。

真实图库截图只保存data/timeline-drawer，不提交Git。旧timeline-material/contrast脚本对应旧版复制缩略图材质，不再作为现版验收入口；它们的历史报告不被覆盖。当前复验流程见项目设计skill。

合成截图：[收起](../design/previews/timeline-drawer/closed.png)、[黑夜](../design/previews/timeline-drawer/night.png)、[白天](../design/previews/timeline-drawer/day.png)、[手机](../design/previews/timeline-drawer/layout-390.png)、[矮横屏](../design/previews/timeline-drawer/layout-844.png)。新默认行为为隐藏，实测时需要先进入右侧触发区或键盘打开，不能沿用旧版直接操作隐藏列表的脚本。

正式图库已切回Cover Flow核对：同一活动位置保持，9个封面展开时被玻璃覆盖，年份计算背景为透明，默认收起与显式展开均确认，页面无滚动溢出。真实展开/收起图留data/timeline-drawer/formal-open.png和formal-closed.png；API仍为发布前同一进程，后台worker继续运行。

## 后续防误触修订

导航/入口右30%渐隐与面板矩形触发分离，Gallery菜单打开时关闭面板、暂停自动展开并禁用入口，关闭后须离开再进入。顶部导航与底部翻页区不触发。当前规则及11＋13组新验证见[Gallery导航与时间线防误触](gallery-chrome.md)；上文20%边界测试描述是初版历史证据。
