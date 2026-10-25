# 本地摄影风格与主题识别

2026-10-25。第一版是可拒绝判断的模型候选，不是对摄影作品的确定鉴定。

## 两种标签

- `style`：14种视觉风格，包括黑白、柔和低饱和、鲜明高饱和、胶片质感、低调暗色、高调明亮、逆光剪影、霓虹光影、极简留白、几何对称、浅景深虚化、长曝光拖影、动态抓拍、纪实抓拍。
- `topic`：19种画面主题，包括人物肖像、多人合影、自然风光、海岸水景、山野户外、城市街景、建筑空间、室内空间、美食饮品、动物、植物花卉、交通汽车、体育运动、舞台演出、节庆活动、静物器物、星空天文、微距细节、抽象纹理。

每类最多3个标签。风格中的互斥分组只选一个，例如不同时输出黑白与鲜明高饱和。摄影主题描述画面；目录解析的活动主题继续保留，不拿摄影主题覆盖目录名，也不把ImageNet物体名称直接复制过来。不推断人物身份、关系或人口学属性。“胶片质感”只描述观感，不证明真实拍摄介质。

## 模型与本地边界

使用[OpenAI CLIP ViT-B/32](https://github.com/openai/CLIP)，通过[OpenCLIP](https://github.com/mlfoundations/open_clip)运行。两者代码许可及本次官方模型发布采用MIT，见[CLIP许可](https://github.com/openai/CLIP/blob/main/LICENSE)、[OpenCLIP许可](https://github.com/mlfoundations/open_clip/blob/main/LICENSE)。权重URL及SHA-256来自[官方模型清单](https://github.com/openai/CLIP/blob/main/clip/clip.py)，单独锁在 `photography-model-manifest.json`，不改变原有主体/人脸模型清单。

独立准备工具下载约338 MiB的公开模型，先核验SHA-256，再从可信归档提取纯张量保存safetensors，删除原归档。运行时只校验、加载本地张量和包内分词资源，不下载、不上传，也不需要OpenAI API或agent。推理固定CPU、2线程，图像输入只取本地640px缩略图；缩略图缺失时可用本地4K。两者都缺失则记录 `preview_cache_missing`，不替媒体队列安排NAS下载。

CLIP比较图像与自定义英文提示词，界面用独立中文标签。多个提示词的归一化向量平均后再归一化，计算余弦相似度。相似度不是正确率，不用百分比伪装置信度。首版启发式门槛：style最低0.225、领先普通照片/非照片基线0.01；topic最低0.22、领先未知/非照片基线0.012。不满足则“未确定”，截图、文档和插画可拒绝归类。阈值、提示词、词表、权重、运行库参与版本签名。

这是zero-shot试验，不是专门训练的摄影风格模型。通用CLIP对风格、否定文本、构图与细微后期差异存在局限，标准中心裁切也可能丢失边缘构图。门槛未经人工标注集校准；“未确定”不意味着没有风格。参考[官方模型卡的使用限制](https://github.com/openai/CLIP/blob/main/model-card.md)。

## 队列、索引和界面

`PhotographyWorker` 是单独进程，`analysis.provider=photography`独立保存版本、style/topic、相似度、领先基线、源revision、媒体版本和预览更新时间。无NAS客户端，既有成片从本地缓存补分析；只重算这个provider，不重跑主体、人脸、评分，不覆盖人工数据。新预览替换期间的过期推理不能发布，API不暴露过期候选。

启用后保持逐目录倒序：当前目录媒体、视觉分析和摄影分析结束才进入下一目录。暂停/恢复沿用媒体总开关；未知结果算已检查，失败保留“需处理”，显式重试可重新执行。独立视频、超大占位不进入摄影模型；Live视频中帧也不冒充照片风格，子项标记不适用。

单图进度新增风格、主题两个SVG子项，完成事件等待这两个子项；完整处理数采用包含摄影模型版本的新pipeline，因此旧照片会显示需要补分析。旧完成历史不删除，目录枚举和媒体版本不变。Dashboard右侧及单图档案各显示两行候选；hover可查看相似度与领先基线。Gallery评分Top10策略不受这些候选影响。

## 跑通的验证

- 后端验证：多标签与未知回退、互斥风格、暂停恢复、错误重试、按目录等待、版本升级、预览竞争、过期结果隔离、人工标记保护、已有视觉结果不变、零额外NAS GET，及缺失缓存不会触发下载。
- 浏览器验证：60张合成图及明确注入的测试标签，核对Dashboard、两项进度图标、档案候选、原图请求边界、桌面/390×720无整页滚动及无未捕获错误。合成UI截图不证明模型识别能力。
- 本机真实缓存24张，禁止socket连接后加载模型并推理成功，网络尝试为0。其中21张有主题候选，2张有风格候选，其余保留未确定。覆盖的是这批样本的输出情况，不是准确率；尚无独立人工标注集验收。样本与结果只在忽略的 `data/photography-validation`。
- Linux/Docker的实际模型推理尚未单独实测；基础Docker镜像仍只安装媒体依赖，未启用此可选智能模型。

最终全量93项后端测试、7项浏览器检查与前端构建通过。正式上线复查已有421条摄影分析结果及对应新pipeline完成事件，后台持续补分析；早一份258条快照无分析错误，原视觉模型版本、人工人脸数量和策展标记数量与启动前一致。入队/已有结果数量不当作全库完成数量。

公开截图仅为合成UI：[Dashboard](../design/previews/photography/dashboard.png)、[单图档案](../design/previews/photography/archive.png)。浏览器检查清单在photography-browser-evidence.json，真实样本与运行收据不提交Git。

## 准备与复验

```bash
uv sync --locked --all-extras
uv run --all-extras python tools/prepare_photography.py
uv run --all-extras pytest -q tests/p1/test_photography.py
npm run build --prefix web
MUSEUM_VALIDATION_PHOTOGRAPHY=1 PYTHONPATH=. uv run --all-extras python tools/p2_validation_server.py
# 等待Synthetic exhibition ready后，在另一终端运行：
node web/tests/photography.mjs
```

正式启动继续使用 `uv run --all-extras python -m photo_museum`。supervisor只有在本地权重和open_clip均存在时启用摄影进程；无权重时旧媒体流程照常可用。每个数据目录运行一个摄影worker。Gallery查看单图档案可验收；不要用合成fixture覆盖正式浏览器同主机名的会话。
