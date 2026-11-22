import type { CampaignId, GameEvent, Result, RouteId, Run, Scheduled } from '../core/types';
import { campaigns, divinationCost, rewardPool, shopPool, starterDeck } from '../data/content';
import { routes } from '../data/journey';
import { canAfford, spend } from './economy';

export function scheduleWave(number: number, campaign: CampaignId = 'crowford', crossing: RouteId = 'crossing'): Scheduled[] {
  let tick = 1;
  const schedule: Scheduled[] = [];
  for (const group of campaigns[campaign].waves[number].groups) {
    const swap = campaign === 'march' ? routes.get(crossing)!.swaps.find(row => row.wave === number && row.from === group.enemy) : undefined;
    for (let index = 0; index < group.count; index++) {
      const enemy = swap && index >= group.count - swap.count ? swap.to : group.enemy;
      schedule.push({ tick, enemy });
      tick += group.gap;
    }
  }
  return schedule;
}

function nextRandom(run: Run): number {
  run.random = (Math.imul(1664525, run.random) + 1013904223) >>> 0;
  return run.random / 2 ** 32;
}

export function drawRewards(run: Run, exclude: readonly string[] = []): string[] {
  const available = run.campaign === 'march' ? [...rewardPool, ...shopPool] : rewardPool;
  const pool = available.filter(card => !exclude.includes(card));
  const offers: string[] = [];
  while (offers.length < 2 && pool.length) {
    const card = pool[Math.floor(nextRandom(run) * pool.length)];
    offers.push(card);
    for (let index = pool.length - 1; index >= 0; index--) if (pool[index] === card) pool.splice(index, 1);
  }
  const tactics = starterDeck.filter(card => !exclude.includes(card));
  offers.push(tactics[Math.floor(nextRandom(run) * tactics.length)]);
  return offers;
}

export function divinationSource(run: Run): 'charter' | 'altar' | undefined {
  if (run.campaign !== 'march') return undefined;
  if (run.charter === 'divination') return 'charter';
  if (run.buildings.some(building => building.def === 'altar' && building.hp > 0)) return 'altar';
}

export function divineRewards(run: Run, events: GameEvent[]): Result {
  if (run.phase !== 'reward' || !divinationSource(run)) {
    return { ok: false, reason: '选择占卜传承或保留一座月环祭坛后，可在战利品阶段占卜。' };
  }
  if (run.divined) return { ok: false, reason: '本局已经占卜过。' };
  if (!canAfford(run.wallet, divinationCost)) return { ok: false, reason: '魔力不足。' };
  spend(run.wallet, divinationCost);
  run.rewards = drawRewards(run, run.rewards);
  run.divined = true;
  events.push({ kind: 'resources' });
  return { ok: true };
}
