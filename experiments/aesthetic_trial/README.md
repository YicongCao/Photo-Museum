# 独立神经美学试验

用户确认之前不接入正式评分、worker 或 Gallery。此目录仅提供试验工具；真实照片、结果、特征及偏好全部留在被 Git 忽略的 `data/aesthetic-trial-2026-10-26/`。

## 复现

在仓库根目录运行，沿用 `uv.lock` 的智能分析依赖及已校验的 `data/models/photography/clip.safetensors`：

```sh
uv run --all-extras python experiments/aesthetic_trial/prepare.py
uv run --all-extras python experiments/aesthetic_trial/run.py
uv run --all-extras python experiments/aesthetic_trial/render.py
node experiments/aesthetic_trial/verify.mjs
```

只有 prepare 显式下载公开权重。run 在模型加载前禁止 Python socket 连接，仅以 SQLite `mode=ro` 读取索引，使用已存在的本地 display/thumb；不读取 NAS、不改生产索引或缓存。prepare 对固定提交的权重及许可核验 SHA-256，以 `weights_only=True` 加载有限张量，转换成 safetensors。正式依赖、模型配置和评分版本不变。

`review.html` 是完整离线文件，直接用本机浏览器打开，无需启动服务器。包含私密照片，不能上传、提交或作为公共页面发布。内置浏览器若禁止 `file:` URL，请由用户手动在本地浏览器打开；不通过公开 HTTP 绕过限制。

## 用户复核

- Top10 对照：每活动抽取 32 张，包含原技术评分前十；神经前十仅指本轮样本，不代表完整活动。
- A/B：32 对同活动照片，混合模型分歧与随机样本。默认隐藏分数，可选 A、B、差不多或跳过。
- 点击照片放大；分数不是喜欢概率，技术分与神经原始预测值不能直接比数值。
- 选择保存在当前浏览器，建议完成后点击“导出偏好 JSON”。文件地址下的 localStorage 行为依浏览器而异，导出文件才是可交付记录。
- 没有用户反馈就没有个人模型；本试验不自动训练或上线。自动测试导出的 `qa/automated-test-votes-not-owner.json` **不是用户偏好，不得用于训练**。

## 输出

私密结果：`result.json`、`summary.json`、`private-embeddings.npz`、`review.html`；验证：`qa/evidence.json`、截图及 `qa.log`。`render.py` 仅重绘已存结果，修改界面无需重复推理。verify 使用独立临时 Chrome context，不修改馆主的浏览器选择。

方法、实测边界和许可见 [研究报告](../../docs/research/aesthetic-neural-trial-2026-10-26.md)。
