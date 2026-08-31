<template>
  <aside class="left-panel">
    <section class="panel block shop-block">
      <div class="panel-title">工厂导航</div>
      <div class="breadcrumb">南沙示范工厂 / {{ selectedLine?.workshop ?? '全部车间' }}</div>
      <div class="shop-tree">
        <button type="button" class="tree-row active" @click="$emit('select-line', selectedLineId)"><span>⌄</span>一车间</button>
        <button v-for="line in productionLines" :key="`tree-${line.id}`" type="button" class="tree-row" :class="{ selected: selectedLineId === line.id }" @click="$emit('select-line', line.id)"><span>└</span>{{ line.name }} <em>{{ deviceCount(line.id) }}台</em></button>
        <div class="tree-row tree-row--static"><span>└</span>原料与成品仓 <em>API数据</em></div>
      </div>
      <div class="flow-title line-overview-title">
        <span>生产线总览</span>
        <button type="button" class="add-line-button" :disabled="!canManageLines || lineBusy" :title="lineBusy ? '产线请求处理中' : !canManageLines ? '当前模式不允许修改产线' : '新增产线'" @click="$emit('add-line')">＋ 新增产线</button>
      </div>
      <div class="line-list">
        <div v-for="line in productionLines" :key="line.id" class="line-row">
          <button type="button" class="line-card" :class="[{ active: selectedLineId === line.id }, `line-${line.status}`]" @click="$emit('select-line', line.id)">
            <span class="line-state"></span>
            <span class="line-main"><strong>{{ line.name }}</strong><small>{{ line.workshop }} · OEE {{ line.oee }}%</small></span>
            <span class="line-rate">{{ line.completionRate }}%</span>
          </button>
          <span v-if="canManageLines" class="line-actions">
            <button type="button" :disabled="lineBusy" :title="lineBusy ? '产线请求处理中' : '编辑产线'" @click="$emit('edit-line', line.id)">编辑</button>
            <button type="button" :disabled="lineBusy" :title="lineBusy ? '产线请求处理中' : '删除产线'" @click="$emit('delete-line', line.id)">删除</button>
          </span>
        </div>
        <div v-if="!productionLines.length" class="empty-state">暂无产线数据，请检查 MES API 或数据权限。</div>
      </div>
      <div class="flow-title">当前生产流</div>
      <div class="flow-track"><span class="done">备料</span><i></i><span class="done">粗加工</span><i></i><span class="active-step">检测</span><i></i><span>入库</span></div>
    </section>
    <section class="panel block">
      <div class="panel-title">实时告警</div>
      <div class="alarm-list">
        <div v-for="alarm in alarms" :key="alarm.id" class="alarm-item" :class="`alarm-${alarm.level}`">
          <div class="alarm-head">
            <span>{{ alarm.source }}</span>
            <em>{{ alarm.time.slice(-8) }}</em>
          </div>
          <p>{{ alarm.message }}</p>
          <div class="alarm-actions"><button type="button" :disabled="!canManageLines" title="本地仿真模式不写入 MES" @click="$emit('ack-alarm', alarm.id)">确认</button><button type="button" :disabled="!canManageLines" title="本地仿真模式不写入 MES" @click="$emit('close-alarm', alarm.id)">关闭</button></div>
        </div>
        <div v-if="!alarms.length" class="empty-state">当前产线暂无未处理告警。</div>
      </div>
    </section>

    <section class="panel block device-block">
      <div class="panel-title">设备状态</div>
      <div class="device-list">
        <button
          v-for="device in devices"
          :key="device.id"
          type="button"
          class="device-row"
          :class="{ active: selectedDeviceId === device.id }"
          @click="$emit('select-device', device.id)"
        >
          <span class="status-dot" :class="`status-${device.status}`"></span>
          <span class="device-name">{{ device.name }}</span>
          <span class="device-temp">{{ device.temperature.toFixed(1) }}℃</span>
        </button>
        <div v-if="!devices.length" class="empty-state">当前产线暂无设备数据。</div>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import type { DeviceTelemetry, FactoryAlarm, ProductionLineTelemetry } from '@/types/factory';

const props = defineProps<{
  alarms: FactoryAlarm[];
  devices: DeviceTelemetry[];
  selectedDeviceId: string | null;
  productionLines: ProductionLineTelemetry[];
  selectedLineId: string;
  selectedLine?: ProductionLineTelemetry;
  canManageLines: boolean;
  lineBusy: boolean;
}>();

const deviceCount = (lineId: string) => props.devices.filter((device) => device.lineId === lineId).length;

defineEmits<{
  (event: 'select-device', id: string): void;
  (event: 'select-line', id: string): void;
  (event: 'add-line'): void;
  (event: 'edit-line', id: string): void;
  (event: 'delete-line', id: string): void;
  (event: 'ack-alarm', id: string): void;
  (event: 'close-alarm', id: string): void;
}>();
</script>

<style scoped>
.left-panel {
  position: absolute;
  top: 92px;
  bottom: 126px;
  left: 18px;
  z-index: 3;
  display: grid;
  width: 326px;
  grid-template-rows: 310px minmax(0, .82fr) minmax(0, 1fr);
  gap: 14px;
}

.block.shop-block {
  padding-bottom: 12px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: rgba(104, 200, 255, 0.45) rgba(255, 255, 255, 0.04);
  scrollbar-width: thin;
}

.shop-block::-webkit-scrollbar { width: 5px; }
.shop-block::-webkit-scrollbar-thumb { border-radius: 5px; background: rgba(104, 200, 255, 0.42); }
.shop-block::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.04); }
.breadcrumb { margin:0 0 9px; color:#6fa8d6; font-size:11px; }
.shop-tree { display:grid; gap:3px; }
.tree-row { display:flex; align-items:center; gap:8px; padding:6px 8px; border:0; background:transparent; color:#b9d9f3; cursor:pointer; font-size:12px; text-align:left; }
.tree-row span { width:12px; color:#68c8ff; }
.tree-row em { margin-left:auto; color:#6e97b9; font-size:10px; font-style:normal; }
.tree-row.active,.tree-row.selected,.tree-row:hover { background:rgba(29,143,255,.13); color:#eef8ff; }
.flow-title { margin:14px 0 8px; color:#83add0; font-size:11px; }
.add-line-button { margin-left:auto; padding:3px 6px; border:1px solid rgba(104,200,255,.28); background:rgba(29,143,255,.08); color:#9ed2ff; cursor:pointer; font-size:10px; }
.add-line-button:disabled { cursor:not-allowed; opacity:.45; }
.add-line-button:hover { border-color:#68c8ff; background:rgba(29,143,255,.18); }
.line-overview-title { display:flex; align-items:center; justify-content:space-between; }.line-overview-title em { color:#6e97b9; font-size:10px; font-style:normal; }
.flow-track { display:flex; align-items:center; gap:4px; color:#7c9ab7; font-size:10px; }
.flow-track span { padding:5px 6px; border:1px solid rgba(111,183,255,.16); }
.flow-track .done { color:#72f5ba; border-color:rgba(77,255,181,.35); }
.flow-track .active-step { color:#ffe3a1; border-color:rgba(255,200,87,.5); }
.flow-track i { width:8px; height:1px; background:#496d8d; }
.line-list { display:grid; gap:4px; }
.line-row { display:flex; align-items:center; gap:4px; }
.line-card { display:flex; align-items:center; gap:7px; width:100%; padding:6px 7px; border:1px solid rgba(111,183,255,.12); background:rgba(255,255,255,.035); color:#cbe6ff; cursor:pointer; text-align:left; }
.line-card:hover,.line-card.active { border-color:rgba(29,143,255,.75); background:rgba(29,143,255,.12); }
.line-state { width:7px; height:7px; flex:0 0 auto; border-radius:50%; background:#39f5b6; box-shadow:0 0 10px currentColor; }
.line-warning .line-state { background:#ffc857; color:#ffc857; }.line-error .line-state { background:#ff4d6d; color:#ff4d6d; }.line-idle .line-state { background:#7f8fa3; color:#7f8fa3; }
.line-main { min-width:0; flex:1; }.line-main strong,.line-main small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.line-main strong { font-size:11px; }.line-main small { margin-top:2px; color:#7799b8; font-size:9px; }
.line-rate { color:#72f5ba; font-size:12px; font-weight:700; font-variant-numeric:tabular-nums; }
.line-actions { display:flex; gap:2px; }
.line-actions button { padding:4px; border:0; background:transparent; color:#7eaed6; cursor:pointer; font-size:9px; }
.line-actions button:hover { color:#eef8ff; }

.block {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}

.alarm-list,
.device-list {
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

.alarm-list::-webkit-scrollbar,
.device-list::-webkit-scrollbar {
  width: 5px;
}

.alarm-list::-webkit-scrollbar-thumb,
.device-list::-webkit-scrollbar-thumb {
  border-radius: 5px;
  background: rgba(104, 200, 255, 0.42);
}

.alarm-list::-webkit-scrollbar-track,
.device-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.04);
}

.alarm-item {
  flex: 0 0 auto;
  padding: 10px;
  border-left: 3px solid currentColor;
  background: rgba(255, 255, 255, 0.045);
}

.alarm-info {
  color: #68c8ff;
}

.alarm-warning {
  color: #ffc857;
}

.alarm-critical {
  color: #ff4d6d;
}

.alarm-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
}

.alarm-head em {
  color: #8aa8c4;
  font-style: normal;
  font-weight: 500;
}

.alarm-item p {
  margin: 6px 0 0;
  color: #dcecff;
  font-size: 12px;
  line-height: 1.45;
}

.alarm-actions { display:flex; gap:6px; margin-top:7px; }
.alarm-actions button { padding:3px 6px; border:1px solid currentColor; background:transparent; color:inherit; cursor:pointer; font-size:10px; }
.alarm-actions button:disabled { cursor:not-allowed; opacity:.45; }

.device-block {
  overflow: hidden;
}

.device-row {
  flex: 0 0 auto;
  display: grid;
  width: 100%;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(111, 183, 255, 0.13);
  background: rgba(9, 26, 45, 0.62);
  color: #dcecff;
  cursor: pointer;
  text-align: left;
}

.device-row.active,
.device-row:hover {
  border-color: rgba(29, 143, 255, 0.78);
  box-shadow: inset 0 0 18px rgba(29, 143, 255, 0.12);
}

.device-name {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-temp {
  color: #9ed2ff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.empty-state {
  padding: 14px 8px;
  color: #7898b6;
  font-size: 11px;
  line-height: 1.5;
}
</style>
