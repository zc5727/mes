# MES 最终交付运行手册

**负责人：** 赵丞  
**适用版本：** 核心 MES 试点版 v1.5 / 提交 `c90eca7d`
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
./scripts/verify-runtime.sh --object-storage
```

该脚本覆盖服务启动、健康检查、浏览器 smoke、API、MQTT、故障闭环和 PostgreSQL 容器重启。最近一次实测在 `DATABASE_ENABLED=true` 下完成依赖 readiness、14 张表校验、迁移回滚和业务 smoke，但 PostgreSQL 重启后 Backend 健康检查失败，退出码 7；因此不能把该命令记为真实运行闭环通过。

### 4.3 浏览器/桌面验收

```bash
node scripts/browser-smoke.mjs
node scripts/desktop-smoke.mjs --app-dir=desktop
bash scripts/desktop.sh rebuild
```

真实 macOS 安装包验收：

```bash
scripts/verify-desktop-release.sh \
  --app=/path/to/MES.app \
  --dmg=/path/to/MES.dmg \
  --notary-profile=YOUR_KEYCHAIN_PROFILE
```

缺少 `.app/.dmg`、Apple 工具或公证凭据时必须记录 `BLOCKED`；不得用 desktop smoke、单元测试或本地开发窗口替代签名、公证、双击、三维交互和退出清理验收。

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
- `verify-desktop-release.sh` 的 app/dmg、签名、公证输出；缺少 Apple 环境时归档 `BLOCKED` 原因。
- 启停日志、健康检查响应、MQTT 事件、故障闭环前后快照。
- 数据库迁移、备份恢复、回滚和权限拒绝测试结果。
- 操作者、时间、环境、产线、设备、工单、`traceId` 和证据文件路径。

### 7.1 提交 c90eca7d 已具备的代码/测试证据

下表只记录仓库中确实存在的实现或测试文件，不等同于现场生产通过。本基线新增审计持久化边界、维修/质量/工单状态约束、策略治理 E2E、数据库运行时检查、迁移回滚检查入口和停机清理收口；它们仍需按第 8 节完成真实依赖与现场验收。

本轮 `./scripts/verify-all.sh` exit 0：Backend unit 39 suites / 123 tests、E2E 8 suites / 26 tests、Simulator 48 tests；后端构建、数据库 schema 校验、前端构建、前端契约 smoke 和 Tauri desktop smoke 均通过。`./scripts/mes-runtime.sh preflight` 通过；`verify --object-storage` 已完成 PostgreSQL/MQTT/MinIO readiness、14 张表校验、迁移回滚及 API/MQTT/故障/数字孪生 smoke，但 PostgreSQL 重启后 Backend 健康检查失败，退出码 7；不得宣称真实运行闭环通过。

| 能力 | 代码证据 | 测试/验证证据 | 当前判定 |
|---|---|---|---|
| 核心数据库迁移 | `backend/prisma/migrations/20260830000000_init`、`20260831000000_traceability`、`backend/src/database/core-persistence.service.ts` | `backend/test/core-persistence.unit.spec.ts`、`backend/test/foundation-persistence.unit.spec.ts` | 有代码与测试证据；真实启用和重启恢复未验证 |
| 库存持久化边界 | `backend/src/database/inventory-persistence.service.ts`、`backend/prisma/migrations/20260831020000_batch_inventory` | `backend/test/inventory-persistence.unit.spec.ts` | 有代码与测试证据；ERPNext 库存扣减、领退料和现场对账未验证 |
| 质量/维修/文档基础持久化 | `backend/src/database/foundation-persistence.service.ts` 及对应三个业务服务 | `backend/test/foundation-persistence.unit.spec.ts`、`backend/test/quality-maintenance-traceability.e2e-spec.ts` | 基础边界有证据；完整生产流程未完成 |
| 批次、序列号和物料批次校验 | `backend/src/work-orders/work-orders.service.ts`、`report-work-order.dto.ts` | `backend/test/orders-work-orders.unit.spec.ts`、质量/维修/追溯 E2E | 校验能力有证据；库存扣减和双向追溯未完成 |
| Agent 只读授权 | `backend/src/agent-api/agent-api.service.ts`、`strategy-authorization.service.ts` | `backend/test/agent-api.service.unit.spec.ts` | 授权拒绝和资源范围有测试；正式身份未接入 |
| 策略治理持久化 | `backend/src/strategies/strategy-persistence.service.ts`、`strategy-governance.service.ts` | `backend/test/strategy-governance.unit.spec.ts`、`agent-api.service.unit.spec.ts` | 模拟结果/审批记录有代码与测试；生产审批和数据库恢复未验证 |
| 主数据审计 | `backend/src/audit/audit.service.ts` 及主数据服务调用边界 | `backend/test/master-data-audit.unit.spec.ts` | 审计调用有测试；身份、不可篡改存储和现场拒绝未验证 |
| 运行时验证入口 | `scripts/verify-local.sh`、`scripts/verify-ci.sh`、`scripts/verify-runtime.sh` | 脚本本身存在；需保存实际执行输出 | 入口已具备；当前提交未据此宣称现场通过 |
| 运行时统一入口 | `scripts/mes-runtime.sh`、`backend/scripts/verify-db-runtime.mjs` | `scripts/verify-runtime.sh` | 可执行入口有代码；真实依赖、备份恢复和现场运行输出未验证 |

## 8. 生产化缺口清单与退出证据

以下清单按当前提交 `c90eca7d` 的代码和脚本核对；“基础接口/演示”不等于生产完成。每一项只有在右栏证据归档后才能关闭。本基线收口了运行时停机清理，并保留主数据/告警控制边界、维修模块装配、维修/质量/工单状态约束、策略治理 E2E、数据库 seed/运行时检查和迁移回滚检查入口；这些证据仍不能替代现场生产验收。

| 缺口 | 当前真实状态 | 关闭所需退出证据 |
|---|---|---|
| IQC/IPQC/OQC | 质量记录和表单基础接口；完整检验计划、抽检规则和放行流未完成 | 三类模板版本、合格/不合格/待复核状态机测试；检验记录关联工单/批次/设备/人员的 API 响应和审计日志 |
| NCR/CAPA | 未形成完整不合格隔离、原因、措施、复验和关闭闭环 | NCR→分派→CAPA→复验→放行/报废的 E2E 日志；越权放行拒绝结果；质量记录导出文件 |
| 维修计划/点检 | `backend/src/maintenance` 有基础维修对象和状态流转，计划保养、点检标准和逾期规则未完成 | 告警自动关联维修工单；计划保养触发、逾期、挂起、验证、关闭测试；MTBF/MTTR 报表及审计记录 |
| 维修备件 | 备件业务和库存扣减未完成 | ERPNext 领料/退料幂等响应、库存前后对账、重复事件不重复扣减的测试证据 |
| 对象存储 | 当前为 `local-document-storage.adapter` 本地适配器；对象存储、病毒扫描和保留策略未完成 | 生产对象存储配置、上传/下载权限测试、哈希校验、失败重试、备份恢复和生命周期策略记录 |
| 身份与权限 | 有角色、范围和策略授权演示边界；正式身份、SSO 和持久化授权未完成 | 登录/令牌验证、跨工厂/产线越权拒绝、服务账号最小权限和权限变更审计测试 |
| TLS 与消息安全 | MQTT/NestJS 本地联调可用；生产 TLS、证书轮换和 MQTT ACL 未完成 | TLS 握手与证书链输出、未授权主题发布/订阅拒绝、证书轮换演练和脱敏日志 |
| 升级 | 有版本和迁移原则文档；影子升级、灰度和数据库前滚未完成 | 发布包校验和 SBOM、备份、迁移前后校验、四线灰度监控及升级报告 |
| 回滚 | 有 `MES_CORE=legacy|shadow|erpnext` 回退设计；失败回滚尚无实机证据 | 人为制造对账失败或迁移失败，恢复上一版本/备份，验证事件不丢不重、四线隔离和恢复时限 |

### 8.1 缺口关闭记录模板

```text
缺口：
版本/commit：
环境：
执行时间：
操作者：
命令/API：
预期结果：
实际结果：
证据路径：
结论：PASS / BLOCKED / FAIL
复核人：
```

### 8.2 关闭规则

- 代码存在、接口可访问或单元测试通过，只能记录为“基础/演示”，不能关闭生产缺口。
- 每项至少需要代码或配置、自动化测试、运行日志/API 响应、人工或恢复演练证据中的必要组合；不能只凭截图。
- `BLOCKED` 必须写明外部条件，例如 ERPNext 实例、对象存储、证书、干净 macOS 安装环境或备份介质未提供。

## 9. 当前未完成事项

截至提交 `c90eca7d`，质量/维修约束、基础持久化恢复、策略治理和运行时依赖门禁已有代码/测试证据，但以下事项仍不能标记为完成：ERPNext 真实旁路与四线对账、PostgreSQL 生产事务/重启恢复、ThingsBoard/Gateway 运行接入、库存扣减、IQC/IPQC/OQC/NCR/CAPA 完整闭环、对象存储、正式身份/TLS 与不可篡改审计、Tauri `.app/.dmg` 实机升级回滚。具体退出标准以 `docs/MES里程碑计划.md` 和 `docs/MES成熟功能域路线与端到端验收.md` 为准。

## 10. c90eca7d 终极审计补充

本基线新增 Modbus TCP/OPC UA 协议桥接。它们仅作为可重复的隔离适配器，不包含真实 PLC 写入，也不能替代现场协议、网络、证书、权限和断线恢复验收。

本轮 `./scripts/verify-all.sh` exit 0：Backend unit 39 suites / 123 tests、E2E 8 suites / 26 tests、Simulator 48 tests，以及后端/前端构建和 Tauri desktop smoke 均通过。该结果只证明代码和隔离环境门禁通过；ERPNext、ThingsBoard/Gateway、真实设备、生产恢复和桌面实机仍需单独验收。

### 10.1 当前已验证 / 仍待现场总表

| 当前已验证 | 仍待现场或外部依赖 |
|---|---|
| 四产线模拟、MQTT telemetry/alarm、故障恢复、数字孪生 SSE/REST、Modbus/OPC UA 隔离桥接 | ThingsBoard/Gateway、真实 PLC/OPC UA/Modbus 设备、TLS/ACL 和断线恢复 |
| Backend unit 123、E2E 26、Simulator 48、构建、迁移校验、Tauri 结构 smoke | ERPNext 旁路对账、生产 PostgreSQL 重启恢复、备份恢复和并发压测 |
| 质量/维修/追溯/库存/策略治理基础接口和授权边界 | IQC/IPQC/OQC/NCR/CAPA 完整闭环、备件扣减、对象存储、正式身份和不可篡改审计 |
| 启停、readiness、单实例、逆序清理脚本级验证 | `.app/.dmg` 双击安装、签名、公证、窗口三维交互、升级回滚和生产发布 |
