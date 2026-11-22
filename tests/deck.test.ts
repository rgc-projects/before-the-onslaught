import { describe, expect, it } from 'vitest';
import { createRun, dispatch, step } from '../src/core/game';
import { cards, starterDeck } from '../src/data/content';

describe('tactic deck', () => {
  it('draws a reproducible hand and spends and discards a tactic exactly once', () => {
    const run = createRun(119);
    expect(run.hand).toEqual(createRun(119).hand);
    const slot = run.hand.findIndex(id => cards.get(id)?.kind === 'tactic');
    const id = run.hand[slot];
    const card = cards.get(id)!;
    const balance = { ...run.wallet };
    expect(dispatch(run, { kind: 'play', slot }, []).ok).toBe(true);
    expect(run.discard).toEqual([id]);
    expect(run.hand).not.toContain(id);
    for (const resource of Object.keys(balance) as (keyof typeof balance)[]) {
      expect(run.wallet[resource]).toBe(balance[resource] - (card.cost[resource] ?? 0) + (card.gain?.[resource] ?? 0));
    }
  });

  it('reshuffles spent tactics and adds selected tactics permanently to the run deck', () => {
    const run = createRun(119);
    for (const y of [2, 4]) dispatch(run, { kind: 'play', slot: 0, tile: { x: 5, y } }, []);
    const initial = run.hand.filter(id => cards.get(id)?.kind === 'tactic');
    dispatch(run, { kind: 'start' }, []);
    expect(run.discard).toEqual(initial);
    expect(run.hand.some(id => cards.get(id)?.kind === 'tactic')).toBe(false);
    while (run.phase === 'battle') step(run, []);
    expect(run.phase).toBe('reward');
    const tactic = run.rewards.find(id => cards.get(id)?.kind === 'tactic')!;
    expect(dispatch(run, { kind: 'reward', card: tactic }, []).ok).toBe(true);
    const circulation = [...run.deck, ...run.discard, ...run.hand.filter(id => cards.get(id)?.kind === 'tactic')];
    expect(circulation.sort()).toEqual([...starterDeck, tactic].sort());
    expect(run.hand.filter(id => cards.get(id)?.kind === 'tactic')).toHaveLength(3);
  });

  it('bounds a resource conversion chain by the available copies and current storage', () => {
    const run = createRun(119, 'march');
    run.hand = ['storehouse', 'timber', 'trade', 'rations'];
    for (const card of ['rations', 'trade', 'timber']) {
      expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf(card) }, []).ok).toBe(true);
    }
    const paid = { ...run.wallet };
    for (const card of ['rations', 'trade', 'timber']) {
      expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf(card) }, []).ok).toBe(false);
    }
    expect(paid).toEqual({ gold: 24, food: 11, wood: 18, mana: 4 });
    expect(run.wallet).toEqual(paid);
    expect(run.discard).toEqual(['rations', 'trade', 'timber']);
  });

  it('refines one matching copy at a time in hand, deck and discard order', () => {
    const run = createRun(119, 'march');
    run.wave = 1;
    run.hand = ['timber'];
    run.deck = ['timber'];
    run.discard = ['timber', 'rations'];
    const gold = run.wallet.gold;
    expect(dispatch(run, { kind: 'refine', action: 'improve', card: 'timber' }, []).ok).toBe(true);
    expect(run.hand).toEqual(['timber-plus']);
    expect(run.deck).toEqual(['timber']);

    expect(dispatch(run, { kind: 'refine', action: 'retire', card: 'timber' }, []).ok).toBe(true);
    expect(run.deck).toEqual([]);
    expect(run.discard).toEqual(['timber', 'rations']);
    expect(dispatch(run, { kind: 'refine', action: 'retire', card: 'timber' }, []).ok).toBe(true);
    expect(run.discard).toEqual(['rations']);
    expect(run.retired).toEqual(['timber', 'timber']);
    expect(dispatch(run, { kind: 'refine', action: 'retire', card: 'rations' }, []).ok).toBe(false);
    expect(run.wallet.gold).toBe(gold - 8);
  });
});
