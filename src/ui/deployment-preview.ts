import { resources } from '../core/types';
import type { Point, Run } from '../core/types';
import { buildings, cards } from '../data/content';
import { arcaneBonus, buildingStats } from '../systems/buildings';
import { checkCard, playCard } from '../systems/cards';
import { checkRelocation, managedPlacement, relocationCost } from '../systems/deployments';
import { spend } from '../systems/economy';
import { footprint } from '../systems/grid';
import { previewApproach } from './approach';
import type { Approach } from './approach';
import { crossingCoverage } from './crossing-coverage';
import { costText, resourceLabel } from './labels';
import { forecastSupplies } from './supply';

export type DeploymentPreview = { tiles: Point[]; valid: boolean; text: string; approach?: Approach };
export type PlacementBaseline = {
  supplies: ReturnType<typeof forecastSupplies>;
  crossings: ReturnType<typeof crossingCoverage>;
  approach?: Approach;
};

export function describeDeployment(run: Run, slot: number, tile: Point, baseline?: PlacementBaseline): DeploymentPreview {
  const card = cards.get(run.hand[slot]);
  const definition = card?.kind === 'building' ? buildings.get(card.ref) : undefined;
  const tiles = definition ? footprint(definition, tile) : [tile];
  const result = checkCard(run, slot, tile);
  if (!result.ok) return { tiles, valid: false, text: result.reason };
  if (card?.kind === 'fortify') return { tiles, valid: true, text: '可升级这座建筑。' };
  if (!definition && card?.kind !== 'unit') return { tiles, valid: true, text: '可在此设置集结点。' };

  // Building and rally cards use the same placement rules as committed orders.
  const projected = { ...run, wallet: { ...run.wallet }, hand: [...run.hand],
    buildings: [...run.buildings], rally: [...run.rally], deployments: [...run.deployments] };
  playCard(projected, slot, tile, []);
  if (!definition) return { tiles, valid: true, text: ['可在此设置集结点', ...layoutDelta(run, projected, baseline)].join(' · ') };
  const structure = projected.buildings.at(-1)!;
  const notes = [`占地 ${tiles.length} 格`, ...layoutDelta(run, projected, baseline)];
  const damage = buildingStats(structure).damage + arcaneBonus(projected, structure);
  if (damage) notes.push(`每次攻击伤害 ${damage}`);
  const approach = definition.block && previewApproach(run, projected, notes, baseline?.approach);
  return { tiles, valid: true, text: notes.join(' · '), ...(approach ? { approach } : {}) };
}

export function describeRelocation(run: Run, id: number, tile: Point, baseline?: PlacementBaseline): DeploymentPreview {
  const target = managedPlacement(run, id);
  const tiles = target?.kind === 'building' ? footprint(buildings.get(target.item.def)!, tile) : [tile];
  const check = checkRelocation(run, id, tile);
  if (!check.ok) return { tiles, valid: false, text: check.reason };

  const cost = relocationCost[check.target.kind];
  const projected = {
    ...run,
    wallet: { ...run.wallet },
    buildings: run.buildings.map(item => item.id === id ? { ...item, tile } : item),
    rally: run.rally.map(item => item.id === id ? { ...item, tile } : item),
  };
  spend(projected.wallet, cost);
  const notes = [`占地 ${tiles.length} 格`, `迁移消耗 ${costText(cost)}`, ...layoutDelta(run, projected, baseline)];
  const futureStructure = projected.buildings.find(item => item.id === id);
  if (futureStructure) {
    const damage = buildingStats(futureStructure).damage + arcaneBonus(projected, futureStructure);
    if (damage) notes.push(`每次攻击伤害 ${damage}`);
  }
  const approach = futureStructure && buildings.get(futureStructure.def)?.block
    && previewApproach(run, projected, notes, baseline?.approach);
  return { tiles, valid: true, text: notes.join(' · '), ...(approach ? { approach } : {}) };
}

function layoutDelta(run: Run, projected: Run, baseline?: PlacementBaseline): string[] {
  const { income: currentIncome, muster: currentMuster } = baseline?.supplies ?? forecastSupplies(run);
  const { income: futureIncome, muster: futureMuster } = forecastSupplies(projected);
  const income = resources.flatMap(key => {
    const amount = futureIncome[key] - currentIncome[key];
    return amount ? [`${amount > 0 ? '+' : '−'}${Math.abs(amount)} ${resourceLabel[key]}`] : [];
  });
  const positions = futureMuster.ready - currentMuster.ready;
  let boosted = 0;
  let weakened = 0;
  for (const building of run.buildings) {
    const after = projected.buildings.find(item => item.id === building.id);
    if (!after) continue;
    const difference = arcaneBonus(projected, after) - arcaneBonus(run, building);
    if (difference > 0) boosted++;
    if (difference < 0) weakened++;
  }
  const notes: string[] = [];
  if (income.length) notes.push(`开战前产出 ${income.join('、')}`);
  if (positions) notes.push(`出阵位置 ${positions > 0 ? '+' : '−'}${Math.abs(positions)} 个`);
  const shortage = futureMuster.fed < futureMuster.ready;
  if (currentMuster.fed !== futureMuster.fed) {
    notes.push(`预计出阵 ${currentMuster.fed} → ${futureMuster.fed} 支${shortage ? '（军粮不足）' : ''}`);
  } else if (positions > 0 && shortage) {
    notes.push(`军粮不足，预计仍出阵 ${futureMuster.fed} 支`);
  }
  for (const building of run.buildings) {
    const current = currentMuster.groups.get(building.id);
    const future = futureMuster.groups.get(building.id);
    if (!current || !future || current.ready === future.ready) continue;
    const name = buildings.get(building.def)!.name;
    notes.push(`「${name}」（${current.origin.x + 1} 列 ${current.origin.y + 1} 行）出阵位 ${current.ready} → ${future.ready}`);
  }
  if (boosted) notes.push(`强化 ${boosted} 座相邻法术塔`);
  if (weakened) notes.push(`削弱 ${weakened} 座法术塔`);
  const before = baseline?.crossings ?? crossingCoverage(run);
  crossingCoverage(projected).forEach(({ name, towers }, index) => {
    const change = towers - before[index].towers;
    if (change) notes.push(`${name}覆盖 ${change > 0 ? '+' : '−'}${Math.abs(change)} 座防御塔`);
  });
  return notes;
}
