import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const url = process.env.NINE_KINGDOMS_URL ?? pathToFileURL(resolve('build/Nine Kingdoms.html')).href;
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
try {
  const page = await browser.newPage({ offline: url.startsWith('file:'), viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: true });
  const raider = page.locator('#enemy-roster [data-enemy="raider"] button');
  const marker = page.locator('#tiles [data-battle-inspect]');
  const focusIsOnRaiders = () => raider.evaluate(element => document.activeElement === element);
  const title = page.locator('#inspect-title');
  const details = page.locator('#inspect-text');

  await page.goto(url);
  await button('开始部署').click();
  await button('开始战斗').click();
  await raider.locator('b').filter({ hasText: /^[2-5] \/ / }).waitFor();
  assert.equal(await raider.getAttribute('tabindex'), '0');
  for (let count = 0; count < 12 && !await focusIsOnRaiders(); count++) await page.keyboard.press('Shift+Tab');
  assert.equal(await focusIsOnRaiders(), true);
  await page.keyboard.press('Enter');
  assert.equal(await title.innerText(), '灰旗劫掠者');
  assert.match(await details.innerText(), /敌军 · 生命 12 \/ 12.*同类敌军 1 \/ [2-5]/s);
  assert.equal(await raider.getAttribute('aria-current'), 'true');
  await page.keyboard.press('Enter');
  assert.match(await details.innerText(), /同类敌军 2 \/ [2-5]/);
  assert.equal(await focusIsOnRaiders(), true);

  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: '战斗已暂停' });
  await pause.waitFor();
  const selected = await marker.getAttribute('aria-label');
  assert.match(await details.innerText(), /同类敌军 2 \/ [2-5]/);
  await pause.getByRole('button', { name: '继续战斗', exact: true }).click();
  assert.equal(await focusIsOnRaiders(), true);
  await page.waitForFunction(cell => {
    const mark = document.querySelector('#tiles [data-battle-inspect]');
    return mark && mark.getAttribute('aria-label') !== cell;
  }, selected);
  assert.match(await details.innerText(), /同类敌军 2 \/ [2-5]/);
  await raider.locator('b').filter({ hasText: /^[3-5] \/ / }).waitFor();
  await raider.click();
  assert.match(await details.innerText(), /同类敌军 3 \/ [3-5]/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/enemy-roster-${channel}-narrow.png`, fullPage: true });

  await page.getByRole('heading', { name: '防线失守', exact: true }).waitFor({ timeout: 25000 });
  assert.equal(await raider.count(), 0);
  assert.equal(await marker.count(), 0);
  assert.deepEqual(errors, []);
  console.log(`${channel} ${browser.version()}: keyboard cycle, moving marker, pause focus and battle cleanup passed.`);
} finally {
  await browser.close();
}
