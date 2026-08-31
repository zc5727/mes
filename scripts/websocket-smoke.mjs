#!/usr/bin/env node

const protocol = (process.env.REALTIME_PROTOCOL ?? 'websocket').trim().toLowerCase();
const url = process.env.REALTIME_URL ?? process.env.VITE_REALTIME_URL
  ?? (protocol === 'sse' ? 'http://127.0.0.1:3000/api/v1/digital-twin/stream' : undefined);
const timeoutMs = Number(process.env.REALTIME_TIMEOUT_MS ?? 8000);

if (!url) {
  console.error(`BLOCKED: 未配置 REALTIME_URL，无法验收真实 ${protocol.toUpperCase()} 推送。`);
  console.error('SSE 用法：REALTIME_PROTOCOL=sse REALTIME_URL=http://host:port/api/v1/digital-twin/stream node scripts/websocket-smoke.mjs');
  console.error('WebSocket 用法：REALTIME_PROTOCOL=websocket REALTIME_URL=ws://host:port/path node scripts/websocket-smoke.mjs');
  process.exit(2);
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
  console.error('FAIL: REALTIME_TIMEOUT_MS 必须是不小于 1000 的数字。');
  process.exit(1);
}
if (protocol === 'sse') await smokeSse();
else if (protocol === 'websocket') smokeWebSocket();
else {
  console.error(`BLOCKED: 不支持的 REALTIME_PROTOCOL：${protocol}。仅支持 sse 或 websocket。`);
  process.exit(2);
}

async function smokeSse() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'text/event-stream' };
    const apiKey = process.env.REALTIME_API_KEY ?? process.env.MES_API_KEY;
    const tenantId = process.env.REALTIME_TENANT_ID ?? process.env.MES_TENANT_ID ?? 'tenant-demo';
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (tenantId) headers['x-tenant-id'] = tenantId;
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error(`Content-Type 不是 text/event-stream：${response.headers.get('content-type') ?? 'missing'}`);
    }
    if (!response.body) throw new Error('SSE 响应没有可读 body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error('SSE 连接关闭且未收到实时事件');
      buffer += decoder.decode(value, { stream: true });
      if (/^data:\s*.+$/m.test(buffer)) {
        console.log(`PASS SSE connected and realtime event received: ${url}`);
        await reader.cancel();
        return;
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') console.error(`FAIL: SSE 在 ${timeoutMs}ms 内未收到真实事件：${url}`);
    else console.error(`FAIL: SSE 真实连接失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}

function smokeWebSocket() {
  if (typeof WebSocket !== 'function') {
    console.error('BLOCKED: 当前 Node 运行时没有 WebSocket API。');
    process.exit(2);
  }
  const socket = new WebSocket(url);
  let opened = false;
  let received = false;
  const timeout = setTimeout(() => {
    socket.close();
    console.error(`FAIL: WebSocket 在 ${timeoutMs}ms 内未完成真实连接/推送：${url}`);
    process.exitCode = 1;
  }, timeoutMs);
  socket.addEventListener('open', () => { opened = true; console.log(`PASS WebSocket connected: ${url}`); });
  socket.addEventListener('message', () => {
    received = true;
    clearTimeout(timeout);
    socket.close();
    console.log('PASS WebSocket realtime message received');
  });
  socket.addEventListener('error', () => {
    clearTimeout(timeout);
    console.error(`FAIL: WebSocket 真实连接失败：${url}`);
    process.exitCode = 1;
  });
  socket.addEventListener('close', () => {
    if (!received && opened) {
      clearTimeout(timeout);
      console.error('FAIL: WebSocket 已连接但未收到实时消息。');
      process.exitCode = 1;
    }
  });
}
