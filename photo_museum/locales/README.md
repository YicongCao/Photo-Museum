# 离线中文显示词表

这些文件只含公共类别名及公共地名，不含照片、GPS 或人物资料；运行时无需联网。

- `geonames-zh.json`：GeoNames 的 CN 地点及省级记录，按 geonameId 取中文名称；CC BY 4.0，署名 GeoNames，https://www.geonames.org/ 。输入格式和许可：https://download.geonames.org/export/dump/readme.txt 。优先明确中文语言别名；未标语言的汉字别名仅在去行政后缀后无冲突时使用。保留来源标识。
- `imagenet-zh.json`：OFA-Sys/Chinese-CLIP 的 ImageNet-1K 中英文词表，固定提交及原文件SHA-256见 `sources.json`；许可全文在 `Chinese-CLIP-LICENSE.txt`。仓库：https://github.com/OFA-Sys/Chinese-CLIP 。仅复用1000类别名，不安装或运行其模型。
- 英文规范描述和WordNet synset ID取自当前锁定的 `timm.data.ImageNetInfo`（timm Apache 2.0，许可见 `timm-LICENSE.txt`；https://github.com/huggingface/pytorch-image-models）。新模型结果同时保存类别序号与synset；旧结果只有唯一匹配才翻译，避免crane等同形不同义类别混淆。

显示翻译不改写原始元数据或模型概率，不代表地理精度或识别准确率提高。没有可靠中文名时保留原文。词表再生使用 `tools/build_chinese_catalog.py`；输入公共快照、固定URL及输出校验值记录于 `sources.json`。请保留本目录的署名、许可与来源文件。
