#!/usr/bin/env node

const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const apiUrl = (process.env.API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

try {
  const page = await fetch(frontendUrl);
  if (!page.ok) throw new Error(`前端入口 HTTP ${page.status}`);
  const html = await page.text();
  if (!html.includes('id="app"')) throw new Error('前端入口缺少 #app 挂载节点');
  if (!html.includes('<script')) throw new Error('前端入口缺少脚本引用');

  const health = await fetch(`${apiUrl}/health`);
  if (!health.ok) throw new Error(`后端健康检查 HTTP ${health.status}`);

  console.log('BROWSER SMOKE PASS');
  console.log(`PASS frontend entry: ${frontendUrl}`);
  console.log(`PASS backend health: ${apiUrl}/health`);
  console.log('NOTE: 这是无浏览器依赖的入口/API smoke；DOM 交互需使用人工浏览器矩阵或安装 Playwright 后执行。');
} catch (error) {
  if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED') {
    console.error(`BLOCKED: 前端或后端未启动，无法执行 browser smoke：${error.message}`);
    process.exit(2);
  }
  console.error(`FAIL: browser smoke 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
