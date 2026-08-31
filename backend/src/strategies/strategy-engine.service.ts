import { Injectable } from '@nestjs/common';
import {
  RiskLevel,
  StrategyCandidate,
  StrategyImpactAssessment,
  StrategyScore,
  StrategySnapshot,
  StrategySimulationResult,
} from './strategy.types';

@Injectable()
export class StrategyEngineService {
  preflight(snapshot: StrategySnapshot): { accepted: boolean; errors: string[] } {
    const errors: string[] = [];
    const lineIds = new Set<string>();

    snapshot.lines.forEach((line) => {
      if (lineIds.has(line.id)) errors.push(`duplicate line id: ${line.id}`);
      lineIds.add(line.id);
      if (line.capacityPerHour < 0) errors.push(`line ${line.id} has negative capacity`);
    });

    const deviceIds = new Set<string>();
    snapshot.devices.forEach((device) => {
      if (deviceIds.has(device.id)) errors.push(`duplicate device id: ${device.id}`);
      deviceIds.add(device.id);
      if (!lineIds.has(device.lineId)) errors.push(`device ${device.id} references unknown line ${device.lineId}`);
    });

    const orderIds = new Set<string>();
    snapshot.workOrders.forEach((order) => {
      if (orderIds.has(order.id)) errors.push(`duplicate work order id: ${order.id}`);
      orderIds.add(order.id);
      if (!lineIds.has(order.lineId)) errors.push(`work order ${order.id} references unknown line ${order.lineId}`);
      if (order.remainingQty < 0) errors.push(`work order ${order.id} has negative remaining quantity`);
      if (!Number.isFinite(order.priority) || order.priority < 0) errors.push(`work order ${order.id} has invalid priority`);
    });

    const knownOrderIds = new Set(snapshot.workOrders.map((order) => order.id));
    for (const shortage of snapshot.materialShortages ?? []) {
      for (const orderId of shortage.affectedWorkOrderIds) {
        if (!knownOrderIds.has(orderId)) errors.push(`material shortage references unknown work order ${orderId}`);
      }
    }

    return { accepted: errors.length === 0, errors };
  }

  simulate(snapshot: StrategySnapshot): StrategySimulationResult {
    const validation = this.preflight(snapshot);
    if (!validation.accepted) throw new Error(`invalid strategy snapshot: ${validation.errors.join('; ')}`);

    const risks = this.identifyRisks(snapshot);
    const candidates = [
      ...this.transferCandidates(snapshot),
      ...this.rebalanceCandidates(snapshot, risks),
      ...this.materialCandidates(snapshot),
      ...this.recoveryCandidates(snapshot),
      ...this.delayCandidates(snapshot),
    ].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const snapshotCopy = this.cloneSnapshot(snapshot);

    return {
      simulationId: `sim-${this.hash(JSON.stringify(snapshot))}`,
      generatedAt: snapshot.timestamp,
      snapshot: snapshotCopy,
      risks,
      candidates,
      recommended: candidates[0] ?? null,
      requiresApproval: true,
      executionAllowed: false,
      impactAssessment: {
        affectedOrders: this.unique(candidates.flatMap((candidate) => candidate.impactAssessment.affectedOrders)),
        affectedLines: this.unique(candidates.flatMap((candidate) => candidate.impactAssessment.affectedLines)),
        affectedDevices: this.unique(candidates.flatMap((candidate) => candidate.impactAssessment.affectedDevices)),
        candidateCount: candidates.length,
        highRiskCandidateCount: candidates.filter((candidate) => candidate.risk === 'high').length,
        executionAllowed: false,
      },
    };
  }

  private identifyRisks(snapshot: StrategySnapshot): StrategySimulationResult['risks'] {
    const risks: StrategySimulationResult['risks'] = [];
    const failed = snapshot.devices.filter((device) => device.status === 'alarm' || device.status === 'offline');
    if (failed.length) {
      risks.push({
        level: 'high',
        message: `${failed.length} 台设备不可用，可能影响产线交付`,
        evidence: [{ type: 'device_fault', message: '存在故障或离线设备', resourceIds: failed.map((device) => device.id) }],
      });
    }

    const overloaded = snapshot.lines.filter((line) => {
      const demand = snapshot.workOrders
        .filter((order) => order.lineId === line.id)
        .reduce((sum, order) => sum + order.remainingQty, 0);
      return line.active && demand > line.capacityPerHour * 8;
    });
    if (overloaded.length) {
      risks.push({
        level: 'medium',
        message: `${overloaded.length} 条产线未来 8 小时负载偏高`,
        evidence: [{ type: 'line_load', message: '剩余工单超过班次产能', resourceIds: overloaded.map((line) => line.id) }],
      });
    }

    const shortages = snapshot.materialShortages ?? [];
    if (shortages.length) {
      risks.push({
        level: 'high',
        message: `${shortages.length} 项物料短缺影响生产`,
        evidence: shortages.map((item) => ({
          type: 'material_shortage',
          message: `${item.materialCode} 库存不足`,
          resourceIds: item.affectedWorkOrderIds,
        })),
      });
    }

    const dueRisk = snapshot.workOrders.filter(
      (order) => order.status !== 'paused' && this.hoursUntil(order.dueAt, snapshot.timestamp) < order.remainingQty / 10,
    );
    if (dueRisk.length) {
      risks.push({
        level: 'medium',
        message: `${dueRisk.length} 张工单存在延期风险`,
        evidence: [{ type: 'due_risk', message: '剩余数量与交期不匹配', resourceIds: dueRisk.map((order) => order.id) }],
      });
    }

    const maintenance = snapshot.devices.filter((device) => device.status === 'maintenance');
    if (maintenance.length) {
      risks.push({
        level: 'medium',
        message: `${maintenance.length} 台设备处于维护状态`,
        evidence: [{ type: 'maintenance', message: '设备维护中', resourceIds: maintenance.map((device) => device.id) }],
      });
    }
    return risks;
  }

  private transferCandidates(snapshot: StrategySnapshot): StrategyCandidate[] {
    const failedLines = new Set(
      snapshot.devices
        .filter((device) => device.status === 'alarm' || device.status === 'offline')
        .map((device) => device.lineId),
    );
    const target = snapshot.lines
      .filter((line) => line.active && !failedLines.has(line.id))
      .sort((a, b) => a.capacityPerHour - b.capacityPerHour)[0];
    if (!target) return [];

    return snapshot.workOrders
      .filter((order) => failedLines.has(order.lineId) && order.status !== 'paused')
      .map((order) => this.candidate({
        action: 'transfer_work_order',
        risk: 'medium',
        affectedOrders: [order.id],
        fromLine: order.lineId,
        toLine: target.id,
        affectedLines: [order.lineId, target.id],
        affectedDevices: this.devicesOnLines(snapshot, [order.lineId, target.id]),
        expectedImpact: `转移至 ${target.name}，预计减少延期 ${Math.min(120, Math.round(order.remainingQty / Math.max(1, target.capacityPerHour) * 60))} 分钟`,
        reason: '原产线存在故障或离线设备，目标产线仍有可用能力',
        score: 100 + order.priority * 5,
      }, snapshot));
  }

  private rebalanceCandidates(snapshot: StrategySnapshot, risks: StrategySimulationResult['risks']): StrategyCandidate[] {
    const highLoad = snapshot.lines.find((line) => risks.some((risk) => risk.evidence.some((evidence) => evidence.resourceIds.includes(line.id))));
    const target = snapshot.lines
      .filter((line) => line.active && line.id !== highLoad?.id)
      .sort((a, b) => b.capacityPerHour - a.capacityPerHour)[0];
    if (!highLoad || !target) return [];

    const order = snapshot.workOrders.find((item) => item.lineId === highLoad.id && item.status !== 'paused');
    return order ? [this.candidate({
      action: 'rebalance_line',
      risk: 'medium',
      affectedOrders: [order.id],
      fromLine: highLoad.id,
      toLine: target.id,
      affectedLines: [highLoad.id, target.id],
      affectedDevices: this.devicesOnLines(snapshot, [highLoad.id, target.id]),
      expectedImpact: '降低瓶颈产线负载，改善整体交期',
      reason: '检测到产线负载不均衡',
      score: 75,
    }, snapshot)] : [];
  }

  private materialCandidates(snapshot: StrategySnapshot): StrategyCandidate[] {
    const affected = (snapshot.materialShortages ?? []).flatMap((item) => item.affectedWorkOrderIds);
    return affected.map((id) => {
      const order = snapshot.workOrders.find((item) => item.id === id);
      const lineId = order?.lineId;
      return this.candidate({
        action: 'reschedule_material',
        risk: 'high',
        affectedOrders: [id],
        affectedLines: lineId ? [lineId] : [],
        affectedDevices: lineId ? this.devicesOnLines(snapshot, [lineId]) : [],
        expectedImpact: '优先安排有物料的工单，降低停线时长',
        reason: '物料短缺直接影响该工单',
        score: 90,
      }, snapshot);
    });
  }

  private recoveryCandidates(snapshot: StrategySnapshot): StrategyCandidate[] {
    const order = snapshot.workOrders.find((item) => item.status === 'paused');
    return order ? [this.candidate({
      action: 'schedule_recovery',
      risk: 'low',
      affectedOrders: [order.id],
      toLine: order.lineId,
      affectedLines: [order.lineId],
      affectedDevices: this.devicesOnLines(snapshot, [order.lineId]),
      expectedImpact: '设备恢复后优先补齐暂停工单',
      reason: '存在暂停工单，可在维护完成后恢复生产',
      score: 60,
    }, snapshot)] : [];
  }

  private delayCandidates(snapshot: StrategySnapshot): StrategyCandidate[] {
    return snapshot.workOrders
      .filter((order) => this.hoursUntil(order.dueAt, snapshot.timestamp) < order.remainingQty / 10)
      .map((order) => this.candidate({
        action: 'expedite_work_order',
        risk: 'medium',
        affectedOrders: [order.id],
        toLine: order.lineId,
        affectedLines: [order.lineId],
        affectedDevices: this.devicesOnLines(snapshot, [order.lineId]),
        expectedImpact: '提高该工单优先级，降低延期概率',
        reason: '剩余工时接近或超过交期前可用时间',
        score: 70 + order.priority * 3,
      }, snapshot));
  }

  private candidate(input: CandidateInput, snapshot: StrategySnapshot): StrategyCandidate {
    const finish = new Date(new Date(snapshot.timestamp).getTime() + 4 * 60 * 60 * 1000).toISOString();
    const affectedLines = this.unique(input.affectedLines ?? [input.fromLine, input.toLine].filter((line): line is string => Boolean(line)));
    const affectedDevices = this.unique(input.affectedDevices ?? this.devicesOnLines(snapshot, affectedLines));
    const impactAssessment: StrategyImpactAssessment = {
      affectedOrders: [...input.affectedOrders],
      affectedLines,
      affectedDevices,
      before: { action: 'no_change', orders: [...input.affectedOrders] },
      after: {
        proposedAction: input.action,
        fromLine: input.fromLine ?? null,
        toLine: input.toLine ?? null,
        expectedFinishTime: finish,
      },
      summary: input.expectedImpact,
      executionAllowed: false,
      rollbackPlan: {
        supported: true,
        action: 'discard_simulation',
        restores: ['workOrders', 'lines', 'devices'],
        executionAllowed: false,
        reason: '方案仅作用于仿真副本；不采纳方案即可丢弃模拟结果，无需回写生产状态',
      },
    };
    const scoreBreakdown = this.scoreBreakdown(input.score, input.risk, snapshot, input.affectedOrders);

    const { affectedLines: _inputLines, affectedDevices: _inputDevices, ...candidateFields } = input;
    return {
      ...candidateFields,
      id: `candidate-${this.hash(JSON.stringify(input))}`,
      expectedFinishTime: finish,
      requiresApproval: true,
      scoreBreakdown,
      impactAssessment,
    };
  }

  private scoreBreakdown(total: number, risk: RiskLevel, snapshot: StrategySnapshot, orders: string[]): StrategyScore {
    const priority = Math.min(25, orders.reduce(
      (sum, id) => sum + (snapshot.workOrders.find((order) => order.id === id)?.priority ?? 0) * 5,
      0,
    ));
    const riskPoints = risk === 'high' ? 30 : risk === 'medium' ? 20 : 10;
    const feasibility = 20;
    return {
      total,
      factors: {
        priority,
        urgency: Math.max(0, total - priority - riskPoints - feasibility),
        risk: riskPoints,
        feasibility,
      },
    };
  }

  private devicesOnLines(snapshot: StrategySnapshot, lineIds: string[]): string[] {
    const lines = new Set(lineIds);
    return snapshot.devices.filter((device) => lines.has(device.lineId)).map((device) => device.id);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }

  private cloneSnapshot(snapshot: StrategySnapshot): StrategySnapshot {
    return {
      ...snapshot,
      lines: snapshot.lines.map((line) => ({ ...line })),
      devices: snapshot.devices.map((device) => ({ ...device })),
      workOrders: snapshot.workOrders.map((order) => ({ ...order })),
      materialShortages: snapshot.materialShortages?.map((item) => ({
        ...item,
        affectedWorkOrderIds: [...item.affectedWorkOrderIds],
      })),
    };
  }

  private hoursUntil(dueAt: string, now: string): number {
    return (new Date(dueAt).getTime() - new Date(now).getTime()) / 3_600_000;
  }

  private hash(value: string): string {
    let hash = 2166136261;
    for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16);
  }
}

type CandidateInput = Omit<
  StrategyCandidate,
  'id' | 'expectedFinishTime' | 'requiresApproval' | 'scoreBreakdown' | 'impactAssessment' | 'affectedLines' | 'affectedDevices'
> & {
  affectedLines?: string[];
  affectedDevices?: string[];
};
