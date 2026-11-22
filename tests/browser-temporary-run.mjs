import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const url = pathToFileURL(resolve(process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html')).href;
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
const errors = [];
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const notice = page => page.locator('#checkpoint-status-board');

async function launch(denied) {
  const page = await browser.newPage({ offline: true, viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(denied => {
    const storage = window.localStorage;
    const keys = ['nine-kingdoms-run-v1', 'nine-kingdoms-run-backup-v1', 'nine-kingdoms-chronicle-v1'];
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    window.storageProbe = { denied, readOnly: false, operations: [], snapshot: () => keys.map(key => storage.getItem(key)) };
    Object.defineProperty(window, 'localStorage', { configurable: true, get() {
      if (window.storageProbe.denied) throw new DOMException('Test storage policy', 'SecurityError');
      return storage;
    } });
    Storage.prototype.setItem = function (key, value) {
      if (this === storage && keys.includes(key)) {
        window.storageProbe.operations.push(['write', key]);
        if (window.storageProbe.readOnly) throw new DOMException('Test storage policy', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === storage && keys.includes(key)) window.storageProbe.operations.push(['remove', key]);
      return removeItem.call(this, key);
    };
  }, denied);
  await page.goto(url);
  await page.getByRole('heading', { name: '选择战局', exact: true }).waitFor();
  return page;
}

const stored = page => page.evaluate(() => window.storageProbe.snapshot());
const operations = page => page.evaluate(() => window.storageProbe.operations);
const selectMarch = page => page.getByRole('combobox', { name: '战役', exact: true }).selectOption('march');
const place = async (page, card, column, row) => {
  await page.locator(`#hand [data-card="${card}"]`).first().click();
  await page.getByRole('button', { name: new RegExp(`^${column}列${row}行 `) }).click();
};

try {
  await mkdir('test-results', { recursive: true });
  const restricted = await launch(true);
  assert.equal(await restricted.locator('#new-run').innerText(), '开始临时试玩');
  await selectMarch(restricted);
  await button(restricted, '开始临时试玩').press('Enter');
  assert.match(await notice(restricted).innerText(), /临时试玩中/);
  assert.equal(await button(restricted, '重试保存进度').count(), 0);
  // A change to the browser policy during play must never turn a temporary run into a persistent one.
  await restricted.evaluate(() => { window.storageProbe.denied = false; });
  await button(restricted, '开始战斗').click();
  const lost = restricted.getByRole('dialog', { name: '防线失守', exact: true });
  await lost.waitFor({ timeout: 45000 });
  assert.match(await lost.getByRole('status').innerText(), /临时试玩已结束/);
  assert.equal(await button(lost, '重试保存功勋').count(), 0);
  const download = restricted.waitForEvent('download');
  await button(lost, '保存整局战报').click();
  assert.match(await readFile(await (await download).path(), 'utf8'), /灰旗远征.*钢铁王国/s);
  assert.deepEqual(await stored(restricted), [null, null, null]);
  assert.deepEqual(await operations(restricted), []);
  await button(lost, '重开同一战局').click();
  assert.match(await notice(restricted).innerText(), /临时试玩中/);
  assert.deepEqual(await operations(restricted), []);
  await restricted.close();

  const protectedRun = await launch(false);
  await selectMarch(protectedRun);
  await button(protectedRun, '开始部署').click();
  await place(protectedRun, 'watch', 6, 3);
  const old = await stored(protectedRun);
  assert.match(old[0], /"campaign":"march"/);
  assert.equal(old[0], old[1]);
  await protectedRun.reload();
  await button(protectedRun, '开始部署').click();
  const replace = protectedRun.getByRole('dialog', { name: '替换现有战局？', exact: true });
  assert.equal(await button(replace, '取消').evaluate(element => element === document.activeElement), true);
  await protectedRun.evaluate(() => { window.storageProbe.readOnly = true; });
  await button(replace, '替换并开始').click();
  assert.match(await replace.getByRole('status').innerText(), /未能保存新战局/);
  assert.deepEqual(await stored(protectedRun), old);
  await protectedRun.screenshot({ path: `test-results/temporary-choice-${channel}.png` });
  await protectedRun.evaluate(() => { window.storageProbe.operations = []; });
  await button(replace, '临时试玩').press('Enter');
  await protectedRun.evaluate(() => { window.storageProbe.readOnly = false; });
  for (const [card, column, row] of [['watch', 6, 3], ['watch', 6, 5], ['farm', 5, 2], ['guard', 7, 4]]) {
    await place(protectedRun, card, column, row);
  }
  await button(protectedRun, '开始战斗').click();
  const reward = protectedRun.getByRole('dialog', { name: '选择战利品', exact: true });
  await reward.waitFor({ timeout: 45000 });
  assert.match(await reward.getByRole('status').innerText(), /临时试玩中/);
  assert.equal(await reward.locator('[data-reward]').first().evaluate(element => element === document.activeElement), true);
  await protectedRun.keyboard.press('Enter');
  assert.match(await notice(protectedRun).innerText(), /临时试玩中/);
  assert.deepEqual(await operations(protectedRun), []);
  await button(protectedRun, '开始战斗').click();
  await protectedRun.keyboard.press('Escape');
  const pause = protectedRun.getByRole('dialog', { name: '战斗已暂停', exact: true });
  assert.match(await pause.innerText(), /返回主菜单会结束本局/);
  await button(pause, '返回主菜单').click();
  assert.deepEqual(await stored(protectedRun), old);
  await button(protectedRun, '继续战局').click();
  assert.match(await protectedRun.locator('#campaign-name').innerText(), /灰旗远征/);
  assert.equal(await notice(protectedRun).isVisible(), false);
  assert.deepEqual(await stored(protectedRun), old);
  assert.deepEqual(errors, []);
  console.log(`${channel} ${browser.version()}: blocked storage, temporary defeat and restart, actual reward, and existing checkpoint preservation passed.`);
} finally {
  await browser.close();
}
