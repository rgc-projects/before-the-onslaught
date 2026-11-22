import { resources } from '../core/types';
import type { Cost, Wallet, Building, KingdomId, RelicId, ResearchId, RouteId } from '../core/types';
import { buildings, kingdomPower, map, tuning } from '../data/content';
import { relicPower } from '../data/journey';
import { buildingStats } from './buildings';
import { buildingAt, neighbors, terrain } from './grid';
import { researchPower } from './research';

export function canAfford(wallet: Wallet, cost: Cost): boolean {
  return resources.every(key => wallet[key] >= (cost[key] ?? 0));
}

export function spend(wallet: Wallet, cost: Cost): void {
  for (const key of resources) wallet[key] -= cost[key] ?? 0;
}

export function capacity(placed: readonly Building[]): Wallet {
  const limits = { ...map.capacity };
  for (const building of placed) {
    if (building.hp <= 0) continue;
    const bonus = buildingStats(building).capacity;
    for (const key of resources) limits[key] += bonus[key] ?? 0;
  }
  return limits;
}

export function deposit(wallet: Wallet, income: Cost, placed: readonly Building[] = []): void {
  const limits = capacity(placed);
  for (const key of resources) wallet[key] = Math.min(limits[key], wallet[key] + (income[key] ?? 0));
}

export function buildingProduction(building: Building, placed: readonly Building[], kingdom: KingdomId | null, crossing: RouteId): Cost {
  if (building.hp <= 0) return {};
  const def = buildings.get(building.def)!;
  const { income, effect } = buildingStats(building);
  if (building.def === 'farm') {
    const riverside = neighbors(building.tile).some(tile => terrain(tile, crossing) === 'water') ? tuning.buildings.riverFood : 0;
    income.food = (income.food ?? 0) + kingdomPower(kingdom, 'farm') + riverside;
  }
  if (def.effect !== 'market' && def.effect !== 'ritual') return income;

  const adjacent = new Set(neighbors(building.tile).map(tile => buildingAt(placed, tile)).filter(neighbor => neighbor && neighbor.id !== building.id));
  if (def.effect === 'market' && [...adjacent].some(neighbor => neighbor?.def === 'storehouse')) {
    income.gold = (income.gold ?? 0) + tuning.buildings.warehouseMarketGold;
  }
  for (const neighbor of adjacent) {
    if (def.effect === 'market' && (neighbor?.def === 'mine' || neighbor?.def === 'farm')) {
      income.gold = (income.gold ?? 0) + effect;
    }
    if (def.effect === 'ritual' && (neighbor?.def === 'magetower' || neighbor?.def === 'arcanetower' || neighbor?.def === 'shrine')) {
      income.mana = (income.mana ?? 0) + effect;
    }
  }
  return income;
}

export function production(placed: readonly Building[], kingdom: KingdomId | null = null, crossing: RouteId = 'crossing', relics: readonly RelicId[] = [], research: ResearchId | null = null): Wallet {
  const income = { gold: 0, food: relicPower(relics, 'provisions') + researchPower(research, 'provisions'), wood: 0, mana: 0 };
  for (const building of placed) {
    const source = buildingProduction(building, placed, kingdom, crossing);
    for (const key of resources) income[key] += source[key] ?? 0;
  }
  return income;
}
