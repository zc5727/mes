# 设备接入中心 REST 契约

## 边界

接口前缀为 `/api/v1`。除设备 profile 公共目录外，设备连接及其子资源都必须携带
`x-tenant-id` 请求头。连接按租户隔离；其他租户访问同一个连接 ID 统一返回 `404`，不泄露资源是否存在。

设备 profile 是不含租户业务数据的只读模板目录，当前仅提供声明式点位和控制方法，
`verified=false` 不代表已经验证过厂商兼容性。连接的 `start`、`stop` 和 `test` 只管理采集适配器生命周期或执行连通性探测，
不会向真实 PLC/设备发送控制命令。

## Profile 查询

```http
GET /api/v1/device-profiles
GET /api/v1/device-profiles?protocol=opcua
GET /api/v1/device-profiles/:key
```

`protocol` 允许值：`opcua`、`modbus-tcp`、`mtconnect`、`mqtt`。未知值由全局校验管道返回 `400`。

## 连接管理

所有响应（`DELETE` 除外）使用 `{ "data": ..., "tenantId": "..." }` 包装。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/device-connections` | 当前租户连接列表 |
| `POST` | `/device-connections` | 创建连接配置 |
| `GET` | `/device-connections/:id` | 查询连接及最近错误 |
| `PATCH` | `/device-connections/:id` | 更新配置 |
| `DELETE` | `/device-connections/:id` | 删除已停止的连接，成功返回 `204` |
| `POST` | `/device-connections/:id/test` | 连通性探测并更新 health |
| `POST` | `/device-connections/:id/start` | 探测通过后启动采集生命周期 |
| `POST` | `/device-connections/:id/stop` | 停止采集生命周期 |
| `GET` | `/device-connections/:id/health` | 查询健康状态 |
| `GET` | `/device-connections/:id/capabilities` | 查询声明能力、profile 点位及方法 |
| `GET` | `/device-connections/:id/profile` | 查询绑定的 profile |
| `GET` | `/device-connections/:id/status-events` | 查询连接状态变更记录 |
| `GET` | `/device-connections/:id/events` | 查询统一设备事件 |
| `POST` | `/device-connections/:id/events` | 接收已授权采集适配器的统一事件 |

创建或更新时会校验 endpoint 协议、profile 协议兼容性、`timeoutMs` 和 `reconnectPeriodMs`（`1..30000`），
并拒绝重复的同租户 `deviceId + type` 配置。

运行中或启动中的连接不能修改 endpoint、config、profile、enabled，也不能直接删除；必须先调用 `stop`，
否则返回 `409`。删除操作先持久化删除成功，再移除内存索引，避免数据库失败时出现假成功。

## 状态与错误

连接 `status`：`stopped`、`starting`、`running`、`error`、`unsupported`；健康 `health.status`：
`unknown`、`healthy`、`unhealthy`、`unsupported`。失败时同时返回 `lastError` 和稳定的 `lastErrorCode`，例如：

- `INVALID_CONNECTION_CONFIG`：重启恢复时配置不合法，连接保持不可启动；
- `PROTOCOL_TIMEOUT`：探测超时；
- `PROTOCOL_CONNECTION_FAILED` / `MQTT_CONNECTION_FAILED`：连接失败；
- `PROTOCOL_UNIMPLEMENTED`：协议适配器未实现，fail-closed；
- `HTTP_STATUS_NOT_OK`：HTTP 探测返回非成功状态。

状态事件和连接配置在 `DATABASE_ENABLED=true` 时通过 PostgreSQL 事务保存并在启动时恢复；数据库不可用或迁移未完成时请求失败，
不会静默回退到内存。只有显式关闭数据库时才使用内存演示模式。
