# 黑底黄褐 · 第二版生成提示词

2026-10-24。使用内置 image_gen；Gallery以用户提供的既有概念图作编辑目标，其余新生成。素材与示例数字为虚构。当前规范见 ../visual-language.md。

## Gallery 首页 · 时光隧道

目标文件：01-gallery-home.png

```text
Use case: ui-mockup. Photo Museum personal life-photo museum. Produce one high-fidelity 16:10 desktop screen, edge-to-edge, no device/browser mockup or presentation annotations. Entire page background MUST be flat pure black #000000, not charcoal, warm white, brown or a gray gradient. Primary UI accent ochre/tawny yellow-brown #B88B4A, bright accent #D8AE72. Main text warm ivory #E9E4DB and secondary #A7A198. Restrained Swiss editorial typography, thin consistent line icons, fine ruled groups, minimal corners. Photographs retain natural colors, no global sepia/filter. Genuine quiet photographic museum, not neon sci-fi, not generic rounded-card SaaS. Brand exactly PHOTO MUSEUM. All photos and numerical data are fictional. Chinese UI short readable labels; no technical code/library names.
EDIT the supplied time-tunnel reference. Preserve the approved composition: foreground panel of exactly ten naturally colored coastal-life photographs, one main image plus nine supporting images; several entire activity panels receding coherently to the right into depth. Keep photographic content and mood, foreground photos large, lower-left date/title and subtle navigation. This is now the Gallery HOME screen itself, no separate marketing home.
Change all empty/background space to PURE BLACK, eliminate gray fog and floor reflection. Replace olive/green accents with ochre. Add a small photo-album line icon beside "10 张精选", a tiny "Gallery" label and discreet "馆务" navigation.
CRITICAL timeline revision: reserve a readable right-hand column about 280px wide, reduce stage width slightly to make space. Keep a very fine vertical year ruler, but replace bare month ticks with DISTINCT selectable month-plus-activity rows under 2024. Render these exact rows in order, visibly separate:
"2026"
"2024"
"10-海边的一天" (selected, ochre text and small ochre diamond)
"10-山间露营"
"10-老友相聚"
"09-城市漫步"
"年度-四季片段"
"2023"
"2022"
"2020"
"2018"
All THREE 10-month activities must be readable, separate lines, NOT grouped into one month entry. Unknown-month annual activity explicitly shows 年度. Don't add bare 12/11/10/09 month labels as substitutes. Keep font at comfortable reading size; no overlapping images behind timeline text. Bottom-left selected title "海边的一天", date "2024 · 10", metadata "10 张精选". Small paired navigation chevrons with "沿时间漫游". Retain immersive photo-first design; add no gratuitous analytics charts over the pictures.
```

## 刮削管理 · 真实进度可视化

目标文件：02-scan-management.png

```text
Use case: ui-mockup. Photo Museum personal life-photo museum. Produce one high-fidelity 16:10 desktop screen, edge-to-edge, no device/browser mockup or presentation annotations. Entire page background MUST be flat pure black #000000, not charcoal, warm white, brown or a gray gradient. Primary UI accent ochre/tawny yellow-brown #B88B4A, bright accent #D8AE72. Main text warm ivory #E9E4DB and secondary #A7A198. Restrained Swiss editorial typography, thin consistent line icons, fine ruled groups, minimal corners. Photographs retain natural colors, no global sepia/filter. Genuine quiet photographic museum, not neon sci-fi, not generic rounded-card SaaS. Brand exactly PHOTO MUSEUM. All photos and numerical data are fictional. Chinese UI short readable labels; no technical code/library names.
New screen: keeper's scraping-progress management. Adopt the time-tunnel museum's thin spaced wordmark, elegant activity labels and quiet geometry, flattened into a practical admin screen. Header PHOTO MUSEUM; top right "馆务室" and "返回 Gallery ↗". Main title "整理此刻，重看往日。".
Use consistent ochre SVG-like outline icons for NAS, folder, photograph, pause, resume, check, clock and retry. Top statistics: indexed photographs "13,286", connected sources "1", "任务进行中". Main visualization: an ochre circular ring with center "154 / 227" and label "已发现目录", alongside a wide segmented horizontal strip labelled "已完成 154" and "待处理 73". A clear caption "目录仍在发现 · 非全库进度". DO NOT show 68% whole-library progress, fake ETA or a fake speed chart.
Lower left: fine ruled activity rows with small photographic thumbnails, title, status icon+text, thin real stage bar and action. Three examples "2024-10-海边的一天" active with "暂停"; "2024-10-山间露营" paused with "恢复"; "2024-10-老友相聚" completed with check; another has "等待重试". Right narrower visualization rail: compact connected-source diagram "Farmer → 本地索引", three-stage horizontal/vertical icon flow "读取目录 → 索引文件 → 完成", current stage highlighted ochre. Small informational label "照片源只读". Black backgrounds for every section and form, separation by fine rules, not gray or brown filled cards. UI feels consistent with an elegant dark photographic gallery, richly informative but never cluttered.
```

## 主题展览／照片墙 · 黑底黄褐

目标文件：03-exhibition-wall.png

```text
Use case: ui-mockup. Photo Museum personal life-photo museum. Produce one high-fidelity 16:10 desktop screen, edge-to-edge, no device/browser mockup or presentation annotations. Entire page background MUST be flat pure black #000000, not charcoal, warm white, brown or a gray gradient. Primary UI accent ochre/tawny yellow-brown #B88B4A, bright accent #D8AE72. Main text warm ivory #E9E4DB and secondary #A7A198. Restrained Swiss editorial typography, thin consistent line icons, fine ruled groups, minimal corners. Photographs retain natural colors, no global sepia/filter. Genuine quiet photographic museum, not neon sci-fi, not generic rounded-card SaaS. Brand exactly PHOTO MUSEUM. All photos and numerical data are fictional. Chinese UI short readable labels; no technical code/library names.
New screen: immersive Gallery photo wall, full viewport nearly-square photo cells, six columns by four rows with thin PURE BLACK seams, no empty page gutters. Photos show a fictional day at the coast: family from behind, train windows, waves, street meals, blue hour, mountains across water. One selected near-center photograph expands into a large complete-aspect-ratio view above the wall; keep original natural photo colors and underlying wall visible but slightly dim. This visualizes thumbnail -> instant 4K -> original development. Subtle transient reveal at lower edge of selected photo, no permanent warm tint, no loading spinner.
Minimal transparent/pure black HUD: small PHOTO MUSEUM / Gallery upper left; "海边的一天" and "2024 · 10" bottom left; small ochre outline album icon and "10 张精选 / 42 张照片". Bottom middle ochre line grid icon labelled "照片墙", adjacent album icon labelled "主题" and thin shuffle icon labelled "随机". Bottom right unobtrusive "原图显影中", full-screen and back line icons. A slim top-right expandable filter icon and small compact activity-frequency bars only inside its clearly delineated collapsed/compact control area, not a dashboard over the picture. Accessible controls subtly outlined in ochre, selected only lightly accented. No beige, olive, bright yellow or frosted gray panels. Core feeling stays photo-first, quiet and game-like full screen, with unified line icons.
```

## 馆主登录 · 统一入口

目标文件：04-owner-login.png

```text
Use case: ui-mockup. Photo Museum personal life-photo museum. Produce one high-fidelity 16:10 desktop screen, edge-to-edge, no device/browser mockup or presentation annotations. Entire page background MUST be flat pure black #000000, not charcoal, warm white, brown or a gray gradient. Primary UI accent ochre/tawny yellow-brown #B88B4A, bright accent #D8AE72. Main text warm ivory #E9E4DB and secondary #A7A198. Restrained Swiss editorial typography, thin consistent line icons, fine ruled groups, minimal corners. Photographs retain natural colors, no global sepia/filter. Genuine quiet photographic museum, not neon sci-fi, not generic rounded-card SaaS. Brand exactly PHOTO MUSEUM. All photos and numerical data are fictional. Chinese UI short readable labels; no technical code/library names.
New screen: minimal password-only owner login, same museum visual identity as the time tunnel. Large uninterrupted PURE BLACK background. Small widely tracked PHOTO MUSEUM upper left, a thin ochre museum/lock monogram in the central composition, no giant graphic. Center-left aligned balanced login grouping: small "A PERSONAL PHOTO MUSEUM", restrained heading "重回你的时光。", short sentence "每一段生活，都值得再看一次。", label "馆主密码", a single black password field outlined ochre with eye icon and masked dots, then ochre solid button with BLACK text "进入 Gallery" and thin right arrow. Secondary tiny text "无需用户名". No private photographs before authentication, no made-up collection statistics or fake progress graphs; the meaningful visualization here is the fine architectural outline/lock icon. Lots of negative space, crisp typography, no gray gradient, paper texture, marketing hero or rounded app cards. Make the design belong unmistakably to the dark time-tunnel Gallery.
```
