const baseUrl = (process.env.MES_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

async function check(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const health = await check('/api/v1/health');
const readiness = await check('/api/v1/health/readiness');
if (health.status !== 'ok') throw new Error('health status is not ok');
if (!['ready', 'degraded'].includes(readiness.status)) throw new Error(`unexpected readiness: ${readiness.status}`);
console.log(JSON.stringify({ baseUrl, health, readiness }));
