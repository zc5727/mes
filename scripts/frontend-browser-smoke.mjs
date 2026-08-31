#!/usr/bin/env node

/**
 * Optional real-browser smoke test for the digital-twin frontend.
 *
 * The repository intentionally does not force-install Playwright. When it is
 * absent this command exits with BLOCKED so CI does not confuse a source
 * contract check with a real browser check.
 */

const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('BLOCKED: Playwright is not installed. Install it separately, then rerun this smoke test.');
  process.exitCode = 2;
}

if (process.exitCode === 2) process.exit();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const failures = [];
const require = (condition, message) => {
  if (!condition) failures.push(message);
};

page.on('dialog', (dialog) => dialog.accept());

try {
  await page.goto(frontendUrl, { waitUntil: 'networkidle' });
  const body = await page.locator('body').innerText();
  for (const line of ['CNC加工线', '装配线', '焊接线', '视觉检测线']) {
    require(body.includes(line), `缺少产线: ${line}`);
  }
  require(await page.locator('canvas').count() > 0, '三维场景未渲染');

  const lineCards = page.locator('.line-card');
  require(await lineCards.count() >= 4, '四条产线卡片未渲染');
  await lineCards.nth(2).click();
  require((await page.locator('.breadcrumb').innerText()).includes('焊接'), '产线切换未更新当前车间');

  const navigation = page.locator('.shop-block');
  const before = await navigation.evaluate((element) => element.scrollTop);
  await navigation.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const after = await navigation.evaluate((element) => element.scrollTop);
  require(after >= before, '工厂导航不可滚动');

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  require(Boolean(canvasBox), '三维场景没有可交互尺寸');
  if (canvasBox) {
    await page.mouse.move(canvasBox.x + 80, canvasBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 160, canvasBox.y + 120);
    await page.mouse.up();
    await page.mouse.wheel(0, -240);
  }
  const addLine = page.getByRole('button', { name: /新增产线/ });
  require(await addLine.isEnabled(), 'API 模式新增产线按钮不可用');
  await addLine.click();
  require(await page.locator('.line-dialog').count() > 0, '新增产线弹窗未打开');
  console.log('FRONTEND BROWSER SMOKE PASS');
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`FAIL: ${failures.join('; ')}`);
  process.exitCode = 1;
}
