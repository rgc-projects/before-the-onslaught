import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
let browser;

try {
  const profile = process.env.NINE_KINGDOMS_PROFILE === '1';
  browser = await chromium.launch({ channel: 'msedge', args: profile ? ['--enable-precise-memory-info'] : [] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const timings = [];
  if (profile) await page.addInitScript(() => {
    const frames = [];
    const heaps = [];
    let previous = 0;
    let nextSample = 0;
    let measuring = false;
    function frame(at) {
      const phase = document.getElementById('phase');
      if (measuring && !document.hidden && phase?.dataset.phase === 'battle' && phase.textContent !== '已暂停') {
        if (previous) frames.push(at - previous);
        previous = at;
        if (at >= nextSample) {
          if (performance.memory) heaps.push(performance.memory.usedJSHeapSize / 1024 ** 2);
          nextSample = at + 1000;
        }
      } else previous = 0;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.combatProfile = {
      start() { frames.length = 0; heaps.length = 0; previous = 0; nextSample = 0; measuring = true; },
      finish() {
        measuring = false;
        const ordered = [...frames].sort((left, right) => left - right);
        const percentile = percent => Number((ordered[Math.max(0, Math.ceil(ordered.length * percent) - 1)] ?? 0).toFixed(1));
        return { frames: frames.length, seconds: Number((frames.reduce((sum, frame) => sum + frame, 0) / 1000).toFixed(1)),
          p50ms: percentile(.5), p95ms: percentile(.95), over33ms: frames.filter(frame => frame > 33.4).length,
          heapFirstMiB: heaps.length ? Number(heaps[0].toFixed(1)) : null,
          heapLastMiB: heaps.length ? Number(heaps.at(-1).toFixed(1)) : null,
          heapPeakMiB: heaps.length ? Number(Math.max(...heaps).toFixed(1)) : null };
      },
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
  page.on('request', request => { if (!request.url().startsWith(url)) errors.push(request.url()); });
  const button = name => page.getByRole('button', { name, exact: true });
  const cell = (x, y) => page.getByRole('button', { name: new RegExp(`^${x + 1}列${y + 1}行 `) });
  const hand = id => page.locator(`#hand [data-card="${id}"]`).first();
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const place = async (id, x, y) => { await hand(id).click(); await cell(x, y).click(); };
  const wait = name => page.getByRole('heading', { name, exact: true }).waitFor({ timeout: 50000 });

  await mkdir('test-results', { recursive: true });
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
  for (const [faction, name, signature] of [
    ['arcane', '奥术王国', 'star-mason'],
    ['wild', '自然王国', 'wild-grove'],
    ['war', '战争王国', 'swift-company'],
  ]) {
    await page.getByLabel('战役').selectOption('march');
    await page.getByRole('combobox', { name: '王国', exact: true }).selectOption(faction);
    if (faction === 'arcane') await page.locator('#seed-input').fill('0');
    if (faction === 'wild') await page.locator('#seed-input').fill('1');
    if (faction === 'war') await page.locator('#seed-input').fill('9');
    await button('开始部署').click();
    if (faction !== 'arcane') await button('替换并开始').click();
    assert.equal((await read()).kingdom, faction);
    assert.equal(await page.locator('#app').getAttribute('data-kingdom'), faction);
    assert.match(await page.locator('#campaign-name').innerText(), new RegExp(name));
    assert.equal(await hand(signature).count(), 1);
    if (faction === 'arcane') {
      await button('军令商店').click();
      await page.locator('[data-offer="altar"]').click();
      await page.locator('[data-offer="arcanetower"]').click();
      await button('返回部署').click();
      await place('altar', 5, 3);
      assert.match(await page.locator('#notice').innerText(), /需要建在标记的灵脉上/);
      await cell(6, 2).click();
      await cell(6, 2).click();
      assert.match(await page.locator('#inspect-text').innerText(), /产出 2 魔力/);
      await hand('arcanetower').click();
      await cell(7, 2).hover();
      assert.match(await page.locator('#placement-preview').innerText(), /每次攻击伤害 8/);
      await cell(7, 2).click();
      await cell(7, 2).click();
      assert.match(await page.locator('#inspect-text').innerText(), /伤害 8/);
      assert.match(await page.locator('#forecast').innerText(), /3 魔力/);
      await cell(6, 2).click();
      assert.match(await page.locator('#inspect-text').innerText(), /开战前产出 3 魔力/);
      await page.screenshot({ path: 'test-results/march-altar.png', fullPage: true });
    }
    if (faction === 'wild') {
      assert.equal((await read()).route, 'shoal');
      assert.equal(await page.getByRole('button', { name: '4列6行 桥', exact: true }).count(), 1);
      await place('wild-grove', 4, 1);
      await cell(4, 1).click();
      assert.match(await page.locator('#inspect-text').innerText(), /开战前产出 5 食物、2 金币/);
      await button('迁移 · 1 木材').click();
      await cell(6, 1).click();
      assert.match(await page.locator('#inspect-text').innerText(), /开战前产出 4 食物、2 金币/);
      await page.getByRole('button', { name: /^升级 ·/ }).click();
      assert.match(await page.locator('#inspect-text').innerText(), /开战前产出 6 食物、2 金币/);
      await page.locator('.orders').screenshot({ path: 'test-results/farm-production.png' });
    }
    if (faction === 'war') {
      await button('军令商店').click();
      await page.locator('[data-offer="lab"]').click();
      await button('返回部署').click();
      await place('lab', 8, 1);
      await cell(8, 1).click();
      await button('选择科技').click();
      await page.locator('[data-topic="provisions"]').click();
      assert.match(await page.locator('#forecast').innerText(), /3 食物/);
    }
    await page.reload();
    await button('继续战局').click();
    assert.equal((await read()).kingdom, faction);
    if (faction === 'arcane') assert.deepEqual((await read()).buildings.map(item => item.def), ['altar', 'arcanetower']);
    if (faction === 'wild') {
      await cell(6, 1).click();
      assert.match(await page.locator('#inspect-text').innerText(), /开战前产出 6 食物、2 金币/);
    }
    if (faction === 'war') assert.equal((await read()).research, 'provisions');
    await page.reload();
  }
  await page.getByLabel('战役').selectOption('march');
  await button('开始部署').click();
  await button('替换并开始').click();
  assert.equal((await read()).kingdom, 'iron');
  assert.equal(await hand('forge-seal').count(), 1);
  await button('查看战术牌').click();
  const tacticDialog = page.locator('#overlay');
  assert.equal(await tacticDialog.locator('.refine-row').count(), 3);
  assert.equal(await tacticDialog.locator('[data-refine-action]').count(), 0);
  assert.match(await tacticDialog.innerText(), /打完首波可强化或移除/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-title');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'refine');
  await cell(6, 0).click();
  assert.match(await page.locator('#inspect-text').innerText(), /第 2 波备战时开放/);
  await hand('watch').click();
  await cell(6, 0).click();
  assert.match(await page.locator('#notice').innerText(), /北岭外营将在第 2 波/);
  assert.equal((await read()).buildings.length, 0);
  await page.keyboard.press('Escape');
  await cell(8, 4).click();
  assert.match(await page.locator('#inspect-text').innerText(), /适合建造月环祭坛/);
  await page.screenshot({ path: 'test-results/march-frontier.png', fullPage: true });
  await hand('storehouse').click();
  await cell(7, 1).hover();
  assert.equal(await page.locator('#tiles [data-valid="yes"]').count(), 2);
  assert.match(await page.locator('#placement-preview').innerText(), /占地 2 格/);
  await page.screenshot({ path: 'test-results/deployment-footprint.png', fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#tiles [data-valid]').count(), 0);
  await hand('farm').click();
  await cell(4, 1).hover();
  assert.match(await page.locator('#placement-preview').innerText(), /\+3 食物/);
  await page.keyboard.press('Escape');
  const initial = [
    ['watch', 5, 2], ['watch', 5, 4], ['farm', 4, 1], ['mine', 5, 1], ['barracks', 6, 3], ['bowcamp', 7, 3],
  ];
  for (const [id, x, y] of initial) await place(id, x, y);
  assert.equal((await read()).buildings.length, initial.length);
  assert.match(await page.locator('#forecast').innerText(), /出阵 3 \/ 3 支/);
  await cell(6, 3).click();
  assert.match(await page.locator('#inspect-text').innerText(), /出阵位置 1 \/ 1/);
  assert.equal(await page.locator('#tiles [data-muster="true"]').count(), 1);
  assert.equal(await cell(6, 2).getAttribute('data-muster'), 'true');
  await page.screenshot({ path: 'test-results/march-deployment.png', fullPage: true });

  let sawPurchase = false;
  for (let wave = 0; wave < 6; wave++) {
    if (wave === 1) {
      for (const y of [2, 4]) {
        await cell(5, y).click();
        await page.getByRole('button', { name: /^升级 ·/ }).click();
      }
      await page.reload();
      await button('继续战局').click();
      assert.equal((await read()).buildings.filter(building => building.level === 2).length, 2);
      assert.equal(await cell(6, 0).getAttribute('data-locked'), null);
      assert.equal(await cell(6, 6).getAttribute('data-locked'), '');
      await button('沿途 · 旧门匠人').click();
      await page.screenshot({ path: 'test-results/march-encounter.png', fullPage: true });
      await page.locator('[data-choice="stone"]').click();
      assert.equal(await button('旧门楔石').count(), 1);
      await page.reload();
      await button('继续战局').click();
      assert.equal(await button('沿途 · 旧门匠人').count(), 0);
      assert.deepEqual((await read()).relics, ['gate-keystone']);
    }
    if (wave === 3) {
      assert.equal(await cell(6, 6).getAttribute('data-locked'), null);
      await button('沿途 · 桥市行商').click();
      await page.locator('[data-choice="crates"]').click();
    }
    if (wave === 4) {
      await page.setViewportSize({ width: 390, height: 844 });
      await button('整理战术牌').click();
      const improve = tacticDialog.locator('[data-refine-action="improve"]:enabled').first();
      const current = await read();
      const id = await improve.getAttribute('data-refine-card');
      const piles = [['hand', '手牌'], ['deck', '牌库'], ['discard', '弃牌']];
      const target = piles.find(([pile]) => current[pile].includes(id));
      const row = tacticDialog.locator(`[data-tactic="${id}"]`);
      const expectedPiles = piles.map(([key, name]) => `${name} ${current[key].filter(card => card === id).length}`).join(' · ');
      assert.equal(await row.locator('.refine-piles').innerText(), expectedPiles);
      assert.match(await row.locator('.refine-preview').innerText(), /^强化为/);
      assert.match(await improve.innerText(), new RegExp(`^强化${target[1]}`));
      assert.equal(await tacticDialog.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
      await page.screenshot({ path: 'test-results/march-tactics.png' });
      await improve.click();
      const improved = await read();
      assert.equal(improved[target[0]][current[target[0]].indexOf(id)], `${id}-plus`);
      assert.equal(improved.wallet.gold, current.wallet.gold - 4);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'refine-result');
      assert.match(await page.locator('#refine-result').innerText(), /已将.*强化为.*4 金币/);
      await page.locator('[data-refine-action="retire"]:enabled').first().click();
      assert.match(await page.locator('#retired-tactics').innerText(), /本局已移除/);
      await button('返回部署').click();
      await page.setViewportSize({ width: 1440, height: 950 });
      const tactics = await read();
      assert.equal(tactics.retired.length, 1);
      assert.ok([...tactics.hand, ...tactics.deck, ...tactics.discard, ...tactics.retired].some(id => id.endsWith('-plus')));
    }
    let snapshot = await read();
    if (snapshot.keepHp < 24 && snapshot.hand.includes('ember')) await hand('ember').click();
    if (wave > 0) {
      for (const [id, x, y] of [
        ['arcanetower', 7, 2], ['magetower', 8, 2], ['bombard', 8, 4], ['sentinel', 7, 4],
        ['shrine', 7, 1], ['hall', 8, 5], ['wall', 4, 4], ['stable', 6, 5], ['watch', 6, 4],
      ]) {
        snapshot = await read();
        const occupied = [...snapshot.buildings, ...snapshot.rally].some(item => item.tile.x === x && item.tile.y === y);
        if (occupied) continue;
        if (!snapshot.hand.includes(id)) {
          await button('军令商店').click();
          const offer = page.locator(`[data-offer="${id}"]`);
          if (await offer.count() && await offer.isEnabled()) {
            await offer.click();
            sawPurchase = true;
            assert.equal(await offer.isDisabled(), true);
          }
          await button('返回部署').click();
        }
        if (await hand(id).count()) {
          await place(id, x, y);
          if ((await read()).hand.includes(id)) await page.keyboard.press('Escape');
        }
      }
    }
    if (profile) await page.evaluate(() => window.combatProfile.start());
    await button('开始战斗').click();
    if (wave === 5) {
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).actors.some(actor => actor.def === 'marshal'), { timeout: 20000 });
      assert.equal(await page.locator('#battle-alert').innerText(), '断桥元帅已进入战场');
      assert.equal(await page.locator('#battle-alert').isVisible(), true);
      const marshal = (await read()).actors.find(actor => actor.def === 'marshal');
      const x = Math.round(marshal.tile.x + ((marshal.to?.x ?? marshal.tile.x) - marshal.tile.x) * marshal.travel);
      const y = Math.round(marshal.tile.y + ((marshal.to?.y ?? marshal.tile.y) - marshal.tile.y) * marshal.travel);
      await cell(x, y).click();
      assert.equal(await page.locator('#inspect-title').innerText(), '断桥元帅');
      assert.match(await page.locator('#inspect-text').innerText(), /敌军 · 生命 \d+ \/ 88 · 攻击 9 · 护甲 2/);
      await page.screenshot({ path: 'test-results/march-marshal.png', fullPage: true });
      break;
    }
    await wait('选择战利品');
    if (profile) timings.push({ wave: wave + 1, ...await page.evaluate(() => window.combatProfile.finish()) });
    const offers = (await read()).rewards;
    const chosen = ['arcanetower', 'magetower', 'bombard', 'watch', 'shrine', 'sentinel', 'ember'].find(id => offers.includes(id)) ?? offers[0];
    await page.locator(`[data-reward="${chosen}"]`).click();
  }
  await wait('远征告捷');
  if (profile) {
    timings.push({ wave: 6, ...await page.evaluate(() => window.combatProfile.finish()) });
    assert.equal(timings.length, 6);
    assert.ok(timings.every(row => row.frames > 0));
    console.table(timings);
    console.log(`Edge ${browser.version()} · 1440 × 950 · 100 ms simulation step · animation-frame timing and approximate JS heap`);
  }
  assert.equal((await read()).defeated, 74);
  assert.equal(sawPurchase, true);
  assert.equal(await page.locator('#merit-earned').innerText(), '远征功勋 +3');
  assert.equal(await page.locator('#merit-unlocked').innerText(), '本次解锁 仓储许可');
  assert.match(await page.locator('#merit-next').innerText(), /再获 1 功勋.*治疗师军令/);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/march-victory.png', fullPage: true });
  const [victoryFile] = await Promise.all([page.waitForEvent('download'), button('保存战报').click()]);
  assert.equal(victoryFile.suggestedFilename(), 'before-the-onslaught-iron-119-wave-6.txt');
  const victoryReport = await readFile(await victoryFile.path(), 'utf8');
  assert.match(victoryReport, /第 6 \/ 6 波 · 通关 · 城堡生命 \d+ \/ 30 · 累计击退 74 名敌军/);
  await button('换种子再出征').click();
  assert.equal(await page.getByLabel('战役').inputValue(), 'march');
  assert.equal(await page.getByLabel('王国', { exact: true }).inputValue(), 'iron');
  assert.notEqual(await page.getByLabel('战局种子').inputValue(), '119');
  assert.match(await page.locator('#seed-route').innerText(), /^远征路线/);
  await button('远征纪事').click();
  assert.match(await page.locator('dialog').innerText(), /功勋 3 · 出征 1 · 胜利 1/);
  await button('返回主菜单').click();
  await page.getByLabel('战役').selectOption('march');
  await page.getByRole('combobox', { name: '传承', exact: true }).selectOption('storehouse');
  await button('开始部署').click();
  assert.equal((await read()).charter, 'storehouse');
  assert.equal(await page.locator('#hand [data-card="storehouse"]').count(), 2);
  assert.equal((await read()).seed, 119);
  await place('wall', 4, 2);
  await page.evaluate(() => {
    const key = 'nine-kingdoms-run-v1';
    const saved = JSON.parse(localStorage.getItem(key));
    saved.run.buildings.find(building => building.def === 'wall').hp = 8;
    const damaged = JSON.stringify(saved);
    localStorage.setItem(key, damaged);
    localStorage.setItem('nine-kingdoms-run-backup-v1', damaged);
  });
  await page.reload();
  await button('继续战局').click();
  await cell(4, 2).click();
  assert.match(await page.locator('#inspect-text').innerText(), /耐久 8 \/ 24.*开战前修至 16 耐久/);
  const beforeBreach = await read();
  await hand('farm').click();
  await cell(4, 4).hover();
  assert.match(await page.locator('#placement-preview').innerText(), /预计破障点 5 列 5 行 · 河畔农圃/);
  assert.deepEqual(await read(), beforeBreach);
  await cell(4, 4).click();
  assert.match(await page.locator('#approach-obstacle').innerText(), /预计破障点 5 列 5 行 · 河畔农圃/);
  await cell(4, 2).click();
  await page.screenshot({ path: 'test-results/repaired-breach.png', fullPage: true });
  await button('开始战斗').click();
  await page.waitForFunction(() => {
    const run = JSON.parse(window.render_game_to_text());
    return run.buildings.find(building => building.def === 'farm')?.hp < 10;
  }, undefined, { timeout: 25000 });
  assert.equal((await read()).buildings.find(building => building.def === 'wall').hp, 16);
  assert.deepEqual(errors, []);
  console.log('Edge march passed: routes, repaired breach, district unlocks, altar synergy, kingdoms, deck changes, six real-time waves, victory and account unlock.');
} finally {
  await browser?.close();
  await server.close();
}
