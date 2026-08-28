<template>
  <div class="factory-page">
    <TopBar :online-device-count="onlineDeviceCount" :connected="connected" :online-rate="store.onlineRate" :line-count="lineSummaries.length" />
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BottomLogs from '@/components/layout/BottomLogs.vue';
import FactoryAssistant from '@/components/layout/FactoryAssistant.vue';
import LeftPanel from '@/components/layout/LeftPanel.vue';
import RightPanel from '@/components/layout/RightPanel.vue';
import TopBar from '@/components/layout/TopBar.vue';
import ThreeFactoryViewport from '@/components/scene/ThreeFactoryViewport.vue';
import { useFactoryStore } from '@/store/factoryStore';
import { fetchFactorySnapshot } from '@/api/mesApi';
import type { DeviceTelemetry, ProductionLineTelemetry } from '@/types/factory';
import { websocketService } from '@/websocket/WebSocketService';

const store = useFactoryStore();
const selectedLineId = ref('LINE-01');
const dataSource = ref<'api' | 'simulator'>('simulator');
const apiLines = ref<ProductionLineTelemetry[]>([]);
const fallbackLineDefinitions: ProductionLineTelemetry[] = [
  { id: 'LINE-01', name: 'CNC加工线', workshop: '一车间', status: 'running', completionRate: 86, plannedQuantity: 420, completedQuantity: 361, oee: 84, deviceOnline: '4/4', risk: '低风险' },
  { id: 'LINE-02', name: '装配线', workshop: '一车间', status: 'warning', completionRate: 72, plannedQuantity: 280, completedQuantity: 202, oee: 76, deviceOnline: '3/4', risk: '缺料预警' },
  { id: 'LINE-03', name: '焊接线', workshop: '二车间', status: 'error', completionRate: 64, plannedQuantity: 240, completedQuantity: 154, oee: 61, deviceOnline: '2/4', risk: '设备停机' },
  { id: 'LINE-04', name: '视觉检测线', workshop: '二车间', status: 'running', completionRate: 91, plannedQuantity: 510, completedQuantity: 464, oee: 89, deviceOnline: '3/3', risk: '低风险' }
];
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
  connected
} = storeToRefs(store);

const lineSummaries = computed<ProductionLineTelemetry[]>(() => {
  const lineDefinitions = apiLines.value.length ? apiLines.value : fallbackLineDefinitions;
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
      risk: status === 'error' ? '设备故障' : status === 'warning' ? '需要关注' : '低风险'
    };
  });
});

const selectedLine = computed(() => lineSummaries.value.find((line) => line.id === selectedLineId.value) ?? lineSummaries.value[0]);
const lineDevices = computed(() => devices.value.filter((device) => device.lineId === selectedLineId.value));
const lineAgvs = computed(() => agvs.value.filter((agv) => agv.lineId === selectedLineId.value));
const lineAlarms = computed(() => alarms.value.filter((alarm) => !alarm.lineId || alarm.lineId === selectedLineId.value));
const selectedLineOnlineRate = computed(() => {
  if (!lineDevices.value.length) return 0;
  return Math.round((lineDevices.value.filter((device) => device.status !== 'offline').length / lineDevices.value.length) * 100);
});
const activeSelectedDevice = computed(() => selectedDevice.value?.lineId === selectedLineId.value ? selectedDevice.value : null);

let unsubscribe: (() => void) | null = null;

const handleSceneSelect = (device: DeviceTelemetry | null) => {
  store.selectDevice(device?.id ?? null);
};

const handleListSelect = (id: string) => {
  store.selectDevice(id);
};

const handleLineSelect = (id: string) => {
  selectedLineId.value = id;
  const nextDevice = devices.value.find((device) => device.lineId === id && device.status !== 'offline')
    ?? devices.value.find((device) => device.lineId === id);
  store.selectDevice(nextDevice?.id ?? null);
};

const ensureLineSelection = () => {
  if (selectedDeviceId.value) return;
  const firstDevice = devices.value.find((device) => device.lineId === selectedLineId.value);
  store.selectDevice(firstDevice?.id ?? null);
};

const connectSimulator = () => {
  unsubscribe = websocketService.subscribe((message) => {
    if (message.type === 'snapshot') {
      store.applySnapshot(message.payload);
      store.setConnected(true);
      ensureLineSelection();
    }
    if (message.type === 'device:update') {
      store.updateDevice(message.payload);
    }
    if (message.type === 'agv:update') {
      store.updateAgv(message.payload);
    }
    if (message.type === 'alarm') {
      store.pushAlarm(message.payload);
    }
    if (message.type === 'log') {
      store.pushLog(message.payload);
    }
  });
  websocketService.connect();
};

onMounted(async () => {
  try {
    const result = await fetchFactorySnapshot();
    apiLines.value = result.lines;
    store.applySnapshot(result.snapshot);
    dataSource.value = 'api';
    store.setConnected(true);
    ensureLineSelection();
  } catch (error) {
    console.info('MES API unavailable, using local simulator', error);
    apiLines.value = [];
    dataSource.value = 'simulator';
    connectSimulator();
  }
});

onBeforeUnmount(() => {
  unsubscribe?.();
  websocketService.disconnect();
  if (dataSource.value === 'simulator') store.setConnected(false);
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
</style>
