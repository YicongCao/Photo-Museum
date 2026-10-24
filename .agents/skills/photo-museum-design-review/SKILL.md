---
name: photo-museum-design-review
description: 验证 photo-museum 的独立 HTML 概念与展览交互，记录桌面手机证据；用于设计复审，不代替真实照片色彩或正式服务验收。
---

# 展览概念验收

已确认暖白纸感＋Swiss场景排版、暗色单幅细看。先读`docs/design/experience.md`、ADR 0002和`docs/STATUS.md`。A–F正式观展全部采用一个Three.js/WebGL canvas，禁止将旧DOM/CSS研究当作已确认交互架构。

历史入口`docs/design/concepts.html`使用虚构主题与内嵌SVG，无外部依赖，仅保留色彩/气质参考。以下流程是旧HTML已验证的复审步骤；新WebGL/冲印动画尚未验证，不能照抄为新系统验收记录。需要浏览器复审时仅从`docs/`启动loopback静态服务，不暴露私密`data/`。

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs
```

通过当前可用浏览器工具验收：主图完整灯箱、前后翻页、收藏状态、Esc/焦点恢复、年份主题切换、照片墙随机排列。检查1440桌面与390手机宽度下文字、网格和横向溢出；测试后重置临时viewport。改HTML后reload，再取新状态。

截图保存`docs/design/previews/`，只放不含真实照片的概念截图；在阶段日志列实际验证行为。控制台错误和正常加载不等于布局验收，SVG效果不代表HEIC/HDR已通过。日历、地图和器材仅有概念入口时明确标为未实现。

结束时停止自己启动的临时服务；交付离线HTML绝对链接。新版风险原型通过实际验证后，再补独立技能步骤；本技能不宣称WebGL颜色、显存、4K→原图或推断已跑通。应用使用标准浏览器canvas，不依赖编辑器私有canvas运行时。
