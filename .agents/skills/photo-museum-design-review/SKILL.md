---
name: photo-museum-design-review
description: 验证 photo-museum 的独立 HTML 概念与展览交互，记录桌面手机证据；用于设计复审，不代替真实照片色彩或正式服务验收。
---

# 展览概念验收

已确认暖白纸感＋Swiss主界面、暗色灯箱。先读`docs/design/experience.md`和当前ADR，避免再次询问已经决定的方向。

独立入口`docs/design/concepts.html`，使用虚构主题与内嵌SVG，无外部依赖。可直接文件打开；需要浏览器测试时仅从`docs/`启动绑定loopback的静态服务，不从仓库根目录暴露私密`data/`。

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs
```

通过当前可用浏览器工具验收：主图完整灯箱、前后翻页、收藏状态、Esc/焦点恢复、年份主题切换、照片墙随机排列。检查1440桌面与390手机宽度下文字、网格和横向溢出；测试后重置临时viewport。改HTML后reload，再取新状态。

截图保存`docs/design/previews/`，只放不含真实照片的概念截图；在阶段日志列实际验证行为。控制台错误和正常加载不等于布局验收，SVG效果不代表HEIC/HDR已通过。日历、地图和器材仅有概念入口时明确标为未实现。

结束时停止自己启动的临时服务；交付离线HTML绝对链接，必要时用当前文件预览工具打开。不要引入canvas私有运行时，也不要把这个静态预览变成产品的无密码照片服务。
