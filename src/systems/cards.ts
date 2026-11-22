import type { GameEvent, Point, Result, Run } from '../core/types';
import { buildings, cards, map } from '../data/content';
import { canAfford, deposit, spend } from './economy';
import { applyUpgrade } from './buildings';
import { buildingAt, checkPlacement, inBounds } from './grid';

export function checkCard(run: Run, slot: number, tile?: Point): Result {
  if (run.phase !== 'planning') return { ok: false, reason: '只能在备战时使用军令。' };
  const card = cards.get(run.hand[slot]);
  if (!card) return { ok: false, reason: '这张军令已不在手中。' };
  if (!canAfford(run.wallet, card.cost)) return { ok: false, reason: '资源不足。' };
  if (card.kind === 'tactic' || card.kind === 'event') return { ok: true };
  if (card.kind === 'spell') {
    return run.keepHp < map.keepHp ? { ok: true } : { ok: false, reason: '城堡完好，可以把这张军令留到下一波。' };
  }
  if (!tile || !inBounds(tile)) return { ok: false, reason: '在地图上选择一个格子。' };
  if (card.kind === 'fortify') {
    return buildingAt(run.buildings, tile)?.level === 1 ? { ok: true } : { ok: false, reason: '请选择一座一级建筑。' };
  }
  const structure = card.kind === 'building' ? buildings.get(card.ref)! : undefined;
  return checkPlacement(run, tile, structure);
}

export function playCard(run: Run, slot: number, tile: Point | undefined, events: GameEvent[]): Result {
  const valid = checkCard(run, slot, tile);
  if (!valid.ok) return valid;
  const card = cards.get(run.hand[slot])!;
  spend(run.wallet, card.cost);
  run.hand.splice(slot, 1);
  if (card.kind === 'fortify') {
    applyUpgrade(run, buildingAt(run.buildings, tile!)!, events);
    return valid;
  }
  if (card.kind === 'tactic' || card.kind === 'event') {
    deposit(run.wallet, card.gain!, run.buildings);
    if (card.kind === 'tactic') run.discard.push(card.id);
  } else if (card.kind === 'spell') {
    const before = run.keepHp;
    run.keepHp = Math.min(map.keepHp, run.keepHp + card.heal!);
    events.push({ kind: 'effect', at: map.keep, radius: 0.65, style: 'heal' },
      { kind: 'heal', at: map.keep, amount: run.keepHp - before });
  } else {
    const placement = { id: run.nextId++, tile: { ...tile! }, def: card.ref };
    if (card.kind === 'building') run.buildings.push({ ...placement, hp: buildings.get(card.ref)!.hp, cooldown: 0, level: 1 });
    else run.rally.push(placement);
    run.deployments.push({ id: placement.id, card: card.id, slot });
    events.push({ kind: 'placed', id: placement.id, at: placement.tile });
  }
  events.push({ kind: 'resources' });
  return valid;
}
