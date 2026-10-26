# 简洁圆环读取组件

2026-10-26。按馆主确认的[二维细线圆环概念](../design/imagegen-2026-10-26/loading-simple-circle/concept.png)实现。复用正式MuseumMark三联照片框，不使用生成图里的近似logo，不新增图片资源或图标库。

## 组件与场景

`PhotoLoading`以单条1.1px SVG圆环包住馆徽和文字，背后为局部径向羽化遮罩，遮罩不拦截点击。圆环只做5.6秒的透明度循环（.62–.96），没有旋转、粒子、刻度或缩放；馆徽仍为原有2.4秒线条折叠循环。默认文案为“读取图片”，各处真实状态标签保持原义。

- 标准：184px圆环（手机/矮屏156px），用于首次Gallery、展厅、单图预览及通用StatusPanel。
- `size="small"`：104px（手机/矮屏92px），用于照片流右下角和Dashboard最近照片4K浮层。后者居中在预览图上，不另叠一个矩形底色。
- `compact`：32px圆环包馆徽、状态文字并排显示，用于原图读取底栏、词库、策展记录和编辑器行内状态。长状态不挤进小圆中。

日间使用深黄褐文字和白色羽化底；夜间使用金色和黑色底。减少动态效果同时停止圆环与折叠动画。所有状态使用role=status，装饰SVG对读屏隐藏，组件不抢焦点。没有为了展示动画增加生产等待时间；成功/失败/取消/卸载仍由原媒体生命周期控制。

## 动态验收入口

<http://127.0.0.1:8790/brand/loading-preview.html>：实际React组件，四种尺寸场景和日夜切换；背景为合成SVG风景，不访问图库、NAS或provider。用于持续查看动效，不冒充正在加载的业务页面。

原public静态演示改为Vite第二个HTML入口，直接import共享组件与样式，避免复制SVG/动画后逐渐偏离正式页面。使用现有Vite8的rolldownOptions.input，无依赖/锁文件变更。正式首页与预览页共用带hash构建资源。

## 验证与边界

隔离构建到data/loading-circle/web-dist，8793 P5 fixture使用84张合成照片。`node web/tests/loading-circle.mjs`十组通过：圆形与文字包围几何、真实循环变化、日夜、320/390/844×390布局、减少动态效果、Gallery初始读取结束、照片流右下提示结束、单图双缓存失败→有效重试→加载结束、显式原图读取保留4K、展厅与Settings状态、Dashboard小窗4K及关闭。无未捕获浏览器错误。原图阶段仅显式读取一次合成源，其余阶段不触发原图；未访问正式NAS或真实provider。

故障测试使用新browser context，避免已解码缩略图直接从浏览器缓存返回、绕过网络故障。测试通过后没有扩大到后端/HDR/全库重刮，这些不受本轮改动影响。真实手机未实机验收。

[检查明细](loading-circle-evidence.json) · [Gallery读取](../design/previews/loading-circle/gallery-loading.png) · [单图读取](../design/previews/loading-circle/viewer-loading.png) · [原图读取](../design/previews/loading-circle/original-loading.png) · [Dashboard小窗](../design/previews/loading-circle/dashboard-preview-loading.png) · [日间](../design/previews/loading-circle/component-light.png) · [320px](../design/previews/loading-circle/component-320.png)。公开截图均为合成内容。

发布时发现原8790服务已停止：以原data/server启动API及独立worker，静态资源按hash文件先行、index原子替换，并核对首页和组件预览HTTP内容。应用内浏览器已核对实际圆环/折叠动画、日夜与尺寸切换，保留预览页供馆主验收；截图留data/loading-circle/actual-component.png。未重设密码、重入刮削或修改NAS配置。

2026-10-26 位置修订：按馆主最新要求，Gallery转场与照片流加载提示由右下改为视口中心（fixed、50%/50%、自身半宽高偏移），保持small圆环尺寸和原有动效。底部展签不再因加载而收窄，预览页照片流示例同步居中；单图原图读取的行内状态保持原样。覆盖旧右下角约定。

本次复验：隔离P5图库，`MUSEUM_BROWSER_BASE=http://localhost:8798 MUSEUM_BROWSER_OUTPUT=data/loading-center/browser node web/tests/loading-circle.mjs`，10组通过、零脚本异常。实际活动读取等待时圆环中心为1500×940视口的(750,470)，完成后移除；320/390/844窗口与日夜/减少动态效果沿用组件检查。正式仅更新前端资源。
