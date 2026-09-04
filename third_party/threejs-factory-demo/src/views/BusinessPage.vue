<template>
  <main class="business-page">
    <section class="business-page__header panel">
      <div>
        <p class="eyebrow">MES WORKSPACE / {{ page.index }}</p>
        <h2>{{ page.title }}</h2>
        <p class="description">{{ page.description }}</p>
      </div>
      <button type="button" class="refresh-button" :disabled="loading" @click="loadData">
        {{ loading ? '读取中…' : '刷新数据' }}
      </button>
    </section>

    <p v-if="errorMessage" class="state state--error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="loading" class="state">正在读取 NestJS Facade 数据...</p>
    <p v-else-if="!rows.length" class="state">接口已响应，但当前没有可展示的数据。</p>

    <template v-else>
      <section class="summary-grid">
        <article v-for="summary in summaries" :key="summary.label" class="summary-card panel">
          <span>{{ summary.label }}</span>
          <strong>{{ summary.value }}</strong>
          <small>{{ summary.detail }}</small>
        </article>
      </section>

      <section class="records panel">
        <div class="records__heading">
          <h3>{{ page.title }} · API 记录</h3>
          <span>{{ sourceLabel }}</span>
        </div>
        <div class="records__scroll">
          <table>
            <thead><tr><th v-for="column in columns" :key="column.key">{{ column.label }}</th></tr></thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td v-for="column in columns" :key="column.key">{{ displayValue(row[column.key]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { fetchDependencyHealth, fetchFactorySnapshot, listQualityRecords, listWorkOrders, type DependencyHealth, type FoundationRecord } from '@/api/mesApi';
import type { DeviceTelemetry, ProductionLineTelemetry } from '@/types/factory';
import type { WorkspaceRoute } from '@/components/layout/WorkspaceNavigation.vue';

interface BusinessPageDefinition {
  key: Exclude<WorkspaceRoute, 'overview' | 'twin'>;
  index: string;
  title: string;
  description: string;
}

interface TableRow {
  id: string;
  [key: string]: unknown;
}

interface TableColumn {
  key: string;
  label: string;
}

interface SummaryCard {
  label: string;
  value: string | number;
  detail: string;
}

const props = defineProps<{ page: BusinessPageDefinition }>();
const loading = ref(false);
const errorMessage = ref('');
const rows = ref<TableRow[]>([]);
const summaries = ref<SummaryCard[]>([]);
const columns = ref<TableColumn[]>([]);
const sourceLabel = ref('NestJS Facade / OpenMES');

const pageDefinitions: Record<BusinessPageDefinition['key'], { columns: TableColumn[]; load: () => Promise<{ rows: TableRow[]; summaries: SummaryCard[]; source?: string }> }> = {
  devices: { columns: [{ key: 'name', label: '设备' }, { key: 'lineId', label: '产线' }, { key: 'status', label: '状态' }, { key: 'temperature', label: '温度' }], load: loadDevices },
  simulation: { columns: [{ key: 'id', label: '对象' }, { key: 'status', label: '当前状态' }, { key: 'observedAt', label: '观测时间' }], load: loadSimulationContext },
  'work-orders': { columns: [{ key: 'orderNo', label: '工单号' }, { key: 'productName', label: '产品' }, { key: 'status', label: '状态' }, { key: 'plannedQty', label: '计划量' }, { key: 'completedQty', label: '完成量' }], load: loadWorkOrderRecords },
  quality: { columns: [{ key: 'id', label: '记录号' }, { key: 'status', label: '状态' }, { key: 'batchNo', label: '批次' }, { key: 'createdAt', label: '创建时间' }], load: loadFoundationRecords(listQualityRecords, '质量记录') },
  strategy: { columns: [{ key: 'id', label: '对象' }, { key: 'status', label: '生产状态' }, { key: 'risk', label: '风险' }, { key: 'completionRate', label: '完成率' }], load: loadStrategyContext },
  system: { columns: [{ key: 'id', label: '依赖' }, { key: 'status', label: '状态' }, { key: 'detail', label: '详情' }], load: loadSystemHealth },
};

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const config = pageDefinitions[props.page.key];
    const result = await config.load();
    rows.value = result.rows;
    summaries.value = result.summaries;
    columns.value = config.columns;
    sourceLabel.value = result.source ?? 'NestJS Facade / OpenMES';
  } catch (error: unknown) {
    rows.value = [];
    summaries.value = [];
    errorMessage.value = error instanceof Error ? `读取失败：${error.message}` : '读取失败，请检查服务和权限';
  } finally {
    loading.value = false;
  }
}

async function loadDevices() {
  const result = await fetchFactorySnapshot();
  const deviceRows = result.snapshot.devices.map((device) => ({ ...device, temperature: `${device.temperature.toFixed(1)} ℃` }));
  return { rows: deviceRows, summaries: deviceSummaries(result.snapshot.devices, result.lines) };
}

async function loadSimulationContext() {
  const [result, health] = await Promise.all([fetchFactorySnapshot(), fetchDependencyHealth()]);
  const simulatorRows = result.snapshot.devices.slice(0, 12).map((device) => ({ id: device.id, status: device.status, observedAt: device.observedAt ?? '未提供' }));
  return { rows: simulatorRows, summaries: [{ label: '控制模式', value: controlModeLabel(health.controlMode), detail: health.environment }, { label: 'MQTT', value: health.mqtt.connected ? '已连接' : '未连接', detail: health.mqtt.state }, { label: '设备对象', value: result.snapshot.devices.length, detail: '来自统一快照' }], source: 'NestJS Facade / simulator health' };
}

async function loadWorkOrderRecords() {
  const records = await listWorkOrders();
  return { rows: records.map((record) => ({ ...record, id: record.id })), summaries: [{ label: '工单总数', value: records.length, detail: '当前 API 返回' }, { label: '执行中', value: records.filter((record) => ['in_progress', 'running'].includes(String(record.status))).length, detail: '按状态字段统计' }] };
}

function loadFoundationRecords(loader: () => Promise<FoundationRecord[]>, label: string) {
  return async () => {
    const records = await loader();
    return { rows: records.map((record) => ({ ...record, id: record.id })), summaries: [{ label: `${label}总数`, value: records.length, detail: '当前 API 返回' }, { label: '待处理', value: records.filter((record) => !['confirmed', 'completed', 'closed'].includes(String(record.status))).length, detail: '按状态字段统计' }] };
  };
}

async function loadStrategyContext() {
  const result = await fetchFactorySnapshot();
  return { rows: result.lines.map((line) => ({ ...line, id: line.id, risk: line.risk, completionRate: `${line.completionRate}%` })), summaries: [{ label: '评估对象', value: result.lines.length, detail: '当前产线快照' }, { label: '高风险产线', value: result.lines.filter((line) => line.status === 'error').length, detail: '仅展示事实，不自动执行策略' }], source: 'NestJS Facade / production snapshot' };
}

async function loadSystemHealth() {
  const health: DependencyHealth = await fetchDependencyHealth();
  const healthRows = [{ id: 'database', status: health.database.status, detail: health.database.enabled ? '已启用' : '未启用' }, { id: 'mqtt', status: health.mqtt.connected ? 'connected' : 'disconnected', detail: health.mqtt.state }, { id: 'control', status: health.controlMode, detail: health.environment }];
  return { rows: healthRows, summaries: [{ label: '数据库', value: health.database.status, detail: 'Facade health' }, { label: '消息链路', value: health.mqtt.connected ? '正常' : '降级', detail: health.mqtt.state }, { label: '环境', value: health.environment, detail: '服务端返回' }], source: 'NestJS Facade / health' };
}

function deviceSummaries(devices: DeviceTelemetry[], lines: ProductionLineTelemetry[]) {
  return [{ label: '设备总数', value: devices.length, detail: '当前 API 快照' }, { label: '在线率', value: devices.length ? `${Math.round(devices.filter((device) => device.status !== 'offline').length / devices.length * 100)}%` : '—', detail: '按设备状态计算' }, { label: '产线', value: lines.length, detail: '当前 API 快照' }];
}

function controlModeLabel(mode: DependencyHealth['controlMode']) {
  return mode === 'test-control' ? '测试控制' : mode === 'approved-control' ? '审批控制' : '只读';
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

watch(() => props.page.key, () => { void loadData(); });
onMounted(() => { void loadData(); });
</script>

<style scoped>
.business-page { min-height: 100vh; padding: 132px 36px 36px; overflow: auto; background: linear-gradient(135deg, #07111f, #0a1b2d); }
.business-page__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; max-width: 1180px; margin: 0 auto 18px; padding: 22px 24px; }
.eyebrow { margin: 0 0 7px; color: #68c8ff; font-size: 10px; letter-spacing: .16em; }
h2 { margin: 0; color: #eef8ff; font-size: 26px; }
.description { margin: 8px 0 0; color: #83add0; font-size: 12px; }
.refresh-button { min-width: 92px; padding: 8px 12px; border: 1px solid rgba(104,200,255,.4); background: rgba(29,143,255,.15); color: #dcecff; cursor: pointer; font-size: 11px; }
.refresh-button:disabled { cursor: wait; opacity: .55; }
.state { max-width: 1180px; margin: 24px auto; padding: 16px; border: 1px solid rgba(104,200,255,.2); color: #9ed2ff; font-size: 12px; }
.state--error { border-color: rgba(255,77,109,.4); color: #ff9aae; }
.summary-grid { display: grid; max-width: 1180px; margin: 0 auto 18px; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.summary-card { min-height: 92px; padding: 16px; }
.summary-card span,.summary-card small { display: block; color: #7eaed6; font-size: 11px; }.summary-card strong { display: block; margin: 6px 0; color: #eef8ff; font-size: 22px; }.summary-card small { color: #6e97b9; font-size: 10px; }
.records { max-width: 1180px; margin: 0 auto; padding: 16px; }
.records__heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }.records__heading h3 { margin: 0; color: #cbe6ff; font-size: 14px; }.records__heading span { color: #6e97b9; font-size: 10px; }
.records__scroll { overflow: auto; max-height: calc(100vh - 350px); }
table { width: 100%; border-collapse: collapse; font-size: 11px; } th,td { padding: 10px 12px; border-bottom: 1px solid rgba(111,183,255,.12); text-align: left; white-space: nowrap; } th { color: #68c8ff; font-weight: 600; } td { color: #cbe6ff; }
@media (max-width: 760px) { .business-page { padding: 126px 14px 24px; } .business-page__header { padding: 16px; } .summary-grid { grid-template-columns: 1fr; } h2 { font-size: 21px; } }
</style>
