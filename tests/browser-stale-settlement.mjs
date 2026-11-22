import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const url = pathToFileURL(resolve(process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html')).href;
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
try {
  await mkdir('test-results', { recursive: true });
  const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 720 } });
  const old = await context.newPage();
  const errors = [];
  context.on('request', request => {
    if (/^(https?:|file:)/.test(request.url()) && request.url() !== url) errors.push(request.url());
  });
  old.on('pageerror', error => errors.push(error.message));
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const lost = page => page.getByRole('heading', { name: '防线失守', exact: true });
  const stored = page => page.evaluate(() => ({
    primary: JSON.parse(localStorage.getItem('nine-kingdoms-run-v1')),
    backup: JSON.parse(localStorage.getItem('nine-kingdoms-run-backup-v1')),
    chronicle: JSON.parse(localStorage.getItem('nine-kingdoms-chronicle-v1')),
  }));

  await old.goto(url);
  await old.locator('#menu-settings').click();
  await old.locator('#mute').check();
  await old.locator('#close-settings').click();
  await old.getByLabel('战役').selectOption('march');
  await old.getByLabel('王国', { exact: true }).selectOption('war');
  await old.getByLabel('战局种子').fill('42');
  await button(old, '开始部署').click();
  const initial = await stored(old);
  await button(old, '开始战斗').click();

  const latest = await context.newPage();
  latest.on('pageerror', error => errors.push(error.message));
  await latest.goto(url);
  await button(latest, '继续战局').click();
  await latest.getByLabel('守军阵势').selectOption('inner');
  const updated = await stored(latest);
  assert.equal(updated.primary.run.chronicleId, initial.primary.run.chronicleId);
  assert.equal(updated.primary.run.formation, 'inner');
  assert.notDeepEqual(updated.primary, initial.primary);
  assert.deepEqual(updated.primary, updated.backup);

  await old.bringToFront();
  await lost(old).waitFor({ timeout: 40000 });
  assert.deepEqual(await stored(old), updated, 'A result from a previous revision must preserve the newer checkpoint and leave merit unchanged.');
  const warning = old.getByRole('status').filter({ hasText: '同一战局已在其他标签页更新' });
  await warning.waitFor();
  assert.equal(await button(old, '重试保存功勋').count(), 0);
  assert.equal(await old.locator('#merit-earned').count(), 0);
  const back = button(old, '返回主菜单');
  assert.equal(await back.evaluate(element => element === document.activeElement), true);
  for (const [width, height] of [[390, 844], [1280, 720], [2560, 1080]]) {
    await old.setViewportSize({ width, height });
    assert.equal(await old.locator('#overlay').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    if (width === 390 || channel !== 'firefox') await old.screenshot({ path: `test-results/stale-settlement-${channel}-${width}.png` });
  }
  await old.keyboard.press('Enter');
  await old.locator('#continue-run').waitFor();
  assert.equal(await old.locator('#continue-run').evaluate(element => element === document.activeElement), true);
  await old.keyboard.press('Enter');
  assert.equal(await old.getByLabel('守军阵势').inputValue(), 'inner');
  assert.deepEqual(await stored(old), updated);
  await latest.close();
  await old.bringToFront();
  await button(old, '开始战斗').click();
  await lost(old).waitFor({ timeout: 40000 });
  assert.equal(await old.locator('#merit-earned').innerText(), '远征功勋 +1');
  const settled = await stored(old);
  assert.equal(settled.primary, null);
  assert.equal(settled.backup, null);
  assert.equal(settled.chronicle.merit, 1);
  assert.equal(settled.chronicle.expeditions, 1);
  assert.deepEqual(settled.chronicle.records, [updated.primary.run.chronicleId]);
  await old.reload();
  await button(old, '远征纪事').click();
  assert.match(await old.locator('#overlay').innerText(), /功勋 1 · 出征 1 · 胜利 0/);
  assert.deepEqual(errors, []);
  console.log(`${channel} ${browser.version()}: stale same-run result kept the newer save and only the latest revision earned merit.`);
} finally {
  await browser.close();
}
