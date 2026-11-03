# 云程 · 配置说明

从项目根目录的 `.env.example` 复制为 `.env`，再按本地或服务器用途填写。应用读取根目录 `.env`；Docker Compose 使用部署者提供的环境变量。实际 `.env`、服务器导入文件、账号口令均不进入 Git。

## 三种数据环境

| 用途 | 关键配置 | 数据位置 |
| --- | --- | --- |
| 本地体验 | `NODE_ENV=development`、`DATABASE_DRIVER=pglite`、`DEMO_MODE=true`、`SEED_DEMO=true` | 项目 `.local/postgres`，上传在 `.local/uploads` |
| 真实数据库开发 | `DATABASE_DRIVER=postgres`，填写 `PG*`，设置 `PGSCHEMA=av_development` | 提前创建的独立开发 schema |
| 云端课程预览 | `NODE_ENV=production`、`DATABASE_DRIVER=postgres`、`DEMO_MODE=false`、`SEED_DEMO=false` | public 中本项目 `av_` 表；持久上传卷 |

本地 PGlite 无需连接服务器数据库。真实 PostgreSQL 使用 `Asia/Shanghai` 时区和 `UTF8` 编码。应用启动会建立缺失的自有表与索引，不自动创建开发 schema；数据库账号需要相应 schema 权限。公共预览数据不能用作本地种子或集成测试数据。

## 应用与账号

| 变量 | 默认 / 示例 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 服务器设为 `production`，启用生产校验 |
| `HOST` / `PORT` | `127.0.0.1` / `3001` | API 监听；容器内为 `0.0.0.0:3001` |
| `APP_ORIGIN` | `http://localhost:5173` | 浏览器实际来源，必须精确匹配协议、IP / 域名与端口 |
| `TZ` | `Asia/Shanghai` | 业务时间显示使用上海时区 |
| `SESSION_SECRET` | 自行生成 ≥32 字符随机值 | 会话相关秘密；生产校验拒绝明显的开发占位值 |
| `DEMO_MODE` | 本地 `true` | 本地演示入口；生产必须 `false` |
| `SEED_DEMO` | 本地 `true` | 本地种子；日常服务器必须 `false` |
| `DEMO_PASSWORD` | 自行设置，至少 12 字符 | 本地初次演示账号密码；改配置不会重置已有账号 |
| `UPLOAD_DIR` | `.local/uploads` | 根目录下的本地上传路径；容器使用 `/app/data/uploads` |
| `ALLOW_HTTP_PREVIEW` | 默认关闭 | 本阶段课程 IP + HTTP 预览显式开启；有效 HTTPS 部署关闭 |

可以在终端运行下列命令生成本地会话随机值，再将结果填入自己的配置文件。不要把实际值粘贴进 GitHub 文档或 Issue。

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

## PostgreSQL

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `DATABASE_DRIVER` | `pglite` / `postgres` | 生产只允许 PostgreSQL |
| `PGLITE_PATH` | `.local/postgres` | 本地数据目录，相对项目根目录解析 |
| `PGHOST` / `PGPORT` | 本地可达地址 / `5432` | 本机运行 API 时使用实际可达地址 |
| `PGDATABASE` / `PGUSER` | `mem_car_info` / `mem_car_app` | 数据库与专用应用账号 |
| `PGPASSWORD` | 自行填写 | 生产必填，不在仓库提供 |
| `PGSSL` | `false` / `true` | 设为 `true` 时验证服务器证书，按数据库实际 TLS 配置选择 |
| `PGSCHEMA` | `public`，开发用 `av_development` | 小写 SQL 标识符；开发 schema 需提前建立 |

仓库的两份 Compose 使用公共预览的 public schema，没有透传 `PGSCHEMA`。容器中的 `PGHOST` 由 `PGHOST_INTERNAL` 提供，默认 `postgresql`，并加入既有 `postgresql_default` 网络；这是 Docker 网络内的服务名，与本机配置的公网地址用途不同。

真实交易测试 `npm run test:postgres` 和可选行驶证 PostgreSQL 测试会新建随机 `av_test_*` schema，完成后清理该临时 schema；需要创建 schema 的权限。完整命令见 [开发与验收](development.md)。

## AI 图片识别

行驶证与仪表图片共用后端视觉服务配置，密钥只放在 API 端。使用自己授权的服务，不在仓库记录个人 Codex 配置或真实访问密钥。

| 变量 | 示例 / 取值 | 说明 |
| --- | --- | --- |
| `AI_BASE_URL` | `https://provider.example/v1` | API 根地址，不追加 `/responses` 或 `/chat/completions` |
| `AI_API_KEY` | 服务商密钥 | 后端使用，不进入前端源码 |
| `AI_MODEL` | 服务商实际支持的视觉模型名 | 必须支持图片输入与结构化文本输出 |
| `AI_API_STYLE` | `responses` / `chat_completions` | 默认 `chat_completions`，按服务商协议选择 |
| `AI_TIMEOUT_MS` | 默认 `90000` | 整数毫秒，范围 `1000–180000` |

保存后重启 API；容器部署须更新 Stack。登录后上传合成图片，检查是否进入核对页；仅 `/api/v1/config` 返回 `aiConfigured=true` 不能证明上游可达或识别正确。未配置、拒绝、超时、不完整输出会保留失败状态，可按界面更换照片或有限重试，不生成有效里程或车辆档案。

## 地图

默认 `MAP_PROVIDER=osm`，显示带署名的 OpenStreetMap 底图；网络可达性需实测。改用高德时设置 `MAP_PROVIDER=amap`、`AMAP_WEB_KEY`、`AMAP_SECURITY_CODE`，并在服务商控制台按实际访问来源配置权限与额度。

地图 Web Key 和配套前端安全配置会通过公开配置提供给浏览器，应使用服务商规定的来源限制；AI 密钥与数据库密码不在该公开接口中返回。公共 IP 的 HTTP 地址通常不能使用浏览器定位，仍可手选搜索中心；定位验收应在有效 HTTPS 环境完成。

## Docker / Portainer 补充变量

| 变量 | 本阶段值 / 默认 | 说明 |
| --- | --- | --- |
| `APP_ORIGIN` | `http://117.72.124.241:58083` | 本阶段用户确定的预览来源 |
| `APP_PORT` | `58083` | `compose.preview.yml` 的 Web 宿主端口 |
| `PGHOST_INTERNAL` | `postgresql` | 既有数据库容器的网络名称 |
| `DATABASE_NETWORK` | `postgresql_default` | 既有数据库 Docker 网络 |
| `PROXY_NETWORK` | `nginx-proxy-manager_default` | 仅 HTTPS 方案使用的既有代理网络 |

Portainer 环境变量导入文件使用不带外围引号的字面值；本项目生成的 `.env.server` 是 dotenv 配置，两者不要未经核对直接混用。生产部署、一次性账号初始化、升级和回滚的具体步骤见 [部署说明](deployment.md)。`npm run initialize:server` 会写入公共预览数据，不是每次启动都运行的命令。

## 常见启动问题

| 表现 | 检查与处理 |
| --- | --- |
| 会话密钥或种子密码校验失败 | 检查长度、环境与占位值；生产保持种子及演示入口关闭 |
| 数据库连接失败 / schema 不存在 | 区分公网地址与 Docker 服务名；核对密码、TLS、网络和 schema 权限 |
| 写操作提示来源不匹配 | 将 `APP_ORIGIN` 改为浏览器地址栏中的精确来源，重启 API |
| 修改后端后页面仍旧 | 普通 `npm run dev` 不监视重启后端；重启该命令，或按 README 使用后端 watch |
| 图片识别失败 | 核对协议、模型是否支持图片、根地址、超时和上游额度；查看界面原因后再重试 |
| 数据库目录被占用 | 同一本地持久 PGlite 目录只运行一个 API 进程，正常结束原进程后再启动 |
| GitHub 更新后线上仍旧 | 当前 Portainer 按提交号构建本地镜像，未配置自动发布；按部署文档更新镜像与 Stack |
