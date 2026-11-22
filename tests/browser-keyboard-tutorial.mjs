import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';

const url = pathToFileURL(resolve(process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html')).href;
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
try {
  await mkdir('test-results', { recursive: true });
  const page = await browser.newPage({ offline: true, viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^(https?:|file:)/.test(request.url()) && request.url() !== url) errors.push(request.url()); });
  const press = key => page.keyboard.press(key);
  const focused = selector => page.evaluate(selector => document.activeElement.matches(selector), selector);
  const heading = name => page.getByRole('heading', { name, exact: true });
  const state = phase => page.locator(`#phase[data-phase="${phase}"]`);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('nine-kingdoms-run-v1'))?.run);
  async function tabTo(selector, direction = 'Tab') {
    for (let count = 0; count < 40 && !await focused(selector); count++) await press(direction);
    assert.equal(await focused(selector), true, `${direction} could not reach ${selector}`);
  }
  async function place(id, x, y) {
    await tabTo(`#hand [data-card="${id}"]`);
    await press('Enter');
    const match = await page.evaluate(() => document.activeElement.getAttribute('aria-label')?.match(/^(\d+)列(\d+)行 /));
    assert.ok(match, 'Choosing a card must focus the battlefield.');
    const [column, row] = match.slice(1).map(Number);
    for (let step = 0; step < Math.abs(x - column); step++) await press(x > column ? 'ArrowRight' : 'ArrowLeft');
    for (let step = 0; step < Math.abs(y - row); step++) await press(y > row ? 'ArrowDown' : 'ArrowUp');
    assert.equal(await page.locator('#placement-preview').getAttribute('data-valid'), 'yes');
    await press('Enter');
  }
  async function holdEnter() {
    // A second keydown without a keyup emulates the native repeat while focus moves.
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
  }
  async function startBattle(direction = 'Tab') {
    await tabTo('#action', direction);
    await press('Enter');
    await state('battle').waitFor();
  }

  await page.goto(url);
  await page.locator('#new-run').waitFor();
  assert.equal(await focused('#new-run'), true);
  await press('Enter');
  await page.getByRole('button', { name: '开始战斗', exact: true }).waitFor();
  await place('watch', 6, 3);
  await place('watch', 6, 5);
  await place('guard', 7, 4);
  await place('farm', 5, 2);
  await place('wall', 5, 5);
  assert.equal((await read()).buildings.length, 4);

  for (let wave = 0; wave < 3; wave++) {
    await startBattle();
    if (wave === 1) {
      await press('Escape');
      await heading('战斗已暂停').waitFor();
      assert.equal(await focused('#resume-battle'), true);
      await holdEnter();
      assert.equal(await page.locator('#overlay').isVisible(), false, 'Held Enter must not pause again after resuming.');
      assert.equal(await focused('#action'), true);
    }
    if (wave === 2) break;
    await heading('选择战利品').waitFor({ timeout: 45000 });
    if (wave === 0) {
      const beforeReload = await read();
      await page.reload();
      await page.locator('#continue-run').waitFor();
      assert.equal(await focused('#continue-run'), true);
      await press('Enter');
      await heading('选择战利品').waitFor();
      assert.deepEqual(await read(), beforeReload);
    }
    const offer = await read();
    await tabTo('[data-reward="watch"]');
    await holdEnter();
    assert.equal(await state('planning').isVisible(), true, 'Holding Enter on a reward must leave the next wave in preparation.');
    const next = await read();
    assert.equal(next.wave, wave + 1);
    assert.equal(next.hand[offer.hand.length], 'watch');
    assert.equal(next.pastWaves.length, wave + 1);
    assert.equal(await focused(`#hand [data-slot="${offer.hand.length}"][data-card="watch"]`), true);
    assert.match(await page.locator('#notice').innerText(), /已领取「松岗箭塔」/);
    if (wave === 0) await page.screenshot({ path: `test-results/keyboard-reward-${channel}.png` });
    await place('watch', wave === 0 ? 7 : 9, wave === 0 ? 3 : 5);
    if (wave === 1 && (await read()).keepHp < 30) {
      await tabTo('#hand [data-card="ember"]');
      await press('Enter');
    }
  }

  await heading('鸦渡守住了').waitFor({ timeout: 45000 });
  assert.match(await page.locator('#dialog-title + p').innerText(), /第 3 波 · 击退 27 名敌军/);
  assert.equal(await focused('#choose-expedition'), true);
  await tabTo('#retry');
  await holdEnter();
  assert.equal(await state('planning').isVisible(), true);
  assert.equal(await focused('#hand [data-slot="0"]'), true);
  assert.equal(await page.locator('#hand [aria-pressed="true"]').count(), 0);
  assert.equal((await read()).wave, 0);

  await startBattle('Shift+Tab');
  await heading('防线失守').waitFor({ timeout: 45000 });
  assert.equal(await focused('#retry'), true);
  await holdEnter();
  assert.equal(await state('planning').isVisible(), true);
  assert.equal(await focused('#hand [data-slot="0"]'), true);
  assert.equal(await page.locator('#hand [aria-pressed="true"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`${channel} ${browser.version()}: keyboard-only tutorial victory, reward resume, repeated Enter, defeat and restart passed at 390 px.`);
} finally {
  await browser.close();
}
