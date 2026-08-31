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
      :simulation="simulator"
    />
    <div v-if="loading" class="data-banner">正在接入 MES 数据...</div>
    <div v-else-if="loadError" class="data-banner data-banner--warning">
      {{ hasData ? '实时数据暂不可用，已保留最近一次数据并继续重试' : 'MES 数据暂不可用，当前无实时数据，请检查服务和权限' }}
    </div>
    <section class="simulation-controls panel" aria-label="设备控制">
      <div class="simulation-controls__title">控制模式</div>
      <select v-model="requestedControlMode" aria-label="控制模式" @change="confirmControlMode">
        <option value="api">API 控制</option>
        <option value="local">本地仿真</option>
      </select>
      <span class="control-mode-badge">当前：{{ controlMode === 'api' ? 'API' : '本地仿真' }}</span>
      <select v-model="selectedFaultType" :disabled="controlBusy" aria-label="故障类型">
        <option v-for="fault in faultTypes" :key="fault.value" :value="fault.value">{{ fault.label }}</option>
      </select>
      <select v-model="controlDeviceId" :disabled="!lineDevices.length || controlBusy" aria-label="选择设备">
        <option v-for="device in lineDevices" :key="device.id" :value="device.id">{{ device.name }}</option>
      </select>
      <button type="button" :disabled="controlBusy || !controlDeviceId" @click="injectFault">注入故障</button>
      <button type="button" class="secondary" :disabled="controlBusy || !controlDeviceId" @click="recoverDevice">恢复设备</button>
      <small>{{ controlNotice || (controlMode === 'local' ? '仅影响本地演示数据' : '操作将经后端 simulator/control 执行') }}</small>
    </section>
    <ThreeFactoryViewport
      :devices="devices"
      :agvs="agvs"
      :visible-device-ids="lineDevices.map((device) => device.id)"
      :visible-agv-ids="lineAgvs.map((agv) => agv.id)"
      :selected-device="activeSelectedDevice"
      @select-device="handleSceneSelect"
    />
    <OperationsPanel :selected-line="selectedLine" :selected-device="activeSelectedDevice" :lines="lineSummaries" :devices="devices" />
    <LeftPanel
      :alarms="lineAlarms"
      :devices="lineDevices"
      :selected-device-id="selectedDeviceId"
      @select-device="handleListSelect"
      :production-lines="lineSummaries"
      :selected-line-id="selectedLineId"
      @select-line="handleLineSelect"
      :can-manage-lines="controlMode === 'api'"
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BottomLogs from '@/components/layout/BottomLogs.vue';
import FactoryAssistant from '@/components/layout/FactoryAssistant.vue';
import LeftPanel from '@/components/layout/LeftPanel.vue';
import OperationsPanel from '@/components/layout/OperationsPanel.vue';
import RightPanel from '@/components/layout/RightPanel.vue';
import TopBar from '@/components/layout/TopBar.vue';
import ThreeFactoryViewport from '@/components/scene/ThreeFactoryViewport.vue';
import { acknowledgeAlarm, closeAlarm, controlSimulator, createProductionLine, deleteProductionLine, fetchFactorySnapshot, updateProductionLine } from '@/api/mesApi';
import { useFactoryStore } from '@/store/factoryStore';
import type { DeviceTelemetry, ProductionLineTelemetry } from '@/types/factory';
import { toBackendDeviceId, toBackendLineId } from '@/api/identityMap';
import { websocketService, type RealtimeConnectionState } from '@/websocket/WebSocketService';
import type { RealtimeMessage } from '@/websocket/protocol';

const store = useFactoryStore();
const DATA_MODE = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'api';
const mesSource = (import.meta.env.VITE_MES_SOURCE_NAME as string | undefined)?.trim() || 'NestJS Facade / OpenMES';
const selectedLineId = ref('LINE-01');
const loading = ref(true);
const loadError = ref(false);
const connectionState = ref<RealtimeConnectionState>('idle');
const controlDeviceId = ref('');
const controlMode = ref<'api' | 'local'>(DATA_MODE);
const requestedControlMode = ref<'api' | 'local'>(DATA_MODE);
const controlBusy = ref(false);
const controlNotice = ref('');
const faultTypes = [
  { value: 'OVERHEAT', label: '过热' },
  { value: 'JAM', label: '卡料' },
  { value: 'COMMUNICATION_LOSS', label: '通信中断' },
  { value: 'QUALITY_DRIFT', label: '质量漂移' },
  { value: 'EMERGENCY_STOP', label: '急停' },
  { value: 'MATERIAL_SHORTAGE', label: '物料短缺' },
  { value: 'QUALITY_ANOMALY', label: '质量异常' },
] as const;
const selectedFaultType = ref<(typeof faultTypes)[number]['value']>('OVERHEAT');
const showLineDialog = ref(false);
const lineSubmitting = ref(false);
const lineFormError = ref('');
const lineFormNotice = ref('');
const editingLineId = ref<string | null>(null);
const lineForm = ref({ factoryId: 'factory-demo', code: '', name: '', type: '', targetOee: 85 });
const fallbackLineDefinitions: ProductionLineTelemetry[] = [
  { id: 'LINE-01', name: 'CNC加工线', workshop: '一车间', status: 'running', completionRate: 86, plannedQuantity: 420, completedQuantity: 361, oee: 84, deviceOnline: '4/4', risk: '低风险' },
  { id: 'LINE-02', name: '装配线', workshop: '一车间', status: 'warning', completionRate: 72, plannedQuantity: 280, completedQuantity: 202, oee: 76, deviceOnline: '3/4', risk: '缺料预警' },
  { id: 'LINE-03', name: '焊接线', workshop: '二车间', status: 'error', completionRate: 64, plannedQuantity: 240, completedQuantity: 154, oee: 61, deviceOnline: '2/4', risk: '设备停机' },
  { id: 'LINE-04', name: '视觉检测线', workshop: '二车间', status: 'running', completionRate: 91, plannedQuantity: 510, completedQuantity: 464, oee: 89, deviceOnline: '3/3', risk: '低风险' },
];
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
  simulator,
} = storeToRefs(store);

const lineSummaries = computed<ProductionLineTelemetry[]>(() => {
  const lineDefinitions = productionLines.value.length || DATA_MODE !== 'local' ? productionLines.value : fallbackLineDefinitions;
  return lineDefinitions.map((line) => {
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
const lineAlarms = computed(() => alarms.value.filter((alarm) => !alarm.lineId || alarm.lineId === selectedLineId.value));
const selectedLineOnlineRate = computed(() => {
  if (!lineDevices.value.length) return 0;
  return Math.round((lineDevices.value.filter((device) => device.status !== 'offline').length / lineDevices.value.length) * 100);
});
const activeSelectedDevice = computed(() => selectedDevice.value?.lineId === selectedLineId.value ? selectedDevice.value : null);
const hasData = computed(() => devices.value.length > 0 || productionLines.value.length > 0);

watch(lineDevices, (nextDevices) => {
  if (!nextDevices.some((device) => device.id === controlDeviceId.value)) {
    controlDeviceId.value = nextDevices[0]?.id ?? '';
  }
}, { immediate: true });

let unsubscribe: (() => void) | null = null;
let unsubscribeConnection: (() => void) | null = null;
let apiRefreshTimer: number | null = null;

const handleSceneSelect = (device: DeviceTelemetry | null) => store.selectDevice(device?.id ?? null);
const handleListSelect = (id: string) => store.selectDevice(id);

const ackAlarm = async (id: string) => {
  try { await acknowledgeAlarm(id); await refreshApiSnapshot(); controlNotice.value = '告警已确认'; }
  catch { controlNotice.value = '告警确认失败，请检查后端服务'; }
};

const closeAlarmAction = async (id: string) => {
  try { await closeAlarm(id); await refreshApiSnapshot(); controlNotice.value = '告警已关闭'; }
  catch { controlNotice.value = '告警关闭失败，请检查后端服务'; }
};

const handleLineSelect = (id: string) => {
  selectedLineId.value = id;
  const nextDevice = devices.value.find((device) => device.lineId === id && device.status !== 'offline')
    ?? devices.value.find((device) => device.lineId === id);
  store.selectDevice(nextDevice?.id ?? null);
};

const injectFault = () => {
  if (!controlDeviceId.value || controlBusy.value) return;
  if (!window.confirm(`${controlMode.value === 'api' ? '将通过后端控制接口' : '将在本地仿真中'}注入设备故障，是否继续？`)) return;
  controlBusy.value = true;
  const operation = controlMode.value === 'local'
    ? Promise.resolve(websocketService.injectLocalFault(controlDeviceId.value))
    : controlSimulator({
      action: 'fault',
      lineId: toBackendLineId(selectedLineId.value),
      deviceId: toBackendDeviceId(controlDeviceId.value),
      faultType: selectedFaultType.value,
      requestedBy: 'digital-twin-ui',
    }).then(() => true);
  void operation
    .then((accepted) => { controlNotice.value = accepted ? '故障指令已受理，等待实时状态回传' : '故障指令未执行'; })
    .catch(() => { controlNotice.value = '故障指令失败，请检查后端控制服务'; })
    .finally(() => { controlBusy.value = false; });
};

const recoverDevice = () => {
  if (!controlDeviceId.value || controlBusy.value) return;
  if (!window.confirm(`${controlMode.value === 'api' ? '将通过后端控制接口恢复当前设备' : '将在本地仿真中'}恢复设备，是否继续？`)) return;
  controlBusy.value = true;
  const operation = controlMode.value === 'local'
    ? Promise.resolve(websocketService.recoverLocalDevice(controlDeviceId.value))
    : controlSimulator({
      action: 'recover',
      lineId: toBackendLineId(selectedLineId.value),
      deviceId: toBackendDeviceId(controlDeviceId.value),
      requestedBy: 'digital-twin-ui',
    }).then(() => true);
  void operation
    .then((accepted) => { controlNotice.value = accepted ? '恢复指令已受理，等待实时状态回传' : '恢复指令未执行'; })
    .catch(() => { controlNotice.value = '恢复指令失败，请检查后端控制服务'; })
    .finally(() => { controlBusy.value = false; });
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

const switchControlMode = async (mode: 'api' | 'local') => {
  controlMode.value = mode;
  store.setDataSource(mode === 'local' ? 'simulator' : 'api');
  websocketService.disconnect();
  clearApiRefreshTimer();
  if (mode === 'local') {
    startRealtime(true);
    return;
  }
  try {
    await refreshApiSnapshot();
  } catch {
    loadError.value = true;
    store.setConnectionState('offline');
  }
  startRealtime();
  startApiPolling();
};

const confirmControlMode = () => {
  const nextMode = requestedControlMode.value;
  if (nextMode === controlMode.value) return;
  const confirmed = window.confirm(`确认切换到${nextMode === 'api' ? 'API 控制' : '本地仿真'}模式？`);
  if (!confirmed) {
    requestedControlMode.value = controlMode.value;
    return;
  }
  void switchControlMode(nextMode);
};

const openLineDialog = () => {
  if (controlMode.value !== 'api') return;
  editingLineId.value = null;
  lineForm.value = { factoryId: 'factory-demo', code: '', name: '', type: '', targetOee: 85 };
  lineFormError.value = '';
  lineFormNotice.value = '';
  showLineDialog.value = true;
};

const openEditLine = (lineId: string) => {
  if (controlMode.value !== 'api') return;
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
  if (controlMode.value !== 'api' || lineSubmitting.value) return;
  const line = lineSummaries.value.find((item) => item.id === lineId);
  if (!line || !window.confirm(`确认删除产线“${line.name}”？该操作将提交到后端。`)) return;
  lineSubmitting.value = true;
  try {
    await deleteProductionLine(toBackendLineId(lineId));
    await refreshApiSnapshot();
    if (selectedLineId.value === lineId) handleLineSelect(lineSummaries.value[0]?.id ?? '');
    controlNotice.value = '产线删除成功，数据已刷新';
  } catch {
    controlNotice.value = '产线删除失败，请检查后端权限和服务状态';
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
  if (controlMode.value !== 'api') return;
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

const handleViewWorkOrder = (deviceId: string) => {
  controlNotice.value = `设备 ${deviceId} 的工单详情接口尚未配置`;
};

const handleCreateInspection = (deviceId: string) => {
  controlNotice.value = `设备 ${deviceId} 的点检提交接口尚未配置，未创建虚假记录`;
};

const ensureLineSelection = () => {
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
  if (message.type === 'simulator:update') store.updateSimulator(message.payload);
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

const startRealtime = (forceLocal = false) => {
  unsubscribe?.();
  unsubscribeConnection?.();
  unsubscribe = websocketService.subscribe(handleRealtimeMessage);
  unsubscribeConnection = websocketService.onConnectionChange(handleConnectionChange);
  const realtimeUrl = (import.meta.env.VITE_REALTIME_URL as string | undefined)?.trim();
  if (forceLocal) websocketService.connect({ mode: 'local' });
  else if (realtimeUrl) websocketService.connect({ mode: 'remote', emitSnapshot: false });
  else store.setConnectionState('polling');
};

onMounted(async () => {
  if (DATA_MODE === 'local') {
    store.setDataSource('simulator');
    startRealtime(true);
    loading.value = false;
    return;
  }
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

.simulation-controls {
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

.simulation-controls__title {
  color: #9ed2ff;
  font-size: 11px;
  white-space: nowrap;
}

.simulation-controls select,
.simulation-controls button {
  min-height: 26px;
  border: 1px solid rgba(104, 200, 255, 0.3);
  background: rgba(255, 255, 255, 0.06);
  color: #dcecff;
  font-size: 11px;
}

.simulation-controls select { padding: 0 5px; }
.simulation-controls button { padding: 0 8px; cursor: pointer; }
.simulation-controls button:hover:not(:disabled) { border-color: #68c8ff; }
.simulation-controls button.secondary { color: #ffc857; }
.simulation-controls button:disabled,
.simulation-controls select:disabled { cursor: not-allowed; opacity: 0.45; }
.simulation-controls button:disabled { background: rgba(255, 255, 255, 0.04); }
.simulation-controls small { grid-column: 1 / -1; color: #7898b6; font-size: 10px; }

@media (max-width: 1180px) {
  .simulation-controls { right: 18px; bottom: 140px; }
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
