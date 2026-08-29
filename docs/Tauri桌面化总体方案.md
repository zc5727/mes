# MES Tauri 桌面化总体方案

## 实施状态（2026-08-29）

当前仓库尚未创建可构建的 Tauri wrapper：未发现 `desktop/src-tauri`、`tauri.conf.json`、`Cargo.toml` 或包含 Tauri 脚本的 desktop `package.json`。因此目前状态为：

- Vue/Three.js Web 端：已有，可作为 Tauri WebView 的前置基线。
- 本地服务编排：已有 `scripts/dev-up.sh`、`dev-down.sh`、`dev-status.sh` 和 `desktop-smoke.mjs`，但启动脚本尚未完成 readiness 等待和桌面子进程监管。
- Tauri 客户端：未开始，T0 尚未通过。
- 演示桌面包：未生成，不能宣称已具备安装、卸载和桌面演示能力。
- 生产桌面包：未开始，不能进入签名、更新和部署验收。

基线检查命令：

```bash
cd /Users/a1/Documents/ChatGPT/mes
node scripts/desktop-smoke.mjs --app-dir=desktop
```

在 Tauri 工程创建前，预期结果为 `BLOCKED`/退出码 2；`--allow-missing` 只能用于 CI 基线扫描，不能作为桌面版通过证据。

当前已验证：Web 前端构建、入口/API smoke、Web 交互代码基线和本地服务脚本语法。

当前未验证：Tauri WebView、Rust command、安装包、桌面窗口交互、自动拉起/清理服务、单实例、签名更新和生产部署。

## 1. 目标与边界

将现有 Vue + Three.js 数字孪生前端封装为 Tauri 桌面客户端，降低厂长和现场用户的启动门槛；生产数据、MQTT、PostgreSQL、权限和审计能力仍集中部署在厂内服务器。

桌面端不是 MES 后端替代品：

- Tauri：界面、会话、客户端配置、连接状态、本地演示。
- NestJS：业务 API、权限、审计、策略和数据聚合。
- MQTT：设备遥测和告警传输。
- PostgreSQL：主数据、事件历史、告警生命周期和审计数据。
- 真实设备、PLC、采集网关：厂内网络。

本阶段不包含 SaaS、真实 PLC 写入、数据库直连、MQTT 管理直连或客户端自动控制。

## 2. 总体架构

Tauri Client（Vue + Three.js、REST/WSS、会话、环境配置）
  ↓ HTTPS / WSS
厂内应用服务器（NestJS API、MQTT ingestion、WebSocket、权限、审计、策略）
  ├─ PostgreSQL
  ├─ Mosquitto
  └─ 采集网关 / PLC / 真实设备

客户端只访问 NestJS，不直接访问 PostgreSQL、MQTT 管理端口或 PLC。

## 3. 开发演示版与生产版

### 开发演示版

适用于单机开发、客户演示和无设备测试：

- 允许 VITE_DATA_MODE=local。
- 允许固定 seed 的四产线模拟器。
- 可使用本机 NestJS、Mosquitto、PostgreSQL 测试容器。
- 支持本地故障注入和策略候选方案展示。
- 必须显示“演示数据”或“本地仿真”。
- 不得保存生产账号、数据库密码、MQTT 管理凭据。

### 生产部署版

适用于厂内正式运行：

- Tauri 客户端通过 HTTPS/WSS 连接厂内 NestJS。
- PostgreSQL、Mosquitto、采集网关和策略服务留在厂内服务器。
- 客户端只读展示和提交经过后端授权的请求。
- 不包含本地模拟器。
- 不允许客户端直连数据库、Broker 或真实设备。
- 不允许客户端绕过后端执行停线、复位或策略。

## 4. 服务部署边界

| 组件 | 演示版 | 生产版 | 说明 |
|---|---|---|---|
| Tauri 客户端 | 本机启动 | 用户电脑安装 | 只包含前端和系统能力 |
| Vue/Three.js | 随客户端打包 | 随客户端发布 | 与 API 契约绑定 |
| NestJS API | 本机可运行 | 厂内应用服务器 | 不随生产客户端启动 |
| MQTT ingestion | 本机可运行 | 厂内应用服务器 | 统一采集和校验 |
| Mosquitto | 本机测试容器 | 厂内服务器 | 生产必须 ACL/TLS |
| PostgreSQL | 本机测试容器 | 厂内服务器 | 客户端禁止直连 |
| 采集网关/PLC | simulator | 厂内网络 | 真实设备只由网关访问 |
| WebSocket gateway | 可选 | 厂内应用服务器 | 推送实时状态 |
| 本地模拟器 | 演示包可选 | 不随生产包启动 | 必须标明演示数据 |
| MinIO/对象存储 | 本机可选 | 厂内服务器 | 图纸和附件存储 |
| Nanobot | 不纳入本方案 | 后续独立部署 | 不影响客户端安全边界 |

## 5. 客户端运行模式

建议演示包和生产包分开构建，不允许普通用户在运行时随意切换环境。

MES Demo：

- local simulator
- mock/local API
- 无生产凭据
- 有演示水印

MES Factory：

- 厂内 API 地址
- WSS 地址
- 工厂/租户标识
- 认证配置
- 无本地 simulator

客户端启动页必须显示：

- 环境：演示、测试或生产。
- 数据来源：mock、simulator、mqtt 或 database。
- 当前工厂和租户。
- API、实时连接和数据新鲜度。
- 最近成功数据时间。
- 客户端版本和 API 契约版本。

禁止只显示“在线”，应分别显示 API、realtime、data freshness 和 degraded 状态。

## 6. Tauri 与 Rust 边界

Rust 只处理：

- 安全保存短期会话。
- 文件选择、导出和日志目录。
- 系统网络状态。
- 客户端版本、更新和崩溃日志。
- 必要的本地证书加载。

Rust 不处理：

- 设备状态聚合。
- 告警去重。
- OEE 计算。
- 策略决策。
- 数据库访问。
- MQTT 管理发布。
- 真实设备控制。

## 7. 打包策略

### 演示包

- macOS：dmg/app
- Windows：msi/exe
- Linux：AppImage/deb
- 可带固定 seed 和本地模拟器配置。
- 必须显示演示模式。

### 生产包

- 各操作系统独立构建和签名。
- 不包含模拟器、测试账号、数据库密码和 Broker 管理凭据。
- 使用代码签名、安装包校验和签名更新。
- 通过厂内文件服务器或企业软件分发。
- 自动更新必须支持版本回滚。

### 配置规则

编译环境标识 < 安装包只读默认配置 < 管理员签名配置。

生产 API 地址可由安装配置或管理员配置文件提供，但不能允许普通用户改到任意外网地址。

## 8. 开发阶段

| 阶段 | 周期 | 交付 |
|---|---:|---|
| T0 客户端壳 | 1-2 天 | 初始化 Tauri、嵌入 Vite、版本显示、基础打包 |
| T1 API 桌面化 | 2-3 天 | REST、租户、数据源、断线提示 |
| T2 实时连接 | 2-4 天 | WSS、snapshot、增量事件、重连 |
| T3 演示包 | 1-2 天 | local 模式、固定 seed、故障演练 |
| T4 生产包 | 3-5 天 | 签名、正式配置、更新、回滚、日志 |

## 9. 交付验收矩阵

| 编号 | 验收项 | 演示版 | 生产版 |
|---|---|---|---|
| T01 | 客户端启动 | 页面正常打开 | 登录和主页正常 |
| T02 | 数据来源 | 显示 local/mock | 显示 API/mqtt/database |
| T03 | 四产线 | 可切换 | 按权限切换 |
| T04 | 设备详情 | 模拟或 API | API/WSS 数据 |
| T05 | 故障演练 | 本地可注入 | 只读显示真实告警 |
| T06 | 控制权限 | 禁止真实控制 | 后端审批后执行 |
| T07 | API 断线 | 明确演示/离线状态 | 自动重连并提示 |
| T08 | WSS 重连 | 可选 | 必须通过 |
| T09 | 更新回滚 | 可重新安装 | 签名更新和回滚 |
| T10 | 凭据检查 | 无生产凭据 | 无 DB/MQTT 管理凭据 |
| T11 | 日志 | 本地诊断 | 脱敏、可定位、可清理 |
| T12 | 数据隔离 | 演示租户 | 租户和权限隔离 |

## 10. 风险清单

### P0

1. 将 NestJS、数据库或 Broker 随生产客户端启动，造成数据不一致和权限失控。
2. 客户端保存设备写入凭据或数据库密码。
3. 演示模式自动连接生产 API，或生产模式自动回退 mock。
4. 客户端显示旧数据却没有来源和更新时间。
5. 客户端绕过后端执行设备控制。

### P1

1. Tauri 客户端与 API 版本不兼容。
2. WSS 重连后没有完整 snapshot，导致三维残留状态。
3. 客户端缓存跨用户或跨租户复用。
4. 自动更新没有签名验证和回滚。
5. HTTPS/WSS 证书、代理和 DNS 配置不一致。
6. 本地日志泄露 token、设备地址或生产数据。

### P2

1. 多屏、高 DPI 和缩放下 Three.js 布局异常。
2. WebGL 不可用时没有二维降级页面。
3. 包体过大导致安装和更新缓慢。
4. macOS/Windows 文件权限差异导致导出和日志失败。

## 11. 最终建议

第一版采用：

Tauri 只做客户端壳；
Vue/Three.js 复用现有前端；
NestJS、MQTT、PostgreSQL 部署在厂内服务器；
演示版允许本地 simulator；
生产版禁止本地 simulator 和 Broker 直连。

核心原则：

> 客户端随用户走，数据和控制能力留在厂内服务器。
