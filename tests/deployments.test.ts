import { describe, expect, it } from 'vitest';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { createRun, dispatch, step } from '../src/core/game';
import type { Run } from '../src/core/types';
import { cards, map } from '../src/data/content';
import { deposit, spend } from '../src/systems/economy';
import { buildingAt, route, same } from '../src/systems/grid';
import { crossingCoverage } from '../src/ui/crossing-coverage';
import { describeDeployment, describeRelocation } from '../src/ui/deployment-preview';
import { predictApproach } from '../src/ui/approach';

const place = (run: Run, id: string, x: number, y: number) =>
  dispatch(run, { kind: 'play', slot: run.hand.indexOf(id), tile: { x, y } }, []);
const undo = (run: Run) => dispatch(run, { kind: 'undo-deployment' }, []);
const relocate = (run: Run, id: number, x: number, y: number) =>
  dispatch(run, { kind: 'relocate', id, tile: { x, y } }, []);
const remove = (run: Run, id: number) => dispatch(run, { kind: 'remove-deployment', id }, []);

it('forecasts bridge changes and the first obstacle using the actual attack route', () => {
  const run = createRun(119);
  const bridgeHead = () => predictApproach(run).steps.find(tile => tile.x === map.riverX + 1)!;
  const first = bridgeHead();
  const before = encodeCheckpoint(run);
  const diversion = describeDeployment(run, run.hand.indexOf('wall'), first);
  expect(diversion.text).toContain('预计改道');
  expect(diversion.approach?.steps.some(tile => same(tile, first))).toBe(false);
  expect(encodeCheckpoint(run)).toBe(before);
  expect(place(run, 'wall', first.x, first.y).ok).toBe(true);

  const second = bridgeHead();
  expect(second.y).not.toBe(first.y);
  const sealed = describeDeployment(run, run.hand.indexOf('farm'), second);
  expect(sealed.text).toContain('通路将封闭');
  expect(sealed.approach?.obstacle).toMatchObject({ tile: second });
  expect(sealed.approach?.steps.at(-1)).toEqual(second);
  expect(place(run, 'farm', second.x, second.y).ok).toBe(true);
  expect(predictApproach(run)).toEqual(sealed.approach);

  const [wall, farm] = run.buildings;
  const opening = describeRelocation(run, farm.id, { x: 8, y: 1 });
  expect(opening.text).toContain('通路将开放');
  expect(opening.approach?.obstacle).toBeUndefined();
  expect(opening.approach?.steps.at(-1)).toEqual(map.keep);
  expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
  const [wallHp, farmHp] = [wall.hp, farm.hp];
  while (run.phase === 'battle' && run.tick < 200 && wall.hp === wallHp && farm.hp === farmHp) step(run, []);
  expect(wall.hp).toBe(wallHp);
  expect(farm.hp).toBeLessThan(farmHp);
});

it.each([
  { kingdom: 'iron', research: null, expectedHp: 16 },
  { kingdom: 'arcane', research: 'masonry', expectedHp: 14 },
  { kingdom: 'iron', research: 'masonry', expectedHp: 22 },
] as const)('forecasts the first breached building after repairs for $kingdom with $research', ({ kingdom, research, expectedHp }) => {
  const run = createRun(119, 'march', kingdom);
  run.research = research;
  expect(place(run, 'wall', 4, 2).ok).toBe(true);
  const [wall] = run.buildings;
  wall.hp = 8;
  const farmTile = { x: 4, y: 4 };
  const saved = encodeCheckpoint(run);
  const projected = describeDeployment(run, run.hand.indexOf('farm'), farmTile);
  expect(projected.approach?.obstacle).toMatchObject({ tile: farmTile, name: '河畔农圃' });
  expect(encodeCheckpoint(run)).toBe(saved);
  expect(place(run, 'farm', farmTile.x, farmTile.y).ok).toBe(true);
  expect(predictApproach(run)).toEqual(projected.approach);
  expect(wall.hp).toBe(8);

  expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
  const farm = run.buildings[1];
  const farmHp = farm.hp;
  expect(wall.hp).toBe(expectedHp);
  while (run.phase === 'battle' && run.tick < 200 && wall.hp === expectedHp && farm.hp === farmHp) step(run, []);
  expect(wall.hp).toBe(expectedHp);
  expect(farm.hp).toBeLessThan(farmHp);
});

it('reports bridge coverage from live structures and projects changes before deployment or relocation', () => {
  const run = createRun(1, 'march');
  const coverage = () => crossingCoverage(run).map(({ towers }) => towers);
  expect(crossingCoverage(run).map(({ row }) => row)).toEqual([3, 6]);
  expect(coverage()).toEqual([0, 0]);
  const preview = describeDeployment(run, run.hand.indexOf('watch'), { x: 4, y: 2 });
  expect(preview.text).toContain('北渡口覆盖 +1 座防御塔');
  expect(preview.text).not.toContain('南渡口覆盖');
  expect(coverage()).toEqual([0, 0]);

  expect(place(run, 'watch', 4, 2).ok).toBe(true);
  expect(place(run, 'wall', 4, 5).ok).toBe(true);
  const [tower] = run.buildings;
  expect(coverage()).toEqual([1, 0]);
  const transfer = describeRelocation(run, tower.id, { x: 5, y: 5 });
  expect(transfer.text).toContain('北渡口覆盖 −1 座防御塔');
  expect(transfer.text).toContain('南渡口覆盖 +1 座防御塔');
  expect(coverage()).toEqual([1, 0]);

  run.research = 'fletching';
  expect(coverage()).toEqual([1, 1]);
  run.research = null;
  expect(dispatch(run, { kind: 'upgrade', id: tower.id }, []).ok).toBe(true);
  expect(coverage()).toEqual([1, 1]);
  tower.hp = 0;
  expect(coverage()).toEqual([0, 0]);
});

it('shows the camp losing a slot even when a rally card keeps the total unchanged', () => {
  const run = createRun(119, 'march');
  expect(place(run, 'barracks', 5, 3).ok).toBe(true);
  expect(place(run, 'wall', 5, 4).ok).toBe(true);
  expect(place(run, 'farm', 6, 3).ok).toBe(true);
  expect(place(run, 'mine', 4, 3).ok).toBe(true);
  const before = encodeCheckpoint(run);
  const preview = describeDeployment(run, run.hand.indexOf('guard'), { x: 5, y: 2 });
  expect(preview.text).toContain('「鸢尾兵营」（6 列 4 行）出阵位 1 → 0');
  expect(preview.text).not.toContain('出阵位置');
  expect(encodeCheckpoint(run)).toBe(before);
  expect(place(run, 'guard', 5, 2).ok).toBe(true);
  const farm = run.buildings.find(item => item.def === 'farm')!;
  const relocation = describeRelocation(run, farm.id, { x: 7, y: 1 });
  expect(relocation.text).toContain('「鸢尾兵营」（6 列 4 行）出阵位 0 → 1');
});

it('forecasts whether a new farm will let a waiting unit deploy', () => {
  const run = createRun(119, 'march');
  expect(place(run, 'guard', 7, 3).ok).toBe(true);
  run.wallet.food = 0;
  const before = encodeCheckpoint(run);
  const farm = describeDeployment(run, run.hand.indexOf('farm'), { x: 4, y: 1 });
  expect(farm.text).toContain('预计出阵 0 → 1 支');
  expect(encodeCheckpoint(run)).toBe(before);
  expect(place(run, 'farm', 4, 1).ok).toBe(true);
  expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
  expect(run.waveReport?.deployed).toBe(1);
});

it('shows an additional rally position even when a shortage prevents it from deploying', () => {
  const run = createRun(119, 'march');
  run.wallet.food = cards.get('guard')!.cost.food ?? 0;
  const before = encodeCheckpoint(run);
  const rally = describeDeployment(run, run.hand.indexOf('guard'), { x: 7, y: 3 });
  expect(rally.text).toContain('出阵位置 +1 个');
  expect(rally.text).toContain('军粮不足，预计仍出阵 0 支');
  expect(encodeCheckpoint(run)).toBe(before);
  expect(place(run, 'guard', 7, 3).ok).toBe(true);
  expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
  expect(run.waveReport).toMatchObject({ deployed: 0, unfed: ['guard'] });
});

it('deducts the rally relocation fee from the food available for the next battle', () => {
  const run = createRun(119, 'march');
  expect(place(run, 'guard', 7, 3).ok).toBe(true);
  run.wallet.food = 1;
  const guard = run.rally[0];
  const before = encodeCheckpoint(run);
  const moving = describeRelocation(run, guard.id, { x: 8, y: 3 });
  expect(moving.text).toContain('迁移消耗 1 食物');
  expect(moving.text).toContain('预计出阵 1 → 0 支（军粮不足）');
  expect(encodeCheckpoint(run)).toBe(before);
  expect(relocate(run, guard.id, 8, 3).ok).toBe(true);
  expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
  expect(run.waveReport).toMatchObject({ deployed: 0, unfed: ['guard'] });
});

describe('rescind this round’s deployments', () => {
  it('recovers the exact card, cost and vacant tiles in reverse order across refresh', () => {
    const run = createRun(119, 'march', 'wild');
    const startHand = [...run.hand];
    const startWallet = { ...run.wallet };
    expect(place(run, 'storehouse', 5, 1).ok).toBe(true);
    expect(place(run, 'wild-grove', 6, 1).ok).toBe(false);
    expect(place(run, 'wild-grove', 4, 1).ok).toBe(true);
    expect(place(run, 'guard', 6, 3).ok).toBe(true);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;

    for (const id of ['guard', 'wild-grove', 'storehouse']) {
      const previous = { ...restored.wallet };
      expect(restored.deployments.at(-1)?.card).toBe(id);
      expect(undo(restored).ok).toBe(true);
      const costs = cards.get(id)!.cost;
      expect(restored.wallet).toEqual({ gold: previous.gold + (costs.gold ?? 0), food: previous.food + (costs.food ?? 0),
        wood: previous.wood + (costs.wood ?? 0), mana: previous.mana + (costs.mana ?? 0) });
    }
    expect(restored.rally).toEqual([]);
    expect(restored.buildings).toEqual([]);
    expect(restored.wallet).toEqual(startWallet);
    expect(restored.hand).toEqual(startHand);
    expect(undo(restored).ok).toBe(false);
    expect(place(restored, 'watch', 6, 1).ok).toBe(true);
  });

  it('retains a purchase and guards against overflow when withdrawing a two-tile warehouse', () => {
    const run = createRun(0, 'march', 'arcane');
    expect(place(run, 'storehouse', 5, 1).ok).toBe(true);
    expect(dispatch(run, { kind: 'buy', card: 'altar' }, []).ok).toBe(true);
    deposit(run.wallet, { gold: 30 }, run.buildings);
    const full = encodeCheckpoint(run);
    expect(undo(run)).toMatchObject({ ok: false, reason: expect.stringContaining('超出仓储上限') });
    expect(encodeCheckpoint(run)).toBe(full);
    spend(run.wallet, { gold: 12 });
    expect(undo(run).ok).toBe(true);
    expect(run.shopBought).toEqual(['altar']);
    expect(run.hand.filter(id => ['altar', 'storehouse'].includes(id)).sort()).toEqual(['altar', 'storehouse']);
    expect(buildingAt(run.buildings, { x: 6, y: 1 })).toBeUndefined();
    expect(decodeCheckpoint(encodeCheckpoint(run)!)).toEqual(run);
  });

  it('keeps paid upgrades and contributing laboratories committed while later placements can be undone', () => {
    const run = createRun(119, 'march');
    run.hand.push('lab');
    expect(place(run, 'watch', 5, 2).ok).toBe(true);
    expect(place(run, 'lab', 8, 1).ok).toBe(true);
    expect(place(run, 'guard', 6, 3).ok).toBe(true);
    expect(dispatch(run, { kind: 'upgrade', id: run.buildings[0].id }, []).ok).toBe(true);
    expect(undo(run).ok).toBe(true);
    expect(undo(run).ok).toBe(false);
    expect(run.buildings.map(building => [building.def, building.level])).toEqual([['watch', 2], ['lab', 1]]);
  });

  it('commits a building used for research or raised with the signature upgrade card', () => {
    const run = createRun(119, 'march');
    run.hand.push('lab');
    expect(place(run, 'lab', 8, 1).ok).toBe(true);
    expect(dispatch(run, { kind: 'research', topic: 'provisions' }, []).ok).toBe(true);
    expect(undo(run).ok).toBe(false);
    expect(place(run, 'wall', 6, 3).ok).toBe(true);
    expect(place(run, 'forge-seal', 6, 3).ok).toBe(true);
    expect(undo(run).ok).toBe(false);
    expect(run.buildings.map(building => [building.def, building.level])).toEqual([['lab', 1], ['wall', 2]]);
  });

  it('loads v8 construction intact and seals new placements when combat starts', () => {
    const run = createRun(119);
    expect(place(run, 'watch', 5, 2).ok).toBe(true);
    const old = JSON.parse(encodeCheckpoint(run)!);
    old.version = 8;
    delete old.run.deployments;
    const restored = decodeCheckpoint(JSON.stringify(old))!;
    expect(restored.buildings).toEqual(run.buildings);
    expect(restored.wallet).toEqual(run.wallet);
    expect(undo(restored).ok).toBe(false);
    expect(place(restored, 'watch', 5, 4).ok).toBe(true);
    expect(dispatch(restored, { kind: 'start' }, []).ok).toBe(true);
    expect(restored.deployments).toEqual([]);
    expect(undo(restored).ok).toBe(false);
  });
});

describe('rearrange positions during planning', () => {
  it('moves a paid, upgraded building from a previous wave without restoring its health, card or cost', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'watch', 5, 2).ok).toBe(true);
    const tower = run.buildings[0];
    expect(dispatch(run, { kind: 'upgrade', id: tower.id }, []).ok).toBe(true);
    expect(run.deployments).toEqual([]);
    run.wave = 1;
    tower.hp = 10;
    const before = { ...run.wallet };
    const hand = [...run.hand];
    const path = route(map.entry, map.keep, run.buildings, false, run.route)!;
    const destination = path.find(tile => tile.x === map.keep.x - 1 && tile.y === map.keep.y)!;
    expect(destination).toBeDefined();
    expect(relocate(run, tower.id, destination.x, destination.y).ok).toBe(true);
    expect(buildingAt(run.buildings, { x: 5, y: 2 })).toBeUndefined();
    expect(run.buildings[0]).toMatchObject({ id: tower.id, tile: destination, hp: 10, level: 2 });
    expect(route(map.entry, map.keep, run.buildings, false, run.route)?.some(tile => same(tile, destination))).toBe(false);
    expect(run.wallet).toEqual({ ...before, wood: before.wood - 1 });
    expect(run.hand).toEqual(hand);
    expect(decodeCheckpoint(encodeCheckpoint(run)!)).toEqual(run);
  });

  it('previews a warehouse slide over its own footprint, leaves other cells intact, and keeps the original undo', () => {
    const run = createRun(119, 'march');
    const initial = { ...run.wallet };
    expect(place(run, 'storehouse', 5, 1).ok).toBe(true);
    const { id } = run.buildings[0];
    const before = encodeCheckpoint(run);
    expect(describeRelocation(run, id, { x: 6, y: 1 })).toEqual({
      tiles: [{ x: 6, y: 1 }, { x: 7, y: 1 }], valid: true, text: '占地 2 格 · 迁移消耗 1 木材',
    });
    expect(encodeCheckpoint(run)).toBe(before);
    expect(relocate(run, id, 6, 1).ok).toBe(true);
    expect(buildingAt(run.buildings, { x: 5, y: 1 })).toBeUndefined();
    expect(buildingAt(run.buildings, { x: 7, y: 1 })?.id).toBe(id);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(undo(restored).ok).toBe(true);
    expect(restored.hand).toEqual(createRun(119, 'march').hand);
    expect(restored.wallet).toEqual({ ...initial, wood: initial.wood - 1 });
  });

  it('previews the real change in production and rejects invalid relocation without paying', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'farm', 4, 1).ok).toBe(true);
    expect(place(run, 'guard', 7, 3).ok).toBe(true);
    const [farm] = run.buildings;
    const [guard] = run.rally;
    const before = encodeCheckpoint(run);
    expect(describeRelocation(run, farm.id, { x: 8, y: 1 }).text).toContain('开战前产出 −1 食物');
    expect(relocate(run, farm.id, 4, 1)).toMatchObject({ ok: false, reason: expect.stringContaining('原址') });
    expect(relocate(run, farm.id, 7, 3)).toMatchObject({ ok: false, reason: expect.stringContaining('占用') });
    expect(relocate(run, guard.id, 6, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('第 2 波') });
    expect(relocate(run, guard.id, 3, 2).ok).toBe(false);
    expect(relocate(run, farm.id, .5, 1).ok).toBe(false);
    expect(encodeCheckpoint(run)).toBe(before);
    run.wallet.food = 0;
    expect(relocate(run, guard.id, 8, 3)).toMatchObject({ ok: false, reason: expect.stringContaining('资源不足') });
    run.wallet.food = 1;
    expect(relocate(run, guard.id, 8, 3).ok).toBe(true);
    expect(run.rally).toEqual([{ ...guard, tile: { x: 8, y: 3 } }]);
    expect(run.wallet.food).toBe(0);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    expect(relocate(run, guard.id, 9, 3).ok).toBe(false);
    expect(remove(run, farm.id).ok).toBe(false);
  });

  it('keeps special site restrictions and previews lost arcane synergy', () => {
    const run = createRun(0, 'march', 'arcane');
    run.hand.push('altar', 'arcanetower');
    expect(place(run, 'altar', 6, 2).ok).toBe(true);
    expect(place(run, 'arcanetower', 7, 2).ok).toBe(true);
    const altar = run.buildings[0];
    expect(relocate(run, altar.id, 7, 1)).toMatchObject({ ok: false, reason: expect.stringContaining('灵脉') });
    const preview = describeRelocation(run, altar.id, { x: 8, y: 4 });
    expect(preview).toMatchObject({ valid: true, text: expect.stringContaining('削弱 1 座法术塔') });
    expect(relocate(run, altar.id, 8, 4).ok).toBe(true);
    expect(decodeCheckpoint(encodeCheckpoint(run)!)).toEqual(run);
  });

  it('guards stored resources and removes only the chosen placement, leaving unrelated undo entries', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'storehouse', 5, 1).ok).toBe(true);
    expect(place(run, 'watch', 5, 2).ok).toBe(true);
    expect(place(run, 'guard', 6, 3).ok).toBe(true);
    const [storehouse, tower] = run.buildings;
    const [guard] = run.rally;
    deposit(run.wallet, { food: 30 }, run.buildings);
    const full = encodeCheckpoint(run);
    expect(remove(run, storehouse.id)).toMatchObject({ ok: false, reason: expect.stringContaining('仓储上限') });
    expect(encodeCheckpoint(run)).toBe(full);
    run.wallet.food = map.capacity.food;
    const acted = { ...run.wallet };
    const hand = [...run.hand];
    expect(remove(run, storehouse.id).ok).toBe(true);
    expect(remove(run, guard.id).ok).toBe(true);
    expect(remove(run, guard.id).ok).toBe(false);
    expect(run.wallet).toEqual(acted);
    expect(run.hand).toEqual(hand);
    expect(run.deployments.map(record => record.id)).toEqual([tower.id]);
    expect(run.rally).toHaveLength(0);
    expect(buildingAt(run.buildings, { x: 6, y: 1 })).toBeUndefined();
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(undo(restored).ok).toBe(true);
    expect(restored.hand).not.toContain('storehouse');
    expect(restored.hand).not.toContain('guard');
  });
});
