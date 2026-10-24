# Gallery Cover Flow 调研与三选一

2026-10-25。当前工作是设计选择，尚未将新方案接入正式Gallery。三张图通过内置image_gen生成，用虚构旅行照片作示例；未上传NAS照片。完整提示词保存在[设计目录](../design/coverflow-2026-10-25/prompts.json)。这是静态概念，不是浏览器实时渲染或性能证据；生成图的拼图数量、文字与透视细节只是视觉参考，落地仍以每活动最多十图及真实数据为准。

## 查阅的 GitHub 项目与可用做法

1. [addyosmani/react-flow](https://github.com/addyosmani/react-flow)：React＋CSS滚动驱动Cover Flow，README明确提到Fetch Priority预取。与当前React/DOM最接近。适合借鉴连续滚动与画板姿态的映射、当前和邻近画板的加载优先级；不必为效果重新改成全canvas。该项目的ScrollTimeline兼容层不能直接视为我们目标浏览器已验证。
2. [nolimits4web/swiper](https://github.com/nolimits4web/swiper) 的 [effect-coverflow源码](https://github.com/nolimits4web/swiper/blob/master/src/modules/effect-coverflow/effect-coverflow.ts)：把rotate、stretch、depth、scale、modifier分开配置。适合把当前手写pose关键帧整理为统一可调参数，减少远处画板挤成窄片、近处扭曲过大。此次仅参考计算方式，未安装或复制组件。
3. [addyosmani/threejs-coverflow](https://github.com/addyosmani/threejs-coverflow) 的 [main.js](https://github.com/addyosmani/threejs-coverflow/blob/main/main.js)：居中画板正面、两翼±45°、倒影；位置和旋转分别使用GSAP动画，并允许新动画覆盖旧动画。适合借鉴视觉构图和可中断缓动。示例的整页渲染、固定正方形封面、长缓动不直接照搬；我们的触控板拖动必须即时跟手，释放后才做短阻尼。
4. [aderaaij/photo.arden.nl](https://github.com/aderaaij/photo.arden.nl)：README描述DOM负责布局、WebGL贴合DOM位置，以及按视口加载、分帧上传纹理和分批挂载。对未来局部WebGL值得参考；本轮不引入其常驻全页Canvas或改变纯黑底色。性能数字是作者描述，未在本项目复测。

以上是源码/README级调研，没有安装运行这些第三方demo，也没有验证其所有浏览器表现。实现建议是本项目推断；如后续复制代码，应先核验对应版本许可证并保留要求的声明。

## A：纵深展廊（推荐）

[概念图](../design/coverflow-2026-10-25/A-depth-gallery.png)。保留当前一侧延伸的时间纵深，但当前画板更正、更大，后方只显示少量清晰层级。建议近板yaw约8°、后板25–40°，减少现在远处高角度倾斜；尺度衰减更均匀、远板轻微压暗而非大幅模糊；缩短倒影。

照片主次与时间方向最清楚，改动成本最低，可延续当前Tunnel组件。拖动时连续插值，停下后短阻尼；点击活动→整场照片墙→单图暗房链路不变。

## B：经典 Cover Flow

[概念图](../design/coverflow-2026-10-25/B-classic-coverflow.png)。当前活动居中正面，两侧对称后退，正面的拼图最容易看清。参考Three.js示例与Swiper的独立姿态参数。适合“选择一本相册”的体验。

需要重新定义左右双翼的布局曲线与首尾状态，侧翼活动更多被遮挡，时光隧道的单向纵深感较弱。保留连续横滚，不自动轮播、不强制每次拖动吸附。

## C：弧形展墙

[概念图](../design/coverflow-2026-10-25/C-panoramic-arc.png)。相邻三块大画板沿浅弧摆放，遮挡少，照片总展示面积最大。建议CSS位移＋轻旋转构成圆弧，不将照片网格弯曲或做液态扭曲。

更像环绕展厅，适合同屏比较相邻活动；中心与相邻活动主次较弱，侧板会被视口裁切。现有DOM/CSS仍可实现基础效果，若选后续真实曲面shader需另做局部渲染和显存预算验证。

## 共同保留

纯黑＋黄褐、无品牌和slogan、右上Gallery/Dashboard/全屏、右侧年/月/主题Dock时间线、最多十图活动画板、整板进入活动墙、原比例4K照片墙与NAS原图暗房。倒影沿用同一张缩略图，不额外读取NAS。背景不增加雾、粒子、星空或明亮地平线。

等待用户选A/B/C后再实现及动态验收。静态图不能证明惯性手感、稳定帧率或资源回收。
