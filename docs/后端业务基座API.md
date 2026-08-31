# MES 后端业务基座 API

统一前缀：`/api/v1`。除健康检查外，接口从 `x-tenant-id` 读取租户，缺省为 `tenant-demo`。响应统一使用 `{ data, tenantId }`。

## 主数据

| 模块 | API |
|---|---|
| 工厂 | `GET/POST /factories`、`GET/PATCH/DELETE /factories/:id` |
| 产线 | `GET/POST /production-lines`、`GET/PATCH/DELETE /production-lines/:id` |
| 设备 | `GET/POST /devices`、`GET/PATCH/DELETE /devices/:id` |
| 产品 | `GET/POST /master-data/products`、`GET /master-data/products/:id` |
| 工艺 | `GET/POST /master-data/processes`、`GET /master-data/processes/:id` |
| 班次 | `GET/POST /master-data/shifts`、`GET /master-data/shifts/:id` |

创建接口使用 DTO 校验必填编码、名称、长度、数值范围和时间格式；编码在同租户同类型内唯一。

## 生产闭环

```text
订单：/orders
工单：/work-orders
报工：POST /work-orders/:id/reports
工单进度：GET /work-orders/overview
排产：由工单 lineId 和策略仿真结果组成，策略只返回建议，不直接执行
```

## 演示控制与审计

```http
POST /simulator/control
GET  /audit/logs
POST /audit/logs
GET  /audit/approvals
POST /audit/approvals
PATCH /audit/approvals/:id/approve
PATCH /audit/approvals/:id/reject
```

控制命令规则：`fault` 必须包含 `lineId/deviceId/faultType`；`reset` 是模拟器原生命令；`recover` 是 API 别名，后端发布到 MQTT 前规范化为 `reset`；`speed` 必须包含正数 `speed`。成功返回 HTTP 202，包含 `accepted`、原始 `action`、`normalizedAction` 和 `commandId`。MQTT 未启用或未连接时返回 HTTP 503，并记录审计事件。后端不允许客户端直连 MQTT。

新增产线：

```http
POST /production-lines
```

请求头 `x-tenant-id` 确定租户，缺省为 `tenant-demo`。必填字段为 `factoryId`、`code`、`name`、`type`；`targetOee` 可选且范围为 0～100，默认 85；`status` 可选值为 `active`、`inactive`、`maintenance`，默认 `active`。同一租户内 `code` 不可重复，跨租户隔离，成功返回 HTTP 201 和 `{ tenantId, data }`。

## 文件、图纸与表单元数据

演示基座提供：

```http
GET/POST /foundation/documents
POST /foundation/documents/upload
GET /foundation/documents/:id/content
GET /foundation/documents/:id/preview
POST /foundation/documents/:id/analyze
POST /foundation/documents/:id/analysis-draft
POST /foundation/documents/:id/analysis/confirm
POST /foundation/documents/:id/analysis/jobs
POST /foundation/documents/:id/analysis/retry
PATCH /foundation/documents/:id/status
GET/POST /foundation/quality-records
```

上传文件会保存版本、哈希、对象存储键、关联产线/工单和安全扫描状态。`analyze` 当前执行确定性的本地文件结构解析（图片尺寸、PDF 页数、格式和哈希），结果始终为待人工确认草稿；未配置视觉语义模型时不会伪造零件尺寸、工艺参数或质量结论。DWG/DXF 预览仍需要单独部署 CAD 渲染器。

## 策略执行前置校验

```http
POST /strategies/preflight
POST /strategies/simulate
```

`preflight` 检查重复 ID、产线引用和负数剩余量；`simulate` 只生成候选方案，必须经过审批后才能进入执行流程。当前没有真实设备控制接口。

维修逾期查询：

```http
GET /maintenance/work-orders/overdue
```

仅返回当前租户中计划时间已到、且尚未完成或取消的维修/点检工单，并按计划时间升序返回。
