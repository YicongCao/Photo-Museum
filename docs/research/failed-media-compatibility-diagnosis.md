# 少量真实预览失败的原因与兼容评估

2026-10-26。用户点名的五个失败文件，仅做原因定位和兼容验证；本轮没有修改正式转换规则、暂停处理、重试队列或NAS源文件。文件名、路径、EXIF、摘要和样本图只在忽略的 `data/failed-media-diagnosis/`。

## 实测结论

当前运行依赖为 Pillow12.2.0、pillow-heif1.3.0、libheif1.21.2。五个样本取回后的长度均与当前索引一致，使用项目WebDAV下载器的版本/长度校验，未在网络事务中持有SQLite写锁。异常均在本地预览转换复现，不能仅靠`ValueError`/`OSError`判断源图已经损坏。

- **一张HEIC容器引用较多**：libheif在解析iref时拒绝1750个引用，当前阈值1000。原图约56.6MP，没有超过项目1.1亿像素上限。Apple原生SDR解码成功。建议保留全局限制，在已验证输入尺寸/文件大小的边界内优先用独立进程原生解码；不能为这张照片全局关闭libheif限制。[libheif安全说明](https://github.com/strukturag/libheif/blob/master/SECURITY.md)明确这些限制用于约束CPU与内存；pillow-heif的[配置文档](https://pillow-heif.readthedocs.io/en/latest/options.html)也区分禁用安全限制这一开关，本轮没有改变该开关。
- **三张JPEG流结尾不规范**：Pillow分别报告`image file is truncated (1 bytes not processed)`、两次`(5 bytes not processed)`；主数据流尾部都没有EOI结束标记。仅给临时副本补`FF D9`，三张即能严格解码；Apple原生解码同样成功。这里的1/5指解码器尚未处理的缓冲字节，不能解释为文件恰好丢失1/5字节，见[Pillow源码](https://pillow.readthedocs.io/en/stable/_modules/PIL/ImageFile.html)。建议有记录的临时EOI容错或原生兼容，并标注容错恢复；不修改源文件，不全局启用`LOAD_TRUNCATED_IMAGES`。能解码与目视完整不能证明不存在任何原始数据缺失。
- **一张SDR HEIC没有主图ICC，但有NCLX**：主图RGB/8bit、色度原色12、传递函数1、矩阵6、full-range1。Pillow/libheif已经能解码，但项目目前只接受ICC或明确sRGB组合，于是主动报`unsupported_sdr_nclx`。该组合有声明的P3原色信息，应正确转换到sRGB，不能归到“未标色域，直接按sRGB处理”。Apple原生路径成功；目前原生入口只在hdr_reason为真时触发，覆盖不到这类SDR输入。应单独扩展SDR兼容分支，不把它标成HDR。

## 兼容可行性与边界

复用项目已有Core Image helper，五张均成功生成display和thumb WebP，共十个文件。已重新打开校验RGB、尺寸上限、有效ICC和可完整解码；低分辨率源不放大。已检查五张缩小后的私密预览，没有明显花屏、缺行或大块填充。Apple接口和边界沿用[已有HDR研究](gainmap-sdr-validation.md)及[Apple官方说明](https://developer.apple.com/videos/play/wwdc2023/10181/)；这次成功读取包含SDR样本，不意味着这五张都属于HDR。

建议补兼容，优先次序是：JPEG受控EOI容错、Mac原生解码兜底、无ICC的已知NCLX SDR颜色转换。正式落地时仍需合成回归、记录实际renderer及恢复原因、保护EXIF/人工标签、失败时保持需处理；只定向重试这批，不升级普通SDR全库版本。本轮不是实现交付，正式队列仍保持原状。

Mac原生成功不等于Linux/Docker兼容完成。后两者需验证libheif受限配置与NCLX转换；不建议直接关闭全部安全限制或忽略色彩标签。恢复后的图片可以展示，但JPEG容错应保留来源状态，不当作源文件已经修复。

## 临时文件与正式任务

两轮下载均位于独立TemporaryDirectory，退出后原文件、spool、临时PNG/WebP全部清理，确认剩余临时目录数为0。仅私密证据JSON和缩小后的诊断PNG留在data中，没有写入常驻缓存账本。原后台worker与刮削任务不因诊断而重启或修改。
