import raw from './journey.json';
import type { CampaignId, Encounter, EncounterChoice, Relic, RelicId, RouteId } from '../core/types';

type Swap = { wave: number; from: string; to: string; count: number };
type Route = { id: RouteId; name: string; description: string; bridges: number[]; swaps: Swap[] };

export const routeIds = ['ferry', 'shoal', 'crossing'] as const;
export const relicIds = ['grain-ledger', 'ember-lens', 'muster-banner', 'gate-keystone'] as const;
export const encounterWaves = [1, 3] as const;
export const relicTradeChoice = 'relic-trade';
export const { districts, leySites } = raw;
export const routes = new Map<RouteId, Route>();
export const relics = new Map<RelicId, Relic>();

for (const id of routeIds) {
  const row = raw.routes.find(item => item.id === id);
  if (!row || row.bridges.length !== 2 || new Set(row.bridges).size !== 2
    || row.bridges.some(y => !Number.isInteger(y) || y < 0 || y >= 7)) throw new Error(`Invalid crossing: ${id}`);
  routes.set(id, { ...row, id });
}
for (const id of relicIds) {
  const row = raw.relics.find(item => item.id === id);
  if (!row || !['provisions', 'arcane', 'vitality', 'guard'].includes(row.trait)
    || !Number.isInteger(row.power) || row.power < 1) throw new Error(`Invalid relic: ${id}`);
  relics.set(id, { ...row, id, trait: row.trait as Relic['trait'] });
}
export const encounters: Encounter[] = raw.events.map(row => ({
  ...row,
  choices: row.choices.map(choice => {
    if ('relic' in choice && choice.relic && !relicIds.includes(choice.relic as RelicId)) throw new Error(`Invalid relic choice: ${choice.id}`);
    return choice as Encounter['choices'][number];
  }),
}));
const nativeRelicOffers = encounters.flatMap(event => event.choices.filter(
  (choice): choice is EncounterChoice & { relic: RelicId } => choice.relic !== undefined));

export function routeFor(campaign: CampaignId, seed: number): RouteId {
  return campaign === 'march' ? routeIds[(seed >>> 0) % routeIds.length] : 'crossing';
}

export function encounterFor(campaign: CampaignId, seed: number, wave: number): Encounter | undefined {
  if (campaign !== 'march' || (wave !== 1 && wave !== 3)) return undefined;
  const firstIndex = (seed >>> 0) % encounters.length;
  const first = encounters[firstIndex];
  if (wave === 1) return first;
  const offset = 1 + ((seed >>> 8) % (encounters.length - 1));
  const second = encounters[(firstIndex + offset) % encounters.length];
  const offered = [...first.choices, ...second.choices].map(choice => choice.relic);
  const available = nativeRelicOffers.filter(choice => !offered.includes(choice.relic));
  if (!available.length) return second;
  // Keep the trade reproducible without consuming the combat rewards' random stream.
  const tradeSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 16;
  const alternate = available[tradeSeed % available.length];
  return { ...second, choices: [...second.choices, {
    id: relicTradeChoice, label: `交换「${relics.get(alternate.relic)!.name}」`, cost: alternate.cost, relic: alternate.relic,
  }] };
}

export function relicPower(owned: readonly RelicId[], trait: Relic['trait']): number {
  return owned.reduce((sum, id) => {
    const relic = relics.get(id);
    return sum + (relic?.trait === trait ? relic.power : 0);
  }, 0);
}
