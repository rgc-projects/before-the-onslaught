import { resources } from '../core/types';
import type { Building, Card, Cost, DeploymentRecord, GameEvent, Placement, Point, Result, Run } from '../core/types';
import { buildings, cards, tuning } from '../data/content';
import { canAfford, capacity, spend } from './economy';
import { checkPlacement, same } from './grid';

type UndoPreview = Extract<Result, { ok: false }> | { ok: true; record: DeploymentRecord; card: Card };
type ManagedPlacement = { kind: 'building'; item: Building } | { kind: 'rally'; item: Placement };
type LayoutChange = Extract<Result, { ok: false }> | { ok: true; target: ManagedPlacement };
export const relocationCost: Readonly<Record<ManagedPlacement['kind'], Cost>> = tuning.relocation;

export function managedPlacement(run: Run, id: number): ManagedPlacement | undefined {
  const building = run.buildings.find(item => item.id === id && item.hp > 0);
  if (building) return { kind: 'building', item: building };
  const rally = run.rally.find(item => item.id === id);
  return rally && { kind: 'rally', item: rally };
}

export function checkRelocationStart(run: Run, id: number): LayoutChange {
  if (run.phase !== 'planning') return { ok: false, reason: '只能在备战时迁移。' };
  const target = managedPlacement(run, id);
  if (!target) return { ok: false, reason: '这项部署已经不存在。' };
  if (!canAfford(run.wallet, relocationCost[target.kind])) return { ok: false, reason: '迁移所需资源不足。' };
  return { ok: true, target };
}

export function checkRelocation(run: Run, id: number, tile: Point): LayoutChange {
  const check = checkRelocationStart(run, id);
  if (!check.ok) return check;
  const { target } = check;
  if (same(tile, target.item.tile)) return { ok: false, reason: '请选择与原址不同的位置。' };
  const structure = target.kind === 'building' ? buildings.get(target.item.def)! : undefined;
  const placement = checkPlacement(run, tile, structure, id);
  return placement.ok ? check : placement;
}

export function relocateDeployment(run: Run, id: number, tile: Point, events: GameEvent[]): Result {
  const check = checkRelocation(run, id, tile);
  if (!check.ok) return check;
  spend(run.wallet, relocationCost[check.target.kind]);
  check.target.item.tile = { ...tile };
  events.push({ kind: 'withdrawn', id }, { kind: 'placed', id, at: check.target.item.tile }, { kind: 'resources' });
  return { ok: true };
}

export function checkRemoval(run: Run, id: number): LayoutChange {
  if (run.phase !== 'planning') return { ok: false, reason: '只能在备战时拆除建筑或解散集结点。' };
  const target = managedPlacement(run, id);
  if (!target) return { ok: false, reason: '这项部署已经不存在。' };
  if (target.kind === 'building') {
    const limits = capacity(run.buildings.filter(building => building.id !== id));
    if (resources.some(key => run.wallet[key] > limits[key])) {
      return { ok: false, reason: '拆除后会超出仓储上限，请先腾出一些库存。' };
    }
  }
  return { ok: true, target };
}

export function removeDeployment(run: Run, id: number, events: GameEvent[]): Result {
  const check = checkRemoval(run, id);
  if (!check.ok) return check;
  if (check.target.kind === 'building') run.buildings = run.buildings.filter(building => building.id !== id);
  else run.rally = run.rally.filter(unit => unit.id !== id);
  if (run.supplyPriority === id) run.supplyPriority = null;
  run.deployments = run.deployments.filter(record => record.id !== id);
  events.push({ kind: 'withdrawn', id }, { kind: 'resources' });
  return { ok: true };
}

/** Later placements can still be undone after a building's use commits everything through its placement. */
export function commitDeployment(run: Run, id: number): void {
  const index = run.deployments.findIndex(record => record.id === id);
  if (index >= 0) run.deployments.splice(0, index + 1);
}

export function previewDeploymentUndo(run: Run): UndoPreview {
  const record = run.deployments.at(-1);
  if (run.phase !== 'planning' || !record) return { ok: false, reason: '本波没有可撤销的部署。' };
  const card = cards.get(record.card);
  if (!card || (card.kind !== 'building' && card.kind !== 'unit')) return { ok: false, reason: '这项部署已无法撤销。' };
  const target = card.kind === 'building'
    ? run.buildings.find(building => building.id === record.id && building.level === 1 && building.hp > 0)
    : run.rally.find(unit => unit.id === record.id);
  if (target?.def !== card.ref) return { ok: false, reason: '这项部署已无法撤销。' };

  const limits = capacity(run.buildings.filter(building => building.id !== record.id));
  if (resources.some(key => run.wallet[key] + (card.cost[key] ?? 0) > limits[key])) {
    return { ok: false, reason: '返还后会超出仓储上限，请先腾出一些库存。' };
  }
  return { ok: true, record, card };
}

export function undoDeployment(run: Run, events: GameEvent[]): Result {
  const preview = previewDeploymentUndo(run);
  if (!preview.ok) return preview;
  const { record, card } = preview;
  if (card.kind === 'building') run.buildings = run.buildings.filter(building => building.id !== record.id);
  else run.rally = run.rally.filter(unit => unit.id !== record.id);
  if (run.supplyPriority === record.id) run.supplyPriority = null;
  run.hand.splice(record.slot, 0, card.id);
  for (const key of resources) run.wallet[key] += card.cost[key] ?? 0;
  run.deployments.pop();
  events.push({ kind: 'withdrawn', id: record.id }, { kind: 'resources' });
  return { ok: true };
}
