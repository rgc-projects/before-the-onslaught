import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const strategy = '119:iron:rampart';
const { stdout } = await promisify(execFile)(process.execPath, ['tools/sample-balance.mjs', `--replay=${strategy}`]);
const plan = JSON.parse(stdout);
assert.equal(plan.won, true);
assert.equal(plan.waves, 6);

const url = pathToFileURL(resolve(process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html')).href;
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const browser = await chromium.launch({ channel });
const directory = resolve('test-results', `session-soak-${channel}`);
await mkdir(directory, { recursive: true });
try {
  const page = await browser.newPage({ offline: true, viewport: { width: 1280, height: 720 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const errors = [];
  let navigations = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    if (request.isNavigationRequest()) navigations++;
    if (/^(https?:|file:)/.test(request.url()) && request.url() !== url) errors.push(request.url());
  });
  const saved = () => page.evaluate(() => ({
    primary: JSON.parse(localStorage.getItem('nine-kingdoms-run-v1')),
    backup: JSON.parse(localStorage.getItem('nine-kingdoms-run-backup-v1')),
    chronicle: JSON.parse(localStorage.getItem('nine-kingdoms-chronicle-v1')),
    settings: JSON.parse(localStorage.getItem('nine-kingdoms-settings')),
  }));
  const readRun = async () => (await saved()).primary?.run;
  const button = name => page.getByRole('button', { name, exact: true });
  const heading = name => page.getByRole('heading', { name, exact: true });
  const tile = ({ x, y }) => page.getByRole('button', { name: new RegExp(`^${x + 1}列${y + 1}行 `) });
  const action = page.locator('#action');
  const samples = [];
  async function measureBeforeBattle(nextRun) {
    assert.equal(await page.locator('#field canvas').count(), 1);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.locator('#phase').getAttribute('data-phase'), 'planning');
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const heap = metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
    assert.ok(Number.isFinite(heap) && heap > 0);
    const dom = await cdp.send('Memory.getDOMCounters');
    const sample = { nextRun, heapMiB: Number((heap / 2 ** 20).toFixed(3)), ...dom };
    samples.push(sample);
    console.log('Pre-battle memory after collection:', sample);
  }

  async function replayVictory() {
    let wave = 0;
    for (const command of plan.commands) {
      switch (command.kind) {
        case 'buy':
          await button('军令商店').click();
          await page.locator(`[data-offer="${command.card}"]`).click();
          await page.locator('#close-shop').click();
          break;
        case 'play':
          await page.locator(`#hand [data-slot="${command.slot}"]`).click();
          if (command.tile) await tile(command.tile).click();
          break;
        case 'upgrade': {
          const building = (await readRun()).buildings.find(item => item.id === command.id);
          assert.ok(building);
          await tile(building.tile).click();
          await page.locator('#upgrade').click();
          break;
        }
        case 'encounter':
          await page.locator('#encounter').click();
          await page.locator(`[data-choice="${command.choice}"]`).click();
          break;
        case 'start':
          await action.click();
          wave++;
          await heading(wave === plan.waves ? '远征告捷' : '选择战利品').waitFor({ timeout: 45000 });
          break;
        case 'reward':
          await page.locator(`[data-reward="${command.card}"]`).click();
          break;
        default:
          assert.fail(`Unsupported command: ${command.kind}`);
      }
    }
    assert.equal(wave, 6);
    assert.equal(await page.locator('#dialog-title + p').innerText(), `第 6 波 · 击退 ${plan.defeated} 名敌军 · 城堡生命 ${plan.hp}`);
  }

  async function readReport(runNumber, waves) {
    const [file] = await Promise.all([page.waitForEvent('download'), button('保存整局战报').click()]);
    const contents = await readFile(await file.path(), 'utf8');
    assert.match(contents, new RegExp(`记录 ${waves} / ${waves} 个已完成波次`));
    const frameRows = [...contents.matchAll(/实测 ([\d.]+) FPS · 帧间隔 P95 ([\d.]+) 毫秒 · 超过 50 毫秒 (\d+) 次 · 采样 ([\d.]+) 秒/g)]
      .map(([, fps, p95, stalls, seconds]) => ({ fps: Number(fps), p95: Number(p95), stalls: Number(stalls), seconds: Number(seconds) }));
    assert.equal(frameRows.length, waves);
    await writeFile(resolve(directory, `run-${runNumber}.txt`), contents);
    return frameRows;
  }

  const start = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
  await page.locator('#menu-settings').click();
  await page.getByLabel('帧率上限').selectOption('144');
  await page.locator('#record-frame-rate').check();
  await page.locator('#close-settings').click();
  await page.getByLabel('战役').selectOption('march');
  await page.getByLabel('王国', { exact: true }).selectOption(plan.kingdom);
  await page.getByLabel('战局种子').fill(String(plan.seed));
  await button('开始部署').click();
  const first = await saved();
  const expectedOpening = { ...first.primary.run, chronicleId: null };
  const records = [];
  const reports = [];
  let victories = 0;
  for (const won of [true, false, true, false, true]) {
    const opened = await saved();
    assert.deepEqual({ ...opened.primary.run, chronicleId: null }, expectedOpening);
    assert.deepEqual(opened.primary, opened.backup);
    assert.deepEqual(opened.settings, first.settings);
    const id = opened.primary.run.chronicleId;
    assert.ok(id && !records.includes(id));
    records.push(id);
    const runNumber = records.length;
    await measureBeforeBattle(runNumber);
    if (won) {
      await replayVictory();
      victories++;
    } else {
      await action.click();
      await heading('防线失守').waitFor({ timeout: 45000 });
      assert.match(await page.locator('#dialog-title + p').innerText(), /第 1 波 · 击退 0 名敌军 · 城堡生命 0/);
    }
    assert.equal(await page.locator('#merit-earned').innerText(), `远征功勋 +${won ? 3 : 1}`);
    const settled = await saved();
    assert.equal(settled.primary, null);
    assert.equal(settled.backup, null);
    assert.deepEqual(settled.chronicle, { version: 1, records: [...records], victories, expeditions: runNumber, merit: runNumber + 2 * victories });
    const frames = await readReport(runNumber, won ? 6 : 1);
    reports.push({ run: runNumber, won, frames });
    console.log(`Run ${runNumber}: ${won ? 'six-wave victory' : 'first-wave defeat'}, total merit ${settled.chronicle.merit}.`);
    if (runNumber === 5) await page.screenshot({ path: resolve(directory, 'last-victory.png') });
    await button('重开同一战局').press('Enter');
    await page.locator('#phase[data-phase="planning"]').waitFor();
  }
  await measureBeforeBattle(6);
  assert.deepEqual({ ...(await readRun()), chronicleId: null }, expectedOpening);
  assert.equal(navigations, 1);
  assert.deepEqual(errors, []);
  const result = { browser: `${channel} ${browser.version()}`, strategy, settings: first.settings,
    elapsedSeconds: Number(((Date.now() - start) / 1000).toFixed(1)), samples, reports, navigations, errors };
  await writeFile(resolve(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${result.elapsedSeconds}s in one tab, five expeditions and five restarts. Recorded ${reports.flatMap(report => report.frames).length} combat waves.`);
} finally {
  await browser.close();
}
