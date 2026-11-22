import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const local = { host: '127.0.0.1', port: 0 };
const dev = await createServer({ server: local });
let release;
let browser;
const url = server => `http://127.0.0.1:${server.httpServer.address().port}/`;

try {
  await dev.listen();
  release = await preview({ preview: local });
  browser = await chromium.launch({
    channel: 'msedge',
    headless: false,
    args: ['--window-size=1280,900'],
    ignoreDefaultArgs: ['--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: null });
  const game = await context.newPage();
  const other = await context.newPage();
  const gameSession = await context.newCDPSession(game);
  const otherSession = await context.newCDPSession(other);
  // Playwright enables focus emulation by default, even in a normal browser window.
  await gameSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await otherSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const { windowId } = await gameSession.send('Browser.getWindowForTarget');
  assert.equal((await otherSession.send('Browser.getWindowForTarget')).windowId, windowId);

  await game.addInitScript(() => {
    const nativeDraw = CanvasRenderingContext2D.prototype.drawImage;
    const NativeAudioContext = AudioContext;
    window.focusProbe = { paints: 0 };
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (this.canvas.parentElement?.id === 'field' && image instanceof HTMLCanvasElement
        && image.width === this.canvas.width && image.height === this.canvas.height) {
        const probe = window.focusProbe;
        probe.paints++;
        if (probe.measureResume && !probe.firstResume && !document.hidden && document.hasFocus()) {
          const run = window.render_game_to_text?.();
          if (!run || JSON.parse(run).tick > probe.resumeAfter) {
            probe.firstResume = { run, wait: performance.now() - probe.returnedAt };
          }
        }
      }
      return nativeDraw.call(this, image, ...args);
    };
    window.AudioContext = class extends NativeAudioContext {
      createGain() {
        const node = super.createGain();
        window.focusProbe.master ??= node.gain;
        window.focusProbe.audio ??= this;
        return node;
      }
    };
    window.addEventListener('focus', () => {
      if (window.focusProbe.measureResume) window.focusProbe.returnedAt = performance.now();
    });
  });

  const awaitFocus = focused => game.waitForFunction(wanted =>
    (document.hasFocus() && !document.hidden) === wanted, focused, { polling: 25, timeout: 5000 });
  const status = () => game.evaluate(() => {
    const { paints, master } = window.focusProbe;
    return {
      hidden: document.hidden, volume: master.value, paints,
      phase: document.getElementById('phase').dataset.phase,
      keep: document.getElementById('res-hp').textContent,
      defeated: document.getElementById('defeated').textContent,
      remaining: document.getElementById('enemies-left').textContent,
      run: window.render_game_to_text?.(),
    };
  });
  async function open(server) {
    await game.bringToFront();
    await game.goto(url(server));
    await awaitFocus(true);
  }
  async function beginBattle() {
    await game.locator('#action').click();
    await game.waitForFunction(() =>
      document.getElementById('phase').dataset.phase === 'battle' &&
      window.focusProbe.paints >= 8 &&
      (!window.render_game_to_text || JSON.parse(window.render_game_to_text()).tick >= 6) &&
      window.focusProbe.master?.value > 0 && window.focusProbe.audio?.state === 'running');
  }
  async function awaitVolume(volume) {
    await game.waitForFunction(expected => window.focusProbe.master?.value === expected, volume, { polling: 25, timeout: 5000 });
  }
  async function verifyFreeze(hide, reveal, seconds) {
    const active = await status();
    await hide();
    await awaitFocus(false);
    await awaitVolume(0);
    const { hidden: hiddenReported, ...frozen } = await status();
    assert.equal(frozen.phase, 'battle');
    const heldAt = performance.now();
    await delay(seconds * 1000);
    const { hidden: finalVisibility, ...afterWait } = await status();
    assert.deepEqual(afterWait, frozen);
    const tickBefore = frozen.run ? JSON.parse(frozen.run).tick : null;
    await game.evaluate(tick => {
      window.focusProbe.resumeAfter = tick;
      window.focusProbe.measureResume = true;
      window.focusProbe.firstResume = undefined;
    }, tickBefore);
    const heldMs = performance.now() - heldAt;
    await reveal();
    await awaitFocus(true);
    await awaitVolume(active.volume);
    const first = await game.waitForFunction(() => window.focusProbe.firstResume, undefined, { timeout: 5000 });
    const resumed = await first.jsonValue();
    assert.ok(resumed.wait >= 75, `The first simulation step arrived ${resumed.wait} ms after focus`);
    if (tickBefore !== null) assert.equal(JSON.parse(resumed.run).tick, tickBefore + 1);
    return { hiddenReported: hiddenReported || finalVisibility, heldMs, firstStepMs: Math.round(resumed.wait),
      tickBefore };
  }

  await open(dev);
  await game.locator('#new-run').click();
  await beginBattle();
  const tab = await verifyFreeze(() => other.bringToFront(), () => game.bringToFront(), 5);
  console.log(`Edge ${browser.version()} development tab switch:`, tab);

  await game.locator('#action').click();
  const paused = await status();
  assert.equal(JSON.parse(paused.run).paused, true);
  await other.bringToFront();
  await awaitFocus(false);
  await awaitVolume(0);
  await delay(500);
  await game.bringToFront();
  await awaitFocus(true);
  await awaitVolume(paused.volume);
  await delay(350);
  assert.equal((await status()).run, paused.run);
  await game.locator('#overlay').getByRole('button', { name: '继续战斗', exact: true }).click();
  await game.waitForFunction(tick => JSON.parse(window.render_game_to_text()).tick > tick, JSON.parse(paused.run).tick);

  await open(release);
  await game.locator('#menu-settings').click();
  // With motion off, an unchanged battle board waits for the next simulation step.
  await game.locator('#motion').selectOption('off');
  await game.locator('#frame-rate').selectOption('30');
  await game.locator('#record-frame-rate').check();
  await game.locator('#close-settings').click();
  await game.getByLabel('战役').selectOption('march');
  await game.getByLabel('王国', { exact: true }).selectOption('iron');
  await game.getByLabel('战局种子').fill('119');
  await game.locator('#new-run').click();
  for (const [card, column, row] of [['watch', 6, 3], ['watch', 6, 5], ['farm', 5, 2], ['guard', 8, 4]]) {
    await game.locator(`#hand [data-card="${card}"]`).first().click();
    await game.getByRole('button', { name: new RegExp(`^${column}列${row}行 `) }).click();
  }
  await game.getByLabel('守军阵势').selectOption('bank');

  const readSave = () => game.evaluate(() => ({
    primary: localStorage.getItem('nine-kingdoms-run-v1'),
    backup: localStorage.getItem('nine-kingdoms-run-backup-v1'),
    settings: localStorage.getItem('nine-kingdoms-settings'),
  }));
  const beforeBattle = await readSave();
  const plan = JSON.parse(beforeBattle.primary);
  assert.equal(plan.run.phase, 'planning');
  assert.equal(plan.run.buildings.length, 3);
  assert.equal(plan.run.rally.length, 1);
  assert.equal(plan.run.formation, 'bank');

  await beginBattle();
  await other.bringToFront();
  await awaitFocus(false);
  await awaitVolume(0);
  assert.deepEqual(await readSave(), beforeBattle);
  await game.reload();
  await game.bringToFront();
  await awaitFocus(true);
  await game.locator('#continue-run').click();
  assert.equal(await game.locator('#phase').getAttribute('data-phase'), 'planning');
  assert.equal(await game.getByLabel('守军阵势').inputValue(), 'bank');
  assert.deepEqual(await readSave(), beforeBattle);

  const battleStarted = performance.now();
  await beginBattle();
  assert.equal((await status()).run, undefined);
  const setWindow = windowState => gameSession.send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
  const minimized = await verifyFreeze(async () => {
    await setWindow('minimized');
    const { bounds } = await gameSession.send('Browser.getWindowBounds', { windowId });
    assert.equal(bounds.windowState, 'minimized');
  }, async () => {
    await setWindow('normal');
    await game.bringToFront();
  }, 5);
  console.log(`Edge ${browser.version()} production minimize and restore:`, minimized);
  // Native focus and the first resumed step have been verified. Keep the test
  // tab focused for the rest of the fight even if another desktop window opens.
  await gameSession.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await awaitFocus(true);
  const reward = game.getByRole('heading', { name: '选择战利品', exact: true });
  try {
    await reward.waitFor({ timeout: 25000 });
  } catch (error) {
    console.error('Production battle did not reach its expected reward:', await status(), await game.evaluate(() => ({
      focused: document.hasFocus(), heading: document.getElementById('dialog-title')?.textContent,
    })));
    throw error;
  }
  const wallMs = performance.now() - battleStarted;
  const won = await readSave();
  const checkpoint = JSON.parse(won.primary);
  assert.equal(checkpoint.run.phase, 'reward');
  assert.equal(checkpoint.run.wave, 0);
  assert.equal(won.primary, won.backup);
  assert.equal(won.settings, beforeBattle.settings);
  assert.equal(checkpoint.frameHistory.length, 1);
  const [{ wave, samples }] = checkpoint.frameHistory;
  assert.equal(wave, 0);
  for (const sample of samples) {
    assert.equal(sample.cap, '30');
    assert.equal(sample.motion, 'off');
  }
  const sampledSeconds = samples.reduce((total, sample) => total + sample.seconds, 0);
  assert.ok(sampledSeconds > 0 && sampledSeconds * 1000 <= wallMs - minimized.heldMs,
    `The saved report counted ${sampledSeconds}s of an ${(wallMs / 1000).toFixed(2)}s fight with ${(minimized.heldMs / 1000).toFixed(2)}s inactive`);

  async function downloadReport() {
    const pending = game.waitForEvent('download');
    await game.locator('#save-wave-report').click();
    const download = await pending;
    return readFile(await download.path(), 'utf8');
  }
  const report = await downloadReport();
  for (const sample of samples) assert.ok(report.includes(`采样 ${sample.seconds.toFixed(2)} 秒`));
  await game.reload();
  await game.locator('#continue-run').click();
  await reward.waitFor();
  assert.deepEqual(await readSave(), won);
  assert.equal(await downloadReport(), report);
  console.log('Foreground test passed: paused battle and audio, recovered planning, and restored the same frame report.', {
    wallSeconds: Number((wallMs / 1000).toFixed(2)), sampledSeconds: Number(sampledSeconds.toFixed(2)),
  });
} finally {
  await browser?.close();
  await dev.close();
  if (release) await new Promise((resolve, reject) => release.httpServer.close(error => error ? reject(error) : resolve()));
}
