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
  const context = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^(https?:|file:)/.test(request.url()) && request.url() !== url) errors.push(request.url()); });
  const state = phase => page.locator(`#phase[data-phase="${phase}"]`);
  const reward = page.getByRole('dialog', { name: '选择战利品' });
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const save = () => page.evaluate(() => ({
    primary: localStorage.getItem('nine-kingdoms-run-v1'), backup: localStorage.getItem('nine-kingdoms-run-backup-v1'),
  }));
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    window.checkpointProbe = { blocked: false, failures: 0 };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'nine-kingdoms-run-v1' && window.checkpointProbe.blocked) {
        window.checkpointProbe.failures++;
        throw new DOMException('Test quota failure', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
  });
  const blockSave = blocked => page.evaluate(blocked => { window.checkpointProbe.blocked = blocked; }, blocked);
  const active = selector => page.evaluate(selector => document.activeElement.matches(selector), selector);
  const place = async (target, card, column, row) => {
    await target.locator(`#hand [data-card="${card}"]`).first().click();
    await target.getByRole('button', { name: new RegExp(`^${column}列${row}行 `) }).click();
  };
  await page.goto(url);
  await page.locator('#menu-settings').click();
  await page.locator('#mute').check();
  await page.locator('#close-settings').click();
  await button(page, '开始部署').click();
  for (const [card, column, row] of [['watch', 6, 3], ['watch', 6, 5], ['farm', 5, 2], ['guard', 7, 4]]) {
    await place(page, card, column, row);
  }
  const beforeBattle = await save();
  await blockSave(true);
  await button(page, '开始战斗').click();
  await reward.waitFor({ timeout: 35000 });
  assert.equal(await page.evaluate(() => window.checkpointProbe.failures), 1);
  assert.deepEqual(await save(), beforeBattle);
  const retry = button(reward, '重试保存进度');
  assert.equal(await retry.isVisible(), true, 'The active reward dialog must expose the failed save and offer a retry.');
  assert.match(await reward.getByRole('status').innerText(), /进度尚未保存/);
  assert.equal(await retry.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.checkpointProbe.failures), 2);
  assert.deepEqual(await save(), beforeBattle);

  const widths = channel === 'firefox' ? [[390, 844]] : [[390, 844], [1280, 720], [2560, 1080]];
  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height });
    assert.equal(await reward.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    await page.screenshot({ path: `test-results/checkpoint-retry-${channel}-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const offers = await reward.locator('[data-reward]').evaluateAll(nodes => nodes.map(node => node.dataset.reward));
  await blockSave(false);
  await page.keyboard.press('Enter');
  assert.match(await reward.getByRole('status').innerText(), /进度已保存/);
  assert.equal(await active('dialog [data-checkpoint-save] [role="status"]'), true);
  await page.keyboard.press('Tab');
  assert.equal(await active(`[data-reward="${offers[0]}"]`), true);
  const rewardSave = await save();
  assert.equal(rewardSave.primary, rewardSave.backup);
  const savedReward = JSON.parse(rewardSave.primary).run;
  assert.equal(savedReward.phase, 'reward');
  assert.deepEqual(savedReward.rewards, offers);

  await page.reload();
  await button(page, '继续战局').click();
  await reward.waitFor();
  assert.equal(await retry.isVisible(), false);
  assert.deepEqual(await save(), rewardSave);
  await blockSave(true);
  await reward.locator('[data-reward]').first().press('Enter');
  await state('planning').waitFor();
  assert.deepEqual(await save(), rewardSave);
  const planningRetry = button(page, '重试保存进度');
  assert.equal(await planningRetry.isVisible(), true);
  await blockSave(false);
  await planningRetry.press('Enter');
  const planningSave = await save();
  assert.equal(planningSave.primary, planningSave.backup);
  const next = JSON.parse(planningSave.primary).run;
  assert.equal(next.wave, 1);
  assert.deepEqual(next.pastWaves.map(wave => [wave.wave, wave.reward]), [[0, offers[0]]]);
  assert.equal(await active('.orders [data-checkpoint-save] [role="status"]'), true);
  await page.reload();
  await button(page, '继续战局').click();
  await state('planning').waitFor();
  assert.deepEqual(await save(), planningSave);

  await blockSave(true);
  await place(page, 'wall', 5, 5);
  assert.equal(await planningRetry.isVisible(), true);
  assert.deepEqual(await save(), planningSave);
  const other = await context.newPage();
  await other.goto(url);
  await button(other, '继续战局').click();
  await place(other, 'wall', 8, 2);
  const newer = await save();
  assert.notDeepEqual(newer, planningSave);
  assert.equal(newer.primary, newer.backup);
  await other.close();
  await page.bringToFront();
  await blockSave(false);
  await planningRetry.press('Enter');
  await page.getByRole('heading', { name: '选择战局' }).waitFor();
  assert.deepEqual(await save(), newer, 'The retry must preserve the newer checkpoint from another tab.');
  assert.deepEqual(errors, []);
  console.log(`${channel} ${browser.version()}: reward and planning retry survive reload, and a newer checkpoint in another tab is preserved.`);
} finally {
  await browser.close();
}
