#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const source = await readFile(resolve(root, 'simulator-ui/src/main.ts'), 'utf8');
const readme = await readFile(resolve(root, 'simulator-ui/README.md'), 'utf8');

const assertions = [
  ['默认控制台端口为 5174', readme.includes('127.0.0.1:5174')],
  ['设备列表查询', source.includes("api<Device[]>('/devices')")],
  ['产线列表查询', source.includes("api<Line[]>('/production-lines')")],
  ['统一仿真控制接口', source.includes("api('/simulator/control'")],
  ['启动全部控件', source.includes('id="startAll"')],
  ['停止全部控件', source.includes('id="stopAll"')],
  ['设备故障注入控件', source.includes('data-fault="SPINDLE_OVERLOAD"')],
  ['单设备启停控件', source.includes('data-action="start"') && source.includes('data-action="stop"')],
  ['API 密钥注入', source.includes('VITE_API_KEY') && source.includes('authorization')],
  ['身份上下文注入', source.includes('x-user-role') && source.includes('x-factory-id')],
  ['API 失败可重试', source.includes('id="retry"') && source.includes('addEventListener(\'click\', load)')],
];

const failed = assertions.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length > 0) {
  console.error(`SIMULATOR UI CONTRACT FAIL: ${failed.join('；')}`);
  process.exit(1);
}

console.log(`SIMULATOR UI CONTRACT PASS (${assertions.length} checks; runtime port 5174 is verified separately)`);
