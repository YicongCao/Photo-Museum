# 统一状态系统：实现与复验

2026-10-26。用户指出 Gallery 左上角直接显示 `Failed to fetch`，要求状态、加载、Logo、横幅和 Timeline 具有共同的视觉语言，并形成工程规范与设计 skill。

## 定位与改动

请求函数此前直接放行浏览器 fetch 异常；Gallery、设置、策展等页面把 `e.message` 插入普通段落。Gallery 后台读取恢复也没有清除旧错误，因此服务恢复后仍可能留下报错。正式服务在本轮开始时在线，未故意关闭正式服务复现。

现在请求层将连接、超时、无效响应、HTTP错误、错误密码和主动取消分类；只显示受控公开文案。不会把 HTML、异常、路径或未知服务端字符串渲染到提示里。已知业务信息如设置冲突、NAS权限、缓存超额仍保留含义。

状态视觉复用现有烟色玻璃、细线 SVG 和黄褐操作色。首次读取居中；后台失败保留画面并使用紧凑横幅；表单失败保留输入；恢复清除对应错误。暗房和照片流保留仍可用预览，分页可只读重试。请求取消不显示失败，也不会为重试重发付费策展或写操作。工具主动展开的诊断日志保持原有职责，不当作顶层报错。

加载入口等鉴权结果后再显示密码表单，并验证“bootstrap先返回、鉴权稍后返回”的次序，修正自动填充观察器在这种时序中没有绑定的竞争。断线时保留已加载页面而不是退回密码框；只有明确401才要求重新解锁。

规范：[界面状态与材质](../design/system-status-language.md)。复用技能：[photo-museum-design-system](../../.agents/skills/photo-museum-design-system/SKILL.md)。视觉样本：[状态图册](../design/status-atlas.html)。

## 验证与证据

全部使用隔离 P5/P6 合成图库、假模型及本地文件源，不将真实照片或提示词发送给 provider。故障只注入独立浏览器上下文。

- 4项 `node --test web/tests/status-text.test.mjs`：安全回退、领域文案、fetch/非JSON/401/超时/取消、204以及写入不自动重试。
- 9组 `node web/tests/status-system.mjs`：鉴权入口、首次失败、后台恢复、全局去重、Dashboard真实时间、Settings输入保留、七类展厅、策展只读重试、手机密码错误。包含1500×940、390×844、320×720、844×390和减少动态效果。
- 3组 `node web/tests/status-media.mjs`：分页失败保留照片、4K失败保留缩略图、双预览失败停止加载并能从本地缓存重试；零原图请求。
- 回归：Gallery原生导航/显影12组、策展11组、Settings11组、4K渐进显示8组、共享导航8组。合计本轮66组/项检查通过，不等于66个独立用户场景。
- skill-creator 的 `quick_validate.py` 检查通过；Vite生产构建及 `git diff --check` 通过。未修改Python数据库/刮削逻辑，本轮不重新声称后端全套验收。

[状态证据](system-status-evidence.json)、[媒体故障证据](system-status-media-evidence.json)、[回归汇总](system-status-regression-evidence.json)。公开截图位于 `docs/design/previews/system-status/`；运行日志和正式截图仅在忽略的 `data/design-system/`。

测试中先后发现并修正了加载容器禁用指针造成重试按钮不可点、空文案进入允许列表导致状态标题为空，以及初始化自动解锁观察器的时序问题。Settings原图释放测试原先在点击“返回”后立刻断言，早于离场动画及卸载；现在等真正退出再检查全部原图Blob撤销，未放宽释放要求。双预览失败使用冷浏览器上下文，避免已在内存中的缩略图绕过故障注入；截图等待场景退出克隆清理完成。

## 发布与边界

本次只更新正式静态前端：先复制带hash的资源，再原子替换index，保留旧资源；不因UI变更重启worker。正式Gallery已用现有会话完成刷新检查：照片、当前位置与时间线恢复，零可见错误，整页无滚动；截图在data/design-system/formal-gallery.png。API与worker沿用原进程。正式Gallery使用现有会话检查；不读取密码、cookie或钥匙串，不主动锁定用户。

统一提示解决的是错误表达、分类及恢复行为。历史扫描worker SQLite锁冲突不在本轮修复范围内，不能因为横幅好看就宣称服务可用性根因已解决。真实NAS断线、HDR硬件显示和用户对视觉效果的主观验收不由合成故障截图代替。
