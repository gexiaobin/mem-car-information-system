# 云程 · 离线汽车渲染工作室

V0.5 素材实施工具，已导出静态车图并接入车辆组件，页面验收与发布结果另行记录。此目录生成车辆展示图片；应用运行时只使用静态 WebP，不把车辆三维场景加入 React 页面。地图仍独立使用 MapLibre GL。

## 模型来源与改编

原作品 **Car Concept — Eric Chadwick / Darmstadt Graphics Group GmbH，2024**，模型与贴图使用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。来源固定为 Khronos glTF Sample Assets 提交 `8f492390ddc7a2ae221a1369ef560589cf8c70fb` 的 [Models/CarConcept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/CarConcept)。上游许可排除 logo 及相关商标，不以 CC BY 许可推断标识授权。

本项目调整银白／石墨车漆、烟黑玻璃、轮毂、棚拍灯光与相机，隐藏 `License Plate` 和 `InteriorSteeringEmblem`，移除轮胎侧壁颜色／法线贴图并关闭原材质发光。柔和接地阴影由透明径向阴影平面提供。渲染图属于原模型的改编作品，不能声称模型由本项目原创；继续分发须保留原作品、署名、来源、许可链接及修改说明。完整说明见 [素材署名](../../docs/image-attribution.md)。

## 目录与依赖

| 位置 | 用途 |
| --- | --- |
| `scripts/car-studio/server.mjs` | 仅监听本机的素材服务器 |
| `scripts/car-studio/scene.js` | 材质、构图、光照、透明阴影与 PNG 导出 |
| `scripts/car-studio/optimize.mjs` | 使用本地 Sharp 裁剪、补透明边距并输出主／小图 WebP |
| `scripts/car-studio/index.html` | 本地预览与视角／导出控件 |
| `.local/car-studio/car-concept.glb` | 从固定来源取得的模型，不提交 Git |
| `.local/car-studio/SOURCE-LICENSE.md`、`SOURCE-METADATA.json` | 保留下载时的上游许可与元数据 |
| `.local/car-studio/node_modules` | 本地 Three.js、Draco 与 Sharp 依赖，不进入应用依赖或部署包 |
| `apps/web/public/images/vehicles/studio-silver.webp` | 透明主图，1440 × 504，69,370 字节 |
| `apps/web/public/images/vehicles/studio-silver-small.webp` | 透明小图，720 × 252，31,214 字节 |

`.local/` 已被仓库忽略。原模型、工具依赖与中间 PNG 留在其中；提交和发布仅包含必要工具源码、署名与最终静态车图。

## 本地生成流程

1. 从上述固定提交的 `Models/CarConcept/glTF-Binary` 取得 GLB，保存为 `.local/car-studio/car-concept.glb`，同时保留上游许可与元数据。
2. 在项目根目录安装工作室专用依赖，不修改应用的依赖清单：

   ```powershell
   npm install --prefix .local/car-studio --no-save three@0.187.0 sharp@0.35.5
   ```

3. 从项目根目录启动：

   ```powershell
   node scripts/car-studio/server.mjs
   ```

4. 打开 `http://127.0.0.1:5178/`。模型、Three.js 与 Draco 均由本机提供；完成下载与安装后，渲染过程不需要远程模型服务。选用前 3/4 视角，核对车头、两轮和落影完整。
5. 点击“导出透明 PNG”。1600 × 800 画布经本地 `POST /export` 直接保存为 `.local/car-studio/studio-silver.png`；不是浏览器下载流程。工作室页面的深色预览背景不写入透明画布。
6. 从项目根目录执行转换：

   ```powershell
   node scripts/car-studio/optimize.mjs
   ```

转换扫描 alpha ≥ 200 的像素取得车身包围框，在原画布边界内向左／右各保留 60px、向上 20px、向下 50px，包含少量椭圆软阴影；按该范围提取后等比输出 1440px 与 720px 宽 WebP。编码参数为 `quality: 88`、`alphaQuality: 100`、`effort: 6`，结果尺寸和字节数见上表。重新调整视角或材质后须重新导出 PNG 并运行转换，不能由画布尺寸推断最终 WebP 尺寸。

## 当前渲染参数

| 参数 | 值 |
| --- | --- |
| 默认相机 | 位置 `(8.0, 1.65, 5.8)`，朝向 `(0, 0.58, 0)`，前 3/4 低视角 |
| 透视 | FOV 31°，宽高比 2，zoom 1.6 |
| 色调与环境 | ACES Filmic，曝光 0.85，环境强度 0.7 |
| 车身与玻璃 | 银白／石墨物理材质，烟黑玻璃 |
| 背景与接地 | 透明背景，椭圆径向软接触阴影 |

## 接入与验收

- 页面提供 720w／1440w `srcset` 和响应式 `sizes`，声明 1440 × 504 固定宽高；首屏 `loading="eager"`、`fetchPriority="high"`，档案 `loading="lazy"`，均 `decoding="async"`。浏览器按视口及像素密度选图，不能把“小图存在”当作手机实际请求证据。
- 检查银白车身、烟黑玻璃、低视角、自然比例、柔和阴影与透明边缘，确认没有可见原商标、裁轮或拉伸。
- 检查主／小图尺寸、字节数和透明通道，桌面、375px 手机及平板布局完整；车辆图片加载失败不得遮挡业务操作。
- 浏览器车辆资源请求中不出现 GLB、Three.js 或车辆 WebGL 初始化；不能把地图已有的 WebGL 使用误判为车辆三维运行时。
- 生成成功、页面验收和上线发布分别记录；当前文档不声明 V0.5 已部署。
