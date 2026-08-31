#!/usr/bin/env node

import mqtt from 'mqtt';

const api = normalizeApiUrl(process.env.API_URL ?? process.env.MES_BASE_URL ?? 'http://localhost:3000/api/v1');
const apiKey = process.env.MES_API_KEY?.trim();
const mqttUrl = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const tenant = process.env.MES_TENANT_ID ?? 'tenant-demo';
const timeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 8000);
const lines = ['line-cnc', 'line-assembly', 'line-welding', 'line-vision'];
const deviceIds = lines.map((line) => `e2e-${line}`);
const checks = [];
let client;

try {
  const initial = await get('/dashboard/overview');
  if (initial.data.lines.total !== 4) throw new Error(`初始快照产线数量不是 4: ${initial.data.lines.total}`);
  checks.push(`PASS 初始快照：${initial.data.lines.total} 条产线`);

  client = await connect();
  for (let index = 0; index < lines.length; index += 1) {
    await publishTelemetry(lines[index], deviceIds[index], 'RUNNING', 40 + index, []);
  }
  for (let index = 0; index < lines.length; index += 1) {
    const body = await pollLine(lines[index], (line) => line.data.devices.some((device) => device.id === deviceIds[index] && device.status === 'online'));
    if (!body.data.devices.some((device) => device.id === deviceIds[index])) throw new Error(`产线 ${lines[index]} 未发现 telemetry 设备`);
  }
  checks.push('PASS 四产线 telemetry 更新和切换：' + lines.join(', '));

  const faultLine = lines[2];
  const faultDevice = deviceIds[2];
  const alarmId = `e2e-alarm-${Date.now()}`;
  const faultAt = new Date().toISOString();
  await publishTelemetry(faultLine, faultDevice, 'FAULT', 96, ['OVERHEAT']);
  await publish(`mes/simulator/${tenant}/alarms`, {
    event: 'alarm.created',
    data: { id: alarmId, lineId: faultLine, deviceId: faultDevice, type: 'OVERHEAT', severity: 'CRITICAL', message: '数字孪生端到端故障演练', startedAt: faultAt },
  });
  const faultView = await pollLine(faultLine, (line) => line.data.devices.some((device) => device.id === faultDevice && device.status === 'alarm'));
  if (!faultView.data.alarms.some((alarm) => alarm.id === `mqtt-alarm-${tenant}-${alarmId}`)) throw new Error('alarm.created 未出现在产线详情');
  checks.push('PASS 故障高亮和 alarm.created：设备 alarm、告警 active');

  const clearedAt = new Date(Date.now() + 1).toISOString();
  await publish(`mes/simulator/${tenant}/alarms`, {
    event: 'alarm.cleared',
    data: { id: alarmId, lineId: faultLine, deviceId: faultDevice, type: 'OVERHEAT', severity: 'CRITICAL', message: '数字孪生端到端故障演练已恢复', startedAt: faultAt, clearedAt },
  });
  await publishTelemetry(faultLine, faultDevice, 'RUNNING', 41, []);
  const recovered = await pollLine(faultLine, (line) => line.data.devices.some((device) => device.id === faultDevice && device.status === 'online') && !line.data.alarms.some((alarm) => alarm.id === `mqtt-alarm-${tenant}-${alarmId}`));
  if (!recovered.data.devices.some((device) => device.id === faultDevice && device.status === 'online')) throw new Error('alarm.cleared 后设备未恢复 online');
  checks.push('PASS alarm.cleared 和设备恢复：告警消失、设备 online');

  await close(client);
  client = await connect();
  await publishTelemetry(faultLine, faultDevice, 'RUNNING', 77, []);
  const afterReconnect = await pollLine(faultLine, (line) => line.data.devices.some((device) => device.id === faultDevice && device.metrics.temperature === 77));
  if (!afterReconnect.data.devices.some((device) => device.id === faultDevice && device.metrics.temperature === 77)) throw new Error('重连后 telemetry 未更新');
  checks.push('PASS MQTT 客户端断开/重连后继续接收 telemetry');

  console.log('\nDIGITAL TWIN E2E PASS');
  checks.forEach((check) => console.log(check));
} catch (error) {
  console.error('\nDIGITAL TWIN E2E FAIL');
  checks.forEach((check) => console.error(check));
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  console.error('诊断：确认后端 MQTT_ENABLED=true、Mosquitto 1883、API_URL 和 x-tenant-id 配置正确。');
  process.exitCode = 1;
} finally {
  if (client) await close(client);
}

async function get(path) {
  const headers = { 'x-tenant-id': tenant };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

function normalizeApiUrl(url) {
  const normalized = url.replace(/\/$/, '');
  return normalized.endsWith('/api/v1') ? normalized : `${normalized}/api/v1`;
}

async function pollLine(lineId, predicate) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await get(`/dashboard/lines/${lineId}`);
    if (predicate(last)) return last;
    await wait(150);
  }
  throw new Error(`产线 ${lineId} 状态等待超时，最后响应=${JSON.stringify(last)}`);
}

async function publishTelemetry(lineId, deviceId, status, temperatureCelsius, activeFaults) {
  await publish(`mes/simulator/${tenant}/lines/${lineId}/devices/${deviceId}/telemetry`, {
    event: 'device.telemetry',
    data: { deviceId, deviceName: `E2E ${deviceId}`, lineId, status, temperatureCelsius, cycleTimeSeconds: 42, totalCount: 10, goodCount: 10, defectCount: 0, activeFaults, timestamp: new Date().toISOString() },
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const next = mqtt.connect(mqttUrl, { clientId: `mes-e2e-${process.pid}-${Date.now()}`, reconnectPeriod: 0, connectTimeout: timeout });
    next.once('connect', () => resolve(next));
    next.once('error', (error) => { next.end(true); reject(new Error(`MQTT 连接失败: ${error.message}`)); });
  });
}

function publish(topic, payload) {
  return new Promise((resolve, reject) => client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => error ? reject(error) : resolve()));
}

function close(connection) { return new Promise((resolve) => connection.end(false, {}, resolve)); }
function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
