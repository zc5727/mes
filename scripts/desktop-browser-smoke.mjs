#!/usr/bin/env node

/**
 * macOS GUI smoke for a packaged Tauri app. It intentionally does not claim
 * DOM or Three.js gesture coverage; those remain in frontend-browser-smoke.
 * Missing Accessibility permission, artifacts, or macOS tools are BLOCKED.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (prefix) => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const appPath = resolve(rootDir, arg('--app=') ?? process.env.MES_DESKTOP_APP ?? 'desktop/src-tauri/target/release/bundle/macos/MES 智能制造运营平台.app');
const noLaunch = process.argv.includes('--no-launch');
const closeAfter = process.argv.includes('--close-after');
const binaryPath = `${appPath}/Contents/MacOS/mes-desktop`;

const blocked = (message) => {
  console.error(`BLOCKED: ${message}`);
  process.exitCode = 2;
};
const failed = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};
const pass = (message) => console.log(`PASS: ${message}`);

if (process.platform !== 'darwin') blocked('桌面 GUI smoke 需要在 macOS 执行');
if (process.exitCode) process.exit();
if (!existsSync(appPath) || !existsSync(binaryPath)) blocked(`app 不存在或缺少可执行文件：${appPath}`);
if (process.exitCode) process.exit();

const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
const processCount = () => {
  const result = run('ps', ['-axo', 'pid=,command=']);
  if (result.status !== 0) return 0;
  return result.stdout.split('\n').reduce((count, line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    return match && Number(match[1]) !== process.pid && match[2].includes(binaryPath)
      ? count + 1
      : count;
  }, 0);
};
const waitFor = (predicate, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  return false;
};

if (!noLaunch) {
  const launch = run('open', ['-a', appPath]);
  if (launch.status !== 0) failed(`无法打开 app：${launch.stderr.trim() || launch.stdout.trim()}`);
}
if (process.exitCode === 1) process.exit();

if (!waitFor(() => processCount() > 0)) {
  blocked('app 进程未在 20 秒内出现；可能是签名、WebView、运行时服务或系统权限问题');
  process.exit();
}
pass('packaged app process started');

const readWindowSize = () => run('osascript', ['-e', `tell application "System Events"
  tell process "mes-desktop"
    if (count of windows) = 0 then error "没有可见窗口"
    set windowSize to size of window 1
    return (item 1 of windowSize as text) & "x" & (item 2 of windowSize as text)
  end tell
end tell`]);
if (!waitFor(() => readWindowSize().status === 0)) {
  const windowCheck = readWindowSize();
  blocked(`窗口不可见或缺少辅助功能权限：${windowCheck.stderr.trim()}`);
} else {
  pass(`window visible (${readWindowSize().stdout.trim()})`);
}

const before = processCount();
const secondLaunch = run('open', ['-a', appPath]);
if (secondLaunch.status !== 0) failed(`第二次启动命令失败：${secondLaunch.stderr.trim()}`);
else if (!waitFor(() => processCount() >= before)) failed('第二次启动后进程状态异常');
else if (processCount() !== 1) failed(`single-instance 进程数异常：${processCount()}`);
else pass('single-instance process count remains 1');

if (closeAfter) {
  const quit = run('osascript', ['-e', 'tell application id "com.zc.mes.desktop" to quit']);
  if (quit.status !== 0) failed(`关闭 app 失败：${quit.stderr.trim()}`);
  else if (!waitFor(() => processCount() === 0)) failed('关闭 app 后进程仍存在，无法证明桌面退出清理');
  else pass('packaged app process exited');
}

if (process.exitCode) {
  console.error('DESKTOP GUI SMOKE: 未通过');
} else {
  console.log('DESKTOP GUI SMOKE PASS');
}
