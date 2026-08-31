#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../third_party/threejs-factory-demo/src/', import.meta.url));
const contracts = [
  ['views/FactoryDigitalTwin.vue', [
    '@click="refreshData"', '@click="reconnectRealtime"', '@submit.prevent="submitLine"',
    'aria-label="数据连接控制"', 'aria-label="视图范围"', 'selectedLineId', 'lineFormError', 'showLineDialog',
    "dataSource", "startRealtime()", "startApiPolling()",
  ]],
  ['components/layout/LeftPanel.vue', [
    'select-line', 'productionLines', 'line-list', 'select-device',
    'add-line', 'edit-line', 'delete-line', 'ack-alarm', 'close-alarm',
    ':disabled="!canManageLines || lineBusy"', 'overflow-y: auto;',
  ]],
  ['components/layout/OperationsPanel.vue', [
    '@submit.prevent="submit"', 'apiEnabled', 'qualityRecords', 'maintenanceOrders',
    '新建工单', '新增设备', '编辑设备', '删除设备', '设为维护', '恢复上线',
    '新建维修', '图纸登记', '质量记录', '策略评估', 'type="file"',
    'openDeviceCreate', 'openDeviceEdit', 'removeDevice', 'setDeviceStatus',
    ':disabled="!apiEnabled"', ':disabled="!apiEnabled || !selectedDevice"',
  ]],
  ['components/layout/RightPanel.vue', [
    'view-work-order', 'create-inspection', '查看工单（未接入）', '创建点检（未接入）',
  ]],
  ['components/layout/FactoryAssistant.vue', [
    'toggleCollapsed', '向厂长智能助手提问', 'Nanobot 尚未接入',
  ]],
  ['scene/FactoryScene.ts', [
    'OrbitControls', 'enableDamping',
    'minDistance', 'maxDistance', 'pointermove', 'addEventListener(\'click\'',
  ]],
];

for (const [relativePath, requiredFragments] of contracts) {
  const path = join(root, relativePath);
  const source = await readFile(path, 'utf8');
  const missing = requiredFragments.filter((fragment) => !source.includes(fragment));
  if (missing.length > 0) {
    throw new Error(`${relativePath} 缺少交互契约：${missing.join(', ')}`);
  }
  if (relativePath === 'views/FactoryDigitalTwin.vue') {
    const forbidden = ['VITE_DATA_MODE', 'fallbackLineDefinitions', 'controlSimulator', 'injectFault', 'recoverDevice'];
    const present = forbidden.filter((fragment) => source.includes(fragment));
    if (present.length > 0) {
      throw new Error(`${relativePath} 仍包含已移除的本地/故障控制：${present.join(', ')}`);
    }
  }
  console.log(`PASS frontend interaction contract: ${relativePath}`);
}

console.log('FRONTEND CONTRACT SMOKE PASS');
console.log('NOTE: 这是源码契约门禁，不冒充真实 DOM/鼠标交互；真实交互仍需浏览器运行时验收。');
