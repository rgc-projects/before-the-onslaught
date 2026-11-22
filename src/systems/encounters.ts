import type { Encounter, GameEvent, Result, Run } from '../core/types';
import { encounterFor } from '../data/journey';
import { canAfford, deposit, spend } from './economy';

export function pendingEncounter(run: Run): Encounter | undefined {
  if (run.phase !== 'planning' || run.resolvedEncounters.includes(run.wave)) return undefined;
  return encounterFor(run.campaign, run.seed, run.wave);
}

export function chooseEncounter(run: Run, option: string, events: GameEvent[]): Result {
  const choice = pendingEncounter(run)?.choices.find(item => item.id === option);
  if (!choice) return { ok: false, reason: '这项沿途选择已结束。' };
  if (!canAfford(run.wallet, choice.cost)) return { ok: false, reason: '现有物资不足。' };
  if (choice.relic && run.relics.includes(choice.relic)) return { ok: false, reason: '已收录这件遗物。' };
  spend(run.wallet, choice.cost);
  if (choice.relic) run.relics.push(choice.relic);
  if (choice.card) run.hand.push(choice.card);
  if (choice.gain) deposit(run.wallet, choice.gain, run.buildings);
  run.resolvedEncounters.push(run.wave);
  events.push({ kind: 'resources' });
  return { ok: true };
}
