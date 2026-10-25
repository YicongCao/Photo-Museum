# 统一 Settings 执行日志

- 修改前检查阶段、依赖锁、服务入口和现有设计语言；先存独立 HTML 布局基准及 ADR0007，再实现 React 一屏设置页。
- 集中文件源与 Provider 编辑，移除 Dashboard 来源弹层和策展 Provider 弹层。保留来源身份与加密凭据，空密码/key表示保留；浏览设置不自动访问NAS或调用LLM。
- 增加 revision 偏好存储，接通离线地址增量重算/暂停/推断与距离规则，以及按需原图、设备能力判断和原生解码失败回退。原有媒体/模型版本、SDR双缓存和任务策略不变。
- 111项全量后端测试通过，Settings 11项、P6 11项、Dashboard 7项浏览器回归及8种状态断言通过；公开截图仅合成源。检查桌面/矮窗口/手机五个分类、真实本地GPS任务、零自动原图请求、回退/Blob释放。
- 按 skill-creator 指南把已验证流程加入既有媒体验证技能的 settings reference，quick_validate 通过。
- 正式库schema8先经只读SQLite连接在线备份，私密收据位于忽略目录。正常停止旧 supervisor，构建正式前端，恢复API/扫描/媒体/视觉/摄影五个进程。
- HTTP根页面200且与构建一致；未登录Settings与preferences接口401。源记录和Provider加密配置指纹不变，媒体未暂停，缓存账本仍仅display/thumb；切换检查相对备份快照新增5个完成事件。正式偏好尚未被改写，默认行为沿用。
- 已打开8790/#settings，目前为正常馆主解锁页；没有绕过鉴权或读取系统钥匙串。用户正常解锁后即进入Settings。停止本轮8797合成fixture，保留8790后台处理。

[完整验证和截图](../research/unified-settings-validation.md)
