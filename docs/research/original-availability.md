# 原图暂不可用：运行恢复与错误反馈

2026-10-27。

## 本次故障与恢复

- 真实HEIC的本地4K可正常查看；兼容原图接口返回502“NAS 原图读取失败”，同一API进程的文件源浏览也返回 `network_unavailable`。
- 使用已保存的文件源配置，在新进程中对同一文件只读校验：NAS文件存在，revision与索引一致，2.21MiB下载成功；完整兼容原图转换约1.91秒，生成3,817,952字节JPEG并正常清理临时工作目录。线程内目录读取也成功。由此排除该样本丢失、凭据错误、缓存破损或HEIC无法转换。
- 旧API进程只有33条lsof记录，未发现文件描述符耗尽证据。故障集中在旧服务进程的NAS网络访问；现有安全日志不足以确认更底层的系统原因，不能据此声称是连接池、DNS缓存或macOS权限故障。
- 确认无运行中的付费策展或媒体任务后，正常停止旧supervisor及其子进程，沿用原数据目录、模型、密码会话和队列启动新supervisor。源目录浏览随即恢复；同一HEIC在原页面重试成功显示“原图 · SDR 兼容显示”，普通JPEG也成功显示“原图”。没有重刮、删除缓存或修改NAS内容。

## 错误反馈修正

原Viewer对所有非2xx统一抛出“原图暂不可用”，隐藏了原始类别。现在用 `originalFailure` / `originalErrorText` 接入共享 `failureInfo` 白名单：

- NAS连接、NAS原图读取失败、转换繁忙、格式待适配、源版本变化、读取上限、鉴权过期、浏览器解码失败分别显示。
- 未知异常、HTML、对象型detail及含私密路径的响应只显示受控回退文案，不把服务器原始错误或响应直接展示。
- 失败冻结进度并保留已绘制4K；每种失败都有同一手动重试入口，重试成功清除错误并正常显影。取消继续静默，未新增自动重试或原图缓存。

## 本轮验证

- `node --test web/tests/original-transfer.test.mjs web/tests/status-text.test.mjs`：8项通过，覆盖字节计数、取消、7类HTTP结果、解码错误及不可信响应脱敏。
- `pytest tests/p1/test_view_original.py tests/p1/test_preview_http_cache.py -q`：6项通过，原图临时清理、进度隔离、鉴权与预览缓存边界继续有效。
- Vite production build：236模块成功，锁文件和依赖不变。
- 隔离P5合成fixture，只替换原图endpoint的处理函数并保留依赖鉴权：502网络失败→503繁忙→415待适配→恢复200。CUA逐次点击重试，文案准确、4K始终可见；恢复后原图层解码成功且重试按钮消失。合成截图见[连接失败](../design/previews/original-availability/nas-unavailable.png)与[重试恢复](../design/previews/original-availability/recovered.png)。
- 正式HEIC、JPEG均成功；`view-work`中的original临时目录为0，常驻cache_files仅thumb/display。媒体队列状态计数在恢复前后保持一致。真实照片截图与诊断只存被忽略的data/original-availability。

## 后续诊断

先比较本地4K是否正常、原图HTTP状态/受控错误、文件源浏览是否成功；不要因原图失败就清空预览缓存。若旧服务与新进程的同一只读请求结果不同，先检查进程、网络、描述符和安全日志；不凭泛化文案断言媒体损坏。重启前检查是否有付费策展或有效任务，保留队列/暂停状态；旧进程尚未退出时不要在同端口启动第二套服务。恢复必须用原失败文件实测，并检查临时目录清理。不能把一次重启恢复称为底层系统原因已根治。
