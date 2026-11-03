# 车型参考图片与署名

V0.2 车主首页及登录页采用从 Wikimedia Commons 获取的实拍车型参考图片。图片表示车型外观，不表示登录车主的实车、具体配置或所有权，也不作为车辆年款、保养规则或商家背书的依据。页面显示“车型参考图”及来源、许可链接；暂未匹配图片的车型使用明确的待补图状态。

完整的原作品、原文件链接、修改说明和许可记录见 [随图片分发的 ATTRIBUTION.md](../apps/web/public/images/vehicles/ATTRIBUTION.md)。

| 本地文件 | 原作品与作者 | 许可 | 发布处理 |
| --- | --- | --- | --- |
| `apps/web/public/images/vehicles/byd-seal.webp` | [2024 BYD Seal 2.jpg](https://commons.wikimedia.org/wiki/File:2024_BYD_Seal_2.jpg)，Calreyn88 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 等比缩至宽 1440 像素、转换 WebP、移除元数据；162,534 字节 |
| `apps/web/public/images/vehicles/vw-magotan.webp` | [VOLKSWAGEN MAGOTAN B8L China.jpg](https://commons.wikimedia.org/wiki/File:VOLKSWAGEN_MAGOTAN_B8L_China.jpg)，Dinkun Chen | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 等比缩至宽 1440 像素、转换 WebP、移除元数据；106,484 字节 |

来源与许可描述于 2026-11-03 核对。两张适配后的图片继续按 CC BY-SA 4.0 提供；该图片许可不自动适用于应用代码。图片随应用本地提供，避免依赖第三方热链；继续分发图片时应一并保留作者、来源、许可及修改说明。

以上公开许可图片与车主私人上传的行驶证、仪表或故障照片不同。私人上传文件不进入代码仓库；证件图片与识别档案的服务端权限见 [API 说明](api.md#行驶证识别与私人档案)。
