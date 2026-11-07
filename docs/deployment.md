# 云程 · 京东云 Docker 部署

## 当前部署选择

V0.9.4 **`0.9.4+98079fdcf4` 于2026-11-07北京时间23:11:42上线**，首次成功启动 `2026-11-07T15:11:42.029Z`，发布源码为 `243540a6b73e237b3e711f1e30af9cf40249b8ad`。本版稳定读取广汽丰田官方用户手册目录，按年款、车系及动力匹配实际PDF，并对多页保养表逐页整理后合并；检索受阻或无关结果与确实未找到资料分别提示。实际适用范围、原文证据及未完整提取的后续周期仍须核对，操作见 [手册导入](manual-import.md)。

通过已登录Portainer更新原 `autovoyage` Stack：API `autovoyage-api:243540a`（`a891035e0bb6`）、Web `autovoyage-web:243540a`（`418de8cec972`）均healthy。17项私有环境变量逐项一致，Compose仅替换两个镜像标签；数据库、上传卷、网络、API 1 GiB及IP + 58083端口沿用。回滚目标为API `autovoyage-api:e9a9b35`（`39c1353c5621`）和Web `autovoyage-web:e9a9b35`（`0ecc8c9a392a`），保留业务库与持久卷，不重新初始化或播种。

部署前只读备份public的22张自有表、442行（含会话），仅保存于本机忽略目录。上线后20张业务／审计表内容逐值相同，旧10条发布记录保留，仅新增本版1条，共11条；6车型、27项启用标准项目、12规则、1条真实保养记录、17文件、5份手册任务及报价／版本各9条保留，未导入或发布查询样本。

全新公网AI查询完成后，于 `2026-11-07T15:21:47.352Z` 再次只读核验：20张业务／审计表仍与部署前基线逐值一致，11条发布记录保留，四条公网路径均HTTP200且版本正确；Portainer两容器均healthy，[容器健康截图](images/manual-v094-stack-cloud.png)已归档。

公网 `/`、`/healthz`、`/api/v1/health`、`/api/v1/config` 均HTTP200，API报告本节精确版本及 `postgres`，`demoMode=false`。发布源码的[main Actions](https://github.com/gexiaobin/mem-car-information-system/actions/runs/42384673557)与[开发分支Actions](https://github.com/gexiaobin/mem-car-information-system/actions/runs/42384673450)均success。全新公网AI查询已完成，真实读取2024款汉兰达汽油版2405版官方PDF并返回103项候选、32项原文说明／待核对事项，界面显示“已读取手册·部分要求待核对”；版本及范围已带出，具体配置仍待核对，未逐项审核全部候选，未导入或发布。[公网结果截图](images/manual-v094-result-cloud.png)与完整部署、保留数据核验见 [V0.9.4验证记录](verification.md#v094-官方手册稳定发现与逐页整理2026-11-07上线)。本地十页真实AI调用及91项响应重放结果保留为独立历史记录；Windows PDF容量实验仅作本地参考，不保证Linux 1 GiB容器的内存表现。

## V0.9.3 历史部署

V0.9.3 **`0.9.3+5907628593` 于2026-11-07北京时间21:48:35上线**，首次成功启动 `2026-11-07T13:48:35.015Z`，发布源码为 `e9a9b35ee7b9a12117673b402f5c13bfdb6a9c0a`。本版支持时间、公里或先到者提醒，完整显示条件阈值，车主端展示到期日期与上海自然日倒计时；旧警告或明确时间的资料按严格原文动态兼容，未批量改写旧规则。操作及适用边界见 [手册导入](manual-import.md)。

最终通过已登录Portainer更新原 `autovoyage` Stack：API `autovoyage-api:e9a9b35`（`39c1353c5621`）、Web `autovoyage-web:e9a9b35`（`0ecc8c9a392a`）均healthy。17项私有环境变量逐项一致，Compose仅替换两个镜像标签；数据库、上传卷、网络、API 1 GiB及IP + 58083端口沿用。回滚目标为API `autovoyage-api:b082863`（`60ba961fb835`）和Web `autovoyage-web:b082863`（`39ec37b86f2f`），保留业务库与持久卷，不重新初始化或播种。

首次部署源码 `bd38795` 的API因共享包作为外部依赖而无法由原生Node加载 `src/manual-draft.js`，未成功启动，也未新增发布日志；当时已回滚至健康的V0.9.2，并严格核对20张业务／审计表及9条旧发布记录完整。修复后将共享运行时代码内联入API，构建时检查workspace依赖不得外置，并在每次构建中以无种子的独立PGlite执行原生Node产物启动检查。Windows本地及Linux镜像构建均通过，最终完整检查167项测试及类型／构建通过后，才以本节最终源码重新部署。

最终部署前于 `2026-11-07T13:48:08.828Z` 只读备份public的22张自有表、439行（含会话），仅存本机忽略目录。上线后20张业务／审计表逐对象完全一致，旧9条发布记录保留，仅新增本版1条，共10条。基线及上线后均为项目27项全部启用、12规则、5车型、2辆车、报价及版本各9、保养记录1、手册5、文件17、审计239、消息7；升级未新增这些业务项目或发布正式手册。会话单独变化，不把会话或新版本登记算作业务资料改动。

公网 `/`、`/healthz`、`/api/v1/health`、`/api/v1/config` 均HTTP200，精确版本与本节一致，首页资源为 `assets/index-SLSutwvp.js`；发布源码在[main](https://github.com/gexiaobin/mem-car-information-system/actions/runs/42378270323)与[开发分支](https://github.com/gexiaobin/mem-car-information-system/actions/runs/42378270167)的Actions均success。实际数据库、产物启动及界面核验范围见 [验证记录](verification.md)。

公网证据：[条件项目月份与公里](images/maintenance-v093-time-fields-cloud.png)、[车型时间规则](images/maintenance-v093-rules-cloud.png)、[本版更新日志](images/maintenance-v093-updates-cloud.png)、[两容器健康](images/maintenance-v093-stack-cloud.png)。

## V0.9.2 历史部署

V0.9.2 **`0.9.2+3e822546b3` 于2026-11-07北京时间20:41:55上线**，首次成功启动时间为 `2026-11-07T12:41:55.925Z`，发布源码为 `b082863e102087d3f81df7c31fc9785be2426f65`。本版补充独立机油／机滤参考项目，分别显示原文证据、标准项目关联及本次选择；旧待核对草稿可以直接重新关联，不重跑AI。目录为27项候选，正式业务项目不会因升级自动增加，具体操作和限制见 [手册导入](manual-import.md)。

通过已登录Portainer更新原 `autovoyage` Stack：API镜像为 `autovoyage-api:b082863`（`60ba961fb835`），Web镜像为 `autovoyage-web:b082863`（`39ec37b86f2f`），两容器均healthy。17项私有环境变量逐项完全一致，Compose仅替换两个镜像标签；沿用数据库、上传卷、网络、API 1 GiB内存限制及IP + 58083端口。回滚目标为API `autovoyage-api:038166f`（`d447f4520630`）及Web `autovoyage-web:038166f`（`713837a79e2a`），保留业务库及持久卷，不重新初始化或播种。

部署前于 `2026-11-07T12:34:51.868Z` 只读备份public的22张自有表、422行（包含会话），仅保存于本机忽略目录。部署完成后，除会话与发布记录外，20张业务／审计表与备份逐对象完全一致；旧8条发布记录保留，自动新增本版1条，共9条。

随后在正式浏览器只对2025款思域的29行待核对草稿点击一次“重新自动关联标准项目”：关联数5→7，增加独立机油／机滤的两处参考关联；原文6／12个月、condition及include=false保持，仍22行待处理，没有发布规则。该草稿revision由1变为2，更新时间更新，并新增1条 `manual.projects.matched` 审计；额外只读比对确认其余数据完全一致。最终正式项目25项全部启用、0项停用，车型5、规则7、车辆2、报价9、报价版本9、保养记录1、手册4、文件14、审计235及消息7。升级及这次重新关联均未创建正式服务项目，也未运行精简或清空重建CLI。

公网 `/`、`/healthz`、`/api/v1/health`、`/api/v1/config` 均HTTP200，精确版本与本版一致，首页资源为 `assets/index-CqoN6mAg.js`。发布源码的[main检查](https://github.com/gexiaobin/mem-car-information-system/actions/runs/42373092256)与[开发分支检查](https://github.com/gexiaobin/mem-car-information-system/actions/runs/42373092242)均success。公网证据：[机油／机滤关联结果](images/manual-v092-matching-cloud.png)、[本版更新日志](images/manual-v092-updates-cloud.png)、[两容器健康](images/manual-v092-stack-cloud.png)；本地、真实PostgreSQL与正式数据核对范围见 [验证记录](verification.md)。

## V0.9.1 历史部署

V0.9.1 **`0.9.1+b493fefab7` 于2026-11-07北京时间19:34:30上线**，首次成功启动时间为 `2026-11-07T11:34:30.268Z`，发布源码为 `038166f9ab6a81b8797c9af2bc98344b09c0ccdc`。本版AI查找直接读取取得的真实手册原文并展示原文链接、适用说明和保养周期表，已整理结果可直接带入人工核对，无需再次下载或识别；目录及网盘入口不等于已取得手册。具体操作和适用性边界见 [手册导入](manual-import.md)。

通过已登录Portainer更新原 `autovoyage` Stack：API镜像为 `autovoyage-api:038166f`（`d447f4520630`），Web镜像为 `autovoyage-web:038166f`（`713837a79e2a`），两容器均healthy。17项私有环境变量逐项完全一致，Compose只替换两个镜像标签；保留既有数据库、上传卷、网络、API 1 GiB内存限制及IP + 58083访问。镜像回滚目标为API／Web `fbc7d48`，回滚时保留业务库及持久卷，不重新初始化或播种。

部署前于 `2026-11-07T11:33:36.208Z` 只读备份public的22张自有表、415行（包含会话），备份仅保存在本机忽略目录。上线后20张业务／审计表逐对象与备份一致，旧7条发布记录保留并自动新增本版1条，共8条。服务项目25项全部启用、0项停用；车型5、规则7、车辆2、报价9、历史报价版本9、保养记录1、手册任务3、文件11、管理员审计233及消息7均保持。未向正式库导入测试资料。

公网 `/`、`/healthz`、`/api/v1/health`、`/api/v1/config` 均HTTP200，数据库为PostgreSQL，运行版本与本版一致；首页资源为 `assets/index-DMUGEOnd.js`。发布源码的[GitHub Actions检查](https://github.com/gexiaobin/mem-car-information-system/actions/runs/42368627423)在main与开发分支均为success。

正式公网浏览器已对当前选择的2025款思域汽油1.5T CVT执行真实AI查询，取得2份可阅读的官方资料入口：`by_page30.html`保养表与`4d/`同册首页。页面展示29个项目的首次／后续周期、条件、原文摘录、真实来源和“带入核对29项”按钮。原文适用范围为2025款三厢汽油版，但未明确到所选排量、功率及CVT配置，页面保留适用性核对提示；不能将两个同册入口记作两本独立手册。本轮只查询，未带入核对、未导入或发布正式规则。已归档 [官方资料与查询概况](images/manual-v091-manuals-cloud.png)、[AI保养周期表](images/manual-v091-answer-cloud.png)、[自动更新日志](images/manual-v091-updates-cloud.png) 和 [容器健康](images/manual-v091-stack-cloud.png)；完整核验见 [验证记录](verification.md)。

## V0.9.0 历史部署

V0.9.0 **`0.9.0+88ff2b9bb5` 于2026-11-07北京时间16:39:16上线**，源码提交 `fbc7d489a3c8124ae1e2dbc445a050074c2b8bef` 已同步 `main` 与 `codex/autovoyage-mvp`。保养工作区改为AI查找／图片识别两入口，资料和规则围绕当前车型，AI预填可选信息，核对后一次保存发布。开放搜索不局限固定网站，资料适用性仍需核对；操作及实际验证范围见 [手册导入](manual-import.md) 和 [验证记录](verification.md)。

通过已登录Portainer UI上传已扫描的源码归档构建API `autovoyage-api:fbc7d48`（`25da20552ed8`）、Web `autovoyage-web:fbc7d48`（`0d1e510e1698`），两容器均healthy。归档与本地构建的源码摘要一致，未包含实际秘密值、私密配置或上传文件；17项环境变量逐项一致，Compose只替换两个镜像标签，数据库、上传卷、网络、API 1 GiB内存与IP + 58083访问沿用。镜像回滚目标为API／Web `1d05966`，保留业务库和持久卷。

部署前于 `2026-11-07T08:30:07.110Z` 只读备份public的22张自有表、414行（包含会话），仅保存在本机忽略目录。部署后除会话外逐对象核验：20张业务／审计表完整一致，原6条发布记录保留、自动新增本版1条及4项说明。项目25项全部启用、0项停用；车型5、规则7、车辆2、报价及历史版本各9、保养记录1、手册任务3、文件11、管理员审计233及消息7完整保留。本轮未重新初始化或播种，也未向正式库导入测试资料。

公网四个首页／健康／配置路径均HTTP200，数据库PostgreSQL、版本一致，首页资源为 `assets/index-BrkrjZ3z.js`。浏览器确认两入口、雅阁4条规则、从海豹车型档案直达其1条规则、已有发布手册可查看。公网雅阁AI查询成功返回5份具体候选和3个目录，未下载、识别或发布这些候选；复杂旧年款网页在本地隔离验证，耗时与适用性边界另记。已归档 [导入入口](images/manual-v090-entry-cloud.png)、[图片入口](images/manual-v090-image-entry-cloud.png)、[开放查询](images/manual-v090-search-cloud.png)、[当前车型规则](images/manual-v090-rules-cloud.png)、[容器健康](images/manual-v090-stack-cloud.png) 和 [自动更新日志](images/manual-v090-updates-cloud.png)。

## V0.8.6 与通用目录重建历史

2026-11-07北京时间15:40完成一次**纯数据维护**：按用户要求清空旧123个标准服务项目，重建25项通用项目，全部启用、0项停用；额外清理已获批准的2条演示规则、12条演示报价及12条历史版本。可等价引用迁移，5个车型、2辆车、3份手册、11个文件和1条保养记录保留，2行检查草稿解除映射并保留原文。执行前在 `2026-11-07T07:38:32.571Z` 备份22张自有表、535行，仅保存于忽略路径 `.local/backups/autovoyage-public-2026-11-07T07-38-32-571Z.json`。正式事务报告为applied；最终线上复核见 [验证记录](verification.md#通用服务目录清空重建2026-11-07已执行)。

本次无需重新构建或更新Portainer，运行镜像仍为API `autovoyage-api:1d05966`、Web `autovoyage-web:1d05966`，版本仍为 `0.8.6+1fecfe24f9`。不增加软件发布日志；数据维护记入管理员操作日志。以下V0.8.6部署时的30启用／93停用为历史验收，已由本次重建替代。清空后的资料不能从“已停用”中恢复，应依据维护前备份和原始快照恢复关联数据，回滚镜像不能恢复已清空的项目。

V0.8.6 **`0.8.6+1fecfe24f9` 于2026-11-07北京时间15:11:54上线**，源码提交 `1d05966d3784a3910171966f74f943f93c57afcc` 已推送 `main` 与 `codex/autovoyage-mvp`。参考库收敛为25项通用服务；项目列表默认只看启用，支持已停用／全部筛选与编辑恢复。112项完整回归、类型检查和两端生产构建通过，真实PostgreSQL目录／手册专项32项、精简执行器专项5项通过，随机测试schema已清理。

通过Portainer UI上传两份已扫描源码包构建：API `autovoyage-api:1d05966`（`7e7e8570cfc7`）、Web `autovoyage-web:1d05966`（`50d7d32f2c83`）均healthy。归档、工作区和API构建版本摘要一致，未打包实际秘密值、私密路径或上传资料。17项环境变量逐项一致；Compose只替换两个镜像标签，沿用原数据库、上传卷、网络、API 1 GiB内存和IP + 58083端口。镜像回滚目标为API／Web `4d7ee2c`；项目启用状态可在管理端恢复，回滚镜像不会自动恢复这些状态。

部署前于 `2026-11-07T07:11:35.731Z` 只读备份22张自有表、440行，仅存本机忽略目录。升级后、精简前，各业务表均与本次备份相同。随后在 `PGSCHEMA=public` 执行精简CLI，核对dry-run摘要后事务停用93项：123项总量不变，启用123→30，停用0→93。保留23个通用来源项目、5个原有自定义项目及2个被手册草稿引用的细分检查项目。仅候选的 `active` 从true改为false并新增93条管理员审计；其余字段和18张其他业务表与备份逐项摘要一致，旧日志完整保留。重新预览可停用数为0。完整快照、预览和执行报告保存在本机 `.local`，恢复步骤见 [公开目录](public-catalog.md#精简已有服务目录)。

公网 `/`、`/healthz`、`/api/v1/health`、`/api/v1/config`均200，数据库PostgreSQL，首页资源 `assets/index-kOx15K8-.js`。自动新增1条V0.8.6更新记录、4条说明，旧5条记录完整保留。公网列表验证启用30／已停用93／全部123，制动系统筛选3项；参考库25项。已查看停用项编辑框的恢复开关，未保存额外业务变更。[精简列表](images/common-service-simplified-cloud.png)、[通用库](images/common-service-general-catalog-cloud.png)、[更新日志](images/common-service-simplified-updates-cloud.png) 已归档。

## V0.8.5 历史部署

V0.8.5 **`0.8.5+2be7c67710` 于2026-11-05北京时间19:20:30上线**，源码提交 `4d7ee2c33c2fb170ebfbb8edec93f8ef92a98021` 已推送 `main` 与 `codex/autovoyage-mvp`。本版补全120项通用参考服务，支持批量选择、安全复用及冲突报告。106项完整回归、类型检查及两端生产构建通过，真实PostgreSQL／PGlite目录与手册映射专项各31项通过。

通过Portainer UI上传两份无秘密源码包构建，API `autovoyage-api:4d7ee2c`（`53cac7c07b1a`）、Web `autovoyage-web:4d7ee2c`（`afa6e95ab58d`）均healthy。工作区、归档与API构建版本摘要一致；归档检查没有实际敏感配置值、私密路径或上传数据。17项环境变量一致，Compose只替换两个镜像标签，数据库网络、上传卷、API 1 GiB内存和IP + 58083端口保持。回滚同时恢复API／Web `7f4785b`，保留业务数据。

部署前于 `2026-11-05T11:17:56.666Z` 只读备份22张自有表、198行，仅存本机忽略目录。部署完成、补项之前9张业务表摘要与备份相同；之后通过正式平台参考库选择118项，实际新增116、复用1、跳过1，标准项目7→123。旧7项逐项摘要相同，全部新增项均为本版目录的来源模板；车型4、规则9、车辆2、报价21、历史报价21、服务记录1、手册任务2、文件10均保持摘要不变。现有“火花塞”操作未明确，“更换火花塞”保留待核对，没有覆盖或合并原有项目，也没有生成车型周期或门店报价。

公网 `/`、`/healthz`、`/api/v1/health`、`/api/v1/config`均200，数据库PostgreSQL，首页资源 `assets/index-Ckcdpt1D.js`。自动新增1条V0.8.5日志、4条说明，首次启动 `2026-11-05T11:20:30.974Z`，旧4条日志完整保留。公网分类筛选制动系统为12／123项，表格12行；[补入结果](images/common-service-import-cloud.png)、[分类列表](images/common-service-projects-cloud.png)、[自动更新日志](images/common-service-updates-cloud.png) 已归档。

## V0.8.4 历史部署

V0.8.4 运行版本 **`0.8.4+22d57176e5` 已于2026-11-05北京时间18:43:50上线**，新增手册草稿批量首保、标准项目关联、车型引用保护删除、规则定位及AI公开候选查询。发布前完整类型检查、101／101项测试及API／Web生产构建通过，真实PostgreSQL和PGlite新增专项各8项通过。真实公开检索与当前AI排序完成，但凯美瑞隔离实样仅返回目录入口，没有定位具体手册。

发布源码提交为 `7f4785b9193a794cb88422a769407f980b59ca46`，已同步至GitHub的 `main` 和 `codex/autovoyage-mvp`。通过Portainer UI上传无秘密源码包构建并更新既有Stack；API镜像为 `autovoyage-api:7f4785b`（`7b3652989da6`），Web为 `autovoyage-web:7f4785b`（`18a52a573f46`），两个容器均healthy。构建包摘要与上述版本一致，检查未包含私密配置、上传数据或实际配置的敏感值。17项环境变量与预期完全一致，Compose仅替换两个镜像标签，保留数据库、上传卷、网络、API 1 GiB内存及IP + 58083端口；回滚目标为API／Web `1d8f978`。

本次发布前备份时间为 `2026-11-05T10:39:12.659Z`，22张自有表、197行，仅存本机忽略目录。部署后车型／项目／规则／车辆／报价／服务记录为4／7／9／2／21／1条，历史报价21、手册任务2、文件10条；部署及公网只读验收后9表摘要均与本次备份完全一致，未重新播种或改写业务资料。API仅新增1条V0.8.4日志、4条功能说明，首次上线为 `2026-11-05T10:43:50.305Z`，原3条日志完整保留。公网四个健康／配置路径均返回200，首页资源为 `assets/index-D1LhhdwQ.js`；[车型规则筛选](images/manual-model-rules-cloud.png)、[AI查询](images/manual-ai-search-cloud.png) 和 [更新日志](images/manual-tools-cloud-updates.png) 公网截图已归档。

公网AI查询已显示整理完成，返回真实凯美瑞双擎候选及2个目录；所选档案为2018款汽油2.0E，候选并未确认年款和动力适用性。本次仅验证查询与提示，没有下载、导入或发布资料。

## V0.8.3 历史部署

V0.8.3构建版本 **`0.8.3+2a620a9098` 已于2026-11-05北京时间16:02:03上线**。源码提交 `1d8f978`，修复车型维护的复选框／文字布局；本地类型检查、86项测试及两端构建通过。API／Web运行镜像为 `autovoyage-api:1d8f978`（`76878b242df8`）与 `autovoyage-web:1d8f978`（`3d00a160e91d`），两个容器均healthy。公网 `/`、`/healthz`、`/api/v1/health`、`/api/v1/config`均返回200，健康接口版本一致，数据库为PostgreSQL。

本次发布前备份时间为 `2026-11-05T07:57:47.766Z`，共22张自有表、184行，仅保存在本机忽略目录。17项环境变量逐项一致，Compose仅替换两个镜像标签，保留API 1 GiB内存、数据库、上传卷、网络和IP + 58083端口。回滚目标为API／Web `4aee802`；保留业务数据和上传卷。

发布后车型／项目／规则／车辆／报价／服务记录为4／6／5／2／21／1条，逐表摘要与本次备份相同。API仅新增1条V0.8.3更新日志、2条功能说明，首次上线 `2026-11-05T08:02:03.151Z`；原2条记录保留。[公网车型维护截图](images/model-maintenance-fixed.png) 已归档，验收时仅查看，未修改或保存业务资料。手机断点仅完成静态审查，未将本轮记录为手机实测通过。

## V0.8.2 历史部署

V0.8.2 版本 **`0.8.2+8f8553a803` 已于2026-11-05北京时间15:39:19上线**。发布前86项回归、20项真实PostgreSQL手册专项、单图真实AI自动填写和手机界面验收通过。本版一并上线V0.8.1近年车型配置及筛选，简化手册图片导入、增加PDF自动选页；不新增表、环境变量或端口。公网入口为 [http://117.72.124.241:58083/](http://117.72.124.241:58083/)，首页资源为 `index-52aZx-vn.js`。实际提交与验收见 [验证记录](verification.md)。

本轮发布前于2026-11-05只读备份22张自有表、176行，仅存本机忽略目录。17项私有环境变量逐项一致，保留API的1 GiB内存、上传卷、网络、数据库和IP端口配置；Compose只替换两个镜像标签。车型／项目／规则／车辆／报价／服务记录分别为3／6／5／2／21／1条，发布后与本轮备份逐表摘要一致。回滚目标为上一版API／Web `f54b479`；不要以删除表、卷或重新播种实现回滚。

发布源码提交为 `4aee802`。两个归档与工作区版本摘要一致，不含实际秘密配置或上传数据；已通过Portainer的Images → Build image → Upload分别构建，再更新原 `autovoyage` Stack。API使用 `autovoyage-api:4aee802`（镜像ID `b8461a638547`），Web使用 `autovoyage-web:4aee802`（镜像ID `df1625e0f3b4`）；运行镜像详情与构建ID一致，两个容器均为 `healthy`。`/`、`/healthz`、`/api/v1/health`、`/api/v1/config`均返回200，数据库驱动为PostgreSQL。

API成功启动后仅新增一条V0.8.2记录，首次上线时间为 `2026-11-05T07:39:19.563Z`，包含4条功能说明；原V0.8.0记录保留。V0.8.1未单独上线，不补造该版日志。[公网图片入口](images/manual-quick-cloud.png) 与 [更新日志截图](images/manual-quick-cloud-updates.png) 已归档。仅修改文档不会改变构建版本，也不需要重新部署。

2026-11-04 V0.8 历史部署：API `autovoyage-api:f54b479`（`efb0fad507e7`）、Web `autovoyage-web:f54b479`（`68d102c05a64`），两个容器均为 `healthy`。运行版本 **`0.8.0+29b4f13741`**，公网首页资源 `index-BBHz0E6d.js`。继续采用 Portainer 上传无秘密源码归档构建；同一源码的 Windows 工作区、无 `.git` 归档和 Linux API 镜像版本摘要已核对一致。

该次V0.8发布仅替换两个镜像标签，17 项环境变量逐项一致，保留原端口、网络、数据库与上传卷；不新增环境变量或公网端口。发布前只读备份 21 张自有表、161 行。API 增量创建 `av_releases` 表和时间索引，成功启动后自动记录首次上线时间 `2026-11-04T08:20:12.345Z`（北京时间16:20:12）。该次发布验收的车型／项目／规则为2／4／5条，实际配置候选从镜像中的固定快照读取。

V0.8当时的平台车型库包含29,181条年款／动力／配置候选；登录后页脚可查看“系统更新日志”。其首条记录已在公网界面与 PostgreSQL 只读查询中核对，详见 [更新日志机制](system-releases.md) 和 [验证记录](verification.md)。以后更新需要重建 API 以嵌入整个应用的源码版本；可编辑 `release.config.json` 维护具体变更说明，未编辑时也会自动生成变更模块摘要。

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
