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

工具：

| 工具 | 参数 |
| --- | --- |
| `get_production_overview` | 无 |
| `get_line_status` | `lineId` |
| `get_device_status` | `deviceId`，可选 `lineId` |
| `get_active_alarms` | 可选 `lineId`、`deviceId`、`level` |
| `get_work_order_progress` | `workOrderId` |
| `get_delay_risk` | `workOrderId` |
| `get_simulation_snapshot` | 可选 `simulationId` |
| `get_strategy_result` | `simulationId` |

成功响应包含 `ok`、`tool`、`traceId`、`data` 和 `audit`。`audit` 包含 `calledAt`、`tenantId`、`requestedBy` 和原始 `arguments`。失败响应使用 `error.code` 与 `error.message`，不返回堆栈。

`GET /api/v1/agent-api/tools` 返回工具白名单。

本模块只读，不发布 MQTT 控制消息，不停线，不修改设备、工单或告警。
