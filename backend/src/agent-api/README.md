# Nanobot 只读 Tool API

## Endpoint

`POST /api/v1/agent-api/tools/execute`

请求体：

```json
{
  "tool": "get_line_status",
  "arguments": { "lineId": "line-cnc" },
  "tenantId": "tenant-demo",
  "requestedBy": "nanobot",
  "traceId": "trace-20260828-001"
}
```

生产环境还必须通过 `Authorization: Bearer <MES_API_KEY>` 和 `x-tenant-id` 网关校验；当 `MES_REQUIRE_SESSION=true` 时，Agent/策略接口必须携带 `x-session-id`。`MES_RATE_LIMIT_PER_MINUTE` 控制单 IP/租户限流，`MES_SENSITIVE_FIELDS` 控制审计参数脱敏。

工具：

| 工具 | 参数 |
| --- | --- |
| `get_production_overview` | 无 |
| `get_line_status` | `lineId` |
| `get_device_status` | `deviceId`，可选 `lineId` |
| `get_active_alarms` | 可选 `lineId`、`deviceId`、`level` |
| `get_work_order_progress` | `workOrderId` |
| `get_delay_risk` | `workOrderId` |
| `get_quality_records` | 可选 `lineId` |
| `get_quality_issues` | 无 |
| `get_maintenance_work_orders` | 可选 `overdueOnly=true` |
| `get_maintenance_plans` | 无 |
| `get_inventory_batches` | 无 |
| `get_spare_parts` | 无 |
| `get_audit_logs` | 可选 `action`、`resource`、`result`、`traceId`、`limit` |
| `get_simulation_snapshot` | 可选 `simulationId` |
| `get_strategy_result` | `simulationId` |

成功和失败响应都包含 `traceId` 与 `meta`：`sourceTimestamp`、`permissionDecision`、`requiresApproval`。`audit` 包含 `calledAt`、`tenantId`、`sessionId`、`traceId`、`requestedBy` 和已脱敏的 `arguments`。只读工具覆盖 dashboard、设备、告警、工单、质量、维护、库存、审计和策略仿真查询；审计查询仅限当前租户，并按工厂/产线范围过滤，返回字段会脱敏。失败响应使用 `error.code` 与 `error.message`，不返回堆栈。

`GET /api/v1/agent-api/tools` 返回工具白名单。

本模块只读，不发布 MQTT 控制消息，不停线，不修改设备、工单或告警。
