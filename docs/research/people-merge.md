# 人物分组合并与同名提示

2026-10-26。Settings → 面孔与姓名新增显式身份合并，不以姓名相同自动推断为同一人。

## 操作

- 点击「多选合并」，跨页勾选重复分组，选择保留的人物，再确认头像、姓名及分组数量。一次最多选200组。保留目标人物ID与姓名，其他分组的面孔改归目标。照片数按不同照片计数，不将同一照片的两个框算两张。
- 输入已有姓名后，300ms防抖查询全局有效人物；展示头像、照片数及ID片段，支持「归入此人」或「仍保存同名，保持独立」。保存时再次查证，查询失败不保存，保留草稿。同名提示不自动执行合并。
- 「最近合并记录」列出最近10次操作，刷新后仍可撤销。撤销只恢复该次面孔归属和原人工标记，不撤回后续姓名编辑，也不把之后新识别的照片随意分配回来源组。

## 数据与保护

新增SQLite迁移012及本地`people_merges`记录。合并/撤销均使用短`BEGIN IMMEDIATE`事务，验证所有组仍在当前有效范围内后执行。无效来源导致整笔回滚。合并同时保护目标及来源的有效面孔，模型升级不能拆散人工合并。

来源人物记录及其原姓名保留，空组不出现在有效人物列表。历史/隐藏记录保留身份归属关联，但不将失效模型的自动结果升级为人工有效结果；隐藏、越界、missing和旧revision继续不展示。照片的embedding、框、revision、源文件与缓存不修改；不下载NAS原图，不重新识别，不访问LLM。

撤销记录只存面孔ID、原归属、revision及人工标记等必要恢复字段，不复制照片、特征向量或路径。若涉及人物后来被重新命名/确认姓名，或面孔被改组、再次合并或已消失，则拒绝旧撤销，保留后续修订。重复撤销同一成功记录无副作用。记录留服务端私密数据库，不外发。

本轮不改变自动聚类算法，人物分裂仍可能发生；新增功能用于馆主确认后的批量纠正。

## 复验

专项：`uv run --all-extras pytest -q tests/p1/test_people_merge.py tests/p1/test_people_settings.py tests/p1/test_curation.py`。

隔离构建与合成图库：

```bash
npm run build --prefix web -- --outDir ../data/people-merge/web-dist
MUSEUM_VALIDATION_PEOPLE=1 MUSEUM_FIXTURE_PORT=8793 \
MUSEUM_WEB_DIST="$PWD/data/people-merge/web-dist" PYTHONPATH=. \
uv run --all-extras python tools/p5_validation_server.py
node web/tests/people-merge.mjs
```

脚本会改变合成姓名、合并与撤销；重新运行需重启临时fixture，恢复55组初态。不能对真实人物执行这些测试。浏览器证据留`data/people-merge/browser`，公开截图仅合成图。正式库上线前使用SQLite在线备份，备份和真实截图仅留忽略目录；只检查新入口，不替馆主合并真实身份。

## 本轮结果

- 后端全量164项通过（`data/people-merge/full-backend.log`）；人物合并/命名/人工修订12项均包含在本轮全量通过中。
- 新浏览器7组通过：输入同名即提示、跨页现有人物、同名独立、显式归入/撤销、跨页多选、失败保留/明确重试、刷新后撤销及320/390/矮屏。
- 原面孔管理8组回归通过，状态文案单测通过；浏览器均无未捕获错误、无NAS原图请求。
- 截图自审后压缩多选工具栏，确认框自动滚入设置内容区；分页更新时暂停旧卡片选择，避免操作旧页。
- 迁移012在隔离全量测试通过后部署，正式人物未被测试合并或命名。

公开合成截图：[同名提示](../design/previews/people-merge/same-name.png) · [批量确认](../design/previews/people-merge/bulk-confirm.png) · [320px布局](../design/previews/people-merge/layout-320.png)。正式页多选入口已打开，未勾选或提交真实人物；上线后schema12、原6900条面孔/2816条历史人物记录保持，合并记录为0。独立worker已恢复。真实截图`data/people-merge/formal.png`不提交Git。
