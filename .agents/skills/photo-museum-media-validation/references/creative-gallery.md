# 概念细化、四样式与创意展厅复验

先读 `docs/research/gallery-concept-refinement.md`、`docs/research/creative-gallery-data.md` 与 ADR0008。公开截图仅合成图片。真实图库验证只保存到忽略的data，不打印路径、人名、GPS或凭据。

1. 隔离构建：`npm run build --prefix web -- --outDir ../data/gallery-refinement/web-dist`。
2. 以 `MUSEUM_VALIDATION_CREATIVE=1 MUSEUM_FIXTURE_PORT=8793 MUSEUM_WEB_DIST="$PWD/data/gallery-refinement/web-dist" PYTHONPATH=.` 运行 `uv run --all-extras python tools/p5_validation_server.py`。等待ready；synthetic fixture使用独立临时数据库及合成标签，不访问正式NAS。
3. Node布局检查：`node --test web/tests/cover-layout.test.mjs web/tests/radial-layout.test.mjs web/tests/timeline-collage.test.mjs`。
4. 设置 `MUSEUM_BROWSER_BASE=http://localhost:8793`，顺序运行 `web/tests/gallery-refinement.mjs`、`web/tests/coverflow-resize.mjs`、`web/tests/radial-rooms.mjs`、`web/tests/creative-editorial.mjs`、`web/tests/revisit-draft.mjs`（均用node）。查看脚本的output/evidence覆盖变量，避免覆盖历史报告。不要在同一fixture并发运行会保存偏好、长卷或隐藏图片的测试。
5. day/night与P5回归沿用对应脚本，输出另设本轮目录。`revisit-draft`会临时隐藏一张**合成**照片并恢复；禁止把它指向正式服务。
6. 后台 `uv run --all-extras pytest -q`。新schema先私密备份再迁移；真实入口用现有馆主会话，不提取密码、不绕过认证。迁移校验既有核心表数量不变。

验收不只看DOM存在：截图检查遮挡、镜面、细框、裁切、文字层级、导航和图像的留白。320/390手机、701×541临界矮屏、1100/1101宽度及3440超宽屏保位；末章End定位、返回保位；减少动态效果；快开快关无克隆/Blob残留；标签当前revision与媒体版本一致；配对草稿显示前校验隐藏、revision和P6范围。展厅浏览不得请求NAS原图。

概念图中不存在的真实月份、标签、街道、器材轮廓或同机位配对不能伪造。独立配对、年轮扇区、星图连线的含义以ADR为准。大图库聚合有可测延迟，不把有加载状态误称为零等待。结束停止自己的fixture，保留正式supervisor及用户Gallery入口。
