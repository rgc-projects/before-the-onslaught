import { decodeCheckpoint } from '../core/checkpoint';
import { decodeChronicle, isRecordedExpedition, parseChronicle } from '../core/chronicle';
import type { Chronicle } from '../core/chronicle';
import type { Run } from '../core/types';
import { decodeCheckpointFrames, encodeCheckpointWithFrames } from './checkpoint-frames';
import type { FrameHistory } from './checkpoint-frames';
import { checkpointBackupKey, checkpointKey, chronicleKey, inspectCheckpoint, readCheckpointRevision, sameCheckpointRevision } from './local-checkpoint';
import type { CheckpointRevision } from './local-checkpoint';

const FORMAT = 'nine-kingdoms-progress';
export const maxProgressFile = 256 * 1024;
export type ProgressFile = { run: Run | null; chronicle: Chronicle; frames?: FrameHistory };
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ProgressRevision = CheckpointRevision & { chronicle: string | null };

export function inspectProgress(storage?: Pick<Storage, 'getItem'>) {
  try {
    const target = storage ?? localStorage;
    const raw = target.getItem(chronicleKey);
    const chronicle = decodeChronicle(raw);
    const saved = inspectCheckpoint(target, chronicle);
    if (!saved.revision) return undefined;
    return { saved, chronicle, revision: { ...saved.revision, chronicle: raw } };
  } catch { return undefined; }
}

function portableCheckpoint({ run, chronicle, frames }: ProgressFile): string | null | undefined {
  return run && !isRecordedExpedition(run, chronicle) ? encodeCheckpointWithFrames(run, frames) : null;
}

export function encodeProgress(progress: ProgressFile): string | undefined {
  const checkpoint = portableCheckpoint(progress);
  if (checkpoint === undefined) return undefined;
  return JSON.stringify({ format: FORMAT, version: 1, checkpoint: checkpoint && JSON.parse(checkpoint), chronicle: progress.chronicle }, null, 2);
}

export function decodeProgress(text: string): ProgressFile | undefined {
  if (text.length > maxProgressFile) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') return undefined;
    const data = value as Record<string, unknown>;
    if (data.format !== FORMAT || data.version !== 1 || !('checkpoint' in data)) return undefined;
    const chronicle = parseChronicle(data.chronicle);
    const checkpoint = JSON.stringify(data.checkpoint);
    const run = data.checkpoint === null ? null : decodeCheckpoint(checkpoint);
    if (!chronicle || run === undefined) return undefined;
    if (run && isRecordedExpedition(run, chronicle)) return { run: null, chronicle };
    const frames = run ? decodeCheckpointFrames(checkpoint, run) : [];
    return frames.length ? { run, chronicle, frames } : { run, chronicle };
  } catch { return undefined; }
}

export function restoreProgress(
  progress: ProgressFile,
  expected: ProgressRevision | undefined,
  storage?: ProgressStorage,
): 'restored' | 'changed' | 'unavailable' {
  const checkpoint = portableCheckpoint(progress);
  if (checkpoint === undefined) return 'unavailable';
  try {
    const target = storage ?? localStorage;
    const current = { ...readCheckpointRevision(target), chronicle: target.getItem(chronicleKey) };
    if (!expected || current.chronicle !== expected.chronicle || !sameCheckpointRevision(current, expected)) return 'changed';
    const changes = [
      { key: chronicleKey, previous: current.chronicle, value: JSON.stringify(progress.chronicle) },
      { key: checkpointKey, previous: current.primary, value: checkpoint },
      { key: checkpointBackupKey, previous: current.backup, value: checkpoint },
    ].filter(({ value, previous }) => value !== previous);
    const write = (key: string, value: string | null) => value === null ? target.removeItem(key) : target.setItem(key, value);
    let written = 0;
    try {
      for (const { key, value } of changes) {
        write(key, value);
        written++;
      }
      return 'restored';
    } catch {
      for (const { key, previous } of changes.slice(0, written).reverse()) {
        try { write(key, previous); } catch { /* storage may have become unavailable */ }
      }
      return 'unavailable';
    }
  } catch { return 'unavailable'; }
}
