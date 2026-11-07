# 云程 AutoVoyage

中国海洋大学 MEM《软件工程管理》课程项目：汽车信息管理系统。

React + TypeScript 车主 H5 / 管理 Web，Node.js + Fastify 统一 API，PostgreSQL 持久化。支持通用服务项目选择导入、按车型整理手册候选、保养表截图粘贴、AI 自动填写与人工核对发布，以及近年车系的实际年款、动力与配置选择。沿用自动系统更新日志、银白概念跑车和海洋蓝主题，覆盖行驶证建档、车辆档案、保养提醒、门店比价预约、故障咨询与服务记录。

课程预览已部署：[打开云程](http://117.72.124.241:58083/)。车主、门店、专家和平台账号的独立口令保存在部署者本机受控文件中，不提供公开通用密码。实际验收范围见 [验证记录](docs/verification.md)。

![V0.5 公网车主首页：银白概念跑车、海洋蓝数字车库与养护计划](docs/images/owner-dashboard.png)

首页截图保留 V0.5 公网验收，V0.6 沿用该视觉和课程演示车辆。车辆视觉由授权 Car Concept 模型离线渲染，网页只加载静态 WebP；外观仅为示意，作者、CC BY 4.0 许可与修改说明见 [素材来源](docs/image-attribution.md)。文档中的 [门店地图截图](docs/images/store-map.png) 沿用 V0.4，该页面视觉本轮未改。

海洋蓝取自中国海洋大学海洋文化的设计灵感，色值为项目自定配色。

## 功能与当前进度

| 使用角色 | 主要功能 |
| --- | --- |
| 车主 | 多车档案、行驶证识别与人工核对、仪表里程识别、分项目保养提醒、门店查询与比价预约、故障咨询、消息及服务记录 |
| 门店管理员 | 本店资料、服务报价与版本、时段名额、预约接单及服务进度、项目与费用变更、专家分配 |
| 门店专家 | 分配范围内的故障资料、补充信息、建议与费用预估 |
| 平台管理员 | 公开品牌／车系、实际年款／动力／配置及参考服务项目选择导入、标准项目、手册 PDF／图片导入及 AI 核对发布、车型保养规则与资料来源、门店审核及审计记录 |
| 全部已登录角色 | 系统更新日志、当前运行版本与首次上线时间 |

平台管理员从“车型档案 → 从公开车型库选择”与“标准服务项目 → 从参考项目库选择”进入预置目录。车型可先按实际年款筛选，默认只显示有公开配置的车系；卡片逐项显示已收录年份，再按动力选择完整配置导入。未收录不等于该年款不存在，可依据实车资料手动补充。服务参考库精简为25项日常通用服务，可按需批量选择；业务列表默认显示启用项，支持已停用／全部及分类筛选，停用项目可编辑恢复。导入保留已有编辑、跳过不明确冲突并显示原因。当前上线版本、容器状态、测试和截图以 [验证记录](docs/verification.md) 为准；文档提交不触发 Portainer 自动发布。

初始课程数据包括迈腾、海豹演示车型，以及演示规则、门店、价格与记录；公网后来新增的业务资料在本次更新中保留。公开候选目录预置 **3,829 个车系名称、36,754 条完整配置和 25 个通用服务项目**；有配置的车系共2,390个、涉及221个品牌名称。V0.8.1 新增7,573条来源配置，2020年以后共7,520条，覆盖1,000个车系、126个品牌；其中2024款2,600条、2025款2,018条、2026款150条。海狮06已有2025款6条、2026款9条；迈腾、凯美瑞、理想、问界及其他近年车系均有来源记录。原MIT历史数据仍明确为1999–2019年款，不能将大批历史记录等同于近期覆盖。各来源仍有年款断档，不代表全品牌、全配置或全部当前在售；只有选择后才导入业务档案，保养范围仍待手册核对。许可、清洗及实际年份见 [现代数据](docs/vehicle-variants-modern.md)、[比亚迪补充](docs/vehicle-variants-byd-recent.md)、[热点车系](docs/vehicle-variants-latest.md)。

V0.8.6 将此前120项参考目录收敛为25项通用保养候选，保留来源及历史ID兼容。细分维修不再出现在参考选择列表；已有启用业务项目仍可用于手册关联，无法匹配时留空。最初通过只读预览、快照及事务停用旧细分项目，随后按用户要求清空重建为25项通用业务项目；两种维护流程均见 [公开目录](docs/public-catalog.md)。服务名称不自带周期、价格或车型关系，来源见 [来源说明](docs/public-catalog-sources.md)。

车主与管理端均可打开“系统更新日志”。构建自动生成 `基础版本+源码摘要` 版本，API 首次成功监听时写入数据库；相同构建重启、回滚复用原记录。发布者可维护 `release.config.json` 中的功能说明；没有新说明的源码更新也会按变更模块生成摘要。机制、编辑步骤及接口见 [系统更新日志](docs/system-releases.md)。

当前运行版本仍为 **V0.8.6 `0.8.6+1fecfe24f9`**，于2026-11-07北京时间15:11上线。随后按用户要求，于北京时间15:40执行正式目录重建：**旧123项全部清除，重新导入25项通用标准服务，25项启用、0项停用**。可等价的规则、报价和保养记录迁移保留；获准清理2条演示规则、12条演示报价及12条历史报价版本。5个车型、2辆车、3份手册、11个文件和1条保养记录保留；2行未选检查草稿解除关联并保留原文。本次为数据维护，无需重新部署，也未新增软件发布日志；正式库逐对象比对、幂等及公网验收已通过，见 [当前列表](docs/images/general-service-reset-cloud.png) 和 [完整验证记录](docs/verification.md)。

V0.8.6发布时的历史验收为30项启用、93项停用，112项完整回归、32项目录／手册及5项精简执行器真实PostgreSQL专项通过，API／Web均healthy，自动新增本版更新日志。历史证据保留：[精简后的列表](docs/images/common-service-simplified-cloud.png)、[25项通用库](docs/images/common-service-general-catalog-cloud.png)、[更新日志](docs/images/common-service-simplified-updates-cloud.png)。重建执行器另经116项完整回归、PGlite与真实PostgreSQL各4项专项以及535行正式备份全量隔离演练验证。

历史版本 **V0.8.5 `0.8.5+2be7c67710` 已于2026-11-05北京时间19:20上线**。当时参考目录120项、13分类，正式补入后业务目录123项；V0.8.6上线时先通过停用精简，后于2026-11-07按用户要求清空重建为上述25项。保留历史验收：[正式补入截图](docs/images/common-service-import-cloud.png)、[分类列表](docs/images/common-service-projects-cloud.png) 与 [更新日志](docs/images/common-service-updates-cloud.png)。

历史版本 **V0.8.4 `0.8.4+22d57176e5` 已于2026-11-05北京时间18:43上线**：手册草稿可按原文批量补全空白首次保养、自动关联已有或参考标准项目，并按车型整理真实公开手册候选；车型卡片支持查看本车型规则和删除未被引用的条目。101项回归、真实PostgreSQL专项及真实公开检索／AI排序验证通过，两容器均healthy，原业务数据核对保留，自动生成本版更新日志。已有首次值、人工映射及业务引用保留，查询不会自动生成或发布保养周期。公网汽油版凯美瑞查询中出现双擎手册候选，页面明确年款动力尚未确认，不能当作适用手册。使用方式与限制见 [手册导入](docs/manual-import.md)；公网证据：[车型规则筛选](docs/images/manual-model-rules-cloud.png)、[AI候选查询](docs/images/manual-ai-search-cloud.png)、[更新日志](docs/images/manual-tools-cloud-updates.png)，详细结果见 [验证记录](docs/verification.md)。

V0.8.3 历史版本 `0.8.3+2a620a9098` 于2026-11-05北京时间16:02上线，修复车型维护的保养项目复选框布局，功能在当前版本保留。该次全项目类型检查、86项测试与两端构建通过；[公网修复截图](docs/images/model-maintenance-fixed.png)。手机断点仅完成静态审查，未记为手机浏览器实测通过；详细结果见 [验证记录](docs/verification.md)。

V0.8.2 历史版本 `0.8.2+8f8553a803` 于2026-11-05北京时间15:39上线，包含V0.8.1近年配置和快捷图片导入，功能在当前版本中保留。该次发布前通过86项测试、20项真实PostgreSQL手册专项，以及合成保养表的真实AI与浏览器验收。公网证据：[图片导入入口](docs/images/manual-quick-cloud.png)、[自动更新日志](docs/images/manual-quick-cloud-updates.png)；隔离本地证据：[AI自动填写草稿](docs/images/manual-quick-ai-review.png)、[手机图片入口](docs/images/manual-quick-mobile.png)。

保养资料推荐操作：**选车型 → 上传或粘贴保养公里数表截图 → AI 自动填写信息和周期草稿 → 核对发布**。名称、版本、范围在上传前均可留空；原文未说明的字段保留待核对。整本 PDF 默认尝试定位周期表及相邻说明，找不到时可改用截图或手动选页。按车型查询 CarOBook／官方来源仍可使用，目录和网盘不冒充可直接导入的手册。操作与实际发布状态见 [手册导入](docs/manual-import.md) 和 [验证记录](docs/verification.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [操作手册](docs/user-guide.md) | 登录、车辆建档、行驶证上传、里程更新、预约与课程演示步骤 |
| [系统架构](docs/architecture.md) | 前后端、数据模型、权限、事务、AI 与 Docker 网络 |
| [配置说明](docs/configuration.md) | 本地 / PostgreSQL / AI / 地图 / 服务器环境变量及常见问题 |
| [API 接口](docs/api.md) | 路由、权限、请求示例、行驶证字段与状态 |
| [保养手册导入](docs/manual-import.md) | CarOBook／官方来源、PDF 和图片、AI 草稿、人工审核与车型规则发布 |
| [公开车型与服务目录](docs/public-catalog.md) / [资源来源](docs/public-catalog-sources.md) / [配置来源](docs/vehicle-variants-sources.md) | 预置候选、年款动力配置筛选与导入、批量项目、数据年代与许可 |
| [系统更新日志](docs/system-releases.md) | 自动版本标识、上线记录、发布说明维护、重启与回滚 |
| [部署说明](docs/deployment.md) | 京东云、Portainer、端口、初始化、升级与回滚 |
| [六人协作与验收](docs/development.md) | 分工、迭代、提交约定、测试与演示交付 |
| [验证记录](docs/verification.md) | 已执行结果、当前线上版本与后续验收边界 |
| [设计规范](design-system/autovoyage/MASTER.md) / [图片署名](docs/image-attribution.md) | UI 设计约定、照片作者、来源及许可 |

## 本地运行

推荐 Node.js 24 和 npm（Docker 与 CI 均使用 Node.js 24）。以下命令在项目根目录执行：

```bash
git clone https://github.com/gexiaobin/mem-car-information-system.git
cd mem-car-information-system
npm ci
```

首次运行复制 `.env.example` 为 `.env`：Windows PowerShell 执行 `Copy-Item .env.example .env`，macOS / Linux 执行 `cp .env.example .env`。已有 `.env` 时保留自己的配置；本地开发至少将 `SESSION_SECRET` 换成自己生成的 32 字符以上随机值。保留默认 PGlite 可直接体验演示数据。

```bash
npm run dev
```

打开 http://localhost:5173 。前端通过 Vite 代理访问 API，后端默认监听本地 3001。开发默认使用 PGlite（本地运行的 PostgreSQL 引擎，数据保存到 .local），无需安装数据库；也可将 `DATABASE_DRIVER` 改为 `postgres` 连接指定 PostgreSQL。

前端支持热更新。修改后端后需重启开发命令；连接真实 PostgreSQL 时也可单独运行 `npm run dev:watch -w @autovoyage/api`。Windows/OneDrive 下不建议对持久化 PGlite 使用强制重启监视，以免数据库未正常关闭。

仅本地演示环境会显示演示账号。默认邮箱 `owner@autovoyage.demo`、`store@autovoyage.demo`、`expert@autovoyage.demo`、`admin@autovoyage.demo`，分别对应车主、门店、专家和平台。初次种子的密码由 `DEMO_PASSWORD` 设置；修改环境变量不会自动重置已存在账号。示例密码仅用于本地开发，不能沿用于公网部署。

## 行驶证识别怎么使用

1. 新车：车主首页 → **添加爱车 → 行驶证识别建档**。已有车辆：**我的服务 → 车辆档案 → 上传行驶证并识别**。
2. 选择行驶证正页照片（JPEG / PNG / WebP，最大 8 MB），明确同意发送至已配置的 AI 服务后上传。
3. 核对车牌、车辆类型、所有人、使用性质、品牌型号、VIN、发动机号码、注册日期、发证日期，可逐项修改。
4. 新车需另选平台已有的准确保养车型，填写昵称、车辆启用日期与启用时里程；勾选核对确认后保存。

上传与识别不会直接修改车辆；行驶证不提供当前里程，不替代仪表里程更新。已有车辆补证须与原车牌匹配，保留原车型和里程基准。照片与证件字段仅本人可见，本流程不提取住址字段；原图仍可能含住址，上传前可自行遮挡无关信息。详细步骤与失败处理见 [操作手册](docs/user-guide.md)。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动本地前端与 API |
| `npm run typecheck` | 全项目 TypeScript 检查 |
| `npm test` | 后端回归，使用隔离数据和合成 AI 响应；具体项数以当次输出为准 |
| `npm run build` | 构建 API 和 Web 生产产物 |
| `npm run check` | 依次执行类型检查、测试与构建；GitHub Actions 同样执行 |
| `npm run test:postgres` | 7 项真实 PostgreSQL 交易联调，只操作新建的临时 schema |

行驶证的 6 项真实 PostgreSQL 测试启用方式见 [六人协作与验收](docs/development.md)。真实 AI 请求与真实 PostgreSQL 验证不属于默认 CI 的外部依赖；CI 通过不代表真实照片准确率或公网部署已通过验收。

`npm run build` 会将本次源码版本嵌入 API；仅构建不会写入系统更新日志。源码或 `release.config.json` 变化后，应重新构建并部署 API 与 Web，启动成功后自动登记。完整发布流程见 [系统更新日志](docs/system-releases.md) 与 [部署说明](docs/deployment.md)。

## 接入真实服务

- PostgreSQL：在未跟踪的 `.env` 填写 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`，设 `DATABASE_DRIVER=postgres`。开发联调使用预先创建的 `PGSCHEMA=av_development`，与公共预览使用的 public schema 分开。应用只维护指定 schema 内 `av_` 前缀的自有表，不清空原数据库。真实 PostgreSQL 事务验证命令为 `npm run test:postgres`，只使用其新建的临时 `av_test_*` schema。
- 图片识别：填写 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`。通过 `AI_API_STYLE=responses` 接入 Responses 视觉服务，或保留默认 `chat_completions` 兼容原接口；`AI_BASE_URL` 填 API 根地址（通常以 `/v1` 结尾），请求超时由 `AI_TIMEOUT_MS` 设置（默认 90000 毫秒，范围 1000–180000）。未配置时会保存受控上传并明确报告识别不可用，不生成候选里程。
- 地图：`MAP_PROVIDER=osm` 使用 MapLibre GL 与 OpenFreeMap 提供的 OpenStreetMap 矢量底图，无需 Key，保留地图署名。浏览器需要 WebGL 和对地图样式、字体、瓦片的网络访问；加载失败可重试并继续使用门店列表。中国大陆正式接入可配置 `MAP_PROVIDER=amap` 和高德 `AMAP_WEB_KEY`、`AMAP_SECURITY_CODE`，按服务商要求配置实际访问来源与额度。
- 部署：本阶段按用户选择先不用域名，使用 `compose.preview.yml` 提供 58083 端口的 HTTP 课程预览；部署是否完成以验证记录为准。`compose.yml` 保留为以后复用 Nginx Proxy Manager 的 HTTPS 方案。公共 IP 的 HTTP 预览不能代替要求安全上下文的浏览器定位及 HTTPS 安全会话验收；无定位时仍可手选搜索中心。

`.env`、私人上传图片、数据库文件、密钥及服务器账号不会进入 Git。V0.3 移除车型照片资源，保留 [历史图片署名](docs/image-attribution.md)。演示车型、手册周期、门店、价格与记录明确标识，不能用作真实车辆的保养依据。

## 项目结构

```text
apps/api/                     Node.js API、数据库、业务规则与测试
apps/web/                     React 车主端与管理端
packages/shared/              共享类型与金额/状态显示
design-system/autovoyage/      设计规范、语义样式变量、页面规范
deploy/                       Dockerfile、Nginx 配置
release.config.json           发布版本、标题与人工功能说明
scripts/release-manifest.mjs   可用于无 Git 源码包的版本摘要生成器
compose.yml                   复用既有数据库与代理网络的部署配置
compose.preview.yml           无域名的 IP + 58083 HTTP 课程预览配置
docs/                         接口、部署、分工与验收记录
```

## 业务约束

预约将本人车辆校验、价格版本/有效期检查、时段余量、车辆时间冲突、名额占用和价格快照放在同一事务，重复请求具有用户级幂等语义。取消、拒绝和超时关闭只释放一次名额。费用变更必须先经车主同意，完工确认只更新实际完成的保养项目。

图片中的值在车主核对、质量校验成功后才成为有效观测。失败、旧图、重复图、未来日期或里程回退不会静默覆盖有效记录。故障预估与固定总价明确区分，地图中的演示门店不代表真实商家。

部署步骤见 [部署说明](docs/deployment.md)，六人协作建议见 [开发与验收](docs/development.md)，接口见 [API](docs/api.md)。实际已验证内容与尚待接入项在 [验证记录](docs/verification.md) 中记录。
