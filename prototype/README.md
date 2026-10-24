# P0.5：全画布观展原型

Three.js / TypeScript 原型，B主题展览、简化F照片墙与单幅细看共用一个WebGL2 canvas。暖白展厅切换到暗色看图，4K首帧显示后才请求高分辨率资源；就绪后完成短暂显影。照片始终使用sRGB SDR颜色链。

## 运行

需要Python3.11+、uv及Node（Vite要求`^20.19.0 || >=22.12.0`；本机使用26.1.0）。从仓库根目录执行：

```bash
npm ci --prefix prototype
uv sync --extra media
uv run --extra media python tools/prepare_prototype.py
npm run build --prefix prototype
uv run python tools/prototype_server.py
```

打开 <http://127.0.0.1:8787>。准备器默认仅生成演示素材；本机已有P0媒体实验时，可用`--include-private`复用其中6张已验证SDR的本地副本。不会重新扫描或写入NAS。素材与真实照片均在忽略目录`data/`，换机器没有真实照片时仍可运行演示。

开发模式可以另开`npm run dev --prefix prototype`，其API代理指向上述本机服务。验收用构建后的8787入口。结束预览时在运行服务的终端按Ctrl+C；这是前台原型服务，不安装常驻守护进程。

## 怎样体验

- 上方“演示藏品／本机小样”切换素材。主题模式：上下滚动或↑↓切活动，横向滑动或←→换照片。
- 点击照片进入单幅查看。滚轮、双指或“放大细看”缩放，拖动查看细节；Esc或“返回展厅”退出。
- “验证”选择正常、慢速2秒、读取失败、解码失败、源版本变化；这些是本机HTTP故障注入。切换后会重新读取当前照片。
- 已缓存的大图可直接显示；不会为了显影刻意等待。慢速状态保留可用4K；故障保留预览和重试入口。
- “照片墙”铺满视口；点击返回同一套大图流程。“全屏”或F申请浏览器系统全屏，被拒时维持视口铺满。
- 控件在空闲时收起，移动指针、轻触或键盘操作可唤回。“减少动态效果”可在验证台切换，也读取系统偏好。
- “看见每一个像素”是9504×6336合成色彩／分辨率图，缩放时按视区加载原始分辨率瓦片。

## 自动复验

保持8787服务运行：

```bash
npm test --prefix prototype
uv run --extra media python -m unittest discover -s tests -v
npm run verify --prefix prototype
```

浏览器测试默认使用本机Google Chrome；其他机器用`MUSEUM_CHROME`指定实际浏览器可执行文件。`MUSEUM_URL`可覆盖本机原型地址。测试脚本存于`tests/browser.mjs`，操作的是隔离的测试浏览器上下文。公开截图仅含合成素材；真实样本截图只写入忽略目录。

## 实现边界

- `tools/prototype_server.py`是只监听127.0.0.1的素材服务，具有路径白名单、版本头、Range和故障响应。**不是生产馆主鉴权或WebDAV适配器**，不可作为局域网部署版本。
- “本机小样”的高分辨率内容是从既有真实原始成片副本生成的sRGB兼容图／瓦片，不是原生HEIC或HDR展示。本轮不读取NAS原路径；P1接入真正源接口。
- 所有瓦片在素材准备阶段预生成，尚无按需生成worker或生产缓存LRU；准备目录硬预算500MB，原型照片纹理预算128MiB，HUD、backbuffer和CPU解码副本另计。
- `window.__museum`是本机验收接口，提供状态、故障、20k合成元数据及context-loss探针；不能当成正式客户端API。
- 没有A/C/D/E展厅、Live Photo／视频、元数据推断、智能选片或后台管理。它们按总路线继续实施。

实际结果、截图与未覆盖项目见[验收报告](../docs/research/p05-validation.md)。
