# SQLite 锁竞争与后台进程恢复

2026-10-26。修复反复导致8790服务退出的后台锁异常；不包含五张图片的解码兼容改造。

## 已确认问题

旧正式日志的退出点是扫描worker的`BEGIN IMMEDIATE`抛出`sqlite3.OperationalError: database is locked`，没有被主循环处理。旧supervisor发现任意子进程退出就关闭其他全部子进程，因此扫描器的暂时失败变成整个网页不可访问。

SQLite即使使用WAL也只有一个写者，仍需处理BUSY；参见[SQLite WAL](https://www.sqlite.org/wal.html)与[隔离说明](https://www.sqlite.org/isolation.html)。Python连接的timeout是等待锁的上限，不是任务恢复机制，参见[Python sqlite3文档源码](https://github.com/python/cpython/blob/main/Doc/library/sqlite3.rst)。本次没有简单增加默认10秒超时。

另一个已确认的放大因素：媒体claim在获得写锁之后计算整个目录队列；分析worker先反复写版本设置、再在同一事务中检索候选；摄影队列也可能在保存目录焦点后继续重查询。真实库只读复测一次“还有哪个目录未完成”耗时约1.11秒。历史日志没有记录当时持锁者，所以不能据此断言每一次退出都由某一个具体worker造成。

## 实现

- `work_queue.choose_directory`先在只读快照中计算目录，再用短写事务比较并更新焦点。焦点没变不重复写；竞争时重新取快照，避免覆盖另一个lane的新焦点。媒体claim不再持写锁执行全库目录投影，分析/摄影候选检索也在独立读取连接中执行。目录顺序与等待分析规则保持。
- 分析版本只在变化时写入，写入事务先结束，再找候选。WAL在Database初始化期间设置；日常连接不重复设置journal_mode，连接配置失败也确保关闭资源。默认busy timeout仍为10秒。
- 四类worker共享`worker_runtime.run_loop`，只识别SQLite BUSY/LOCKED及其扩展码，按0.25秒起、上限约5秒并带抖动退避；后续tick重新领取/读取持久状态。事务体不被Database自动重放。永久数据库错误继续暴露，不被当成临时锁无条件吞掉。`--once`遇锁返回失败而非谎报成功。
- 单文件分析/转码与目录提交遇BUSY时不保存成`media_OperationalError`、识别失败或阻塞目录，不消耗源下载错误重试次数。未提交的扫描租约仍可到期重领；已有token/版本约束继续隔离迟到写入。心跳遇暂时锁可下一轮续约，媒体结束时先清理心跳线程和DAV连接，再处理持久状态。
- 新supervisor保留HTTP进程；worker意外退出只重启该worker，连续失败1、2、4…最多30秒退避，稳定运行60秒后重置。正常停止不重启。HTTP listener本身退出仍视为整个服务失败并清理其他子进程，避免错误端口或API启动失败时留下孤立worker。

## 验证

`uv run --all-extras pytest -q`：142项通过（当时包含新增专项中的10项）；补充并独立运行`tests/p1/test_database_contention.py`后12项专项全部通过，合计144个不同测试已验证。专项新增的两项验证主体/人脸分析和摄影风格分析遇BUSY不会落库为识别失败，可继续重试成功。

专项包含真实SQLite双连接写锁/回滚、目录投影期间另一写者可执行、焦点比较更新、空闲不重复写、扫描与媒体错误分类、永久错误不吞掉、worker退出退避，以及真实多进程supervisor测试。后者使用独立空库与禁用模型的隔离服务：强制SIGKILL扫描进程，确认HTTP PID保持且扫描PID恢复；随后持写锁超过真实10秒timeout，确认worker记录退避、API仍返回200，解锁后两类worker心跳恢复且进程没有退出。隔离测试没有连接NAS、下载模型或读取用户图库。

正式运行仅重启到新代码、进行只读状态检查，不在真实库故意持锁或杀worker。当前20,132项已处理、原有4失败＋1待适配、暂停标记false均保留，完成事件数31,372未变；五张兼容异常未在这次修复中重试。API和四类worker在本轮354秒观察期间没有退出或重启记录；这个短期观察不代表长期稳定性验收。日志、进程与状态收据在忽略的`data/sqlite-lock-fix/`，正式截图也仅保存在该目录。

这次消除了已确认的持锁查询与“一个worker退出关闭整个网站”路径，不能承诺此后任何环境都不会再出现SQLite竞争。普通BUSY可以短暂重试；磁盘故障、坏库、系统休眠和主机退出仍属于独立运行问题。

汇总证据：[sqlite-contention-evidence.json](sqlite-contention-evidence.json)。
