# 汽车示意插画与历史图片署名

## V0.3 原创汽车示意

V0.3 登录页、车主首页和车辆档案采用项目内绘制的原创 SVG 汽车示意插画，统一透视、配色与光影，不依赖网上车型照片或第三方图片热链。插画仅用于界面表达，不表示特定品牌车型的精确外观、车主实车、年款配置或所有权；车辆信息以本人档案为准。

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

来源与许可描述于 2026-11-03 核对。两张适配后的图片继续按 CC BY-SA 4.0 提供；该图片许可不自动适用于应用代码。图片随应用本地提供，避免依赖第三方热链；继续分发图片时应一并保留作者、来源、许可及修改说明。

V0.2 历史界面截图曾包含上述 Dinkun Chen 的迈腾照片在页面中的缩放展示；继续分发带该照片的历史截图时，照片部分仍按 CC BY-SA 4.0 提供并保留署名。`docs/images/registration-review.jpg` 使用本项目生成、明确标记为虚构的行驶证样本，不含私人证件。新版首页截图以 README 和验证记录所列版本为准。

以上公开许可图片与车主私人上传的行驶证、仪表或故障照片不同。私人上传文件不进入代码仓库；证件图片与识别档案的服务端权限见 [API 说明](api.md#行驶证识别与私人档案)。
