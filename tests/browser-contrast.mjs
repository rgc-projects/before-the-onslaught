import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const url = process.env.NINE_KINGDOMS_URL ?? pathToFileURL(resolve('build/Nine Kingdoms.html')).href;
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });

try {
  await mkdir('test-results', { recursive: true });
  for (const colorScheme of ['dark', 'light']) {
    const page = await browser.newPage({
      viewport: { width: colorScheme === 'dark' ? 1280 : 390, height: 844 },
      forcedColors: 'active', colorScheme, offline: url.startsWith('file:'),
    });
    try {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const button = name => page.getByRole('button', { name, exact: true });
      const tile = (x, y) => page.getByRole('button', { name: new RegExp(`^${x}列${y}行 `) });
      const marker = cell => cell.evaluate(node => getComputedStyle(node, '::before').borderTopStyle);
      const preview = page.locator('#placement-preview');
      await page.goto(url);
      await button('开始部署').click();
      await button('开始战斗').waitFor();
      assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
      await page.keyboard.press('1');
      const card = page.locator('#hand [aria-pressed="true"]');
      const valid = tile(5, 3);
      const blocked = tile(4, 3);
      assert.equal(await card.count(), 1);
      assert.equal(await preview.getAttribute('data-valid'), 'yes');
      assert.equal(await valid.evaluate(node => node.matches(':focus-visible')), true);
      await page.locator('.map-panel').screenshot({ path: `test-results/contrast-${channel}-${colorScheme}-valid.png` });
      const validStyle = await marker(valid);

      await page.keyboard.press('ArrowLeft');
      assert.equal(await blocked.evaluate(node => node.matches(':focus-visible')), true);
      assert.equal(await preview.getAttribute('data-valid'), 'no');
      await page.locator('.map-panel').screenshot({ path: `test-results/contrast-${channel}-${colorScheme}-blocked.png` });
      const blockedStyle = await marker(blocked);
      assert.equal(validStyle, 'solid');
      assert.equal(blockedStyle, 'dashed');
      assert.match(await blocked.evaluate(node => getComputedStyle(node).backgroundColor), /^rgba\(.+, 0\)$/);
      assert.equal(await card.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');

      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      assert.match(await valid.getAttribute('aria-label'), /松岗箭塔/);
      assert.equal(await preview.isVisible(), false);
      await page.reload();
      await button('继续战局').click();
      assert.match(await valid.getAttribute('aria-label'), /松岗箭塔/);

      await page.reload();
      await page.getByRole('combobox', { name: '战役', exact: true }).selectOption('march');
      await button('开始部署').click();
      await button('替换并开始').click();
      const locked = page.locator('#tiles [data-locked]').first();
      assert.equal(await marker(locked), 'dotted');
      assert.match(await locked.getAttribute('aria-label'), /第 [24] 波开放/);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  console.log(`${channel} ${browser.version()}: forced-colors placement, focus, and checkpoint passed.`);
} finally {
  await browser.close();
}
