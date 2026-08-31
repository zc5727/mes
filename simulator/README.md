# MES 产线设备模拟器

独立的 TypeScript 模拟器，用于在没有真实 PLC、OPC UA 或 MQTT 现场环境时，为 MES 演示、联调和自动化测试提供可重复的四条产线数据。

## 模拟范围

- CNC 加工线、装配线、焊接线、视觉检测线
- 每条产线 3 台设备，共 12 台设备
- 设备状态：`RUNNING`、`IDLE`、`WARNING`、`STOPPED`、`FAULT`、`OFFLINE`
- 设备温度、节拍、产量、良品数、不良品数
- OEE：开动率、性能、质量和综合 OEE
- 告警：信息、警告、严重三级；支持故障恢复
- 故障注入：过热、堵料、通信中断、质量漂移、急停
- AGV：每条默认产线 1 台物流 AGV，支持电量、载荷、里程、通信中断和故障模拟
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

使用固定随机种子并加速仿真时间，适合回归测试和策略对比：

```bash
npm run dev -- --seed 20260828 --time-scale 5
```

启动后可通过标准输入控制运行状态：

```text
start       恢复运行
stop        停止状态推进（进程仍保持运行）
pause       暂停状态推进
resume      恢复状态推进
speed 10    设置时间倍率
fault line-cnc:cnc-01:OVERHEAT
reset       重置全部产线和回放记录
snapshot    输出当前快照
export      输出仿真历史
replay      输出版本化回放文档
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

启用 AGV 独立遥测及可复现网络扰动：

```bash
npm run dev -- --agv-telemetry --network-latency-ms 500 --network-duplicate-rate 0.1 --network-drop-rate 0.05 --network-seed 7
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
mes/simulator/{tenantId}/lines/{lineId}/agvs/{agvId}/telemetry
mes/simulator/{tenantId}/control
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

模拟器自身还提供统一控制协议，主题为 `mes/control/{tenantId}/simulator/command`（兼容订阅不带 `/command` 的主题）。协议使用小写 `action`，支持 `start`、`stop`、`pause`、`resume`、`speed`、`fault`、`reset`、`snapshot`、`export`、`replay`：

```json
{"commandId":"ctl-001","action":"speed","speed":2}
{"commandId":"ctl-002","action":"fault","lineId":"line-cnc","deviceId":"cnc-01","faultType":"OVERHEAT"}
```

其中 `fault` 必须提供 `lineId`、`deviceId` 和 `faultType`；`speed` 必须是大于 0 的数字。控制结果发布到 `mes/simulator/{tenantId}/control`，快照和导出结果分别使用 `simulator.snapshot` 和 `simulator.export` 事件。`stop` 停止状态推进但不结束进程，`start` 可恢复推进；`pause`/`resume` 只控制暂停状态。`reset` 无范围参数时重置模拟器；传入 `lineId`、`deviceId` 和可选 `faultType` 时只恢复指定故障。

策略或调度服务可以直接读取 `FactorySimulator.strategyInputSnapshot()`，获得同一时间点的产线、设备、AGV、告警和运行控制状态。场景测试通过 `loadScenario([{ "atSeconds": 10, "command": { ... } }])` 注入定时控制命令。

阶段 7 的网络扰动通过构造参数启用：`latencyMs` 模拟延迟，`duplicateRate` 模拟重复消息，`dropRate` 模拟丢包，`seed` 保证扰动可复现。`exportReplay()` 导出带版本和序号的回放文档，`replayFrames()` 支持按帧筛选回放数据。

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

## 协议接入模拟

`src/protocols/event-adapter.ts` 提供无网络副作用的统一事件适配器，将 MQTT 和 HTTP 事件，以及 Modbus TCP 寄存器帧、OPC UA 节点值帧，规范化为同一份 `device.telemetry` 数据契约。它只产生遥测事件，不接受设备控制命令。

协议适配契约测试：

```bash
npm run build && node --test dist/protocols/event-adapter.test.js
```

测试覆盖 MQTT/HTTP 等价映射、Modbus 状态/故障码、OPC UA 节点值、非法帧拒绝和控制命令隔离。后续接入真实 Modbus TCP 或 OPC UA 客户端时，只需将读取到的寄存器/节点值转换为对应模拟帧，再复用该适配器和校验逻辑。

### 可运行的协议 server/client

`src/protocols/protocol-bridge.ts` 提供确定性本地联调实现：

- Modbus TCP server/client：实现 FC03 holding-register telemetry 读取，非法功能码返回异常帧；客户端连接失败明确报错，可在 server 重启后重新读取。
- OPC UA server/client：创建固定节点并读取 status、温度、节拍、产量和质量计数；只读，不实现设备控制。
- 两者都复用 `event-adapter.ts`，输出 `mes/modbus/.../telemetry` 或 `mes/opcua/.../telemetry` 的 `device.telemetry` canonical MQTT 消息。

运行协议 server/client、坏帧和断线测试：

```bash
npm run protocols:smoke
```

该测试只监听 `127.0.0.1:16002`、`16003` 和 `4842`，不连接真实设备。

也可以从模拟器启动入口运行单协议本地 smoke，并将 canonical telemetry 输出到 stdout：

```bash
npm run protocols:smoke:modbus
npm run protocols:smoke:opcua
```

等价的可配置入口：

```bash
SIMULATOR_PROTOCOL=modbus-tcp SIMULATOR_PROTOCOL_HOST=127.0.0.1 SIMULATOR_PROTOCOL_PORT=1502 npm run dev
SIMULATOR_PROTOCOL=opc-ua SIMULATOR_PROTOCOL_PORT=4841 MQTT_URL=mqtt://localhost:1883 npm run dev
```

设置 `MQTT_URL` 时，读取结果会通过现有 `MessagePublisher` 发布到 canonical MQTT topic；未设置时打印到 stdout。`SIMULATOR_PROTOCOL` 只启动只读协议联调分支，不启动产线控制，也不发送设备写入命令。

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
MATERIAL_SHORTAGE   物料短缺（预警）
QUALITY_ANOMALY     质量异常
```

## 校验

```bash
npm test
npm run build
```

## 四产线故障演练验收

该演练使用固定随机种子 `20260829`，不会连接或控制真实设备。它会验证四条产线的设备遥测、AGV 遥测、故障告警、告警清除、设备恢复，以及策略层的只读转移建议。

执行完整测试：

```bash
cd /Users/a1/Documents/ChatGPT/mes/simulator
npm test
```

只执行故障闭环：

```bash
npm run build && node --test dist/strategy/four-line-drill.test.js
```

预期输出：

```text
ok - runs the four-line fault drill from telemetry to approved recovery advice
tests 1
pass 1
fail 0
```

验收链路为：

```text
12 条 device.telemetry + 4 条 agv.telemetry
→ LINE-03/WELD-01 产生 alarm.created
→ 策略输出 FAILOVER_TRANSFER
→ executionAllowed=false、requiresApproval=true
→ reset 清除故障并产生 alarm.cleared
→ WELD-01 与 LINE-03 恢复 RUNNING
```

演练 Fixture：

```text
/Users/a1/Documents/ChatGPT/mes/simulator/src/strategy/four-line-twin-snapshot.json
```

该目录保持独立，不依赖前端核心页面；后续可由后端采集适配层订阅 MQTT，再转发给 MES API、数字孪生页面或告警中心。
