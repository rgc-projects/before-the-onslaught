import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const path = process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html';
const url = pathToFileURL(resolve(path)).href;
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
try {
  await mkdir('test-results', { recursive: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 2560, height: 1080 }]) {
    const page = await browser.newPage({ offline: true, viewport });
    try {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^(https?:|file:)/.test(request.url()) && request.url() !== url) errors.push(request.url()); });
      const button = name => page.getByRole('button', { name, exact: true });
      const tile = (x, y) => page.getByRole('button', { name: new RegExp(`^${x}列${y}行 `) });
      const focus = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') ?? document.activeElement.id);
      const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('nine-kingdoms-run-v1')));
      const preview = page.locator('#placement-preview');
      const press = key => page.keyboard.press(key);

      await page.goto(url);
      await button('开始部署').waitFor();
      await press('Enter');
      await button('开始战斗').waitFor();
      const firstWatch = page.locator('#hand [data-slot="0"]');
      assert.equal(await firstWatch.evaluate(element => element === document.activeElement), true);
      const before = await saved();
      await press('Enter');
      assert.match(await focus(), /^5列3行 草地/, 'Activating a grid card must focus a tile.');
      assert.equal(await tile(5, 3).getAttribute('aria-describedby'), 'placement-preview');
      assert.match(await preview.innerText(), /渡口覆盖/);
      assert.match(await preview.innerText(), /方向键选格 · Enter 确认 · Esc 返回军令/);
      assert.equal(await preview.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
      }), true, 'The preview should fit near the focused battlefield.');
      await press('ArrowRight');
      assert.match(await focus(), /^6列3行 草地/);
      await tile(6, 5).hover();
      assert.equal(await tile(6, 5).getAttribute('aria-describedby'), 'placement-preview');
      await page.locator('#route-name').hover();
      assert.equal(await tile(6, 3).getAttribute('aria-describedby'), 'placement-preview');
      assert.equal(await tile(6, 5).getAttribute('aria-describedby'), null);
      assert.deepEqual(await saved(), before);
      await page.screenshot({ path: `test-results/keyboard-deployment-${channel}-${viewport.width}.png` });
      await press('Escape');
      assert.equal(await firstWatch.evaluate(element => element === document.activeElement), true);
      assert.equal(await firstWatch.getAttribute('aria-pressed'), 'false');
      assert.equal(await preview.isVisible(), false);
      assert.deepEqual(await saved(), before);

      await press('1');
      assert.match(await focus(), /^6列3行 草地/);
      await press('Enter');
      const placed = await saved();
      assert.deepEqual(placed.run.buildings.map(building => building.tile), [{ x: 5, y: 2 }]);
      assert.equal(placed.run.wallet.gold, before.run.wallet.gold - 3);

      await press('1');
      assert.equal(await preview.getAttribute('data-valid'), 'no');
      await press('Enter');
      assert.deepEqual(await saved(), placed);
      await press('ArrowDown');
      await press('ArrowDown');
      await press('Enter');
      assert.deepEqual((await saved()).run.buildings.map(building => building.tile), [{ x: 5, y: 2 }, { x: 5, y: 4 }]);
      for (let step = 0; step < 10 && await focus() !== 'action'; step++) await press('Tab');
      assert.equal(await focus(), 'action');

      const timber = page.locator('#hand [data-card="timber"]');
      await timber.focus();
      const beforeTactic = await saved();
      await press('Enter');
      assert.equal((await saved()).run.wallet.wood, beforeTactic.run.wallet.wood + 2);
      assert.equal(await page.locator('#hand .card:focus').count(), 1);
      await page.locator('#hand [data-card="wall"]').click();
      assert.equal(await page.locator('#tiles button:focus').count(), 0, 'Mouse selection should leave the pointer in control.');
      await press('Escape');
      await button('开始战斗').focus();
      await press('Enter');
      await page.locator('#phase[data-phase="battle"]').waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  console.log(`${channel} ${browser.version()}: keyboard selection, pointer fallback, cancel, placement and battle at all three viewport widths.`);
} finally {
  await browser.close();
}
