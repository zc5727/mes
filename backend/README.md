# MES SaaS Backend

赵丞单人开发的MES SaaS后端起始工程，采用NestJS + TypeScript。

## 当前状态

这是第一阶段基础骨架，已准备：

- NestJS模块化后端
- `/api/v1`统一接口前缀
- 环境变量配置
- CORS和请求校验
- PostgreSQL、MQTT、MinIO本地依赖编排
- auth、tenants、factories、production-lines、devices、orders、work-orders、quality、documents、strategies、assistant、audit模块目录

## 启动

```bash
cp .env.example .env
npm install
npm run start:dev
```

后端地址：`http://localhost:3000/api/v1`

默认 `MQTT_ENABLED=false`，不会连接消息代理。进行模拟器联调时，先启动 Mosquitto，再使用：

```bash
MQTT_ENABLED=true MQTT_URL=mqtt://localhost:1883 npm run start:dev
```

后端启动后可执行真实 MQTT Smoke，验证 `telemetry/alarm → 内存状态 → Dashboard/Alarm API`：

```bash
npm run smoke:mqtt
```

如果连接失败，先确认 Broker 和后端日志：

```bash
docker ps --filter name=mes-mqtt
docker logs --tail=100 mes-mqtt
curl -i http://localhost:3000/api/v1/health
```

后端日志中应看到 `MQTT broker connected` 和 `Subscribed to ...telemetry, ...alarms`。如果看到
`MQTT broker error`、`MQTT broker is offline` 或 `MQTT subscription failed`，优先检查
`MQTT_URL`、1883 端口、Broker 访问权限和 Topic 配置。

## 启动本地依赖

```bash
docker compose --profile infra up -d
# MinIO/S3-compatible object storage is optional:
docker compose --profile object-storage up -d minio
```

## PostgreSQL 持久化

MQTT 状态默认仍使用内存，避免开发环境因数据库不可用而无法启动。需要启用设备状态和告警恢复时：

```bash
npm run db:generate
npm run db:init
DATABASE_ENABLED=true npm run start:dev
```

`db:init` 会部署 Prisma migration，并初始化演示租户、工厂、四条产线和 12 台设备。启用持久化后，MQTT telemetry 与告警投影会写入 PostgreSQL；数据库短暂不可用时仍保留内存投影并输出错误日志。

### 设备接入契约

### 本地实时链路

Mosquitto 与 PostgreSQL 可通过 `backend/docker-compose.yml` 启动。MQTT telemetry/alarm 被投影到统一状态后，数字孪生 SSE 接口会推送完整快照：

```bash
docker compose --profile infra up -d postgres mqtt
MQTT_ENABLED=true MQTT_URL=mqtt://localhost:1883 npm run start:dev
curl -N -H 'Authorization: Bearer dev-key' -H 'x-tenant-id: tenant-demo' \
  http://localhost:3000/api/v1/digital-twin/stream
```

浏览器 EventSource 无法自定义 Authorization header；本地演示可显式设置 `MES_REALTIME_ALLOW_QUERY_KEY=true`，并在前端配置 `VITE_REALTIME_PROTOCOL=sse`、`VITE_REALTIME_API_KEY`。生产环境应由同源网关注入认证或改用 WebSocket/token 握手，不能把 API key 放入 URL。

Modbus/OPC UA 当前只保留协议适配边界，尚未连接真实设备；模拟器应通过 MQTT 或 HTTP gateway contract 接入。

除 MQTT 模拟器链路外，不能发布 MQTT 的边缘网关可调用：

```bash
curl -X POST http://localhost:3000/api/v1/ingestion/device-events \
  -H 'content-type: application/json' -H 'x-tenant-id: tenant-demo' \
  -d '{"eventId":"evt-001","deviceId":"cnc-01","lineId":"line-cnc","eventType":"telemetry","eventTime":"2026-08-28T09:10:00.000Z","traceId":"trace-001","status":"RUNNING","quality":"GOOD","payload":{"temp":41.2,"total_count":12,"good_count":12,"defect_count":0}}'
```

HTTP 接入与 MQTT 使用同一设备状态缓存，支持事件时间乱序过滤、重复回放幂等和常用点位别名映射（`temp`、`total_count` 等）。当前 HTTP 入口只接收 telemetry；告警仍通过 `alarm.created`/`alarm.cleared` MQTT 主题进入。开启 `DATABASE_ENABLED=true` 后，事件日志、当前状态和连接事件分别写入 `device_events`、`current_states`、`connection_events`，并在重启时恢复 MQTT 状态。

### ERPNext 转接层

NestJS 保留为 integration/Agent Gateway；ERPNext 仅通过 REST 适配，不复制 ERPNext 源码。配置 `ERPNEXT_ENABLED=true`、`ERPNEXT_URL`、`ERPNEXT_API_KEY` 和 `ERPNEXT_API_SECRET` 后可使用：

```text
GET  /api/v1/integrations/erpnext/health
GET  /api/v1/integrations/erpnext/production-orders
GET  /api/v1/integrations/erpnext/work-orders
GET  /api/v1/integrations/erpnext/reports
POST /api/v1/integrations/erpnext/work-orders/:workOrderId/reports
```

未配置时接口不会影响 MES 启动；健康检查返回 `disabled`，读写桥接会返回明确的 `503`。ERPNext 的鉴权、超时、未找到和上游错误会转换为稳定的 HTTP 错误，不会伪造本地成功结果。

运行态检查：

```bash
npm run verify:runtime
```

该命令检查 `/api/v1/health` 和 `/api/v1/health/readiness`。PostgreSQL 未启用时 readiness 会明确返回 `database.status=disabled`；启用但连接失败时返回 `degraded`。

真实数据库验收使用：

```bash
export DATABASE_URL=postgresql://mes:mes_dev@localhost:5432/mes
npm run verify:postgres
DATABASE_ENABLED=true DATABASE_REQUIRED=true npm run db:verify-runtime
DATABASE_ENABLED=true DATABASE_REQUIRED=true npm run start:dev
```

`DATABASE_REQUIRED=true` 会在数据库不可用或核心表未迁移时阻止启动，避免误把生产运行当成内存模式。

生产运行时也可以由统一编排脚本执行初始化、readiness 和清理：

```bash
cd ..
scripts/mes-runtime.sh start
scripts/mes-runtime.sh ready
scripts/mes-runtime.sh stop
```

默认只启动 PostgreSQL 和 Mosquitto；需要 MinIO/S3-compatible 对象存储时使用
`scripts/mes-runtime.sh start --object-storage`。基础设施不可用、迁移失败或 readiness 不通过时脚本返回非零状态，不会继续伪装成可运行环境。

## 下一步开发顺序

1. 租户、用户和权限
2. 工厂、车间和四条产线
3. 设备台账与实时状态
4. 订单、工单和报工
5. 质量、批次和异常闭环
6. WebSocket设备事件
7. 图纸、表单和对象存储
8. 主动策略与厂长智能体
