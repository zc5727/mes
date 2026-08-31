#!/usr/bin/env node

import mqtt from 'mqtt';

const config = {
  mqtt: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  api: normalizeApiUrl(process.env.API_URL ?? process.env.MES_BASE_URL ?? 'http://localhost:3000/api/v1'),
  apiKey: process.env.MES_API_KEY?.trim(),
  tenant: process.env.MES_TENANT_ID ?? 'tenant-demo',
  line: process.env.MES_LINE_ID ?? 'line-cnc',
  device: process.env.MES_DEVICE_ID ?? 'device-cnc-01',
  timeout: Number(process.env.SMOKE_TIMEOUT_MS ?? 8000),
};
const alarmId = `drill-${Date.now()}`;
const topic = `mes/simulator/${config.tenant}/lines/${config.line}/devices/${config.device}/telemetry`;
const alarmsTopic = `mes/simulator/${config.tenant}/alarms`;
const checks = [];
let client;

try {
  await expectHttp('/health', (body) => body?.status === 'ok', '后端已启动');
  client = await connect();

  const faultAt = new Date().toISOString();
  await publish(topic, telemetry('FAULT', faultAt, ['OVERHEAT']));
  await publish(alarmsTopic, {
    event: 'alarm.created',
    data: { id: alarmId, lineId: config.line, deviceId: config.device, type: 'OVERHEAT', severity: 'CRITICAL', message: '故障演练：过热', startedAt: faultAt },
  });
  checks.push('PASS 注入设备故障和 alarm.created');

  const faultView = await poll('/dashboard/lines/' + encodeURIComponent(config.line), (body) => {
    const device = body?.data?.devices?.find((item) => item.id === config.device);
    return device?.status === 'alarm' && body?.data?.alarms?.some((alarm) => alarm.id === `mqtt-alarm-${config.tenant}-${alarmId}`);
  }, '故障已传播到产线详情和告警');
  checks.push(`PASS 故障联动：${faultView.data.devices.find((item) => item.id === config.device).status}`);

  const strategy = await request('/strategies/simulate', {
    method: 'POST',
    body: {
      timestamp: faultAt,
      lines: [
        { id: config.line, name: 'CNC加工线', capacityPerHour: 100, active: true },
        { id: 'line-assembly', name: '精密装配线', capacityPerHour: 80, active: true },
      ],
      devices: [
        { id: config.device, lineId: config.line, status: 'alarm', capacityPerHour: 100 },
        { id: 'assembly-device-1', lineId: 'line-assembly', status: 'online', capacityPerHour: 80 },
      ],
      workOrders: [{ id: 'drill-order-1', lineId: config.line, remainingQty: 300, dueAt: new Date(Date.parse(faultAt) + 3600000).toISOString(), priority: 9, status: 'running' }],
    },
  });
  if (!strategy.data?.recommended || strategy.data.recommended.requiresApproval !== true) throw new Error('策略接口未返回需审批的推荐方案');
  checks.push(`PASS 策略建议：${strategy.data.recommended.action}（仅仿真，requiresApproval=true）`);

  const recoveredAt = new Date(Date.now() + 1000).toISOString();
  await publish(alarmsTopic, {
    event: 'alarm.cleared',
    data: { id: alarmId, lineId: config.line, deviceId: config.device, type: 'OVERHEAT', severity: 'CRITICAL', message: '故障演练：过热已恢复', startedAt: faultAt, clearedAt: recoveredAt },
  });
  await publish(topic, telemetry('RUNNING', recoveredAt, []));
  checks.push('PASS 发布 alarm.cleared 和 RUNNING telemetry');

  const recovered = await poll('/dashboard/lines/' + encodeURIComponent(config.line), (body) => {
    const device = body?.data?.devices?.find((item) => item.id === config.device);
    return device?.status === 'online' && !body?.data?.alarms?.some((alarm) => alarm.id === `mqtt-alarm-${config.tenant}-${alarmId}`);
  }, '设备和告警已恢复');
  checks.push(`PASS 恢复联动：${recovered.data.devices.find((item) => item.id === config.device).status}`);

  console.log('\nMQTT FAULT DRILL PASS');
  checks.forEach((check) => console.log(check));
} catch (error) {
  console.error('\nMQTT FAULT DRILL FAIL');
  checks.forEach((check) => console.error(check));
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  console.error('诊断：确认 MQTT_ENABLED=true、MQTT_URL 可连接、后端已启动，并检查 docker compose logs mqtt。');
  process.exitCode = 1;
} finally {
  if (client) await close(client);
}

function telemetry(status, timestamp, activeFaults) {
  return { event: 'device.telemetry', data: { deviceId: config.device, deviceName: '故障演练设备', lineId: config.line, status, temperatureCelsius: status === 'FAULT' ? 96 : 40, cycleTimeSeconds: 42, totalCount: 10, goodCount: 10, defectCount: 0, activeFaults, timestamp } };
}

async function expectHttp(path, predicate, label) {
  const body = await request(path);
  if (!predicate(body)) throw new Error(`${label}返回内容不符合预期`);
  checks.push(`PASS ${label}`);
}

async function poll(path, predicate, label) {
  const deadline = Date.now() + config.timeout;
  let last;
  while (Date.now() < deadline) {
    last = await request(path);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label}超时，最后响应=${JSON.stringify(last)}`);
}

async function request(path, init = {}) {
  const response = await fetch(`${config.api}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': config.tenant,
      'x-user-id': 'fault-drill-runner',
      'x-role': 'plant_manager',
      'x-factory-id': 'factory-demo',
      'x-scope': '*',
      'x-session-id': `fault-drill-${process.pid}`,
      'x-trace-id': `fault-drill-trace-${Date.now()}`,
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

function normalizeApiUrl(url) {
  const normalized = url.replace(/\/$/, '');
  return normalized.endsWith('/api/v1') ? normalized : `${normalized}/api/v1`;
}

function connect() {
  return new Promise((resolve, reject) => {
    const connection = mqtt.connect(config.mqtt, { clientId: `mes-drill-${process.pid}-${Date.now()}`, reconnectPeriod: 0, connectTimeout: config.timeout });
    connection.once('connect', () => resolve(connection));
    connection.once('error', (error) => { connection.end(true); reject(new Error(`MQTT 连接失败：${error.message}`)); });
  });
}

function publish(name, payload) {
  return new Promise((resolve, reject) => client.publish(name, JSON.stringify(payload), { qos: 1 }, (error) => error ? reject(error) : resolve()));
}

function close(connection) { return new Promise((resolve) => connection.end(false, {}, resolve)); }
