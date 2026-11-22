import { describe, expect, it } from 'vitest';
import { createRun, dispatch, step } from '../src/core/game';
import type { GameEvent, Point, Run } from '../src/core/types';
import { battleLimit, map } from '../src/data/content';
import { route, same } from '../src/systems/grid';

function play(run: Run, card: string, tile?: Point) {
  return dispatch(run, { kind: 'play', slot: run.hand.indexOf(card), tile }, []);
}

function finishBattle(run: Run): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; run.phase === 'battle' && i <= battleLimit; i++) step(run, events);
  expect(run.phase).not.toBe('battle');
  return events;
}

describe('player commands', () => {
  it('places and pays once and leaves state intact after an invalid play', () => {
    const run = createRun(119);
    const forbidden = structuredClone(run);
    expect(play(run, 'watch', map.entry).ok).toBe(false);
    expect(run).toEqual(forbidden);
    expect(play(run, 'watch', { x: 5, y: 2 }).ok).toBe(true);
    expect(run.wallet).toEqual({ gold: 8, food: 3, wood: 5, mana: 2 });
    const occupied = structuredClone(run);
    expect(play(run, 'watch', { x: 5, y: 2 }).ok).toBe(false);
    expect(run).toEqual(occupied);
  });

  it('generates the farm adjacency bonus and keeps full-health spells in hand', () => {
    const run = createRun(119);
    expect(play(run, 'ember').ok).toBe(false);
    expect(run.wallet.mana).toBe(2);
    expect(run.hand).toContain('ember');
    expect(play(run, 'farm', { x: 4, y: 1 }).ok).toBe(true);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    expect(run.wallet.gold).toBe(11);
    expect(run.wallet.food).toBe(6);
  });

  it('stops simulation while paused and resumes on command', () => {
    const run = createRun(119);
    dispatch(run, { kind: 'start' }, []);
    dispatch(run, { kind: 'pause' }, []);
    const snapshot = structuredClone(run);
    step(run, []);
    expect(run).toEqual(snapshot);
    dispatch(run, { kind: 'pause' }, []);
    step(run, []);
    expect(run.actors).toHaveLength(1);
  });
});

describe('battle resolution', () => {
  it('reroutes around a blocked bridgehead and actually breaches buildings when both are blocked', () => {
    const run = createRun(119);
    const path = route(map.entry, map.keep, [])!;
    const closed = path.find(point => point.x === 4)!;
    const other = { x: 4, y: closed.y === 2 ? 4 : 2 };
    expect(play(run, 'wall', closed).ok).toBe(true);
    expect(route(map.entry, map.keep, run.buildings)?.some(point => same(point, other))).toBe(true);
    // A second wall blocks the only remaining river crossing.
    run.hand.push('wall');
    expect(play(run, 'wall', other).ok).toBe(true);
    expect(route(map.entry, map.keep, run.buildings)).toBeUndefined();
    dispatch(run, { kind: 'start' }, []);
    finishBattle(run);
    expect(run.buildings.length).toBeLessThan(2);
    expect(run.phase).toBe('lost');
  });

  it('ends an undefended run when the keep reaches zero', () => {
    const run = createRun(119);
    dispatch(run, { kind: 'start' }, []);
    finishBattle(run);
    expect(run.phase).toBe('lost');
    expect(run.keepHp).toBe(0);
    expect(run.defeated).toBe(0);
    expect(createRun(run.seed).keepHp).toBe(map.keepHp);
  });

  it.each([{ hp: 1, phase: 'lost' }, { hp: 8, phase: 'reward' }])(
    'resolves a surviving enemy projectile and reaches $phase from $hp keep health', ({ hp, phase }) => {
      const run = createRun(119);
      run.keepHp = hp;
      dispatch(run, { kind: 'start' }, []);
      run.spawnIndex = run.schedule.length;
      run.tick = battleLimit - 1;
      const from = { x: map.keep.x - 1, y: map.keep.y };
      run.shots.push({ from, end: map.keep, target: { kind: 'keep', id: 0 }, damage: 3,
        ticks: 2, duration: 2, hostile: true, enemy: 'skirmisher' });
      run.shots.push({ from: map.keep, end: from, target: { kind: 'actor', id: 90 }, damage: 3, ticks: 5, duration: 5 });

      step(run, []);
      expect(run.phase).toBe('battle');
      expect(run.rewards).toEqual([]);
      expect(run.keepHp).toBe(hp);
      expect(run.shots[0].ticks).toBe(1);

      step(run, []);
      expect(run.phase).toBe(phase);
      expect(run.keepHp).toBe(Math.max(0, hp - 3));
      expect(run.waveReport?.lastKeepHit).toEqual({ enemy: 'skirmisher', from });
      expect(run.waveReport?.keepDamage).toEqual([{ enemy: 'skirmisher', damage: Math.min(hp, 3), hits: 1 }]);
      expect(run.shots).toEqual([]);
    },
  );

  it('wins a three-wave run and resolves seeded rewards once per wave', () => {
    function siege() {
      const run = createRun(119);
      expect(play(run, 'watch', { x: 5, y: 2 }).ok).toBe(true);
      expect(play(run, 'watch', { x: 5, y: 4 }).ok).toBe(true);
      expect(play(run, 'guard', { x: 6, y: 3 }).ok).toBe(true);
      expect(play(run, 'farm', { x: 4, y: 1 }).ok).toBe(true);
      expect(play(run, 'wall', { x: 4, y: 4 }).ok).toBe(true);
      const history: string[][] = [];
      for (let i = 0; i < 3; i++) {
        dispatch(run, { kind: 'start' }, []);
        const events = finishBattle(run);
        expect(events.some(event => event.kind === 'death')).toBe(true);
        if (i === 2) break;
        expect(run.phase).toBe('reward');
        expect(new Set(run.rewards).size).toBe(3);
        history.push([...run.rewards]);
        const pick = run.rewards.includes('watch') ? 'watch' : run.rewards[0];
        expect(dispatch(run, { kind: 'reward', card: pick }, []).ok).toBe(true);
        expect(dispatch(run, { kind: 'reward', card: pick }, []).ok).toBe(false);
        if (pick === 'watch') expect(play(run, 'watch', i === 0 ? { x: 6, y: 2 } : { x: 8, y: 4 }).ok).toBe(true);
        if (run.keepHp < map.keepHp && i === 1) expect(play(run, 'ember').ok).toBe(true);
      }
      expect(run.phase, JSON.stringify({ history, wave: run.wave, tick: run.tick, defeated: run.defeated, hp: run.keepHp })).toBe('won');
      expect(run.defeated).toBe(27);
      expect(run.keepHp).toBe(map.keepHp);
      return history;
    }
    expect(siege()).toEqual(siege());
  });

  it('can recover from second-wave damage by reinforcing near the keep and using a repair spell', () => {
    const run = createRun(119);
    expect(play(run, 'watch', { x: 7, y: 2 }).ok).toBe(true);
    expect(play(run, 'watch', { x: 7, y: 4 }).ok).toBe(true);
    expect(play(run, 'guard', { x: 6, y: 3 }).ok).toBe(true);
    expect(play(run, 'farm', { x: 4, y: 1 }).ok).toBe(true);

    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    finishBattle(run);
    expect(dispatch(run, { kind: 'reward', card: 'guard' }, []).ok).toBe(true);
    expect(play(run, 'guard', { x: 7, y: 3 }).ok).toBe(true);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    finishBattle(run);
    expect(run.keepHp).toBe(25);

    expect(dispatch(run, { kind: 'reward', card: 'watch' }, []).ok).toBe(true);
    expect(play(run, 'watch', { x: 8, y: 4 }).ok).toBe(true);
    expect(play(run, 'ember').ok).toBe(true);
    expect(run.keepHp).toBe(map.keepHp);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    finishBattle(run);
    expect(run.phase).toBe('won');
    expect(run.defeated).toBe(27);
    expect(run.keepHp).toBe(25);
  });
});
