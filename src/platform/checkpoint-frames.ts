import { encodeCheckpoint } from '../core/checkpoint';
import type { Run } from '../core/types';
import { isFrameRate } from '../scenes/frame-rate';
import type { FrameSummary } from '../scenes/frame-rate';

export const maxFrameGroups = 12;
export type FrameHistory = { wave: number; samples: FrameSummary[] }[];

export function encodeCheckpointWithFrames(run: Run, frames?: FrameHistory): string | undefined {
  const text = encodeCheckpoint(run);
  if (!text || !frames?.length) return text;
  return JSON.stringify({ ...JSON.parse(text), frameHistory: frames });
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const pixels = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value);

function decodeFrameGroup(value: unknown): FrameSummary | undefined {
  if (!object(value)) return undefined;
  const { cap, motion, width, height, seconds, fps, p95, stalls } = value;
  if (!isFrameRate(cap) || (motion !== 'full' && motion !== 'reduced' && motion !== 'off')
    || !pixels(width) || !pixels(height) || !positive(seconds) || !positive(fps) || !positive(p95)
    || typeof stalls !== 'number' || !Number.isSafeInteger(stalls) || stalls < 0) return undefined;
  return { cap, motion, width, height, seconds, fps, p95, stalls };
}

/** Read presentation metadata once a gameplay checkpoint has already been validated. */
export function decodeCheckpointFrames(text: string, run: Run): FrameHistory {
  const saved: unknown = JSON.parse(text).frameHistory;
  const lastWave = run.phase === 'reward' ? run.wave : run.wave - 1;
  if (!Array.isArray(saved) || saved.length > lastWave + 1) return [];
  const history: FrameHistory = [];
  for (const item of saved) {
    if (!object(item) || typeof item.wave !== 'number' || !Number.isInteger(item.wave)
      || item.wave <= (history.at(-1)?.wave ?? -1) || item.wave > lastWave
      || !Array.isArray(item.samples) || !item.samples.length || item.samples.length > maxFrameGroups) return [];
    const samples: FrameSummary[] = [];
    for (const value of item.samples) {
      const group = decodeFrameGroup(value);
      if (!group) return [];
      samples.push(group);
    }
    history.push({ wave: item.wave, samples });
  }
  return history;
}
