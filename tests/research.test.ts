import { describe, expect, it } from 'vitest';
import type { GameEvent, Run } from '../src/core/types';
import { createRun, dispatch } from '../src/core/game';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { tickBattle } from '../src/systems/combat';
import { planMuster } from '../src/systems/buildings';

const place = (run: Run, id: string, x: number, y: number) =>
  dispatch(run, { kind: 'play', slot: run.hand.indexOf(id), tile: { x, y } }, []);

describe('technology and specialist formations', () => {
  it('purchases one research at a live lab, persists it and increases actual arrow reach', () => {
    const run = createRun(119, 'march');
    expect(dispatch(run, { kind: 'research', topic: 'fletching' }, []).ok).toBe(false);
    run.hand.push('lab');
    expect(place(run, 'lab', 7, 1).ok).toBe(true);
    expect(place(run, 'watch', 6, 2).ok).toBe(true);
    expect(dispatch(run, { kind: 'research', topic: 'fletching' }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'research', topic: 'provisions' }, []).ok).toBe(false);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(restored.research).toBe('fletching');
    restored.actors = [{ id: 100, side: 'enemy', def: 'raider', hp: 12, tile: { x: 9, y: 3 }, travel: 0, cooldown: 50 }];
    tickBattle(restored, []);
    expect(restored.shots.some(shot => shot.target.id === 100)).toBe(true);
  });

  it('adds one squad through a matching neighbor and takes its upkeep', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'barracks', 6, 3).ok).toBe(true);
    expect(planMuster(run, 10).ready).toBe(1);
    expect(place(run, 'wall', 6, 2).ok).toBe(true);
    expect(planMuster(run, 10)).toMatchObject({ ready: 2, fed: 2, food: 2 });
    expect(planMuster(run, 1)).toMatchObject({ ready: 2, fed: 1, food: 1 });
  });

  it('musters a specific hero, with a once-per-battle recovery for nearby allies', () => {
    const run = createRun(119, 'march');
    run.hand.push('hall');
    expect(place(run, 'hall', 6, 4).ok).toBe(true);
    expect(place(run, 'guard', 7, 3).ok).toBe(true);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    const hero = run.actors.find(actor => actor.def === 'waykeeper')!;
    const guard = run.actors.find(actor => actor.def === 'guard')!;
    expect(hero).toBeDefined();
    hero.hp = 12;
    guard.hp = 9;
    const events: GameEvent[] = [];
    tickBattle(run, events);
    expect(hero.hp).toBe(16);
    expect(guard.hp).toBe(13);
    expect(events.filter(event => event.kind === 'heal')).toHaveLength(2);
    const after: GameEvent[] = [];
    tickBattle(run, after);
    expect(after.some(event => event.kind === 'heal')).toBe(false);
  });

  it('lets the marshal strike nearby allies only once at half health', () => {
    const run = createRun(119, 'march');
    run.actors = [
      { id: 100, def: 'marshal', side: 'enemy', tile: { x: 6, y: 3 }, hp: 44, travel: 0, cooldown: 50 },
      { id: 101, def: 'sentinel', side: 'ally', tile: { x: 7, y: 3 }, hp: 33, travel: 0, cooldown: 50 },
      { id: 102, def: 'breaker', side: 'enemy', tile: { x: 7, y: 3 }, hp: 23, travel: 0, cooldown: 50 },
    ];
    const first: GameEvent[] = [];
    tickBattle(run, first);
    expect(run.actors.map(actor => actor.hp)).toEqual([44, 30, 23]);
    expect(first).toContainEqual({ kind: 'hit', at: { x: 7, y: 3 }, amount: 3, hostile: true });
    const next: GameEvent[] = [];
    tickBattle(run, next);
    expect(next.some(event => event.kind === 'hit')).toBe(false);
  });
});
