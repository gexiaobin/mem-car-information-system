# 云程 AutoVoyage

中国海洋大学 MEM《软件工程管理》课程项目：汽车信息管理系统。

React + TypeScript 车主 H5 / 管理 Web，Node.js + Fastify 统一 API，PostgreSQL 持久化。采用原创 SVG 汽车插画、深蓝数字车库与浅色信息面板，覆盖行驶证识别建档、车辆档案、保养提醒、门店比价预约、故障咨询与服务记录。

课程预览已部署：[打开云程](http://117.72.124.241:58083/)。车主、门店、专家和平台账号的独立口令保存在部署者本机受控文件中，不提供公开通用密码。实际验收范围见 [验证记录](docs/verification.md)。

![云程车主首页：原创汽车插画、数字车库与养护计划](docs/images/owner-dashboard.png)

截图使用课程演示车辆。V0.3 全部车型展示使用通用汽车插画，外观仅为示意；历史素材许可见 [图片来源](docs/image-attribution.md)。

## 功能与当前进度

| 使用角色 | 主要功能 |
| --- | --- |
| 车主 | 多车档案、行驶证识别与人工核对、仪表里程识别、分项目保养提醒、门店查询与比价预约、故障咨询、消息及服务记录 |
| 门店管理员 | 本店资料、服务报价与版本、时段名额、预约接单及服务进度、项目与费用变更、专家分配 |
| 门店专家 | 分配范围内的故障资料、补充信息、建议与费用预估 |
| 平台管理员 | 标准项目、车型保养规则与资料来源、门店审核及审计记录 |

V0.2 已部署实拍图改版与行驶证识别，线上应用镜像对应代码提交 `2e6107d`。后续文档提交不触发 Portainer 自动发布。完整代码检查通过，包含 27 项后端测试、类型检查和前后端构建；行驶证另完成 6 项真实 PostgreSQL 测试与云端真实 AI 合成样本识别。测试口径、截图和未验收项见 [验证记录](docs/verification.md)。

课程数据包括演示车型、规则、门店、价格与记录；当前车型目录包含迈腾和海豹。真实车型手册、真实证件准确率、手机真机兼容性和压力测试仍需独立验证。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [操作手册](docs/user-guide.md) | 登录、车辆建档、行驶证上传、里程更新、预约与课程演示步骤 |
| [系统架构](docs/architecture.md) | 前后端、数据模型、权限、事务、AI 与 Docker 网络 |
| [配置说明](docs/configuration.md) | 本地 / PostgreSQL / AI / 地图 / 服务器环境变量及常见问题 |
| [API 接口](docs/api.md) | 路由、权限、请求示例、行驶证字段与状态 |
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
| `npm test` | 27 项后端回归，使用隔离数据和合成 AI 响应 |
| `npm run build` | 构建 API 和 Web 生产产物 |
| `npm run check` | 依次执行类型检查、测试与构建；GitHub Actions 同样执行 |
| `npm run test:postgres` | 7 项真实 PostgreSQL 交易联调，只操作新建的临时 schema |

行驶证的 6 项真实 PostgreSQL 测试启用方式见 [六人协作与验收](docs/development.md)。真实 AI 请求与真实 PostgreSQL 验证不属于默认 CI 的外部依赖；CI 通过不代表真实照片准确率或公网部署已通过验收。

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
compose.yml                   复用既有数据库与代理网络的部署配置
compose.preview.yml           无域名的 IP + 58083 HTTP 课程预览配置
docs/                         接口、部署、分工与验收记录
```

## 业务约束

预约将本人车辆校验、价格版本/有效期检查、时段余量、车辆时间冲突、名额占用和价格快照放在同一事务，重复请求具有用户级幂等语义。取消、拒绝和超时关闭只释放一次名额。费用变更必须先经车主同意，完工确认只更新实际完成的保养项目。

图片中的值在车主核对、质量校验成功后才成为有效观测。失败、旧图、重复图、未来日期或里程回退不会静默覆盖有效记录。故障预估与固定总价明确区分，地图中的演示门店不代表真实商家。

部署步骤见 [部署说明](docs/deployment.md)，六人协作建议见 [开发与验收](docs/development.md)，接口见 [API](docs/api.md)。实际已验证内容与尚待接入项在 [验证记录](docs/verification.md) 中记录。
