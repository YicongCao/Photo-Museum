# 时间线三级分组与 Dock 动画

2026-10-25。年份、月份、活动主题独立显示。API按年/月倒序，再按符合目录年月的最新实测拍摄时间倒序；无有效时间排其后，主题名稳定倒序。缺月份保留年度分组，不将其推断为某月。增量刮削发现更晚拍摄时间后顺序可更新，Gallery仍按活动ID保持当前选择。

标签按鼠标与未变换行中心的距离放大，中心32%、邻近递减，220ms缓动交接；布局与点击区域不变。滚动/移出清除放大值，卸载取消动画帧。键盘焦点突出，减少动态效果取消缩放。手机保留三级分组，整页不滚动。

验证：排序/媒体Python定向5项通过；时间线浏览器6项通过（包括交接中间态及缩放复位）；既有Gallery浏览器25项通过。正式构建及diff检查通过。公开合成截图位于../design/previews/timeline/；机器可读证据为timeline-browser-evidence.json。真实验收截图仅放data/p2-verification/timeline-live.png。

复验：启动tools/p2_validation_server.py，再运行node web/tests/timeline.mjs及node web/tests/gallery.mjs。后端运行.venv/bin/pytest -q tests/p1/test_timeline.py tests/p1/test_media.py。
