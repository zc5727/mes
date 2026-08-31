#!/usr/bin/env node

const url = (process.env.SIMULATOR_UI_URL ?? 'http://127.0.0.1:5174').replace(/\/$/, '');
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes('<script') && !html.includes('id="app"')) {
    throw new Error('入口缺少前端挂载节点或脚本');
  }
  console.log(`SIMULATOR UI SMOKE PASS: ${url}`);
} catch (error) {
  if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED') {
    console.error(`BLOCKED: simulator-ui 未在 ${url} 监听，无法验收 5174 控制台。`);
    process.exit(2);
  }
  console.error(`FAIL: simulator-ui smoke 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
