import { decodeCheckpoint } from '../core/checkpoint';
import { decodeChronicle, isRecordedExpedition } from '../core/chronicle';
import type { Chronicle } from '../core/chronicle';
import type { Run } from '../core/types';
import { decodeCheckpointFrames, encodeCheckpointWithFrames } from './checkpoint-frames';
import type { FrameHistory } from './checkpoint-frames';

export const checkpointKey = 'nine-kingdoms-run-v1';
export const checkpointBackupKey = 'nine-kingdoms-run-backup-v1';
export const chronicleKey = 'nine-kingdoms-chronicle-v1';

export type CheckpointRevision = { primary: string | null; backup: string | null };
type CheckpointInspection =
  | { status: 'ready' | 'recovered'; run: Run; revision: CheckpointRevision; frames: FrameHistory }
  | { status: 'empty' | 'invalid'; revision: CheckpointRevision }
  | { status: 'unavailable'; revision?: undefined };

export function readCheckpointRevision(storage: Pick<Storage, 'getItem'> = localStorage): CheckpointRevision {
  return { primary: storage.getItem(checkpointKey), backup: storage.getItem(checkpointBackupKey) };
}

export function sameCheckpointRevision(current: CheckpointRevision, expected?: CheckpointRevision): boolean {
  return expected !== undefined && current.primary === expected.primary && current.backup === expected.backup;
}

export function inspectCheckpoint(storage?: Pick<Storage, 'getItem'>, chronicle?: Chronicle): CheckpointInspection {
  try {
    const target = storage ?? localStorage;
    const revision = readCheckpointRevision(target);
    const { primary, backup } = revision;
    const main = primary === null ? undefined : decodeCheckpoint(primary);
    const run = main ?? (backup === null ? undefined : decodeCheckpoint(backup));
    if (run) {
      if (run.chronicleId && isRecordedExpedition(run, chronicle ?? decodeChronicle(target.getItem(chronicleKey)))) {
        return { status: 'empty', revision };
      }
      return { status: main ? 'ready' : 'recovered', run, revision, frames: decodeCheckpointFrames((main ? primary : backup)!, run) };
    }
    return { status: primary === null && backup === null ? 'empty' : 'invalid', revision };
  } catch { return { status: 'unavailable' }; }
}

type CheckpointWrite = { status: 'saved'; revision: CheckpointRevision } | { status: 'changed' | 'unavailable' };

export function storeCheckpoint(run: Run, expected: CheckpointRevision = { primary: null, backup: null }, frames?: FrameHistory): CheckpointWrite {
  try {
    const primary = encodeCheckpointWithFrames(run, frames);
    if (primary === undefined) return { status: 'unavailable' };
    if (!sameCheckpointRevision(readCheckpointRevision(), expected)) return { status: 'changed' };
    localStorage.setItem(checkpointKey, primary);
    let backup = expected.backup;
    try {
      localStorage.setItem(checkpointBackupKey, primary);
      backup = primary;
    } catch { /* keep the successfully saved primary checkpoint */ }
    return { status: 'saved', revision: { primary, backup } };
  } catch { return { status: 'unavailable' }; }
}

export function removeCheckpoint(expected?: CheckpointRevision): void {
  if (!expected) return;
  try {
    if (!sameCheckpointRevision(readCheckpointRevision(), expected)) return;
    localStorage.removeItem(checkpointBackupKey);
    localStorage.removeItem(checkpointKey);
  } catch { /* storage may be unavailable */ }
}
