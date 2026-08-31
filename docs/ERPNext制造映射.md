# ERPNext Manufacturing 与 MES 生产域映射

本项目将 ERPNext Manufacturing 作为业务逻辑参考和外部业务系统候选，不删除现有 MES API，也不把 ERPNext 字段直接暴露给前端。

## 1. 核心对象映射

| ERPNext | MES 当前对象 | 映射原则 |
|---|---|---|
| Item | product 主数据 | productCode 作为稳定业务编码 |
| BOM | 工艺路线/物料清单 | 后续由版本化工艺模型承载 |
| Operation | process / 工序 | 工序顺序、标准工时、质量点独立保存 |
| Workstation | 工位/设备组 | MES lineId 是产线，设备和工位不混为一层 |
| Work Order | WorkOrder | ERP 外部单号进入 externalId，不替换 MES 内部 id |
| Job Card | 工序级执行记录 | 当前 report 是工单级最小报工，后续按 operation 拆分 |
| Stock Entry / WIP | WIP / 物料事务 | 暂不接库存扣减，禁止在报工接口中伪造库存结果 |
| Quality Inspection | QualityRecord | 检验记录绑定 workOrderId、batchNo、lineId |

ERPNext 的 BOM 可包含物料和制造操作；Work Order 根据 BOM 生成操作；Job Card 对具体工序和 Workstation 记录实际生产。这对应 MES 的“工艺路线→工单→工序执行→报工”分层，而不是把所有信息塞进一个工单表。

## 2. 当前 API 适配边界

当前保留：

- 内部 id：MES 生成，作为本系统主键。
- orderNo / 工单号：MES 业务单号，租户内唯一。
- externalId：ERPNext 文档名或外部单号。
- externalSystem：例如 ERPNext、SAP 或其他来源。
- sourceTraceId：设备或接口报工幂等键。

外部同步必须遵守：

1. 以 tenantId + externalSystem + externalId 做外部对象唯一键。
2. 同一外部对象重复同步使用 upsert，不重复创建订单或工单。
3. 外部状态先通过适配器映射为 MES 状态，再进入 MES 状态机。
4. ERPNext 的 submitted、in process、completed、cancelled 不直接覆盖 MES 状态。
5. 外部同步失败不能改变本地已确认的报工和质量记录。
6. 外部系统不能绕过 MES 权限、审批和审计直接控制设备。

## 3. 状态映射建议

| ERPNext 语义 | MES 状态 | 备注 |
|---|---|---|
| Draft | draft | 可编辑 |
| Submitted | released | 已发布，等待执行 |
| In Process | in_progress | 允许报工 |
| On Hold | paused | 必须记录原因 |
| Completed | completed | 数量和质量条件满足 |
| Cancelled | cancelled | 终态，不恢复 |

Job Card 的开始、完成和时间日志应映射为工序执行记录；不能直接把 Job Card 完成当作整张工单完成，必须聚合所有必要工序的完成数量。

## 4. 数量与追溯规则

- Work Order plannedQty 对应 ERPNext 制造数量。
- MES completedQty 只能由报工事实累计，不接受外部任意覆盖。
- goodQty、defectQty 必须满足 goodQty + defectQty = quantity。
- batchNo 和 serialNumbers 作为报工追溯字段保存。
- 返工使用新报工记录或返工工单，禁止修改原始报工。
- 拆分/合并必须保留 parentWorkOrderId、childWorkOrderId 和变更原因。
- 产线、设备、工位和工序必须分层，不能用 lineId 替代全部制造资源。

## 5. 后续接入验收

1. 外部订单重复同步不产生重复 MES 订单。
2. 外部工单找不到有效产线时同步失败并记录原因。
3. ERPNext Job Card 报工可追溯到工单、工序、工位和设备。
4. 外部完成状态不能绕过 MES 数量和质量校验。
5. 外部取消只能进入 MES cancelled，不能删除本地历史。
6. 同一 sourceTraceId 重试不会重复计产。
7. 外部同步失败支持重试，不影响本地生产闭环。
8. 所有同步请求记录 externalSystem、externalId、requestId 和结果。

参考：ERPNext 官方 Manufacturing、BOM、Work Order、Job Card 文档。
