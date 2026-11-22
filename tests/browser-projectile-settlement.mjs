import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const replay = JSON.parse(execFileSync(process.execPath, ['tools/sample-balance.mjs', '--replay=59:iron:garrison'], { encoding: 'utf8' }));
const url = pathToFileURL(resolve(process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html')).href;
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
try {
  const page = await browser.newPage({ offline: true, viewport: { width: 1280, height: 800 } });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('request', request => { if (/^(https?:|file:)/.test(request.url()) && request.url() !== url) failures.push(request.url()); });
  await page.addInitScript(() => {
    window.enemyCounts = [];
    window.addEventListener('DOMContentLoaded', () => {
      const intel = document.querySelector('#enemies-left');
      new MutationObserver(() => window.enemyCounts.push(intel.textContent)).observe(intel, { childList: true });
    });
  });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('nine-kingdoms-run-v1')).run);
  const button = name => page.getByRole('button', { name, exact: true });
  const tile = ({ x, y }) => page.getByRole('button', { name: new RegExp(`^${x + 1}列${y + 1}行 `) });
  const reward = page.getByRole('heading', { name: '选择战利品', exact: true });
  await page.goto(url);
  await page.getByRole('combobox', { name: '战役', exact: true }).selectOption('march');
  await page.getByLabel('战局种子').fill('59');
  await button('开始部署').click();
  let wave = 0;
  for (const command of replay.commands) {
    switch (command.kind) {
      case 'play':
        await page.locator(`#hand [data-slot="${command.slot}"]`).click();
        if (command.tile) await tile(command.tile).click();
        break;
      case 'buy':
        await page.locator('#shop').click();
        await page.locator(`[data-offer="${command.card}"]`).click();
        await page.locator('#close-shop').click();
        break;
      case 'upgrade':
        await tile((await read()).buildings.find(item => item.id === command.id).tile).click();
        await page.locator('#upgrade').click();
        break;
      case 'encounter':
        await page.locator('#encounter').click();
        await page.locator(`[data-choice="${command.choice}"]`).click();
        break;
      case 'start':
        wave++;
        if (wave === 3) assert.equal((await read()).keepHp, 30);
        await page.evaluate(() => { window.enemyCounts.length = 0; });
        await button('开始战斗').click();
        await reward.waitFor({ timeout: 45000 });
        break;
      case 'reward':
        await page.locator(`[data-reward="${command.card}"]`).click();
        break;
      default: throw new Error(`Unexpected replay command: ${command.kind}`);
    }
    if (wave === 3) break;
  }
  const finished = await read();
  assert.equal(finished.wave, 2);
  assert.equal(finished.keepHp, 27);
  assert.deepEqual(finished.waveReport.keepDamage, [{ enemy: 'hexer', damage: 3, hits: 1 }]);
  assert.ok((await page.evaluate(() => window.enemyCounts)).includes('敌军已清空 · 敌方弹道结算中'));
  const damage = page.getByRole('list', { name: '城堡伤害来源' });
  assert.match(await damage.innerText(), /盐灰咒师.*3 生命 · 1 次命中/s);
  await mkdir('test-results', { recursive: true });
  await page.locator('#overlay').screenshot({ path: `test-results/projectile-settlement-${channel}.png` });
  await page.reload();
  await button('继续战局').click();
  await reward.waitFor();
  assert.deepEqual(await read(), finished);
  const downloaded = page.waitForEvent('download');
  await button('保存战报').click();
  assert.match(await readFile(await (await downloaded).path(), 'utf8'), /盐灰咒师.*3 生命.*1 次命中/);
  assert.deepEqual(failures, []);
  console.log(`${channel} ${browser.version()}: the final enemy projectile hit before reward, with matching damage in the restored report.`);
} finally {
  await browser.close();
}
