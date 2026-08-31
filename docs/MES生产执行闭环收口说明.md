# MES 生产执行闭环收口说明

## 适用范围

当前版本覆盖订单、工单、产线、报工、质量放行、物料扣减和维修占用的最小生产闭环；不包含 SaaS、AI 或真实设备控制。

## 执行规则

1. 工单状态按 `draft → released → in_progress → paused → in_progress → completed` 流转，取消必须填写原因。
2. 只有 `active` 产线允许开工；停用或维护中的产线不能进入 `in_progress`。
3. 完成数量只能通过报工增加，禁止使用工单编辑接口绕过报工。
4. 报工总量不能超过计划量；重复 `sourceTraceId` 被拒绝。
5. 已关联质量记录时，质量记录必须确认放行；关联 NCR 必须关闭并具备 CAPA 后才允许完工。
6. 报工设备必须属于工单产线，且不能被未完成的维修工单占用。
7. 报工物料批次不足、批次不存在或扣减后为负库存时拒绝报工，批量扣减使用持久化事务。

## 关键接口

```text
POST  /api/v1/orders
POST  /api/v1/work-orders
PATCH /api/v1/work-orders/:id/status
POST  /api/v1/work-orders/:id/report
GET   /api/v1/work-orders/:id/traceability
GET   /api/v1/work-orders/traceability/search
```

## 验收重点

质量未放行、产线维护、设备维修占用、物料短缺和数量超报均必须在后端拒绝，并且失败请求不能产生报工或库存副作用。
