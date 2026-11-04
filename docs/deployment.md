# 云程 · 京东云 Docker 部署

## 当前部署选择

V0.8.2 版本 `0.8.2+9a7ec56f24` 已完成开发与验证：86项回归、20项真实PostgreSQL手册专项、单图真实AI自动填写和手机界面验收通过。本轮包含尚未上线的V0.8.1近年车型配置及筛选，并简化手册图片导入、增加PDF自动选页；不新增表、环境变量或端口。Portainer目前显示登录页，待恢复会话后上传API／Web源码包并更新既有Stack；公网仍为下述V0.8。实际提交与发布归档结果见 [验证记录](verification.md)。

本轮发布前只读备份22张自有表、177行，仅存本机忽略目录。继续保留API的1 GiB内存、17项私有环境变量、上传卷、数据库和IP端口配置。回滚目标为当前已上线API／Web `f54b479`；不要以删除表、卷或重新播种实现回滚。V0.8.1没有实际成功启动，不为其补造上线日志；新版成功启动时仅自动登记V0.8.2。

2026-11-04 V0.8 已上线：API `autovoyage-api:f54b479`（`efb0fad507e7`）、Web `autovoyage-web:f54b479`（`68d102c05a64`），两个容器均为 `healthy`。运行版本 **`0.8.0+29b4f13741`**，公网首页资源 `index-BBHz0E6d.js`。继续采用 Portainer 上传无秘密源码归档构建；同一源码的 Windows 工作区、无 `.git` 归档和 Linux API 镜像版本摘要已核对一致。

本轮仅替换两个镜像标签，17 项环境变量逐项一致，保留原端口、网络、数据库与上传卷；不新增环境变量或公网端口。发布前只读备份 21 张自有表、161 行。API 增量创建 `av_releases` 表和时间索引，成功启动后自动记录首次上线时间 `2026-11-04T08:20:12.345Z`（北京时间16:20:12）。现有车型／项目／规则仍为2／4／5条，实际配置候选从镜像中的固定快照读取。

平台车型库已包含29,181条年款／动力／配置候选；登录后页脚可查看“系统更新日志”。本次首条记录已在公网界面与 PostgreSQL 只读查询中核对，详见 [更新日志机制](system-releases.md) 和 [验证记录](verification.md)。以后更新需要重建 API 以嵌入整个应用的源码版本；可编辑 `release.config.json` 维护具体变更说明，未编辑时也会自动生成变更模块摘要。

V0.8回滚可同时恢复 API／Web `eaa2e48`，保留新增日志表和已有数据、上传卷；旧版本尚无更新日志界面。回滚不执行删除表或重新初始化。曾由V0.8记录的相同构建重新启动时复用原记录，不修改首次上线时间。

V0.7 历史记录：API `autovoyage-api:eaa2e48`（`cca4cfb42d36`）、Web `autovoyage-web:eaa2e48`（`0fe660764c88`）通过 Portainer 上传源码归档构建并更新既有 Stack，两个容器当时均为 `healthy`。本轮仅替换两个镜像标签，17 项环境变量逐项核对一致，保留网络、上传卷、数据库及 IP + 58083 端口。发布前只读备份 21 张自有表、161 行；该轮目录无需新表、环境变量或端口。

公网首页资源为 `index-Du_BOjgT.js`，车型和服务项目候选从 API 镜像中的固定快照读取。MIT 原始许可随镜像保存在 `/app/licenses/Cars_Data-LICENSE.txt`。公开界面已验证筛选、搜索、来源与项目多选；真实导入写入在隔离测试库完成。回滚可同时恢复 API／Web `c72209c`，新实体的可选来源字段与旧版兼容，保留既有数据和上传卷。详见 [验证记录](verification.md)。

V0.6 历史记录：API `autovoyage-api:c72209c`（`198281c2f9e2`）、Web `autovoyage-web:c72209c`（`cf9cecd31d5d`）当时均为 `healthy`。API 内存限额由 512 MiB 提高为 1 GiB，`AI_TIMEOUT_MS` 由 90000 调整为 180000；其余 16 项环境变量与端口、网络、数据库、上传卷经表单逐项比较保持原值。发布前只读备份了本项目 20 张表、160 行，备份仅存本机忽略目录。

公网入口仍为 [http://117.72.124.241:58083/](http://117.72.124.241:58083/)。新版首页资源为 `index-0qpJTtpB.js`，平台管理员可进入“保养手册与规则 → 手册导入”。CarOBook 查询无可确认候选时会显示实际结果及官方补充入口；网盘分享仍须先取得原文件再上传。真实官方 PDF 与 AI 验证、上线健康结果见 [验证记录](verification.md)。回滚镜像为 API `autovoyage-api:2e6107d`、Web `autovoyage-web:4392486`；保留新建任务表和上传卷，不删除数据。

V0.5 历史记录：2026-11-04 已通过 Portainer 更新现有 `autovoyage` Stack：Web 为 `autovoyage-web:4392486`（镜像 `efe15b2f9e9a`），API 继续使用 `autovoyage-api:2e6107d`（`7c2b6466d918`），两个容器均为 `healthy`。本次仅修改 Web 镜像标签，保留全部环境变量、网络、上传卷、数据库与端口。回滚可恢复 Web `autovoyage-web:44d5c73`。

公网 `/`、`/healthz`、`/api/v1/health` 均返回 200；首页资源为 `index-Dgarqdbp.js`，主／小车图均返回 200、`image/webp`，分别为 69,370 与 31,214 字节。真实浏览器确认银白概念跑车渲染图与素材来源链接，原两辆车及海豹 1,680 km 保持；375×812 首页 `clientWidth=scrollWidth=360`，车辆图片完整加载。公网手机地图回归为 `ready`，3 枚门店图标正常，点击匠心汽车服务图标后对应标记选中。当前 [首页截图](images/owner-dashboard.png) 已更新为 V0.5；[门店地图截图](images/store-map.png) 保留 V0.4，本轮门店视觉未变。详细验收范围见 [验证记录](verification.md)。

V0.4 历史部署记录：Web `autovoyage-web:44d5c73`（`80a24e6e9a61`），API `autovoyage-api:2e6107d`（`7c2b6466d918`），两个容器当时均为 `healthy`。该轮首页资源为 `index-DQmqT46I.js`，同源 Worker 返回 200、`application/javascript`、517,225 字节；公网确认 Cybertruck 灵感 SVG、海洋蓝主题、三枚服务站图标、真实底图与选店联动，375×812 首页与门店页均无横向溢出。该轮回滚目标为 `a0a690c`，完整历史证据保留在验证记录。

用户已选择本阶段先不用域名，采用 **IP + 58083 端口的 HTTP 课程预览**，配置文件为 `compose.preview.yml`。2026-11-03 已部署到 Portainer 的 `autovoyage` Stack，实际入口为 [http://117.72.124.241:58083/](http://117.72.124.241:58083/)。主页、`/healthz`、`/api/v1/health` 与 `/api/v1/config` 均返回 HTTP 200；API 报告使用 PostgreSQL，AI 已配置。Portainer 中 `autovoyage-api-1` 与 `autovoyage-web-1` 均为 `healthy`。

`compose.yml` 保留为以后接入域名和有效证书的 HTTPS 方案。两份配置是互斥的部署方式，使用同一个 Stack 名称，不要同时启动。

2026-11-03 的只读环境检查确认服务器已有 Portainer、PostgreSQL 和 Nginx Proxy Manager。数据库网络为 `postgresql_default`，代理网络为 `nginx-proxy-manager_default`；现有代理入口为 HTTP 58080 / HTTPS 58082，管理入口为 58081。云程使用独立 `autovoyage` Stack 与上传卷，不替换现有服务。

V0.3 历史部署记录：2026-11-04 当时更新 Web 为 `autovoyage-web:a0a690c`（镜像 `1b6874bea1e2`）；API 保留 `autovoyage-api:2e6107d`（`7c2b6466d918`），两个容器均为 `healthy`。该轮发布前端插画、数字车库和矢量地图，保留原有 17 个私有环境变量、网络、上传持久卷与数据库。主页、两项健康检查和同源 Worker 均返回 200；Worker 为 `application/javascript`、517,225 字节。公网浏览器确认真实道路和门店标记、选店、显隐后重新加载及手机布局。实际证据见 [验证记录](verification.md)。

服务器直接获取 GitHub 仓库曾出现 `unexpected EOF`，因此使用 Portainer 上传无秘密源码归档构建镜像，再以本地镜像更新既有 Stack。旧版 Web `autovoyage-web:2e6107d`（`9b3f2680a42d`）保留用于回滚；当前前端与同一 API 兼容。后续文档提交不自动改变应用镜像。

以下为 V0.2 历史记录：当时主页、健康检查、API 配置与两张车型 WebP 图片均返回 HTTP 200；V0.3 已删除车型照片，改为插画。行驶证识别入口沿用。旧版首页与容器健康截图保存在本机忽略目录 `.local/screenshots/cloud-v02-owner-desktop.jpg`、`.local/screenshots/cloud-v02-stack-health.jpg`。

公网行驶证上传已通过真实 AI 服务完成虚构样本识别，九个字段进入人工核对页，未提交建档确认；原有两辆车辆及里程保持原值，待确认任务可从车辆档案继续查看。375×812 视口的新版首页和车辆档案无横向溢出，两张车型图加载完成，临时视口已恢复。该验证证明流程接通，真实证件的模糊、反光和多版式准确率仍需另行采样。

## 数据与配置隔离

| 用途 | 数据位置 | 规则 |
| --- | --- | --- |
| 离线本地开发 | `.local` 下的 PGlite | 默认本地开发方式；不连接公共业务表 |
| 真实 PostgreSQL 开发联调 | `mem_car_info.av_development`，通过 `PGSCHEMA=av_development` 选择 | 使用单独的开发 schema，不能将本地演示种子写入公共预览 schema |
| PostgreSQL 集成测试 | 新建随机 `av_test_*` schema | `npm run test:postgres` 创建测试 schema，结束后清理该 schema；不使用 public 业务数据 |
| 公共课程预览 | `mem_car_info.public` 中的 `av_` 自有表 | 由明确的一次性初始化流程准备，日常容器不自动重复播种 |

开发 schema 需由具备相应权限的账号事先创建。当前两份 Compose 使用公共预览的默认 `public` schema；API 不删除原数据库，不操作其他项目的表。初始化与迁移前应备份本项目已有数据。

仓库中的 `.env.example` 用于本地配置参考，不可整份原样用于公网。数据库密码、视觉密钥、随机会话密钥和账号口令只保存在未跟踪的配置或受控环境变量中，不放入 YAML、Git 或验收截图。

## IP + HTTP 预览

`compose.preview.yml` 将 Web 容器的 8080 映射到宿主机 **58083**。API 在独立应用网络提供 3001，数据库通过既有 Docker 网络提供 5432；不增加 API 或数据库的公网映射。

必要配置：

- `APP_ORIGIN=http://117.72.124.241:58083`，必须与浏览器实际协议、IP、端口完全一致。
- `APP_PORT=58083`；`PGHOST_INTERNAL=postgresql`；数据库网络可用 `DATABASE_NETWORK` 覆盖。
- 填写 `PGDATABASE`、`PGUSER`、`PGPASSWORD` 和至少 32 字符的随机 `SESSION_SECRET`。
- Compose 明确设置 `NODE_ENV=production`、`ALLOW_HTTP_PREVIEW=true`，并关闭 `DEMO_MODE` 与 `SEED_DEMO`。这是显式的课程 HTTP 预览模式，不是 HTTPS 部署。

在 Portainer 的 local 环境新建或更新 `autovoyage` Stack，选择 Git repository，指定仓库与已经验证的分支或标签，**Compose path 填 `compose.preview.yml`**，然后填写对应环境变量。需要服务器可访问 GitHub、npm 与容器镜像源。

如果服务器无法稳定拉取 GitHub，可使用本次验证通过的源码上传方式：

1. 从确定的 Git 提交导出跟踪文件，为 API、Web 分别准备根目录含对应 `Dockerfile` 的源码归档；除无秘密的 `.env.example` 模板外，检查归档不包含实际 `.env` 配置、`.local`、口令、照片或数据库文件。
2. 在 Portainer 的 Images → Build a new image → Upload 上传归档，分别构建带提交号的 API 与 Web 镜像。服务器仍需访问 Docker 镜像源与 npm。
3. 从 `compose.preview.yml` 生成上传配置，将两个服务的 `build` 替换为已构建的镜像 `image`，保留网络、持久卷、健康检查和环境变量。在 Stacks 中上传该配置并部署 `autovoyage`。
4. 导入环境变量后，逐项核对 Portainer 表单的实际值再部署。本次 Portainer 的 env 上传会保留值两侧的引号，因此专用导入文件使用不带外围引号的字面值；不能直接上传使用 JSON 引号的 dotenv 文件。不要在日志或截图中展示实际秘密值。

本次共配置 17 个私有环境变量，已核对表单值与本地配置一致。源码归档及上传 Compose 保存在本机忽略目录中；公共仓库保留通用部署配置。

也可在已有源码及 Docker Compose 的服务器执行：

```bash
docker compose -f compose.preview.yml --env-file /安全位置/autovoyage.env build
docker compose -f compose.preview.yml --env-file /安全位置/autovoyage.env up -d
docker compose -f compose.preview.yml --env-file /安全位置/autovoyage.env ps
```

云安全组和宿主机防火墙只需按实际环境放行该预览使用的 TCP 58083。2026-11-03 已核对京东云实例 `lavm-y76noe3tj0` 的公网 IP 与目标一致，防火墙已有 TCP 58083、来源 `0.0.0.0/0`、备注 `AutoVoyage` 的规则；本次未新增或修改防火墙规则，公网访问已成功。已有数据库连通不需要为了前端再次放行 5432，也不应额外发布 3001。

API 健康检查为 `/api/v1/health`，Web 为 `/healthz`。API 健康后 Web 才启动。上传文件放在独立持久卷，正常重建容器保留图片。

HTTP IP 预览可以验证网页、登录、普通文件选择上传和核心业务流程。浏览器定位通常要求安全上下文，公共 IP 的 HTTP 地址不能作为定位能力已验收的依据；手机文件输入的拍照入口还取决于具体浏览器。该模式不提供 HTTPS 传输保障，后续切换 HTTPS 后须重新验收安全会话、定位与真机兼容。

V0.1/V0.2 历史公网验收还包括车主登录、375 像素宽度的首页与门店页、预约弹窗、合成仪表图真实 AI 识别。旧地图当时显示三家演示店和六张可见瓦片；当前地图结果以 V0.5 回归记录为准。预约预览显示 ¥80 制动检查及按时间排序的时段，未提交公共预约，也未确认合成图候选里程。

## 一次性初始化

根目录提供 `npm run initialize:server`，其用途是明确初始化公共预览所需的自有表、课程演示数据及账号；它不是每次启动前都运行的命令。该脚本会写入 public 中本项目的数据，应在目标与备份确认后执行。

初始化脚本在本机生成未跟踪的 `.env.server`，新建账号的独立随机口令另存本机受控文件，不打印实际口令到日志。已有账号保持原口令，修改环境变量不会重置现有账号。日常服务器容器保持种子关闭。

本次公共预览已完成一次性初始化，四类演示账号使用各自独立随机口令，访问资料仅保存在本机未跟踪的 `.local/server-access.md`。无需为正常启动再次初始化。云端车主、门店管理员账号已完成实际登录验证，车主退出登录后回到登录页。

## 以后切换 HTTPS

具备可用域名、DNS 与有效证书后，改用 `compose.yml`。该配置不新增宿主机 Web 端口，代理通过共享网络访问 `http://autovoyage-web:8080`。

Nginx Proxy Manager 的 Proxy Host 指向上述服务并启用匹配域名的有效证书。设置实际 HTTPS `APP_ORIGIN`，如复用现有入口则包含 `:58082`；关闭 HTTP 预览例外。若改用标准 443/80，先确认现有端口占用，再配置所需安全组规则。

```bash
docker compose -f compose.yml --env-file /安全位置/autovoyage.env build
docker compose -f compose.yml --env-file /安全位置/autovoyage.env up -d
docker compose -f compose.yml --env-file /安全位置/autovoyage.env ps
```

浏览器证书错误须通过配置有效证书解决，不能将绕过证书提示记作 HTTPS 验收成功。

## 真实 AI、地图与保养资料

- **图片识别**：填写 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`，`AI_BASE_URL` 填 API 根地址（通常以 `/v1` 结尾），通过 `AI_API_STYLE=responses` 使用 Responses 视觉接口，默认 `chat_completions` 保持原接口兼容；`AI_TIMEOUT_MS` 默认 90000 毫秒，允许 1000–180000。两份 Compose 均透传该配置，密钥仅留在后端。未配置时，真实上传会保留受控图片并显示识别不可用，不能生成伪造候选值或有效里程。配置后仍须用真实截图和仪表照片验证“上传—识别—车主核对—入库”，记录字段修正、失败和单位兼容结果。
- **地图**：`MAP_PROVIDER=osm` 使用 MapLibre GL + OpenFreeMap 的 OpenStreetMap 矢量底图，无需新增 Key。浏览器直接加载公开样式、字体与瓦片；MapLibre Worker 随 Web 构建为同源 `/assets/*.js`，部署必须保留完整 `dist/assets`。地图保留自动署名，支持加载超时、失败提示与重试。需具备 WebGL，并实测目标网络。中国大陆正式接入仍可配置高德 `MAP_PROVIDER=amap`、`AMAP_WEB_KEY`、`AMAP_SECURITY_CODE`，按服务商要求设置来源、权限与额度。
- **保养规则**：演示车型、周期、门店与价格均保留演示标识。实际车型需按年款及动力配置明确适用保养项目，并记录、人工复核官方手册来源。纯电车型不能从全局项目自动获得发动机机油保养要求；未知适用范围或未核验规则应提示资料待补充。

## 备份与回滚

发布前记录 Git 提交、镜像与配置版本，备份公共预览 schema 中本项目的数据及上传卷。回滚时使用上一验证提交重建 Stack，保留 PostgreSQL 与上传卷，不以删除数据库或卷实现回滚。涉及模型变化时先验证前后版本兼容性。

部署后应检查登录退出、角色与归属隔离、预约提交与取消、价格版本、费用及项目变更确认、完工归档、原图访问控制和消息。部署、端口、证书及第三方服务的最终状态由 [验证记录](verification.md) 回填，不以本文的操作步骤替代验收结果。
