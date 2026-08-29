<template>
  <div class="factory-page">
    <TopBar
      :online-device-count="onlineDeviceCount"
      :connected="connected"
      :online-rate="store.onlineRate"
      :line-count="lineSummaries.length"
      :connection-state="connectionState"
      :data-source="store.dataSource"
      :simulation="simulator"
    />
    <div v-if="loading" class="data-banner">正在接入 MES 数据...</div>
    <div v-else-if="loadError" class="data-banner data-banner--warning">
      {{ hasData ? '实时数据暂不可用，已保留最近一次数据并继续重试' : 'MES 数据暂不可用，当前无实时数据，请检查服务和权限' }}
    </div>
    <section class="simulation-controls panel" aria-label="本地仿真控制">
      <div class="simulation-controls__title">故障注入 · 本地仿真</div>
      <select v-model="controlDeviceId" :disabled="!isLocalFallback" aria-label="选择设备">
        <option v-for="device in lineDevices" :key="device.id" :value="device.id">{{ device.name }}</option>
      </select>
      <button type="button" :disabled="!isLocalFallback || !controlDeviceId" @click="injectFault">注入故障</button>
      <button type="button" class="secondary" :disabled="!isLocalFallback || !controlDeviceId" @click="recoverDevice">恢复设备</button>
      <small>{{ isLocalFallback ? '仅影响本地演示数据' : 'API 模式只读，停止真实控制' }}</small>
    </section>
    <ThreeFactoryViewport
      :devices="devices"
      :agvs="agvs"
      :visible-device-ids="lineDevices.map((device) => device.id)"
      :visible-agv-ids="lineAgvs.map((agv) => agv.id)"
      :selected-device="activeSelectedDevice"
      @select-device="handleSceneSelect"
    />
    <LeftPanel
      :alarms="lineAlarms"
      :devices="lineDevices"
      :selected-device-id="selectedDeviceId"
      @select-device="handleListSelect"
      :production-lines="lineSummaries"
      :selected-line-id="selectedLineId"
      @select-line="handleLineSelect"
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
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BottomLogs from '@/components/layout/BottomLogs.vue';
import FactoryAssistant from '@/components/layout/FactoryAssistant.vue';
import LeftPanel from '@/components/layout/LeftPanel.vue';
import RightPanel from '@/components/layout/RightPanel.vue';
import TopBar from '@/components/layout/TopBar.vue';
import ThreeFactoryViewport from '@/components/scene/ThreeFactoryViewport.vue';
import { fetchFactorySnapshot } from '@/api/mesApi';
import { useFactoryStore } from '@/store/factoryStore';
import type { DeviceTelemetry, ProductionLineTelemetry } from '@/types/factory';
import { createId, formatClock } from '@/utils/time';
import { websocketService, type RealtimeConnectionState } from '@/websocket/WebSocketService';
import type { RealtimeMessage } from '@/websocket/protocol';

const store = useFactoryStore();
const DATA_MODE = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'api';
const selectedLineId = ref('LINE-01');
const loading = ref(true);
const loadError = ref(false);
const connectionState = ref<RealtimeConnectionState>('idle');
const controlDeviceId = ref('');
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
const isLocalFallback = computed(() => DATA_MODE === 'local' && store.dataSource === 'simulator');
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

const handleLineSelect = (id: string) => {
  selectedLineId.value = id;
  const nextDevice = devices.value.find((device) => device.lineId === id && device.status !== 'offline')
    ?? devices.value.find((device) => device.lineId === id);
  store.selectDevice(nextDevice?.id ?? null);
};

const injectFault = () => {
  if (isLocalFallback.value) websocketService.injectLocalFault(controlDeviceId.value);
};

const recoverDevice = () => {
  if (isLocalFallback.value) websocketService.recoverLocalDevice(controlDeviceId.value);
};

const handleViewWorkOrder = (deviceId: string) => {
  store.pushLog({ id: createId('log'), time: formatClock(), message: `查看设备 ${deviceId} 的当前工单` });
};

const handleCreateInspection = (deviceId: string) => {
  store.pushLog({ id: createId('log'), time: formatClock(), message: `已创建设备 ${deviceId} 点检草稿（待现场确认）` });
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
    apiRefreshTimer = window.setInterval(() => {
      void refreshApiSnapshot().catch((error) => {
        console.warn('MES API refresh failed, keeping last known snapshot', error);
        loadError.value = true;
        store.setConnectionState('offline');
      });
    }, 3_000);
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
.simulation-controls small { grid-column: 1 / -1; color: #7898b6; font-size: 10px; }

@media (max-width: 1180px) {
  .simulation-controls { right: 18px; bottom: 140px; }
}
</style>
