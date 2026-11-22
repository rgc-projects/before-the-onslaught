import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium, firefox } from 'playwright';
import { createServer, preview } from 'vite';

const scenarios = ['119:iron:rampart', '0:arcane:ritual', '109:wild:field_army', '197:war:field_army', '322:tide:field_army'];
const chosen = process.argv[2];
const review = chosen === 'review';
const supplyReview = chosen === 'supply';
const farmOrder = chosen === 'farm';
const formationReview = chosen === 'formation';
const formationAdviceReview = chosen === 'formation-advice';
const bossPacing = chosen === 'boss-pacing';
const cavalryReview = chosen === 'cavalry';
const formationPlanReview = formationAdviceReview || bossPacing || cavalryReview;
const musterReview = chosen === 'muster';
const relicReview = chosen === 'relic';
const spearReview = chosen === 'spears';
const offline = process.argv.includes('--offline');
const frameHistoryReview = process.argv.includes('--frame-history');
const frameSwitchReview = process.argv.includes('--switch-frame-rates');
const selected = cavalryReview ? ['48401:war:garrison'] : bossPacing ? ['11532:wild:garrison']
  : formationAdviceReview ? ['119:iron:garrison'] : spearReview ? ['109:wild:garrison'] : relicReview ? ['0:arcane:ritual'] : musterReview ? ['23:arcane:garrison'] : formationReview ? ['119:war:garrison'] : farmOrder ? ['42:war:garrison']
  : review || supplyReview ? ['119:war:field_army'] : scenarios.filter(scenario => !chosen || scenario.split(':')[1] === chosen);
assert.ok(selected.length, `Unknown kingdom ${chosen}`);
const production = offline || process.env.NINE_KINGDOMS_PRODUCTION === '1';
assert.ok(!frameHistoryReview || (bossPacing && production), 'Use --frame-history with the production boss-pacing replay.');
assert.ok(!frameSwitchReview || (chosen === 'iron' && production), 'Use --switch-frame-rates with the production iron replay.');
const dist = process.env.NINE_KINGDOMS_DIST;
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
const frameRate = frameSwitchReview ? '60' : process.env.NINE_KINGDOMS_FRAME_RATE;
const cpuRate = Number(process.env.NINE_KINGDOMS_CPU_RATE ?? 1);
assert.ok(!frameRate || ['30', '60', '120', '144', 'display'].includes(frameRate), 'Invalid frame rate');
assert.ok(Number.isInteger(cpuRate) && cpuRate >= 1 && (cpuRate === 1 || channel !== 'firefox'), 'CPU throttling requires Chromium');
const profile = production && Boolean(frameRate);
const suffix = production ? `-${offline ? 'offline' : 'release'}-${channel}${frameSwitchReview ? '-switch-fps' : frameRate ? `-${frameRate}` : ''}${cpuRate > 1 ? `-cpu${cpuRate}` : ''}` : '';
const runFile = promisify(execFile);
const plans = await Promise.all(selected.map(async scenario => {
  const options = farmOrder || formationReview || formationPlanReview || musterReview || spearReview
    ? ['--bridge-towers', '--order-farms', '--supply-rations'] : [];
  if (formationReview || musterReview || spearReview) options.push('--formation=inner');
  if (formationPlanReview) options.push('--formation-plan=2:bank,3:advance,4:bank,5:inner');
  if (musterReview) options.push('--clear-muster');
  if (relicReview) options.push('--trade-relic');
  const { stdout } = await runFile(process.execPath, ['tools/sample-balance.mjs', `--replay=${scenario}`, ...options]);
  const plan = JSON.parse(stdout);
  assert.ok(review || supplyReview ? !plan.won && plan.waves === 5 : plan.won && plan.waves === 6, `Reference run changed for ${scenario}`);
  return plan;
}));
const base = production ? '/nine-kingdoms/' : '/';
const local = { host: '127.0.0.1', port: 0 };
await mkdir('test-results', { recursive: true });
const isolated = offline ? await mkdtemp(resolve('test-results', '独立试玩 ')) : undefined;
const file = isolated && join(isolated, 'Nine Kingdoms.html');
if (file) await copyFile(process.env.NINE_KINGDOMS_PLAYTEST ?? 'build/Nine Kingdoms.html', file);
const server = offline ? undefined : production ? await preview({ base, preview: local, build: { outDir: dist ?? 'dist' } }) : await createServer({ server: local });
if (!production) await server.listen();
const url = file ? pathToFileURL(file).href : `http://127.0.0.1:${server.httpServer.address().port}${base}`;

function readStable(page) {
  return page.evaluate(release => release
    ? JSON.parse(localStorage.getItem('nine-kingdoms-run-v1'))?.run
    : JSON.parse(window.render_game_to_text()), production);
}

async function checkDamageBreakdown(report, sources) {
  assert.ok(sources.length > 0);
  const list = report.getByRole('list', { name: '城堡伤害来源' });
  const displayed = await list.getByRole('listitem').evaluateAll(items => items.map(item => {
    const detail = item.querySelector('.wave-damage-detail').textContent;
    const [, damage, hits] = detail.match(/^(\d+) 生命 · (\d+) 次命中$/);
    return { enemy: item.dataset.enemy, damage: Number(damage), hits: Number(hits) };
  }));
  assert.deepEqual(displayed, [...sources].sort((a, b) => b.damage - a.damage));
}

async function checkEnemyBriefing(page, { name, count, seconds, ability, stats, screenshot }) {
  const before = await readStable(page);
  const entry = page.getByRole('list', { name: '本波敌军' }).getByRole('button', { name: `${name} ${count}`, exact: true });
  const dialog = page.getByRole('dialog', { name, exact: true });
  const back = dialog.getByRole('button', { name: '返回备战', exact: true });
  await entry.press('Enter');
  await back.waitFor();
  assert.equal(await back.evaluate(element => document.activeElement === element), true);
  const details = await dialog.innerText();
  assert.ok(details.includes(`本波 ${count} 名 · 开战后 ${seconds} 秒首次入场`));
  assert.match(details, ability);
  assert.match(details, stats);
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (screenshot) {
    await page.screenshot({ path: screenshot });
    await back.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await entry.evaluate(element => document.activeElement === element), true);
  assert.deepEqual(await readStable(page), before);
}

async function checkLiveBattle(page) {
  const roster = page.locator('#enemy-roster');
  const marshal = roster.locator('[data-enemy="marshal"] button');
  const marker = page.locator('#tiles [data-battle-inspect]');
  const title = page.locator('#inspect-title');
  assert.match(await page.locator('#enemy-roster-key').innerText(), /在场 \/ 待入场/);
  assert.equal(await marshal.locator('b').innerText(), '0 / 1');
  assert.equal(await marshal.isDisabled(), true);
  await marshal.evaluate(button => button.click());
  assert.equal(await title.innerText(), '战场详情');
  await roster.locator('[data-enemy="marshal"] b').filter({ hasText: /^1 \/ 0$/ }).waitFor();
  assert.equal(await marshal.isEnabled(), true);
  await marshal.focus();
  await page.keyboard.press('Enter');
  assert.equal(await marshal.getAttribute('aria-current'), 'true');
  assert.equal(await title.innerText(), '断桥元帅');
  assert.match(await page.locator('#inspect-text').innerText(), /敌军 · 生命 \d+ \/ 88.*半血反击/);
  const firstCell = await marker.getAttribute('aria-label');
  await page.waitForFunction(first => {
    const selected = document.querySelector('#tiles [data-battle-inspect]');
    return selected && selected.getAttribute('aria-label') !== first;
  }, firstCell);
  assert.equal(await title.innerText(), '断桥元帅');
  assert.equal(await marshal.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => {
    const totals = Array.from(document.querySelectorAll('#enemy-roster b')).flatMap(node => node.textContent.split(' / ').map(Number));
    return totals.reduce((sum, count) => sum + count, 0) === Number(document.querySelector('#enemies-left').textContent.split(' ').at(-1));
  }), true);
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: '战斗已暂停' });
  await pause.waitFor();
  assert.equal(await title.innerText(), '断桥元帅');
  await pause.getByRole('button', { name: '继续战斗', exact: true }).click();
  assert.equal(await title.innerText(), '断桥元帅');
  assert.equal(await marshal.evaluate(element => element === document.activeElement), true);
}

async function prioritizeBarracks(page, viewport) {
  const before = await readStable(page);
  assert.equal(before.supplyPriority, null);
  const barracks = before.buildings.find(item => item.def === 'barracks');
  assert.ok(barracks);
  const entry = page.getByRole('button', { name: '军粮分配', exact: true });
  const dialog = page.getByRole('dialog', { name: '军粮分配', exact: true });
  const summary = dialog.getByRole('status');
  const favorite = dialog.locator(`[data-supply-priority="${barracks.id}"]`);
  const effects = dialog.locator(`[data-supply-effect="${barracks.id}"]`);
  const compare = effects.locator('summary');
  const back = dialog.getByRole('button', { name: '返回备战', exact: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await entry.click();
  assert.match(await summary.innerText(), /可用 9 食物 · 全员需 14 食物 · 预计出阵 6 \/ 11 支/);
  assert.match(await dialog.locator(`#supply-group-${barracks.id}`).innerText(), /预计出阵 0 \/ 2 支/);
  assert.equal(await compare.innerText(), '优先后全军出阵 6 → 8 支');
  await compare.press('Enter');
  assert.equal(await effects.getAttribute('open'), '');
  assert.match(await effects.innerText(), /全军耗粮 9 食物/);
  assert.match(await effects.innerText(), /砾脊巨人 第 5 列第 4 行 · 1 → 0 支/);
  assert.match(await effects.innerText(), /鸢尾矛兵 第 8 列第 4 行 · 0 → 2 支/);
  assert.match(await effects.innerText(), /雾林弓手 第 8 列第 5 行 · 0 → 1 支/);
  assert.deepEqual(await readStable(page), before);
  await page.waitForFunction(id => {
    const details = document.querySelector(`[data-supply-effect="${id}"]`);
    const visible = details.closest('.supply-list').getBoundingClientRect();
    const contents = details.getBoundingClientRect();
    return contents.top >= visible.top && contents.bottom <= visible.bottom + 1;
  }, barracks.id);
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await back.evaluate(button => {
    const visible = button.getBoundingClientRect();
    const dialog = button.closest('dialog').getBoundingClientRect();
    return visible.top >= dialog.top && visible.bottom <= dialog.bottom;
  }), true);
  await page.screenshot({ path: `test-results/march-supply-preview${suffix}.png`, fullPage: true });
  await favorite.focus();
  await page.keyboard.press('Enter');
  assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
  assert.equal(await favorite.evaluate(element => element === document.activeElement), true);
  assert.match(await summary.innerText(), /可用 9 食物 · 全员需 14 食物 · 预计出阵 8 \/ 11 支/);
  assert.match(await dialog.locator(`#supply-group-${barracks.id}`).innerText(), /预计出阵 2 \/ 2 支/);
  assert.equal(await compare.innerText(), '取消后全军出阵 8 → 6 支');
  await page.screenshot({ path: `test-results/march-supply${suffix}.png`, fullPage: true });

  await page.keyboard.press('Enter');
  assert.equal(await favorite.getAttribute('aria-pressed'), 'false');
  assert.equal((await readStable(page)).supplyPriority, null);
  await page.keyboard.press('Enter');
  const revised = await readStable(page);
  assert.equal(revised.supplyPriority, barracks.id);
  assert.deepEqual(revised.wallet, before.wallet);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await entry.evaluate(element => element === document.activeElement), true);

  await page.reload();
  await page.getByRole('button', { name: '继续战局', exact: true }).click();
  assert.equal((await readStable(page)).supplyPriority, barracks.id);
  await entry.click();
  assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
  await back.click();
  await page.setViewportSize(viewport);
}

async function verifyDivination(browser, page) {
  const storageState = offline ? undefined : await page.context().storageState();
  const context = await browser.newContext({ storageState, offline, viewport: { width: 390, height: 844 } });
  try {
    const branch = await context.newPage();
    if (offline) {
      // Playwright's storage state does not copy file URL storage between contexts.
      const entries = await page.evaluate(() => Object.entries(localStorage));
      await branch.addInitScript(saved => {
        if (localStorage.getItem('nine-kingdoms-run-v1') === null) {
          for (const [key, value] of saved) localStorage.setItem(key, value);
        }
      }, entries);
    }
    const read = () => readStable(branch);
    const resume = () => branch.getByRole('button', { name: '继续战局', exact: true }).click();
    await branch.goto(url);
    await resume();
    const before = await read();
    assert.equal(before.phase, 'reward');
    const divine = branch.getByRole('button', { name: /^占卜新战利品/ });
    await divine.focus();
    await branch.keyboard.press('Enter');
    const after = await read();
    assert.equal(after.divined, true);
    assert.equal(after.wallet.mana, before.wallet.mana - 3);
    assert.equal(after.rewards.length, 3);
    assert.ok(after.rewards.every(id => !before.rewards.includes(id)));
    assert.equal(await branch.locator('[data-reward]:focus').count(), 1);
    await branch.reload();
    await resume();
    assert.equal(await divine.count(), 0);
    assert.equal(await branch.locator('#divine-status').innerText(), '本局已使用祭坛占卜。');
    const restored = await read();
    assert.deepEqual(restored.rewards, after.rewards);
    assert.equal(restored.random, after.random);
    assert.equal(restored.wallet.mana, after.wallet.mana);
    assert.equal(await branch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await branch.screenshot({ path: `test-results/altar-divination${suffix}.png`, fullPage: true, animations: 'disabled' });
    await branch.locator('[data-reward]').first().click();
    assert.equal((await read()).phase, 'planning');
  } finally {
    await context.close();
  }
}

async function replay(plan) {
  const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
  try {
    const viewport = production ? { width: 1280, height: 720 } : { width: 1360, height: 910 };
    const page = await browser.newPage({ viewport, offline });
    page.setDefaultTimeout(12000);
    if (cpuRate > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    }
    const errors = [];
    const watchMarshal = plan.kingdom === 'iron' && !formationAdviceReview;
    const watchCaptain = formationReview;
    const watchSpear = spearReview;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
    page.on('request', request => {
      const destination = request.url();
      if (offline ? destination !== url && !destination.startsWith('data:') : !destination.startsWith(url)) errors.push(destination);
    });
    page.on('requestfailed', request => errors.push(`${request.failure()?.errorText} ${request.url()}`));
    if (offline) await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.inlineSamples = new Set();
      window.Audio = function (url) {
        const sound = new NativeAudio(url);
        sound.addEventListener('playing', () => {
          if (sound.src.startsWith('data:audio/ogg;')) window.inlineSamples.add(sound.src);
        }, { once: true });
        return sound;
      };
    });
    if (cavalryReview) await page.addInitScript(() => {
      window.cavalryRings = 0;
      const ellipse = CanvasRenderingContext2D.prototype.ellipse;
      CanvasRenderingContext2D.prototype.ellipse = function (x, y, xRadius, yRadius, ...rest) {
        if (this.canvas.parentElement?.id === 'field' && this.strokeStyle === '#ffe1a0' && xRadius === 114 && yRadius === 93) {
          window.cavalryRings++;
        }
        return ellipse.call(this, x, y, xRadius, yRadius, ...rest);
      };
    });
    const inlineImage = async file => `data:image/webp;base64,${(await readFile(`assets/generated/${file}`)).toString('base64')}`;
    const unitSource = offline && review ? await inlineImage('unit-motion.webp') : null;
    const marshalSource = offline && watchMarshal ? await inlineImage('marshal-motion.webp') : null;
    const captainSource = offline && watchCaptain ? await inlineImage('captain-motion.webp') : null;
    const spearSource = offline && watchSpear ? await inlineImage('spear-motion.webp') : null;
    if (review || profile || watchMarshal || watchCaptain || watchSpear) await page.addInitScript(({
      review, profile, watchMarshal, watchCaptain, watchSpear, unitSource, marshalSource, captainSource, spearSource,
    }) => {
      window.motionFrames = [new Set(), new Set()];
      window.marshalFrames = new Set();
      window.captainFrames = new Set();
      window.captainStrikeAt = -Infinity;
      window.spearFrames = new Set();
      window.spearThrustAt = -Infinity;
      window.battlePaintTimes = [];
      const imageKinds = new WeakMap();
      function animationKind(image) {
        let kind = imageKinds.get(image);
        if (kind !== undefined) return kind;
        // The main atlas can have a very large data URL in the offline build.
        const src = image.src;
        if (review && (unitSource ? src === unitSource : src.includes('/unit-motion'))) kind = 'unit';
        else if (watchMarshal && (marshalSource ? src === marshalSource : src.includes('/marshal-motion'))) kind = 'marshal';
        else if (watchCaptain && (captainSource ? src === captainSource : src.includes('/captain-motion'))) kind = 'captain';
        else if (watchSpear && (spearSource ? src === spearSource : src.includes('/spear-motion'))) kind = 'spear';
        else kind = '';
        imageKinds.set(image, kind);
        return kind;
      }
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (source, ...params) {
        const kind = source instanceof HTMLImageElement ? animationKind(source) : '';
        if (kind === 'unit') {
          const [x, y, width, height] = params;
          window.motionFrames[y / height]?.add(x / width);
        }
        if (kind === 'marshal') {
          const [x, , width] = params;
          const frame = x / width;
          window.marshalFrames.add(frame);
          if (window.marshalWalk && frame < 6) {
            const { e, f } = this.getTransform();
            window.marshalWalk.push({ at: performance.now(), frame, x: e, y: f });
          }
        }
        if (kind === 'captain') {
          const [x, , width] = params;
          const frame = x / width;
          window.captainFrames.add(frame);
          if (frame === 7) window.captainStrikeAt = performance.now();
        }
        if (kind === 'spear') {
          const [x, , width] = params;
          const frame = x / width;
          window.spearFrames.add(frame);
          if (frame === 6) window.spearThrustAt = performance.now();
        }
        if (profile && source instanceof HTMLCanvasElement && this.canvas.parentElement?.id === 'field'
          && source.width === this.canvas.width && source.height === this.canvas.height && source.width > 300) {
          const now = performance.now();
          window.firstBattlefieldPaint ??= now;
          if (document.getElementById('phase')?.dataset.phase === 'battle') window.battlePaintTimes.push(now);
        }
        return draw.call(this, source, ...params);
      };
    }, { review, profile, watchMarshal, watchCaptain, watchSpear, unitSource, marshalSource, captainSource, spearSource });
    if (plan.kingdom === 'tide') await page.addInitScript(() => {
      if (!localStorage.getItem('nine-kingdoms-chronicle-v1')) localStorage.setItem('nine-kingdoms-chronicle-v1', JSON.stringify({
        version: 1, merit: 7, expeditions: 3, victories: 2, records: [0, 1, 2].map(id => String(id).padStart(32, '0')),
      }));
    });
    const read = () => readStable(page);
    const button = name => page.getByRole('button', { name, exact: true });
    const tile = ({ x, y }) => page.getByRole('button', { name: new RegExp(`^${x + 1}列${y + 1}行 `) });
    const expected = supplyReview ? { phase: 'won', hp: 30, defeated: 74 }
      : { phase: plan.won ? 'won' : 'lost', hp: plan.hp, defeated: plan.defeated };
    await page.goto(url);
    if (production) {
      await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
      assert.equal(await page.evaluate(() => typeof window.render_game_to_text), 'undefined');
      assert.equal(await page.locator('#open-sandbox, .sandbox').count(), 0);
    }
    const firstDraw = profile ? await page.waitForFunction(() => window.firstBattlefieldPaint).then(handle => handle.jsonValue()) : undefined;
    if (frameRate || frameHistoryReview || watchMarshal || watchCaptain || watchSpear || cavalryReview || review) {
      await page.locator('#menu-settings').click();
      if (watchMarshal || watchCaptain || watchSpear || review) await page.locator('#motion').selectOption('full');
      if (cavalryReview) await page.locator('#motion').selectOption('reduced');
      if (frameRate) await page.locator('#frame-rate').selectOption(frameRate);
      if (frameHistoryReview || frameSwitchReview) {
        await page.locator('#motion').selectOption('full');
        await page.locator('#record-frame-rate').check();
      }
      await page.locator('#close-settings').click();
    }
    if (spearReview || cavalryReview) {
      await page.setViewportSize({ width: 390, height: 844 });
      await button('图鉴').click();
      const journal = page.getByRole('dialog', { name: '图鉴', exact: true });
      await journal.getByLabel('类别').selectOption({ label: '友军' });
      await journal.getByLabel('搜索').fill(cavalryReview ? '赤鬃骑兵' : '鸢尾矛兵');
      const ability = cavalryReview ? /冲锋还会波及目标 1\.5 格内的其他敌军/ : /相邻斜格.*无视护甲.*作用距离\s+1\.5 格/s;
      assert.match(await journal.locator('.compendium-detail').innerText(), ability);
      assert.equal(await journal.evaluate(element => element.scrollWidth <= element.clientWidth), true);
      await page.screenshot({ path: `test-results/${cavalryReview ? 'cavalry' : 'spearman'}-briefing${suffix}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#menu-compendium').evaluate(element => element === document.activeElement), true);
      await page.setViewportSize(viewport);
    }
    await page.getByLabel('战役').selectOption('march');
    await page.getByRole('combobox', { name: '王国', exact: true }).selectOption(plan.kingdom);
    await page.locator('#seed-input').fill(String(plan.seed));
    await button('开始部署').click();
    assert.equal((await read()).route, plan.route);
    assert.ok(await page.locator('#enemy-roster li').count());
    if (farmOrder) await checkEnemyBriefing(page, {
      name: '褐羽射手', count: 3, seconds: 3.7, ability: /远程投射物/, stats: /作用距离\s+2\.6 格/,
    });
    if (plan.kingdom === 'iron') {
      const [briefing, map, orders] = await Promise.all(['.briefing', '.map-panel', '.orders'].map(selector => page.locator(selector).boundingBox()));
      assert.ok(briefing.x < map.x && map.x < orders.x);
      await button('选建造军令').click();
      assert.equal(await page.locator('#hand [aria-pressed="true"][data-card="watch"]').count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#hand [aria-pressed="true"]').count(), 0);
    }

    let wave = 0;
    let checkedFarm = false;
    const timings = [];
    async function switchFrameRate(rate) {
      await page.keyboard.press('Escape');
      await page.getByRole('heading', { name: '战斗已暂停' }).waitFor();
      await page.locator('#pause-settings').click();
      await page.getByLabel('帧率上限').selectOption(rate);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nine-kingdoms-settings')).frameRate), rate);
      await page.locator('#close-settings').click();
      await page.getByRole('heading', { name: '战斗已暂停' }).waitFor();
      if (rate === '144') await page.evaluate(() => { window.marshalWalk = []; });
      await page.getByRole('dialog', { name: '战斗已暂停' }).getByRole('button', { name: '继续战斗' }).press('Enter');
    }
    for (const command of plan.commands) {
      try {
        switch (command.kind) {
          case 'play': {
            const { hand } = await read();
            await page.locator(`#hand [data-slot="${command.slot}"]`).click();
            if (command.tile) await tile(command.tile).click();
            const remaining = hand.filter((_, slot) => slot !== command.slot);
            assert.deepEqual((await read()).hand, remaining,
              `Playing ${hand[command.slot]} should consume one permit. ${await page.locator('#notice').textContent()}`);
            break;
          }
          case 'upgrade': {
            const target = (await read()).buildings.find(building => building.id === command.id);
            await tile(target.tile).click();
            await page.locator('#upgrade').click();
            break;
          }
          case 'relocate': {
            const before = await read();
            const camp = before.buildings.find(building => building.def === 'barracks');
            const source = before.buildings.find(building => building.id === command.id);
            const blocked = page.getByRole('list', { name: '出阵受阻的营地' }).getByRole('button', { name: /^查看鸢尾兵营/ });
            await page.setViewportSize({ width: 390, height: 844 });
            await blocked.press('Enter');
            assert.equal(await page.locator('#inspect-title').innerText(), `鸢尾兵营 · ${camp.level} 级`);
            assert.equal(await tile(camp.tile).evaluate(element => document.activeElement === element), true);
            assert.equal(await page.locator('#tiles [data-muster]').count(), 1);
            assert.deepEqual(await read(), before);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await tile(source.tile).click();
            await page.locator('#relocate').click();
            const forecast = page.locator('#forecast');
            const beforeCount = Number((await forecast.innerText()).match(/出阵 (\d+) \/ \d+ 支/)[1]);
            const preview = page.locator('#placement-preview');
            await tile(command.tile).hover();
            assert.match(await preview.innerText(), /鸢尾兵营.*出阵位 1 → 2/);
            assert.ok((await preview.innerText()).includes(`预计出阵 ${beforeCount} → ${beforeCount + 1} 支`));
            assert.deepEqual(await read(), before);
            await page.locator('.orders').screenshot({ path: `test-results/supply-preview-narrow${suffix}.png` });
            await tile(command.tile).focus();
            assert.ok((await preview.innerText()).includes(`预计出阵 ${beforeCount} → ${beforeCount + 1} 支`));
            await tile(command.tile).press('Enter');
            const after = await read();
            assert.deepEqual(after.buildings.find(building => building.id === command.id).tile, command.tile);
            assert.equal(after.wallet.wood, before.wallet.wood - 1);
            assert.match(await forecast.innerText(), new RegExp(`出阵 ${beforeCount + 1} / \\d+ 支`));
            await page.reload();
            await button('继续战局').click();
            assert.deepEqual(await read(), after);
            await tile(camp.tile).click();
            assert.equal(await page.locator('#tiles [data-muster]').count(), 2);
            await page.setViewportSize(viewport);
            break;
          }
          case 'buy': {
            const checkFarm = farmOrder && command.card === 'farm' && !checkedFarm;
            const before = checkFarm ? await read() : undefined;
            if (checkFarm) await page.setViewportSize({ width: 390, height: 844 });
            const offer = page.locator(`[data-offer="${command.card}"]`);
            await button('军令商店').click();
            if (checkFarm) {
              assert.ok(wave >= 2);
              assert.match(await offer.innerText(), /常备军令.*购入 2 金币/s);
              assert.equal(await page.locator('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
              await offer.scrollIntoViewIfNeeded();
              await page.screenshot({ path: `test-results/farm-order-narrow${suffix}.png` });
            }
            await offer.click();
            if (checkFarm) {
              assert.equal((await read()).wallet.gold, before.wallet.gold - 2);
              await page.reload();
              await button('继续战局').click();
              assert.ok((await read()).hand.includes('farm'));
              await button('军令商店').click();
              assert.equal(await offer.isDisabled(), true);
              assert.match(await offer.innerText(), /本波已购/);
              checkedFarm = true;
            }
            await page.locator('#close-shop').click();
            if (checkFarm) await page.setViewportSize(viewport);
            break;
          }
          case 'encounter': {
            const entry = page.locator('#encounter');
            const choice = page.locator(`[data-choice="${command.choice}"]`);
            if (command.choice !== 'relic-trade') {
              await entry.click();
              await choice.click();
              break;
            }
            assert.equal(wave, 3);
            const before = await read();
            await page.setViewportSize({ width: 390, height: 844 });
            await entry.click();
            const dialog = page.getByRole('dialog', { name: '余烬书库' });
            assert.equal(await dialog.locator('[data-choice]').count(), 3);
            const offer = await choice.innerText();
            assert.match(offer, /渡口军旗.*最大生命各提高 3 点.*3 食物/s);
            assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
            await page.screenshot({ path: `test-results/relic-trade-narrow${suffix}.png`, animations: 'disabled' });
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'hidden' });
            assert.equal(await entry.evaluate(element => document.activeElement === element), true);
            await page.reload();
            await button('继续战局').click();
            assert.deepEqual(await read(), before);
            await entry.click();
            assert.equal(await choice.innerText(), offer);
            await choice.press('Enter');
            const after = await read();
            assert.equal(after.wallet.food, before.wallet.food - 3);
            assert.equal(after.random, before.random);
            assert.deepEqual(after.relics, [...before.relics, 'muster-banner']);
            assert.equal(await entry.isVisible(), false);
            await page.reload();
            await button('继续战局').click();
            assert.deepEqual(await read(), after);
            await page.locator('[data-relic="muster-banner"]').waitFor();
            await page.setViewportSize(viewport);
            break;
          }
          case 'research': {
            const lab = (await read()).buildings.find(building => building.def === 'lab');
            await tile(lab.tile).click();
            await button('选择科技').click();
            await page.locator(`[data-topic="${command.topic}"]`).click();
            break;
          }
          case 'formation': {
            const control = page.getByLabel('守军阵势');
            const line = page.locator('#formation-line');
            if (formationPlanReview) {
              const guidance = { bank: /本波可试试「固守东岸」/, advance: /本波可改回「主动迎击」/, inner: /本波可试试「收缩内线」/ };
              await page.setViewportSize({ width: 390, height: 844 });
              assert.match(await control.getAttribute('aria-describedby'), /formation-note/);
              const note = page.locator('#formation-note');
              assert.match(await note.innerText(), guidance[command.value]);
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
              await control.focus();
              if (formationAdviceReview && wave === 1) await page.screenshot({ path: `test-results/formation-advice-narrow${suffix}.png` });
              await control.press(command.value === 'advance' ? 'ArrowUp' : 'ArrowDown');
              assert.equal(await control.inputValue(), command.value);
              assert.equal((await read()).formation, command.value);
              assert.doesNotMatch(await note.innerText(), guidance[command.value]);
              assert.equal(await line.isVisible(), command.value !== 'advance');
              if (wave === 1) {
                await page.reload();
                await button('继续战局').click();
                assert.equal(await control.inputValue(), command.value);
                assert.doesNotMatch(await note.innerText(), guidance[command.value]);
              }
              await page.setViewportSize(viewport);
              break;
            }
            assert.equal(await control.inputValue(), 'advance');
            assert.equal(await line.isVisible(), false);
            await control.selectOption('bank');
            assert.equal((await read()).formation, 'bank');
            assert.match(await page.locator('#formation-note').innerText(), /第 5 列/);
            await control.selectOption(command.value);
            await page.reload();
            await button('继续战局').click();
            assert.equal(await control.inputValue(), 'inner');
            assert.match(await page.locator('#formation-note').innerText(), /第 7 列/);
            const battlefield = page.locator('.board');
            const [board, marker] = await Promise.all([battlefield.boundingBox(), line.boundingBox()]);
            assert.ok(board && marker && Math.abs((marker.x - board.x) - board.width * 6 / 11) <= 2);
            await page.screenshot({ path: `test-results/formation-inner${suffix}.png`, fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            assert.equal(await control.isVisible(), true);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.setViewportSize(viewport);
            break;
          }
          case 'start':
            if (offline && wave === 0) await page.waitForFunction(() => window.inlineSamples.size === 2);
            if (supplyReview && wave === 5) await prioritizeBarracks(page, viewport);
            if (formationAdviceReview && wave === 5) {
              const control = page.getByLabel('守军阵势');
              const note = page.locator('#formation-note');
              const line = page.locator('#formation-line');
              const advice = /最终波可试试「收缩内线」.*裂岩巨兽/;
              assert.equal(await control.inputValue(), 'inner');
              assert.doesNotMatch(await note.innerText(), advice);
              await page.setViewportSize({ width: 390, height: 844 });
              await control.focus();
              await control.press('ArrowUp');
              assert.equal(await control.inputValue(), 'bank');
              assert.match(await note.innerText(), advice);
              await control.press('ArrowUp');
              assert.equal(await control.inputValue(), 'advance');
              assert.match(await note.innerText(), advice);
              for (const [width, height] of [[390, 844], [1280, 720], [2560, 1080]]) {
                await page.setViewportSize({ width, height });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await control.scrollIntoViewIfNeeded();
                await page.screenshot({ path: `test-results/final-formation-advice-${width}${suffix}.png` });
              }
              await page.setViewportSize({ width: 390, height: 844 });
              await page.reload();
              await button('继续战局').click();
              assert.equal(await control.inputValue(), 'advance');
              assert.match(await note.innerText(), advice);
              await control.focus();
              await control.press('ArrowDown');
              await control.press('ArrowDown');
              assert.equal(await control.inputValue(), 'inner');
              assert.equal((await read()).formation, 'inner');
              assert.doesNotMatch(await note.innerText(), advice);
              assert.equal(await line.isVisible(), true);
              await page.setViewportSize(viewport);
            }
            if ((review || formationReview) && wave === 4) await checkEnemyBriefing(page, {
              name: '黑旗精锐', count: 4, seconds: 0.1, ability: /无视护甲.*远程、法术、召唤和治疗/, stats: /生命\s+26/,
            });
            if ((review || formationReview) && wave === 5) {
              await page.setViewportSize({ width: 390, height: 844 });
              await checkEnemyBriefing(page, {
                name: '断桥元帅', count: 1, seconds: 3.3, ability: /50%.*2\.4 格.*5 点基础伤害/, stats: /生命\s+88/,
                screenshot: `test-results/enemy-briefing-narrow${suffix}.png`,
              });
              await page.setViewportSize(viewport);
            }
            if (bossPacing && wave === 5) {
              await page.setViewportSize({ width: 390, height: 844 });
              await checkEnemyBriefing(page, {
                name: '裂岩巨兽', count: 3, seconds: 11.5, ability: /重击会波及目标/, stats: /生命\s+38/,
                screenshot: `test-results/boss-ogre-pacing${suffix}.png`,
              });
              const checkpoint = await read();
              if (production) assert.equal(checkpoint.pastWaves.length, 5);
              await page.reload();
              await button('继续战局').click();
              if (production) assert.deepEqual((await read()).pastWaves, checkpoint.pastWaves);
              await checkEnemyBriefing(page, {
                name: '断桥元帅', count: 1, seconds: 3.3, ability: /半血|50%/, stats: /生命\s+88/,
              });
              await page.setViewportSize(viewport);
            }
            if (wave === 0 && plan.doctrine === 'rampart') {
              const wall = (await read()).buildings.find(building => building.def === 'wall');
              await tile(wall.tile).click();
              assert.match(await page.locator('#inspect-text').innerText(), /护甲和近战反击/);
              await page.screenshot({ path: `test-results/rampart-planning${suffix}.png`, fullPage: true });
            }
            if (profile) await page.evaluate(() => { window.battlePaintTimes.length = 0; });
            await button('开始战斗').click();
            assert.ok(await page.locator('#enemy-roster button').count() > 0);
            assert.equal(await page.locator('#enemy-roster [aria-haspopup="dialog"]').count(), 0);
            if (formationReview) assert.equal(await page.locator('#formation-line').isVisible(), false);
            wave++;
            if (frameSwitchReview && wave === 6) {
              await page.waitForFunction(() => {
                const times = window.battlePaintTimes;
                return times.at(-1) - times[0] >= 1600;
              });
              await switchFrameRate('120');
              await page.waitForFunction(() => window.marshalFrames.size > 1);
              await switchFrameRate('144');
            }
            if (bossPacing && wave === 6) {
              await checkLiveBattle(page);
              await page.setViewportSize({ width: 390, height: 844 });
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
              await page.locator('#field').scrollIntoViewIfNeeded();
              await page.screenshot({ path: `test-results/live-battle-intel${suffix}.png`, fullPage: true });
              await page.setViewportSize(viewport);
            }
            const heading = wave === 6 ? (expected.phase === 'won' ? '远征告捷' : '防线失守') : '选择战利品';
            if (watchMarshal && wave === 6) {
              await page.waitForFunction(() => document.getElementById('battle-alert').textContent === '断桥元帅发动半血反击');
              await page.waitForFunction(() => window.marshalFrames.has(9));
              await page.screenshot({ path: `test-results/marshal-counter${suffix}.png`, fullPage: true });
            }
            if (watchCaptain && wave === 5) {
              await page.waitForFunction(() => performance.now() - window.captainStrikeAt < 120);
              await page.screenshot({ path: `test-results/captain-strike${suffix}.png`, fullPage: true });
            }
            if (watchSpear && wave === 2) {
              await page.waitForFunction(() => performance.now() - window.spearThrustAt < 45);
              await page.screenshot({ path: `test-results/spearman-thrust${suffix}.png` });
            }
            await page.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 60000 });
            if (watchCaptain && wave === 5) {
              const frames = await page.evaluate(() => [...window.captainFrames].sort((left, right) => left - right));
              assert.deepEqual(frames, Array.from({ length: 9 }, (_, index) => index));
              console.log(`Captain walk and war pick cels drawn: ${JSON.stringify(frames)}`);
            }
            if (watchSpear && wave === 2) {
              const frames = await page.evaluate(() => [...window.spearFrames].sort((left, right) => left - right));
              assert.deepEqual(frames, Array.from({ length: 9 }, (_, index) => index));
              console.log(`Spearman walk and thrust cels drawn: ${JSON.stringify(frames)}`);
            }
            if (formationReview && wave >= 5) assert.match(await page.getByRole('region', { name: '本波战况' }).innerText(), /守军阵势 · 收缩内线/);
            if (supplyReview && wave === 6) {
              const report = await page.getByRole('region', { name: '本波战况' }).innerText();
              assert.match(report, /出阵 8 支 · 开战有 9 食物 · 出阵消耗 9 食物/);
              assert.match(report, /缺粮未出阵 3 支/);
            }
            if (watchMarshal && wave === 6) {
              const frames = await page.evaluate(() => [...window.marshalFrames].sort((left, right) => left - right));
              assert.deepEqual(frames, Array.from({ length: 12 }, (_, index) => index));
              console.log(`Marshal movement, sword strike, and counter cels drawn: ${JSON.stringify(frames)}`);
            }
            if (profile && (!frameSwitchReview || wave !== 6)) {
              const times = await page.evaluate(() => window.battlePaintTimes);
              assert.ok(times.length > 10, `Missing battle paint samples for wave ${wave}`);
              const seconds = (times.at(-1) - times[0]) / 1000;
              const intervals = times.slice(1).map((time, index) => time - times[index]).sort((left, right) => left - right);
              timings.push({
                wave, seconds: Number(seconds.toFixed(1)), fps: Number((intervals.length / seconds).toFixed(1)),
                p95ms: Number(intervals[Math.ceil(intervals.length * .95) - 1].toFixed(1)),
                over50ms: intervals.filter(time => time > 50).length,
              });
            }
            if (production && (wave === 2 || (formationReview && wave === 3))) {
              const report = page.getByRole('region', { name: '本波战况' });
              const reviewText = await report.innerText();
              const checkpoint = await read();
              await page.setViewportSize({ width: 1920, height: 1080 });
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
              await page.reload();
              await button('继续战局').click();
              assert.equal(await report.innerText(), reviewText);
              assert.deepEqual(await read(), checkpoint);
              if (formationReview && wave === 3) await checkDamageBreakdown(report, checkpoint.waveReport.keepDamage);
              await page.setViewportSize(viewport);
            }
            if (review && wave === 1) {
              const rows = await page.evaluate(() => window.motionFrames.map(frames => [...frames]));
              for (const frames of rows) {
                assert.ok(frames.filter(frame => frame < 6).length >= 2, JSON.stringify(rows));
                assert.ok(frames.includes(6) && frames.includes(7), JSON.stringify(rows));
              }
              console.log(`Archer and lancer movement and action cels drawn: ${JSON.stringify(rows)}`);
            }
            if (review && wave >= 5) {
              const report = page.getByRole('region', { name: '本波战况' });
              const text = await report.innerText();
              assert.match(text, /缺粮未出阵 [1-9]\d* 支/);
              if (wave < 6 || !production) {
                const state = await read();
                assert.ok(state.waveReport.unfed.length > 0);
                assert.match(text, new RegExp(`缺粮未出阵 ${state.waveReport.unfed.length} 支`));
                if (wave === 6) assert.ok(state.waveReport.lastKeepHit);
              }
              if (wave === 6) {
                assert.match(text, /第 \d+ 列、第 \d+ 行发起最后一次攻击/);
                await checkDamageBreakdown(report, plan.report.keepDamage);
                await page.setViewportSize({ width: 390, height: 844 });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await page.screenshot({ path: `test-results/wave-review-shortage${suffix}.png`, fullPage: true });
              }
            }
            if (wave === 2 && plan.kingdom === 'arcane' && !musterReview) await verifyDivination(browser, page);
            console.log(`${plan.kingdom} ${plan.seed} reached ${heading} after wave ${wave}`);
            break;
          case 'reward':
            await page.locator(`[data-reward="${command.card}"]`).click();
            break;
          default: assert.fail(`Unimplemented replay command ${command.kind}`);
        }
      } catch (error) {
        const state = await read();
        await page.screenshot({ path: `test-results/kingdom-${plan.kingdom}-failure${suffix}.png`, fullPage: true });
        throw new Error(`${plan.kingdom} ${plan.seed} · wave ${wave + 1} · ${JSON.stringify(command)} · ${state?.phase ?? 'no checkpoint'} · keep ${state?.keepHp ?? '?'}`, { cause: error });
      }
    }
    if (production) {
      assert.equal(await page.locator('#phase').getAttribute('data-phase'), expected.phase);
      assert.equal(await page.locator('#dialog-title + p').innerText(), `第 6 波 · 击退 ${expected.defeated} 名敌军 · 城堡生命 ${expected.hp}`);
      assert.equal(await read(), undefined);
    } else {
      const result = await read();
      assert.deepEqual({ phase: result.phase, hp: result.keepHp, defeated: result.defeated }, expected);
    }
    assert.equal(wave, 6);
    if (cavalryReview) assert.ok(await page.evaluate(() => window.cavalryRings > 0), 'The battle should paint the full 1.5-cell charge range.');
    if (bossPacing) {
      assert.equal(await page.locator('#tiles [data-battle-inspect]').count(), 0);
      assert.equal(await page.locator('#enemy-roster-key').isVisible(), false);
    }
    if (farmOrder) assert.equal(checkedFarm, true);
    if (frameSwitchReview) {
      const walks = await page.evaluate(() => window.marshalWalk);
      const positions = walks.filter(({ frame, x, y }, index) => {
        const previous = walks[index - 1];
        return !previous || previous.frame !== frame || previous.x !== x || previous.y !== y;
      });
      const motionIndex = positions.findIndex(({ at, frame, x, y }, index) => {
        const second = positions[index + 1];
        const third = positions[index + 2];
        return second?.frame === frame && third?.frame === frame && third.at - at < 90 && (third.x !== x || third.y !== y);
      });
      assert.ok(motionIndex >= 0, 'A walking sprite cell must draw at three distinct positions within one simulation interval.');
      const report = button('保存整局战报');
      const [file] = await Promise.all([page.waitForEvent('download'), report.press('Enter')]);
      const content = await readFile(await file.path(), 'utf8');
      assert.match(content, /记录 6 \/ 6 个已完成波次/);
      assert.deepEqual([...content.matchAll(/第 (\d+) 波帧率/g)].map(match => Number(match[1])), [1, 2, 3, 4, 5, 6]);
      const sections = content.split(/第 \d+ 波帧率\r?\n/).slice(1);
      const caps = section => [...section.matchAll(/上限 (\d+) FPS/g)].map(match => Number(match[1]));
      for (const section of sections.slice(0, 5)) assert.deepEqual(caps(section), [60]);
      assert.deepEqual(caps(sections[5]), [60, 120, 144]);
      console.log('Wave 6 frame report after switching caps:\n' + sections[5].trim());
      console.log('One Marshal walk cell at three positions:', positions.slice(motionIndex, motionIndex + 3));
    }
    if (bossPacing && production) {
      await page.setViewportSize({ width: 390, height: 844 });
      const report = button('保存整局战报');
      await report.focus();
      const [file] = await Promise.all([page.waitForEvent('download'), report.press('Enter')]);
      assert.equal(file.suggestedFilename(), `before-the-onslaught-${plan.kingdom}-${plan.seed}-run.txt`);
      const content = await readFile(await file.path(), 'utf8');
      assert.ok(content.startsWith('\ufeff兵锋未至 · 整局战报'));
      assert.match(content, /记录 6 \/ 6 个已完成波次/);
      assert.deepEqual([...content.matchAll(/第 (\d+) \/ 6 波 ·/g)].map(match => Number(match[1])), [1, 2, 3, 4, 5, 6]);
      assert.equal([...content.matchAll(/^领取军令 /gm)].length, 5);
      assert.match(content, /第 6 \/ 6 波 · 通关 · 城堡生命 16 \/ 30 · 累计击退 74 名敌军/);
      if (frameHistoryReview) {
        assert.match(content, /战斗帧率记录/);
        assert.deepEqual([...content.matchAll(/第 (\d+) 波帧率/g)].map(match => Number(match[1])), [1, 2, 3, 4, 5, 6]);
        if (frameRate && frameRate !== 'display') assert.ok(content.includes(`上限 ${frameRate} FPS`));
      } else assert.doesNotMatch(content, /战斗帧率记录/);
      assert.equal(await page.locator('#overlay').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
      await page.screenshot({ path: `test-results/run-report-download${suffix}.png` });
      await page.setViewportSize(viewport);
    }
    assert.deepEqual(errors, []);
    if (expected.phase === 'won') await page.screenshot({
      path: `test-results/kingdom-${plan.kingdom}-victory${cavalryReview ? '-cavalry' : bossPacing ? '-boss-pacing' : spearReview ? '-spears' : supplyReview ? '-supply' : farmOrder ? '-farm' : formationReview ? '-formation' : ''}${suffix}.png`, fullPage: true,
    });
    console.log(`${channel} ${browser.version()} · ${offline ? 'offline file' : production ? 'production' : 'development'} · ${viewport.width}×${viewport.height} · ${plan.kingdom} ${plan.seed}${profile ? ` · cap ${frameRate} · CPU throttle ${cpuRate}×` : ''}`);
    if (profile) {
      console.log(`First battlefield draw: ${firstDraw.toFixed(1)} ms after navigation start.`);
      console.table(timings);
    }
    return { kingdom: plan.kingdom, seed: plan.seed, strategy: supplyReview ? `${plan.doctrine}:barracks-priority` : plan.doctrine,
      keep: expected.hp, defeated: expected.defeated, ripostes: plan.counters };
  } finally {
    await browser.close();
  }
}

try {
  const results = await Promise.allSettled(plans.map(replay));
  console.table(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Kingdom browser replay failed');
} finally {
  if (file) {
    await unlink(file);
    await rmdir(isolated);
  } else if (production) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  else await server.close();
}
