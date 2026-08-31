#!/usr/bin/env node

/**
 * Tauri desktop readiness smoke test.
 *
 * This script deliberately does not start or modify MES services. It checks
 * whether a Tauri wrapper exists and reports a distinct exit code while the
 * desktop project has not been created yet.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import process from 'node:process';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const appDirArg = process.argv.find((arg) => arg.startsWith('--app-dir='));
const appDir = resolve(
  rootDir,
  appDirArg?.slice('--app-dir='.length) ?? process.env.TAURI_APP_DIR ?? 'desktop',
);
const allowMissing = args.has('--allow-missing');
const runBuild = args.has('--build');

const checks = [];
let frontendBuildCommand;
const record = (name, passed, detail) => checks.push({ name, passed, detail });

const tauriDir = join(appDir, 'src-tauri');
const runtimeScript = join(rootDir, 'scripts', 'desktop-runtime.sh');
const configPath = ['tauri.conf.json', 'tauri.conf.json5']
  .map((name) => join(tauriDir, name))
  .find((path) => existsSync(path));
const cargoPath = join(tauriDir, 'Cargo.toml');
const packagePath = join(appDir, 'package.json');

record('desktop app directory', existsSync(appDir), appDir);
record(
  'Tauri configuration',
  Boolean(configPath),
  configPath ?? `${tauriDir}/tauri.conf.json(.5) not found`,
);
record('Rust manifest', existsSync(cargoPath), cargoPath);
record('desktop runtime supervisor', existsSync(runtimeScript), runtimeScript);

for (const scriptName of ['desktop.sh', 'desktop-run.sh', 'desktop-runtime.sh', 'desktop-stop.sh', 'desktop-status.sh']) {
  const scriptPath = join(rootDir, 'scripts', scriptName);
  if (!existsSync(scriptPath)) {
    record(`shell script ${scriptName}`, false, scriptPath);
    continue;
  }
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8', stdio: 'pipe' });
  record(`shell syntax ${scriptName}`, syntax.status === 0, syntax.status === 0 ? 'valid' : (syntax.stderr || syntax.stdout).trim());
}

if (configPath?.endsWith('.json')) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const buildConfig = config.build ?? {};
    const hasFrontendTarget = Boolean(buildConfig.frontendDist || buildConfig.devUrl);
    const hasWindow = Array.isArray(config.app?.windows) && config.app.windows.length > 0;
    record('Tauri config JSON', true, 'valid JSON');
    record('frontend target', hasFrontendTarget, 'build.frontendDist or build.devUrl');
    record('window definition', hasWindow, 'app.windows');
    const windowConfig = config.app?.windows?.[0] ?? {};
    record('resizable window', windowConfig.resizable === true, 'app.windows[0].resizable=true');
    record('minimum window size', Number(windowConfig.minWidth) >= 1024 && Number(windowConfig.minHeight) >= 700, 'minWidth>=1024 and minHeight>=700');
    record('bundle enabled', config.bundle?.active === true, 'bundle.active=true');
    const resources = Array.isArray(config.bundle?.resources) ? config.bundle.resources : [];
    record('runtime resource bundle', resources.some((resource) => String(resource).includes('desktop-runtime.sh')), 'bundle.resources');
  } catch (error) {
    record('Tauri config JSON', false, `invalid JSON: ${error.message}`);
  }
} else if (configPath) {
  record('Tauri config syntax', true, 'JSON5 requires the Tauri CLI for full parsing');
}

if (existsSync(join(tauriDir, 'src', 'lib.rs'))) {
  const rustSource = readFileSync(join(tauriDir, 'src', 'lib.rs'), 'utf8');
  record('Rust single-instance plugin', rustSource.includes('tauri_plugin_single_instance'), 'source registration');
  record('Rust runtime supervision', rustSource.includes('start_runtime') && rustSource.includes('stop_runtime'), 'startup/exit hooks');
  record('Rust reverse cleanup signal', rustSource.includes('kill') && rustSource.includes('TERM'), 'SIGTERM before wait');
}

const runtimeSelfTest = spawnSync('bash', [runtimeScript, '--self-test'], {
  cwd: rootDir,
  encoding: 'utf8',
  stdio: 'pipe',
  env: { ...process.env, MES_RUNTIME_DIR: join(rootDir, '.runtime', 'desktop-smoke'), MES_DESKTOP_NO_DIALOG: '1' },
});
record('runtime self-test', runtimeSelfTest.status === 0, runtimeSelfTest.status === 0 ? 'passed' : (runtimeSelfTest.stderr || runtimeSelfTest.stdout).trim());

if (existsSync(packagePath)) {
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    const hasTauriScript = Object.values(packageJson.scripts ?? {}).some((value) =>
      String(value).includes('tauri'),
    );
    record('Tauri package script', hasTauriScript, hasTauriScript ? 'found' : 'not found');
    const frontendBuildScript = packageJson.scripts?.['build:frontend'] ?? packageJson.scripts?.build;
    record('frontend build script', typeof frontendBuildScript === 'string', 'package.json scripts.build:frontend or scripts.build');
    if (typeof frontendBuildScript === 'string') {
      frontendBuildCommand = packageJson.scripts?.['build:frontend']
        ? ['npm', ['run', 'build:frontend']]
        : ['npm', ['run', 'build']];
    }
  } catch (error) {
    record('desktop package.json', false, `invalid JSON: ${error.message}`);
  }
} else {
  record('desktop package.json', false, packagePath);
}

if (runBuild && checks.every(({ passed }) => passed)) {
  const [frontendCommand, frontendArgs] = frontendBuildCommand ?? ['npm', ['run', 'build']];
  const frontendBuild = spawnSync(frontendCommand, frontendArgs, {
    cwd: appDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  record(
    'frontend build (no GUI)',
    frontendBuild.status === 0,
    frontendBuild.status === 0 ? 'passed' : (frontendBuild.stderr || frontendBuild.stdout).trim(),
  );

  const cargoCheck = spawnSync('cargo', ['check', '--manifest-path', cargoPath], {
    cwd: appDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  record(
    'Rust cargo check (no GUI)',
    cargoCheck.status === 0,
    cargoCheck.status === 0 ? 'passed' : (cargoCheck.stderr || cargoCheck.stdout).trim(),
  );
}

const failed = checks.filter(({ passed }) => !passed);
console.log(`Tauri desktop smoke: ${appDir}`);
for (const check of checks) {
  console.log(`${check.passed ? 'PASS' : 'BLOCKED'}  ${check.name}: ${check.detail}`);
}

if (failed.length > 0) {
  const scaffoldMissing = !existsSync(appDir) || !configPath || !existsSync(cargoPath);
  if (scaffoldMissing) {
    console.error('\n桌面版 smoke 被阻塞：当前仓库尚未包含完整可识别的 Tauri 工程。');
    console.error('先创建 desktop/src-tauri、Tauri 配置和 package.json tauri 脚本，再执行本脚本。');
  } else {
    console.error('\n桌面版 smoke 被阻塞：Tauri 工程结构存在，但配置或无 GUI 构建检查失败。');
    console.error('请根据上面的 BLOCKED 明细修复依赖、配置或 Rust 构建环境后重试。');
  }
  console.error('--allow-missing 仅用于缺少工程时的 CI 基线扫描，不代表桌面版验收通过。');
  process.exitCode = allowMissing ? 0 : 2;
} else {
  console.log('\nTauri 工程结构检查通过；仍需按 docs/Tauri桌面版测试矩阵.md 执行运行时测试。');
}
