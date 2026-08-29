# nanobot 只读工具契约

## 目标

本地 nanobot 后续只作为 MES 的查询和分析入口。工具调用必须经过 MES API，不能绕过业务状态中心直接访问模拟器或设备。

## 工具清单

| 工具 | 作用 | 必要参数 |
|---|---|---|
| `get_production_overview` | 查询全厂生产概览 | 无 |
| `get_line_status` | 查询产线状态、负载和 OEE | `lineId` |
| `get_device_status` | 查询设备状态、遥测和告警 | `deviceId`，可选 `lineId` |
| `get_active_alarms` | 查询未处理告警 | 可选产线、设备、级别 |
| `get_work_order_progress` | 查询工单进度 | `workOrderId` |
| `get_delay_risk` | 查询工单延期风险 | `workOrderId` |
| `get_simulation_snapshot` | 查询仿真工厂快照 | 可选 `simulationId` |
| `get_strategy_result` | 查询策略仿真结果 | `simulationId` |

## 请求规范

每次调用必须包含：

```json
{
  "tool": "get_line_status",
  "arguments": { "lineId": "LINE-03" },
  "tenantId": "demo-tenant",
  "requestedBy": "nanobot",
  "traceId": "trace-20260828-001"
}
```

## 响应规范

```json
{
  "ok": true,
  "tool": "get_line_status",
  "traceId": "trace-20260828-001",
  "data": {}
}
```

失败时返回结构化错误，不返回堆栈和敏感信息：

```json
{
  "ok": false,
  "tool": "get_line_status",
  "traceId": "trace-20260828-001",
  "error": {
    "code": "LINE_NOT_FOUND",
    "message": "产线不存在"
  }
}
```

## 明确禁止

- `start_device`
- `stop_device`
- `stop_line`
- `reset_fault`
- `execute_strategy`
- 直接发布 MQTT 控制消息
- 直接修改工单、告警或设备状态

策略引擎只返回候选方案，nanobot 只负责解释和展示。后续如果增加审批动作，必须单独设计权限、确认、审计和回滚协议。
