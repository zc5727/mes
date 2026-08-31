#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../third_party/threejs-factory-demo/src/', import.meta.url));
const contracts = [
  ['views/FactoryDigitalTwin.vue', [
    '@select-line="handleLineSelect"', '@click="injectFault"', '@click="recoverDevice"',
    '@click="refreshData"', '@click="reconnectRealtime"', '@submit.prevent="submitLine"',
    'aria-label="控制模式"', 'selectedLineId', 'lineFormError', 'showLineDialog',
  ]],
  ['components/layout/LeftPanel.vue', ['select-line', 'productionLines', 'line-list']],
  ['components/layout/OperationsPanel.vue', [
    '@submit.prevent="submit"', 'apiEnabled', 'qualityRecords', 'maintenanceOrders',
    '新建工单', '新增设备', '图纸登记', '质量记录', '策略评估', 'type="file"',
  ]],
  ['scene/FactoryScene.ts', ['OrbitControls', 'pointermove', 'click', 'enableRotate', 'enableZoom']],
];

for (const [relativePath, requiredFragments] of contracts) {
  const path = join(root, relativePath);
  const source = await readFile(path, 'utf8');
  const missing = requiredFragments.filter((fragment) => !source.includes(fragment));
  if (missing.length > 0) {
    throw new Error(`${relativePath} 缺少交互契约：${missing.join(', ')}`);
  }
  console.log(`PASS frontend interaction contract: ${relativePath}`);
}

console.log('FRONTEND CONTRACT SMOKE PASS');
console.log('NOTE: 这是源码契约门禁，不冒充真实 DOM/鼠标交互；真实交互仍需浏览器运行时验收。');
