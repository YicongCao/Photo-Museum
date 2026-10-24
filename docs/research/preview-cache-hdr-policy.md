# 预览缓存、HDR HEIC 与大文件策略验收

日期：2026-10-25。本轮实现按用户最新约定替代旧的兼容全图常驻策略。NAS 内容只读，源文件没有修改。

## 已实现的策略

- 常驻媒体派生文件仅 `thumb`（最长边 640）和 `display`（最长边 3840），WebP / sRGB / SDR。超大文件的这两个入口指向仓库预制 SVG 占位图，不伪称是真实 4K 或抽帧结果。
- `still()` 默认不生成全尺寸 JPEG；暗房显式请求 `original-compatible` 时才从 NAS 读取、按全尺寸转换。单次请求独立临时目录，串流结束、异常、断开连接均清理，响应 `private, no-store`，不登记到常驻缓存。保留单次 256 MiB 与单并发转换边界。
- 缓存中旧 `compatible` JPEG 与 `playback` 视频派生文件已清理。普通视频/Live Photo 播放改为按需读取 NAS 原文件，由浏览器原生解码；不再预制常驻转码视频。浏览器不支持源编码时暂不能播放，原文件读取仍有 256 MiB 上限；本轮没有实现按需视频转码。
- 未标记色域的成片按 sRGB 转换并入库。`media_info` 保存 `color=untagged_assumed_srgb`、`assumed_color=true`、`score_penalty=15`；本地技术评分保存 `raw_score`，展示分为 `max(0, raw_score-15)`，理由 `assumed_srgb`。既有 76 条同类假定记录也已补记并幂等降权。明确标注但尚未支持的色彩编码不会冒充“无标记”。
- 超大图片：文件大于 256 MiB，或已知/解码头部显示超过 1.1 亿像素。超大视频：文件大于 2 GiB。大小或既有像素信息已知时零 GET；首次遇到文件体积未超限、像素信息未知的照片时，取回文件后检查 EXIF/解码头部，发现像素超限即停止解码，随后清理工作目录。占位图固定为“此图片超大”“此视频超大”。无论是否有同名照片，超大视频都不取回、不抽帧、不转码。
- 占位文件保存基础索引，标记 `metadata_only`/`placeholder`；不运行主体、人脸、评分，也不进入自动十图精选。照片墙保留占位入口。暗房不自动下载，原图 API 对占位文件返回 413。
- 未超大且无同名照片的独立视频继续原有零 GET、仅索引策略。

## HDR 修正依据与实现

ExifTool 的合并元数据可能来自 HEIF 辅助图：真实样本中，一张 8-bit Display P3 ICC 的主图被辅助图 PQ 标签误判。现在以主图 NCLX、位深和 ICC 判断；有有效 SDR 主图时转换该主图，不重复色调映射。

真正 PQ / HLG 主图由 pillow-heif 保留 16-bit 解码，使用 NCLX 的 BT.709 / BT.2020 / Display P3 原色与 PQ / HLG 传递函数。FFmpeg zscale 转线性浮点 RGB，再用 Mobius 映射到 SDR，最后编码 sRGB。当前采用 100 nit SDR 参考与 1000 nit 映射峰值的明确策略，未实现逐图动态峰值估计；不宣称等同于作者在 HDR 屏上的视觉意图。原始分辨率写入索引，预览路径先缩至 3840；按需兼容图保留全分辨率。

参考：[pillow-heif 位深](https://pillow-heif.readthedocs.io/en/latest/image-modes.html)、[open_heif API](https://pillow-heif.readthedocs.io/en/latest/reference/API.html)、[FFmpeg zscale / tonemap](https://www.ffmpeg.org/ffmpeg-filters.html)。保留现有 `media-srgb-v2`，使用 `cache_policy=preview-only-v1` 记录本次策略并按错误类别定向重试，避免触发已成功照片的整库重做。

## 验证与部署

真实源抽取三张原 PQ 报错 HEIC：8-bit ICC SDR 主图、10-bit PQ BT.2020 RGBA、10-bit PQ Display P3 RGB。三张均成功转换并检查预览，转换耗时约 3.9 / 13.0 / 10.5 秒。另取一张完全无色域标记 HEIC，确认 sRGB 假定及 15 分标记。HLG 路径本轮使用合成灰阶验证，未找到并抽验真实 HLG HEIC；不是硬件 HDR 验收。

合成回归覆盖 PQ / HLG × BT.2020 / P3 的灰阶单调性、中性色一致性、临时文件删除；超大图/视频零 GET、拒绝原图入口、占位不分析不精选；缺色域降分与幂等迁移；定向重试范围，不触碰其他错误和范围外文件。兼容原图端点另覆盖失败/取消清理。

真实按需全尺寸 PQ 兼容请求：8856×5904 JPEG，10,809,650 字节，40.05 秒，消费响应后临时目录为空、全尺寸常驻记录为零。抽样原文件验证结束后清理；私密元数据、转换预览、截图与收据只在忽略的 `data/policy-validation/`。

服务短暂停止以应用策略、等待租约释放后重启。删除 8,590 个派生文件，共 68,058,647,690 字节（63.38 GiB），新常驻缓存约 7.1 GiB。实际删量与先前快照不同，因为正常任务一直在产出新缓存。

定向入队：926 条 `pq_or_hlg_transfer`、52 条 `unknown_color_profile`、4 条超大视频失败、1 条超大 JPEG 失败；另外发现 9 条以前已仅索引但没有占位图的超大视频，一并补齐。共 992 条。其他 51 条 gain-map / HDR 元数据相关待适配项未盲目重试。新队列回到目录倒序处理，正常扫描和媒体/分析 worker 继续运行；入队不等于整批已完成。

## 复现迁移

先停止 supervisor 及其 worker，等待最长 30 秒的旧租约过期。`tools/apply_preview_policy.py` 持有缓存写锁且在发现有效租约时拒绝执行。默认只输出清理/重试预览：

```sh
PYTHONPATH=. uv run --all-extras python tools/apply_preview_policy.py
PYTHONPATH=. uv run --all-extras python tools/apply_preview_policy.py --apply --receipt data/policy-receipt.json
uv run --all-extras python -m photo_museum
```

`--apply` 只删除缓存目录内生成的兼容/播放文件以及旧临时工作目录，保留缩略图/4K、EXIF、人工标注及 NAS；重试按当前源版本与有效范围过滤。收据包含定向任务 ID，必须保存在忽略目录，不提交。

```sh
uv run --all-extras pytest -q
npm run build --prefix web
```

当前浏览器验证入口 <http://127.0.0.1:8790/#manage>，已观察任务运行、缓存占用变化和超大视频静态占位。最终进度是时间点快照，见下文。

### 交付前快照

2026-10-25 07:49:42 +0800：926 条 HDR 重试已有 27 条媒体转换成功、1 条运行中、898 条待处理；52 条缺色域重试已成功 5 条。8 条超大视频已完成占位索引，另外 6 条超大文件仍按目录顺序排队。本轮重试无新错误；其他 51 条待适配仍保留。常驻账本只有 display/thumb，共约 7.14 GiB；媒体未暂停。该成功数是媒体转换状态，不等于本地分析已经全部完成。

最终 `.venv/bin/pytest -q`：74 passed（47.49 秒）；`npm run build --prefix web` 成功；现有媒体验收 skill 校验通过。真实 Dashboard 截图与逐项收据保存在 `data/policy-validation/`。
