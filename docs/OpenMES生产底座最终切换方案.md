# OpenMES 生产底座切换方案（已被 ERPNext 方案取代）

> 本文保留为历史评估记录，不再作为当前架构依据。当前生产底座以 `docs/ERPNext生产底座最终切换方案.md` 为准。

**负责人：** 赵丞  
**适用版本：** MES 核心试点版 v1.1 及后续版本  
**更新日期：** 2026-08-31  
**切换原则：** 先旁路验证、再按产线灰度，任何时刻可回退到现有 NestJS 内存/Prisma 适配层。

## 1. 决策结论

将 **OpenMES** 作为生产执行底座候选，并逐步承接生产订单、工单、批次、质量、停机和追溯；不直接把 OpenMES 前端替换为用户现有界面。

保留现有：

- 数字孪生与专业看板前端；
- NestJS Integration API；
- NestJS Agent Gateway（只读工具和受控建议）；
- 当前四条产线模拟器；
- MQTT 采集、故障注入和回放链路。

新增边界：

- **OpenMES：** 生产执行、工单、批次、质量和生产审计的业务事实源；
- **ThingsBoard：** 设备注册、遥测、设备属性、IoT 规则和设备告警的 IoT 事实源；
- **NestJS Integration：** 防腐层、字段映射、幂等、权限、事件编排、数字孪生读模型和兼容旧 API；
- **Agent Gateway：** 面向智能助手的只读查询、仿真建议和审批入口，不直连 OpenMES/ThingsBoard 数据库。

OpenMES、ThingsBoard 和现有系统均通过公开 API、Webhook 或 MQTT 连接，禁止跨系统直接写数据库。

## 2. 目标架构

```text
厂长/主管/班组长/操作员
          │
现有数字孪生前端、专业看板、表单
          │ REST/WebSocket
          ▼
NestJS Integration API ─── Agent Gateway
  │ 统一身份、权限、审计、幂等、事件编排、读模型
  ├──────────────┬────────────────┐
  │              │                │
  ▼              ▼                ▼
OpenMES      ThingsBoard       PostgreSQL Read Model
生产执行事实源  IoT/遥测事实源       孪生、OEE、跨域查询
  ▲              ▲
  │ REST/Webhook │ MQTT/HTTP
  └───────┬──────┘
          ▼
当前四条产线模拟器 / 未来边缘驱动中心
```

### 2.1 数据归属

| 数据域 | 权威系统 | NestJS 责任 |
|---|---|---|
| 工厂、产线、工位、设备映射 | OpenMES + ThingsBoard 设备映射 | 维护跨系统 ID 映射和一致性检查 |
| 工单、工序、批次、报工 | OpenMES | 兼容 API、权限、事件投影 |
| telemetry、设备属性、连接状态 | ThingsBoard | 校验、转换、当前状态读模型 |
| 设备告警 | ThingsBoard | 映射到 MES 告警，并关联工单/产线 |
| 质量记录与放行 | OpenMES | 提供前端统一查询和审计 |
| 数字孪生快照、OEE | NestJS Read Model | 从两侧事件构建，不反向成为生产事实源 |
| 策略候选和审批 | NestJS | 只输出建议，审批后仍通过受控 API 操作 |

## 3. 接入边界

### 3.1 MQTT / ThingsBoard

- 模拟器继续发布现有 MQTT topic，作为契约测试源。
- ThingsBoard 作为真实设备 MQTT 接入和设备遥测入口。
- NestJS 只消费统一事件，不依赖 ThingsBoard 内部数据库。
- 统一事件必须保留 `messageId`、`deviceId`、`sourceDeviceId`、`lineId`、`eventType`、`occurredAt`、`receivedAt`、`sequence`、`quality`、`traceId` 和 `metrics`。
- 设备写入能力默认关闭；ThingsBoard rule chain 和 NestJS 控制 API 不得绕过权限/审批。

### 3.2 OpenMES

- 通过 OpenMES REST API、Webhook 或其公开扩展点同步业务数据。
- NestJS 负责现有前端 API 兼容，不让前端直接绑定 OpenMES 响应格式。
- OpenMES 的业务主键与现有 `lineId`、`deviceId`、`workOrderId` 通过映射表关联。
- OpenMES 不直接读取 ThingsBoard 数据库；设备状态通过统一事件或 Integration API 注入。

### 3.3 Agent Gateway

- 只调用 NestJS Integration API。
- 可查询产线、设备、告警、工单、OEE 和策略仿真结果。
- 高风险操作只创建审批草稿，不直接执行设备控制。
- 每次调用记录 `operator`、`object`、`reason`、`traceId`、`sessionId` 和结果。

## 4. 回退策略

通过配置切换生产底座，不在前端写死：

```text
MES_CORE=legacy       现有 NestJS 内存/Prisma 适配层
MES_CORE=openmes      OpenMES 作为生产执行事实源
MES_CORE=dual-read    OpenMES 与旧读模型比对，不执行双写
```

切换规则：

1. 初始使用 `legacy`，OpenMES 只读镜像。
2. `dual-read` 连续通过一致性检查后，按产线切换工单查询和报工。
3. 任意出现数据漂移、重复报工、权限绕过、事件延迟或 OpenMES 不可用，立即停止灰度并回到 `legacy` 读路径。
4. 回退期间保留 OpenMES 已提交记录，不删除、不反向覆盖；由对账任务生成差异清单后再处理。
5. ThingsBoard 不可用时，保留最后可信设备状态并标记 `dataSource` 与离线时间；不得伪造在线状态。

## 5. 迁移顺序

### P0：基线和许可证

- 固定 OpenMES commit/tag、容器镜像摘要和配置清单。
- 导出 OpenMES API、Webhook、事件和角色矩阵。
- 建立组件、依赖、许可证、版权和 NOTICE 清单。
- 明确 OpenMES 当前仓库标注为 AGPL-3.0；商业再分发前必须由法务确认网络交互、修改、衍生作品、源码提供和 NOTICE 义务。

### P1：旁路部署

- 在独立数据库和端口启动 OpenMES，不接生产控制。
- 导入四条产线、设备、基础产品和演示工单副本。
- NestJS 新增 OpenMES adapter，但默认不启用。
- 用同一组固定 seed 对比旧 API、OpenMES API 和数字孪生读模型。

### P2：主数据映射

- 先同步工厂、车间、产线、设备和产品。
- 只允许一侧成为写入来源；迁移阶段指定 OpenMES 为生产业务主数据源，ThingsBoard 为设备主数据源。
- 所有跨系统对象必须有 `externalSystem`、`externalId`、`sourceVersion` 和最后同步时间。

### P3：工单影子运行

- 订单、工单、派工、报工只在测试租户/模拟器运行。
- 比对状态机、数量、批次、质量和审计结果。
- 连续完成四条产线故障、恢复、重复报工、断线重连和重启恢复演练。

### P4：按产线灰度切换

```text
line-cnc → line-assembly → line-welding → line-vision
```

每条产线必须通过：工单查询、开工/暂停/恢复、报工幂等、质量关联、告警关联、数字孪生刷新和回退演练，才允许进入下一条。

### P5：冻结和扩展

- 完成全量回归、备份恢复、权限审计和运行手册。
- 冻结 OpenMES 与 ThingsBoard 版本。
- 后续再评估 Modbus、OPC UA、MTConnect 和厂商 SDK Sidecar。

## 6. 许可证和供应链要求

- OpenMES 仓库当前标注为 **AGPL-3.0**；以实际锁定 commit 中的 LICENSE、依赖许可证和镜像内容为最终依据。
- 不得把 OpenMES 代码复制进现有 NestJS 或前端后再声称“仅内部使用”。
- 保留原版权、LICENSE、依赖 NOTICE、修改记录和源码获取说明。
- 每次升级执行 SBOM、漏洞扫描、许可证扫描和镜像摘要校验。
- ThingsBoard、MQTT broker、驱动和前端依赖分别建立许可证记录，不能用 OpenMES 的许可证结论替代其他组件审查。
- 商业交付、SaaS 化或对外提供网络服务前必须进行专门法律审查；本文件不构成许可证法律意见。

## 7. 最小验收矩阵

| 验收 | 必须证据 | 失败处理 |
|---|---|---|
| OpenMES API 可用 | 健康检查、版本、角色、工单 CRUD | 保持 legacy |
| ThingsBoard 接入 | MQTT telemetry、告警、断线重连 | 保留最后可信状态并标记离线 |
| 字段一致性 | 四线 ID 映射和快照比对报告 | 禁止灰度下一条产线 |
| 工单闭环 | 开工、暂停、报工、完成和重复请求测试 | 回退旧读路径，冻结写入 |
| 数字孪生 | 状态、告警、OEE、来源和时间戳 | 禁止静态数据兜底 |
| 权限审计 | 未授权拒绝、审批、traceId 和结果 | 立即关闭控制入口 |
| 回退 | 断开 OpenMES 后仍可查询 legacy | 恢复 `MES_CORE=legacy` |

## 8. 下一阶段入口

下一阶段只做 **P0/P1：OpenMES 锁版本、许可证清单、旁路部署、只读 adapter 和四线字段对账**。在旁路对账和回退演练通过前，不切换生产工单写入，不引入 SaaS，不接 Nanobot，不开放真实设备自动控制。
