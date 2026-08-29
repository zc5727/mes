<template>
  <aside class="right-panel">
    <section class="panel block">
      <div class="panel-title"><span>生产态势</span><ElTag size="small" :type="lineStatusTag(selectedLine.status)">{{ lineStatusLabel(selectedLine.status) }}</ElTag></div>
      <div class="line-focus">
        <div><strong>{{ selectedLine.name }}</strong><small>{{ selectedLine.workshop }} · OEE {{ selectedLine.oee.toFixed(1) }}% · {{ selectedLine.deviceOnline }}设备在线 · {{ selectedLine.risk }}</small></div>
        <b>{{ selectedLine.completionRate }}%</b>
      </div>
      <div class="kpi-grid">
        <div class="kpi">
          <span>今日任务</span>
          <strong>{{ todayTasks }}</strong>
        </div>
        <div class="kpi">
          <span>设备在线率</span>
          <strong>{{ onlineRate }}%</strong>
        </div>
        <div class="kpi">
          <span>告警统计</span>
          <strong>{{ alarms.length }}</strong>
        </div>
        <div class="kpi">
          <span>电力消耗</span>
          <strong>{{ powerConsumption.toFixed(0) }}kW</strong>
        </div>
      </div>
      <div class="production-strip">
        <div><span>今日计划</span><strong>{{ (productionSummary?.plannedQuantity ?? selectedLine.plannedQuantity).toLocaleString() }}</strong></div>
        <div><span>已完成</span><strong class="good">{{ (productionSummary?.completedQuantity ?? selectedLine.completedQuantity).toLocaleString() }}</strong></div>
        <div><span>达成率</span><strong>{{ productionSummary?.completionRate ?? selectedLine.completionRate }}%</strong></div>
      </div>
      <DataCharts class="charts-host" :devices="devices" :alarms="alarms" :temperature-trend="temperatureTrend" />
    </section>

    <section class="panel block">
      <div class="panel-title">对象详情</div>
      <div v-if="selectedDevice" class="selected-device">
        <div class="selected-head"><strong>{{ selectedDevice.name }}</strong><ElTag size="small" :type="statusTag(selectedDevice.status)">{{ statusLabel(selectedDevice.status) }}</ElTag></div>
        <p>{{ selectedDevice.zone }} · {{ selectedDevice.id }}</p>
        <div class="detail-grid"><span>温度</span><strong>{{ selectedDevice.temperature.toFixed(1) }}℃</strong><span>功率</span><strong>{{ selectedDevice.power.toFixed(1) }}kW</strong><span>当前工单</span><strong>进行中</strong></div>
        <div v-if="selectedDevice.warning" class="selected-warning">{{ selectedDevice.warning }}，建议安排点检。</div>
        <div class="object-actions"><button type="button">查看工单</button><button type="button">创建点检</button></div>
      </div>
      <div v-else class="empty-state">点击三维场景或左侧设备，查看对象详情。</div>
      <div class="panel-title agv-title">AGV运输</div>
      <div class="agv-list">
        <div v-for="agv in agvs" :key="agv.id" class="agv-card">
          <div class="agv-head">
            <strong>{{ agv.id }}</strong>
            <ElTag size="small" :type="tagType(agv.state)">{{ agv.state }}</ElTag>
          </div>
          <p>{{ agv.task }}</p>
          <ElProgress :percentage="Math.round(agv.battery)" :stroke-width="7" :show-text="false" />
          <div class="agv-foot">
            <span>电量 {{ agv.battery.toFixed(1) }}%</span>
            <span>{{ agv.speed.toFixed(2) }}m/s</span>
          </div>
        </div>
        <div v-if="!agvs.length" class="empty-state">后端暂未接入 AGV 数据。</div>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import DataCharts from '@/components/charts/DataCharts.vue';
import { ElProgress, ElTag } from 'element-plus';
import 'element-plus/es/components/progress/style/css';
import 'element-plus/es/components/tag/style/css';
import type { AGVState, AGVTelemetry, DeviceTelemetry, DeviceStatus, FactoryAlarm, ProductionLineTelemetry, ProductionSummary } from '@/types/factory';

defineProps<{
  devices: DeviceTelemetry[];
  agvs: AGVTelemetry[];
  alarms: FactoryAlarm[];
  todayTasks: number;
  powerConsumption: number;
  temperatureTrend: number[];
  selectedDevice: DeviceTelemetry | null;
  onlineRate: number;
  selectedLine: ProductionLineTelemetry;
  productionSummary?: ProductionSummary;
}>();

const tagType = (state: AGVState) => {
  if (state === 'error') return 'danger';
  if (state === 'charging' || state === 'loading') return 'warning';
  if (state === 'moving') return 'success';
  return 'info';
};

const statusTag = (status: DeviceStatus) => status === 'error' ? 'danger' : status === 'warning' ? 'warning' : status === 'offline' ? 'info' : 'success';
const statusLabel = (status: DeviceStatus) => ({ running: '运行', warning: '预警', error: '故障', offline: '离线' })[status];
const lineStatusTag = (status: ProductionLineTelemetry['status']) => status === 'error' ? 'danger' : status === 'warning' ? 'warning' : status === 'idle' ? 'info' : 'success';
const lineStatusLabel = (status: ProductionLineTelemetry['status']) => ({ running: '运行中', warning: '需关注', error: '已停机', idle: '待启动' })[status];
</script>

<style scoped>
.right-panel {
  position: absolute;
  top: 92px;
  right: 18px;
  bottom: 126px;
  z-index: 3;
  display: grid;
  width: 348px;
  grid-template-rows: minmax(0, 1.12fr) minmax(0, 1fr);
  gap: 14px;
}

.block {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}

.kpi-grid {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.kpi {
  padding: 9px 10px;
  border: 1px solid rgba(111, 183, 255, 0.15);
  background: rgba(255, 255, 255, 0.04);
}

.kpi span {
  display: block;
  color: #83add0;
  font-size: 12px;
}

.kpi strong {
  display: block;
  margin-top: 3px;
  color: #eef8ff;
  font-size: 21px;
  font-variant-numeric: tabular-nums;
}

.charts-host {
  flex: 1;
  min-height: 0;
}

.agv-list {
  flex: 1;
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(104, 200, 255, 0.45) rgba(255, 255, 255, 0.04);
}

.production-strip { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; margin:0 0 10px; }
.production-strip div { padding:7px 8px; background:rgba(77,255,181,.06); border:1px solid rgba(77,255,181,.12); }
.production-strip span { display:block; color:#83add0; font-size:10px; }
.production-strip strong { display:block; margin-top:3px; color:#eef8ff; font-size:16px; }
.production-strip .good { color:#72f5ba; }
.line-focus { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:9px; padding:8px 10px; border:1px solid rgba(104,200,255,.2); background:rgba(29,143,255,.08); }
.line-focus strong { color:#eef8ff; font-size:13px; }.line-focus small { display:block; margin-top:3px; color:#7eaed6; font-size:10px; }.line-focus b { color:#72f5ba; font-size:18px; }
.selected-device { padding:10px; border:1px solid rgba(111,183,255,.18); background:rgba(255,255,255,.04); }
.selected-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.selected-head strong { color:#eef8ff; font-size:14px; }
.selected-device p { margin:6px 0 9px; color:#87b3d8; font-size:11px; }
.detail-grid { display:grid; grid-template-columns:1fr auto; gap:6px 10px; color:#9ec5e5; font-size:11px; }
.detail-grid strong { color:#dcecff; font-size:12px; font-variant-numeric:tabular-nums; }
.selected-warning { margin-top:9px; padding:7px; color:#ffc857; background:rgba(255,200,87,.1); font-size:11px; line-height:1.4; }
.object-actions { display:flex; gap:7px; margin-top:9px; }
.object-actions button { padding:6px 8px; border:1px solid rgba(104,200,255,.3); background:transparent; color:#9ed2ff; cursor:pointer; font-size:11px; }
.empty-state { padding:20px 10px; color:#7898b6; font-size:12px; line-height:1.5; }
.agv-title { margin-top:10px; }

.agv-list::-webkit-scrollbar {
  width: 5px;
}

.agv-list::-webkit-scrollbar-thumb {
  border-radius: 5px;
  background: rgba(104, 200, 255, 0.42);
}

.agv-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.04);
}

.agv-card {
  flex: 0 0 auto;
  padding: 11px;
  border: 1px solid rgba(111, 183, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
}

.agv-head,
.agv-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agv-head strong {
  color: #dcecff;
  font-size: 14px;
}

.agv-card p {
  margin: 6px 0 8px;
  color: #87b3d8;
  font-size: 12px;
}

.agv-foot {
  margin-top: 7px;
  color: #9ec5e5;
  font-size: 12px;
}
</style>
