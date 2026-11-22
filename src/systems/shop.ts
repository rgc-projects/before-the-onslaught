import { resources } from '../core/types';
import type { Cost, GameEvent, Result, Run } from '../core/types';
import { cards, shopPool, tuning } from '../data/content';

export function rotatingShopStock(run: Run): string[] {
  if (run.campaign !== 'march') return [];
  const first = ((run.seed % shopPool.length) + run.wave * tuning.shop.rotationStride) % shopPool.length;
  return Array.from({ length: tuning.shop.offerCount }, (_, index) => shopPool[(first + index) % shopPool.length]);
}

export function shopStock(run: Run): string[] {
  const stock = rotatingShopStock(run);
  if (run.campaign === 'march' && run.wave + 1 >= tuning.shop.farmOfferWave && !stock.includes('farm')) stock.push('farm');
  return stock;
}

export function permitPrice(card: string): Cost {
  return { gold: (cards.get(card)?.cost.gold ?? 0) >= tuning.shop.premiumThreshold ? tuning.shop.premiumGold : tuning.shop.standardGold };
}

export function buyPermit(run: Run, card: string, events: GameEvent[]): Result {
  if (run.phase !== 'planning' || !shopStock(run).includes(card) || run.shopBought.includes(card)) {
    return { ok: false, reason: '本波没有这张可购军令。' };
  }
  const cost = permitPrice(card);
  if (resources.some(key => run.wallet[key] < (cost[key] ?? 0))) return { ok: false, reason: '购买军令所需金币不足。' };
  for (const key of resources) run.wallet[key] -= cost[key] ?? 0;
  run.shopBought.push(card);
  run.hand.push(card);
  events.push({ kind: 'resources' });
  return { ok: true };
}
