# 普通检索与代表性精选复验

用于检索语义、标签纠正及封面策略变化；设计和证据见 `docs/research/search-representative.md`。

- 先跑 `tests/p1/test_search.py tests/p1/test_curator.py tests/p1/test_lexicon.py`；涉及迁移时跑完整 `tests/p1`。旧 schema 夹具须真正移除后增对象，不能修改历史迁移来迁就错误夹具。
- 隔离构建至 data 下，使用 `MUSEUM_FIXTURE_PORT=8798 MUSEUM_WEB_DIST=<绝对构建目录> MUSEUM_VALIDATION_LEXICON=1 PYTHONPATH=. .venv/bin/python tools/p5_validation_server.py`。IAB 用 localhost，正式页用127.0.0.1，避免同名Cookie相互覆盖。fixture会写临时库；真实人工标签/姓名不能拿来做写入测试。
- 合成 fixture 的跑车为第二候选：primary查不到，显式all可命中28张；排除一张降至27，撤销回28。保留域隔离、隐藏/版本隔离、确认来源和过期撤销测试；数量随夹具变更需核对，不能当真实准确率。
- 展开搜索照片流→单图→浏览器Back应回同范围与条件。表单更改未检索时不得把旧结果当新结果。刷新只恢复条件草稿；搜索集合分页重新核验当前数据。
- 设置默认top10；只在fixture保存representative。对同一活动预览两组十图、评分尺度、不同选片计数；正式仅只读预览，不为验证改变用户默认。
- 桌面/390px/320px/844×390检查整页无滚动，矮屏条件在左、结果在右，标签、返回及最近修订可操作。公开截图仅合成，真实截图放data。
- 真实汇总用 `PYTHONPATH=. .venv/bin/python tools/audit_representatives.py data/server/catalog.sqlite`，该脚本只读元数据。近似对数/拍摄日覆盖是启发式多样性证据，不是主观质量评分，也不能用于声称模型准确率提高。
- 发布涉及迁移017，沿用在线备份和supervisor正常停止/恢复流程；复核未登录接口401、真实会话与默认设置、后台worker继续。停止自己的fixture，保留用户验收的正式页面。
