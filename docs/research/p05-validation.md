# P0.5 全画布原型验收

日期：2026-10-24。状态：核心原型实现及本机自动复验通过；用户尚未体验验收。原型入口与操作见[运行说明](../../prototype/README.md)。

## 交付内容

- 一个持久Three.js WebGL2 canvas，B主题浏览、简化F照片墙与暗色单幅细看共用相机、材质池、媒体调度与语义操作。
- 优先4K、首帧后读取高分辨率资源；上传纹理后才显影。版本变化、取消、解码失败、401/503保留可用预览；高质量缓存可直达。
- 9504×6336（60.2MP）的测试图、精确4K层与原始尺寸瓦片；视区与像素密度决定LOD，放大可访问原始分辨率。不一次上传整幅大图。
- 128MiB照片纹理账本及LRU租约；过时解码释放ImageBitmap，切场景共用渲染器，后台/上下文中断恢复当前选择。
- 全屏请求与被拒回退、鼠标/键盘/触摸、减少动态效果、隐显HUD、键盘焦点恢复。
- 验证台可以切换正常、慢速、读取失败、坏图与源版本变化。

## 素材与成本

13张公开可重建合成素材，6张既有本机真实SDR小样；真实来源包含JPEG和HEIC/HEIF，保留竖图方向。真实图的兼容输出经过ICC解释与sRGB转换，源EXIF不进入响应。

素材v2有473个活跃媒体文件，共82,335,744字节；本机保留v1历史后整个准备目录154,101,883字节，低于500MB准备预算。该数值是当前少量测试素材，不外推为全库瓦片缓存成本。生产80GB缓存策略尚未实现。

照片纹理128MiB仅为RGBA8账本；另有CPU解码副本、HUD纹理、渲染目标和浏览器开销，不能当作进程RSS或真实显存占用。禁用照片mipmap，瓦片按可见区域准备；保留4K底图。

## 已修复的实际问题

1. 浏览器原生fetch作为对象成员调用发生Illegal invocation，改为保持原生调用上下文的封装。
2. 屏幕坐标下的投影与面片朝向导致首帧被剔除，修复材质朝向，加入真实像素验证。
3. 7521×5151真实图片的半级为3761×2576，小于3840预览，原级又超过128MiB。生成器增加与实际预览完全相同尺寸的LOD，并以版本化URL使旧素材失效。
4. 上下文中断后切图，恢复逻辑不得加载中断前的旧照片；恢复以当前选择为准，并同时核对loader与选择资产。
5. 修复隐藏HUD单tap唤回、双指转单指坐标连续性、返回原入口焦点，以及平移时已有瓦片被全部隐藏并重复显影。
6. 复用shader材质池，避免每次场景重建都释放并重编译照片程序。主展板预载一张4K，其余可见缩略图保持有界。
7. 减少动态效果严格要求动画时长大于零才进入帧更新，避免rAF时间戳早于开始时间时发生零除。照片墙浅色图上的按钮增加深色底，保持文字对比。

## 验证记录

最终构建：`/assets/index-CB4hiMoN.js`。Chrome `155.0.8059.85`；本机Node26.1.0，Python3.11.17。浏览器运行区间为2026-10-24T11:35:54.951Z至2026-10-24T11:36:49.531Z（UTC），最终状态`passed`。

- `npm run build --prefix prototype`：TypeScript检查和构建通过；Three.js包约558KB（gzip约144KB），Vite保留大于500KB的体积提示。
- `npm test --prefix prototype`：13项行为测试通过。
- `uv run --extra media python -m unittest discover -s tests -v`：18项通过（包含P0原有8项、HTTP7项、LOD尺寸3项）。
- `npm run verify --prefix prototype`：22组浏览器检查全部通过，无意外console错误或未捕获异常；人为401/503与WebGL不可用诊断分别标注。
- 新技能结构验证通过；独立复核确认运行步骤、参数与输出路径可复现。项目内Markdown相对链接与`git diff --check`通过。

### 关键观察

| 项目 | 本次结果 | 适用范围 |
| --- | --- | --- |
| 4K先显示 | 点击到4K就绪约102ms；高分辨率含1.7秒注入延迟与显影，共2525ms | 本机素材，有主图预载/缓存；不是NAS速度承诺 |
| 色彩与方向 | 合成图顶部6色色条逐通道最大误差0（容差4） | sRGB帧缓冲像素；不等于物理屏幕色准/HDR验收 |
| 60.2MP与边长 | 原尺寸9504×6336分块缩放通过；模拟最大纹理4096时走瓦片 | 实际测试环境最大纹理16384，4096为显式受限测试 |
| 20k元数据 | 跳到第2000个活动，可见资源就绪110ms，7个活动纹理、9次绘制 | 复用合成文件的2万条元数据；非2万独立源文件 |
| 100次浏览 | 暖机后与后段驻留峰值均129,904,128字节（约123.9MiB） | 128MiB照片纹理账本内，无持续增长；不是GPU实测 |
| 连续显影帧 | 桌面间隔P95约16.7ms，手机模拟约16.7ms | 本机Chrome短样本；不承诺所有手机60fps |
| 真实SDR | 6/6小样完成兼容高分辨率加载，其中5张瓦片、4张竖图 | 既有本地JPEG/HEIC/HEIF副本；不上传原图到外网 |

22组检查还覆盖切图竞态、关闭取消、四类失败后的预览保留与重试、同canvas切场景、键盘焦点、全屏成功/拒绝、减少动态、触屏缩放/旋转、单tap唤回HUD，以及context中断后切下一张再恢复的资产一致性。

### 视觉证据

[桌面主题](../design/previews/p05/desktop-theme.png) · [4K等待](../design/previews/p05/desktop-4k-waiting.png) · [单幅细看](../design/previews/p05/desktop-detail.png) · [大图细节](../design/previews/p05/desktop-61mp-detail.png) · [照片墙](../design/previews/p05/desktop-wall.png) · [手机主题](../design/previews/p05/mobile-theme.png) · [手机细看](../design/previews/p05/mobile-detail.png) · [手机墙](../design/previews/p05/mobile-wall.png)。

公开截图只有合成素材。真实小样已在Codex内置浏览器中实际打开检查；其自动截图仅留在忽略目录。机器可读全量证据见[p05-browser-evidence.json](p05-browser-evidence.json)。


## 真实边界与后续门槛

- **源与权限**：本轮使用本机已有副本与故障fixture；没有新NAS读取或写入。Range、版本、路径边界有HTTP测试，馆主会话、真正WebDAV和NAS的Range能力在P1验收。
- **准备与缓存**：素材预生成；惰性生成worker、进程间取消、生产临时盘预留与LRU在P1/P2实现。合成20k元数据压力不是读取20k独立原图。
- **色彩与HDR**：sRGB纹理链和色条像素可验证；HEIC原生解码、真实HDR→SDR转换、P3宽色域/HDR输出仍未验收。当前只接受已验证SDR小样，不以截断HDR代替色调映射。
- **平台**：本机Chromium与Codex内置浏览器；手机尺寸、DPR、触摸由桌面模拟，不是手机GPU实测。Safari、实际SDR/HDR屏幕与色度计测量尚未覆盖。
- **地图**：架构风险清单中的地图适配探针没有纳入本轮B/F核心原型；正式D展厅前仍须验证单canvas地图、许可与坐标系。
- **展示能力**：B、F为原型，A/C/D/E、视频/Live Photo、邻图推断和模型策展尚未实现。没有把旧DOM概念的测试沿用为新能力证明。

实现中的WebGL2与色彩设置依据[Three.js渲染器](https://threejs.org/docs/pages/WebGLRenderer.html)、[色彩管理](https://threejs.org/manual/pages/color-management.html)，上下文恢复依据[WebGL上下文丢失](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost)。上述文档能力与本项目实测分别记录。
