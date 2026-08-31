# ERPNext 生产底座最终切换方案

**负责人：** 赵丞  
**更新日期：** 2026-08-31  
**当前定位：** ERPNext 负责生产业务逻辑；ThingsBoard/Gateway 负责设备接入；现有 NestJS 负责集成、Agent、权限和策略；现有数字孪生前端保持不变。

## 1. 架构决策

```text
数字孪生前端 / 专业看板 / 表单
                │ REST/WebSocket
                ▼
NestJS Integration + Agent Gateway
  防腐层 · ID映射 · 统一事件 · 权限 · 审计 · 策略仿真
          │                         │
          │ REST/Webhook             │ MQTT/HTTP
          ▼                         ▼
ERPNext                        ThingsBoard / Gateway
生产订单、工单、工序、报工、质量、批次      设备接入、遥测、连接、设备告警
          │                         │
          └──────── 统一事件/读模型 ────────┘
                         │
                         ▼
                 PostgreSQL 孪生读模型
```

### 1.1 数据主责

| 数据域 | 主责系统 | NestJS 责任 |
|---|---|---|
| 订单、工单、工序、派工、报工 | ERPNext | 兼容现有 API、权限校验、状态投影 |
| 质量记录、批次、生产追溯 | ERPNext | 统一查询、审计和前端适配 |
| 设备注册、连接、遥测、属性 | ThingsBoard/Gateway | 协议适配、统一事件、健康和离线状态 |
| 设备告警 | ThingsBoard/Gateway | 映射设备/产线/工单关系 |
| 数字孪生、OEE、跨域看板 | NestJS 读模型 | 从 ERPNext 与设备事件构建，不作为生产事实源 |
| 策略候选、审批和审计 | NestJS | 只读仿真、审批门禁、全链路审计 |

## 2. 系统边界

- 前端继续调用 NestJS，不直接绑定 ERPNext 或 ThingsBoard 响应格式。
- ERPNext 不直接访问 ThingsBoard 数据库；设备数据通过 Gateway、MQTT、Webhook 或 NestJS 接口进入。
- ThingsBoard/Gateway 不负责工单、报工、质量放行和批次业务。
- NestJS 不复制 ERPNext 的订单/工单状态机，不在自身内存中形成第二套生产事实。
- Agent Gateway 只调用 NestJS 集成接口；策略默认只给建议，不能直接控制真实设备。
- 当前四条产线模拟器继续使用现有 MQTT 契约，作为 ERPNext/Gateway 迁移的回归源。

## 3. 同步策略

### 3.1 业务数据

1. ERPNext 为订单、工单、工序、报工、质量和批次的唯一写入主责。
2. NestJS 通过 REST/Webhook 建立 `erpnextId ↔ mesId` 映射，不跨库写入。
3. 每个 MES 租户必须显式映射到 ERPNext `company`；查询使用公司过滤，报工固定写入映射公司，缺失映射时 fail-closed。
4. Webhook 事件使用 `messageId`、`traceId` 和 `occurredAt` 做幂等与乱序保护。
5. 同步失败进入可重试队列并记录失败原因，禁止静默丢弃。
6. 对账任务按订单、工单、数量、状态、批次和质量结果生成差异清单。

### 3.2 设备数据

1. Gateway/ThingsBoard 接收 MQTT、HTTP 和后续 Modbus/OPC UA 驱动数据。
2. 所有设备数据先转换为统一事件，再更新 NestJS 当前状态和告警读模型。
3. 设备事件至少包含 `messageId`、`deviceId`、`sourceDeviceId`、`lineId`、`eventType`、`occurredAt`、`receivedAt`、`sequence`、`quality`、`metrics` 和 `traceId`。
4. 设备状态只允许按时间戳/序列号前进，断线时保留最后可信值并标记离线。

## 4. 失败回退

```text
MES_CORE=legacy       现有 NestJS 内存/Prisma 演示路径
MES_CORE=shadow       ERPNext 旁路写入/只读对账
MES_CORE=erpnext      ERPNext 生产业务主责
```

- 初始为 `legacy`，ERPNext 仅旁路同步。
- `shadow` 连续完成四条产线对账、重复报工、故障恢复和权限测试后，才允许灰度。
- 任意出现重复报工、数量不一致、状态回退、权限绕过、Webhook 堵塞或数据不可追溯，立即切回 `legacy` 读路径并暂停业务写入。
- 回退不删除 ERPNext 已提交数据；差异由对账任务处理。
- ThingsBoard/Gateway 故障时，页面展示最后可信状态、离线时间和 `dataSource`，不得伪造在线。

## 5. 许可证与供应链

- ERPNext 官方仓库当前标注 GPL-3.0；切换时必须锁定 commit/tag、镜像摘要和依赖清单。
- 保留 ERPNext、Frappe Framework、ThingsBoard、Gateway、MQTT broker 及前端依赖各自的 LICENSE、版权和 NOTICE。
- 发布前执行 SBOM、漏洞扫描、许可证扫描、镜像来源校验和源码提供义务审查。
- 不把 ERPNext 代码复制到 NestJS 或前端；通过 API、Webhook、扩展应用和适配器集成。
- 商业交付或对外提供网络服务前，按锁定版本逐项复核 GPL 及其他依赖许可要求。

## 6. 上线步骤

### P0：冻结和旁路

- 锁定 ERPNext/Frappe、ThingsBoard/Gateway 和 MQTT 版本。
- 建立角色、字段、状态、ID 映射和许可证清单。
- 独立部署 ERPNext 与 ThingsBoard，不接真实设备写入。

### P1：四线影子运行

- 导入四条产线、设备、产品和演示工单。
- 用现有模拟器持续产生 telemetry、告警、报工和质量事件。
- NestJS 同时读取 legacy 与 ERPNext/ThingsBoard，输出字段和状态对账报告。

### P2：业务灰度

```text
line-cnc → line-assembly → line-welding → line-vision
```

每条产线必须通过订单→工单→派工→报工→质量→完成、故障→告警→恢复、权限和回退演练后，才切换下一条。

### P3：冻结发布

- 完成备份恢复、失败重试、权限审计、桌面服务编排和全量回归。
- 将 `MES_CORE=erpnext` 作为生产试点配置，保留 `legacy` 回退包和回退手册。
- Modbus、OPC UA、MTConnect 和厂商 SDK Sidecar 作为后续设备接入路线，不阻塞本次底座切换。

## 7. 退出条件

- ERPNext 生产业务数据与现有 API 对账一致。
- ThingsBoard/Gateway 可持续提供遥测、告警、连接状态和质量码。
- NestJS Integration 可统一查询、审计、限权和回退。
- 现有数字孪生前端无需改动即可显示四条产线动态状态。
- 四条产线完成灰度、故障恢复、重复请求、断线重连和回退演练。
- 许可证、备份、监控、日志和运行手册齐全。
