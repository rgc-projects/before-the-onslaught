import { describe, expect, it } from 'vitest';
import { createRun, dispatch, step } from '../src/core/game';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { divinationCost } from '../src/data/content';
import { drawRewards } from '../src/systems/waves';

describe('run checkpoints', () => {
  it('restores planning purchases and the original seed before combat', () => {
    const run = createRun(119);
    expect(dispatch(run, { kind: 'play', slot: 0, tile: { x: 5, y: 2 } }, []).ok).toBe(true);
    expect(decodeCheckpoint(encodeCheckpoint(run)!)).toEqual(run);
    dispatch(run, { kind: 'start' }, []);
    expect(encodeCheckpoint(run)).toBeUndefined();
  });

  it('restores reward choices and random state without paying the reward twice', () => {
    const run = createRun(119);
    for (const y of [2, 4]) dispatch(run, { kind: 'play', slot: 0, tile: { x: 5, y } }, []);
    dispatch(run, { kind: 'start' }, []);
    while (run.phase === 'battle') step(run, []);
    expect(run.phase).toBe('reward');
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(restored.rewards).toEqual(run.rewards);
    expect(restored.random).toBe(run.random);
    expect(restored.wallet).toEqual(run.wallet);
    dispatch(restored, { kind: 'reward', card: restored.rewards[0] }, []);
    expect(restored.wave).toBe(1);
    expect(restored.wallet).toEqual(run.wallet);
  });

  it('rejects corrupted, future, unknown-ID and overlapping placement data', () => {
    const run = createRun(119);
    dispatch(run, { kind: 'play', slot: 0, tile: { x: 5, y: 2 } }, []);
    const valid = encodeCheckpoint(run)!;
    expect(decodeCheckpoint('not json')).toBeUndefined();
    for (const corrupt of [
      (data: ReturnType<typeof JSON.parse>) => { data.version++; },
      (data: ReturnType<typeof JSON.parse>) => { data.run.formation = 'unknown'; },
      (data: ReturnType<typeof JSON.parse>) => { data.run.formation = 'inner'; },
      (data: ReturnType<typeof JSON.parse>) => { data.run.divined = 'true'; },
      (data: ReturnType<typeof JSON.parse>) => { data.run.divined = true; },
      (data: ReturnType<typeof JSON.parse>) => { data.run.hand.push('unknown'); },
      (data: ReturnType<typeof JSON.parse>) => { data.run.deployments[0].card = 'farm'; },
      (data: ReturnType<typeof JSON.parse>) => { data.run.deployments[0].slot = -1; },
      (data: ReturnType<typeof JSON.parse>) => {
        data.run.buildings.push({ ...data.run.buildings[0], id: data.run.nextId++ });
      },
    ]) {
      const data = JSON.parse(valid);
      corrupt(data);
      expect(decodeCheckpoint(JSON.stringify(data))).toBeUndefined();
    }
  });

  it('requires a living altar and pays for only one deterministic replacement of reward choices per run', () => {
    const run = createRun(0, 'march', 'arcane');
    const divine = { kind: 'divine' } as const;
    expect(dispatch(run, divine, []).ok).toBe(false);
    expect(dispatch(run, { kind: 'buy', card: 'altar' }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf('altar'), tile: { x: 6, y: 2 } }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    run.phase = 'reward';
    run.rewards = drawRewards(run);
    const original = [...run.rewards];
    const [altar] = run.buildings;
    const hp = altar.hp;
    altar.hp = 0;
    expect(dispatch(run, divine, []).ok).toBe(false);
    altar.hp = hp;
    run.wallet.mana = divinationCost.mana - 1;
    const random = run.random;
    expect(dispatch(run, divine, []).ok).toBe(false);
    expect(run.random).toBe(random);
    expect(run.rewards).toEqual(original);

    run.wallet.mana = divinationCost.mana;
    const legacy = JSON.parse(encodeCheckpoint(run)!);
    legacy.version = 7;
    delete legacy.run.divined;
    const migrated = decodeCheckpoint(JSON.stringify(legacy))!;
    expect(migrated.divined).toBe(false);
    expect(dispatch(run, divine, []).ok).toBe(true);
    expect(dispatch(migrated, divine, []).ok).toBe(true);
    expect(run.rewards).toHaveLength(3);
    expect(new Set(run.rewards).size).toBe(3);
    expect(run.rewards.some(id => original.includes(id))).toBe(false);
    expect(run.rewards).toEqual(migrated.rewards);
    expect(run.wallet.mana).toBe(0);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(restored.divined).toBe(true);
    expect(restored.rewards).toEqual(run.rewards);
    expect(restored.random).toBe(run.random);
    expect(dispatch(restored, divine, []).ok).toBe(false);
    expect(dispatch(restored, { kind: 'reward', card: restored.rewards[0] }, []).ok).toBe(true);
    expect(restored.phase).toBe('planning');
    expect(restored.divined).toBe(true);
  });

  it('migrates checkpoints from the pre-deck version without spending or redrawing permits', () => {
    const run = createRun(119);
    dispatch(run, { kind: 'play', slot: 0, tile: { x: 5, y: 2 } }, []);
    const old = JSON.parse(encodeCheckpoint(run)!);
    old.version = 1;
    old.run.hand = old.run.hand.filter((id: string) => !['timber', 'trade', 'rations'].includes(id));
    delete old.run.deck;
    delete old.run.discard;
    delete old.run.deckRandom;
    expect(decodeCheckpoint(JSON.stringify(old))).toEqual({ ...run, deployments: [] });
  });
});
