# P5 四展厅实现与验收

2026-10-25。本轮范围为用户指定的日历、地图、器材馆、时空隧道，依次实现。经典 Cover Flow 保留首次进入的默认首页；Gallery 菜单选择展厅，同一浏览器会话记住最近展厅。决策见 [ADR 0005](../decisions/0005-p5-exhibition-rooms.md)，实现前布局见 [概念页](../design/p5-rooms.html)。

## 可验收路径

- **日历**：年、月、周切换，照片格、真实数量、日期集合照片墙和暗房。只知道年月的照片不放进某一天；只知道年份的照片不放进某个月。“日期未详”单独进入集合。接受的推断日期保留标识。年切月选择有照片的月份，只有年度信息时不伪造一月。
- **地图**：本地世界底图、缩放/拖动/触控/键盘，国家 → 省州 → 城市 → 活动逐层进入。集合照片墙可以返回原层级。只使用有效 GPS 与输入记录匹配的地址，过期地址不参与；未定位、地址未解析单独可查看。“最近城市”与推断精度可见，聚合点不是照片的精确拍摄点。
- **器材馆**：相机/镜头分别列出，使用年份图、关联器材、标记筛选、五图陈列、全部照片及单图暗房。优先有效技术评分，未评分仅作后备并标示；不是审美喜爱概率。已适配机型采用原创 SVG 结构示意，其他型号为类型示意；不是精确 CAD 或每款设备的独立外形复刻。
- **时空隧道**：独立于 Cover Flow 的 CSS 纵深展板，滚轮、拖动、左右键、位置滑杆和三级时间线导航；最多驻留七块活动展板。点击进入原有主题照片墙，返回保留活动。减少动态效果时使用单块平面展板。

新增集合复用既有横向原比例 4K 照片墙、显影与原图取消流程。日历、地图、器材聚合只包含有 thumb/display 双缓存的可展示成片；视频继续从活动墙浏览，未将仅索引的视频伪装为照片缓存。切换展厅取消旧请求、释放预热 Blob；原文件只在单图详情按需读取，不因展厅统计重新刮削。

## 数据与资源

`photo_museum/exhibitions.py` 从同一 SQLite 读事务建立有界生命周期的投影快照，复用最多五秒；只选取尺寸、版本、有效日期/GPS/器材、当前评分及地址所需字段，不重复装载整份 EXIF 或人脸特征。手工值优先，人工 null 有效；未接受推断、过期源版本、隐藏/缺失/越界/占位项不进入集合。人工标记、元数据修改和推断审阅会立即失效快照；观展数据随 Gallery 的十五秒轮询刷新。

集合分页上限 200；预热仅前十五张本地 4K，四路并发。地图几何按需加载，页面、字体、图像、底图均无第三方运行时请求。sessionStorage 只存展厅、日期锚点、器材/地点 ID 与交互位置，不存原图、EXIF 或 GPS 坐标。

真实索引只读快照约 1.16 万张可展成片。精简投影后，相同 tracemalloc 方法测得峰值由约 402 MiB 降为 151 MiB；不启用跟踪器的独立进程冷读约 3.0 秒，快照命中约 0.02 毫秒，进程峰值 RSS 约 213 MiB。这是当时的本机样本，不是全量完成数量或性能承诺；收据仅在忽略的 `data/p5-validation/`。

## 来源与许可

- 世界几何采用 [Natural Earth 1:110m 国家数据](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson)，177 个要素；[Public Domain 条款](https://www.naturalearthdata.com/about/terms-of-use/)。来源与本地文件 SHA-256 见 [清单](p5-map-source.json)。底图只用于概览，无街道/详细行政边界数据。
- 投影采用 [D3 geo 官方实现](https://d3js.org/d3-geo)，锁定 d3-geo 3.1.1，ISC（包内 GeographicLib 段另保留 MIT），许可原文随前端分发在 `/assets/p5-licenses.txt`；未使用在线瓦片或地理服务。
- 地址沿用本地 [GeoNames](https://www.geonames.org/export/)，CC BY 4.0；最近城市不补造街道。底图和地址署名在页面保留。
- SVG 结构参考厂商公开产品资料：[Sony ILCE-7CR](https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7cr/specifications)、[Fujifilm X-T50](https://www.fujifilm-x.com/en-us/products/cameras/x-t50/)、[Ricoh GR IV](https://www.ricoh-imaging.co.jp/english/products/gr-4/spec/)、[Canon EOS 6D Mark II](https://www.canon-europe.com/cameras/eos-6d-mark-ii/)。没有复制厂商照片或图标；图形只是结构/类型示意。

## 本轮验证

- 全部 Python 回归 **99 项通过**，新增六项覆盖日期精度、人工 null、有效/未接受推断、即时失效、根目录活动 ID、排除规则、GPS/地址输入隔离、器材统计、鉴权与零 NAS GET。
- 四展厅 **26 项浏览器检查通过**：[记录](p5-browser-evidence.json)。覆盖三种日历粒度、月切换、位置层级、器材筛选、纵深导航、集合/暗房往返、减少动态效果、390×720 与 1280×720 一屏、重载恢复、Blob 释放、读取失败重试与底图失败恢复。
- 空状态、切换竞争和键盘菜单 **7 项检查通过**，见 [记录](p5-states-evidence.json)，空数据由隔离浏览器注入，不是实际图库为空。
- 原有经典 Cover Flow **17 项回归通过**：[记录](p5-coverflow-evidence.json)，包括 5/10/20 封面、暗倒影、15 项预热、飞散/入场、3:2 档案布局、返回保位和减少动态效果。
- 正式与隔离前端构建通过；公开 [桌面/手机截图](../design/previews/p5/) 均为合成照片。使用 IAB 手动确认 Gallery 菜单与日历年月视图；没有把合成图当作真实色彩、器材识别准确率或用户主观认可。

本轮不重复声称原生 HDR、物理手机和 Docker 四展厅已做新一轮硬件/平台验收。原计划 B 长卷、F 高级屏保及 P6 agent 仍独立保留，没有随四展厅上线自动勾选。

复验命令与隔离构建方法见 [项目 skill](../../.agents/skills/photo-museum-media-validation/SKILL.md)。正式入口为 <http://127.0.0.1:8790/#gallery>。

正式切换后首页200，未登录四类展厅接口均401；API和四类worker已恢复，媒体未暂停，观察到新的文件完成事件。隔离测试服务已停止。当前浏览器为馆主解锁页；未读取真实密码、未代替用户进行登录后的人工验收。工程过程见[日志](../logs/2026-10-25-p5-exhibitions.md)。
