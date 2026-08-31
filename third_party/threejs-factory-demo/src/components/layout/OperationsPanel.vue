<template>
  <section class="operations panel" aria-label="生产业务操作">
    <div class="operations__head"><strong>生产业务</strong><span>仅提交正式 MES API</span></div>
    <div class="operations__actions">
      <button type="button" :disabled="!apiEnabled || !canWrite" :title="!canWrite ? writeDisabledReason : '新建工单'" @click="active = 'work-order'">新建工单</button>
      <button type="button" :disabled="!apiEnabled || !canWrite" :title="!canWrite ? writeDisabledReason : '新增设备'" @click="openDeviceCreate">新增设备</button>
      <button type="button" :disabled="!apiEnabled || !canWrite || !selectedDevice" :title="!canWrite ? writeDisabledReason : !selectedDevice ? '请先选择设备' : '编辑设备'" @click="openDeviceEdit">编辑设备</button>
      <button type="button" :disabled="!apiEnabled || !canControl || !selectedDevice" :title="!canControl ? controlDisabledReason : !selectedDevice ? '请先选择设备' : '删除设备'" @click="removeDevice">删除设备</button>
      <button type="button" :disabled="!apiEnabled || !canWrite || !selectedDevice" :title="!canWrite ? writeDisabledReason : !selectedDevice ? '请先选择设备' : '设为维护'" @click="setDeviceStatus('maintenance')">设为维护</button>
      <button type="button" :disabled="!apiEnabled || !canWrite || !selectedDevice" :title="!canWrite ? writeDisabledReason : !selectedDevice ? '请先选择设备' : '恢复上线'" @click="setDeviceStatus('online')">恢复上线</button>
      <button type="button" :disabled="!apiEnabled || !canControl" :title="!canControl ? controlDisabledReason : '新建维修'" @click="active = 'maintenance'">新建维修</button>
      <button type="button" :disabled="!apiEnabled || !canWrite" :title="!canWrite ? writeDisabledReason : '图纸登记'" @click="active = 'document'">图纸登记</button>
      <button type="button" :disabled="!apiEnabled || !canWrite" :title="!canWrite ? writeDisabledReason : '质量记录'" @click="active = 'quality'">质量记录</button>
      <button type="button" :disabled="!apiEnabled || !canControl" :title="!canControl ? controlDisabledReason : '策略评估'" @click="active = 'strategy'">策略评估</button>
      <button v-if="pendingDocumentId" type="button" :disabled="!apiEnabled || !canWrite || submitting" :title="!canWrite ? writeDisabledReason : '确认图纸分析'" @click="confirmDocument">确认图纸分析</button>
    </div>
    <div class="simulator-controls" aria-label="设备仿真控制">
      <span>设备仿真控制 · 仅通过 MES API</span>
      <select v-model="faultType" :disabled="!apiEnabled || !canControl || !selectedDevice || controlBusy !== null" aria-label="故障类型" :title="!canControl ? controlDisabledReason : !selectedDevice ? '请先选择设备' : '选择要提交的故障类型'">
        <option v-for="option in faultOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <button type="button" :disabled="!apiEnabled || !canControl || !selectedDevice || controlBusy !== null" :title="!canControl ? controlDisabledReason : !selectedDevice ? '请先选择设备' : '提交故障注入命令'" @click="injectFault">{{ controlBusy === 'fault' ? '注入中…' : '注入故障' }}</button>
      <button type="button" :disabled="!apiEnabled || !canControl || !selectedDevice || controlBusy !== null" :title="!canControl ? controlDisabledReason : !selectedDevice ? '请先选择设备' : '提交恢复设备命令'" @click="recoverDevice">{{ controlBusy === 'recover' ? '恢复中…' : '恢复设备' }}</button>
    </div>
    <small v-if="notice" :class="{ error: error }">{{ notice }}</small>
    <pre v-if="resultPreview" class="result-preview">{{ resultPreview }}</pre>
    <div v-if="recordsLoading" class="record-status">正在读取工作台数据…</div>
    <div v-else-if="recordsError" class="record-status error">工作台列表暂不可用，创建入口仍可提交</div>
    <div v-else-if="!apiEnabled" class="record-status">当前未启用 MES API，不读取或修改业务工作台</div>
    <div v-else class="record-status">文档 {{ documents.length }} · 质量 {{ qualityRecords.length }} · 维修 {{ maintenanceOrders.length }}</div>
    <div v-if="apiEnabled" class="record-list">
      <div v-for="document in documents.slice(0, 2)" :key="`d-${document.id}`" class="record-row"><span>图纸 · {{ String(document.fileName ?? document.id) }}</span><button type="button" :disabled="submitting" @click="previewDocument(document.id)">预览</button><button type="button" :disabled="!canWrite || submitting" :title="!canWrite ? writeDisabledReason : '确认图纸'" @click="confirmDocumentRecord(document.id)">确认</button></div>
      <div v-for="record in qualityRecords.slice(0, 2)" :key="`q-${record.id}`" class="record-row"><span>质量 · {{ String(record.batchNo ?? record.id) }}</span><button type="button" :disabled="!canWrite || submitting" :title="!canWrite ? writeDisabledReason : '提交质量记录'" @click="transitionQuality(record.id, 'submit')">提交</button><button type="button" :disabled="!canWrite || submitting" :title="!canWrite ? writeDisabledReason : '确认质量记录'" @click="transitionQuality(record.id, 'confirm')">确认</button><button type="button" :disabled="!canWrite || submitting" :title="!canWrite ? writeDisabledReason : '驳回质量记录'" @click="transitionQuality(record.id, 'reject')">驳回</button></div>
      <div v-for="order in maintenanceOrders.slice(0, 2)" :key="`m-${order.id}`" class="record-row"><span>维修 · {{ String(order.title ?? order.id) }}</span><button type="button" :disabled="!canControl || submitting" :title="!canControl ? controlDisabledReason : '接单维修工单'" @click="transitionMaintenance(order.id)">接单</button></div>
      <span v-if="!documents.length && !qualityRecords.length && !maintenanceOrders.length" class="hint">暂无文档、质量或维修记录</span>
    </div>
    <div v-if="active" class="operations__modal" @click.self="active = null">
      <form class="operations__form" @submit.prevent="submit">
        <div class="form-head"><strong>{{ title }}</strong><button type="button" aria-label="关闭" @click="active = null">×</button></div>
        <template v-if="active === 'work-order'">
          <label>工单号<input v-model.trim="workOrder.orderNo" required minlength="2" /></label>
          <label>产品编码<input v-model.trim="workOrder.productCode" required /></label>
          <label>产品名称<input v-model.trim="workOrder.productName" required /></label>
          <label>计划数量<input v-model.number="workOrder.plannedQty" type="number" min="1" required /></label>
          <label>交期<input v-model="workOrder.dueAt" type="datetime-local" required /></label>
        </template>
        <template v-else-if="active === 'device'">
          <label>设备编码<input v-model.trim="device.code" required minlength="2" /></label>
          <label>设备名称<input v-model.trim="device.name" required minlength="2" /></label>
          <label>型号<input v-model.trim="device.model" maxlength="80" /></label>
          <label>协议<select v-model="device.protocol"><option value="simulator">simulator</option><option value="mqtt">MQTT</option><option value="opcua">OPC UA</option><option value="modbus-tcp">Modbus TCP</option></select></label>
          <label>关联产线<input :value="selectedLine.name" disabled /></label>
        </template>
        <template v-else-if="active === 'maintenance'">
          <label>类型<select v-model="maintenance.type"><option value="repair">维修</option><option value="inspection">点检</option><option value="preventive">预防保养</option></select></label>
          <label>标题<input v-model.trim="maintenance.title" required minlength="2" /></label>
          <label>计划时间<input v-model="maintenance.plannedAt" type="datetime-local" required /></label>
          <label>说明<textarea v-model.trim="maintenance.description" maxlength="500" /></label>
          <label>设备<input :value="selectedDeviceName" disabled /></label>
        </template>
        <template v-else-if="active === 'document'">
          <label>图纸文件<input type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf" @change="selectFile" /></label>
          <p class="hint">支持 PDF、图片、DWG、DXF；上传后先保存分析草稿，再由人工确认。</p>
          <label>关联产线<input :value="selectedLine.name" disabled /></label>
        </template>
        <template v-else-if="active === 'quality'">
          <label>产品/批次<input v-model.trim="quality.batchNo" required /></label>
          <label>结果<select v-model="quality.result"><option value="pass">合格</option><option value="fail">不合格</option></select></label>
          <label>备注<textarea v-model.trim="quality.remark" maxlength="500" /></label>
          <label>设备<input :value="selectedDeviceName" disabled /></label>
        </template>
        <template v-else>
          <p class="hint">将使用当前快照提交策略仿真，结果仅供评估，不会控制设备。</p>
          <label>策略说明<textarea v-model.trim="strategy.comment" maxlength="500" required /></label>
        </template>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="form-actions"><button type="button" @click="active = null">取消</button><button type="submit" :disabled="submitting">{{ submitting ? '提交中…' : '提交 API' }}</button></div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { confirmDocumentAnalysis, confirmQualityRecord, controlSimulator, createDevice, deleteDevice, createMaintenance, createQualityRecord, createWorkOrder, documentContentUrl, updateDevice, updateDeviceStatus, listDocuments, listMaintenanceWorkOrders, listQualityRecords, rejectQualityRecord, saveDocumentAnalysisDraft, submitQualityRecord, simulateStrategy, updateDocumentStatus, updateMaintenanceStatus, uploadDocument } from '@/api/mesApi';
import { toBackendDeviceId, toBackendLineId } from '@/api/identityMap';
import type { DeviceTelemetry, ProductionLineTelemetry } from '@/types/factory';

type Operation = 'work-order' | 'device' | 'maintenance' | 'document' | 'quality' | 'strategy';
type FaultType = NonNullable<import('@/api/mesApi').SimulatorControlCommand['faultType']>;
const props = defineProps<{
  selectedLine: ProductionLineTelemetry;
  selectedDevice: DeviceTelemetry | null;
  lines: ProductionLineTelemetry[];
  devices: DeviceTelemetry[];
  apiEnabled: boolean;
  canWrite: boolean;
  canControl: boolean;
  writeDisabledReason: string;
  controlDisabledReason: string;
}>();
const emit = defineEmits<{ (event: 'data-changed'): void }>();
const active = ref<Operation | null>(null);
const submitting = ref(false);
const controlBusy = ref<'fault' | 'recover' | null>(null);
const notice = ref('');
const error = ref('');
const resultPreview = ref('');
const selectedFile = ref<File | null>(null);
const pendingDocumentId = ref<string | null>(null);
const recordsLoading = ref(true);
const recordsError = ref(false);
const documents = ref<Array<Record<string, unknown> & { id: string }>>([]);
const qualityRecords = ref<Array<Record<string, unknown> & { id: string }>>([]);
const maintenanceOrders = ref<Array<Record<string, unknown> & { id: string }>>([]);
const workOrder = ref({ orderNo: '', productCode: '', productName: '', plannedQty: 1, dueAt: '' });
const device = ref({ code: '', name: '', model: '', protocol: 'simulator' as const });
const editingDeviceId = ref<string | null>(null);
const maintenance = ref({ type: 'repair' as const, title: '', plannedAt: '', description: '' });
const quality = ref({ batchNo: '', result: 'pass', remark: '' });
const strategy = ref({ comment: '' });
const faultType = ref<FaultType>('OVERHEAT');
const faultOptions: Array<{ value: FaultType; label: string }> = [
  { value: 'OVERHEAT', label: '过热' },
  { value: 'JAM', label: '卡料/堵转' },
  { value: 'COMMUNICATION_LOSS', label: '通信中断' },
  { value: 'QUALITY_DRIFT', label: '质量漂移' },
  { value: 'EMERGENCY_STOP', label: '急停' },
  { value: 'MATERIAL_SHORTAGE', label: '物料短缺' },
  { value: 'QUALITY_ANOMALY', label: '质量异常' },
];
const title = computed(() => ({ 'work-order': '新建生产工单', device: editingDeviceId.value ? '编辑设备' : '新增设备', maintenance: '新建维修工单', document: '登记图纸', quality: '填报质量记录', strategy: '策略仿真评估' }[active.value ?? 'work-order']));
const selectedDeviceName = computed(() => props.selectedDevice?.name ?? '未选择设备');

const loadRecords = async () => {
  if (!props.apiEnabled) {
    documents.value = [];
    qualityRecords.value = [];
    maintenanceOrders.value = [];
    recordsLoading.value = false;
    recordsError.value = false;
    return;
  }
  recordsLoading.value = true;
  recordsError.value = false;
  try {
    const [documentItems, qualityItems, maintenanceItems] = await Promise.all([listDocuments(), listQualityRecords(), listMaintenanceWorkOrders()]);
    documents.value = documentItems as typeof documents.value;
    qualityRecords.value = qualityItems as typeof qualityRecords.value;
    maintenanceOrders.value = maintenanceItems as typeof maintenanceOrders.value;
  } catch {
    recordsError.value = true;
  } finally {
    recordsLoading.value = false;
  }
};

onMounted(() => { void loadRecords(); });
watch(() => props.apiEnabled, () => { void loadRecords(); });

const previewDocument = (id: string) => { window.open(documentContentUrl(id), '_blank', 'noopener,noreferrer'); };
const confirmDocumentRecord = async (id: string) => { if (!props.apiEnabled || !props.canWrite || submitting.value) return; try { submitting.value = true; await updateDocumentStatus(id, 'reviewing'); await loadRecords(); notice.value = '图纸已送审'; } catch { error.value = '图纸送审失败，请检查当前状态和权限'; } finally { submitting.value = false; } };
const transitionQuality = async (id: string, action: 'submit' | 'confirm' | 'reject') => { if (!props.apiEnabled || !props.canWrite || submitting.value) return; try { submitting.value = true; if (action === 'submit') await submitQualityRecord(id); if (action === 'confirm') await confirmQualityRecord(id); if (action === 'reject') await rejectQualityRecord(id); await loadRecords(); notice.value = `质量记录${action === 'reject' ? '已驳回' : action === 'confirm' ? '已确认' : '已提交'}`; } catch { error.value = '质量记录状态更新失败，请检查当前状态和权限'; } finally { submitting.value = false; } };
const transitionMaintenance = async (id: string) => { if (!props.apiEnabled || !props.canControl || submitting.value) return; try { submitting.value = true; await updateMaintenanceStatus(id, 'assigned'); await loadRecords(); notice.value = '维修工单已接单'; } catch { error.value = '维修工单状态更新失败，请检查当前状态和权限'; } finally { submitting.value = false; } };

const injectFault = async () => {
  if (!props.apiEnabled || !props.canControl || !props.selectedDevice) { error.value = props.controlDisabledReason || '请先选择设备'; return; }
  controlBusy.value = 'fault'; error.value = ''; notice.value = '';
  try {
    await controlSimulator({ action: 'fault', lineId: toBackendLineId(props.selectedLine.id), deviceId: toBackendDeviceId(props.selectedDevice.id), faultType: faultType.value, requestedBy: 'digital-twin-ui' });
    emit('data-changed');
    notice.value = `故障注入命令已提交：${faultOptions.find((item) => item.value === faultType.value)?.label ?? faultType.value}`;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '故障注入失败，请检查 MES API、MQTT 和权限'; }
  finally { controlBusy.value = null; }
};

const recoverDevice = async () => {
  if (!props.apiEnabled || !props.canControl || !props.selectedDevice) { error.value = props.controlDisabledReason || '请先选择设备'; return; }
  controlBusy.value = 'recover'; error.value = ''; notice.value = '';
  try {
    await controlSimulator({ action: 'recover', lineId: toBackendLineId(props.selectedLine.id), deviceId: toBackendDeviceId(props.selectedDevice.id), requestedBy: 'digital-twin-ui' });
    emit('data-changed');
    notice.value = '恢复设备命令已提交，等待实时状态回传';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '恢复设备失败，请检查 MES API、MQTT 和权限'; }
  finally { controlBusy.value = null; }
};

const openDeviceCreate = () => { if (!props.apiEnabled || !props.canWrite) { error.value = props.writeDisabledReason; return; } editingDeviceId.value = null; device.value = { code: '', name: '', model: '', protocol: 'simulator' }; active.value = 'device'; };
const openDeviceEdit = () => { if (!props.selectedDevice) return; if (!props.canWrite) { error.value = props.writeDisabledReason; return; } editingDeviceId.value = props.selectedDevice.id; device.value = { code: props.selectedDevice.code ?? props.selectedDevice.id, name: props.selectedDevice.name, model: '', protocol: 'simulator' }; active.value = 'device'; };
const setDeviceStatus = async (status: 'online' | 'maintenance') => { if (!props.selectedDevice || !props.canWrite) { error.value = props.writeDisabledReason; return; } try { await updateDeviceStatus(toBackendDeviceId(props.selectedDevice.id), status, status === 'maintenance' ? '前端工作台手动维护标记' : '前端工作台手动恢复上线'); emit('data-changed'); notice.value = status === 'maintenance' ? '设备已标记为维护' : '设备已恢复上线'; } catch { error.value = '设备状态更新失败，请检查后端服务'; } };

const removeDevice = async () => { if (!props.selectedDevice || !props.canControl) { error.value = props.controlDisabledReason; return; } if (!window.confirm(`确认删除设备“${props.selectedDevice.name}”？`)) return; try { await deleteDevice(toBackendDeviceId(props.selectedDevice.id)); await loadRecords(); emit('data-changed'); notice.value = '设备已删除'; } catch { error.value = '设备删除失败，请检查权限或接口状态'; } };

const selectFile = (event: Event) => { selectedFile.value = (event.target as HTMLInputElement).files?.[0] ?? null; };
const submit = async () => {
  if (!active.value || !props.apiEnabled) return;
  const requiredCapability = active.value === 'maintenance' || active.value === 'strategy' ? 'control' : 'write';
  if ((requiredCapability === 'write' && !props.canWrite) || (requiredCapability === 'control' && !props.canControl)) {
    error.value = requiredCapability === 'write' ? props.writeDisabledReason : props.controlDisabledReason;
    return;
  }
  submitting.value = true; notice.value = ''; error.value = '';
  try {
    if (active.value === 'work-order') {
      await createWorkOrder({ ...workOrder.value, lineId: toBackendLineId(props.selectedLine.id), dueAt: new Date(workOrder.value.dueAt).toISOString() });
    } else if (active.value === 'device') {
      if (editingDeviceId.value) await updateDevice(toBackendDeviceId(editingDeviceId.value), { ...device.value, lineId: toBackendLineId(props.selectedLine.id) });
      else await createDevice({ ...device.value, lineId: toBackendLineId(props.selectedLine.id) });
    } else if (active.value === 'maintenance') {
      if (!props.selectedDevice) throw new Error('请先选择设备');
      await createMaintenance({ ...maintenance.value, lineId: toBackendLineId(props.selectedLine.id), deviceId: props.selectedDevice.id, plannedAt: new Date(maintenance.value.plannedAt).toISOString() });
    } else if (active.value === 'document') {
      if (!selectedFile.value) throw new Error('请选择图纸文件');
      const document = await uploadDocument(selectedFile.value, { documentKey: `${props.selectedLine.id}-${selectedFile.value.name}`, uploadedBy: 'digital-twin-ui', lineId: toBackendLineId(props.selectedLine.id) });
      const documentId = typeof document.id === 'string' ? document.id : undefined;
      if (documentId) {
        await saveDocumentAnalysisDraft(documentId, { fileName: selectedFile.value.name, analysisStatus: 'draft' }, 'digital-twin-ui');
        pendingDocumentId.value = documentId;
      }
    } else if (active.value === 'quality') {
      await createQualityRecord({ batchNo: quality.value.batchNo, lineId: toBackendLineId(props.selectedLine.id), deviceId: props.selectedDevice?.id, operatorId: 'digital-twin-ui', values: { result: quality.value.result, remark: quality.value.remark } });
    } else {
      const result = await simulateStrategy({
        timestamp: new Date().toISOString(),
        lines: props.lines.map((line) => ({ id: line.id, name: line.name, capacityPerHour: Math.max(1, line.plannedQuantity), active: line.status !== 'error' })),
        devices: props.devices.map((device) => ({ id: device.id, lineId: device.lineId, status: device.status === 'running' ? 'online' : device.status === 'offline' ? 'offline' : device.status === 'error' ? 'alarm' : 'maintenance', capacityPerHour: 1 })),
        workOrders: [],
        materialShortages: [],
      });
      resultPreview.value = JSON.stringify(result, null, 2);
    }
    await loadRecords();
    emit('data-changed');
    notice.value = active.value === 'strategy' ? '策略仿真完成，结果仅供评估' : '提交成功，后端已受理'; active.value = null;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '提交失败，请检查后端服务';
  } finally { submitting.value = false; }
};

const confirmDocument = async () => {
  if (!pendingDocumentId.value || !props.apiEnabled || !props.canWrite) { error.value = props.writeDisabledReason; return; }
  submitting.value = true; error.value = ''; notice.value = '';
  try {
    await confirmDocumentAnalysis(pendingDocumentId.value, 'digital-twin-ui', { analysisStatus: 'confirmed' });
    pendingDocumentId.value = null;
    await loadRecords();
    emit('data-changed');
    notice.value = '图纸分析已确认';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '图纸确认失败'; }
  finally { submitting.value = false; }
};
</script>

<style scoped>
.operations { position:absolute; right:382px; top:92px; z-index:8; width:310px; padding:10px; }
.operations__head,.form-head,.form-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.operations__head strong { color:#eef8ff; font-size:12px; }.operations__head span,.operations small,.hint { color:#7898b6; font-size:10px; }
.record-status { margin-top:7px; color:#7898b6; font-size:10px; }.document-list { display:flex; gap:5px; margin-top:5px; }.document-list button { font-size:9px; }
.record-list { display:grid; gap:5px; max-height:96px; margin-top:5px; overflow:auto; }.record-row { display:flex; align-items:center; gap:4px; color:#9ec5e5; font-size:9px; }.record-row span { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.record-row button { padding:3px 5px; font-size:9px; }
.operations__actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }.operations button { padding:5px 8px; border:1px solid rgba(104,200,255,.3); background:rgba(29,143,255,.1); color:#cbe6ff; cursor:pointer; font-size:10px; }.operations button:hover { border-color:#68c8ff; }.operations small { display:block; margin-top:7px; }.operations small.error,.error { color:#ff8094; }.result-preview { max-height:110px; margin:8px 0 0; overflow:auto; color:#9ed2ff; font-size:9px; white-space:pre-wrap; }
.simulator-controls { display:grid; grid-template-columns:1fr auto auto; gap:6px; align-items:center; margin-top:8px; padding-top:8px; border-top:1px solid rgba(111,183,255,.14); }.simulator-controls span { grid-column:1 / -1; color:#7898b6; font-size:10px; }.simulator-controls select { min-width:0; padding:5px 6px; border:1px solid rgba(111,183,255,.25); background:#07111f; color:#dcecff; font-size:10px; }.simulator-controls button { white-space:nowrap; }
.operations__modal { position:fixed; inset:0; z-index:30; display:grid; place-items:center; background:rgba(2,8,16,.72); }.operations__form { display:grid; width:min(380px,calc(100vw - 32px)); gap:10px; padding:16px; border:1px solid rgba(104,200,255,.3); background:#0b1b2d; }.form-head strong { color:#eef8ff; }.form-head button { border:0; background:transparent; font-size:20px; }.operations label { display:grid; gap:4px; color:#9ec5e5; font-size:11px; }.operations input,.operations select,.operations textarea { padding:7px; border:1px solid rgba(111,183,255,.25); background:#07111f; color:#dcecff; }.operations textarea { min-height:60px; resize:vertical; }.form-actions { justify-content:flex-end; margin-top:4px; }.form-actions button:last-child { background:#1d8fff; color:#fff; }.operations button:disabled { cursor:wait; opacity:.5; }
</style>
