# 全局词库复验

词库是 metadata-only 派生索引。先读 docs/research/keyword-lexicon-implementation.md；运行 `uv run --all-extras pytest -q tests/p1/test_lexicon.py` 验证别名/标准ID、并发token、版本/隐藏/推断、代际、分页和最终Show复验。不要把只读原型 tools/probe_keyword_lexicon.py 当生产构建器。

独立构建前端到 data/<本轮>/web-dist。以 MUSEUM_VALIDATION_CREATIVE=1、MUSEUM_VALIDATION_CURATOR=1、MUSEUM_VALIDATION_LEXICON=1、MUSEUM_FIXTURE_PORT=8793、MUSEUM_WEB_DIST=绝对构建目录、PYTHONPATH=. 运行 tools/p5_validation_server.py，等 synthetic ready 后执行 `node web/tests/keyword-lexicon.mjs`。MUSEUM_BROWSER_OUTPUT 可指定合成截图和证据目录；默认 data/keyword-lexicon-implementation/browser。浏览器脚本隔离context，fixture密码自动解锁，不等待点击已消失的按钮。重跑fixture若已有completed策展记录，提交后等待新的data-run-id和completed状态，避免把旧草案当新结果；定位查询工具限summary，隐藏的schema JSON也含lookup_keywords字符串。无结果的空rows高度为0，等待aria-busy=false附着，而非要求rows可见。短窗口同时检查侧栏和内容边界，新增设置分类可能撑开隐式grid行。

正式结构升级前先读user_version，并用sqlite3 mode=ro在线backup；本轮由9升级到11。停supervisor等待子进程退出后，再构造Database执行迁移。不得打印凭据或读取钥匙串。schema11对相关UPDATE增加值变化guard；复验无变化的media_jobs.status写入不生成dirty，并在正式空闲观察中确认revision不再增加。新supervisor自动附加独立lexicon_worker；它复用worker_runtime的BUSY/LOCKED退避。单次处理可用 `uv run --all-extras python -m photo_museum.lexicon_worker --data data/server --once`，这只是一个批次，不能据此声称全库完成。用status的ready/building/pending及真实代际确认完成；不要为了补词库GET原图或重刮。

正式审计禁止网络，读取现有metadata投影，比较旧字符串及确定别名ID的照片集合；具体词条/城市/照片ID和真实截图仅存data。公开只留汇总、方法及合成图。不调用真实付费provider验证私密库；模拟agent跑通不代表真实模型已遵从选词流程或识别质量验收。
