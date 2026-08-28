# MES 产线设备模拟器

独立的 TypeScript 模拟器，用于在没有真实 PLC、OPC UA 或 MQTT 现场环境时，为 MES 演示、联调和自动化测试提供可重复的四条产线数据。

## 模拟范围

- CNC 加工线、装配线、焊接线、视觉检测线
- 每条产线 3 台设备，共 12 台设备
- 设备状态：`RUNNING`、`IDLE`、`STOPPED`、`FAULT`
- 设备温度、节拍、产量、良品数、不良品数
- OEE：开动率、性能、质量和综合 OEE
- 告警：信息、警告、严重三级；支持故障恢复
- 故障注入：过热、堵料、通信中断、质量漂移、急停
- MQTT 发布；未配置 MQTT 时默认输出 JSON 到 stdout

## 启动

```bash
cd /Users/a1/Documents/ChatGPT/mes/simulator
npm install
npm run dev
```

只运行一个采样周期，适合检查消息格式：

```bash
npm run dev -- --once
```

调整采样频率和租户：

```bash
npm run dev -- --interval-ms 2000 --tenant demo-factory
```

按工厂实际情况加载自定义产线配置，配置文件可以增加、删除或修改产线和设备：

```bash
npm run dev -- --config examples/line-config.json
```

配置格式为 `{ "lines": [...] }`，每条产线需要 `id`、`code`、`name`、`product`、`idealCycleTimeSeconds` 和至少一台设备；设备需要 `id`、`name`、`kind`、`cycleTimeSeconds`。参考 `/Users/a1/Documents/ChatGPT/mes/simulator/examples/line-config.json`。

连接本地 MQTT Broker：

```bash
npm run dev -- --mqtt mqtt://localhost:1883
```

启动时注入故障，支持重复传入多个 `--fault`：

```bash
npm run dev -- --once --fault line-cnc:cnc-01:OVERHEAT --fault line-assembly:asm-01:JAM
```

故障恢复也可以在启动时传入：

```bash
npm run dev -- --once --clear-fault line-cnc:cnc-01:OVERHEAT
```

也可以通过环境变量配置：

```bash
MQTT_URL=mqtt://localhost:1883 MES_TENANT_ID=demo-factory npm run dev
```

未配置 `MQTT_URL` 时，程序不会尝试连接外部服务，只向终端打印 JSON，便于单机演示。

## MQTT 主题

主题前缀为 `mes/simulator/{tenantId}`：

```text
mes/simulator/{tenantId}/lines/{lineId}/devices/{deviceId}/telemetry
mes/simulator/{tenantId}/lines/{lineId}/snapshot
mes/simulator/{tenantId}/alarms
mes/simulator/{tenantId}/twin/state
```

孪生页面向下面的控制主题发布 JSON，模拟器会执行命令并立即发布 `twin.state.changed`，下一采样周期继续发布最新设备遥测和产线快照：

```text
mes/control/{tenantId}/twin/command
```

示例：

```json
{
  "commandId": "cmd-001",
  "action": "STOP_DEVICE",
  "lineId": "line-cnc",
  "deviceId": "cnc-01",
  "requestedBy": "plant-manager"
}
```

支持的孪生动作：`START_LINE`、`STOP_LINE`、`START_DEVICE`、`STOP_DEVICE`、`INJECT_FAULT`、`RESET_FAULT`。`INJECT_FAULT` 还需要传入 `faultType`。

消息统一为 JSON，`event` 表示事件类型，`data` 为业务数据。例如：

```json
{
  "event": "line.snapshot",
  "data": {
    "lineId": "line-cnc",
    "status": "RUNNING",
    "oee": {
      "availability": 0.98,
      "performance": 0.94,
      "quality": 0.99,
      "oee": 0.912
    }
  }
}
```

故障注入会先发布 `alarm.created`，恢复会发布 `alarm.cleared`。

## 故障注入

故障注入接口已封装在 `FactorySimulator` 和 `ProductionLineSimulator` 中，供后续 REST、WebSocket 或测试脚本调用：

```ts
factory.injectFault("line-cnc", "cnc-01", "OVERHEAT");
factory.clearFault("line-cnc", "cnc-01", "OVERHEAT");
```

支持的故障类型：

```text
OVERHEAT            过热
JAM                 堵料
COMMUNICATION_LOSS  通信中断
QUALITY_DRIFT       质量漂移
EMERGENCY_STOP      急停
```

## 校验

```bash
npm test
npm run build
```

该目录保持独立，不依赖前端核心页面；后续可由后端采集适配层订阅 MQTT，再转发给 MES API、数字孪生页面或告警中心。
