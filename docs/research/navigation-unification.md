# 统一页面导航

2026-10-25。Dashboard、Settings、Gallery和策展助理共用 `MuseumNav`，固定顺序 **Dashboard → Settings → Gallery**。英文标题字体沿用本地 Cormorant，统一44px高控件、细线SVG、黄褐选中下划线、悬停与键盘焦点。功能区用低对比细竖线分开；锁定随后是最右侧全屏。

Cover Flow首页额外提供太阳/月亮按钮，适配白底文字、焦点与悬停色；其他展厅、照片墙及管理页保持黑底，不显示不可用的主题开关。Gallery中的Gallery按钮保留展厅菜单与策展入口；Settings不再藏在菜单内。照片详情保留已有沉浸与返回控件，不在照片上额外叠加主导航。

桌面保留右上布局；760px以下管理页的品牌/返回标题与导航分行，照片墙返回按钮也独立避让。320px紧凑字号与水平间距，所有按钮高度仍为44px。当前Settings入口保留所选分类与未保存表单，其他页面进入Settings记录返回目标。补齐FullscreenButton挂载时读取真实全屏状态，避免切页后误显示“全屏显示”。

## 实际验证

- `npm run build --prefix web -- --outDir ../data/navigation-unification/web-dist` 通过，无依赖变更。
- 隔离P5合成库、独立浏览器context，运行 `node web/tests/museum-nav.mjs`：8组专项，包括四类页面×1500×940、844×390、768×1024、390×844、320×720；逐控件边界/重叠、44px高度、页面溢出、日夜适配、设置返回/当前分类、菜单、全屏跨页与真实登出协议。
- `MUSEUM_BROWSER_BASE=http://localhost:8793 node web/tests/gallery-navigation.mjs`：12组既有原生Back/Forward、墙/单图/沉浸往返、动画与取消、手机回归通过。
- `MUSEUM_BROWSER_BASE=http://localhost:8793 node web/tests/coverflow-light.mjs`：12组日夜、照片像素不变、对比度、菜单气泡、保位与减少动态效果回归通过。旧DOM导航选择器随本次语义链接更新，未降低行为断言。
- 公开截图仅合成图：[桌面](../design/previews/navigation/gallery-1500.png)、[白天](../design/previews/navigation/gallery-day.png)、[手机Dashboard](../design/previews/navigation/manage-390.png)、[Settings](../design/previews/navigation/settings-1500.png)。[专项记录](navigation-unification-evidence.json)。历史回归本轮输出仅存忽略的data/navigation-unification/，不覆盖历史验收截图。

正式静态前端更新无需重启API或刮削进程；真实截图仅存data/navigation-unification/。本次没有修改源配置、模型、照片或刮削队列；不把合成登出/全屏验证冒充物理手机验收。
