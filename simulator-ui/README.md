# MES 仿真控制台

独立的仿真设备控制入口，默认运行在 `http://127.0.0.1:5174`。控制台只通过 MES API 提交仿真命令，不把本地设备状态复制到孪生页面。

```bash
npm install
npm run dev -- --port 5174
```

可配置：

- `VITE_API_BASE_URL`：MES API 基地址，默认 `http://127.0.0.1:3000/api/v1`
- `VITE_TENANT_ID`：租户，默认 `tenant-demo`

当前版本覆盖设备列表、协议/状态展示、全局启动/停止、单设备状态机命令和 CNC 故障注入；设备注册表仍由 MES 设备 API 负责，后续接入 Profile 表单和场景编排。
