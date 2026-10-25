# Photo Museum 标识

2026-10-25。三联照片框构成连续的折线，使用项目黄褐色 `#B88B4A`；无底色、文字、填充或外部字体。母版为64×64 viewBox、1.35px线宽的透明SVG；PNG为640×640 RGBA导出，已验证alpha包含0和255。

- [SVG母版](photo-museum.svg)
- [透明PNG](photo-museum.png)
- [折叠循环预览](loading-preview.html)

正式加载控件 `web/src/loading-mark.jsx` 使用相同线稿，将三个照片框依次收拢、展开，周期2.4秒；遵循系统减少动态效果设置。展示页面仅出现图形标记和必要加载状态，不新增品牌文字。

运行服务后也可打开 `/brand/loading-preview.html`，下载SVG/PNG。全部资源为本项目绘制的矢量及其浏览器栅格导出。
