#!/usr/bin/env node

import mqtt from 'mqtt';

const options = parseArgs(process.argv.slice(2));
const apiBase = options.api.replace(/\/$/, '');
const tenantId = options.tenant;
const lineId = options.line;
const deviceId = options.device;
const alarmId = `smoke-${Date.now()}`;
const now = new Date().toISOString();

const checks = [];
let client;

try {
  await assertHttp(`${apiBase}/health`, '后端健康检查');
  client = await connectMqtt(options.mqtt);

  const telemetryTopic = `mes/simulator/${tenantId}/lines/${lineId}/devices/${deviceId}/telemetry`;
  const alarmsTopic = `mes/simulator/${tenantId}/alarms`;

  await publish(telemetryTopic, {
    event: 'device.telemetry',
    data: {
      deviceId,
      deviceName: `Smoke ${deviceId}`,
      lineId,
      status: 'FAULT',
      temperatureCelsius: 96,
      cycleTimeSeconds: 42,
      totalCount: 10,
      goodCount: 8,
      defectCount: 2,
      activeFaults: ['OVERHEAT'],
      timestamp: now,
    },
  });
  checks.push(`PASS MQTT telemetry published: ${telemetryTopic}`);

  await publish(alarmsTopic, {
    event: 'alarm.created',
    data: {
      id: alarmId,
      lineId,
      deviceId,
      type: 'OVERHEAT',
      severity: 'CRITICAL',
      message: 'MQTT smoke test overheat',
      startedAt: now,
    },
  });
  checks.push(`PASS MQTT alarm published: ${alarmsTopic}`);

  const dashboard = await pollJson(
    `${apiBase}/dashboard/overview`,
    (body) => body?.data?.devices?.alarm > 0 && body?.data?.alarms?.critical > 0,
    'Dashboard 已反映故障设备和严重告警',
  );
  checks.push(`PASS dashboard cache/alarm: alarmDevices=${dashboard.data.devices.alarm}, criticalAlarms=${dashboard.data.alarms.critical}`);

  const line = await pollJson(
    `${apiBase}/dashboard/lines/${encodeURIComponent(lineId)}`,
    (body) => body?.data?.devices?.some((device) => device.id === deviceId && device.status === 'alarm'),
    '产线详情已反映设备 FAULT',
  );
  checks.push(`PASS line detail: ${line.data.devices.find((device) => device.id === deviceId)?.status ?? 'missing'}`);

  const alarms = await pollJson(
    `${apiBase}/alarms`,
    (body) => body?.data?.some((alarm) => alarm.id === `mqtt-alarm-${tenantId}-${alarmId}` && alarm.status === 'active'),
    'Alarm API 已返回 MQTT 告警',
  );
  checks.push(`PASS alarm API: ${alarms.data.find((alarm) => alarm.id === `mqtt-alarm-${tenantId}-${alarmId}`)?.id ?? 'missing'}`);

  console.log('\nMQTT SMOKE PASS');
  for (const check of checks) console.log(check);
  console.log(`tenant=${tenantId} line=${lineId} device=${deviceId} alarm=${alarmId}`);
} catch (error) {
  console.error('\nMQTT SMOKE FAIL');
  for (const check of checks) console.error(check);
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  console.error('诊断: 确认 Mosquitto 监听 MQTT_URL、后端已用 MQTT_ENABLED=true 启动，并检查 docker compose logs mqtt。');
  process.exitCode = 1;
} finally {
  if (client) await end(client);
}

function parseArgs(args) {
  const values = {
    mqtt: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    api: process.env.API_URL ?? 'http://localhost:3000/api/v1',
    tenant: process.env.MES_TENANT_ID ?? 'tenant-demo',
    line: process.env.MES_LINE_ID ?? 'line-cnc',
    device: process.env.MES_DEVICE_ID ?? 'device-1',
    timeout: Number(process.env.SMOKE_TIMEOUT_MS ?? 8000),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [key, inlineValue] = arg.split('=', 2);
    const keyMap = { '--mqtt': 'mqtt', '--api': 'api', '--tenant': 'tenant', '--line': 'line', '--device': 'device', '--timeout-ms': 'timeout' };
    if (!keyMap[key]) throw new Error(`未知参数: ${arg}`);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`参数缺少值: ${key}`);
    values[keyMap[key]] = key === '--timeout-ms' ? Number(value) : value;
  }

  if (!Number.isFinite(values.timeout) || values.timeout < 1000) throw new Error('--timeout-ms 必须是不小于 1000 的数字');
  return values;
}

async function assertHttp(url, label) {
  const response = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
  if (!response.ok) throw new Error(`${label}失败: HTTP ${response.status} ${await response.text()}`);
  checks.push(`PASS ${label}: HTTP ${response.status}`);
}

async function pollJson(url, predicate, label) {
  const deadline = Date.now() + options.timeout;
  let lastBody;
  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
    if (!response.ok) throw new Error(`${label}失败: HTTP ${response.status} ${await response.text()}`);
    lastBody = await response.json();
    if (predicate(lastBody)) return lastBody;
    await sleep(150);
  }
  throw new Error(`${label}超时 ${options.timeout}ms，最后响应: ${JSON.stringify(lastBody)}`);
}

function connectMqtt(url) {
  return new Promise((resolve, reject) => {
    const mqttClient = mqtt.connect(url, { clientId: `mes-smoke-${process.pid}-${Date.now()}`, reconnectPeriod: 0, connectTimeout: options.timeout });
    const onError = (error) => { mqttClient.end(true); reject(new Error(`MQTT 连接失败 ${url}: ${error.message}`)); };
    mqttClient.once('connect', () => resolve(mqttClient));
    mqttClient.once('error', onError);
  });
}

function publish(topic, payload) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => error ? reject(error) : resolve());
  });
}

function end(mqttClient) {
  return new Promise((resolve) => mqttClient.end(false, {}, resolve));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
