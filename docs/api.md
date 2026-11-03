# 云程 API V0.1

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

识别确认必须提供明确总里程、单位与数据时间。未配置视觉服务、无可识别里程或读取失败的任务不会伪造候选值和有效观测。上传体积、文件格式、当前任务状态、车辆归属和原图关联均由服务端校验。

完整状态及字段以共享类型和实际路由校验为准；本接口文档不代表真实第三方服务或真机兼容性已经验收。
