#!/usr/bin/env node

/**
 * Source-level regression gate for the API-first digital-twin page.
 *
 * This intentionally does not claim browser, history, or pointer-event
 * coverage. Those checks belong to frontend-browser-smoke.mjs and require a
 * real browser runtime. The gate only protects the wiring that can regress
 * without a browser: root entry, selection/polling lifecycle, simulator
 * control, realtime fallback, and permission-bound controls.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = async (relativePath) => readFile(join(root, relativePath), 'utf8');

const contracts = [
  ['third_party/threejs-factory-demo/src/main.ts', [
    "createApp(App).use(createPinia()).mount('#app')",
  ]],
  ['third_party/threejs-factory-demo/src/App.vue', [
    '<FactoryDigitalTwin />',
  ]],
  ['third_party/threejs-factory-demo/src/views/FactoryDigitalTwin.vue', [
    'onMounted(async () => {',
    'onBeforeUnmount(() => {',
    'refreshApiSnapshot',
    'startApiPolling',
    'clearApiRefreshTimer',
    'selectedLineId',
    'selectedDeviceId',
    'handleLineSelect',
    'store.selectDevice',
    'ensureLineSelection',
    'handleRealtimeMessage',
    'startRealtime',
    'canMesCapability',
    'listWorkOrders',
  ]],
  ['third_party/threejs-factory-demo/src/store/factoryStore.ts', [
    'selectedDeviceId',
    'setConnectionState',
    'applySnapshot',
    'selectDevice(id: string | null)',
  ]],
  ['third_party/threejs-factory-demo/src/components/layout/OperationsPanel.vue', [
    'controlSimulator',
    'injectFault',
    'recoverDevice',
    ':disabled="!apiEnabled || !simulatorControlEnabled || !selectedDevice',
    ':disabled="!apiEnabled || !canWrite',
    ':disabled="!apiEnabled || !canControl || !selectedDevice',
  ]],
  ['third_party/threejs-factory-demo/src/components/layout/RightPanel.vue', [
    '查看工单',
    '创建点检',
    'canViewWorkOrders',
    'canCreateInspection',
    'actionBusy',
  ]],
  ['third_party/threejs-factory-demo/src/api/mesApi.ts', [
    'VITE_TENANT_ID',
    'VITE_USER_ROLE',
    'canMesCapability',
    'fetchFactorySnapshot',
    'fetchDependencyHealth',
    'controlSimulator',
    'listWorkOrders',
  ]],
  ['third_party/threejs-factory-demo/src/websocket/WebSocketService.ts', [
    'EventSource',
    'new WebSocket',
    'scheduleReconnect',
    "setConnectionState('offline')",
  ]],
  ['third_party/threejs-factory-demo/src/api/identityMap.ts', [
    "'line-cnc'",
    "'line-assembly'",
    "'line-welding'",
    "'line-vision'",
  ]],
];

const failures = [];
let passed = 0;
for (const [relativePath, requiredFragments] of contracts) {
  const content = await source(relativePath);
  for (const fragment of requiredFragments) {
    if (!content.includes(fragment)) failures.push(`${relativePath}: ${fragment}`);
    else passed += 1;
  }
}

if (failures.length > 0) {
  console.error(`FAIL FRONTEND REGRESSION CONTRACT (${failures.length} missing)`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`PASS FRONTEND REGRESSION CONTRACT (${passed} assertions)`);
console.log('COVERED: root entry, refresh/polling lifecycle, line/device selection, fault/recovery API wiring, realtime reconnect, and role-bound buttons.');
console.log('NOTE: route history/back state, reload retention, DOM gestures, and live API fault propagation require frontend-browser-smoke.mjs with Playwright.');
