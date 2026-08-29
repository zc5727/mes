# MES MQTT Smoke 联调说明

## 目的

用可重复的 MQTT 消息验证：

```text
MQTT telemetry → 后端内存缓存 → Dashboard API
MQTT alarm.created → 告警去重/查询 → Alarm API
```

脚本只发送模拟消息，不连接真实 PLC，也不执行设备控制。

## 启动前置条件

1. Docker Desktop 已启动。
2. Node.js 18+，后端依赖已安装：`cd backend && npm install`。
3. 后端 `.env` 至少包含：

```dotenv
PORT=3000
MQTT_ENABLED=true
MQTT_URL=mqtt://localhost:1883
```

## 执行流程

终端一：启动 Mosquitto（优先使用项目编排文件）：

```bash
cd /Users/a1/Documents/ChatGPT/mes/backend
docker compose up -d mqtt
docker compose ps mqtt
```

终端二：启动后端：

```bash
cd /Users/a1/Documents/ChatGPT/mes/backend
MQTT_ENABLED=true MQTT_URL=mqtt://localhost:1883 npm run start:dev
```

终端三：执行 smoke：

```bash
cd /Users/a1/Documents/ChatGPT/mes/backend
node test/smoke-mqtt.mjs
```

可选参数：

```bash
node test/smoke-mqtt.mjs --tenant tenant-demo --line line-cnc --device device-1 --timeout-ms 10000
```

脚本默认访问 `http://localhost:3000/api/v1`，可通过 `API_URL`、`MQTT_URL`、`MES_TENANT_ID`、`MES_LINE_ID`、`MES_DEVICE_ID` 覆盖。

## 预期结果

输出 `MQTT SMOKE PASS`，并包含：

- `/health` 返回 HTTP 200。
- telemetry 发布成功。
- alarm 发布成功。
- `/dashboard/overview` 的 `devices.alarm` 和 `alarms.critical` 大于 0。
- `/dashboard/lines/:lineId` 中目标设备状态为 `alarm`。
- `/alarms` 中存在 `mqtt-alarm-<tenant>-<smoke-id>` 且状态为 `active`。

## 失败诊断

```bash
docker compose ps mqtt
docker compose logs --tail=100 mqtt
curl -i http://localhost:3000/api/v1/health
```

常见原因：

| 现象 | 处理 |
| --- | --- |
| ECONNREFUSED 1883 | Mosquitto 未启动，执行 `docker compose up -d mqtt` |
| health 失败 | 后端未启动、端口不是 3000，或用 `API_URL` 指定地址 |
| MQTT 已连接但 Dashboard 无变化 | 确认后端启动时 `MQTT_ENABLED=true`，并检查后端日志中的订阅信息 |
| 只出现一次告警却重复执行失败 | 使用同一 `id` 重发消息，确认告警去重逻辑；smoke 每次运行会生成新 id |
| 脚本超时 | 增大 `--timeout-ms`，检查 MQTT 端口、主题拼写和后端进程 |

## 全量回归

```bash
cd backend
npm run build
npm run test:all -- --runInBand

cd ../simulator
npm run check
```

Smoke 通过后可用模拟器发送真实进程消息进行补充验证：

```bash
cd simulator
npm run build
npm run dev -- --seed 20260828 --mqtt mqtt://localhost:1883
```

模拟器进程验证的是持续 telemetry 发布；固定消息 smoke 验证的是后端缓存、告警和 Dashboard API 的确定性链路。

## 阶段 8 故障演练

故障演练覆盖完整闭环：

```text
启动检查 → MQTT telemetry/告警 → 后端缓存 → 告警/Dashboard
→ 策略仿真建议 → alarm.cleared + RUNNING → 状态恢复
```

```bash
cd backend
npm run smoke:fault
```

成功标志为 `MQTT FAULT DRILL PASS`，并且包含：

- 设备状态变为 `alarm`；
- 产线详情出现活动告警；
- `/api/v1/strategies/simulate` 返回推荐方案，且 `requiresApproval=true`；
- 告警清除后设备恢复为 `online`，活动告警消失。

## 无 Mosquitto / Docker Compose 的替代方案

如果本机没有 `mosquitto` 命令或 Docker Compose 插件，可使用 Docker Engine 直接启动临时 broker：

```bash
docker rm -f mes-mqtt-smoke 2>/dev/null || true
docker run -d --name mes-mqtt-smoke -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
```

然后按上文启动后端并执行 `npm run smoke:mqtt`、`npm run smoke:fault`。结束后清理：

```bash
docker rm -f mes-mqtt-smoke
```

如果 Docker Engine 也不可用，仍可执行不依赖 broker 的全量回归：

```bash
cd backend && npm run build && npm run test:all -- --runInBand
cd ../simulator && npm run check
```

这时 MQTT 两个 smoke 命令应判定为环境阻断，而不是业务通过；失败输出会保留连接地址、HTTP 阶段和最后一次响应，便于诊断。
