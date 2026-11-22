import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';
import { createServer } from 'vite';

const url = pathToFileURL(resolve('build/Nine Kingdoms.html')).href;
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
let browser;
try {
  const { createRun, dispatch, step } = await server.ssrLoadModule('/src/core/game.ts');
  const { encodeCheckpoint } = await server.ssrLoadModule('/src/core/checkpoint.ts');
  const run = createRun(0, 'march', 'iron');
  run.hand.push('medic', 'summoner');
  const initial = encodeCheckpoint(run);
  const layout = [['summoner', 6, 4], ['medic', 7, 4], ['guard', 5, 4], ['watch', 7, 2]];
  for (const [card, x, y] of layout) {
    assert.equal(dispatch(run, { kind: 'play', slot: run.hand.indexOf(card), tile: { x, y } }, []).ok, true);
  }
  assert.equal(dispatch(run, { kind: 'start' }, []).ok, true);
  const styles = new Set();
  const singleDamage = new Set();
  const groupedDamage = new Set();
  while (run.phase === 'battle') {
    const events = [];
    step(run, events);
    const hits = new Map();
    for (const event of events) {
      if (event.kind === 'support') styles.add(event.style);
      if (event.kind !== 'hit' || !event.hostile) continue;
      singleDamage.add(event.amount);
      const key = `${event.at.x}:${event.at.y}`;
      const group = hits.get(key) ?? [];
      group.push(event.amount);
      hits.set(key, group);
    }
    for (const group of hits.values()) if (group.length > 1) groupedDamage.add(group.reduce((sum, amount) => sum + amount, 0));
  }
  assert.equal(run.phase, 'reward');
  assert.deepEqual(styles, new Set(['summon', 'heal']));
  const combined = [...groupedDamage].find(amount => !singleDamage.has(amount));
  assert.ok(combined, 'The replay should include a damage total unique to simultaneous hits.');
  await mkdir('test-results', { recursive: true });
  const spearSource = `data:image/webp;base64,${(await readFile('assets/generated/spear-motion.webp')).toString('base64')}`;
  browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
  const results = [];
  for (const [cap, motion, stalled] of [['120', 'full', true], ['30', 'full'], ['120', 'full'], ['60', 'reduced'], ['60', 'off']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, offline: true });
    try {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^https?:|^file:/.test(request.url()) && request.url() !== url) errors.push(request.url()); });
      await page.addInitScript(({ checkpoint, stalled, spearSource, combined }) => {
        localStorage.setItem('nine-kingdoms-run-v1', checkpoint);
        const info = window.supportProbe = {
          heal: { rings: 0, arcs: 0, spark: new Set() }, summon: { rings: 0, arcs: 0, spark: new Set() }, sound: new Set(),
          attackStarts: 0, spearCels: 0,
          numbers: { combined: false, heals: 0, maximum: 0, overlaps: 0, clipped: 0 },
        };
        const numberSources = new WeakMap();
        let numbersThisFrame = [];
        const strokeText = CanvasRenderingContext2D.prototype.strokeText;
        CanvasRenderingContext2D.prototype.strokeText = function (label, x, y, ...rest) {
          if (/^[−+]\d+$/.test(label)) numberSources.set(this.canvas, { label, color: this.fillStyle });
          return strokeText.call(this, label, x, y, ...rest);
        };
        const imageKinds = new WeakMap();
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (source, ...params) {
          if (source instanceof HTMLImageElement) {
            if (!imageKinds.has(source)) imageKinds.set(source, source.src === spearSource);
            if (imageKinds.get(source)) info.spearCels++;
          }
          if (source instanceof HTMLCanvasElement && this.canvas.parentElement?.id === 'field') {
            const amount = numberSources.get(source);
            if (!amount) numbersThisFrame = [];
            else {
              const [x, y] = params;
              const bounds = { left: x + 3, top: y + 3, right: x + source.width - 3, bottom: y + 20 };
              if (numbersThisFrame.some(rect => bounds.left < rect.right && rect.left < bounds.right
                && bounds.top < rect.bottom && rect.top < bounds.bottom)) info.numbers.overlaps++;
              numbersThisFrame.push(bounds);
              info.numbers.maximum = Math.max(info.numbers.maximum, numbersThisFrame.length);
              if (bounds.left < 0 || bounds.top < 0 || bounds.right > this.canvas.width || bounds.bottom > this.canvas.height) info.numbers.clipped++;
              if (amount.label === `−${combined}` && amount.color === '#ffb6a1') info.numbers.combined = true;
              if (amount.label.startsWith('+')) info.numbers.heals++;
            }
          }
          return draw.call(this, source, ...params);
        };
        if (stalled) {
          const nativeRequest = window.requestAnimationFrame.bind(window);
          const nativeCancel = window.cancelAnimationFrame.bind(window);
          const delayed = new Map();
          let next = 0;
          window.requestAnimationFrame = callback => {
            if (document.getElementById('phase')?.dataset.phase !== 'battle') return nativeRequest(callback);
            const id = --next;
            delayed.set(id, setTimeout(() => {
              delayed.delete(id);
              callback(performance.now());
            }, 235));
            return id;
          };
          window.cancelAnimationFrame = id => {
            if (id >= 0) nativeCancel(id);
            else if (delayed.has(id)) {
              clearTimeout(delayed.get(id));
              delayed.delete(id);
            }
          };
          const attackInk = new Set(['#ffe2a2', '#e6ca93', '#ccadff', '#ffad72']);
          const nativeArc = CanvasRenderingContext2D.prototype.arc;
          CanvasRenderingContext2D.prototype.arc = function (x, y, radius, ...args) {
            if (this.canvas.parentElement?.id === 'field' && radius === 5 && attackInk.has(this.strokeStyle)) info.attackStarts++;
            return nativeArc.call(this, x, y, radius, ...args);
          };
        }
        const kind = (ctx, color) => ctx.canvas.parentElement?.id === 'field'
          ? color === '#b7efa0' ? 'heal' : color === '#d7baff' ? 'summon' : undefined : undefined;
        const nativeEllipse = CanvasRenderingContext2D.prototype.ellipse;
        CanvasRenderingContext2D.prototype.ellipse = function (...args) {
          const style = kind(this, this.strokeStyle);
          if (style) info[style].rings++;
          return nativeEllipse.apply(this, args);
        };
        const nativeCurve = CanvasRenderingContext2D.prototype.quadraticCurveTo;
        CanvasRenderingContext2D.prototype.quadraticCurveTo = function (...args) {
          const style = kind(this, this.strokeStyle);
          if (style) info[style].arcs++;
          return nativeCurve.apply(this, args);
        };
        const nativeFill = CanvasRenderingContext2D.prototype.fillRect;
        CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
          const style = width === 4 && height === 4 ? kind(this, this.fillStyle) : undefined;
          if (style) info[style].spark.add(`${x}:${y}`);
          return nativeFill.call(this, x, y, width, height);
        };
        const nativeSound = AudioParam.prototype.setValueAtTime;
        AudioParam.prototype.setValueAtTime = function (value, time) {
          if (value === 296 || value === 444) info.sound.add(value);
          return nativeSound.call(this, value, time);
        };
      }, { checkpoint: initial, stalled, spearSource, combined });
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
      await page.locator('#menu-settings').click();
      await page.locator('#frame-rate').selectOption(cap);
      await page.locator('#motion').selectOption(motion);
      await page.locator('#close-settings').click();
      await page.getByRole('button', { name: '继续战局', exact: true }).click();
      for (const [card, x, y] of layout) {
        await page.locator(`#hand [data-card="${card}"]`).first().click();
        await page.getByRole('button', { name: new RegExp(`^${x + 1}列${y + 1}行 `) }).click();
      }
      await page.getByRole('button', { name: '开始战斗', exact: true }).click();
      if (stalled) {
        await page.waitForFunction(() => window.supportProbe.attackStarts > 0, undefined, { polling: 20 });
        await page.locator('#field canvas').screenshot({ path: `test-results/stalled-attack-${channel}.png` });
      } else if (cap === '120') {
        await page.waitForFunction(() => window.supportProbe.heal.arcs > 2 && window.supportProbe.summon.arcs > 2);
        await page.screenshot({ path: `test-results/support-cast-${channel}.png` });
      } else if (motion === 'reduced') {
        await page.waitForFunction(() => window.supportProbe.numbers.combined, undefined, { polling: 20 });
        await page.locator('#field canvas').screenshot({ path: `test-results/combined-damage-${channel}.png` });
      }
      await page.getByRole('heading', { name: '选择战利品', exact: true }).waitFor({ timeout: 60000 });
      const observed = await page.evaluate(() => {
        const { heal, summon, sound, attackStarts, spearCels, numbers } = window.supportProbe;
        const state = JSON.parse(localStorage.getItem('nine-kingdoms-run-v1')).run;
        return { heal: { ...heal, spark: heal.spark.size }, summon: { ...summon, spark: summon.spark.size }, sound: [...sound],
          keepHp: state.keepHp, defeated: state.defeated, waveReport: state.waveReport, rewards: state.rewards, attackStarts, spearCels, numbers };
      });
      if (stalled) assert.ok(observed.attackStarts > 0, 'New attack animations should draw their opening after a delayed frame.');
      assert.equal(observed.spearCels > 0, motion === 'full', 'Summoned spearmen use the clip only in full motion.');
      for (const style of ['heal', 'summon']) {
        assert.equal(observed[style].rings > 0, motion !== 'off');
        assert.equal(observed[style].arcs > 0, motion === 'full');
        if (stalled) assert.ok(observed[style].spark > 0, `${style} particles should still appear at the slower cadence.`);
        else assert.equal(observed[style].spark >= 4, motion === 'full');
      }
      assert.deepEqual(observed.sound.sort(), [296, 444]);
      assert.equal(observed.numbers.combined, motion !== 'off');
      assert.equal(observed.numbers.heals > 0, motion !== 'off');
      assert.equal(observed.numbers.overlaps, 0, 'Rendered numbers should stay separate in this replay.');
      assert.equal(observed.numbers.clipped, 0, 'Rendered numbers should stay within the board.');
      assert.equal(observed.keepHp, run.keepHp);
      assert.equal(observed.defeated, run.defeated);
      assert.deepEqual(observed.waveReport, run.waveReport);
      assert.deepEqual(observed.rewards, run.rewards);
      assert.deepEqual(errors, []);
      results.push({ cap, motion, delayedFrameMs: stalled ? 235 : null, attackStarts: stalled ? observed.attackStarts : null,
        healArcs: observed.heal.arcs, summonArcs: observed.summon.arcs, summonRings: observed.summon.rings,
        spearCels: observed.spearCels, maxNumbers: observed.numbers.maximum, keepHp: observed.keepHp, defeated: observed.defeated });
    } finally {
      await page.close();
    }
  }
  console.log(`${channel} ${browser.version()}: offline attack feedback after stalls, support cues, motion levels and equal battle results passed.`);
  console.table(results);
} finally {
  await browser?.close();
  await server.close();
}
