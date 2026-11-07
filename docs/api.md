# 云程 API

统一前缀 `/api/v1`，JSON 直接返回资源；错误形如 `{ "error": { "code": "...", "message": "..." } }`。登录使用 HttpOnly 会话 Cookie，写入校验请求来源。身份和资源归属由服务端判断，前端隐藏按钮不代替鉴权。共享字段定义见 `packages/shared/src/index.ts`。

| 资源 | 方法与路径 | 用途 |
| --- | --- | --- |
| 健康/配置 | `GET /health`、`GET /config` | 数据库就绪、公开功能配置 |
| 系统更新 | `GET /releases` | 已登录角色查看当前运行版本及分页更新日志 |
| 身份 | `GET /auth/me`、`POST /auth/login`、`POST /auth/logout` | 查询会话、登录、撤销会话 |
| 注销 | `DELETE /auth/account` | 注销本人账号并撤销会话，保留必要业务审计 |
| 页面数据 | `GET /bootstrap` | 按角色、本人/本店筛选的页面数据 |
| 车辆 | `POST /vehicles`、`PATCH /vehicles/:id`、`GET /vehicles/:id/history` | 建档、维护与历史 |
| 图片 | `POST /files`、`GET /files/:id` | Multipart 上传与受控访问 |
| 识别任务 | `POST /vehicles/:id/imports`、`GET /imports/:id` | 上传并查询持久化任务 |
| 识别处理 | `POST /imports/:id/retry`、`POST /imports/:id/confirm` | 有限重试、核对与质量校验 |
| 行驶证识别 | `POST /registration-imports`、`GET /registration-imports`、`GET /registration-imports/:id` | 本人上传、查询任务与私人证件档案 |
| 行驶证确认 | `POST /registration-imports/:id/retry`、`POST /registration-imports/:id/confirm` | 有限重试、核对后关联已有车辆或新建档案 |
| 预约 | `POST /appointments`、`POST /appointments/:id/action` | 幂等预约与受约束状态转换 |
| 增项 | `POST /appointments/:id/changes`、`POST /changes/:id/decision` | 门店提出、车主确认 |
| 报修 | `POST /faults`、`POST /faults/:id/reply` | 本人提交、本店专家建议/预估 |
| 报修确认 | `POST /faults/:id/confirm`、`POST /faults/:id/supplement` | 确认范围、补充资料 |
| 分配 | `POST /admin/faults/:id/assign` | 门店分配本店专家 |
| 消息 | `POST /messages/:id/read`、`POST /messages/read-all` | 本人已读状态 |
| 门店服务 | `POST /admin/offers`、`POST /admin/offers/:id/version`、`PATCH /admin/offers/:id` | 创建、发布新价版本、上下架 |
| 名额 | `POST /admin/slots`、`PATCH /admin/slots/:id` | 时段与容量，不得小于已占用数 |
| 标准项目 | `POST /admin/projects`、`PATCH /admin/projects/:id` | 平台维护 |
| 车型档案 | `POST /admin/models`、`PATCH /admin/models/:id`、`DELETE /admin/models/:id` | 平台维护；仅未被引用的车型可删除 |
| 车型手册 | `POST /admin/rules`、`PATCH /admin/rules/:id` | 来源、版本、适用范围与复核 |
| 手册来源 | `GET /admin/manual-sources?modelId=...&discover=true` | 平台管理员按品牌／车系开放查询公开资料及官方补充入口；不传 discover 时仅返回入口 |
| AI手册直接回答 | `POST /admin/manual-imports/ai-answer`、`GET /admin/manual-imports/ai-answer/:id` | 异步获取并读取真实手册，直接返回原文链接与保养项目表 |
| 使用AI手册回答 | `POST /admin/manual-imports/from-ai-answer` | 复用缓存原文和结果，建立待核对草稿，不重新识别或直接发布 |
| 旧AI手册查询 | `POST /admin/manual-imports/ai-search` | 兼容原候选排序接口，新工作区使用直接回答 |
| 手册导入 | `POST /admin/manual-imports`、`POST /admin/manual-imports/from-url` | 平台上传 PDF／图片，或获取公开手册文件及保养网页证据 |
| 手册任务 | `GET /admin/manual-imports`、`GET /admin/manual-imports/:id`、`POST /admin/manual-imports/:id/retry` | 平台查询持久任务和有限重试 |
| 手册审核发布 | `PATCH /admin/manual-imports/:id/draft`、`POST /admin/manual-imports/:id/publish` | 可单独保存草稿；也可一次提交当前draft并原子发布，集中返回待核对问题 |
| 手册项目关联 | `POST /admin/manual-imports/:id/auto-map` | 为空白映射匹配已有或参考项目，保留人工选择 |
| 手册证据 | `GET /manual-files/:id` | 平台读取；匹配本人车辆车型的车主读取已发布证据 |
| 已发布手册 | `GET /manuals/:id` | 平台或拥有匹配车型的车主读取已发布手册及证据文件元数据 |
| 门店 | `POST /admin/stores`、`PATCH /admin/stores/:id` | 本店资料、平台审核 |

## 系统更新日志

`GET /releases?offset=0&limit=20` 对四种已登录角色开放，匿名返回 401。`offset` 是 0–100000 的整数，`limit` 是 1–50 的整数，默认分别为 0 与 20。返回共享类型 `SystemReleasesResponse`：

| 字段 | 类型与含义 |
| --- | --- |
| `currentVersion` | 当前运行构建的版本字符串，如 `0.8.0+0123456789`（格式示例） |
| `currentReleaseId` | 当前运行构建的稳定 ID；与历史条目的 `id` 匹配以标记当前版本 |
| `items` | `SystemRelease[]`，按首次上线时间从新到旧分页 |
| `total`、`offset`、`limit` | 历史总条数、本次偏移与每页大小 |

`SystemRelease` 包含 `id`、`version`、`title`、`changes: string[]`、`deployedAt` 和 `revision: string | null`。`deployedAt` 是该构建首次成功启动监听时记录的 ISO 时间，页面按北京时间显示；`revision` 为构建时可取得的 Git 提交 ID，无 `.git` 的源码包为 `null`。接口不返回内部模块摘要，不暴露配置或 Git 提交消息。

查询不会创建或修改日志。回滚后 `currentVersion/currentReleaseId` 来自正在运行的构建，可能对应列表中的较早条目；不会把最新历史记录当成当前版本。`GET /config`、`GET /health` 和 `bootstrap.config.version` 使用同一构建版本。自动写入失败时健康接口返回 503、错误码 `RELEASE_RECORD_FAILED`，标准服务入口停止启动。构建、记录时机和说明维护见 [系统更新日志](system-releases.md)。

创建预约示例：

```json
{
  "vehicleId": "本人的车辆ID",
  "offerIds": ["选中服务ID"],
  "slotId": "时段ID",
  "expectedVersions": { "选中服务ID": 1 },
  "requestId": "客户端为本次意图生成的UUID"
}
```

一次意图的网络重试沿用 requestId；更改车辆、服务或时段后生成新的标识。服务端对同一用户请求标识建立唯一性，内容不同则返回冲突。固定报价快照包含材料、工时、其他费用、范围、税费口径和版本。

视觉适配通过 `AI_API_STYLE` 选择 `responses` 或默认的 `chat_completions`；Responses 请求关闭服务端保存，使用图片输入与 JSON 文本输出，只接受已完成且无拒绝的响应。两种协议均经过相同的字段校验与人工确认，模型接口错误或不完整输出不能自动生成有效观测。

识别确认必须提供明确总里程、单位与数据时间。未配置视觉服务、无可识别里程或读取失败的任务不会伪造候选值和有效观测。上传体积、文件格式、当前任务状态、车辆归属和原图关联均由服务端校验。

## 保养手册识别与车型规则

本节关于 `conditionThresholdsIndependent`、完整周期编辑及时间提醒的新增契约已在V0.9.3上线，当前运行 `0.9.3+5907628593`；实际部署与验收见 [验证记录](verification.md)。

本组接口仅平台管理员可写入。上传与识别产生持久草稿，不直接改变车型适用项目或车主保养计划。文件、证据页、来源、版次、适用范围和人工确认随任务保留；具体操作、来源限制与字段语义见 [手册导入说明](manual-import.md)。

`GET /admin/manual-sources?modelId=...` 只返回来源入口，不发外部请求；显式附加 `discover=true` 才按品牌／车系开放查询通用保养手册和周期表，返回具体候选和补充目录，不局限固定网站。候选仍需核对年款、动力和市场版本；查询结果不是文件已下载或已适用的证明。

V0.9.1起工作区使用异步直接回答。`POST /admin/manual-imports/ai-answer` 接收严格JSON `{ "modelId": "准确车型ID", "consent": true }`，仅平台管理员可用，初次返回202及任务；同用户、同车型身份的有效缓存可返回200。任务字段为 `id,modelId,status,message,createdAt,updatedAt`，通过 `GET /admin/manual-imports/ai-answer/:id` 轮询；阶段为 `searching → reading → organizing → completed`，异常为 `failed`。排队只运行一个读取／AI任务，最多3个未完成任务，每分钟最多4次创建请求。

完成任务附带 `result`：`query,sources,summary,warnings,aiStatus,searchedAt,evidenceMode`，其中 `evidenceMode=document_reading`；`answer` 含 `status=ready|partial|not_found`、`title,summary,applicability,edition,sourceTitle,sourceUrl,manuals,rows,warnings`。`manuals` 只包含实际读取的资料，`rows` 使用既有 `ManualRuleDraft` 结构。下载失败、只有目录、AI失败或没有有效项目都不生成周期；已读取的原文链接在AI失败时仍可查看。实际HTML表格在提取文本前保留空列和合并表头，避免打点错列。来源限定不是由自定义AI凭空联网决定，服务端先真实检索／获取字节，再把证据交给模型。

已上线的V0.9.2新增可选的只读 `mappingDiagnostics`：可出现在 `ManualImport.mappingDiagnostics` 及AI查询的 `result.answer.mappingDiagnostics`，逐行解释标准项目关联，不混入 `rows`。其结构为：

```ts
{ rowId: string; status: 'matched' | 'unmapped' | 'conflict'; code: string; message: string; targetName?: string }[]
```

这些说明由服务端按当前项目数据重新推导，不是AI识别原文、不替代发布校验，也不改变 `include`。客户端仅用于展示，旧响应可没有该字段；保存草稿或发布时不能把它放入 `draft`、草稿行或确认声明，严格请求结构不接受该只读字段。

查询不持久化手册、文件、规则和审计。缓存按管理员隔离，绑定品牌、车系、年款、动力及演示标识；有效证据通常缓存30分钟，失败／无证据结果最多30秒。最多30个任务、原文字节合计96 MiB，超额驱逐旧完成任务或明确失败；进程重启会失效。`GET`不返回内部文件路径、密钥、缓存原文字节或车型锁字段。

`POST /admin/manual-imports/from-ai-answer` 接收严格JSON `{ "modelId": "准确车型ID", "answerId": "上述任务ID", "consent": true }`。服务端核验当前用户、缓存及车型身份，保存同一批原文，并以已整理行建立 `awaiting_confirmation` 任务，自动关联标准项目；不二次下载、请求AI或发布规则。重复／并发使用同一答案复用同一持久任务，并返回其最新状态。过期或他人缓存返回404／`AI_ANSWER_NOT_FOUND`，未完成或无行返回409／`AI_ANSWER_NOT_READY`，车型变更返回409／`MODEL_CHANGED`。持久草稿创建失败会清理本次证据，原缓存可重试；后续核对发布仍使用原有事务接口。

旧候选排序接口继续兼容：

`POST /admin/manual-imports/ai-search` 接收严格JSON `{ "modelId": "准确车型ID", "consent": true }`，仅平台管理员可用。先执行真实公开查询并补充官方等目录，再由AI排序给定候选编号；不接受AI生成的URL、周期或适用性。返回 `query,sources,summary,warnings,aiStatus,searchedAt,evidenceMode`，`evidenceMode` 为 `public_search`，`aiStatus` 为 `completed`、`unavailable` 或 `not_configured`。未配置、拒绝、超时或无效编号时保留原候选或目录并说明原因。支持现有Responses和Chat Completions，AI步骤最多35秒，公开查询最多12秒；相同车型查询合并并缓存，正常15分钟、AI失败30秒，每分钟最多4次、同时最多3个不同查询；繁忙返回429。

`POST /admin/manual-imports` 使用Multipart，必填字段仅为 `modelId`、字面值 `consent=true` 及文件。`sourceTitle`、`sourceUrl`、`edition`、`applicability`均可省略或留空，上传后自动保留原件并生成资料草稿，AI只根据可见文档填充空白元数据，保留人工输入。一次为1份最大32 MiB的PDF，或最多12张每张最大8 MiB的JPEG／PNG／WebP，总量最多32 MiB；图片不需要页码。

PDF最多1000页、识别最多12页。`pageMode` 为 `auto`（默认）或 `manual`；明确 `pageRange` 时始终使用指定物理页。自动模式先尝试定位文字版的保养表及说明，无法可靠定位时返回 `PDF_AUTO_SELECTION_REQUIRED`，建议上传表格截图或指定物理页。短PDF可全选。`pageRange` 如 `150-154,158`，页序号从1开始，不能依据印刷页码猜测。服务端继续解码并执行像素／内容预算预检，不将文件名或MIME声明当作内容证明。

`POST /admin/manual-imports/from-url` 使用相同元数据的 JSON，`sourceUrl` 必填、`consent` 为布尔 `true`。下载器仅访问公开 HTTPS，校验 DNS、重定向、内容及大小，支持直接 PDF／图片、只含一个 PDF 链接的页面，以及可提取保养正文、表格或图片的普通网页。网页正文保存为 `text/plain` 证据第1页，取得的保养图片随后编号；不能仅凭搜索摘要生成规则。CarOBook 目录、交互网盘及登录页面不等同于已取得手册；无法读取具体证据时返回明确原因，可打开原页截取保养表后上传，不代登录或绕过第三方权限。

来源条目的可选 `isDirectory=true` 表示品牌／目录入口，`false`表示查到的具体候选；入口名称不能当作实际手册标题。任务新增可选 `metadataOrigin` 记录名称／版本／适用范围来自人工、原文、文件名、目标建议或未知；`sourceExcerpt` 保存识别原文摘录，`pageSelection` 保存选页模式、物理页列表、总页数及说明。旧任务没有这些字段仍可读取。文件名和目标车型仅能生成待核对建议，不能证明版本或适用性。

返回 `ManualImport`，状态为 `uploaded`、`processing`、`awaiting_confirmation`、`published` 或 `failed`，包含 `files`、`rows`、`warnings`、`revision` 和发布的规则 ID。`GET /admin/manual-imports` 仍返回管理员可见的任务集合；V0.9工作区按 `modelId` 只展示当前车型的资料和规则。任务不进入普通 `bootstrap`；附件不暴露服务端路径。发布前仅平台可访问证据，发布后还需车主拥有匹配车型车辆才可读取。

`GET /manuals/:id` 仅返回已发布的 `ManualDocument` 元数据：`id`、`modelId`、`sourceTitle`、`sourceUrl`、`edition`、`applicability`、`sourceExcerpt`、`metadataOrigin`、`pageSelection`、`files`、`publishedAt`。平台或拥有匹配车型的车主可读；草稿返回 404，其他已登录角色／无匹配车辆车主返回 403。原件和页图通过 `GET /manual-files/:id` 采用相同权限读取，不能借用普通文件路由绕过权限。

`PATCH /admin/manual-imports/:id/draft` 示例：

```json
{
  "expectedRevision": 3,
  "sourceTitle": "合成测试手册2024版",
  "sourceUrl": "https://example.com/synthetic-manual.pdf",
  "edition": "合成2024版",
  "applicability": "中国版2024款某动力配置；仅为字段示例",
  "rows": [{
    "id": "服务端生成的草稿行ID",
    "name": "合成空调滤清器更换",
    "projectId": "管理员明确选择的标准项目ID",
    "createProject": false,
    "include": true,
    "action": "replace",
    "triggerType": "periodic",
    "firstMonths": 12,
    "firstKm": null,
    "intervalMonths": 12,
    "intervalKm": null,
    "mileageType": "total_km",
    "condition": "",
    "notes": "正常使用条件；合成测试，不能作为实际保养依据",
    "sourceText": "合成原文：每12个月更换。",
    "pageNumbers": [1]
  }]
}
```

动作 `action` 为 `inspect`／`replace`／`clean`／`lubricate`／`other`，触发方式 `triggerType` 为 `periodic`／`condition`／`as_needed`。四个周期字段 `firstMonths,firstKm,intervalMonths,intervalKm` 均允许 `null`，非空为正整数，月份上限1200、公里数上限2000000。固定周期的后续月数／公里数至少一个有效，可纯时间、纯公里或两者先到；`condition` 必须为空，正常使用说明放在 `notes`。原文未单列首保时，两项首次可保持null，从已注明的后续周期起算；有任一独立首次值则保持原文维度。

V0.9.3在 `ManualRuleDraft`、`MaintenanceRule` 和 `MaintenanceItem` 增加可选布尔 `conditionThresholdsIndependent`。共享判定使用 `usesIndependentConditionThreshold`，其语义如下：

| 值与类型 | 计算行为 |
| --- | --- |
| `triggerType=condition` 且字段为 `true` | 管理员已明确确认时间／公里可与原条件独立触发，保留条件并计算阈值；须至少一个后续月份或公里数 |
| `triggerType=condition` 且字段为 `false` | 明确禁用独立阈值，保留数值为原文依据，返回 `conditional`，不采用旧资料兼容推断 |
| `triggerType=condition` 且字段省略 | 仅对狭窄的“警告或明确阈值”原文做兼容判断：条件全文、原文摘录数量／单位和已填阈值须一致；严苛／受限工况、多版本适用及不完整证据不启用 |
| `triggerType=as_needed` | 保留按需语义及原文数值，不计算固定到期；不能设置独立阈值为true |

例如旧机油6个月／机滤1年资料满足“当出现警告时或…，以先到者为准”证据时可独立提醒，不改为 `periodic`，也不合并两项。省略值的旧记录由读取／计算过程动态兼容，不批量写库；旧手册响应可返回推导补齐的布尔值。新AI识别仍依据严格原文判定，未知关系设为false，不能仅凭数字声明独立触发。条件及按需候选默认 `include=false`；是否选入发布与独立提醒决定是不同字段。

有特殊适用条件的项目保留条件及原文阈值，未明确独立触发时不计算通用固定到期；不能为通过校验而强改固定周期或清除阈值。未知值不能由AI补齐。选中行需有有效证据页和原文摘录，且必须仅选择有效 `projectId`、公开参考 `catalogProjectId` 或明确 `createProject=true` 三种映射之一。其他映射字段置空／false，`catalogProjectId` 可省略以兼容旧草稿。重复项目与故障诊断范围不能发布。

提醒返回的 `dueAt`、`dueKm` 独立可空。可计算的时间临近／到期不因里程缺失而被覆盖，原因仍提示待核验的里程；纯时间规则不要求里程观测。未启用独立阈值的条件及按需规则继续返回 `conditional` 与空日期／里程。车主界面按 `Asia/Shanghai` 自然日显示倒计时，并在同状态下按到期日期排序。

普通人工规则的 `POST /admin/rules` 与 `PATCH /admin/rules/:id` 同步支持上述四个nullable阈值及完整 `action,triggerType,conditionThresholdsIndependent,condition,notes` 语义，可保留 `sourceText,sourcePages,edition,applicability`。省略 `triggerType` 按既有固定周期兼容；PATCH先合并旧值再校验，固定周期至少一个后续阈值，条件／按需要求非空条件，独立阈值true只允许条件规则且至少一个后续阈值。对应校验包括 `INTERVAL_REQUIRED`、`CONDITION_REQUIRED`、`CONDITION_INTERVAL_REQUIRED`、`CONDITIONAL_INTERVAL`。已发布手册规则仍拒绝直接PATCH并返回409／`MANUAL_RULE_IMMUTABLE`，被替代版本返回409／`RULE_SUPERSEDED`；修改须经新手册版本审核发布。

首次识别只为唯一、同部件／确定的名称别名且同操作的行自动映射启用的非故障诊断项目，找不到时再匹配公开参考目录，不使用模糊相似度。多动作、重复来源行、重复目标、停用、操作未知或歧义不能被自动替换，未选目标继续留空，已有人工选择继续保留并通过只读诊断提示问题。`POST /admin/manual-imports/:id/auto-map` 接收 `{ "expectedRevision": 3 }`，仅处理 `awaiting_confirmation` 的当前版本草稿，保留已有 `projectId`、`catalogProjectId` 或明确新增选择以及原文、周期和 `include`；返回更新后的 `ManualImport` 并递增revision，不重新下载或请求AI。可对历史待核对草稿执行，过期版本返回409／`REVISION_CONFLICT`。参考项目在发布事务中才创建或复用并保留 `catalogSource`；多义匹配、停用项目或编码冲突会阻止发布，不静默复制。

“通用首次保养”在客户端修改草稿后仍通过原PATCH保存，没有额外批量发布接口。只作用于已选、`periodic`、`condition`空白且 `firstMonths`／`firstKm`均为null的行，不改后续周期或任何已知首次值。月数为1–1200、公里数1–2000000的整数，至少填写一项；这些管理员提供的值仍须原文支持及发布前确认。

V0.9工作区一次发布使用 `POST /admin/manual-imports/:id/publish`，把当前编辑直接放入 `draft`，无需预先PATCH保存。`draft` 含 `sourceTitle`、`sourceUrl`、`edition`、`applicability`、`rows`，可选 `sourceExcerpt`，字段结构与上例相同；名称为空时保留任务名称或使用车型资料名称，原文未注明的版次及适用说明可为空。示例只用于说明请求格式：

```json
{
  "expectedRevision": 3,
  "verified": true,
  "applicabilityConfirmed": true,
  "draft": {
    "sourceTitle": "合成保养周期表",
    "sourceUrl": "",
    "edition": "",
    "applicability": "",
    "rows": [{
      "id": "服务端生成的草稿行ID",
      "name": "更换空调滤清器",
      "projectId": "管理员核对的标准项目ID",
      "createProject": false,
      "include": true,
      "action": "replace",
      "triggerType": "periodic",
      "firstMonths": null,
      "firstKm": null,
      "intervalMonths": 12,
      "intervalKm": 20000,
      "mileageType": "total_km",
      "condition": "",
      "notes": "合成测试，不能作为实际保养依据",
      "sourceText": "合成原文：每12个月或20000公里更换，以先到者为准。",
      "pageNumbers": [1]
    }]
  }
}
```

`verified=true` 和 `applicabilityConfirmed=true` 仍是服务端必需的人工核对声明；界面通过“确认并导入”一次明确表达，不再要求两个复选框。服务端锁定车型及任务后检查 `expectedRevision`，在同一事务内校验当前draft、保存编辑、创建规则版本、合并车型适用项目并记录审计；成功只递增一次revision。未选行不发布、不阻止选中项目导入，原文仍保留在发布记录中。

选中行的业务待核对问题集中返回HTTP 422，形如：

```json
{
  "error": {
    "code": "MANUAL_REVIEW_REQUIRED",
    "message": "请处理 1 处问题后导入；暂不导入的项目可取消选择，原文仍会保留。",
    "issues": [{
      "rowId": "草稿行ID",
      "rowNumber": 2,
      "field": "projectId",
      "message": "未能自动关联标准项目，请选择或暂不导入此项"
    }]
  }
}
```

`rowNumber` 为当前完整草稿的一基行号，`rowId` 用于定位；没有选中项时使用 `rowId=""`、`rowNumber=0`、`field="rows"`。结构校验、权限及版本冲突仍使用对应标准错误。校验失败不会保存本次编辑或创建部分规则。相同已完成请求重试返回已发布结果，不重复创建；不同内容返回409／`PUBLICATION_CONFLICT`，过期草稿返回409／`REVISION_CONFLICT`。旧客户端可继续只传 `{ "expectedRevision": 4, "verified": true, "applicabilityConfirmed": true }` 发布已保存草稿，保留原版次、适用范围及首保校验要求。

原有规则历史保留，其他车型不变。失败任务可 `POST /admin/manual-imports/:id/retry`，最多三次识别尝试；未配置AI、识别失败及未人工确认时均不能成为有效规则。

## 公开车型与参考服务项目

以下接口仅允许 `platform_admin`，静态候选随应用发布，无需运行时访问外站。目录版本、来源与使用边界见 [公开目录](public-catalog.md)。新建实体的可选 `catalogSource` 保存候选 ID、目录版本、来源快照及导入时间；实际配置导入还保存 `variantId`、`sourceEvidence` 与可选 `manufacturer`。已有实体被复用时不改写其来源或其他字段。

| 方法与路由 | 请求与返回 |
| --- | --- |
| `GET /admin/catalog/models` | `q`、`brand`、`year`、`availableOnly` 可选；`offset` 默认 0，`limit` 默认 40、最大 100。返回 `items,total,offset,limit,brands,years,sources,version`；每个车系含 `variantCount`、`years`。品牌筛选为精确匹配，搜索忽略大小写、空白及全半角差异 |
| `GET /admin/catalog/models/:id/variants` | 所选车系的实际配置；可选 `year`、`power`、`q`，`offset` 默认 0，`limit` 默认 40、最大 100。返回 `items,total,years,powers,sources,version,offset,limit` |
| `GET /admin/catalog/projects` | `q`、`category` 可选，V0.9.2提供27项通用服务候选，筛选后返回 `items,total,categories,sources,version`，项目含 `action` 和参考来源 IDs |
| `POST /admin/catalog/models/import` | 选择配置：`{ "catalogId": "车系候选ID", "variantId": "公开配置ID" }`；人工补充：`{ "catalogId": "车系候选ID", "year": 2024, "power": "管理员核对的实际动力与配置" }`。两种请求不能混用；返回 `{model,created}` |
| `POST /admin/catalog/projects/import` | `{ "catalogIds": ["目录条目ID"], "skipConflicts": true }`，1–200 条，重复 ID 去重。`skipConflicts` 可省略，默认 `false`；返回 `{projects,created,existing}`，设为 `true` 时另含 `skipped` |

车系列表的 `year` 为可选的 1950–2100 整数，只返回已收录该年款配置的车系。`availableOnly` 只接受查询字符串 `true` 或 `false`，API 默认 `false`，保留可供人工补充的无配置车系；前端车型库默认传 `true`。设为 `true` 时按各车系最新已收录年款降序排列，同年按品牌及车系名称排列；`year` 过滤与其他条件同时生效，不会为缺失年款生成配置。

列表响应顶层 `years: number[]` 是**整个目录**实际配置的去重年款，降序排列，不随品牌、关键词、年款或可用性筛选收窄。每个 `items` 条目的 `years: number[]` 是该车系全部已收录年款，降序排列；无配置为 `[]`。`variantCount` 是该车系全部配置数量，不是当前所选年款的数量。共享类型 `CatalogModel.years` 和 `CatalogModelsResponse.years` 保持可选，以兼容旧响应；当前服务端均返回这两个字段。目录版本为 `2026-11-07.1`。

`CatalogVariant` 含 `id`、`modelCatalogId`、`year`、`power`、`trim`、`sourceId`、`sourceEvidence`，以及可选 `manufacturer`。其中 `year` 是来源明确载明的车型年款，`power` 为动力事实，`trim` 为具体配置名称，`sourceEvidence` 保留该条配置的原文依据。年款、动力和配置来自同一条来源记录，不能任意组合。历史开源配置、现代车型公开数据与官网事实分别记录来源、版本和查阅日期，不代表当前在售或全市场覆盖；新增数据说明见 [现代车型来源](vehicle-variants-modern.md) 及 [比亚迪近期配置来源](vehicle-variants-byd-recent.md)。

配置查询的 `year` 为 1950–2100 整数；`power` 精确匹配；`q` 搜索配置、动力和厂商。`years` 返回该车系全部可用年款（降序），`powers` 返回所选年款下的可用动力，与当前关键字／动力过滤独立。分页 `offset` 为 0–100000 整数。车系无配置时返回空候选，未知车系返回 404。未返回某个年款只表示该年款资料尚未收录，不等于车型或年款不存在；前端提供放宽筛选、显示待补充车系及人工补充年款与配置入口，操作见 [公开目录](public-catalog.md#选择车型)。

选择 `variantId` 导入时，服务端校验配置属于该车系，再派生档案 `year` 与 `power`（`公开动力 · 具体配置`），客户端不能覆盖这些值或夹带其他字段。不存在或跨车系的配置返回 400、`CATALOG_VARIANT_MISMATCH`。人工补充模式仍须明确填写 1950–2100 的整数年款和非空动力配置，不会伪装成有公开配置依据的导入。两种模式均建立非演示档案，保养适用项目保持未知；周期、材料、价格及适用范围通过原有手册审核流程确认。

同候选、年款及归一化动力配置，或同品牌、名称、年款及动力的档案可幂等复用。普通车型新增／修改与候选导入共用表锁及身份重复检查。

参考项目优先按候选来源、编码或归一化名称复用，再复用部件相同、操作相同且唯一的同义项目；保留已有描述、来源、启停状态及其他编辑。部件相同但动作未知或存在多义候选时不新增副本；故障诊断不参与周期保养项目的语义匹配。默认 `skipConflicts=false`，编码等冲突返回409并整批回滚；设为 `true` 时提交可安全新增或复用的条目，并返回 `skipped: { catalogId: string; name: string; reason: string }[]`，无冲突时为 `[]`。`created` 为新增数，`existing` 为复用数，`projects` 仅含成功新增或复用结果，跳过项不计入成功数。不存在的候选仍返回 `CATALOG_ENTRY_NOT_FOUND`，整批不写入。未知字段不能通过导入请求夹带来源、保养规则或演示标记。

V0.9.2已上线，目录版本为 `2026-11-07.2`，参考服务查询在原25项上补入 `ref-engine-oil-only` 和 `ref-engine-oil-filter-only`，共27项，分别表示独立机油更换和独立机滤更换。旧组合 `ref-engine-oil-filter` 继续表示同时更换机油及机滤，不能用来代替只有其中一个部件的来源行，也不能将机油6个月和机滤12个月合并。旧版120项的已知ID继续兼容以保留既有草稿和来源。自动关联的新候选来自27项通用目录，也可匹配既有启用业务项目；无法明确对应时留空供核对。目录扩充不会自动新增、停用或重建正式项目；仅明确目录导入，或确认发布选中的参考行时，才创建或安全复用对应业务项目。

历史精简及重建CLI使用冻结的 `legacyGeneralCatalogProjects` 原25项清单，不能把其目标数量当作当前查询目录27项，也不能为补两个候选重新执行清空重建。历史25项验收记录保持原样。

标准服务列表通过现有 `bootstrap` 项目数据在客户端筛选**启用／已停用／全部**，默认启用，无新增状态查询接口。停用项仍可通过现有 `PATCH /admin/projects/:id` 将 `active` 改回 `true`。运维 CLI `scripts/simplify-service-projects.ts` 默认只读预览，显式 `--apply` 才停用未修改、无业务引用且来源版本为 `2026-11-05.1` 的非通用导入项目；它不是 REST 接口。计划摘要、原始快照和恢复操作见 [精简已有服务目录](public-catalog.md#精简已有服务目录)。

`DELETE /admin/models/:id` 仅平台管理员可用，成功返回 `{ "deleted": true, "id": "车型ID" }`。事务先锁定车型并检查车辆、报价、历史报价、规则和手册任务引用；任一引用返回409／`MODEL_IN_USE`，不存在返回404，不级联删除业务依据。界面的“查看规则”按所选 `modelId` 精确过滤并切到规则页，清除后恢复全部，不新增读取权限或改写规则。

## 行驶证识别与私人档案

本组接口只允许车主访问本人资源，门店、专家及平台管理员不获得默认读取权限。证件记录单独保存在 `av_registration_imports`，不进入 `bootstrap` 或普通车辆字段；其图片带私人证件用途标记，即使被错误引用到故障单也不向门店或专家开放。`POST /faults` 同时拒绝将行驶证图片作为共享故障照片。

升级时数据库迁移只新增证件表及本人查询索引，不删除或重建现有业务表；不需要新增环境变量，沿用已有 AI 接口和持久上传卷配置。

`POST /registration-imports` 使用 Multipart：

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `file` | 文件 | 一张 JPEG、PNG 或 WebP，最大 8 MB；服务端解码、旋转及归一化，不能仅修改扩展名 |
| `consent` | 文本 | 必须为字面值 `true`，表示同意将本张证件图片发送至已配置的 AI 服务识别 |
| `vehicleId` | 文本，可省略 | 关联现有车辆时填写本人车辆 ID；省略表示识别后由车主确认新车建档信息 |

返回 `RegistrationImport`。状态依次为 `uploaded`、`processing`、`awaiting_confirmation`、`confirmed`，识别失败为 `failed`；未配置服务直接返回失败任务。识别结果仅为候选信息，上传、处理及预览都不会创建或修改车辆。返回对象包含 `candidate`、`confirmedFields`、`vehicleId`、`imageUrl`、状态及时间，不暴露服务端文件路径、图片摘要或内部确认摘要。列表只返回本人的记录，按上传时间从新到旧排列。

`RegistrationFields` 的九个键固定存在，未知或未填写的可选值为 `null`：

| 字段 | 含义 | 确认校验 |
| --- | --- | --- |
| `plate` | 号牌号码 | 必填；统一大小写、全半角及常见视觉分隔符 |
| `vehicleType` | 车辆类型 | 可空，非空最多 100 字符 |
| `ownerName` | 所有人 | 可空，非空最多 100 字符；仅本人证件档案可见 |
| `useNature` | 使用性质 | 可空，非空最多 100 字符 |
| `brandModel` | 行驶证品牌型号原文 | 必填，最多 100 字符；不能由此推测平台保养车型 |
| `vin` | 车辆识别代号 | 可空；非空为 17 位字母数字，不含 I、O、Q |
| `engineNumber` | 发动机号码 | 可空，非空最多 100 字符 |
| `registerDate` | 注册日期 | 可空；准确的 `YYYY-MM-DD`，不得在未来 |
| `issueDate` | 发证日期 | 可空；准确的 `YYYY-MM-DD`，不得在未来；两个日期均填写时不得早于注册日期 |

本流程不提取或保存住址字段。图片仍可能包含未遮挡的住址，上传前页面提示车主可先遮住无关信息；这不等同于服务端自动遮挡原图。

确认请求为 `POST /registration-imports/:id/confirm`，JSON 结构为：

```json
{
  "fields": {
    "plate": "鲁B12345",
    "vehicleType": "小型轿车",
    "ownerName": null,
    "useNature": "非营运",
    "brandModel": "据原图核对填写的品牌型号",
    "vin": null,
    "engineNumber": null,
    "registerDate": "2023-04-12",
    "issueDate": "2023-04-12"
  },
  "vehicle": {
    "modelId": "明确选择的车型配置ID",
    "name": "我的爱车",
    "startDate": "2023-05-01",
    "initialKm": 200
  }
}
```

上例仅表示字段结构，不对应真实车辆。新车建档必须额外提供 `vehicle`，由车主明确选择已存在的车型、车辆启用日期及启用里程。启用日期独立确认，不从注册日期或发证日期自动推导；行驶证不生成当前里程观测。已有车辆的任务必须省略 `vehicle`，确认的号牌必须与该车牌一致，只保存私人证件档案，不改写车型、启用日期、初始或当前里程。需要修正原车牌时，先通过原车辆维护接口明确修改，再上传匹配的行驶证。

确认事务将记录锁、本人车辆归属、车牌唯一性及新车创建放在一起。相同确认内容的网络重试返回已确认记录，不重复创建车辆；更改已确认内容返回 `CONFIRMATION_CONFLICT`。不同任务与手工建档并发使用同一归一化车牌时，同一车主只能成功建立一份车辆档案。错误字段、识别失败或未完成的任务均不能被确认。

常见错误包括 `RECOGNITION_CONSENT_REQUIRED`、`REGISTRATION_PLATE_MISMATCH`、`DUPLICATE_VEHICLE_PLATE`、`INVALID_STATE` 和 `VALIDATION_ERROR`。`POST /registration-imports/:id/retry` 仅适用于本人失败任务，最多三次识别尝试；不可识别的图片应更换清晰正页，不伪造成功结果。

完整状态及字段以共享类型和实际路由校验为准；本接口文档不代表真实第三方服务或真机兼容性已经验收。
