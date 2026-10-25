# 地址与主体标签中文显示

2026-10-25。管理页解析数据、Gallery单图档案共享同一组离线中文显示规则。原始英文名称、模型分数/置信度、GPS及定位精度保持原样；API额外返回`display_zh`或`label_zh`供界面显示，不回写原始分析记录。旧记录立即受益，不触发NAS下载、全库重刮或识别重跑。

## 方法与边界

- 中国地址优先按GeoNames地点ID匹配中文名称；country_code为CN/CHN，或country为China时，显示“中国”。省份按行政区代码/地点ID匹配，城市优先地点ID、其次省内唯一名称。中文已有值保持原样。
- 使用[GeoNames中文别名格式](https://download.geonames.org/export/dump/readme.txt)及[中国别名公开快照](https://download.geonames.org/export/dump/alternatenames/CN.zip)，CC BY 4.0。明确中文语言别名优先；无语言标记的纯汉字别名仅在去行政后缀后无冲突时使用，并记录来源。不存在可靠译名或同名歧义时保留原文，不从拼音反猜。
- “Xinjiang / Xinyuan”的ID对应“新疆 / 新源”，可展示为“中国 · 新疆 · 新源”。当前GeoNames provider仅提供最近城市，城市不一定是行政辖区判定；显示仍保留近似城市/距离，不伪造区县或街道。以后已有street_zh或可核对的地点ID时可以显示对应汉字；未知街道保留原文，缺失街道不生成。
- 主体采用[Chinese-CLIP的ImageNet-1K中文类别表](https://github.com/OFA-Sys/Chinese-CLIP/tree/master/datasets/ImageNet-1K)，MIT许可。只复用词表，继续运行现有本地MobileNet模型。新结果保存class_index、WordNet synset和taxonomy；旧结果仅在完整英文描述/别名唯一匹配时翻译。
- 例如golf ball→高尔夫球、lakeside/lakeshore→湖边、rapeseed→油菜。crane可指鹤或起重机：有synset时分别显示，无ID且有歧义时保持英文。中文译名不提高识别置信度；公开译表仍可能有个别不准确用词，不声称1000项均经人工校对。
- 运行时零网络请求，1000类主体词表＋31省级/1566城市中文名称随代码分发，约340KiB。未知新provider继续回退原文；Linux/Docker无需额外翻译模型或OpenAI API。来源、固定提交、输入/输出SHA-256及许可保存在`photo_museum/locales/`。

## 验证

- 后端全套 **79 passed**。新增测试覆盖中国/国外、原中文与未知街道、上下文/ID匹配、歧义标签、置信度/原字段不变、两类API一致、零NAS调用，以及GPS修订后不再返回旧地址。
- `npm run build --prefix web` 通过。`node web/tests/chinese-labels.mjs` **6项通过、0未捕获浏览器错误**，覆盖Dashboard和单图档案、中文与置信度、保留原始字段、管理页零NAS原图请求。见[机器证据](chinese-labels-browser-evidence.json)。
- 实际本地MobileNet在合成几何样本上运行一次，5个候选均带类别ID/synset并成功定位中文标签；未向模型发送真实照片用于此次验收。
- GeoNames离线provider在公开测试坐标43.4,83.2返回Xinyuan/CN.13，显示转换得到“中国 · 新疆 · 新源”；这只是已知地点验证，不代表街道或全库GPS准确率。
- 管理页当前文件使用明确的合成活动/阶段数据；公开截图只包含生成几何图，不含私密照片/EXIF。正式服务已更新并继续原任务。

[管理页截图](../design/previews/chinese-labels/dashboard.png) · [单图档案截图](../design/previews/chinese-labels/photo-archive.png)。

## 当前库快照与覆盖

统计时间：2026-10-25T09:04:56.836897+08:00（只读聚合，非全库处理进度）。现有中国地址5092条，已有省份名5078条均可转中文；城市3969/5092条可转中文，其余保留原文。主体标签56189/56485条可显示中文，未覆盖者包含缺少类别ID的同名歧义。后台持续更新，数量会变化。

## 复用

1. 日常运行只需要随代码提交的locales文件，不下载词表。
2. 再生时准备`data/localization-sources/`中的四个公开源文件与manifest（URL、SHA-256见locales/sources.json），以及既有`data/models/geonames/`快照。GeoNames是每日文件，更新快照时须重新校验，不能把新文件冒充原快照。
3. 运行`.venv/bin/python tools/build_chinese_catalog.py`，再运行`pytest -q tests/p1/test_localization.py`并构建前端。再生只读公共数据，不读照片库。
4. 浏览器复验先启动`MUSEUM_VALIDATION_CHINESE=1 PYTHONPATH=. uv run --all-extras python tools/p2_validation_server.py`，ready后运行`node web/tests/chinese-labels.mjs`。使用独立context或localhost，避免覆盖正式页登录Cookie。
