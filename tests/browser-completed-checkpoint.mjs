import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const url = pathToFileURL(resolve(process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html')).href;
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
try {
  await mkdir('test-results', { recursive: true });
  const page = await browser.newPage({ offline: true, viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^(https?:|file:)/.test(request.url()) && request.url() !== url) errors.push(request.url());
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const save = () => page.evaluate(() => ({
    primary: JSON.parse(localStorage.getItem('nine-kingdoms-run-v1')),
    backup: JSON.parse(localStorage.getItem('nine-kingdoms-run-backup-v1')),
    chronicle: JSON.parse(localStorage.getItem('nine-kingdoms-chronicle-v1')),
  }));

  await page.goto(url);
  await page.locator('#menu-settings').click();
  await page.locator('#mute').check();
  await page.locator('#close-settings').click();
  await page.getByLabel('战役').selectOption('march');
  await page.getByLabel('王国', { exact: true }).selectOption('war');
  await page.getByLabel('战局种子').fill('42');
  await button('开始部署').click();
  const start = await save();
  assert.equal(start.primary.run.seed, 42);
  assert.deepEqual(start.primary, start.backup);
  await page.evaluate(() => {
    const removeItem = Storage.prototype.removeItem;
    window.cleanupFailures = 0;
    Storage.prototype.removeItem = function (key) {
      if (key === 'nine-kingdoms-run-v1') {
        window.cleanupFailures++;
        throw new DOMException('Test removal failure', 'SecurityError');
      }
      return removeItem.call(this, key);
    };
  });
  await button('开始战斗').click();
  await page.getByRole('heading', { name: '防线失守' }).waitFor({ timeout: 40000 });
  assert.equal(await page.locator('#merit-earned').innerText(), '远征功勋 +1');
  assert.equal(await page.evaluate(() => window.cleanupFailures), 1);
  const completed = await save();
  assert.deepEqual(completed.primary, start.primary);
  assert.equal(completed.backup, null);
  assert.equal(completed.chronicle.merit, 1);
  assert.deepEqual(completed.chronicle.records, [start.primary.run.chronicleId]);

  await page.reload();
  await page.getByRole('heading', { name: '选择战局' }).waitFor();
  assert.equal(await button('继续战局').count(), 0, 'A finished expedition must not reopen after checkpoint cleanup fails.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `test-results/completed-checkpoint-${channel}.png` });
  await button('进度备份').click();
  const [file] = await Promise.all([page.waitForEvent('download'), button('导出进度').click()]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
  assert.equal(exported.checkpoint, null);
  assert.deepEqual(exported.chronicle, completed.chronicle);
  assert.deepEqual(await save(), completed);
  await button('返回主菜单').click();
  await page.getByLabel('战役').selectOption('march');
  await page.getByLabel('战局种子').fill('81');
  await button('开始部署').click();
  assert.equal(await page.getByRole('dialog', { name: '替换现有战局？' }).count(), 0);
  const next = await save();
  assert.equal(next.primary.run.seed, 81);
  assert.notEqual(next.primary.run.chronicleId, start.primary.run.chronicleId);
  assert.deepEqual(next.primary, next.backup);
  assert.deepEqual(next.chronicle, completed.chronicle);
  await page.reload();
  await button('继续战局').click();
  assert.deepEqual(await save(), next);
  await page.reload();
  await button('进度备份').click();
  const legacy = { ...exported, checkpoint: completed.primary };
  await page.locator('#progress-file').setInputFiles({ name: 'legacy-progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await page.locator('#progress-summary').getByText('这份备份只有远征纪事', { exact: false }).waitFor();
  await button('确认替换本机进度').click();
  assert.deepEqual(await save(), { primary: null, backup: null, chronicle: completed.chronicle });
  await button('返回主菜单').click();
  assert.equal(await button('继续战局').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`${channel} ${browser.version()}: awarded merit survives partial checkpoint removal, completed saves stay closed, and export and new saves work.`);
} finally {
  await browser.close();
}
