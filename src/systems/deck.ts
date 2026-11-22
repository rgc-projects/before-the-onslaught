import type { GameEvent, Result, Run } from '../core/types';
import { cards, starterDeck, tuning, upgrades } from '../data/content';
import { canAfford, spend } from './economy';

export const refineCost = tuning.refine;
export const tacticPiles = ['hand', 'deck', 'discard'] as const;
export const baseTactic = (id: string): string => cards.get(id)?.upgradesFrom ?? id;

export function liveTactics(run: Run): string[] {
  return tacticPiles.flatMap(pile => run[pile]).filter(id => cards.get(id)?.kind === 'tactic');
}

export function refineTactic(run: Run, card: string, action: 'improve' | 'retire', events: GameEvent[]): Result {
  if (run.phase !== 'planning' || run.campaign !== 'march' || run.wave < 1) {
    return { ok: false, reason: '经过首波远征战斗后，方可整理战术牌。' };
  }
  const pile = tacticPiles.map(key => run[key]).find(zone => zone.includes(card));
  const target = upgrades.get(card);
  if (!pile || cards.get(card)?.kind !== 'tactic') return { ok: false, reason: '找不到要整理的战术牌。' };
  if (action === 'improve' && !target) return { ok: false, reason: '这张战术已强化。' };
  if (action === 'retire' && liveTactics(run).length <= 2) return { ok: false, reason: '至少保留两张战术牌。' };
  if (!canAfford(run.wallet, refineCost[action])) return { ok: false, reason: '金币不足。' };
  spend(run.wallet, refineCost[action]);
  const index = pile.indexOf(card);
  if (action === 'improve') {
    pile[index] = target!;
  } else {
    pile.splice(index, 1);
    run.retired.push(card);
  }
  events.push({ kind: 'resources' });
  return { ok: true };
}

export function deckSeed(seed: number): number {
  return (seed ^ 0x9e3779b9) >>> 0;
}

function shuffle(run: Run, cardsToShuffle: string[]): string[] {
  const result = [...cardsToShuffle];
  for (let index = result.length - 1; index > 0; index--) {
    run.deckRandom = (Math.imul(1664525, run.deckRandom) + 1013904223) >>> 0;
    const swap = Math.floor((run.deckRandom / 2 ** 32) * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function initDeck(run: Run): void {
  run.deck = shuffle(run, starterDeck);
}

export function drawTactics(run: Run, count: number): void {
  for (let index = 0; index < count; index++) {
    if (!run.deck.length) {
      run.deck = shuffle(run, run.discard);
      run.discard = [];
    }
    const card = run.deck.pop();
    if (card === undefined) break;
    run.hand.push(card);
  }
}

export function discardUnusedTactics(run: Run): void {
  run.hand = run.hand.filter(id => {
    if (cards.get(id)?.kind !== 'tactic') return true;
    run.discard.push(id);
    return false;
  });
}
