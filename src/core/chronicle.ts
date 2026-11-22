import type { CharterId, KingdomId, Run } from './types';

export const charters = [
  { id: 'storehouse', kind: 'card', merit: 2, name: '仓储许可' },
  { id: 'medic', kind: 'card', merit: 4, name: '治疗师军令' },
  { id: 'magetower', kind: 'card', merit: 6, name: '法师塔蓝图' },
  { id: 'divination', kind: 'ability', merit: 9, name: '占卜传承' },
] as const satisfies ReadonlyArray<{ id: CharterId; kind: 'card' | 'ability'; merit: number; name: string }>;
export const tideMerit = 7;
export const chronicleMilestones = [...charters, { id: 'tide', kind: 'kingdom', merit: tideMerit, name: '潮汐王国' } as const]
  .sort((left, right) => left.merit - right.merit);
export const hasKingdom = (merit: number, kingdom: KingdomId): boolean => kingdom !== 'tide' || merit >= tideMerit;
export const hasCharter = (merit: number, id: CharterId): boolean => charters.some(item => item.id === id && item.merit <= merit);

export type Chronicle = { version: 1; merit: number; expeditions: number; victories: number; records: string[] };
export const emptyChronicle = (): Chronicle => ({ version: 1, merit: 0, expeditions: 0, victories: 0, records: [] });
export const validChronicleId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);

export function isRecordedExpedition(run: Run, profile: Chronicle): boolean {
  return run.chronicleId !== null && profile.records.includes(run.chronicleId);
}

export function parseChronicle(value: unknown): Chronicle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { version, merit, expeditions, victories, records } = value as Partial<Chronicle>;
  const nonNegative = (number: unknown): number is number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0;
  if (version !== 1 || !nonNegative(merit) || !nonNegative(expeditions) || !nonNegative(victories) || victories > expeditions
    || merit !== expeditions + 2 * victories || !Array.isArray(records) || records.length !== Math.min(128, expeditions)
    || !records.every(validChronicleId) || new Set(records).size !== records.length) return undefined;
  return { version, merit, expeditions, victories, records };
}

export function decodeChronicle(raw: string | null): Chronicle {
  if (!raw || raw.length > 16000) return emptyChronicle();
  try { return parseChronicle(JSON.parse(raw)) ?? emptyChronicle(); } catch { return emptyChronicle(); }
}

export function finishExpedition(profile: Chronicle, run: Run): { profile: Chronicle; gained: number } {
  if (run.campaign !== 'march' || !run.chronicleId || (run.phase !== 'won' && run.phase !== 'lost')
    || isRecordedExpedition(run, profile)) return { profile, gained: 0 };
  const won = run.phase === 'won';
  const gained = won ? 3 : 1;
  return { profile: {
    ...profile, merit: profile.merit + gained, expeditions: profile.expeditions + 1,
    victories: profile.victories + Number(won), records: [...profile.records.slice(-127), run.chronicleId],
  }, gained };
}
