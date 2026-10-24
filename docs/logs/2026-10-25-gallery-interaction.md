# Gallery 交互修订

根据用户六项要求调整：取消精选数量、连续进出画板、横向输入与拖动、活动整板→全活动4K墙→单图暗房、底部倒影、三项导航。实现与边界见 ../research/gallery-interaction-validation.md。

前端新增 exhibition.jsx 隔离连续隧道、虚拟照片墙和全屏控件。后端新增 view_original.py 提供按需NAS原图SDR临时转换，不复用持久兼容缓存作为此次原图读取。同步更新回归选择器，公开截图仅合成图。真实服务及worker保持运行，交付打开Gallery。

验证结果：Python全套61项通过；浏览器专项8组＋既有25项通过；Vite正式构建成功，git diff --check通过。真实NAS HEIC完整显影后临时目录为空，截图保存data/。
