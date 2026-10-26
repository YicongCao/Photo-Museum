# 策展预算与旅行间隔统计

2026-10-27。代码已上线，原失败记录保留。当前页面中的旧运行不会因修复而自动重发付费请求。

## 问题定位

旅行频率问题在第七轮触发的是**单轮工具调用上限8**，该轮返回9个调用，并非累计预算耗尽。前面的额外开销来自：日本与Japan别名不通；search_photos的order schema未列出枚举，模型先后猜测date_asc/date；缺少全量日期聚合工具，只能反复检索分页照片。提示词还把统计任务推向了不必要的展览创建。

## 变更

- 单轮工具8→16、累计24→64、模型轮次8→16、运行时限240→600秒。常量集中curator_limits.py，系统提示同步生成，运行事件记录剩余调用预算。累计预算在整批执行前检查。参数长度16,000、上下文180,000字符等原边界继续保留；不同上限返回不同错误，取消/重连不自动重试。
- search_photos.order明确为score/time/random/diverse；time是升序。国家匹配补日本/Japan/JP/JPN及中国/China/CN/CHN标准别名，不从活动标题或附近城市猜国家。
- 新增summarize_trips，对与search_photos相同可展示范围的全部匹配记录计算，不受搜索100张分页或多样性排序影响。不读取NAS或新做识别，不输出文件名、精确GPS、人物姓名。
- 相邻有照片日相差超过7天才分组，另返回3/7/14天敏感性。只使用完整拍摄日期；年/月精度、缺失、无效、未来日期单列。分组为疑似行程，照片首末不是实际出入境时间。
- 返回每次首日→下一首日、末日→下一首日两套间隔，均值/中位数/范围与n−1分母；零组/一组平均间隔为空。返回行程列表可分页，汇总仍基于全部匹配记录。
- 统计问题不自动创建展览；前端工具记录显示“统计旅行间隔”。

## 验证

- 22项后端回归通过：curator、curator_search、trip_statistics；覆盖>100张全量统计、日历闰年/日期精度、国家别名、推断过滤、隐私/NAS零请求、字符串filters、旧预算之外的10轮27调用、16单轮与64累计/16轮边界。
- 4项前端时间线单元检查通过，Vite生产构建通过；本轮不改布局，未重复全套视觉验收。
- 用户原始提示词使用当前已保存provider/model（deepseek/deepseek-flash）做一次真实调用，输入**合成索引**：日本216张，其中214张完整日期、2张日期不完整。正确返回3段、相邻首日间隔60/122天、平均91天、另一口径平均89.5天。4次工具调用，8.2秒完成，无展览创建。这个耗时只代表该合成样本，不是与旧真实图库失败运行的性能对照。
- 真实索引通过SQLite只读连接在线备份后禁网核算，日本与Japan结果一致，全量投影与统计约2.97秒。明细、日期及模型原始事件仅留忽略目录data/curator-trip-fix；没有外发真实图库进行验证。
- 构建后先发布散列静态资源、最后替换index；确认无运行中的策展后正常重启8790 supervisor。API及后台进程已启动，受保护策展接口匿名请求仍401。

## 复验

```sh
.venv/bin/python -m pytest tests/p1/test_curator.py tests/p1/test_curator_search.py tests/p1/test_trip_statistics.py -q
node --test web/tests/curator-timeline.test.mjs
npm run build --prefix web -- --outDir ../data/curator-trip-fix/web-dist --emptyOutDir
```

显式付费合成探测（不要自动重复）：

```sh
PYTHONPATH=. .venv/bin/python tools/probe_trip_curator.py --config-data data/server --output data/curator-trip-fix/live-synthetic.json --live
```

照片证据不覆盖没有定位、没有照片或尚未展示的旅行；平均频率也受观察窗口和多年空档影响，不能当作全部真实出行历史。
