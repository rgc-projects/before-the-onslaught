import { buildings, map } from '../data/content';
import { districts, leySites, routes } from '../data/journey';
import type { Building, BuildingDef, Point, Result, RouteId, Run, Terrain } from '../core/types';

export const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const inBounds = ({ x, y }: Point): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
export const tileKey = (p: Point): number => p.y * map.width + p.x;
export const neighbors = ({ x, y }: Point): Point[] =>
  [{ x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }, { x: x - 1, y }].filter(inBounds);

export function districtAt(run: Pick<Run, 'campaign'>, tile: Point) {
  return run.campaign === 'march' ? districts.find(district => district.cells.some(cell => same(cell, tile))) : undefined;
}

export function isLeySite(run: Pick<Run, 'campaign'>, tile: Point): boolean {
  return run.campaign === 'march' && leySites.some(site => same(site, tile));
}

export function sealedDistrict(run: Pick<Run, 'campaign' | 'wave'>, tile: Point) {
  const district = districtAt(run, tile);
  return district && run.wave < district.wave ? district : undefined;
}

export function terrain(tile: Point, crossing: RouteId = 'crossing'): Terrain {
  if (same(tile, map.keep)) return 'keep';
  if (same(tile, map.entry)) return 'entry';
  if (map.rocks.some(rock => same(rock, tile))) return 'rock';
  if (tile.x === map.riverX) return routes.get(crossing)!.bridges.includes(tile.y) ? 'bridge' : 'water';
  return 'grass';
}

export function buildingAt(placed: readonly Building[], tile: Point): Building | undefined {
  return placed.find(building => building.hp > 0 && building.tile.y === tile.y && tile.x >= building.tile.x
    && tile.x < building.tile.x + (buildings.get(building.def)?.width ?? 1));
}

export const footprint = (def: BuildingDef, tile: Point): Point[] =>
  Array.from({ length: def.width ?? 1 }, (_, index) => ({ x: tile.x + index, y: tile.y }));

export function checkPlacement(run: Run, tile: Point, structure?: BuildingDef, movingId?: number): Result {
  if (tile.x <= map.riverX) return { ok: false, reason: '只能部署在河东营地。' };
  const cells = structure ? footprint(structure, tile) : [tile];
  if (cells.some(cell => !inBounds(cell) || terrain(cell, run.route) !== 'grass')) {
    return { ok: false, reason: '需要足够的相连草地。' };
  }
  if (cells.some(cell => {
    const building = buildingAt(run.buildings, cell);
    return (building && building.id !== movingId) || run.rally.some(unit => unit.id !== movingId && same(unit.tile, cell));
  })) return { ok: false, reason: '这个格子已被占用。' };
  for (const cell of cells) {
    const district = sealedDistrict(run, cell);
    if (district) return { ok: false, reason: `${district.name}将在第 ${district.wave + 1} 波备战时开放。` };
  }
  if (structure?.site === 'ley' && !isLeySite(run, tile)) return { ok: false, reason: '月环祭坛需要建在标记的灵脉上。' };
  return { ok: true };
}

/** Least-cost route. Enemy fallback increases the cost of breaching each occupied tile. */
export function route(start: Point, end: Point, placed: readonly Building[], breach = false, crossing: RouteId = 'crossing'): Point[] | undefined {
  const startKey = tileKey(start);
  const endKey = tileKey(end);
  const cost = new Map([[startKey, 0]]);
  const parents = new Map<number, Point>();
  const open = [start];

  while (open.length) {
    const best = open.reduce((a, b, i) => cost.get(tileKey(b))! < cost.get(tileKey(open[a]))! ? i : a, 0);
    const [current] = open.splice(best, 1);
    const key = tileKey(current);
    if (key === endKey) {
      const path: Point[] = [];
      let node = current;
      while (!same(node, start)) {
        path.push(node);
        node = parents.get(tileKey(node))!;
      }
      return path.reverse();
    }
    for (const next of neighbors(current)) {
      const ground = terrain(next, crossing);
      if (ground === 'water' || ground === 'rock') continue;
      const wall = buildingAt(placed, next);
      const blocked = wall && buildings.get(wall.def)!.block;
      if (blocked && !breach) continue;
      const nextKey = tileKey(next);
      const candidate = cost.get(key)! + (blocked ? 5 + wall.hp : 1);
      if (candidate >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, candidate);
      parents.set(nextKey, current);
      if (!open.some(tile => same(tile, next))) open.push(next);
    }
  }
  return undefined;
}

export function routeToKeep(start: Point, placed: readonly Building[], crossing: RouteId): Point[] | undefined {
  return route(start, map.keep, placed, false, crossing) ?? route(start, map.keep, placed, true, crossing);
}
