#!/usr/bin/env node

const url = process.env.REALTIME_URL ?? process.env.VITE_REALTIME_URL;
if (!url) {
  console.error('BLOCKED: 未配置 REALTIME_URL，无法验收真实 WebSocket 推送。');
  console.error('用法：REALTIME_URL=ws://host:port/path node scripts/websocket-smoke.mjs');
  process.exit(2);
}

if (typeof WebSocket !== 'function') {
  console.error('BLOCKED: 当前 Node 运行时没有 WebSocket API。');
  process.exit(2);
}

const timeoutMs = Number(process.env.REALTIME_TIMEOUT_MS ?? 8000);
const socket = new WebSocket(url);
let opened = false;
let received = false;
const timeout = setTimeout(() => {
  socket.close();
  console.error(`FAIL: WebSocket 在 ${timeoutMs}ms 内未完成真实连接/推送：${url}`);
  process.exit(1);
}, timeoutMs);

socket.addEventListener('open', () => {
  opened = true;
  console.log(`PASS WebSocket connected: ${url}`);
});
socket.addEventListener('message', () => {
  received = true;
  clearTimeout(timeout);
  socket.close();
  console.log('PASS WebSocket realtime message received');
});
socket.addEventListener('error', () => {
  clearTimeout(timeout);
  console.error(`FAIL: WebSocket 真实连接失败：${url}`);
  process.exit(1);
});
socket.addEventListener('close', () => {
  if (!received && opened) {
    clearTimeout(timeout);
    console.error('FAIL: WebSocket 已连接但未收到实时消息。');
    process.exit(1);
  }
});
