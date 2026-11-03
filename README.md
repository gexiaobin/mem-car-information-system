# 云程 AutoVoyage

中国海洋大学 MEM《软件工程管理》课程项目：汽车信息管理系统。

React + TypeScript 车主 H5 / 管理 Web，Node.js 统一 API，PostgreSQL 持久化。采用海洋蓝的统一设计系统，覆盖车辆档案、保养提醒、门店比价预约、故障咨询与服务记录。

## 本地运行

需要 Node.js 22+（推荐 24）和 npm。

```bash
npm ci
# 首次运行：复制 .env.example 为 .env，再填写自己的配置。
npm run dev
```

打开 http://localhost:5173 。前端通过 Vite 代理访问 API，后端默认监听本地 3001。开发默认使用 PGlite（本地运行的 PostgreSQL 引擎，数据保存到 .local），无需安装数据库；也可将 `DATABASE_DRIVER` 改为 `postgres` 连接指定 PostgreSQL。

前端支持热更新。修改后端后需重启开发命令；连接真实 PostgreSQL 时也可单独运行 `npm run dev:watch -w @autovoyage/api`。Windows/OneDrive 下不建议对持久化 PGlite 使用强制重启监视，以免数据库未正常关闭。

仅本地演示环境会显示演示账号。默认邮箱 `owner@autovoyage.demo`、`store@autovoyage.demo`、`expert@autovoyage.demo`、`admin@autovoyage.demo`，分别对应车主、门店、专家和平台。初次种子的密码由 `DEMO_PASSWORD` 设置；修改环境变量不会自动重置已存在账号。示例密码仅用于本地开发，不能沿用于公网部署。

```bash
npm run typecheck
npm test
npm run build
# 或一次运行以上检查
npm run check
```

## 接入真实服务

- PostgreSQL：在未跟踪的 `.env` 填写 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`，设 `DATABASE_DRIVER=postgres`。开发联调使用预先创建的 `PGSCHEMA=av_development`，与公共预览使用的 public schema 分开。应用只维护指定 schema 内 `av_` 前缀的自有表，不清空原数据库。真实 PostgreSQL 事务验证命令为 `npm run test:postgres`，只使用其新建的临时 `av_test_*` schema。
- 图片识别：填写 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`。通过 `AI_API_STYLE=responses` 接入 Responses 视觉服务，或保留默认 `chat_completions` 兼容原接口；`AI_BASE_URL` 填 API 根地址（通常以 `/v1` 结尾），请求超时由 `AI_TIMEOUT_MS` 设置（默认 90000 毫秒，范围 1000–180000）。未配置时会保存受控上传并明确报告识别不可用，不生成候选里程。
- 地图：本地支持带署名的 OpenStreetMap 真底图，其在目标网络的可达性需实测；中国大陆正式接入可配置 `MAP_PROVIDER=amap` 和高德 `AMAP_WEB_KEY`、`AMAP_SECURITY_CODE`。须按服务商要求配置实际访问来源与额度，不能假设 IP 预览已经满足 Key 限制。
- 部署：本阶段按用户选择先不用域名，使用 `compose.preview.yml` 提供 58083 端口的 HTTP 课程预览；部署是否完成以验证记录为准。`compose.yml` 保留为以后复用 Nginx Proxy Manager 的 HTTPS 方案。公共 IP 的 HTTP 预览不能代替要求安全上下文的浏览器定位及 HTTPS 安全会话验收；无定位时仍可手选搜索中心。

`.env`、图片、数据库文件、密钥及服务器账号不会进入 Git。演示车型、手册周期、门店、价格与记录明确标识，不能用作真实车辆的保养依据。

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
