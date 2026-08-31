# MES 最终交付运行手册

**负责人：** 赵丞  
**适用版本：** 核心 MES 试点版 v1.2 / 提交 `0cb50ea0`
**适用范围：** 单工厂、单车间、四条模拟产线；不包含 SaaS、Nanobot 原生集成和真实 PLC 控制。

## 1. 交付边界

### 1.1 开发/演示环境

本机运行前端、NestJS、四线模拟器、Mosquitto 和可选 PostgreSQL。允许故障注入和本地内存适配器，数据仅用于演示和回归。

### 1.2 生产试点环境

厂内服务器运行 ERPNext、PostgreSQL、ThingsBoard/Gateway、NestJS 和消息基础设施；浏览器或 Tauri 客户端只访问受控 API。生产试点在完成 M2-M5 退出条件前不得宣称已交付。

## 2. 环境要求

- Node.js、npm、Docker Engine/Docker Compose、`curl`、`nc`。
- 后端依赖已安装：`npm --prefix backend install`。
- 模拟器依赖已安装：`npm --prefix simulator install`。
- 前端依赖已安装：`npm --prefix third_party/threejs-factory-demo install`。
- PostgreSQL 和 Mosquitto 端口默认分别为 `5432`、`1883`；后端为 `3000`，前端为 `5173`。

## 3. 启动、查看和停止

在仓库根目录执行：

```bash
./scripts/dev-up.sh --infra --mqtt
./scripts/dev-status.sh
```

访问：

```text
前端：http://localhost:5173
健康检查：http://localhost:3000/api/v1/health
```

查看日志：

```bash
ls -la .runtime/logs
tail -f .runtime/logs/backend.log
tail -f .runtime/logs/simulator.log
```

停止应用但保留基础设施：

```bash
./scripts/dev-down.sh
```

停止应用和 Docker 基础设施：

```bash
./scripts/dev-down.sh --infra
```

如果使用桌面编排脚本：

```bash
./scripts/desktop.sh start --infra --mqtt
./scripts/desktop.sh status
./scripts/desktop.sh stop --infra
```

## 4. 交付前验证

### 4.1 不依赖外部设备的质量门禁

```bash
./scripts/verify-all.sh
npm --prefix backend run test:all -- --runInBand
npm --prefix simulator run check
npm --prefix third_party/threejs-factory-demo run build
```

### 4.2 运行时和 MQTT 验证

```bash
./scripts/verify-runtime.sh
```

该脚本覆盖服务启动、健康检查、浏览器 smoke、API、MQTT、故障闭环和 PostgreSQL 容器重启。当前 `DATABASE_ENABLED=false` 时，数据库重启检查不等于业务数据持久化恢复；必须单独完成 M2 验收。

### 4.3 浏览器/桌面验收

```bash
node scripts/browser-smoke.mjs
node scripts/desktop-smoke.mjs --app-dir=desktop
bash scripts/desktop.sh rebuild
```

人工验收必须确认：四条产线切换不串线、设备故障高亮、告警清除、按钮成功/失败反馈、数字孪生拖拽缩放、后端不可用时明确报错。

## 5. 故障演练

### 5.1 设备故障闭环

1. 启动 `./scripts/dev-up.sh --infra --mqtt`。
2. 在页面或测试接口选择产线和设备，注入故障。
3. 验证 `telemetry`、`alarm.created`、设备状态、产线状态和看板高亮。
4. 恢复同一设备，验证 `alarm.cleared`、状态恢复和其他产线不变。
5. 将日志和 API 响应保存到验收证据目录。

### 5.2 依赖故障

- 停止后端：页面必须显示接口失败，不得显示静态假数据。
- 重启 Mosquitto：验证订阅恢复、重复告警不增加。
- 重启 PostgreSQL：基础服务可恢复；业务恢复只有在 M2 持久化开关和迁移验收通过后才能判定。
- 启动第二次实例：必须拒绝端口冲突或复用已有进程。

## 6. 回滚与清理

出现数据对账不一致、重复报工/扣减、告警丢失、越权、设备事件无法恢复或核心 API 错误率超阈值时：

1. 停止新写入并保留日志、审计和失败事件。
2. 执行 `./scripts/dev-down.sh`，确认 PID、端口和子进程已清理。
3. 恢复上一版本应用、配置和数据库备份；禁止直接删表修复。
4. 使用 `MES_CORE=legacy` 或 `MES_CORE=shadow` 进入受控回退模式，并记录审批。
5. 重跑四线隔离、告警闭环、工单幂等和健康检查。

桌面包交付前还必须验证：升级失败能回到上一版本，配置和用户数据不丢失，客户端不携带生产密钥。

## 7. 证据归档

每次交付至少保存：

- Git commit、Node/npm/Docker 版本和配置摘要。
- `verify-all.sh`、`verify-runtime.sh`、前端 build 和桌面 smoke 输出。
- 启停日志、健康检查响应、MQTT 事件、故障闭环前后快照。
- 数据库迁移、备份恢复、回滚和权限拒绝测试结果。
- 操作者、时间、环境、产线、设备、工单、`traceId` 和证据文件路径。

## 8. 当前未完成事项

截至提交 `0cb50ea0`，以下事项仍不能标记为完成：ERPNext 真实旁路与四线对账、PostgreSQL 生产启用后的事务/重启恢复、ThingsBoard/Gateway 运行接入、质量/维修/库存/追溯完整持久化、正式身份与不可篡改审计、Tauri `.app/.dmg` 实机升级回滚。具体退出标准以 `docs/MES里程碑计划.md` 和 `docs/MES成熟功能域路线与端到端验收.md` 为准。
