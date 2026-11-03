# 云程 · 京东云 Docker 部署

## 当前部署选择

用户已选择本阶段先不用域名，采用 **IP + 58083 端口的 HTTP 课程预览**，配置文件为 `compose.preview.yml`。2026-11-03 已部署到 Portainer 的 `autovoyage` Stack，实际入口为 [http://117.72.124.241:58083/](http://117.72.124.241:58083/)。主页、`/healthz`、`/api/v1/health` 与 `/api/v1/config` 均返回 HTTP 200；API 报告使用 PostgreSQL，AI 已配置。Portainer 中 `autovoyage-api-1` 与 `autovoyage-web-1` 均为 `healthy`。

`compose.yml` 保留为以后接入域名和有效证书的 HTTPS 方案。两份配置是互斥的部署方式，使用同一个 Stack 名称，不要同时启动。

2026-11-03 的只读环境检查确认服务器已有 Portainer、PostgreSQL 和 Nginx Proxy Manager。数据库网络为 `postgresql_default`，代理网络为 `nginx-proxy-manager_default`；现有代理入口为 HTTP 58080 / HTTPS 58082，管理入口为 58081。云程使用独立 `autovoyage` Stack 与上传卷，不替换现有服务。

当前运行代码为 Git 提交 `592bd51`，镜像为 `autovoyage-api:592bd51`（`b861f8507150`）与 `autovoyage-web:592bd51`（`46456228a9e1`）。之后的文档提交不改变这两个应用镜像。服务器直接获取 GitHub 仓库时出现 `unexpected EOF`，本次通过 Portainer 上传源码归档构建镜像，再上传引用本地镜像的 Compose 完成部署；过程见下文。

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

本次公网浏览器验收已完成车主登录、375 像素宽度的首页与门店列表 / 地图、预约弹窗和合成仪表图的真实 AI 识别。门店页显示三家演示店，六张可见地图瓦片均加载成功；预约预览显示 ¥80 制动检查及按时间排序的可选时段。未提交公共预约，也未确认合成图的候选里程。验收后已恢复临时视口设置，详细证据与限制见 [验证记录](verification.md)。

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
- **地图**：本地提供带署名的 OpenStreetMap 真实底图；其在目标网络的可达性与服务使用条件需单独核查。中国大陆正式接入可配置高德 `MAP_PROVIDER=amap`、`AMAP_WEB_KEY`、`AMAP_SECURITY_CODE`，按服务商要求配置实际访问来源、调用权限与额度；当前采用 IP 并不等于 Key 已获允许。地图失败时列表可用，不代表正常地图功能已经通过验收。
- **保养规则**：演示车型、周期、门店与价格均保留演示标识。实际车型需按年款及动力配置明确适用保养项目，并记录、人工复核官方手册来源。纯电车型不能从全局项目自动获得发动机机油保养要求；未知适用范围或未核验规则应提示资料待补充。

## 备份与回滚

发布前记录 Git 提交、镜像与配置版本，备份公共预览 schema 中本项目的数据及上传卷。回滚时使用上一验证提交重建 Stack，保留 PostgreSQL 与上传卷，不以删除数据库或卷实现回滚。涉及模型变化时先验证前后版本兼容性。

部署后应检查登录退出、角色与归属隔离、预约提交与取消、价格版本、费用及项目变更确认、完工归档、原图访问控制和消息。部署、端口、证书及第三方服务的最终状态由 [验证记录](verification.md) 回填，不以本文的操作步骤替代验收结果。
