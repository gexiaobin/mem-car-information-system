# 汽车视觉素材、地图与历史图片署名

## V0.5 授权概念跑车的离线渲染

状态：离线渲染素材与静态 WebP 已随 V0.5 代码 `4392486` 发布，已核对本地页面及公网桌面／手机首页；实际验收范围与线上版本以 [验证记录](verification.md) 为准。

视觉方向为银白车漆、烟黑玻璃、低视角前 3/4 构图与柔和接地阴影。用户提供的跑车画面仅作视觉参考；渲染所用三维资产为下列授权概念车，不能将其称为项目原创建模、Tesla Roadster 精确外观或车主实车。

| 项目 | 来源与许可 |
| --- | --- |
| 原作品 | Car Concept |
| 署名 | Eric Chadwick / Darmstadt Graphics Group GmbH，2024 |
| 固定来源 | [Khronos glTF Sample Assets / CarConcept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/CarConcept)，使用 `glTF-Binary` 目录模型，提交 `8f492390ddc7a2ae221a1369ef560589cf8c70fb` |
| 模型与贴图许可 | [Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/)，[上游 LICENSE](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/CarConcept/LICENSE.md) |
| 项目修改 | 银白／石墨车漆、烟黑玻璃与轮毂材质；棚拍光照、低视角构图与透明柔和阴影；隐藏 `License Plate`、`InteriorSteeringEmblem`，移除轮胎侧壁商标贴图，关闭原材质发光 |
| 静态主图 | `apps/web/public/images/vehicles/studio-silver.webp`，1440 × 504，69,370 字节，透明 WebP |
| 静态小图 | `apps/web/public/images/vehicles/studio-silver-small.webp`，720 × 252，31,214 字节，透明 WebP |

原许可明确排除 logo 及相关商标，元数据另列 Khronos 与 3D Commerce 标识。项目通过隐藏相关部件、去除贴图处理其可见标识；不能把商标视为 CC BY 授权内容。继续分发模型改编渲染图时，保留原作品、作者、来源、CC BY 4.0 链接与上述修改说明；该素材许可不自动改变应用代码许可。

模型、原许可与本地 Three.js／Sharp 依赖放在忽略目录 `.local/car-studio`，渲染工具源码位于 [scripts/car-studio](../scripts/car-studio/README.md)。导出按钮通过本机 POST 保存透明 PNG，再由 `optimize.mjs` 依据 alpha ≥ 200 的车身包围框，保留左右各 60px、上 20px、下 50px 的周边区域及少量软阴影，生成两张 WebP；不通过下载操作导出。车辆组件提供 720w／1440w 的 `srcset`，首屏使用 eager／high，车辆档案延迟加载，并固定图片尺寸。运行时只请求本地 WebP，不下载 GLB 或加载 Three.js；此约束仅指车辆视觉，地图仍独立使用 MapLibre GL。V0.5页面曾叠加外观示意说明；V0.9.6整合版本移除车图上的叠字及覆盖链接，改在登录页和车主页脚提供“车辆素材与许可”入口，链接至本说明，保留作者、来源、许可与改编信息。图片替代文字仍说明概念车仅为示意，档案车型与里程以业务数据为准。V0.9.6当前部署状态见 [验证记录](verification.md)，历史截图与历史署名描述继续保留。

## V0.4 原创皮卡与服务站插画（历史）

V0.4 登录页、车主首页和车辆档案使用项目内绘制的原创 SVG 皮卡，以 Tesla Cybertruck 的楔形轮廓为设计灵感：三角车顶、平直钢板、大轮拱与直线灯带。未使用 Tesla 商标、车型照片或第三方车辆图片热链。页面标注灵感示意；该通用插画不对应车主档案中的实际车型，不表示品牌授权、精确年款配置、车主实车或所有权，车辆信息以本人档案为准。

门店列表和首页推荐共用项目内原创的 `StoreIllustration` SVG，包含海洋蓝檐口、玻璃工位、汽车与举升机；4S、连锁与综合维修三类通过招牌装饰区分。完整与紧凑版本均为服务场景示意，不表示商家真实门面、品牌标识或认证资质。店名、类型及审核状态以业务文字为准。V0.5 继续沿用这套门店插画。

海洋蓝主题受中国海洋大学海洋文化启发；深海蓝 `#003B70`、主色 `#0068B5`、点缀 `#00A7C8` 与画布 `#F1F7FB` 是云程项目自定色值，不声称是学校官方 VI，也不以校徽代替项目标识。当前插画与色彩规范的线上状态以 [验证记录](verification.md) 为准。

V0.3 曾使用原创通用轿车 SVG；V0.4 替换其轮廓，继续不使用车型实拍照片。

## 地图来源与署名

V0.3 默认地图通过 MapLibre GL 在浏览器渲染，使用 [OpenFreeMap](https://openfreemap.org/) 公开提供的真实 OpenStreetMap 矢量地图。样式、字体和矢量瓦片从地图服务直接加载；服务免费公开使用、无需 API Key，浏览器须支持 WebGL 并能访问服务。地图是地理数据底图，与项目原创的汽车示意插画不同。

地图保留样式与数据源提供的自动署名，包括 OpenFreeMap、OpenMapTiles 和 [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)；地图数据按其原有许可使用，不因应用代码许可而改变。发布页面或带底图的截图时，须保留相应来源与署名，不将第三方地理数据标为项目原创。高德可选地图按其服务要求显示来源。

## V0.2 历史实拍参考图

V0.2 车主首页及登录页曾采用从 Wikimedia Commons 获取的实拍车型参考图片。图片表示车型外观，不表示登录车主的实车、具体配置或所有权，也不作为车辆年款、保养规则或商家背书的依据。该版本页面显示“车型参考图”及来源、许可链接；V0.3 新界面不再引用这些照片。为保留历史分发与旧版截图的署名依据，下表和原许可记录继续保留。

完整的原作品、原文件链接、修改说明和许可记录见 [随图片分发的 ATTRIBUTION.md](../apps/web/public/images/vehicles/ATTRIBUTION.md)。

| 本地文件 | 原作品与作者 | 许可 | 发布处理 |
| --- | --- | --- | --- |
| `apps/web/public/images/vehicles/byd-seal.webp` | [2024 BYD Seal 2.jpg](https://commons.wikimedia.org/wiki/File:2024_BYD_Seal_2.jpg)，Calreyn88 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 等比缩至宽 1440 像素、转换 WebP、移除元数据；162,534 字节 |
| `apps/web/public/images/vehicles/vw-magotan.webp` | [VOLKSWAGEN MAGOTAN B8L China.jpg](https://commons.wikimedia.org/wiki/File:VOLKSWAGEN_MAGOTAN_B8L_China.jpg)，Dinkun Chen | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 等比缩至宽 1440 像素、转换 WebP、移除元数据；106,484 字节 |

来源与许可描述于 2026-11-03 核对。V0.2 的两张适配图片按 CC BY-SA 4.0 提供，该许可不自动适用于应用代码。V0.3 已从当前应用资源移除这些照片；继续分发旧图片或含这些照片的历史截图时，应一并保留作者、来源、许可及修改说明。

V0.2 历史界面截图曾包含上述 Dinkun Chen 的迈腾照片在页面中的缩放展示；继续分发带该照片的历史截图时，照片部分仍按 CC BY-SA 4.0 提供并保留署名。`docs/images/registration-review.jpg` 使用本项目生成、明确标记为虚构的行驶证样本，不含私人证件。新版首页截图以 README 和验证记录所列版本为准。

以上公开许可图片与车主私人上传的行驶证、仪表或故障照片不同。私人上传文件不进入代码仓库；证件图片与识别档案的服务端权限见 [API 说明](api.md#行驶证识别与私人档案)。
