---
name: photo-museum-p1-validation
description: 复验 photo-museum 的 WebDAV 直连、馆主登录、持久刮削队列和原文件续传；区分合成协议证据与真实 NAS 验证，不代表 EXIF、4K 或 HDR 已完成。
---

# P1 服务验证

先读 `docs/STATUS.md`、`docs/operations/p1-service.md` 与 `docs/research/p1-validation.md`。使用 `uv.lock`、`web/package-lock.json`，本机 SQLite 留在 `data/server/`；不要将挂载目录盘点器当成正式 WebDAV worker。

从仓库根运行：

```bash
uv sync --extra media
npm ci --prefix web
npm run build --prefix web
uv run --extra media python -m pytest tests -q
uv run python -m photo_museum
```

正式本机入口为 `http://127.0.0.1:8790`，P0.5 的 8787 仍是另一个只读原型。首次馆主密码和 NAS 密码由用户在配置界面输入，不读钥匙串、不打印密码、哈希、会话或本地加密密钥。HTTPS 默认验签；HTTP 必须由用户明确允许。本次 5005 授权不自动扩展到其他部署或目标。

浏览器回归使用隔离的合成服务，先核验 Chrome 可执行路径。无需真实 NAS 密码：

```bash
npm ci --prefix prototype
PYTHONPATH=. uv run python tools/p1_validation_server.py
# 另一个终端
node web/tests/browser.mjs
```

黑底黄褐主题回归可用 `MUSEUM_SCREENSHOTS=docs/design/previews/black-ochre MUSEUM_EVIDENCE=docs/research/black-ochre-browser-evidence.json node web/tests/browser.mjs`，保留历史P1截图。脚本增加纯黑计算底色、主题色变量、图标和目录图表与实际任务计数一致的检查；分母仍发现时不称全库进度。当前Gallery实现顺序看ADR 0003，不再强制单canvas。

8791 fixture 每次启动创建临时数据库，退出后清理；浏览器脚本每次需一个新启动的 fixture。公开截图只能来自合成服务。真实活动名、文件列表、照片、路径和验证私有材料写 `data/p1-verification/`，公开报告只保留汇总。

真实验证先复用用户已经保存的源配置，选择一个小活动，不为测试修改 NAS。验证 `Depth:1` 目录完成、第二次扫描稳定 ID、已登录原文件读取、未登录拒绝。若测试字节续传，用 `photo_museum.download.download` 的取消回调中断小文件，再接续；只有强 ETag 且返回有效 206 才能记录为续传，200 必须重下，弱/缺 ETag 不能拼接。计算续传结果及独立完整 GET 的 SHA-256 进行比较。

故障、增删文件和源版本变化只在 fixture 注入。杀 worker 的测试仅杀测试自己启动的进程；租约过期后接续，旧令牌不能提交。暂停会阻止当前未完成目录提交，恢复后重新枚举该目录；不得将 207 部分失败、404、断网或暂停当作删除证据。不要以手改真实数据库任务状态代替产品按钮验收。

元数据复验需覆盖：提取失败不可变成原始事实；原始、推断、人工值隔离；人工 `null` 保持未知；推断默认不接受；供体必须同源同目录且有当前原始记录 ID；记录变更使依赖陈旧，旧历史保留。当前没有真实 EXIF/邻图算法执行。

更新报告、阶段日志和 STATUS，记录真实命令、结果与局限。保留用户验收所需的 8790 服务和标签，停止自己启动的 8791 临时服务。不把浏览器视口模拟叫手机实机，不把原文件字节读取叫 HEIC/HDR 显示验收。
