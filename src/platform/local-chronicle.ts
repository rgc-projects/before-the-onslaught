import { decodeChronicle, emptyChronicle, finishExpedition } from '../core/chronicle';
import type { Run } from '../core/types';
import { chronicleKey, inspectCheckpoint, sameCheckpointRevision } from './local-checkpoint';
import type { CheckpointRevision } from './local-checkpoint';

export function readChronicle() {
  try { return decodeChronicle(localStorage.getItem(chronicleKey)); } catch { return emptyChronicle(); }
}

type ChronicleAward = { status: 'saved'; gained: number; before: number; total: number }
  | { status: 'superseded' | 'unavailable' };

export function awardChronicle(run: Run, expected?: CheckpointRevision): ChronicleAward {
  try {
    const profile = decodeChronicle(localStorage.getItem(chronicleKey));
    const saved = inspectCheckpoint(undefined, profile);
    if (run.chronicleId && 'run' in saved && saved.run.chronicleId === run.chronicleId
      && !sameCheckpointRevision(saved.revision, expected)) return { status: 'superseded' };
    const result = finishExpedition(profile, run);
    if (result.gained) localStorage.setItem(chronicleKey, JSON.stringify(result.profile));
    return { status: 'saved', gained: result.gained, before: profile.merit, total: result.profile.merit };
  } catch { return { status: 'unavailable' }; }
}

export function identifyExpedition(run: Run): void {
  if (run.campaign !== 'march' || run.chronicleId) return;
  run.chronicleId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
