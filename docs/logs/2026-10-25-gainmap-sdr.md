# HDR SDR 显影修复记录

基线：5aa6b24，Python/React 的既有 uv.lock、package-lock 未更改，正式端口8790。媒体复验 skill、运行文档和 ADR0004 已检查。

Apple 官方 WWDC23/24 与本机 SDK 对照后，分别验证 SDR＋gain-map 和 PQ 主图；发现旧固定映射导致真实 PQ 天空高光严重丢失。加入隔离的原生 SDR helper、便携参考白修正和独立 HDR 媒体版本，暗房按需兼容输出复用同一路径。

新增测试验证实际 PQ/HLG HEIC 容器、方向、临时清理、gain-map 基底处理和定向重建；87项后端通过。真实三张PQ、两张Apple gain-map与Apple SDR接口对照，私密结果只在data。记录见[验证与限制](../research/gainmap-sdr-validation.md)。

停止 supervisor，私下备份本地SQLite，确认租约结束后以专用脚本定向入队1,219张，恢复 API/扫描/媒体/分析进程。09:32快照确认52张新预览、52张新分析/完成事件，未见该批失败；正常队列未暂停。缓存账本仅thumb/display，验证临时下载原文件已删除。正式浏览器刷新到管理入口，当前需要馆主解锁；没有绕过登录或读取钥匙串。全批重建仍在运行，不能将入队计为已完成。
