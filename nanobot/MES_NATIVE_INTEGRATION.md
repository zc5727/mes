# MES 原生 Nanobot 集成

本目录内置本地 nanobot 源码，作为 MES 智能秘书运行时，不通过外部安装包依赖源码。

## 集成边界

- nanobot 负责对话、工具编排和会话运行时。
- MES 后端负责设备、产线、告警、工单、仿真和策略数据。
- 第一阶段只注册只读 MES 工具，不允许直接控制设备、停线或修改工单。
- 工具调用统一通过 `backend/src/agent-api` 的 Tool API，并携带 `tenantId`、`requestedBy`、`traceId`。

## 源码位置

- Nanobot runtime: `nanobot/nanobot/`
- Python project metadata: `nanobot/pyproject.toml`
- MES tool contract: `backend/src/agent-api/tool-contract.ts`
- MES tool API: `POST /api/v1/agent-api/tools/execute`

## 阶段 8 原生工具

`nanobot/nanobot/agent/tools/mes.py` 使用 nanobot 内置 `ToolLoader` 自动发现
8 个只读工具。工具统一调用 MES Tool API，并自动补齐 `tenantId`、
`requestedBy` 和 `traceId`。

配置示例（合并到 `~/.nanobot/config.json`）：

```json
{
  "tools": {
    "mes": {
      "enable": true,
      "baseUrl": "http://127.0.0.1:3000/api/v1/agent-api/tools/execute",
      "tenantId": "tenant-demo",
      "requestedBy": "nanobot",
      "timeoutSeconds": 10
    }
  }
}
```

`traceId` 优先使用当前 nanobot turn ID，否则自动生成。工具只提供查询与
分析；启动/停止设备、停线、修改工单、修改告警、执行策略和发布 MQTT
控制消息均不会注册。
