<template>
  <div class="factory-page">
    <TopBar :online-device-count="onlineDeviceCount" :connected="connected" :online-rate="store.onlineRate" :line-count="productionLines.length" />
    <ThreeFactoryViewport
      :devices="devices"
      :agvs="agvs"
      :selected-device="selectedDevice"
      @select-device="handleSceneSelect"
    />
    <LeftPanel
      :alarms="alarms"
      :devices="devices"
      :selected-device-id="selectedDeviceId"
      @select-device="handleListSelect"
      :production-lines="productionLines"
      :selected-line-id="selectedLineId"
      @select-line="selectedLineId = $event"
    />
    <RightPanel
      :devices="devices"
      :agvs="agvs"
      :alarms="alarms"
      :today-tasks="todayTasks"
      :power-consumption="powerConsumption"
      :temperature-trend="temperatureTrend"
      :selected-device="selectedDevice"
      :online-rate="store.onlineRate"
      :selected-line="selectedLine"
    />
    <BottomLogs :logs="logs" />
    <FactoryAssistant :selected-device="selectedDevice" :alarms="alarms" @select-device="handleListSelect" />
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
import type { DeviceTelemetry, ProductionLineTelemetry } from '@/types/factory';
import { websocketService } from '@/websocket/WebSocketService';

const store = useFactoryStore();
const selectedLineId = ref('LINE-01');
const productionLines: ProductionLineTelemetry[] = [
  { id: 'LINE-01', name: 'CNC加工线', workshop: '一车间', status: 'running', completionRate: 86, plannedQuantity: 420, completedQuantity: 361, oee: 84, deviceOnline: '4/4', risk: '低风险' },
  { id: 'LINE-02', name: '装配线', workshop: '一车间', status: 'warning', completionRate: 72, plannedQuantity: 280, completedQuantity: 202, oee: 76, deviceOnline: '3/4', risk: '缺料预警' },
  { id: 'LINE-03', name: '焊接线', workshop: '二车间', status: 'error', completionRate: 64, plannedQuantity: 240, completedQuantity: 154, oee: 61, deviceOnline: '2/4', risk: '设备停机' },
  { id: 'LINE-04', name: '视觉检测线', workshop: '二车间', status: 'running', completionRate: 91, plannedQuantity: 510, completedQuantity: 464, oee: 89, deviceOnline: '3/3', risk: '低风险' }
];
const selectedLine = computed(() => productionLines.find((line) => line.id === selectedLineId.value) ?? productionLines[0]);
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

let unsubscribe: (() => void) | null = null;

const handleSceneSelect = (device: DeviceTelemetry | null) => {
  store.selectDevice(device?.id ?? null);
};

const handleListSelect = (id: string) => {
  store.selectDevice(id);
};

onMounted(() => {
  unsubscribe = websocketService.subscribe((message) => {
    if (message.type === 'snapshot') {
      store.applySnapshot(message.payload);
      store.setConnected(true);
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
});

onBeforeUnmount(() => {
  unsubscribe?.();
  websocketService.disconnect();
  store.setConnected(false);
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
