import type { Run } from '../core/types';
import { map } from '../data/content';
import { routes } from '../data/journey';
import { buildingStats, watchReach } from '../systems/buildings';
import { distance } from '../systems/grid';

export function crossingCoverage(run: Run) {
  const towers = run.buildings.flatMap(building => {
    if (building.hp <= 0) return [];
    const stats = buildingStats(building);
    return stats.damage ? [{ tile: building.tile, reach: stats.reach + watchReach(run, building.def) }] : [];
  });
  const rows = [...routes.get(run.route)!.bridges].sort((a, b) => a - b);
  return rows.map((row, index) => {
    const bridge = { x: map.riverX, y: row };
    return {
      row: row + 1,
      name: index === 0 ? '北渡口' : '南渡口',
      towers: towers.filter(tower => distance(tower.tile, bridge) <= tower.reach).length,
    };
  });
}
