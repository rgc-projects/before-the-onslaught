import { describe, expect, it } from 'vitest';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { createRun, dispatch, step } from '../src/core/game';
import type { Run } from '../src/core/types';
import { planMuster } from '../src/systems/buildings';
import { supplyDialog } from '../src/ui/supply';

const point = (x: number, y: number) => ({ x, y });
const place = (run: Run, card: string, x: number, y: number) =>
  dispatch(run, { kind: 'play', slot: run.hand.indexOf(card), tile: point(x, y) }, []);
const prioritize = (run: Run, id: number | null) => dispatch(run, { kind: 'supply-priority', id }, []);

describe('muster supply priority', () => {
  it('moves a flexible camp recruit so a second camp can use its only legal exit', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'barracks', 7, 2).ok).toBe(true);
    expect(place(run, 'wall', 8, 4).ok).toBe(true);
    expect(place(run, 'guard', 7, 3).ok).toBe(true);
    const barracks = run.buildings[0].id;
    expect(planMuster(run, 3).deployments.get(barracks)?.cells).toEqual([point(8, 2)]);

    expect(place(run, 'bowcamp', 8, 3).ok).toBe(true);
    const bowcamp = run.buildings[2].id;
    const forecast = planMuster(run, 3);
    expect(forecast.deployments.get(barracks)?.cells).toEqual([point(7, 1)]);
    expect(forecast.deployments.get(bowcamp)?.cells).toEqual([point(8, 2)]);
    expect(forecast).toMatchObject({ fed: 3, ready: 3, food: 3, blocked: 0 });

    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(planMuster(restored, 3).deployments).toEqual(forecast.deployments);
    restored.wallet.food = 3;
    expect(dispatch(restored, { kind: 'start' }, []).ok).toBe(true);
    expect(restored.actors.map(({ def, tile }) => ({ def, tile }))).toEqual(
      forecast.recruited.map(({ def, tile }) => ({ def, tile })));
  });

  it('funds the chosen group first without changing reserved tiles or the fully funded actor order', () => {
    const run = createRun(119, 'march', 'war');
    expect(place(run, 'guard', 9, 4).ok).toBe(true);
    expect(place(run, 'barracks', 7, 3).ok).toBe(true);
    expect(place(run, 'bowcamp', 7, 4).ok).toBe(true);
    const camp = run.buildings[1].id;
    const affordable = planMuster(run, Infinity).recruited;
    const normal = planMuster(run, 2);
    expect(normal.recruited.map(unit => unit.def)).toEqual(['guard', 'spear']);
    expect(prioritize(run, camp).ok).toBe(true);
    const priority = planMuster(run, 2);
    expect(priority.recruited.map(unit => unit.def)).toEqual(['archer', 'archer']);
    expect(priority.groups.get(camp)).toMatchObject({ ready: 2, fed: 2 });
    expect(priority.unfed).toEqual(['guard', 'spear']);
    expect(priority.deployments).toEqual(normal.deployments);
    expect(planMuster(run, Infinity).recruited).toEqual(affordable);

    run.wallet.food = 2;
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    expect(run.actors.map(unit => ({ def: unit.def, tile: unit.tile }))).toEqual(
      priority.recruited.map(unit => ({ def: unit.def, tile: unit.tile })));
    expect(run.waveReport).toMatchObject({ foodAvailable: 2, foodSpent: 2, deployed: 2, unfed: ['guard', 'spear'] });
    expect(prioritize(run, null).ok).toBe(false);
  });

  it('skips an unaffordable priority troop and still supplies a cheaper one', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'guard', 9, 4).ok).toBe(true);
    run.hand.push('sentinel');
    expect(place(run, 'sentinel', 8, 4).ok).toBe(true);
    const sentinel = run.rally[1].id;
    expect(prioritize(run, sentinel).ok).toBe(true);
    expect(planMuster(run, 1).recruited.map(unit => unit.def)).toEqual(['guard']);
    expect(planMuster(run, 2).recruited.map(unit => unit.def)).toEqual(['sentinel']);
    expect(prioritize(run, null).ok).toBe(true);
    expect(planMuster(run, 2).recruited.map(unit => unit.def)).toEqual(['guard']);
  });

  it('describes a change in troop makeup even when total muster and food are unchanged', () => {
    const run = createRun(119, 'march', 'war');
    expect(place(run, 'guard', 9, 4).ok).toBe(true);
    expect(place(run, 'barracks', 7, 3).ok).toBe(true);
    expect(place(run, 'bowcamp', 7, 4).ok).toBe(true);
    const camp = run.buildings[1].id;
    const before = planMuster(run, 2);
    const saved = encodeCheckpoint(run);
    const html = supplyDialog(run, before);
    expect(html).toContain(`data-supply-effect="${camp}"`);
    expect(html).toContain('优先后全军出阵 2 支');
    expect(html).toContain('全军耗粮 2 食物');
    expect(html).toMatch(/边境卫士.*第 10 列第 5 行.*1 → 0 支/);
    expect(html).toMatch(/雾林弓手.*第 8 列第 5 行.*0 → 2 支/);
    expect(encodeCheckpoint(run)).toBe(saved);
    expect(supplyDialog(run, planMuster(run, 12))).not.toContain('data-supply-effect');
  });

  it('loads old checkpoints, preserves priority when a group moves, and clears it on undo', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'watch', 5, 2).ok).toBe(true);
    expect(place(run, 'guard', 7, 3).ok).toBe(true);
    const id = run.rally[0].id;
    expect(prioritize(run, run.buildings[0].id).ok).toBe(false);
    expect(prioritize(run, id).ok).toBe(true);
    expect(dispatch(run, { kind: 'relocate', id, tile: point(8, 3) }, []).ok).toBe(true);
    const encoded = encodeCheckpoint(run)!;
    const restored = decodeCheckpoint(encoded)!;
    expect(restored.supplyPriority).toBe(id);
    expect(restored.rally[0].tile).toEqual(point(8, 3));

    const legacy = JSON.parse(encoded);
    legacy.version = 10;
    delete legacy.run.supplyPriority;
    expect(decodeCheckpoint(JSON.stringify(legacy))?.supplyPriority).toBeNull();
    const corrupted = JSON.parse(encoded);
    corrupted.run.supplyPriority = 9999;
    expect(decodeCheckpoint(JSON.stringify(corrupted))).toBeUndefined();
    expect(dispatch(restored, { kind: 'undo-deployment' }, []).ok).toBe(true);
    expect(restored.supplyPriority).toBeNull();
  });

  it('clears the choice when the recruiting building is removed or destroyed', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'barracks', 7, 3).ok).toBe(true);
    const id = run.buildings[0].id;
    expect(prioritize(run, id).ok).toBe(true);
    const demolished = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(dispatch(demolished, { kind: 'remove-deployment', id }, []).ok).toBe(true);
    expect(demolished.supplyPriority).toBeNull();

    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    run.shots.push({ from: point(6, 3), end: point(7, 3), target: { kind: 'building', id },
      damage: 50, duration: 1, ticks: 1, hostile: true });
    step(run, []);
    expect(run.buildings.some(item => item.id === id)).toBe(false);
    expect(run.supplyPriority).toBeNull();
  });
});
