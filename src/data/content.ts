import raw from './encounter.json';
import expansion from './expansion.json';
import factionData from './kingdoms.json';
import journeyData from './journey.json';
import refinements from './refinements.json';
import tuning from './tuning.json';
import { districts, encounters, leySites, routes } from './journey';
import { kingdomIds, rarities, resources } from '../core/types';
import type { BuildingDef, CampaignId, Card, Cost, Kingdom, KingdomId, MapDef, Rarity, UnitDef, Wallet } from '../core/types';

export const map: MapDef = raw.map;
export const waves = raw.waves;
export const rewardIncome: Cost = raw.rewardIncome;
export const battleLimit = raw.battleLimitTicks;
export const starter = raw.starter;
export const starterDeck = raw.starterDeck;
export const rewardPool = raw.rewardPool;
export const campaigns: Record<CampaignId, { name: string; start: Wallet; starter: string[]; income: Cost; waves: typeof waves }> = {
  crowford: { name: '鸦渡防线', start: map.start, starter, income: rewardIncome, waves },
  march: expansion.march,
};
export const shopPool = expansion.cards.map(card => card.id).sort();
export { tuning };
export const divinationCost = tuning.divination;

function index<T extends { id: string }>(rows: T[]): ReadonlyMap<string, T> {
  const indexed = new Map(rows.map(row => [row.id, row]));
  if (indexed.size !== rows.length || rows.some(row => !row.id)) throw new Error('Duplicate or empty content ID');
  return indexed;
}

function validCost(cost: Cost): boolean {
  return Object.entries(cost).every(([key, value]) =>
    resources.includes(key as typeof resources[number]) && Number.isInteger(value) && value >= 0);
}

if (!validCost(divinationCost) || divinationCost.mana <= 0
  || Object.values(tuning.refine).some(cost => !validCost(cost) || cost.gold <= 0)
  || !validCost(tuning.relocation.building) || !validCost(tuning.relocation.rally)
  || Object.values(tuning.buildings).some(value => !Number.isInteger(value) || value <= 0)
  || Object.values(tuning.shop).some(value => !Number.isInteger(value) || value <= 0)
  || tuning.shop.offerCount > shopPool.length || tuning.shop.farmOfferWave > campaigns.march.waves.length) throw new Error('Invalid economy tuning');
const { marshal, hero } = tuning.combat;
if ([...Object.values(tuning.combat).filter(value => typeof value === 'number'), ...Object.values(marshal), ...Object.values(hero)]
  .some(value => !Number.isFinite(value) || value <= 0)
  || marshal.healthTrigger >= 1 || hero.healthTrigger >= 1) throw new Error('Invalid combat tuning');

const startingBuildings = raw.buildings.map(row => {
  const extra = expansion.legacyBuildings.find(item => item.id === row.id);
  if (!extra) throw new Error(`Missing building upgrade: ${row.id}`);
  return { ...row, ...extra };
});
export const buildings = index<BuildingDef>([...startingBuildings, ...expansion.buildings].map(row => {
  if (!['field', 'wall', 'tower', 'hall', 'mine', 'arcane'].includes(row.art)) throw new Error(`Invalid art: ${row.id}`);
  if ('effect' in row && row.effect && !['market', 'blessing', 'research', 'ritual'].includes(row.effect)) throw new Error(`Invalid building effect: ${row.id}`);
  if ('site' in row && row.site !== 'ley') throw new Error(`Invalid building site: ${row.id}`);
  return row as BuildingDef;
}));
function unitRow(row: { id: string; hp: number; damage: number; reach: number; speed: number; interval: number; armor: number; name: string; attack?: string; upkeep?: number }): UnitDef {
  if (row.attack && !['ranged', 'splash', 'heal', 'summon', 'charge', 'pierce', 'siege', 'boss', 'hero'].includes(row.attack)) throw new Error(`Invalid attack: ${row.id}`);
  if (row.upkeep !== undefined && (!Number.isInteger(row.upkeep) || row.upkeep < 0)) throw new Error(`Invalid upkeep: ${row.id}`);
  return row as UnitDef;
}
export const units = index<UnitDef>([...raw.units.map(row => ({ ...row, upkeep: 1 })), ...expansion.units].map(unitRow));
export const enemies = index<UnitDef>([...raw.enemies, ...expansion.enemies].map(unitRow));
export const rampartGuard = factionData.rampartGuard;
if (!rampartGuard.units.length || rampartGuard.units.some(id => !units.has(id))
  || !Number.isFinite(rampartGuard.distance) || rampartGuard.distance <= 0
  || [rampartGuard.armor, rampartGuard.damage, rampartGuard.interval].some(value => !Number.isInteger(value) || value <= 0)) {
  throw new Error('Invalid rampart guard configuration');
}
const tiers: Partial<Record<string, Rarity>> = {
  market: 'rare', storehouse: 'rare', lab: 'rare', stable: 'rare', magetower: 'rare', sentinel: 'rare', medic: 'rare',
  arcanetower: 'epic', bombard: 'epic', shrine: 'epic', altar: 'epic', summoner: 'epic', colossus: 'epic',
  hall: 'legendary', drake: 'legendary',
};
const cardRows: Card[] = [...raw.cards, ...expansion.cards, ...factionData.cards, ...journeyData.cards, ...refinements].map(row => {
  if (row.kind !== 'building' && row.kind !== 'unit' && row.kind !== 'spell' && row.kind !== 'tactic' && row.kind !== 'fortify' && row.kind !== 'event') throw new Error('Unknown card category');
  const rarity = ('rarity' in row ? row.rarity : undefined) ?? tiers[row.id]
    ?? (factionData.kingdoms.some(kingdom => kingdom.signature === row.id) ? 'rare' : 'common');
  if (!rarities.includes(rarity as Rarity)) throw new Error(`Unknown rarity: ${row.id}`);
  return { ...row, kind: row.kind, rarity: rarity as Rarity };
});
export const cards = index(cardRows);
export const upgrades = new Map(refinements.map(row => [row.upgradesFrom, row.id]));
if (upgrades.size !== refinements.length || refinements.some(row => !starterDeck.includes(row.upgradesFrom) || row.kind !== 'tactic')) {
  throw new Error('Invalid tactic refinement');
}
const factionRows = index<Kingdom>(factionData.kingdoms.map(row => {
  if (!kingdomIds.includes(row.id as KingdomId) || !['repair', 'arcane', 'farm', 'cavalry', 'marksman'].includes(row.trait)
    || !Number.isInteger(row.power) || row.power < 1 || !cards.has(row.signature)) throw new Error(`Invalid kingdom: ${row.id}`);
  return row as Kingdom;
}));
export const kingdoms: Record<KingdomId, Kingdom> = {
  iron: factionRows.get('iron')!, arcane: factionRows.get('arcane')!, wild: factionRows.get('wild')!, war: factionRows.get('war')!, tide: factionRows.get('tide')!,
};
if (kingdomIds.some(id => !kingdoms[id]) || new Set(factionData.kingdoms.map(row => row.signature)).size !== kingdomIds.length) {
  throw new Error('Missing kingdom or duplicate signature card');
}
export function kingdomPower(id: KingdomId | null, trait: Kingdom['trait']): number {
  const kingdom = id ? kingdoms[id] : undefined;
  return kingdom?.trait === trait ? kingdom.power : 0;
}

for (const card of cards.values()) {
  if (!validCost(card.cost)
    || (card.kind === 'building' && !buildings.has(card.ref))
    || (card.kind === 'unit' && !units.has(card.ref))
    || (card.kind === 'spell' && !(Number.isInteger(card.heal) && card.heal! > 0))
    || ((card.kind === 'tactic' || card.kind === 'event') && (!card.gain || !validCost(card.gain) || !Object.values(card.gain).some(amount => amount > 0)))) {
    throw new Error(`Invalid card definition: ${card.id}`);
  }
}
for (const def of [...units.values(), ...enemies.values()]) {
  if ([def.hp, def.damage, def.reach, def.interval, def.speed].some(value => !Number.isFinite(value) || value <= 0)
    || !Number.isInteger(def.interval) || !Number.isInteger(def.armor) || def.armor < 0) throw new Error(`Invalid unit: ${def.id}`);
}
for (const def of buildings.values()) {
  if (!validCost(def.income) || !Number.isInteger(def.hp) || def.hp <= 0 || !Number.isInteger(def.interval) || def.interval <= 0
    || !Number.isInteger(def.damage) || def.damage < 0 || !Number.isFinite(def.reach) || def.reach < 0) throw new Error(`Invalid building: ${def.id}`);
  if (!validCost(def.upgrade.cost) || !Number.isInteger(def.upgrade.hp) || def.upgrade.hp <= 0
    || (def.upgrade.income && !validCost(def.upgrade.income)) || (def.capacity && !validCost(def.capacity))
    || (def.upgrade.capacity && !validCost(def.upgrade.capacity)) || (def.recruits && !units.has(def.recruits))) {
    throw new Error(`Invalid building upgrade or recruit: ${def.id}`);
  }
}
for (const id of [...starter, ...rewardPool, ...expansion.march.starter]) if (!cards.has(id)) throw new Error(`Unknown card: ${id}`);
for (const id of starterDeck) if (cards.get(id)?.kind !== 'tactic') throw new Error(`Invalid reusable card: ${id}`);
const permitRewards = [...rewardPool, ...shopPool];
if (new Set(rewardPool).size < 2 || new Set(permitRewards).size < 4 || new Set(starterDeck).size < 2
  || permitRewards.some(id => starterDeck.includes(id))) throw new Error('Invalid reward pools');
for (const campaign of Object.values(campaigns)) for (const wave of campaign.waves) for (const group of wave.groups) {
  if (!enemies.has(group.enemy) || !Number.isInteger(group.count) || group.count <= 0 || !Number.isInteger(group.gap) || group.gap <= 0) {
    throw new Error(`Invalid wave: ${wave.name}`);
  }
}
if (!validCost(map.start) || !validCost(map.capacity) || !validCost(rewardIncome)
  || resources.some(key => map.start[key] > map.capacity[key])) throw new Error('Invalid economy configuration');
for (const encounter of encounters) {
  if (encounter.choices.length < 2 || new Set(encounter.choices.map(choice => choice.id)).size !== encounter.choices.length
    || encounter.choices.some(choice => !validCost(choice.cost) || (choice.gain && !validCost(choice.gain))
      || (choice.card && cards.get(choice.card)?.kind !== 'event') || [choice.card, choice.gain, choice.relic].filter(Boolean).length !== 1)) {
    throw new Error(`Invalid encounter: ${encounter.id}`);
  }
}
for (const crossing of routes.values()) for (const swap of crossing.swaps) {
  const group = campaigns.march.waves[swap.wave]?.groups.find(group => group.enemy === swap.from);
  if (!group || !enemies.has(swap.to) || !Number.isInteger(swap.count) || swap.count < 1 || swap.count >= group.count) {
    throw new Error(`Invalid enemy swap: ${crossing.id}`);
  }
}
const validEasternGrass = ({ x, y }: { x: number; y: number }) => Number.isInteger(x) && Number.isInteger(y) && x > map.riverX
  && x < map.width && y >= 0 && y < map.height && ![map.keep, ...map.rocks].some(tile => tile.x === x && tile.y === y);
const districtCells = districts.flatMap(district => district.cells);
for (const sites of [districtCells, leySites]) {
  if (!sites.length || sites.some(site => !validEasternGrass(site))
    || new Set(sites.map(({ x, y }) => y * map.width + x)).size !== sites.length) throw new Error('Invalid deployment sites');
}
if (districts.some(district => !district.name || !district.cells.length || !Number.isInteger(district.wave)
  || district.wave < 1 || district.wave >= campaigns.march.waves.length)) throw new Error('Invalid district progression');
