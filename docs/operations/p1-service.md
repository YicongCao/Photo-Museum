# P1 本机运行与验收

P1 正式数据入口：<http://127.0.0.1:8790>。它提供密码登录、NAS 只读 WebDAV 连接、目录与文件索引、持久任务以及鉴权原文件读取。P0.5 的 <http://127.0.0.1:8787> 仍保留为独立观展原型；P2 把正式目录与4K缓存接入Gallery时光隧道；整页canvas限制已由ADR 0003取消。

## 启动

仓库根执行（Python 3.11+、Node、uv）：

```bash
uv sync --locked
npm ci --prefix web
npm run build --prefix web
uv run python -m photo_museum
```

最后一条同时启动 API 与独立 worker；Ctrl-C 结束两者。没有安装开机常驻服务。机器休眠或关机期间不会继续扫描；重新运行后，未完成任务会接续。一次只启动一套该端口服务。

需要分开管理进程时：

```bash
uv run uvicorn photo_museum.api:create_app --factory --host 127.0.0.1 --port 8790 --no-access-log
uv run python -m photo_museum.worker --data data/server
```

默认只监听回环地址。Linux/Docker 的部署、反向代理 HTTPS 和远程初始设置在 P3 验证；不要把此阶段入口直接暴露公网。自定义本机端口或目录：`uv run python -m photo_museum --port 8792 --data data/another-museum`。

## 第一次进入

1. 在网页设置至少 12 字符的馆主密码。不需要用户名，密码与 NAS 密码可以不同。
2. 填写 WebDAV 源站地址、照片根目录、NAS 用户名和密码。源站地址不含路径，根目录单独填写。
3. 默认 HTTPS 验证证书，可提供 PEM CA。证书过期、名称不符仍会拒绝；CA 不是跳过证书检查的开关。仅在明确接受的可信内网连接中勾选 HTTP。
4. 保存后“测试连接 / 选择活动”，选择一个活动再开始刮削。根目录选项会扫描全部活动，读取目录属性而不会下载全库原图。

本次用户已经设置密码，已授权 Farmer 的 5005 HTTP 用于内网验证。无需重新设置密码。设置、库和凭据都在本机 `data/server/`，不提交 Git。密码用 Argon2id；NAS 密码用本地密钥加密。目录权限 0700、密钥 0600；这不能防护已经能同时读取数据库与密钥的本机账户。

## 验收操作

- “锁馆”后，只输入馆主密码即可回来；未登录不能读列表、任务、manifest 或原文件。
- 测试已保存的照片源，选择活动。观察 worker 在线、已完成目录数、本次成片/视频数。总目录数是已经发现的数量，扫描中可能增加。
- 扫描较大活动或根目录时点击“暂停”；刷新网页，任务仍暂停。点击“恢复”，从未完成目录接续。已经完成的小活动可能来不及按暂停，可用合成验收环境稳定验证。
- 暂停先阻止提交与后续领取，正在进行的网络请求结束后释放当前目录。单次目录响应受 16 MiB、100,000 项、60 秒接收期限和 20 秒读取超时限制；暂停不是立即切断 TCP。
- 断线重试采用 2/4/8 秒间隔，第四次失败转“需要处理”；认证/权限错误立即停在该状态。更新 NAS 密码后“恢复”。关闭网页不会中断独立 worker。
- 再次扫描同一活动可发现新增、变更与完整成功枚举后确认的缺失，资产 ID 稳定。取消只结束任务，保留已完成索引，不删除 NAS。
- “查看原文件”通过登录会话和内部资产 ID 读取 NAS，可验证浏览器支持的 JPEG。HEIC 或不支持的格式可能下载；这里不是正式 WebGL 观展，也不宣称色彩/HDR转换完成。

## 数据与恢复

SQLite 使用 WAL、本地盘、迁移版本 2。迁移 SQL 位于 `photo_museum/migrations/`，不同进程以本机锁串行迁移；新于程序的 schema 会拒绝启动。数据库不能放 NAS/WebDAV 挂载盘。

目录任务使用 30 秒租约、每 5 秒续约以及独立提交令牌。意外终止 worker 后，过期租约会重新领取；短事务提交前再次校验令牌与任务状态。任务恢复不等于字节续传。

原文件代理单次最多 256 MiB、120 秒接收期限，支持单段 Range。额外的按需下载组件默认总 spool 512 MiB、单文件 256 MiB、同时一个写入者；这是 P2 派生任务可复用的有界接口，P1 扫描不会自动生成缓存。只有强 ETag 下发送 Range/If-Range 并收到匹配的 206 才续传；200 重写临时文件，416 安全重下。弱/缺 ETag 只做大小/时间辅助版本判断，无法发现大小与时间同时不变的修改，不能承诺内容级增量正确性。

原始观察、推断、人工修订分层存储，覆盖前留历史；effective 当前按需计算。人工清空为最高优先级；推断默认候选不进入 effective。提取状态、供体原始记录 ID、版本、精度与不确定范围已有结构。真实 EXIF 提取、序列分组与近邻推断、effective 检索列、派生转码执行器均留在 P2。

备份时先停止这套服务，再完整复制 `data/server/`（含数据库和 `secrets.key`）到安全位置；不要只复制密钥或只复制正在写入的 SQLite 主文件。P3 再实现并验证自动备份/恢复。P1 没有浏览器密码重置入口；保管馆主密码，不要通过删除数据库来“重置”已有馆藏。

## 回归

```bash
uv run --extra media python -m pytest tests -q
npm test --prefix prototype
npm run build --prefix web
PYTHONPATH=. uv run python tools/p1_validation_server.py
# 另一个终端；每轮先重启 fixture
node web/tests/browser.mjs
```

`web/tests/browser.mjs` 复用已锁定的 `prototype` Playwright 依赖（先 `npm ci --prefix prototype`）。默认 Chrome 路径只适用于此 Mac，其他机器使用 `MUSEUM_CHROME` 指定。fixture 仅本机 8791，使用临时合成数据库，不读真实 NAS 配置。
