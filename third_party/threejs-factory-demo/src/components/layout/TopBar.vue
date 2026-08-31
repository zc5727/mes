<template>
  <header class="top-bar panel">
    <div class="brand-block">
      <div class="brand-mark"></div>
      <div>
        <h1>智造运营中枢</h1>
        <p>Manufacturing Operations Control Center · 南沙示范工厂</p>
      </div>
    </div>
    <div class="top-metrics">
      <div class="metric">
        <span>在线设备</span>
        <strong>{{ onlineDeviceCount }}</strong>
      </div>
      <div class="metric">
        <span>设备在线率</span>
        <strong>{{ onlineRate }}%</strong>
      </div>
      <div class="metric">
        <span>产线联动</span>
        <strong>{{ lineCount }}条</strong>
      </div>
      <div class="metric">
        <span>连接状态</span>
        <strong :class="connected ? 'status-running' : 'status-error'">{{ connectionLabel }}</strong>
      </div>
      <div class="metric simulation-metric">
        <span>{{ dataSource === 'api' ? '外部 MES 来源' : '降级数据' }}</span>
        <strong>{{ dataSource === 'api' ? mesSource : simulationTime }}</strong>
      </div>
      <div class="clock">{{ clock }}</div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatClock } from '@/utils/time';
import type { SimulatorState } from '@/types/factory';

const props = defineProps<{
  onlineDeviceCount: number;
  connected: boolean;
  onlineRate: number;
  lineCount: number;
  connectionState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'fallback' | 'offline' | 'polling';
  dataSource: 'api' | 'simulator';
  mesSource: string;
  simulation?: SimulatorState;
}>();

const connectionLabel = computed(() => ({
  idle: 'IDLE',
  connecting: 'CONNECTING',
  connected: 'ONLINE',
  reconnecting: 'RECONNECTING',
  fallback: 'LOCAL MOCK',
  offline: 'OFFLINE',
  polling: 'API POLLING',
}[props.connectionState]));
const simulationTime = computed(() => {
  const value = props.simulation?.currentTime;
  if (!value) return props.dataSource === 'api' ? 'API' : '08:00:00';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toISOString().slice(11, 19);
});

const clock = ref(formatClock());
let timer: number | null = null;

onMounted(() => {
  timer = window.setInterval(() => {
    clock.value = formatClock();
  }, 1000);
});

onBeforeUnmount(() => {
  window.clearInterval(timer ?? undefined);
});
</script>

<style scoped>
.top-bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 76px;
  padding: 0 24px;
  border-radius: 0;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border: 1px solid rgba(77, 255, 181, 0.55);
  background: linear-gradient(135deg, rgba(29, 143, 255, 0.35), rgba(77, 255, 181, 0.18));
  box-shadow: 0 0 24px rgba(29, 143, 255, 0.35);
  clip-path: polygon(50% 0, 100% 28%, 100% 72%, 50% 100%, 0 72%, 0 28%);
}

h1 {
  margin: 0;
  color: #eef8ff;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0;
}

p {
  margin: 4px 0 0;
  color: #6fa8d6;
  font-size: 12px;
}

.top-metrics {
  display: flex;
  align-items: center;
  gap: 18px;
}

.metric {
  min-width: 108px;
  padding: 8px 12px;
  border: 1px solid rgba(111, 183, 255, 0.18);
  background: rgba(6, 18, 34, 0.62);
}

.metric span {
  display: block;
  color: #7eaed6;
  font-size: 12px;
}

.metric strong {
  display: block;
  margin-top: 2px;
  font-size: 20px;
}

.clock {
  width: 196px;
  color: #dcecff;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
