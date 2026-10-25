# HDR / gain-map 的 SDR 显影修复

2026-10-25。本报告覆盖 SDR 缓存与按需兼容原图；不是物理 HDR 屏幕验收。

## 原因与 Apple 的处理方式

真实样本并不是一种编码。两张 iPhone 样本是 Display P3 SDR 主图＋Apple gain map；另外三张高光明显异常的样本是 BT.2020、10 bit PQ 主图，没有发现 gain map。不能把它们统一当作 SDR，也不能统一展开 HDR 后再次压缩。

Apple 的 [WWDC23](https://developer.apple.com/videos/play/wwdc2023/10181/) 说明：`CIImageOption.toneMapHDRtoSDR` 在其他处理之前得到 SDR，与 ImageIO `decodeToSDR` 等价；`expandToHDR` 才会合成 gain map 的 HDR 表现。ISO HDR 默认参考白为 203 cd/m²。其 [WWDC24](https://developer.apple.com/videos/play/wwdc2024/10177/) 进一步区分 gain-map 文件的 SDR 表现和 ISO PQ/HLG 的色调映射，并介绍系统改进的高光处理。直接使用公开 SDR 解码接口，比自行忽略 gain map 或套固定曲线可靠。

旧 PQ 分支使用 `npl=100` 和固定 `peak=10`，真实样本天空、云层和雪山明显发白。便携路径改为参考白 203、PQ 编码范围峰值 10000/203、HLG 参考峰值 1000/203；保留 16 bit 至浮点色调映射。此 Mobius 路径不等同于 Apple 的算法，极端高光仍会受 8 bit 输出量化影响。

## 当前实现

- macOS 14+ 且有 Command Line Tools：调用本项目 Swift helper，明确 `toneMapHDRtoSDR=true`、`expandToHDR=false`、应用方向，输出 8 bit sRGB。gain-map 的 SDR 表现不再人为扩展；PQ/HLG 交给系统处理。系统行为随 macOS 版本变化，不声称逐像素复刻某个 Photos 版本。
- Linux / 无原生解码器：已验证的 SDR＋ICC gain-map 基底只做 ICC→sRGB；纯 PQ/HLG 用修正后的高位深映射。HDR 基底＋gain map 无可靠 SDR 解码时标记需适配，不能忽略 gain map 宣称正确。尚无真实 Linux gain-map 全格式验收。
- Swift 在首次需要时本地编译，源哈希、系统版本、架构组成二进制键；文件锁和原子发布避免并发编译。编译物在 `data/server/native-codecs`，不在照片缓存内。编译失败明确报错，不静默使用旧映射。
- 原生解码进程每张结束即退出，临时 PNG 在成功、失败时均清理；只有 thumb/display WebP 常驻。暗房兼容 JPEG 复用同一转换函数，仍在请求结束/取消后删除。
- HDR 单独使用 `media-hdr-sdr-v3`，普通 SDR 保留 `media-srgb-v2`。新缓存触发对应主体/人脸/评分重算，人工分组、元信息修订、收藏不覆盖。完成计数按每张当前媒体版本判断，重试中的旧完成记录不算新完成；缓存 URL 加 render 版本。

## 验证

真实对照含三张 PQ 和两张 Apple gain-map 照片，私密结果均在忽略的 `data/gainmap-validation`，不提交源图、路径、EXIF、GPS。参考分别用 Core Image SDR 与 ImageIO `decodeToSDR` 生成。4K WebP 经相同比例缩小后，与参考图 RGB 平均绝对差约 1.2–2.4/255，包含缩放和有损编码差异，不作为感知色差指标。

最严重样本原缓存近白像素比例约 4.53%，修复后低于 0.01%；人工对照可见蓝天、云层、雪山层次恢复。近白定义是三个通道均 >250；白色本身不等于错误，此指标仅辅助同图对照。两张已是 SDR 基底的 gain-map 样本主要验证没有二次映射，不声称原先均严重过曝。竖幅方向及原尺寸也已检查。

自动回归覆盖 PQ/HLG 灰阶、实际合成 HEIC 容器、原生 SDR 解码、方向、临时文件清理、gain-map 选择、定向队列的幂等性、人工信息保护、每版本完成事件和缓存更新。真实 HLG HEIC / ISO HDR 基底 gain map 尚无本轮真实样本，不用合成测试冒充。

## 定向重建

先停止 supervisor，等待媒体租约过期。只修改本地队列，不接触 NAS 内容：

```bash
PYTHONPATH=. uv run --all-extras python tools/apply_hdr_sdr_policy.py --receipt data/hdr-dry-run.json
PYTHONPATH=. uv run --all-extras python tools/apply_hdr_sdr_policy.py --apply --receipt data/hdr-retry.json
uv run --all-extras python -m photo_museum
```

脚本仅选旧 HDR 成片缓存和明确 HDR 错误，不重跑普通 SDR、不处理独立视频或越界二级目录。保留旧预览供重建期间浏览，生成成功后原子替换；旧图不会永久残留一份副本。新版本已完成/已排队条目不会被重复加入。重建依然遵循目录倒序、单目录媒体与分析完成后再进入下一目录。必须按私密收据检查 ready、分析及当前版本完成事件，入队不代表完成。

全量后端 87 项测试通过（含 8 项 HDR 专项）。定向重建实际入队 1,219 张：旧 ICC HDR 标记 414、旧 PQ 映射 754、明确 HDR 错误 51。2026-10-25 09:32 本机快照：52 张已生成原生 SDR 预览、52 张分析与新版本完成事件，包含 27 张检出 gain map 的照片；该批暂无失败，剩余继续后台处理。缓存账本只有 thumb/display。真实对照额外下载的 97.7 MiB 原文件在验证后已删除，未成为照片缓存。
