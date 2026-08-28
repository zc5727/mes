import { Injectable } from '@nestjs/common';
import { StrategyCandidate, StrategySnapshot, StrategySimulationResult, RiskLevel } from './strategy.types';

@Injectable()
export class StrategyEngineService {
  simulate(snapshot: StrategySnapshot): StrategySimulationResult {
    const risks = this.identifyRisks(snapshot);
    const candidates = [
      ...this.transferCandidates(snapshot, risks),
      ...this.rebalanceCandidates(snapshot, risks),
      ...this.materialCandidates(snapshot, risks),
      ...this.recoveryCandidates(snapshot, risks),
      ...this.delayCandidates(snapshot, risks),
    ].sort((a, b) => b.score - a.score);
    return {
      simulationId: `sim-${this.hash(JSON.stringify(snapshot))}`,
      generatedAt: snapshot.timestamp,
      risks,
      candidates,
      recommended: candidates[0] ?? null,
    };
  }

  private identifyRisks(snapshot: StrategySnapshot): StrategySimulationResult['risks'] {
    const risks: StrategySimulationResult['risks'] = [];
    const failed = snapshot.devices.filter((device) => device.status === 'alarm' || device.status === 'offline');
    if (failed.length) risks.push({ level: 'high', message: `${failed.length} 台设备不可用，可能影响产线交付`, evidence: [{ type: 'device_fault', message: '存在故障或离线设备', resourceIds: failed.map((device) => device.id) }] });
    const overloaded = snapshot.lines.filter((line) => {
      const demand = snapshot.workOrders.filter((order) => order.lineId === line.id).reduce((sum, order) => sum + order.remainingQty, 0);
      return line.active && demand > line.capacityPerHour * 8;
    });
    if (overloaded.length) risks.push({ level: 'medium', message: `${overloaded.length} 条产线未来 8 小时负载偏高`, evidence: [{ type: 'line_load', message: '剩余工单超过班次产能', resourceIds: overloaded.map((line) => line.id) }] });
    const shortages = snapshot.materialShortages ?? [];
    if (shortages.length) risks.push({ level: 'high', message: `${shortages.length} 项物料短缺影响生产`, evidence: shortages.map((item) => ({ type: 'material_shortage', message: `${item.materialCode} 库存不足`, resourceIds: item.affectedWorkOrderIds })) });
    const dueRisk = snapshot.workOrders.filter((order) => order.status !== 'paused' && this.hoursUntil(order.dueAt, snapshot.timestamp) < order.remainingQty / 10);
    if (dueRisk.length) risks.push({ level: 'medium', message: `${dueRisk.length} 张工单存在延期风险`, evidence: [{ type: 'due_risk', message: '剩余数量与交期不匹配', resourceIds: dueRisk.map((order) => order.id) }] });
    const maintenance = snapshot.devices.filter((device) => device.status === 'maintenance');
    if (maintenance.length) risks.push({ level: 'medium', message: `${maintenance.length} 台设备处于维护状态`, evidence: [{ type: 'maintenance', message: '设备维护中', resourceIds: maintenance.map((device) => device.id) }] });
    return risks;
  }

  private transferCandidates(snapshot: StrategySnapshot, risks: StrategySimulationResult['risks']): StrategyCandidate[] {
    const failedLines = new Set(snapshot.devices.filter((device) => device.status === 'alarm' || device.status === 'offline').map((device) => device.lineId));
    const target = snapshot.lines.filter((line) => line.active && !failedLines.has(line.id)).sort((a, b) => a.capacityPerHour - b.capacityPerHour)[0];
    if (!target) return [];
    return snapshot.workOrders.filter((order) => failedLines.has(order.lineId) && order.status !== 'paused').map((order) => this.candidate({
      action: 'transfer_work_order', risk: 'medium', affectedOrders: [order.id], fromLine: order.lineId, toLine: target.id,
      expectedImpact: `转移至 ${target.name}，预计减少延期 ${Math.min(120, Math.round(order.remainingQty / Math.max(1, target.capacityPerHour) * 60))} 分钟`,
      reason: '原产线存在故障或离线设备，目标产线仍有可用能力', score: 100 + order.priority * 5,
    }, snapshot));
  }

  private rebalanceCandidates(snapshot: StrategySnapshot, risks: StrategySimulationResult['risks']): StrategyCandidate[] {
    const highLoad = snapshot.lines.find((line) => risks.some((risk) => risk.evidence.some((evidence) => evidence.resourceIds.includes(line.id))));
    const target = snapshot.lines.filter((line) => line.active && line.id !== highLoad?.id).sort((a, b) => b.capacityPerHour - a.capacityPerHour)[0];
    if (!highLoad || !target) return [];
    const order = snapshot.workOrders.find((item) => item.lineId === highLoad.id && item.status !== 'paused');
    return order ? [this.candidate({ action: 'rebalance_line', risk: 'medium', affectedOrders: [order.id], fromLine: highLoad.id, toLine: target.id, expectedImpact: '降低瓶颈产线负载，改善整体交期', reason: '检测到产线负载不均衡', score: 75 }, snapshot)] : [];
  }

  private materialCandidates(snapshot: StrategySnapshot, risks: StrategySimulationResult['risks']): StrategyCandidate[] {
    const affected = (snapshot.materialShortages ?? []).flatMap((item) => item.affectedWorkOrderIds);
    return affected.map((id) => this.candidate({ action: 'reschedule_material', risk: 'high', affectedOrders: [id], expectedImpact: '优先安排有物料的工单，降低停线时长', reason: '物料短缺直接影响该工单', score: 90 }, snapshot));
  }

  private recoveryCandidates(snapshot: StrategySnapshot, risks: StrategySimulationResult['risks']): StrategyCandidate[] {
    const order = snapshot.workOrders.find((item) => item.status === 'paused');
    return order ? [this.candidate({ action: 'schedule_recovery', risk: 'low', affectedOrders: [order.id], toLine: order.lineId, expectedImpact: '设备恢复后优先补齐暂停工单', reason: '存在暂停工单，可在维护完成后恢复生产', score: 60 }, snapshot)] : [];
  }

  private delayCandidates(snapshot: StrategySnapshot, risks: StrategySimulationResult['risks']): StrategyCandidate[] {
    return snapshot.workOrders.filter((order) => this.hoursUntil(order.dueAt, snapshot.timestamp) < order.remainingQty / 10).map((order) => this.candidate({ action: 'expedite_work_order', risk: 'medium', affectedOrders: [order.id], toLine: order.lineId, expectedImpact: '提高该工单优先级，降低延期概率', reason: '剩余工时接近或超过交期前可用时间', score: 70 + order.priority * 3 }, snapshot));
  }

  private candidate(input: Omit<StrategyCandidate, 'id' | 'expectedFinishTime' | 'requiresApproval'>, snapshot: StrategySnapshot): StrategyCandidate {
    const finish = new Date(new Date(snapshot.timestamp).getTime() + 4 * 60 * 60 * 1000).toISOString();
    return { ...input, id: `candidate-${this.hash(JSON.stringify(input))}`, expectedFinishTime: finish, requiresApproval: true };
  }

  private hoursUntil(dueAt: string, now: string): number { return (new Date(dueAt).getTime() - new Date(now).getTime()) / 3_600_000; }
  private hash(value: string): string { let hash = 2166136261; for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(16); }
}
