# Cover Flow 倒影、展签与整体复审

2026-10-25，承接用户对倒影遮挡、压暗及展签横排的修订。

## 实现与自审

- 去掉活动整板的透明度，远处封面改用图片亮度衰减（最低0.48）；颜色不穿透，前后层级由距离决定。
- 倒影采用不透明黑底，内部图片亮度乘0.34、1.8px模糊、饱和度0.78，再叠加渐变黑；从前往后遮挡。渐隐以融入黑色地面实现，不再对整个倒影做alpha遮罩。地面保留轻微1.2px毛玻璃。
- 复审中进一步恢复镜面图片与封面一致的高度比例，长渐隐区域单独延展到视口底部，避免将照片拉成长条；收敛了封面边框、反射接缝和远处亮度，保持中央封面清楚。
- 左下展签完全移除矩形底色和背景模糊，只保留细小文字阴影。照片墙日期缩为14px，主题与数量同一行，中间为2px黄褐竖条；照片、非零视频数量不换行，过长主题省略但完整主题保留在title与标题语义中。
- 照片墙底部保留空间从桌面150px减为102px、手机140px减为92px，腾还照片流；桌面/390px均无展签重叠和整页滚动。

## 验证

- `npm run build --prefix web` 通过。
- `node web/tests/coverflow-polish.mjs`：6项通过，0未捕获错误，见[证据](coverflow-polish-evidence.json)。包含实际像素遮挡回归：只改变后方镜面颜色时，前方镜面内截图完全相同；隐藏前方镜面后截图发生变化，证明采样区确有后方镜面。
- `node web/tests/coverflow-settle.mjs`：6项通过；滑动自动转正、打断、拖动、减少动态效果与首尾边界继续可用。
- CUA人工检查了正式DOM布局的合成图库：居中与两侧倒影、无底色展签、活动墙横排。公开截图均为合成几何照片，视频数量采用明确的UI测试数据。此次没有修改刮削、缓存或NAS读取逻辑，也没有重跑后端全套测试。

截图：[桌面Cover Flow](../design/previews/coverflow-polish/coverflow-desktop.png)、[手机Cover Flow](../design/previews/coverflow-polish/coverflow-mobile.png)、[桌面照片墙](../design/previews/coverflow-polish/wall-1440.png)、[手机照片墙](../design/previews/coverflow-polish/wall-390.png)。

审美复审是本机软件及布局判断；真实屏幕、触屏手势与馆主偏好仍由用户验收。

验收环境修订：IAB手动fixture使用localhost，与127.0.0.1正式页隔离Cookie；fixture显式允许两种本机Host。此前同主机名、不同端口共享Cookie可能令正式页需要重新解锁，正式密码与服务配置不变。自动化测试使用独立context。
