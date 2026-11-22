import raw from '../data/research.json';
import { resources } from '../core/types';
import type { Cost, GameEvent, ResearchId, Result, Run } from '../core/types';
import { commitDeployment } from './deployments';

type Topic = { id: ResearchId; name: string; cost: Cost; description: string; power: number };
export const topics = new Map<ResearchId, Topic>();
for (const id of ['fletching', 'provisions', 'masonry'] as const) {
  const row = raw.find(item => item.id === id);
  if (!row || !Number.isFinite(row.power) || row.power <= 0 || Object.entries(row.cost).some(([key, amount]) =>
    !resources.includes(key as keyof Cost) || !Number.isInteger(amount) || amount < 0)) throw new Error(`Invalid research: ${id}`);
  topics.set(id, { ...row, id });
}

export function researchPower(active: ResearchId | null, id: ResearchId): number {
  return active === id ? topics.get(id)!.power : 0;
}

export function commissionResearch(run: Run, id: ResearchId, events: GameEvent[]): Result {
  const topic = topics.get(id);
  const lab = run.buildings.find(building => building.def === 'lab' && building.hp > 0);
  if (!topic || run.phase !== 'planning' || run.campaign !== 'march' || !lab) {
    return { ok: false, reason: '远征备战时需要一座可用的研究所。' };
  }
  if (run.research) return { ok: false, reason: '本局已采用一项科技。' };
  if (resources.some(key => run.wallet[key] < (topic.cost[key] ?? 0))) return { ok: false, reason: '研究资源不足。' };
  for (const key of resources) run.wallet[key] -= topic.cost[key] ?? 0;
  commitDeployment(run, lab.id);
  run.research = id;
  events.push({ kind: 'resources' });
  return { ok: true };
}
