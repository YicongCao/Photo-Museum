---
name: photo-museum-webgl-validation
description: 运行并复验 photo-museum P0.5 单画布原型、4K到高分辨率显影、瓦片与资源恢复；用于本地原型回归，不证明生产WebDAV、鉴权或原生HDR能力。
---

# 全画布原型复验

先读`docs/STATUS.md`、`prototype/README.md`和`docs/research/p05-validation.md`。使用仓库锁定依赖，不把旧DOM概念页当成WebGL证据。

从仓库根执行`npm ci --prefix prototype`及`uv sync --extra media`。没有`data/prototype/manifest.json`时运行`uv run --extra media python tools/prepare_prototype.py`，默认只造合成素材；已有本机P0样本且在任务授权范围内时可加`--include-private`。无需NAS访问、凭据或全库重新扫描。

执行`npm run build --prefix prototype`，再启动`uv run python tools/prototype_server.py`，仅监听127.0.0.1:8787。不要以仓库根静态服务替代这个白名单服务；它不是生产登录系统。素材准备器版本改变后需要重新准备并重启服务，因为进程启动时读取manifest。

复验入口：

```bash
npm test --prefix prototype
uv run --extra media python -m unittest discover -s tests -v
npm run verify --prefix prototype
```

浏览器脚本默认使用本机Chrome；先核验可执行文件，其他机器通过`MUSEUM_CHROME`指定，不能复用旧机器的临时浏览器路径。脚本会写公开合成截图与汇总JSON；真实照片截图、失败截图留在忽略的`data/prototype-verification/`。本机媒体不得进入Git。

除自动结果外，实际打开原型检查主题/照片墙、单图色彩与方向、显影、隐藏控件唤回、移动布局和错误反馈。帧间隔只统计连续动画帧，按需渲染的空闲间隔不算掉帧。纹理账本是RGBA估计，不能称为真实显存测量；DPR2触摸模拟不等于手机实机验收。

已发现过的回归：Window.fetch丢失调用上下文；屏幕坐标反转后的背面剔除；非整倍数大图的二分瓦片层级略小于4K导致预算无法选层；context恢复使用旧选择；单tap唤回、双指转单指及键盘返回焦点。修改相关代码时保留对应行为检查。

记录实际命令、运行版本、通过/失败和局限到`docs/research/p05-validation.md`及阶段日志。不要把fixture的Range/故障测试写成真实NAS验证，不把sRGB色条通过写成HDR或物理屏幕色准通过。完成验收若需交用户继续体验，保留服务和标签并说明入口；否则停止自己启动的预览。
