import { describe, expect, it } from 'vitest';
import type { Point, Run } from '../src/core/types';
import { kingdomIds } from '../src/core/types';
import { createRun, dispatch } from '../src/core/game';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { kingdoms } from '../src/data/content';
import { planMuster } from '../src/systems/buildings';
import { tickBattle } from '../src/systems/combat';
import { shopStock } from '../src/systems/shop';

function play(run: Run, card: string, tile?: Point) {
  return dispatch(run, { kind: 'play', slot: run.hand.indexOf(card), tile }, []);
}

describe('kingdom rules', () => {
  it('gives each kingdom only its own signature card and remembers the choice', () => {
    for (const id of kingdomIds) {
      const run = createRun(119, 'march', id);
      expect(run.hand.filter(card => kingdomIds.some(key => kingdoms[key].signature === card)))
        .toEqual([kingdoms[id].signature]);
      expect(decodeCheckpoint(encodeCheckpoint(run)!)?.kingdom).toBe(id);
    }
    expect(createRun(119).kingdom).toBeNull();
  });

  it('charges the fortify card instead of standard upgrade cost, and restores damaged walls on muster', () => {
    const run = createRun(119, 'march', 'iron');
    const target = { x: 4, y: 4 };
    expect(play(run, 'wall', target).ok).toBe(true);
    const wall = run.buildings[0];
    wall.hp = 5;
    const wood = run.wallet.wood;
    expect(play(run, 'forge-seal', { x: 8, y: 4 }).ok).toBe(false);
    expect(run.wallet.wood).toBe(wood);
    expect(play(run, 'forge-seal', target).ok).toBe(true);
    expect(run.wallet.wood).toBe(wood - 1);
    expect(wall.level).toBe(2);
    expect(wall.hp).toBe(21);
    dispatch(run, { kind: 'start' }, []);
    expect(wall.hp).toBe(29);
  });

  it('changes actual projectile damage in the arcane kingdom', () => {
    for (const [kingdom, expected] of [['iron', 5], ['arcane', 7]] as const) {
      const run = createRun(119, 'march', kingdom);
      run.hand.push('arcanetower');
      expect(play(run, 'arcanetower', { x: 7, y: 3 }).ok).toBe(true);
      run.actors.push({ id: 90, def: 'breaker', side: 'enemy', tile: { x: 8, y: 3 }, hp: 23, travel: 0, cooldown: 50 });
      tickBattle(run, []);
      expect(run.shots[0].damage).toBe(expected);
    }
  });

  it('limits wall armor and ripostes to living steel infantry, with a cooldown and no projectile reflection', () => {
    const run = createRun(119, 'march', 'iron');
    expect(play(run, 'wall', { x: 6, y: 2 }).ok).toBe(true);
    const guard = { id: 70, def: 'guard', side: 'ally' as const, tile: { x: 6, y: 3 }, hp: 21, travel: 0, cooldown: 50 };
    const raider = { id: 71, def: 'raider', side: 'enemy' as const, tile: { x: 5, y: 3 }, hp: 12, travel: 0, cooldown: 0 };
    run.actors.push(guard, raider);
    tickBattle(run, []);
    expect([guard.hp, raider.hp]).toEqual([20, 8]);
    raider.cooldown = 0;
    tickBattle(run, []);
    expect([guard.hp, raider.hp]).toEqual([19, 8]);
    for (let tick = 0; tick < 7; tick++) tickBattle(run, []);
    run.shots.push({ from: raider.tile, end: guard.tile, target: { kind: 'actor', id: guard.id }, damage: 5, hostile: true, ticks: 1, duration: 1 });
    raider.cooldown = 50;
    tickBattle(run, []);
    expect([guard.hp, raider.hp]).toEqual([17, 8]);
    run.buildings[0].hp = 0;
    raider.cooldown = 0;
    tickBattle(run, []);
    expect([guard.hp, raider.hp]).toEqual([15, 8]);
  });

  it('gets more food from the same farm and a different price for the signature farm', () => {
    const wild = createRun(119, 'march', 'wild');
    const iron = createRun(119, 'march', 'iron');
    expect(play(wild, 'wild-grove', { x: 4, y: 1 }).ok).toBe(true);
    expect(play(iron, 'farm', { x: 4, y: 1 }).ok).toBe(true);
    expect(wild.wallet.food).toBe(8);
    dispatch(wild, { kind: 'start' }, []);
    dispatch(iron, { kind: 'start' }, []);
    expect(wild.wallet.food).toBe(13);
    expect(iron.wallet.food).toBe(13);
    expect(wild.wallet.gold - iron.wallet.gold).toBe(2);
  });

  it('musters a second cavalry formation only for war and only with enough food', () => {
    for (const [kingdom, count] of [['iron', 1], ['war', 2]] as const) {
      const run = createRun(119, 'march', kingdom);
      run.hand.push('stable');
      expect(play(run, 'stable', { x: 6, y: 3 }).ok).toBe(true);
      expect(planMuster(run, 10).fed).toBe(count);
      expect(planMuster(run, 2)).toMatchObject({ fed: count, food: 2 });
      expect(planMuster(run, 1).fed).toBe(kingdom === 'war' ? 1 : 0);
      expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
      expect(run.actors.map(actor => actor.def)).toEqual(Array(count).fill('lancer'));
      expect(run.wallet.food).toBe(8);
    }
  });

  it('hits orthogonal and diagonal enemies once on a war charge without reaching two cells or friendly troops', () => {
    for (const [kingdom, direct, orthogonal, diagonal] of [['iron', 14, 23, 23], ['war', 12, 22, 21]] as const) {
      const run = createRun(119, 'march', kingdom);
      run.actors = [
        { id: 70, def: 'lancer', side: 'ally', tile: { x: 7, y: 3 }, hp: 23, travel: 0, cooldown: 0, charge: true },
        { id: 71, def: 'raider', side: 'enemy', tile: { x: 6, y: 3 }, hp: 23, travel: 0, cooldown: 50 },
        { id: 72, def: 'breaker', side: 'enemy', tile: { x: 6, y: 4 }, hp: 23, travel: 0, cooldown: 50 },
        { id: 73, def: 'guard', side: 'ally', tile: { x: 7, y: 3 }, hp: 21, travel: 0, cooldown: 50 },
        { id: 74, def: 'raider', side: 'enemy', tile: { x: 5, y: 2 }, hp: 23, travel: 0, cooldown: 50 },
        { id: 75, def: 'raider', side: 'enemy', tile: { x: 6, y: 5 }, hp: 23, travel: 0, cooldown: 50 },
      ];
      tickBattle(run, []);
      expect(run.actors.map(actor => actor.hp)).toEqual([23, direct, orthogonal, 21, diagonal, 23]);
      expect(run.actors[0].charge).toBe(false);
    }
  });

  it('resumes pre-kingdom march saves without moving buildings or resetting purchased stock', () => {
    const run = createRun(119, 'march');
    const [offer] = shopStock(run);
    expect(dispatch(run, { kind: 'buy', card: offer }, []).ok).toBe(true);
    expect(play(run, 'storehouse', { x: 6, y: 1 }).ok).toBe(true);
    expect(dispatch(run, { kind: 'upgrade', id: run.buildings[0].id }, []).ok).toBe(true);
    const old = JSON.parse(encodeCheckpoint(run)!);
    old.version = 3;
    delete old.run.kingdom;
    old.run.hand = old.run.hand.filter((card: string) => card !== 'forge-seal');
    const loaded = decodeCheckpoint(JSON.stringify(old));
    expect(loaded?.kingdom).toBe('iron');
    expect(loaded?.buildings).toEqual(run.buildings);
    expect(loaded?.wallet).toEqual(run.wallet);
    expect(loaded?.shopBought).toEqual([offer]);
    expect(loaded?.hand).not.toContain('forge-seal');
  });
});
