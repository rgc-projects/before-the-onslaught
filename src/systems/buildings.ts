import { resources } from '../core/types';
import type { Actor, Building, Cost, GameEvent, Point, Result, Run } from '../core/types';
import { buildings, kingdomPower, map, rampartGuard, tuning, units } from '../data/content';
import { relicPower } from '../data/journey';
import { commitDeployment } from './deployments';
import { buildingAt, distance, neighbors, sealedDistrict, terrain, tileKey } from './grid';
import { researchPower } from './research';

const buildingPower = { market: tuning.buildings.marketGold, blessing: tuning.buildings.shrineHealth,
  research: tuning.buildings.researchDiscount, ritual: tuning.buildings.ritualPower };

export function buildingStats(building: Building) {
  const def = buildings.get(building.def)!;
  const upgrade = building.level === 2 ? def.upgrade : undefined;
  return {
    hp: def.hp + (upgrade?.hp ?? 0),
    damage: def.damage + (upgrade?.damage ?? 0),
    reach: def.reach + (upgrade?.reach ?? 0),
    income: accumulate(def.income, upgrade?.income),
    capacity: accumulate(def.capacity, upgrade?.capacity),
    recruits: def.recruits ? 1 + (upgrade?.recruits ?? 0) : 0,
    effect: (def.effect ? buildingPower[def.effect] : 0) + (upgrade?.effect ?? 0),
  };
}

function accumulate(base?: Cost, extra?: Cost): Cost {
  const result = { ...base };
  for (const resource of resources) {
    if (extra?.[resource]) result[resource] = (result[resource] ?? 0) + extra[resource]!;
  }
  return result;
}

export function upgradeCost(run: Run, building: Building): Cost {
  const cost = { ...buildings.get(building.def)!.upgrade.cost };
  if (!cost.gold) return cost;
  const discount = run.buildings.reduce((sum, other) => other.hp > 0 && other.id !== building.id
    && buildings.get(other.def)!.effect === 'research' ? sum + buildingStats(other).effect : sum, 0);
  cost.gold = Math.max(1, cost.gold - discount);
  return cost;
}

export function upgradeBuilding(run: Run, id: number, events: GameEvent[]): Result {
  if (run.phase !== 'planning') return { ok: false, reason: '只能在备战时升级建筑。' };
  const building = run.buildings.find(item => item.id === id && item.hp > 0);
  if (!building) return { ok: false, reason: '建筑已经不存在。' };
  if (building.level === 2) return { ok: false, reason: '这座建筑已达到二级。' };
  const cost = upgradeCost(run, building);
  if (resources.some(key => run.wallet[key] < (cost[key] ?? 0))) return { ok: false, reason: '升级资源不足。' };
  for (const key of resources) run.wallet[key] -= cost[key] ?? 0;
  if ((cost.gold ?? 0) < (buildings.get(building.def)!.upgrade.cost.gold ?? 0)) {
    for (const lab of run.buildings) {
      if (lab.id !== id && lab.hp > 0 && buildings.get(lab.def)!.effect === 'research') commitDeployment(run, lab.id);
    }
  }
  applyUpgrade(run, building, events);
  return { ok: true };
}

export function applyUpgrade(run: Run, building: Building, events: GameEvent[]): void {
  commitDeployment(run, building.id);
  building.level = 2;
  building.hp += buildings.get(building.def)!.upgrade.hp;
  events.push({ kind: 'upgraded', id: building.id, at: building.tile }, { kind: 'resources' });
}

export function frontlineRepair(run: Pick<Run, 'kingdom' | 'research'>): number {
  return kingdomPower(run.kingdom, 'repair') + researchPower(run.research, 'masonry');
}

export function openingWallHp(building: Building, repair: number): number {
  return repair && building.def === 'wall' && building.hp > 0
    ? Math.min(buildingStats(building).hp, building.hp + repair) : building.hp;
}

export function restoreFrontline(run: Run): void {
  const repair = frontlineRepair(run);
  if (!repair) return;
  for (const building of run.buildings) building.hp = openingWallHp(building, repair);
}

export function watchReach(run: Run, id: string): number {
  return id === 'watch' ? researchPower(run.research, 'fletching') : 0;
}

export function reinforcedWatch(run: Run, building: Building): number {
  return run.campaign === 'march' && building.def === 'watch'
    && neighbors(building.tile).some(tile => buildingAt(run.buildings, tile)?.def === 'wall') ? tuning.buildings.reinforcedWatchTicks : 0;
}

export function guardsRampart(run: Run, def: string, tile: Point): boolean {
  return run.kingdom === 'iron' && rampartGuard.units.includes(def)
    && run.buildings.some(wall => wall.def === 'wall' && wall.hp > 0 && distance(tile, wall.tile) <= rampartGuard.distance);
}

export function arcaneBonus(run: Run, building: Building): number {
  if (building.def !== 'magetower' && building.def !== 'arcanetower') return 0;
  const ritual = neighbors(building.tile).reduce((best, tile) => {
    const source = buildingAt(run.buildings, tile);
    return source && buildings.get(source.def)?.effect === 'ritual' ? Math.max(best, buildingStats(source).effect) : best;
  }, 0);
  return ritual + kingdomPower(run.kingdom, 'arcane') + relicPower(run.relics, 'arcane');
}

function musterSlots(run: Run, building: Building): number {
  const base = buildingStats(building).recruits;
  if (!base || run.campaign !== 'march') return base;
  const def = building.def;
  const extra = def === 'stable' ? kingdomPower(run.kingdom, 'cavalry') : 0;
  const beside = neighbors(building.tile).map(tile => buildingAt(run.buildings, tile)?.def);
  const linked = (def === 'barracks' && beside.includes('wall'))
    || (def === 'bowcamp' && beside.includes('barracks')) || (def === 'stable' && beside.includes('hall'));
  return base + extra + Number(linked);
}

type Recruit = { id?: number; source: number; def: string; tile: Point; bonusHp?: number };
type Deployment = { limit: number; cells: Point[] };
type MusterSlot = { candidates: Point[]; tile?: Point };
type SupplyGroup = { unit: string; origin: Point; limit: number; ready: number; fed: number };
export type Muster = {
  recruited: Recruit[]; available: number; needed: number; fed: number; ready: number; food: number; vitality: number;
  deployments: Map<number, Deployment>; groups: Map<number, SupplyGroup>; blocked: number; unfed: string[];
};

export function upkeepFor(run: Run, id: string): number {
  const unit = units.get(id)!;
  const discount = unit.attack === 'charge' ? kingdomPower(run.kingdom, 'cavalry') : 0;
  return Math.max(0, (unit.upkeep ?? 0) - discount);
}

export function supplyUnit(run: Run, id: number): string | undefined {
  const rally = run.rally.find(unit => unit.id === id);
  if (rally) return rally.def;
  const building = run.buildings.find(item => item.id === id && item.hp > 0);
  return building ? buildings.get(building.def)?.recruits : undefined;
}

export function setSupplyPriority(run: Run, id: number | null): Result {
  if (run.phase !== 'planning') return { ok: false, reason: '只能在备战时安排军粮。' };
  const unit = id === null ? undefined : supplyUnit(run, id);
  if (id !== null && (!unit || upkeepFor(run, unit) === 0)) return { ok: false, reason: '请选择需要军粮的部队。' };
  run.supplyPriority = id;
  return { ok: true };
}

/** Keep the usual first free cell. Reassign an earlier slot only when that lets another recruit fit. */
function reserveMusterSlot(slot: MusterSlot, occupied: Map<number, MusterSlot>, visited: Set<MusterSlot>): boolean {
  if (visited.has(slot)) return false;
  visited.add(slot);
  let tile = slot.candidates.find(point => !occupied.has(tileKey(point)));
  if (!tile) {
    tile = slot.candidates.find(point => {
      const other = occupied.get(tileKey(point))!;
      return reserveMusterSlot(other, occupied, visited);
    });
  }
  if (!tile) return false;
  slot.tile = tile;
  occupied.set(tileKey(tile), slot);
  return true;
}

/** Forecast and actual muster share one ordering and one reserved set of deployment cells. */
export function planMuster(run: Run, available: number): Muster {
  const recruited: Recruit[] = run.rally.map(unit => ({ ...unit, source: unit.id }));
  const rallyTiles = new Set(recruited.map(unit => tileKey(unit.tile)));
  const occupied = new Map<number, MusterSlot>();
  const camps: { building: Building; unit: string; limit: number; slots: MusterSlot[] }[] = [];
  const deployments = new Map<number, Deployment>();
  const groups = new Map<number, SupplyGroup>(run.rally.map(unit =>
    [unit.id, { unit: unit.def, origin: unit.tile, limit: 1, ready: 1, fed: 0 }]));
  let blocked = 0;
  let vitality = relicPower(run.relics, 'vitality');
  for (const building of run.buildings) {
    if (building.hp <= 0) continue;
    const def = buildings.get(building.def)!;
    const stats = buildingStats(building);
    if (def.effect === 'blessing') vitality += stats.effect;
    if (!def.recruits) continue;
    const candidates = neighbors(building.tile).filter(tile => tile.x > map.riverX && terrain(tile, run.route) === 'grass'
      && !sealedDistrict(run, tile) && !buildingAt(run.buildings, tile) && !rallyTiles.has(tileKey(tile)));
    const limit = musterSlots(run, building);
    const slots: MusterSlot[] = [];
    for (let index = 0; index < limit; index++) {
      const slot: MusterSlot = { candidates };
      if (!reserveMusterSlot(slot, occupied, new Set())) break;
      slots.push(slot);
    }
    camps.push({ building, unit: def.recruits, limit, slots });
  }
  for (const { building, unit, limit, slots } of camps) {
    const cells = slots.map(slot => slot.tile!);
    deployments.set(building.id, { limit, cells });
    groups.set(building.id, { unit, origin: building.tile, limit, ready: cells.length, fed: 0 });
    blocked += limit - cells.length;
    for (const tile of cells) {
      recruited.push({ def: unit, source: building.id, tile, bonusHp: building.def === 'hall' && building.level === 2 ? tuning.combat.hero.upgradedHealth : 0 });
    }
  }
  let needed = 0;
  let food = 0;
  const priority = run.supplyPriority;
  const order = priority === null ? recruited
    : [...recruited.filter(unit => unit.source === priority), ...recruited.filter(unit => unit.source !== priority)];
  const paid = new Set<Recruit>();
  for (const recruit of order) {
    const cost = upkeepFor(run, recruit.def);
    needed += cost;
    if (food + cost > available) continue;
    food += cost;
    paid.add(recruit);
    groups.get(recruit.source)!.fed++;
  }
  const fed: Recruit[] = [];
  const unfed: string[] = [];
  for (const recruit of recruited) {
    if (paid.has(recruit)) fed.push(recruit);
    else unfed.push(recruit.def);
  }
  return { recruited: fed, available, needed, fed: fed.length, ready: recruited.length, food, vitality, deployments, groups, blocked, unfed };
}

export function musterActors(run: Run, plan: Muster): Actor[] {
  run.wallet.food -= plan.food;
  return plan.recruited.map(recruit => ({
    def: recruit.def, tile: { ...recruit.tile }, id: recruit.id ?? run.nextId++, side: 'ally',
    hp: units.get(recruit.def)!.hp + plan.vitality + (recruit.bonusHp ?? 0), bonusHp: plan.vitality + (recruit.bonusHp ?? 0), travel: 0, cooldown: 0,
  }));
}
