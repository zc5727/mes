# MES 仿真控制台

独立的仿真设备控制入口，默认运行在 `http://127.0.0.1:5174`。控制台只通过 MES API 提交仿真命令，不把本地设备状态复制到孪生页面。

```bash
npm install
npm run dev -- --port 5174
```

## 可直接执行的联调

先启动后端、MQTT Broker（如使用 MQTT），再启动模拟器和本控制台：

```bash
# terminal 1: MES backend
cd /Users/a1/Documents/ChatGPT/mes/backend
npm run start:dev

# terminal 2: simulator; no MQTT_URL means JSON stdout
cd /Users/a1/Documents/ChatGPT/mes/simulator
npm run dev -- --seed 20260828 --time-scale 5 --agv-telemetry

# terminal 3: simulator console
cd /Users/a1/Documents/ChatGPT/mes/simulator-ui
npm run dev -- --port 5174
```

如果已运行本地 Broker，可将 terminal 2 改为：

```bash
MQTT_URL=mqtt://127.0.0.1:1883 npm run dev -- --seed 20260828 --time-scale 5
```

控制台地址为 `http://127.0.0.1:5174`，通过 MES API 读取设备注册表并提交控制命令；它不维护第二份设备状态，也不把 synthetic contract 宣称为 Siemens、FANUC 或其他真实厂商驱动。

可配置：

- `VITE_API_BASE_URL`：MES API 基地址，默认 `http://127.0.0.1:3000/api/v1`
- `VITE_TENANT_ID`：租户，默认 `tenant-demo`

## 当前联动范围

- 设备列表、产线、协议/状态展示；设备注册表由 MES 设备 API 负责；
- 全局启动/停止、单设备 Start/Stop/Pause/Resume/Reset；
- CNC 故障注入：主轴过载、主轴过热、通信中断、刀具损坏；
- “导出快照”通过 `/simulator/control` 提交 snapshot 命令；场景文件保存/回放由 simulator 的 `exportScenario()`、`loadScenarioDocument()` 和 `exportReplay()` 提供。

控制台操作链路是：控制台 → MES API 权限/审计 → MQTT 或 simulator 控制主题 → simulator → canonical telemetry。孪生页面只消费接入后的状态，不在本页面创建第二套仿真状态。

## 端口冲突与停止清理

默认端口：MES `3000`、孪生页面 `5173`、本控制台 `5174`、MQTT `1883`、OPC UA `4841`、Modbus TCP `1502`、MTConnect `5000`。前端端口冲突时：

```bash
lsof -nP -iTCP:5174 -sTCP:LISTEN
npm run dev -- --port 5175
```

协议 smoke 会在成功或失败后清理本地 server；产线模拟器用 `Ctrl+C` 清理 timer 和 publisher。若异常中断，先用 `lsof` 确认 PID 属于本次进程，再停止，不要直接清理其他服务。

## 故障注入与回放验收

```bash
cd /Users/a1/Documents/ChatGPT/mes/simulator
npm run dev -- --seed 20260828 --time-scale 1 --scenario examples/fault-replay-scenario.json
```

验收点：第 2 个仿真秒生成 `alarm.created` 并使 `cnc-01`/`line-cnc` 进入故障态；第 6 个仿真秒生成 `alarm.cleared` 并恢复。需要检查回放时，在模拟器 stdin 输入 `replay`，确认输出包含场景事件和有序帧。相同种子、场景和操作序列必须得到相同业务数据；协议地址、节点和数据项均为 simulator synthetic contract，不代表真实厂商兼容性。
