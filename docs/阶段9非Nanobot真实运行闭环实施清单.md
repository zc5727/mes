# 阶段 9：非 Nanobot 真实运行闭环实施清单

- 范围：MQTT 真实联调、故障闭环、PostgreSQL 接入准备、统一启动命令、浏览器验收、生产安全清单
- 明确排除：Nanobot adapter、智能秘书、SaaS、多租户计费、真实 PLC 写入
- 目标状态：先达到“可重复演示闭环”，再以数据库恢复和故障证据为门槛判断是否达到“可交付闭环”

本轮协调不处理 Nanobot；Nanobot 相关契约仅作为接口边界，不纳入阶段 9 通过条件。

## 1. 本轮目标与交付边界

### 必须完成

1. 统一启动/停止入口，明确基础设施、后端、前端、模拟器的依赖顺序。
2. 验证 `simulator → Mosquitto → NestJS MqttModule → REST/看板`。
3. 完成 `telemetry → 设备状态`、`alarm.created → 活跃告警`、`alarm.cleared → 告警关闭` 的故障闭环。
4. 完成 PostgreSQL schema、migration 和 repository 接入准备，明确内存缓存到数据库读模型的切换点。
5. 完成浏览器四产线验收和前后端接口一致性检查。
6. 形成生产安全清单，避免开发配置直接进入生产。

### 不得宣称已完成

- MQTT 采集已接入不等于历史数据已持久化。
- 策略服务能生成候选方案不等于策略已执行。
- 前端能显示不等于实时推送已打通。
- 本地匿名 Mosquitto 不等于生产级消息安全。

## 2. 依赖顺序

```text
契约冻结
  ↓
PostgreSQL / Mosquitto / MinIO readiness
  ↓
后端 HTTP 健康
  ↓
MQTT 订阅确认
  ↓
模拟器发布 telemetry 和 alarm
  ↓
数据库落库与 current-state 读模型
  ↓
REST 查询
  ↓
浏览器验收
  ↓
故障、重连、重启演练
  ↓
证据归档与版本冻结
```

任何一步失败，后续结果只能标记为“未执行”，不能用 mock 数据替代真实闭环证据。

## 3. 统一运行编排

### 推荐启动

```bash
cd /Users/a1/Documents/ChatGPT/mes
./scripts/dev-up.sh --infra --mqtt
```

其中：

- `--infra`：启动 `backend/docker-compose.yml` 中的 PostgreSQL、Mosquitto、MinIO。
- `--mqtt`：后端使用 `MQTT_ENABLED=true`，模拟器通过 `MQTT_URL` 发布到 Broker。
- `MES_TENANT_ID`：可选，默认 `tenant-demo`。
- `MQTT_URL`：可选，默认 `mqtt://localhost:1883`。

### 停止

```bash
./scripts/dev-down.sh
./scripts/dev-down.sh --infra
```

### 基础验证

```bash
./scripts/verify-all.sh
```

该脚本负责 `diff --check`、环境校验、mock、后端 unit/e2e/build、模拟器测试和前端 build；MQTT Broker、数据库重启和浏览器检查仍必须按本清单执行。

### 当前编排限制

- `scripts/dev-up.sh` 默认不启动基础设施，也默认不打开 MQTT；必须显式传 `--infra --mqtt`。
- Docker Compose 不可用时，需按 `docs/阶段8真实运行闭环实施计划.md` 使用等价 `docker run`，并记录容器版本。
- `dev-up.sh` 已包含 PostgreSQL/MQTT readiness、Backend health 和前端 HTTP
  readiness。当前 macOS/Codex 非交互执行器会在命令返回后清理已启动的子进程，
  因此进程脱离尚未通过可靠回归；需在 launchd、Docker Compose 或其他明确的进程
  监管器下单独验收，不得以本地 shell 返回作为通过依据。

## 4. 接口契约审查与冲突清单

### 4.1 REST 与前端

前端 `third_party/threejs-factory-demo/src/api/mesApi.ts` 当前调用：

```text
GET /production-lines
GET /devices
GET /work-orders/overview
GET /agvs
GET /alarms
GET /dashboard/overview
```

统一前缀：`/api/v1`；租户头：`x-tenant-id`；默认租户：`tenant-demo`。

数字孪生专用接口已装配但尚未被 `mesApi.ts` 的首次快照流程调用：

```text
GET /digital-twin/snapshot
GET /digital-twin/current-state
```

响应外层为 `{ data, tenantId }`；其中 `data.devices` 当前同时提供 `canonicalId` 和 `sourceId`，正式冻结时以数字孪生契约中的 `deviceId` 为对外统一字段，`sourceId` 仅保留为来源标识。

| 冲突/差异 | 影响 | 处理要求 |
|---|---|---|
| `/devices` 主要返回设备台账，`/dashboard/overview` 才叠加 MQTT 实时态 | 前端设备详情和总览可能不一致 | 统一 current-state 读模型，或明确接口实时性字段 |
| `/digital-twin/snapshot` 已提供 `canonicalId/sourceId`，但冻结字段要求 `deviceId/alarmId/snapshotVersion/dataSource/lastUpdatedAt` | 数字孪生专用接口与冻结契约字段尚未完全一致 | 后端适配层统一字段，兼容字段只能短期保留 |
| 前端对 AGV、告警、看板采用可选降级 | API 失败时可能显示旧/静态数据 | 增加实时/降级状态提示和日志 |
| 前端将 `line-cnc` 映射为 `LINE-01` | 策略和 MQTT 使用原始 `line-cnc` | 确定内部 canonical ID，响应中同时提供展示 code 或统一映射 |
| MQTT 设备 ID 如 `cnc-01`，台账 ID 如 `device-cnc-01` | 告警、设备详情关联可能错位 | 明确 `sourceDeviceId` 与 `deviceId` 的转换规则 |
| 已有 WebSocket 客户端协议，后端尚无完整 MQTT→WebSocket 推送 | 页面不会自动收到 MQTT 事件 | 未完成前只验收 REST 刷新，不宣称实时推送完成 |

### 4.2 MQTT

正式主题：

```text
# telemetry 发布
mes/simulator/{tenantId}/lines/{lineId}/devices/{deviceId}/telemetry

# 告警 created/cleared 发布
mes/simulator/{tenantId}/alarms

# 后端发布模拟器控制
mes/control/{tenantId}/simulator/command
```

消息边界：

- telemetry 必须包含 `event=device.telemetry`、设备/产线身份、状态、计数、时间戳。
- 告警必须包含 `event=alarm.created|alarm.cleared`、稳定 `alarm.id`、类型、级别、开始/清除时间。
- 后端拒绝无效 JSON、错误 topic 身份、非法枚举、计数不一致和过期消息。
- 模拟器目前兼容 `twin/command` 等历史别名；正式验收只使用 `simulator/command`，别名不再扩展。
- 模拟器还会发布 twin、AGV 等主题；后端当前不订阅这些主题，不得把它们算作已入库能力。

### 4.3 PostgreSQL

当前 compose 已提供 PostgreSQL，但采集核心仍是进程内缓存。接入顺序：

1. 先建立 migration/schema。
2. 原始合法消息写入 event 表。
3. 使用唯一键实现 telemetry 和 alarm 幂等。
4. 更新设备/告警 current-state 表。
5. REST 统一读取 current-state，历史查询读取 event 表。
6. 增加数据库不可用、重连、写入失败和后端重启恢复测试。

禁止先删除内存缓存；数据库读写稳定前，内存缓存继续作为实时加速层。

## 5. 故障闭环执行清单

### 5.1 单设备故障

```bash
cd /Users/a1/Documents/ChatGPT/mes/simulator
npm run dev -- --mqtt mqtt://localhost:1883 \
  --tenant tenant-demo --seed 20260829 \
  --fault line-cnc:cnc-01:OVERHEAT
```

验收链路：

```text
故障注入
→ alarm.created
→ MqttIngestionService 校验
→ AlarmDeduplicator 去重
→ 设备/产线状态变化
→ /api/v1/alarms 出现告警
→ /api/v1/dashboard/overview 统计变化
→ 浏览器设备高亮
```

### 5.2 告警清除

- 停止会持续重复上报故障的模拟器进程。
- 发布同一个 `alarm.id` 的 `alarm.cleared`。
- 查询 `/api/v1/alarms?status=active`，确认告警消失。
- 重复发布 cleared，确认无重复、无状态回退。
- 数据库接入后，确认历史事件仍可追溯。

### 5.3 重复、乱序与恢复

必须演练：

- 同一 telemetry 重复两次。
- 旧 timestamp telemetry 晚到。
- 同一 alarm.created 重复两次。
- created 后 cleared，再次 created 重开。
- Broker 停止后恢复。
- 后端停止后恢复。
- PostgreSQL 停止后恢复。
- 模拟器离线后重新连接。

## 6. 浏览器验收矩阵

| 编号 | 检查项 | 操作 | 通过标准 | 状态 |
|---|---|---|---|---|
| B01 | 页面启动 | 打开 `http://localhost:5173` | 页面无白屏，控制台无致命错误 | 待执行 |
| B02 | API 地址 | 检查 `VITE_API_BASE_URL` | 指向 `/api/v1` | 已定义 |
| B03 | 租户 | 检查请求头 | 与模拟器 `tenant-demo` 一致 | 已定义 |
| B04 | 四产线 | 逐一切换产线 | 产线、设备和统计不串线 | 待执行 |
| B05 | telemetry | 运行模拟器 30 秒 | 设备状态/温度有真实接口变化 | 待执行 |
| B06 | 告警创建 | 注入 OVERHEAT/JAM | 对应设备高亮，告警列表出现 | 待执行 |
| B07 | 告警清除 | 清除同一 alarm.id | 告警从 active 消失 | 待执行 |
| B08 | API 故障 | 停后端再刷新 | 明确显示降级，不冒充实时 | 待执行 |
| B09 | Broker 恢复 | 停/启 Mosquitto | 后端重连后继续接收消息 | 待执行 |
| B10 | 刷新恢复 | 浏览器刷新 | 状态来自统一 API，不出现租户串线 | 待执行 |

入口 smoke（不替代真实浏览器交互）：

```bash
cd /Users/a1/Documents/ChatGPT/mes
node scripts/browser-smoke.mjs
```

该命令只验证前端入口和后端 health；产线切换、故障高亮、刷新恢复仍须人工浏览器验收。

### 已验证与未验证项

截至本计划编制时，已具备自动化或代码级证据的项目：

- 后端 MQTT parser、设备缓存、告警去重、重连/重订阅单测。
- 数字孪生 canonicalId/sourceId 投影单测和实时字段契约测试。
- 后端 build、环境校验、mock 校验和脚本 shell 语法检查。
- 前端 API 默认地址、租户配置和本地降级开关已写入配置。

尚未形成本轮冻结证据的项目：

- PostgreSQL migration、真实落库、后端重启恢复。
- Mosquitto 实例重启后的真实重连和重新订阅。
- `alarm.created → alarm.cleared` 与数据库历史的完整闭环。
- `MQTT → 后端 → WebSocket → 浏览器` 自动实时更新。
- 使用真实浏览器完成四产线切换、故障高亮和降级提示。
- 生产级 MQTT ACL/TLS、数据库备份恢复和安全演练。

## 7. 生产安全清单

### MQTT

- 禁止匿名访问。
- 配置账号、密码、ACL，按租户/设备限制发布和订阅权限。
- 生产使用 TLS，轮换证书和凭据。
- 限制 Broker 网络暴露面，关闭不需要的 WebSocket 公网入口。
- 限制 payload 大小、发布频率和客户端数量。
- 记录连接、断开、认证失败和异常消息指标。

### PostgreSQL

- 使用独立非超级用户、强密码和最小权限。
- 数据卷、备份、恢复演练和迁移回滚必须可验证。
- 连接池、超时、重试和熔断必须有边界。
- 租户字段必须参与查询条件和唯一约束。
- 禁止把数据库密码写入仓库、脚本和日志。

### 后端与前端

- 生产关闭 debug 错误堆栈和 CORS 泛开放。
- 所有控制接口必须认证、授权、审批、审计；当前阶段不得自动执行策略。
- 对 MQTT 和 REST 输入做 schema 校验、大小限制和速率限制。
- 前端不得保存 Broker 凭据，不得直接连接生产 MQTT。
- 不提交 `.env`、token、密钥、临时日志和导出的生产数据。

## 8. 最终冻结门禁

冻结前必须具备：

- `./scripts/verify-all.sh` 通过。
- MQTT 实际联调证据：connect、subscribe、telemetry、created、cleared。
- PostgreSQL schema/migration 和重启恢复证据；否则只能标记“演示闭环”。
- A/B 矩阵中的阻塞项全部关闭或明确延期负责人。
- 故障演练日志、API 响应和浏览器截图归档。
- 接口版本、topic、ID 映射和环境变量文档冻结。
- 生产安全清单逐项签字/确认。
- 执行 `git diff --check`，检查无敏感文件和无关改动。
- 建立可回滚版本标签，不在冻结前混入 Nanobot 或真实设备控制。

## 9. 当前阻塞清单

### P0

1. MQTT 采集尚未接入 PostgreSQL，重启恢复不能验收。
2. 缺少数据库 migration、幂等唯一键和写入失败处理的正式实现。
3. 真实 PostgreSQL/MQTT/MinIO、生产配置和进程监管仍需独立环境验收；当前不能
   据此宣称现场部署完成。

### P1

1. MQTT→WebSocket→浏览器实时推送尚未完成。
2. `/devices` 与 `/dashboard/overview` 的实时读模型边界不完全一致。
3. 内部 line/device ID 与前端展示 ID 存在映射差异。
4. 告警历史和生命周期审计接口不足。

### P2

1. Mosquitto 仍为开发匿名配置。
2. 生产备份、监控、告警和灾备未配置。
3. 真实 PLC/OPC UA/Modbus 接入和安全联锁未设计。

## 10. 本轮结论

阶段 9 先以 MQTT 和故障闭环为主线，PostgreSQL 是从“可演示”升级为“可交付”的硬门槛。未完成数据库持久化、重启恢复和安全配置前，项目结论统一为：

> **非 Nanobot 功能具备可演示闭环，暂不具备生产运行资格。**
