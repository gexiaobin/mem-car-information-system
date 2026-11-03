# 云程 API V0.2

统一前缀 `/api/v1`，JSON 直接返回资源；错误形如 `{ "error": { "code": "...", "message": "..." } }`。登录使用 HttpOnly 会话 Cookie，写入校验请求来源。身份和资源归属由服务端判断，前端隐藏按钮不代替鉴权。共享字段定义见 `packages/shared/src/index.ts`。

| 资源 | 方法与路径 | 用途 |
| --- | --- | --- |
| 健康/配置 | `GET /health`、`GET /config` | 数据库就绪、公开功能配置 |
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
| 车型手册 | `POST /admin/rules`、`PATCH /admin/rules/:id` | 来源、版本、适用范围与复核 |
| 门店 | `POST /admin/stores`、`PATCH /admin/stores/:id` | 本店资料、平台审核 |

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
