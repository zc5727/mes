<template>
  <div class="factory-page">
    <TopBar
      :online-device-count="onlineDeviceCount"
      :connected="connected"
      :online-rate="store.onlineRate"
      :line-count="lineSummaries.length"
      :connection-state="connectionState"
      :data-source="store.dataSource"
      :mes-source="mesSource"
    />
    <div v-if="loading" class="data-banner">正在接入 MES 数据...</div>
    <div v-else-if="loadError" class="data-banner data-banner--warning">
      {{ hasData ? '实时数据暂不可用，已保留最近一次数据并继续重试' : 'MES 数据暂不可用，当前无实时数据，请检查服务和权限' }}
    </div>
    <section class="data-controls panel" aria-label="数据连接控制">
      <span class="data-controls__title">实时数据 · {{ mesSource }}</span>
      <span class="control-mode-badge">API 数据</span>
      <select v-model="viewScope" aria-label="视图范围">
        <option value="line">当前产线视图</option>
        <option value="factory">全厂视图</option>
      </select>
      <button type="button" :disabled="dataBusy" @click="refreshData">{{ dataBusy ? '刷新中…' : '刷新数据' }}</button>
      <button type="button" class="secondary" :disabled="dataBusy" @click="reconnectRealtime">{{ dataBusy ? '连接中…' : '重新连接' }}</button>
      <small>{{ dataNotice || '只展示 NestJS Facade / OpenMES 返回的数据' }}</small>
    </section>
    <ThreeFactoryViewport
      :devices="devices"
      :agvs="agvs"
      :visible-device-ids="visibleSceneDeviceIds"
      :visible-agv-ids="visibleSceneAgvIds"
      :selected-device="activeSelectedDevice"
      @select-device="handleSceneSelect"
    />
    <OperationsPanel :selected-line="selectedLine" :selected-device="activeSelectedDevice" :lines="lineSummaries" :devices="devices" :api-enabled="true" :can-write="canWrite" :can-control="canControl" :write-disabled-reason="writeDisabledReason" :control-disabled-reason="controlDisabledReason" @data-changed="handleDataChanged" />
    <LeftPanel
      :alarms="lineAlarms"
      :devices="lineDevices"
      :selected-device-id="selectedDeviceId"
      @select-device="handleListSelect"
      :production-lines="lineSummaries"
      :selected-line-id="selectedLineId"
      :line-busy="lineSubmitting || dataBusy"
      @select-line="handleLineSelect"
      :can-manage-lines="canControl"
      :can-manage-alarms="canWrite"
      :write-disabled-reason="writeDisabledReason"
      :control-disabled-reason="controlDisabledReason"
      :alarm-busy="alarmSubmitting"
      @add-line="openLineDialog"
      @edit-line="openEditLine"
      @delete-line="deleteLine"
      @ack-alarm="ackAlarm"
      @close-alarm="closeAlarmAction"
    />
    <RightPanel
      :devices="lineDevices"
      :agvs="lineAgvs"
      :alarms="lineAlarms"
      :today-tasks="todayTasks"
      :power-consumption="powerConsumption"
      :temperature-trend="temperatureTrend"
      :selected-device="activeSelectedDevice"
      :online-rate="selectedLineOnlineRate"
      :selected-line="selectedLine"
      :production-summary="productionSummary"
      :api-enabled="true"
      :can-view-work-orders="canWrite"
      :can-create-inspection="canControl"
      :work-order-disabled-reason="writeDisabledReason"
      :inspection-disabled-reason="controlDisabledReason"
      :action-busy="objectActionBusy"
      @view-work-order="handleViewWorkOrder"
      @create-inspection="handleCreateInspection"
    />
    <BottomLogs :logs="logs" />
    <FactoryAssistant
      :selected-device="activeSelectedDevice"
      :alarms="lineAlarms"
      :devices="lineDevices"
      :production-lines="lineSummaries"
      :selected-line="selectedLine"
      @select-device="handleListSelect"
      @select-line="handleLineSelect"
    />
    <div v-if="showLineDialog" class="modal-backdrop" @click.self="closeLineDialog">
      <form class="line-dialog panel" @submit.prevent="submitLine">
        <div class="line-dialog__head"><strong>{{ editingLineId ? '编辑产线' : '新增产线' }}</strong><button type="button" aria-label="关闭" @click="closeLineDialog">×</button></div>
        <label>工厂 ID<input v-model.trim="lineForm.factoryId" placeholder="factory-demo" /></label>
        <label>产线编码<input v-model.trim="lineForm.code" placeholder="L005" /></label>
        <label>产线名称<input v-model.trim="lineForm.name" placeholder="新产线" /></label>
        <label>产线类型<input v-model.trim="lineForm.type" placeholder="装配" /></label>
        <label>目标 OEE<input v-model.number="lineForm.targetOee" type="number" min="0" max="100" /></label>
        <p v-if="lineFormError" class="form-error">{{ lineFormError }}</p>
        <p v-if="lineFormNotice" class="form-notice">{{ lineFormNotice }}</p>
        <div class="line-dialog__actions"><button type="button" class="secondary" @click="closeLineDialog">取消</button><button type="submit" :disabled="lineSubmitting">{{ lineSubmitting ? '提交中…' : editingLineId ? '保存修改' : '创建产线' }}</button></div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BottomLogs from '@/components/layout/BottomLogs.vue';
import FactoryAssistant from '@/components/layout/FactoryAssistant.vue';
import LeftPanel from '@/components/layout/LeftPanel.vue';
import OperationsPanel from '@/components/layout/OperationsPanel.vue';
import RightPanel from '@/components/layout/RightPanel.vue';
import TopBar from '@/components/layout/TopBar.vue';
import ThreeFactoryViewport from '@/components/scene/ThreeFactoryViewport.vue';
import { acknowledgeAlarm, canMesCapability, closeAlarm, createMaintenance, createProductionLine, deleteProductionLine, fetchFactorySnapshot, listWorkOrders, mesCapabilityReason, updateProductionLine } from '@/api/mesApi';
import { useFactoryStore } from '@/store/factoryStore';
import type { DeviceTelemetry, ProductionLineTelemetry } from '@/types/factory';
import { toBackendDeviceId, toBackendLineId } from '@/api/identityMap';
import { websocketService, type RealtimeConnectionState } from '@/websocket/WebSocketService';
import type { RealtimeMessage } from '@/websocket/protocol';

const store = useFactoryStore();
const mesSource = (import.meta.env.VITE_MES_SOURCE_NAME as string | undefined)?.trim() || 'NestJS Facade / OpenMES';
const selectedLineId = ref('LINE-01');
const loading = ref(true);
const loadError = ref(false);
const connectionState = ref<RealtimeConnectionState>('idle');
const dataBusy = ref(false);
const alarmSubmitting = ref(false);
const objectActionBusy = ref<'work-order' | 'inspection' | null>(null);
const dataNotice = ref('');
const viewScope = ref<'line' | 'factory'>('line');
const canWrite = canMesCapability('write');
const canControl = canMesCapability('control');
const writeDisabledReason = mesCapabilityReason('write');
const controlDisabledReason = mesCapabilityReason('control');
const showLineDialog = ref(false);
const lineSubmitting = ref(false);
const lineFormError = ref('');
const lineFormNotice = ref('');
const editingLineId = ref<string | null>(null);
const lineForm = ref({ factoryId: 'factory-demo', code: '', name: '', type: '', targetOee: 85 });
const emptyLine: ProductionLineTelemetry = {
  id: '', name: '暂无产线数据', workshop: '暂无数据', status: 'idle', completionRate: 0,
  plannedQuantity: 0, completedQuantity: 0, oee: 0, deviceOnline: '0/0', risk: '暂无数据',
};
const {
  devices,
  agvs,
  alarms,
  logs,
  todayTasks,
  powerConsumption,
  temperatureTrend,
  selectedDeviceId,
  selectedDevice,
  onlineDeviceCount,
  connected,
  productionSummary,
  productionLines,
} = storeToRefs(store);

const lineSummaries = computed<ProductionLineTelemetry[]>(() => {
  return productionLines.value.map((line) => {
    const lineDevices = devices.value.filter((device) => device.lineId === line.id);
    const hasError = lineDevices.some((device) => device.status === 'error');
    const hasAttention = lineDevices.some((device) => device.status === 'warning' || device.status === 'offline');
    const onlineCount = lineDevices.filter((device) => device.status !== 'offline').length;
    const status = hasError || line.status === 'error'
      ? 'error'
      : hasAttention || line.status === 'warning'
        ? 'warning'
        : lineDevices.length ? 'running' : 'idle';
    return {
      ...line,
      status,
      deviceOnline: `${onlineCount}/${lineDevices.length || 0}`,
      risk: status === 'error' ? '设备故障' : status === 'warning' ? '需要关注' : '低风险',
    };
  });
});

const selectedLine = computed(() => lineSummaries.value.find((line) => line.id === selectedLineId.value) ?? lineSummaries.value[0] ?? emptyLine);
const lineDevices = computed(() => devices.value.filter((device) => device.lineId === selectedLineId.value));
const lineAgvs = computed(() => agvs.value.filter((agv) => agv.lineId === selectedLineId.value));
const visibleSceneDeviceIds = computed(() => (viewScope.value === 'factory' ? devices.value : lineDevices.value).map((device) => device.id));
const visibleSceneAgvIds = computed(() => (viewScope.value === 'factory' ? agvs.value : lineAgvs.value).map((agv) => agv.id));
const lineAlarms = computed(() => alarms.value.filter((alarm) => !alarm.lineId || alarm.lineId === selectedLineId.value));
const selectedLineOnlineRate = computed(() => {
  if (!lineDevices.value.length) return 0;
  return Math.round((lineDevices.value.filter((device) => device.status !== 'offline').length / lineDevices.value.length) * 100);
});
const activeSelectedDevice = computed(() => selectedDevice.value?.lineId === selectedLineId.value ? selectedDevice.value : null);
const hasData = computed(() => devices.value.length > 0 || productionLines.value.length > 0);

let unsubscribe: (() => void) | null = null;
let unsubscribeConnection: (() => void) | null = null;
let apiRefreshTimer: number | null = null;

const handleSceneSelect = (device: DeviceTelemetry | null) => store.selectDevice(device?.id ?? null);
const handleListSelect = (id: string) => store.selectDevice(id);

const handleDataChanged = () => {
  void refreshData();
};

const refreshData = async () => {
  if (dataBusy.value) return;
  dataBusy.value = true;
  dataNotice.value = '';
  try {
    await refreshApiSnapshot();
    dataNotice.value = '数据已刷新';
  } catch {
    loadError.value = true;
    dataNotice.value = '刷新失败，请检查服务和权限';
  } finally {
    dataBusy.value = false;
  }
};

const reconnectRealtime = () => {
  if (dataBusy.value) return;
  dataBusy.value = true;
  dataNotice.value = '';
  websocketService.disconnect();
  startRealtime();
  startApiPolling();
  void refreshApiSnapshot()
    .then(() => { dataNotice.value = '数据源已重连，状态已刷新'; })
    .catch(() => {
      loadError.value = true;
      dataNotice.value = '重连失败，请检查 API、SSE 配置和服务状态';
    })
    .finally(() => { dataBusy.value = false; });
};

const ackAlarm = async (id: string) => {
  if (!canWrite || alarmSubmitting.value) { dataNotice.value = writeDisabledReason; return; }
  alarmSubmitting.value = true;
  try { await acknowledgeAlarm(id); await refreshApiSnapshot(); dataNotice.value = '告警已确认'; }
  catch { dataNotice.value = '告警确认失败，请检查后端服务和当前角色权限'; }
  finally { alarmSubmitting.value = false; }
};

const closeAlarmAction = async (id: string) => {
  if (!canWrite || alarmSubmitting.value) { dataNotice.value = writeDisabledReason; return; }
  alarmSubmitting.value = true;
  try { await closeAlarm(id); await refreshApiSnapshot(); dataNotice.value = '告警已关闭'; }
  catch { dataNotice.value = '告警关闭失败，请检查后端服务和当前角色权限'; }
  finally { alarmSubmitting.value = false; }
};

const handleLineSelect = (id: string) => {
  selectedLineId.value = id;
  const nextDevice = devices.value.find((device) => device.lineId === id && device.status !== 'offline')
    ?? devices.value.find((device) => device.lineId === id);
  store.selectDevice(nextDevice?.id ?? null);
};

const clearApiRefreshTimer = () => {
  window.clearInterval(apiRefreshTimer ?? undefined);
  apiRefreshTimer = null;
};

const startApiPolling = (interval = 3_000) => {
  clearApiRefreshTimer();
  apiRefreshTimer = window.setInterval(() => {
    void refreshApiSnapshot().catch(() => {
      loadError.value = true;
      store.setConnectionState('offline');
    });
  }, interval);
};

const openLineDialog = () => {
  if (dataBusy.value) return;
  if (!canControl) { dataNotice.value = controlDisabledReason; return; }
  editingLineId.value = null;
  lineForm.value = { factoryId: 'factory-demo', code: '', name: '', type: '', targetOee: 85 };
  lineFormError.value = '';
  lineFormNotice.value = '';
  showLineDialog.value = true;
};

const openEditLine = (lineId: string) => {
  if (dataBusy.value) return;
  if (!canControl) { dataNotice.value = controlDisabledReason; return; }
  const line = lineSummaries.value.find((item) => item.id === lineId);
  if (!line) return;
  editingLineId.value = lineId;
  lineForm.value = {
    factoryId: line.factoryId ?? 'factory-demo',
    code: line.code ?? '',
    name: line.name,
    type: line.type ?? '',
    targetOee: Math.round(line.targetOee ?? 85),
  };
  lineFormError.value = '';
  lineFormNotice.value = '';
  showLineDialog.value = true;
};

const deleteLine = async (lineId: string) => {
  if (lineSubmitting.value || dataBusy.value) return;
  if (!canControl) { dataNotice.value = controlDisabledReason; return; }
  const line = lineSummaries.value.find((item) => item.id === lineId);
  if (!line || !window.confirm(`确认删除产线“${line.name}”？该操作将提交到后端。`)) return;
  lineSubmitting.value = true;
  try {
    await deleteProductionLine(toBackendLineId(lineId));
    await refreshApiSnapshot();
    if (selectedLineId.value === lineId) handleLineSelect(lineSummaries.value[0]?.id ?? '');
    dataNotice.value = '产线删除成功，数据已刷新';
  } catch {
    dataNotice.value = '产线删除失败，请检查后端权限和服务状态';
  } finally {
    lineSubmitting.value = false;
  }
};

const closeLineDialog = () => {
  if (lineSubmitting.value) return;
  showLineDialog.value = false;
};

const submitLine = async () => {
  const form = lineForm.value;
  if (lineSubmitting.value) return;
  if (!canControl) {
    lineFormError.value = controlDisabledReason;
    return;
  }
  if (form.factoryId.length < 2 || form.code.length < 2 || form.name.length < 2 || !form.type) {
    lineFormError.value = '请完整填写工厂 ID、产线编码、名称和类型';
    return;
  }
  if (!Number.isInteger(form.targetOee) || form.targetOee < 0 || form.targetOee > 100) {
    lineFormError.value = '目标 OEE 必须是 0～100 的整数';
    return;
  }
  lineSubmitting.value = true;
  lineFormError.value = '';
  try {
    if (editingLineId.value) {
      await updateProductionLine(toBackendLineId(editingLineId.value), {
        code: form.code,
        name: form.name,
        type: form.type,
        targetOee: form.targetOee,
      });
    } else {
      await createProductionLine(form);
    }
    await refreshApiSnapshot();
    lineFormNotice.value = editingLineId.value ? '产线修改成功，数据已刷新' : '产线创建成功，数据已刷新';
    editingLineId.value = null;
    lineForm.value = { factoryId: form.factoryId, code: '', name: '', type: '', targetOee: 85 };
    window.setTimeout(() => { if (lineFormNotice.value) closeLineDialog(); }, 700);
  } catch {
    lineFormError.value = '产线创建失败，请检查编码是否重复或后端服务状态';
  } finally {
    lineSubmitting.value = false;
  }
};

const handleViewWorkOrder = async (deviceId: string) => {
  if (!canWrite) { dataNotice.value = writeDisabledReason; return; }
  objectActionBusy.value = 'work-order';
  dataNotice.value = '';
  try {
    const orders = await listWorkOrders();
    const backendDeviceId = toBackendDeviceId(deviceId);
    const related = orders.filter((order) => String(order.deviceId ?? '') === deviceId || String(order.deviceId ?? '') === backendDeviceId);
    dataNotice.value = related.length ? `已查询设备 ${deviceId} 的 ${related.length} 条工单` : `设备 ${deviceId} 暂无关联工单`;
  } catch (cause) {
    dataNotice.value = cause instanceof Error ? `工单查询失败：${cause.message}` : '工单查询失败，请检查后端服务和当前角色权限';
  } finally { objectActionBusy.value = null; }
};

const handleCreateInspection = async (deviceId: string) => {
  if (!canControl) { dataNotice.value = controlDisabledReason; return; }
  const line = selectedLine.value;
  const device = devices.value.find((item) => item.id === deviceId);
  if (!line.id || !device) { dataNotice.value = '未找到当前设备或产线，未提交点检任务'; return; }
  objectActionBusy.value = 'inspection';
  dataNotice.value = '';
  try {
    await createMaintenance({
      lineId: toBackendLineId(line.id),
      deviceId: toBackendDeviceId(deviceId),
      type: 'inspection',
      title: `${device.name} 点检任务`,
      description: '由数字孪生对象详情发起的点检任务',
      plannedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    dataNotice.value = `点检任务已创建：${device.name}`;
  } catch (cause) {
    dataNotice.value = cause instanceof Error ? `点检创建失败：${cause.message}` : '点检创建失败，请检查后端服务和当前角色权限';
  } finally { objectActionBusy.value = null; }
};

const ensureLineSelection = () => {
  const nextLine = productionLines.value.find((line) => line.id === selectedLineId.value) ?? productionLines.value[0];
  if (nextLine && selectedLineId.value !== nextLine.id) selectedLineId.value = nextLine.id;
  if (selectedDeviceId.value && devices.value.some((device) => device.id === selectedDeviceId.value && device.lineId === selectedLineId.value)) return;
  const firstDevice = devices.value.find((device) => device.lineId === selectedLineId.value);
  store.selectDevice(firstDevice?.id ?? null);
};

const handleRealtimeMessage = (message: RealtimeMessage) => {
  if (message.type === 'snapshot') {
    store.applySnapshot(message.payload);
    ensureLineSelection();
  }
  if (message.type === 'device:update') store.updateDevice(message.payload);
  if (message.type === 'agv:update') store.updateAgv(message.payload);
  if (message.type === 'alarm') store.pushAlarm(message.payload);
  if (message.type === 'alarm:clear') store.removeAlarm(message.payload.id);
  if (message.type === 'line:update') store.updateLine(message.payload);
  if (message.type === 'log') store.pushLog(message.payload);
};

const handleConnectionChange = (change: { state: RealtimeConnectionState }) => {
  connectionState.value = change.state;
  store.setConnectionState(change.state);
};

const refreshApiSnapshot = async () => {
  const result = await fetchFactorySnapshot();
  store.applySnapshot(result.snapshot, result.lines);
  store.setDataSource('api');
  store.setConnectionState('polling');
  connectionState.value = 'polling';
  loadError.value = false;
  ensureLineSelection();
};

const startRealtime = () => {
  unsubscribe?.();
  unsubscribeConnection?.();
  unsubscribe = websocketService.subscribe(handleRealtimeMessage);
  unsubscribeConnection = websocketService.onConnectionChange(handleConnectionChange);
  const realtimeUrl = (import.meta.env.VITE_REALTIME_URL as string | undefined)?.trim();
  if (realtimeUrl) websocketService.connect({ mode: 'remote', emitSnapshot: false });
  else store.setConnectionState('polling');
};

onMounted(async () => {
  try {
    await refreshApiSnapshot();
    startRealtime();
    startApiPolling();
  } catch (error) {
    console.info('MES API unavailable; local simulator is disabled in api mode', error);
    loadError.value = true;
    store.setDataSource('api');
    apiRefreshTimer = window.setInterval(() => {
      void refreshApiSnapshot()
        .then(() => undefined)
        .catch(() => {
          loadError.value = true;
          store.setConnectionState('offline');
        });
    }, 5_000);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  window.clearInterval(apiRefreshTimer ?? undefined);
  unsubscribe?.();
  unsubscribeConnection?.();
  websocketService.disconnect();
});
</script>

<style scoped>
.factory-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(29, 143, 255, 0.04), transparent 32%, transparent 68%, rgba(77, 255, 181, 0.035)),
    #07111f;
}

.factory-page::after {
  position: absolute;
  inset: 76px 0 0;
  z-index: 2;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(7, 17, 31, 0.82), transparent 28%, transparent 72%, rgba(7, 17, 31, 0.82)),
    linear-gradient(180deg, rgba(7, 17, 31, 0.18), transparent 42%, rgba(7, 17, 31, 0.55));
  content: "";
}

.data-banner {
  position: absolute;
  top: 88px;
  left: 50%;
  z-index: 8;
  padding: 7px 12px;
  border: 1px solid rgba(104, 200, 255, 0.32);
  background: rgba(7, 17, 31, 0.82);
  color: #9ed2ff;
  font-size: 11px;
  transform: translateX(-50%);
}

.data-banner--warning {
  border-color: rgba(255, 200, 87, 0.4);
  color: #ffc857;
}

.data-controls {
  position: absolute;
  right: 382px;
  bottom: 140px;
  z-index: 8;
  display: grid;
  grid-template-columns: auto 150px auto auto;
  align-items: center;
  gap: 7px;
  padding: 9px 10px;
  border: 1px solid rgba(104, 200, 255, 0.24);
  background: rgba(7, 17, 31, 0.9);
}

.data-controls__title {
  color: #9ed2ff;
  font-size: 11px;
  white-space: nowrap;
}

.data-controls select,
.data-controls button {
  min-height: 26px;
  border: 1px solid rgba(104, 200, 255, 0.3);
  background: rgba(255, 255, 255, 0.06);
  color: #dcecff;
  font-size: 11px;
}

.data-controls select { padding: 0 5px; }
.data-controls button { padding: 0 8px; cursor: pointer; }
.data-controls button:hover:not(:disabled) { border-color: #68c8ff; }
.data-controls button.secondary { color: #ffc857; }
.data-controls button:disabled,
.data-controls select:disabled { cursor: not-allowed; opacity: 0.45; }
.data-controls button:disabled { background: rgba(255, 255, 255, 0.04); }
.data-controls small { grid-column: 1 / -1; color: #7898b6; font-size: 10px; }

@media (max-width: 1180px) {
  .data-controls { right: 18px; bottom: 140px; }
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(2, 8, 16, 0.72);
}

.line-dialog {
  display: grid;
  width: min(420px, calc(100vw - 32px));
  gap: 12px;
  padding: 18px;
}

.line-dialog__head,
.line-dialog__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.line-dialog__head strong { color: #eef8ff; font-size: 16px; }
.line-dialog__head button { border: 0; background: transparent; color: #9ed2ff; cursor: pointer; font-size: 22px; }
.line-dialog label { display: grid; gap: 5px; color: #83add0; font-size: 11px; }
.line-dialog input { padding: 8px 9px; border: 1px solid rgba(111,183,255,.24); outline: none; background: rgba(0,0,0,.2); color: #dcecff; }
.line-dialog input:focus { border-color: #68c8ff; }
.line-dialog__actions { justify-content: flex-end; margin-top: 4px; }
.line-dialog__actions button { padding: 7px 12px; border: 1px solid rgba(104,200,255,.34); background: #1d8fff; color: #fff; cursor: pointer; font-size: 11px; }
.line-dialog__actions .secondary { background: transparent; color: #9ed2ff; }
.line-dialog__actions button:disabled { cursor: wait; opacity: .55; }
.form-error { margin: 0; color: #ff8094; font-size: 11px; }
.form-notice { margin: 0; color: #72f5ba; font-size: 11px; }
</style>
