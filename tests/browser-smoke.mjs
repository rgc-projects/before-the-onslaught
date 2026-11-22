import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { createServer } from 'vite';

const server = process.env.NINE_KINGDOMS_URL ? undefined : await createServer({
  server: { host: '127.0.0.1', port: 0 },
});
await server?.listen();
const address = server?.httpServer?.address();
const url = process.env.NINE_KINGDOMS_URL ?? `http://127.0.0.1:${address.port}/`;
const channel = process.env.NINE_KINGDOMS_BROWSER ?? 'msedge';
let browser;
try {
  browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
} catch (error) {
  await server?.close();
  throw error;
}
const failures = [];
const origin = new URL(url).origin;
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  window.battleFrameCount = 0;
  window.guardWalkFrames = new Set();
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...params) {
    if (this.canvas.parentElement?.id === 'field' && source instanceof HTMLCanvasElement
      && source.width === this.canvas.width && source.height === this.canvas.height) window.battleFrameCount++;
    if (source instanceof HTMLImageElement && source.src.includes('/guard-walk')) window.guardWalkFrames.add(params[0]);
    return drawImage.call(this, source, ...params);
  };
  const BrowserAudioContext = AudioContext;
  window.soundProbe = { frequencies: [], master: null };
  window.AudioContext = class extends BrowserAudioContext {
    createGain() {
      const gain = super.createGain();
      window.soundProbe.master ??= gain.gain;
      return gain;
    }
    createOscillator() {
      const oscillator = super.createOscillator();
      const start = oscillator.start.bind(oscillator);
      oscillator.start = when => {
        window.soundProbe.frequencies.push(oscillator.frequency.value);
        start(when);
      };
      return oscillator;
    }
  };
});
page.on('pageerror', error => failures.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') failures.push(`${message.text()} ${message.location().url}`);
});
page.on('request', request => {
  if (request.url().startsWith('http') && new URL(request.url()).origin !== origin) failures.push(request.url());
});
page.on('response', response => {
  if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
});
page.on('requestfailed', request => failures.push(`${request.failure()?.errorText} ${request.url()}`));

const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const choose = name => page.locator('#hand .card').filter({ hasText: name }).first().click();
const grid = (x, y) => page.getByRole('button', { name: new RegExp(`^${x}列${y}行 `) });
const place = async (name, x, y) => { await choose(name); await grid(x, y).click(); };
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const wait = selector => page.getByRole('heading', { name: selector, exact: true }).waitFor({ timeout: 35000 });
const capture = file => page.screenshot({ path: `test-results/${channel === 'msedge' ? '' : `${channel}-`}${file}.png`, fullPage: true });
const pause = page.getByRole('dialog', { name: '战斗已暂停' });
const frameRate = page.getByLabel('帧率上限', { exact: true });
const sampleFrames = () => page.evaluate(() => new Promise(resolve => {
  const first = window.battleFrameCount;
  const start = performance.now();
  const tick = JSON.parse(window.render_game_to_text()).tick;
  function sample() {
    const seconds = (performance.now() - start) / 1000;
    if (seconds < 1) requestAnimationFrame(sample);
    else resolve({ fps: (window.battleFrameCount - first) / seconds, ticks: JSON.parse(window.render_game_to_text()).tick - tick });
  }
  requestAnimationFrame(sample);
}));
const readAtTick = async tick => {
  const snapshot = await page.waitForFunction(tick => {
    const state = JSON.parse(window.render_game_to_text());
    return state.tick >= tick && state;
  }, tick);
  return snapshot.jsonValue();
};

async function verifyLayoutChanges() {
  await page.reload();
  await page.getByRole('combobox', { name: '战役', exact: true }).selectOption('march');
  await button('开始部署').click();
  await button('替换并开始').click();
  await place('松岗箭塔', 6, 3);
  await place('松岗箭塔', 6, 5);
  await place('边境卫士', 7, 4);
  await place('河畔农圃', 5, 2);
  await place('双仓粮栈', 6, 2);
  await button('开始战斗').click();
  assert.equal(await page.locator('#layout-actions').isVisible(), false);
  await wait('选择战利品');
  await page.locator('[data-reward]').first().click();
  const before = await read();
  assert.equal(before.wave, 1);
  assert.equal(before.deployments.length, 0);
  const warehouse = before.buildings.find(item => item.def === 'storehouse');
  const guard = before.rally.find(item => item.def === 'guard');

  await page.setViewportSize({ width: 390, height: 844 });
  await grid(7, 2).click();
  await button('迁移 · 1 木材').click();
  assert.equal(await grid(6, 2).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#placement-preview').innerText(), /占地 2 格 · 迁移消耗 1 木材/);
  assert.equal(await page.locator('#tiles [data-valid="yes"]').count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture('deployment-relocation-narrow');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'relocate');
  assert.deepEqual(await read(), before);

  await button('迁移 · 1 木材').click();
  await grid(6, 3).click();
  assert.match(await page.locator('#notice').innerText(), /已被占用/);
  assert.deepEqual(await read(), before);
  await grid(6, 2).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.deepEqual((await read()).buildings.find(item => item.id === warehouse.id), { ...warehouse, tile: { x: 6, y: 1 } });
  assert.equal((await read()).wallet.wood, before.wallet.wood - 1);

  await grid(7, 4).click();
  await button('迁移 · 1 食物').click();
  await grid(8, 4).click();
  const relocated = await read();
  assert.deepEqual(relocated.rally.find(item => item.id === guard.id), { ...guard, tile: { x: 7, y: 3 } });
  assert.equal(relocated.wallet.food, before.wallet.food - 1);
  await page.reload();
  await button('继续战局').click();
  assert.deepEqual((await read()).rally, relocated.rally);
  assert.deepEqual((await read()).buildings.map(({ cooldown, ...item }) => item), relocated.buildings.map(({ cooldown, ...item }) => item));

  await grid(8, 2).click();
  await button('拆除').click();
  await wait('拆除双仓粮栈？');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cancel-removal');
  await capture('deployment-removal-narrow');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'remove-placement');
  assert.ok((await read()).buildings.some(item => item.id === warehouse.id));
  await button('拆除').click();
  await button('确认拆除').click();
  await grid(8, 4).click();
  await button('解散').click();
  await button('确认解散').click();
  const cleared = await read();
  assert.ok(!cleared.buildings.some(item => item.id === warehouse.id));
  assert.ok(!cleared.rally.some(item => item.id === guard.id));
  assert.deepEqual(cleared.wallet, relocated.wallet);
  assert.deepEqual(cleared.hand, relocated.hand);
  await page.reload();
  await button('继续战局').click();
  assert.deepEqual(await read(), cleared);
}

try {
  await mkdir('test-results', { recursive: true });
  await page.goto(url);
  await page.locator('#field canvas').waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
  await button('开始部署').waitFor();
  const campaignChoice = page.getByRole('combobox', { name: '战役', exact: true });
  assert.equal(await campaignChoice.inputValue(), 'crowford');
  assert.match(await campaignChoice.locator('option:checked').innerText(), /三波教学/);
  assert.match(await page.locator('#campaign-detail').innerText(), /学习布阵/);
  await capture('menu');
  await page.locator('#seed-input').fill('23');
  await button('图鉴').click();
  const compendium = page.getByRole('dialog', { name: '图鉴' });
  await compendium.getByLabel('类别').selectOption({ label: '敌军' });
  await compendium.getByLabel('搜索').fill('半血');
  assert.equal(await compendium.getByLabel('图鉴条目').locator('option').count(), 1);
  assert.match(await compendium.locator('.compendium-detail').innerText(), /断桥元帅.*半血/s);
  await capture('compendium');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await compendium.evaluate(element => [element.scrollWidth, element.clientWidth]),
    await compendium.evaluate(element => [element.clientWidth, element.clientWidth]));
  await capture('compendium-narrow');
  await compendium.getByLabel('搜索').fill('无匹配条目测试');
  assert.equal(await compendium.locator('.compendium-detail').innerText(), '没有匹配的条目。');
  await page.keyboard.press('Escape');
  await compendium.waitFor({ state: 'detached' });
  assert.equal(await page.locator('#seed-input').inputValue(), '23');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-compendium');
  await page.locator('#seed-input').fill('119');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => localStorage.setItem('nine-kingdoms-settings', JSON.stringify({ muted: false, reduced: true })));
  await page.reload();
  await button('设置', page.locator('dialog')).click();
  assert.equal(await page.getByLabel('动态效果').inputValue(), 'reduced');
  assert.equal(await page.locator('#volume').inputValue(), '70');
  assert.equal(await frameRate.inputValue(), 'display');
  assert.deepEqual(await frameRate.locator('option').allTextContents(), ['跟随屏幕', '30 FPS', '60 FPS', '120 FPS', '144 FPS']);
  await frameRate.selectOption('30');
  await page.getByLabel('动态效果').selectOption('off');
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'off');
  const setVolume = value => page.locator('#volume').evaluate((element, level) => {
    element.value = String(level);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await setVolume(0);
  assert.equal(await button('试听音效').isDisabled(), true);
  await setVolume(37);
  await button('试听音效').click();
  await page.waitForFunction(() => window.soundProbe.frequencies.length === 2 && Math.abs(window.soundProbe.master.value - 0.37) < 0.001);
  await page.getByLabel('动态效果').selectOption('full');
  await capture('settings-feedback');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#overlay').evaluate(dialog => dialog.scrollWidth === dialog.clientWidth), true);
  await frameRate.focus();
  assert.equal(await frameRate.evaluate(element => document.activeElement === element), true);
  await capture('frame-rate-narrow');
  await page.setViewportSize({ width: 1280, height: 900 });
  await button('返回', page.locator('dialog')).click();
  await button('开始部署').click();
  assert.match(await page.locator('#objective').innerText(), /先选「松岗箭塔」/);
  const crossings = page.getByRole('list', { name: '渡口火力覆盖' });
  const coverage = () => crossings.getByRole('listitem').allTextContents();
  assert.deepEqual(await coverage(), ['北渡口（第 3 行） · 无防御塔覆盖', '南渡口（第 5 行） · 无防御塔覆盖']);

  assert.equal(await page.locator('#hand [data-sprite="watch"]').count(), 2);
  assert.equal(await page.locator('#hand [data-sprite="guard"]').count(), 1);
  assert.equal(await page.locator('#hand [data-sprite="ember"]').count(), 1);
  assert.equal(await page.locator('#hand .card').count(), await page.locator('#hand [data-sprite]').count());

  await choose('松岗箭塔');
  await grid(1, 4).click();
  assert.equal(await page.locator('#notice').innerText(), '只能部署在河东营地。');
  assert.equal((await read()).wallet.gold, 11);
  const beforeUndo = await read();
  await grid(6, 3).hover();
  assert.match(await page.locator('#placement-preview').innerText(), /北渡口覆盖 \+1 座防御塔 · 南渡口覆盖 \+1 座防御塔/);
  assert.equal(await crossings.locator('[data-uncovered]').count(), 2);
  await grid(6, 3).click();
  assert.deepEqual(await coverage(), ['北渡口（第 3 行） · 1 座防御塔覆盖', '南渡口（第 5 行） · 1 座防御塔覆盖']);
  assert.match(await page.locator('#objective').innerText(), /用「边境卫士」设立集结点/);
  await choose('松岗箭塔');
  await grid(6, 3).hover();
  assert.equal(await page.locator('#placement-preview').innerText(), '这个格子已被占用。');
  await page.keyboard.press('Escape');
  await place('边境卫士', 7, 4);
  assert.match(await page.locator('#objective').innerText(), /把「河畔农圃」建在水边/);
  await page.reload();
  await button('继续战局').click();
  const undo = page.locator('#undo-deployment');
  assert.equal(await undo.innerText(), '撤销部署 · 边境卫士');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await crossings.evaluate(list => list.scrollWidth <= list.clientWidth), true);
  await capture('bridge-coverage-narrow');
  await undo.focus();
  await capture('deployment-undo-narrow');
  await page.keyboard.press('Enter');
  assert.equal((await read()).rally.length, 0);
  assert.equal(await undo.innerText(), '撤销部署 · 松岗箭塔');
  await undo.click();
  assert.equal(await undo.isVisible(), false);
  assert.equal(await crossings.locator('[data-uncovered]').count(), 2);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
  const afterUndo = await read();
  assert.deepEqual({ ...afterUndo, nextId: beforeUndo.nextId }, beforeUndo);
  await choose('松岗箭塔');
  await grid(6, 3).hover();
  assert.match(await page.locator('#placement-preview').innerText(), /北渡口覆盖 \+1 座防御塔 · 南渡口覆盖 \+1 座防御塔/);
  await page.keyboard.press('Escape');
  await page.reload();
  await button('继续战局').click();
  assert.equal(await undo.isVisible(), false);
  assert.deepEqual((await read()).wallet, beforeUndo.wallet);
  await page.setViewportSize({ width: 1280, height: 900 });
  await place('松岗箭塔', 6, 3);
  await place('松岗箭塔', 6, 5);
  await place('边境卫士', 7, 4);
  await place('河畔农圃', 5, 2);
  await place('铁木栅墙', 5, 5);
  assert.equal((await read()).buildings.length, 4);
  await capture('planning');
  await page.reload();
  await button('继续战局').click();
  assert.equal((await read()).buildings.length, 4);
  assert.equal((await read()).wallet.gold, 1);

  for (let wave = 0; wave < 3; wave++) {
    await button('开始战斗').click();
    assert.equal(await undo.isVisible(), false);
    assert.equal(await crossings.isVisible(), false);
    if (wave === 0) {
      const low = await sampleFrames();
      assert.ok(low.fps >= 24 && low.fps <= 32, JSON.stringify(low));
      assert.ok(low.ticks >= 8 && low.ticks <= 12, JSON.stringify(low));
      const lowState = await readAtTick(24);
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 24 && window.soundProbe.frequencies.length >= 3);
      await page.waitForFunction(() => window.guardWalkFrames.size >= 2);
      await capture('guard-walk-in-battle');
      await button('暂停战斗').click();
      await wait('战斗已暂停');
      const snapshot = await read();
      await page.waitForTimeout(350);
      assert.equal((await read()).tick, snapshot.tick);
      await capture('battle');
      await button('设置', pause).click();
      assert.equal(await page.locator('#volume').inputValue(), '37');
      assert.equal(await page.getByLabel('动态效果').inputValue(), 'full');
      assert.equal(await frameRate.inputValue(), '30');
      await frameRate.selectOption('120');
      await page.getByLabel('关闭音效').check();
      assert.equal(await button('试听音效').isDisabled(), true);
      await page.waitForFunction(() => window.soundProbe.master.value === 0);
      const mutedAt = await page.evaluate(() => window.soundProbe.frequencies.length);
      await button('图鉴').click();
      await button('返回', compendium).click();
      await compendium.waitFor({ state: 'detached' });
      await button('返回', page.getByRole('dialog', { name: '设置' })).click();
      assert.equal((await read()).tick, snapshot.tick);
      await button('返回主菜单', pause).click();
      await button('继续战局').click();
      const resumed = await read();
      assert.equal(resumed.phase, 'planning');
      assert.equal(resumed.tick, 0);
      assert.equal(resumed.buildings.length, 4);
      assert.equal(resumed.wallet.gold, 1);
      await button('开始战斗').click();
      const high = await sampleFrames();
      assert.ok(high.fps >= low.fps - 3 && high.fps <= 122, JSON.stringify({ low, high }));
      assert.ok(high.ticks >= 8 && high.ticks <= 12, JSON.stringify(high));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nine-kingdoms-settings')).frameRate), '120');
      assert.deepEqual(await readAtTick(lowState.tick), lowState);
      console.log(`Canvas fps: ${low.fps.toFixed(1)} (30 cap), ${high.fps.toFixed(1)} (120 cap), same battle state at step ${lowState.tick}.`);
      assert.equal(await page.evaluate(() => window.soundProbe.frequencies.length), mutedAt);
      await page.keyboard.press('Escape');
      await wait('战斗已暂停');
      await button('继续战斗', pause).click();
    }
    if (wave === 2) break;
    await wait('选择战利品');
    if (wave === 0) {
      await capture('reward');
      const offered = (await read()).rewards;
      const review = await page.getByRole('region', { name: '本波战况' }).innerText();
      await page.reload();
      await button('继续战局').click();
      await wait('选择战利品');
      assert.deepEqual((await read()).rewards, offered);
      assert.equal(await page.getByRole('region', { name: '本波战况' }).innerText(), review);
    }
    await page.locator('[data-reward="watch"]').click();
    await place('松岗箭塔', wave === 0 ? 7 : 9, wave === 0 ? 3 : 5);
    if (wave === 1 && (await read()).keepHp < 30) await choose('余烬印记');
  }

  await wait('鸦渡守住了');
  assert.equal((await read()).defeated, 27);
  assert.equal((await read()).keepHp, 30);
  await capture('victory');
  await page.setViewportSize({ width: 390, height: 844 });
  const expedition = button('前往灰旗远征');
  assert.equal(await expedition.evaluate(element => document.activeElement === element), true);
  await capture('tutorial-victory-narrow');
  await page.keyboard.press('Enter');
  await wait('选择战局');
  assert.equal(await campaignChoice.inputValue(), 'march');
  assert.match(await page.locator('#campaign-detail').innerText(), /军粮.*断桥元帅/);
  const kingdom = page.getByRole('combobox', { name: '王国', exact: true });
  assert.equal(await kingdom.evaluate(element => document.activeElement === element), true);
  assert.equal(await page.locator('#overlay').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
  assert.equal(await button('继续战局').count(), 0);
  await capture('tutorial-expedition-narrow');
  await kingdom.selectOption('wild');
  await button('开始部署').click();
  assert.equal((await read()).campaign, 'march');
  assert.equal((await read()).kingdom, 'wild');
  assert.equal((await read()).wave, 0);
  assert.equal((await read()).buildings.length, 0);
  const objective = page.locator('#objective');
  assert.match(await objective.innerText(), /^北渡口、南渡口没有防御塔覆盖/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await place('松岗箭塔', 7, 3);
  assert.deepEqual(await coverage(), ['北渡口（第 3 行） · 1 座防御塔覆盖', '南渡口（第 5 行） · 无防御塔覆盖']);
  assert.match(await objective.innerText(), /^南渡口没有防御塔覆盖/);
  await capture('expedition-crossing-hint');
  await place('松岗箭塔', 7, 5);
  assert.match(await objective.innerText(), /^核对敌军编成/);
  await button('开始战斗').click();
  await button('暂停战斗').click();
  await button('返回主菜单', pause).click();
  await button('开始部署').click();
  await button('替换并开始').click();
  assert.equal((await read()).campaign, 'crowford');
  await page.setViewportSize({ width: 820, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture('narrow');
  await button('开始战斗').click();
  await wait('防线失守');
  assert.equal((await read()).keepHp, 0);
  assert.equal(await expedition.count(), 0);
  assert.match(await page.getByRole('region', { name: '本波战况' }).innerText(), /损失 30 生命。.*第 \d+ 列、第 \d+ 行发起最后一次攻击/s);
  await capture('wave-review-defeat');
  await button('重开同一战局').click();
  assert.equal((await read()).buildings.length, 0);
  assert.equal((await read()).keepHp, 30);
  await button('开始战斗').click();
  await wait('防线失守');

  await page.reload();
  assert.equal(await button('继续战局').count(), 0);
  await button('设置', page.locator('dialog')).click();
  assert.equal(await page.getByLabel('关闭音效').isChecked(), true);
  assert.equal(await page.locator('#volume').inputValue(), '37');
  await button('返回', page.locator('dialog')).click();
  await button('开始部署').click();
  const tactic = page.locator('#hand .card').filter({ hasText: '战术' }).first();
  const supply = await tactic.innerText();
  const before = await read();
  await tactic.click();
  const after = await read();
  assert.equal(after.discard.length, 1, supply);
  assert.equal(after.hand.length, before.hand.length - 1);
  assert.notDeepEqual(after.wallet, before.wallet);
  await page.reload();
  await button('继续战局').click();
  assert.deepEqual((await read()).discard, after.discard);
  assert.deepEqual((await read()).wallet, after.wallet);
  await button('开始战斗').click();
  await button('暂停战斗').click();
  await button('返回主菜单', pause).click();
  await Promise.all([page.waitForURL('about:blank'), button('退出游戏').click()]);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await button('继续战局').click();
  assert.deepEqual((await read()).wallet, after.wallet);
  await verifyLayoutChanges();
  assert.deepEqual(failures, []);
  console.log(`${channel} ${browser.version()} smoke test passed: tutorial, animation, wave review, settings, pause, checkpoints, victory, defeat, relocation, removal, and offline assets.`);
} finally {
  await browser.close();
  await server?.close();
}
