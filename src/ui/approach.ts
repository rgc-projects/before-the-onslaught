import type { Point, Run } from '../core/types';
import { buildings, map } from '../data/content';
import { routes } from '../data/journey';
import { frontlineRepair, openingWallHp } from '../systems/buildings';
import { buildingAt, routeToKeep, same } from '../systems/grid';

type Obstacle = { tile: Point; name: string };
export type Approach = { steps: Point[]; obstacle?: Obstacle };

export function predictApproach(run: Pick<Run, 'buildings' | 'route' | 'kingdom' | 'research'>): Approach {
  const repair = frontlineRepair(run);
  const placed = repair ? run.buildings.map(building => {
    const hp = openingWallHp(building, repair);
    return hp === building.hp ? building : { ...building, hp };
  }) : run.buildings;
  const steps = routeToKeep(map.entry, placed, run.route) ?? [];
  for (const [index, tile] of steps.entries()) {
    const building = buildingAt(placed, tile);
    const definition = building && buildings.get(building.def);
    if (definition?.block) return { steps: steps.slice(0, index + 1), obstacle: { tile, name: definition.name } };
  }
  return { steps };
}

export function describeObstacle({ tile, name }: Obstacle): string {
  return `预计破障点 ${tile.x + 1} 列 ${tile.y + 1} 行 · ${name}`;
}

export function previewApproach(run: Run, projected: Run, notes: string[], current = predictApproach(run)): Approach | undefined {
  const next = predictApproach(projected);
  if (current.obstacle?.name === next.obstacle?.name && current.steps.length === next.steps.length
    && current.steps.every((tile, index) => same(tile, next.steps[index]))) return undefined;

  if (next.obstacle) {
    notes.push(`通路将封闭 · ${describeObstacle(next.obstacle)}`);
  } else {
    const bridge = next.steps.find(tile => tile.x === map.riverX);
    const north = Math.min(...routes.get(run.route)!.bridges);
    const label = current.obstacle ? '通路将开放' : '预计改道';
    notes.push(bridge ? `${label}，经过${bridge.y === north ? '北渡口' : '南渡口'}` : label);
  }
  return next;
}
