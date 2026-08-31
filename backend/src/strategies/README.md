# 策略故障演练

策略引擎只对生产快照进行确定性计算，输出候选方案和推荐方案，不执行设备控制、不修改工单，也不会自动停线。所有候选方案都必须人工审批，`requiresApproval` 固定为 `true`。

## 四产线演练链路

测试 Fixture：`backend/test/fixtures/strategy-four-line-fault.json`

1. `LINE-03` 的 `WELD-01` 告警、`WELD-02` 离线。
2. `WO-WELD-001` 剩余数量较高且临近交期，系统识别设备风险和延期风险。
3. 策略引擎生成 `transfer_work_order` 候选，将工单从 `LINE-03` 建议转移到可用产线。
4. 演练测试将设备恢复为在线、工单置为暂停，仅构造新的仿真快照；系统生成 `schedule_recovery` 建议。

该过程只验证“故障—风险—建议—恢复建议”的闭环，不代表系统已经执行转移或恢复操作。

## 治理与结果追踪

每次正式 API 调用都会记录租户、调用人、仿真 ID、快照时间、候选数量、推荐动作和审批边界。当前结果追踪表为进程内持久化实现，按租户隔离；后续可在不改变 API 契约的前提下替换为数据库仓储：

```text
GET /api/v1/strategies/simulations/:simulationId
GET /api/v1/strategies/audit-records
GET /api/v1/strategies/history
GET /api/v1/strategies/simulations/:simulationId/approvals
POST /api/v1/strategies/simulations/:simulationId/replay
POST /api/v1/strategies/simulations/:simulationId/rollback
POST /api/v1/strategies/simulations/:simulationId/execute
```

启用 PostgreSQL 时执行 `npm run db:migrate` 应用 `20260831_add_strategy_governance`，为 `strategy_runs` 增加治理投影列，支持历史、审批和回放恢复。

记录明确标记 `requiresApproval=true` 和 `executionAllowed=false`。这些接口只能读取仿真结果与调用记录，不提供设备控制或工单修改能力。

正式仿真请求建议携带 `Idempotency-Key`。同一租户、同一 key 和同一快照会重放原结果，不重复创建审计和审批；同一 key 复用但快照不同会返回冲突。回滚接口只丢弃仿真建议并保留结果与审计轨迹，不回写设备、工单或产线。

审批状态通过仿真专属接口读取，返回该仿真产生的审批记录（`pending`、`approved` 或 `rejected`）。审批决定不会触发策略执行；策略模块没有设备控制或工单写回能力。

## Agent 受控访问

本地 nanobot 只能调用 `backend/src/agent-api/tool-contract.ts` 中的只读白名单：生产概览、产线/设备/告警/工单查询、仿真快照、策略结果、策略历史和审批状态。Agent 的策略结果优先从 `StrategyGovernanceService` 按租户读取，不能绕过治理层调用设备服务的写入方法；未知工具和任何控制类工具都会返回 `UNKNOWN_TOOL`。

## OpenMES 映射边界

`openmes-snapshot.adapter.ts` 只负责把外部 OpenMES 风格的产线、设备和工单状态映射为 `StrategySnapshot`：

- 读取 `factoryId`、产线状态、设备状态、工单计划/完成数量和交期
- 计算只读的 `remainingQty`
- 校验产线引用、设备引用、工单数量和时间戳
- 不映射控制命令、写回接口或审批动作

策略引擎的唯一输出仍是仿真建议；外部 MES 状态不会被策略层修改。

## ERPNext 工单映射

`erpnext-work-order.adapter.ts` 只读取 ERPNext Work Order 的 `name`、`qty`、`produced_qty`、`planned_end_date`、`priority`、`status` 和产线扩展字段，转换为策略引擎所需的 `StrategyWorkOrder`。它不重复实现订单业务，也不调用 ERPNext 写接口。

```text
ERPNext Work Order
  → mapErpNextWorkOrders()
  → StrategySnapshot.workOrders
  → 故障转移 / 负载均衡 / 延期风险仿真
```

`mergeErpNextWorkOrders()` 只替换仿真输入快照中的工单投影，原始 MES 快照保持不变。

## 审批与回滚语义

候选方案生成后即标记 `requiresApproval=true`，API 层先完成身份、角色和资源范围校验，再记录仿真审计。`impactAssessment.rollbackPlan` 的语义是丢弃仿真副本并恢复 `workOrders`、`lines`、`devices` 的未变更状态；它不是设备反向控制，也不会向外部 MES 写回。

## M4 统一结果与权限边界

五类候选统一返回 `score`、`scoreBreakdown` 和 `impactAssessment`；仿真结果同时回显只读 `snapshot`、聚合影响评估、`requiresApproval=true` 和 `executionAllowed=false`。高风险候选会创建 `pending` 审批记录，审批不等于执行，当前模块没有真实设备或工单控制调用。

HTTP 仿真和结果查询必须携带 `x-user-id`、`x-role`、`x-factory-id`、`x-scope`、`x-session-id`、`x-trace-id`。后端校验角色、工厂和产线/设备/工单范围；策略调用审计包含 `operator`、`object`、`before`、`after`、`reason`、`traceId`、`result`。

## 验证命令

```bash
cd backend
npm test -- --runInBand --runTestsByPath test/strategy-fire-drill.unit.spec.ts test/strategy-recovery.unit.spec.ts
npm run build
```
