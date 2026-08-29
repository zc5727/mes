# 策略故障演练

策略引擎只对生产快照进行确定性计算，输出候选方案和推荐方案，不执行设备控制、不修改工单，也不会自动停线。所有候选方案都必须人工审批，`requiresApproval` 固定为 `true`。

## 四产线演练链路

测试 Fixture：`backend/test/fixtures/strategy-four-line-fault.json`

1. `LINE-03` 的 `WELD-01` 告警、`WELD-02` 离线。
2. `WO-WELD-001` 剩余数量较高且临近交期，系统识别设备风险和延期风险。
3. 策略引擎生成 `transfer_work_order` 候选，将工单从 `LINE-03` 建议转移到可用产线。
4. 演练测试将设备恢复为在线、工单置为暂停，仅构造新的仿真快照；系统生成 `schedule_recovery` 建议。

该过程只验证“故障—风险—建议—恢复建议”的闭环，不代表系统已经执行转移或恢复操作。

## 验证命令

```bash
cd backend
npm test -- --runInBand --runTestsByPath test/strategy-fire-drill.unit.spec.ts test/strategy-recovery.unit.spec.ts
npm run build
```
