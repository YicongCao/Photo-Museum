# 统一 Settings 复验

先读 docs/decisions/0007-unified-settings.md 与 docs/research/unified-settings-validation.md。正式配置含真实凭据；测试只用隔离 fixture，不能把已保存 key 回填或发到聊天。

```bash
npm run build --prefix web -- --outDir ../data/settings-validation/web-dist --emptyOutDir
PYTHONPATH=. uv run --all-extras python tools/settings_validation_server.py
# 等 8797 输出 ready，再另开终端：
uv run --all-extras pytest -q tests/p1/test_settings.py
node web/tests/settings.mjs
MUSEUM_TEST_URL=http://localhost:8797 MUSEUM_BROWSER_OUTPUT=docs/design/previews/settings/p6-regression MUSEUM_BROWSER_EVIDENCE=docs/research/settings-p6-evidence.json node web/tests/p6.mjs
```

fixture 生成84张图、本地三城GeoNames和fake LLM；没有模型下载/付费调用/NAS连接。测试会修改这个临时库的设置，不对正式8790执行。`PYTHONPATH=.` 保证工具入口可导入 tools 包。正式启动仍使用 supervisor，不能将 fixture 的 MUSEUM_WEB_DIST/MODELS/TEST_PROVIDER 环境传播过去。

按需模式必须在点按前零原图请求；原生解码失败仅回退一次并保留4K，关闭后两份原图Blob都撤销。活跃画板预取Blob仍可合法驻留，跟踪原图需单独按内容类型/请求标记区分。模拟 matchMedia 只验证回退逻辑，物理HDR另验。

GPS规则保存后验证 worker实际应用版本、待处理减少至0、旧GPS/人工记录保留、NAS调用计数不增。暂停只停地址计算；媒体全局暂停时地址也暂停。UI每5秒刷新，等待实际完成标签而非仅后端已完成后立刻截屏。revision冲突后显式重新读取，不能自动覆盖未保存草稿。

密码/key编辑框留空、保存仍可显式测试连接；进入页面本身不自动连接照片源或发LLM调用。手机/矮窗口检查五个分类和内部滚动；来源较长名称须换行。结束停止8797fixture，保留正式8790及用户指定的Settings页。
