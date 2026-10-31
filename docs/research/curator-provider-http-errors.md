# 策展模型服务错误可见性

2026-10-31。

## 原因与边界

一次按地点和主体找图的正式请求，在首轮模型调用即返回 `Provider返回HTTP 402`。记录只有 queued、thinking 和 failed 三条事件，没有工具调用、模型输出或展览。因此本次失败发生在检索之前，不能归因于地点的中文/英文匹配，也不能据此宣称检索质量已经通过。

当前模型通过腾讯 TokenHub 接入。腾讯官方[语言模型调用概览](https://cloud.tencent.cn/document/product/1823/130079)说明：402 类错误表示模型服务未开通或额度不足，模型需要在控制台开通后才能调用。后台没有保存上游响应正文或更细的平台业务码，因此本次不能区分具体账户原因；没有虚构业务码、读取账户余额或重发请求。

前端 `status-text.js` 对错误使用文案白名单，而现有 HTTP 状态收据不在白名单，落成“操作未完成”。错误码其实已经落库，只是界面没有呈现。

## 修改

- 只解析严格的 `Provider返回HTTP NNN` 状态收据，以受控标题展示数值和对应处理建议。未知正文、HTML、私密路径和任意拼接消息继续安全回退。
- 兼容旧版 401/403/429 固定文字；上游 401 不当作馆主会话失效，上游 429 不和本地请求限流混淆。
- 复用共享 StatusNotice，增加可选操作槽；策展错误的“模型设置”进入 LLM Provider，返回时保留原失败历史。
- 只读刷新、历史回放、打开设置不提交模型请求。原失败记录不改写，未宣称账户问题已恢复。

## 验证与发布

- `node --test web/tests/status-text.test.mjs web/tests/curator-timeline.test.mjs`：9 项通过，包括状态码、受控解释、旧记录、鉴权区分和敏感正文隔离。
- `uv run --all-extras pytest -q tests/p1/test_curator_http_failures.py tests/p1/test_curator.py`：10 项通过。用本地 MockTransport 复现 402/500，确认只调用一次、无检索/原图读取、读取历史不重试且不保存上游私密正文。
- 隔离小型空库 fixture 验证 402、502、旧 429、未知异常、设置进入及返回；模型调用计数 0。320×720、844×390、1280×720 无整页溢出，操作触点至少 44px。
- 合成界面证据：[HTTP 402](../design/previews/curator-provider-failure/402.png)。真实记录、截图及诊断收据仅放忽略的 `data/curator-yunnan-diagnosis/`。
- 修改前隔离构建与正式入口均为 `main-BUwfbpAd.js`，确认包含当前已有工作。静态更新为 `main-Bb-ge4KU.js`，保留旧 hash 资源并原子切换入口；API/worker 未重启。
- 正式页面回放同一失败记录，确认 HTTP 402 和处理建议可见，原要求保留。没有变更 Provider、试费、NAS 内容或原图缓存。

后续需要馆主在 TokenHub 控制台确认对应模型已开通且有可用额度，再手动提交新的策展请求。没有读取控制台、充值或擅自切换模型。
