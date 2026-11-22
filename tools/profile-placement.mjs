import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const builds = process.argv.slice(2);
assert.ok(builds.length, 'Pass one or more offline HTML builds.');
const repetitions = 5;
const cpuRate = 8;
const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
let browser;
try {
  const { createRun, dispatch, step } = await server.ssrLoadModule('/src/core/game.ts');
  const { encodeCheckpoint } = await server.ssrLoadModule('/src/core/checkpoint.ts');
  const { commands } = JSON.parse(execFileSync(process.execPath, ['tools/sample-balance.mjs', '--replay=119:iron:rampart'], { encoding: 'utf8' }));
  const run = createRun(119, 'march', 'iron');
  for (const command of commands) {
    if (run.wave === 5) break;
    assert.ok(dispatch(run, command, []).ok);
    while (run.phase === 'battle') step(run, []);
  }
  assert.equal(run.wave, 5);
  assert.equal(run.phase, 'planning');
  run.chronicleId = '00000000000000000000000000000119';
  run.hand.unshift('watch');
  const saved = encodeCheckpoint(run);
  assert.ok(saved);
  browser = await chromium.launch({ channel: 'msedge' });
  const measurements = [];
  let reference;
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const path of builds) {
      const page = await browser.newPage({ offline: true, viewport: { width: 1280, height: 800 } });
      try {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        await page.addInitScript(checkpoint => localStorage.setItem('nine-kingdoms-run-v1', checkpoint), saved);
        await page.goto(pathToFileURL(resolve(path)).href);
        await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
        await page.getByRole('button', { name: '继续战局', exact: true }).click();
        await page.locator('#hand [data-slot="0"]').click();
        const sample = await page.evaluate(() => {
          const preview = document.getElementById('placement-preview');
          const tiles = [...document.querySelectorAll('#tiles button')]
            .filter(tile => /^(?:[5-9]|1\d)列\d行 草地/.test(tile.getAttribute('aria-label')));
          const enter = new PointerEvent('pointerenter');
          const leave = new PointerEvent('pointerleave');
          const outputs = [];
          const cold = [];
          const warm = [];
          for (let pass = 0; pass < 6; pass++) {
            for (const [index, tile] of tiles.entries()) {
              const start = performance.now();
              tile.dispatchEvent(enter);
              (pass ? warm : cold).push(performance.now() - start);
              const output = [tile.getAttribute('aria-label'), preview.textContent, preview.dataset.valid];
              if (pass === 0) outputs.push(output);
              else if (output.some((value, field) => value !== outputs[index][field])) throw new Error('An unchanged tile preview varied.');
              tile.dispatchEvent(leave);
            }
          }
          const total = data => data.reduce((sum, duration) => sum + duration, 0);
          const p95 = data => data.toSorted((left, right) => left - right)[Math.ceil(data.length * 0.95) - 1];
          return { outputs, coldMs: total(cold), warmMs: total(warm) / 5, coldP95Ms: p95(cold), warmP95Ms: p95(warm) };
        });
        reference ??= sample.outputs;
        assert.deepEqual(sample.outputs, reference);
        assert.deepEqual(errors, []);
        const after = await page.evaluate(() => localStorage.getItem('nine-kingdoms-run-v1'));
        assert.equal(after, saved);
        const { outputs, ...timings } = sample;
        assert.ok(outputs.filter(([, , valid]) => valid === 'yes').length > 8);
        measurements.push({ path, ...timings });
      } finally {
        await page.close();
      }
    }
  }
  const median = values => Number(values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)].toFixed(2));
  console.log(`Edge ${browser.version()}, CPU ${cpuRate}×, wave 6 with ${run.buildings.length} buildings and ${run.rally.length} rallies. ${reference.length} tiles per pass, ${repetitions} runs per build.`);
  console.table(builds.map(path => {
    const samples = measurements.filter(row => row.path === path);
    return { path, ...Object.fromEntries(['coldMs', 'warmMs', 'coldP95Ms', 'warmP95Ms'].map(key => [key, median(samples.map(row => row[key]))])) };
  }));
} finally {
  await browser?.close();
  await server.close();
}
