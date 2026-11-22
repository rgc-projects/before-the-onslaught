import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const label = process.argv[2] ?? 'current';
assert.match(label, /^[a-z0-9-]+$/);
const cpuRate = Number(process.env.NINE_KINGDOMS_CPU_RATE ?? 1);
const frameRate = process.env.NINE_KINGDOMS_FRAME_RATE ?? '120';
assert.ok(Number.isInteger(cpuRate) && cpuRate >= 1, 'CPU throttle must be a positive integer');
assert.ok(['30', '60', '120', '144', 'display'].includes(frameRate), 'Invalid frame rate');

function summarize(profile, actual) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map(profile.nodes.flatMap(node => (node.children ?? []).map(id => [id, node.id])));
  const time = { simulation: 0, hud: 0, paint: 0, phaserRender: 0 };
  for (const [sample, id] of profile.samples.entries()) {
    const milliseconds = profile.timeDeltas[sample] / 1000;
    for (let current = id; current; current = parents.get(current)) {
      const { functionName: name, url } = nodes.get(current).callFrame;
      let category;
      if (url.includes('/systems/combat.ts') && name === 'tickBattle') category = 'simulation';
      else if (url.includes('/main.ts') && ['update', 'updateBattleCounters', 'updateInspect'].includes(name)) category = 'hud';
      else if (url.includes('/scenes/battlefield.ts') && name === 'paint') category = 'paint';
      else if (url.includes('phaser') && name === 'render') category = 'phaserRender';
      if (!category) continue;
      time[category] += milliseconds;
      break;
    }
  }
  const intervals = actual.paints.slice(1).map((value, index) => value - actual.paints[index]).sort((left, right) => left - right);
  assert.ok(intervals.length > 0);
  const fps = times => (times.length - 1) * 1000 / (times.at(-1) - times[0]);
  const drawPerFrame = (time.paint + time.phaserRender) / actual.paints.length;
  console.table({
    browserRaf: fps(actual.frames).toFixed(1), drawingFps: fps(actual.paints).toFixed(1),
    frameP95Ms: intervals[Math.ceil(intervals.length * .95) - 1].toFixed(1),
    intervalsOver50Ms: intervals.filter(value => value > 50).length,
    domMutations: actual.writes, textStrokes: actual.textStrokes, drawingStackMsPerFrame: drawPerFrame.toFixed(3),
    ...Object.fromEntries(Object.entries(time).map(([name, value]) => [`${name}StackMs`, value.toFixed(1)])),
  });
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  const { createRun, dispatch, step } = await server.ssrLoadModule('/src/core/game.ts');
  const { encodeCheckpoint } = await server.ssrLoadModule('/src/core/checkpoint.ts');
  const replay = JSON.parse(execFileSync(process.execPath, ['tools/sample-balance.mjs', '--replay=119:iron:rampart'], { encoding: 'utf8' }));
  const run = createRun(119, 'march', 'iron');
  let ready = false;
  for (const command of replay.commands) {
    if (run.wave === 4 && command.kind === 'start') {
      ready = true;
      break;
    }
    assert.ok(dispatch(run, command, []).ok);
    while (run.phase === 'battle') step(run, []);
  }
  assert.ok(ready);
  const saved = encodeCheckpoint(run);
  assert.ok(dispatch(run, { kind: 'start' }, []).ok);
  while (run.phase === 'battle') step(run, []);

  await server.listen();
  browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(({ saved, frameRate }) => {
    if (!localStorage.getItem('nine-kingdoms-run-v1')) localStorage.setItem('nine-kingdoms-run-v1', saved);
    localStorage.setItem('nine-kingdoms-settings', JSON.stringify({ frameRate, motion: 'full', muted: false, volume: 70 }));
    window.waveProfile = { paints: [], frames: [], writes: 0, textStrokes: 0 };
    const strokeText = CanvasRenderingContext2D.prototype.strokeText;
    CanvasRenderingContext2D.prototype.strokeText = function (...params) {
      window.waveProfile.textStrokes++;
      return strokeText.apply(this, params);
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...params) {
      if (source instanceof HTMLCanvasElement && this.canvas.parentElement?.id === 'field' && source.width === this.canvas.width
        && source.height === this.canvas.height && source.width > 300 && document.getElementById('phase')?.dataset.phase === 'battle') {
        window.waveProfile.paints.push(performance.now());
      }
      return draw.call(this, source, ...params);
    };
    window.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(records => {
        if (document.getElementById('phase')?.dataset.phase === 'battle') window.waveProfile.writes += records.length;
      }).observe(document.getElementById('app'), { attributes: true, childList: true, subtree: true, characterData: true });
    });
    const frame = time => {
      if (document.getElementById('phase')?.dataset.phase === 'battle') window.waveProfile.frames.push(time);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, { saved, frameRate });
  const cdp = await page.context().newCDPSession(page);
  if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
  await page.getByRole('button', { name: '继续战局', exact: true }).click();
  await page.evaluate(() => { window.waveProfile.textStrokes = 0; });
  await cdp.send('Profiler.start');
  await page.getByRole('button', { name: '开始战斗', exact: true }).click();
  await page.getByRole('heading', { name: '选择战利品', exact: true }).waitFor({ timeout: 50000 });
  const { profile } = await cdp.send('Profiler.stop');
  const actual = await page.evaluate(() => ({ ...window.waveProfile, result: JSON.parse(window.render_game_to_text()) }));
  assert.deepEqual([actual.result.keepHp, actual.result.defeated, actual.result.tick], [run.keepHp, run.defeated, run.tick]);
  await mkdir('test-results', { recursive: true });
  await writeFile(`test-results/wave5-${label}.cpuprofile`, JSON.stringify(profile));
  await writeFile(`test-results/wave5-${label}.json`, JSON.stringify(actual));
  summarize(profile, actual);
  console.log(`Wave 5 result at ${frameRate} FPS cap and CPU throttle ${cpuRate}×: ${actual.result.keepHp} life, ${actual.result.defeated} defeats, ${actual.result.tick} ticks.`);
} finally {
  await browser?.close();
  await server.close();
}
