# 创意展厅：数据、持久化与后台验证

2026-10-25。实现见 [creative.py](../../photo_museum/creative.py)，决策见 [ADR 0008](../decisions/0008-creative-gallery-collections.md)。本记录覆盖后台数据边界和合成回归，不代替视觉、真实照片色彩或生产部署验收。

## 四个展厅的数据含义

- **人生年轮**：按已有年份组织活动，月份只有在数据存在时才出现。有效元数据优先，目录年月保留原精度；未知日期单列，不补造月日。活动预览为空时不能借用其他活动的照片。
- **记忆星图**：分开使用摄影 `topic`、摄影 `style`、主体 `subject` 候选。连线仅表示照片属于某标签；不表示人物关系、地理联系或图像相似度。标签使用当前模型版本，摄影分析还必须匹配当前预览更新时间；两个 provider 都核对缓存投影的源 revision 和媒体处理版本。
- **记忆长卷**：每场活动成为章节，默认按已有时间排列。馆主可以调整顺序、展示标题、主图；这些修改不会覆盖目录名或原始 EXIF。
- **故地重游**：至少有两个已知年份的同城记录才产生跨年候选，城市来自有效 GPS 与输入记录匹配的地址结果。候选仍标为“待确认同地点”；缺 GPS 的照片可手动选片。只有馆主明确确认才保存配对。

四展厅共享现有成片投影：必须有本地 thumb/display 双缓存；隐藏、缺失、越界、占位和仅索引项不进入。视频仍从原有活动墙浏览，新创意集合的 `videos` 明确为 0。精选按有效技术评分倒序、稳定 ID 排序，未评分项后置；不是人的喜爱概率，也不改变 Cover Flow 严格 Top10 的规则。

## 接口契约

下述路径以 `/api/exhibitions/creative` 为根，全部需要馆主登录。P6 使用 `/api/curator/exhibitions/{exhibition_id}/exhibitions/creative` 的相同契约，依赖当前可展示照片与已准备展览 ID/revision 的交集。

- `GET /`：返回 `total`、`unknown`、`years`、`chapters`、`groups`、`places`、各类总数和 `limits`。样本位于各组 `selected`；每张照片沿用现有精简投影，包含 ID/revision、本地缓存 URL、尺寸/媒体版本、日期精度、活动、器材等必要字段。
- `GET /photos?kind=...&key=...`：`kind` 为 `year|month|chapter|place|group`；`year` 可额外限定年份；`sort=time|score`，`offset>=0`，`limit` 为 1–200。返回 `{items,total,photos,videos,order}`。`year` 的 `key=unknown` 进入日期完全未知的集合；时间排序为已知日期优先、未知后置，不伪造排序日期。
- `GET /resolve?ids=id1,id2`：最多两个不同 ID，立即刷新底层投影，按请求顺序返回当前集合内的 `{items}`。浏览器必须再核对保存的 revision；失效项不返回。用于恢复未保存配对，不使用会话中的旧图片对象。
- `GET/POST /pairs`、`DELETE /pairs/{id}`：读取、明确确认保存或移除当前范围内的配对。POST 为 `{left_id,right_id,title,confirmed:true}`，返回已保存配对及两张当前照片；DELETE 按现有写接口约定发送 `{}`。
- `GET/PUT /scroll`：返回或提交 `{revision,chapters:[{activity_id,title,hero_id}]}`，响应另带 `heroes:{photo_id:photo}` 以恢复摘要外选中的主图。`title`/`hero_id` 可为 null；章节不可重复，主图必须属于该章节及当前集合。

相册摘要不加载 NAS 原文件，不调用模型或联网解析地址。进入集合仍复用最多 15 张本地 4K 的预热；只在用户进入单图暗房后沿用既有按需原图流程。展厅换页不会重刮照片。

## 容量与准确性边界

概览最多返回 80 个年份、每年 80 场活动、500 个章节、30 个地点和每地点 80 个年份。主题、风格、主体分别最多 30 组，总计最多 90 组，避免主体词表挤掉低频风格或主题。`group_counts` 为 `{topic:{total,visible},style:{total,visible},subject:{total,visible}}`；客户端按当前类型显示截断数量。

每组最多 5 张样本，整份响应重复出现的样本记录总预算为 1,200。优先为同城首尾年份、分组、年份和章节保留代表，再补充更多样本；`sample_records` 和 `sample_records_omitted` 明示采样情况。因此某组 `selected` 可能少于 5 张或为空，不能解释为该组没有照片。年轮缺样本时使用该活动和年份的定向集合读取。概览未返回的组不在当前列表中，完整总数仍保留。

`count`/`total` 统计完整当前集合，集合分页不会套用概览的预览配额。上述预算约束响应和界面样本，不代表后台不读取本地目录投影，也不是无限图库的性能承诺。

### 当前延迟边界

本次对约 1.65 万张可展照片的正式本地索引做只读检查：首次构建目录投影与创意概览合计约 **6–8 秒**，复用已构建目录投影后，创意概览仍约 **1.85 秒**。带 cProfile 的分段观测为目录投影 4.09 秒、创意概览 2.16 秒，其中标签分组约占 1.86 秒。首次合计只执行 7 条 SQL，没有逐照片查询的 N+1 问题。测量使用 SQLite `mode=ro` 与 `query_only`，未读取原图或触发 NAS 请求；数字受机器负载与后台刮削进展影响。

因此切换新展厅目前可能等待数秒，不承诺即时加载。主要成本是目录字段解析与已有标签的全量分组；故地重游恢复配对时强制刷新投影，也可能与概览请求重复构建。后续可评估精确快照缓存，以及仅对两个待恢复 ID 做当前可见性/版本校验。缓存键必须包含相应数据变更依据，局部校验必须继续拒绝隐藏、失效、源版本不匹配及 P6 集合外照片，不能为加速撤掉本轮校验。本轮只记录测量与优化方向，没有变更这些数据读取策略。

## 本地保存与恢复

[迁移 009](../../photo_museum/migrations/009_creative.sql) 新增 `creative_pairs` 和 `creative_layouts`。`scope` 分为 `library` 与 `curated:{exhibition_id}`，互不覆盖。

配对记录保存双方 ID/revision、标题和时间，每个 scope 最多 1,000 组，标题最多 120 字符。写入前重新检查集合，事务内再次检查源 revision、缺失、越界和隐藏状态。GET 不展示已失效配对，历史记录不据此自动删除。未保存草稿在 sessionStorage 只保存照片 ID/revision、标题和对照控件状态；每次恢复/刷新重新解析，失败或不匹配时不继续显示旧图。

长卷每个 scope 最多保存 500 个章节覆盖项，标题最多 120 字符。PUT 使用 revision 乐观并发，另一窗口抢先保存会返回 409；主图不能引用集合外照片。GET 过滤不可用章节，失效主图返回 null，由当前章节默认代表图接替。章节改名仅改变展示标题。

P6 新增 `rings`、`constellation`、`scroll`、`revisit`，连同既有方式共十种 Show。提示词说明上述事实边界和缺失数据；agent 仍只能调用本地检索及展览草案 tools，没有确认配对、保存人工长卷或扩大集合的工具。

## 实际验证

本轮执行 `.venv/bin/python -m pytest -q`：**125 项通过，76.61 秒**。随后补严“缺少媒体版本不能匹配当前分析”的保护，并执行 `.venv/bin/python -m pytest -q tests/p1/test_creative.py`：**12 项通过，10.52 秒**。`git diff --check` 通过。命令均在仓库根目录执行。

[创意展厅测试](../../tests/p1/test_creative.py) 覆盖日期精度/未知日期、真实集合总数、全局样本预算、标签当前版本与输入匹配、缓存旧 revision/旧媒体版本不混入新分析、每类独立配额、同城候选、配对确认与持久化、长卷并发/主图归属、隐藏后立即恢复检查、P6 集合隔离、鉴权/同源限制和零新增 NAS 调用。配额回归构造 105 组标签，确认每类保留 30 组，且摘要之外已知组的分页成员数量仍完整。

以上是合成索引/协议测试，没有调用真实 provider、访问真实 NAS 或测量识别准确率。`MUSEUM_VALIDATION_CREATIVE=1` 仅用于隔离 P5 验证服务，通过 [creative_fixture.py](../../tools/creative_fixture.py) 注入明确标记的合成 style/topic 候选；不得用于正式数据目录。浏览器与视觉证据由各界面验收记录单独给出。
