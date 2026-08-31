# 告警与运营看板 API 契约

接口前缀为 `/api/v1`，租户由 `x-tenant-id` 传入。成功响应统一为：

```json
{ "data": {}, "tenantId": "tenant-demo" }
```

## 告警

- `GET /alarms`
- `GET /alarms/:id`
- `PATCH /alarms/:id/acknowledge`
- `PATCH /alarms/:id/close`
- `GET /alarms/stream`（SSE）

`GET /alarms` 支持以下查询参数：

- `deviceId`
- `lineId`
- `level=info|warning|critical`
- `status=active|acknowledged|closed`

未传 `status` 时返回当前未清除的告警（`active` 和 `acknowledged`）；清除记录通过 `status=closed` 或详情接口查询。设备状态告警和 MQTT 告警在 API 层按租户、产线、设备、级别、消息去重。确认和清除只更新告警生命周期读模型，不向设备、PLC 或模拟器发送控制命令。

启用 PostgreSQL 时，告警生命周期会从 `alarms` 表恢复；数据库不可用时继续使用现有内存状态，不因持久化失败阻断查询或告警确认/清除。

告警字段包含 `id`、`tenantId`、`source`、`sourceId`、`lineId`、`level`、`message`、`occurredAt`、`status`，以及状态变更后可用的 `acknowledgedAt`、`closedAt`。

非法 `level` 或 `status` 返回 HTTP 400，并包含 `code`：`INVALID_ALARM_LEVEL` 或 `INVALID_ALARM_STATUS`。不存在的告警返回 HTTP 404；已清除告警再次确认返回 HTTP 409，错误码为 `ALARM_ALREADY_CLOSED`。

`GET /alarms/stream` 首次推送 `snapshot`，MQTT 或 HTTP 遥测投影发生变化时推送 `updated`，并每 15 秒推送 `heartbeat`。推送数据仍按当前租户过滤，连接断开后由客户端重连并重新接收快照。

## 运营看板

- `GET /dashboard/overview`
- `GET /dashboard/lines/:lineId`
- `GET /dashboard/history?lineId=:lineId`（生产历史）
- `GET /dashboard/stream`（SSE）

`overview` 保留 `lines`、`devices`、`alarms`、`workOrders` 等原有聚合字段，并提供：

- `lineSummaries`：四条产线的实时状态、设备在线率、活动告警数、OEE、产量/进度、风险分数和最近告警时间；
- `highestRiskLine`：当前风险最高产线；
- `activeAlarmCount`、`recentAlarmAt`、`deviceOnlineRate`；
- `productionMetrics.todayOutput`、`plannedQty`、`completedQty`、`remainingQty`、`completionRate` 和 `oee`。

OEE 优先使用实时设备计数计算；没有计数遥测时返回产线目标 OEE，并通过 `oeeAvailable=false`、`oeeSource=target` 明确其来源。没有租户产线时 `oee` 为 `null`，不会借用其他租户数据。

`GET /dashboard/history` 返回按上报时间排序的工单产量历史点，包含 `quantity`、`goodQty`、`defectQty`、累计完成量和 `completionRate`；可通过 `lineId` 限定产线，数据为空时返回空数组。

看板数据优先读取现有内存服务和 MQTT 缓存。产线详情不存在时返回 HTTP 404。看板接口为只读接口，不提供设备控制、PLC 控制或智能助手能力。

`GET /dashboard/stream` 使用同样的 `snapshot`、`updated`、`heartbeat` 事件类型推送完整 overview。确认/清除告警是生命周期动作，不等同于设备控制，也不绕过审批流程。
