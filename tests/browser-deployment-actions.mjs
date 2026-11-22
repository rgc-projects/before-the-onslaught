import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
const url = process.env.NINE_KINGDOMS_URL ?? pathToFileURL(resolve('build/Nine Kingdoms.html')).href;
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: url.startsWith('file:') });
const failures = [];
page.on('pageerror', error => failures.push(error.message));
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const tile = (x, y) => page.getByRole('button', { name: new RegExp(`^${x}列${y}行 `) });
const saved = () => page.evaluate(() => localStorage.getItem('nine-kingdoms-run-v1'));
const state = async () => JSON.parse(await saved()).run;
const focused = () => page.evaluate(() => document.activeElement.id);

async function place(card, x, y) {
  await page.locator(`#hand [data-card="${card}"]`).first().click();
  await tile(x, y).click();
}

try {
  await page.goto(url);
  await button('开始部署').click();
  await place('watch', 6, 3);
  await place('watch', 6, 5);
  const beforeWall = await state();
  await place('wall', 5, 5);
  await tile(6, 3).click();
  await button('迁移 · 1 木材').click();
  await tile(7, 3).click();
  assert.equal((await state()).wallet.wood, 0);
  assert.match(await tile(7, 3).getAttribute('aria-label'), /松岗箭塔/);
  assert.doesNotMatch(await tile(6, 3).getAttribute('aria-label'), /松岗箭塔/);

  await tile(5, 5).click();
  const beforeBlockedMove = await saved();
  await button('迁移 · 1 木材').click();
  assert.equal(await page.locator('#notice').innerText(), '迁移所需资源不足。');
  assert.equal(await focused(), 'relocate');
  assert.equal(await button('取消迁移').isVisible(), false);
  assert.equal(await saved(), beforeBlockedMove);

  await button('拆除').click();
  const wallDialog = page.getByRole('dialog', { name: '拆除铁木栅墙？' });
  assert.equal(await focused(), 'cancel-removal');
  assert.match(await wallDialog.innerText(), /返还军令和 2 木材/);
  assert.equal(await wallDialog.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
  await mkdir('test-results', { recursive: true });
  await wallDialog.screenshot({ path: `test-results/${channel}-deployment-refund-narrow.png` });
  await button('撤回并返还', wallDialog).focus();
  await page.keyboard.press('Enter');
  const refunded = await state();
  assert.equal(refunded.wallet.wood, beforeWall.wallet.wood - 1);
  assert.deepEqual(refunded.hand, beforeWall.hand);
  assert.equal(refunded.buildings.some(building => building.def === 'wall'), false);
  assert.equal(await tile(5, 5).evaluate(element => element === document.activeElement), true);
  assert.doesNotMatch(await tile(5, 5).getAttribute('aria-label'), /铁木栅墙/);

  await page.setViewportSize({ width: 1280, height: 900 });
  await place('guard', 7, 4);
  assert.match(await tile(7, 4).getAttribute('aria-label'), /边境卫士集结点/);
  await tile(7, 3).click();
  await button('拆除').click();
  assert.equal(await button('撤回并返还').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await focused(), 'remove-placement');
  await tile(7, 4).click();
  await button('解散').click();
  const guardDialog = page.getByRole('dialog', { name: '解散边境卫士？' });
  await guardDialog.screenshot({ path: `test-results/${channel}-deployment-refund-desktop.png` });
  await button('撤回并返还', guardDialog).click();
  assert.deepEqual((await state()).rally, []);
  assert.deepEqual((await state()).wallet, refunded.wallet);
  assert.deepEqual((await state()).hand, refunded.hand);
  const checkpoint = await saved();
  await page.reload();
  await button('继续战局').click();
  assert.equal(await saved(), checkpoint);
  assert.deepEqual((await state()).buildings, refunded.buildings);

  await tile(7, 3).click();
  await button('拆除').click();
  await button('确认拆除').click();
  assert.equal((await state()).buildings.length, 1);
  assert.deepEqual((await state()).wallet, refunded.wallet);
  assert.deepEqual((await state()).hand, refunded.hand);
  assert.deepEqual(failures, []);
  console.log(`${channel} ${browser.version()} deployment management passed.`);
} finally {
  await browser.close();
}
