import './style.css';

type Device = { id: string; lineId: string; code: string; name: string; model?: string; protocol?: string; status?: string };
type Line = { id: string; code: string; name: string; type?: string };

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const tenantId = import.meta.env.VITE_TENANT_ID ?? 'tenant-demo';
const app = document.querySelector<HTMLDivElement>('#app')!;
let devices: Device[] = [];
let lines: Line[] = [];
let selectedDevice = '';
let notice = '';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const body = await response.json() as { data: T };
  return body.data;
}

function render(): void {
  app.innerHTML = `
    <main class="shell">
      <header><div><span class="eyebrow">MES / SIMULATION CONTROL</span><h1>仿真控制台</h1><p>协议、设备、场景和故障的唯一管理入口</p></div><div class="status"><i></i><span>${notice || '就绪'}</span><button id="refresh">刷新</button></div></header>
      <section class="toolbar"><button id="startAll">启动全部</button><button id="stopAll" class="muted">停止全部</button><button id="snapshot" class="muted">导出快照</button><label>平台地址<input value="${apiBase}" disabled /></label></section>
      <section class="grid">
        <aside class="panel"><div class="panel-title"><b>设备列表</b><span>${devices.length} 台</span></div><div class="device-list">${devices.map((d) => `<button class="device ${d.id === selectedDevice ? 'active' : ''}" data-device="${d.id}"><strong>${d.name}</strong><small>${d.code} · ${d.protocol ?? 'simulator'} · ${d.status ?? 'unknown'}</small></button>`).join('') || '<p class="empty">暂无设备</p>'}</div><button id="newDevice" class="outline">＋ 新增模拟设备</button></aside>
        <section class="panel detail">${detailMarkup()}</section>
      </section>
      <section class="panel log"><div class="panel-title"><b>验收说明</b></div><p>控制台操作通过 MES API/MQTT 执行；孪生页面只消费接入后的状态。厂商 Profile 未经真实资料校验时不会标记为真实兼容。</p><div id="log"></div></section>
    </main>`;
  bind();
}

function detailMarkup(): string {
  const device = devices.find((item) => item.id === selectedDevice);
  if (!device) return '<div class="empty detail-empty">选择一个设备开始控制</div>';
  return `<div class="panel-title"><div><b>${device.name}</b><span class="tag">${device.status ?? 'unknown'}</span></div><span>${device.id}</span></div>
    <div class="facts"><div><small>产线</small><b>${device.lineId}</b></div><div><small>机械类型</small><b>${device.model ?? '通用机床'}</b></div><div><small>协议</small><b>${device.protocol ?? 'simulator'}</b></div></div>
    <h3>状态机命令</h3><div class="actions"><button data-action="start">Start</button><button data-action="stop" class="muted">Stop</button><button data-action="pause" class="muted">Pause</button><button data-action="resume" class="muted">Resume</button><button data-action="reset" class="muted">Reset</button></div>
    <h3>设备故障</h3><div class="faults"><button data-fault="SPINDLE_OVERLOAD">主轴过载</button><button data-fault="SPINDLE_OVERHEAT">主轴过热</button><button data-fault="COMMUNICATION_LOSS">通信中断</button><button data-fault="TOOL_BROKEN">刀具损坏</button></div>`;
}

function log(message: string): void { const target = document.querySelector<HTMLDivElement>('#log'); if (target) target.textContent = `${new Date().toLocaleTimeString()}  ${message}`; notice = message; const status = document.querySelector<HTMLSpanElement>('.status span'); if (status) status.textContent = message; }

async function load(): Promise<void> {
  try { [lines, devices] = await Promise.all([api<Line[]>('/production-lines'), api<Device[]>('/devices')]); selectedDevice ||= devices[0]?.id ?? ''; render(); }
  catch (error) { app.innerHTML = `<main class="shell"><div class="error"><h1>仿真控制台无法连接 MES</h1><p>${String(error)}</p><button id="retry">重试</button></div></main>`; document.querySelector('#retry')?.addEventListener('click', load); }
}

async function control(action: string, faultType?: string): Promise<void> {
  if (!selectedDevice) return;
  const device = devices.find((item) => item.id === selectedDevice); if (!device) return;
  try {
    const body = ['fault', 'reset', 'recover'].includes(action)
      ? { action, lineId: device.lineId, deviceId: device.id, faultType }
      : { action };
    await api('/simulator/control', { method: 'POST', body: JSON.stringify(body) });
    log(`${action}${faultType ? ` / ${faultType}` : ''} 已提交`); await load();
  }
  catch (error) { log(`操作失败：${String(error)}`); }
}

async function controlAll(action: 'start' | 'stop'): Promise<void> {
  try {
    await api('/simulator/control', { method: 'POST', body: JSON.stringify({ action }) });
    log(`${action === 'start' ? '启动' : '停止'}全部已提交`); await load();
  } catch (error) { log(`批量操作失败：${String(error)}`); }
}

function bind(): void {
  document.querySelectorAll<HTMLElement>('[data-device]').forEach((el) => el.onclick = () => { selectedDevice = el.dataset.device!; render(); });
  document.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => el.onclick = () => control(el.dataset.action!));
  document.querySelectorAll<HTMLElement>('[data-fault]').forEach((el) => el.onclick = () => control('fault', el.dataset.fault));
  document.querySelector('#refresh')?.addEventListener('click', load);
  document.querySelector('#startAll')?.addEventListener('click', () => controlAll('start'));
  document.querySelector('#stopAll')?.addEventListener('click', () => controlAll('stop'));
  document.querySelector('#snapshot')?.addEventListener('click', () => control('snapshot'));
}

render(); void load();
