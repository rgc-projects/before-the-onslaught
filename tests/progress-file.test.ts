import { describe, expect, it } from 'vitest';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { createRun } from '../src/core/game';
import { emptyChronicle } from '../src/core/chronicle';
import type { Chronicle } from '../src/core/chronicle';
import { checkpointBackupKey, checkpointKey, chronicleKey, inspectCheckpoint } from '../src/platform/local-checkpoint';
import { decodeCheckpointFrames } from '../src/platform/checkpoint-frames';
import type { FrameHistory } from '../src/platform/checkpoint-frames';
import { decodeProgress, encodeProgress, inspectProgress, maxProgressFile, restoreProgress } from '../src/platform/progress-file';

const chronicle: Chronicle = { version: 1, merit: 3, expeditions: 1, victories: 1, records: ['1'.repeat(32)] };

function fakeStorage(initial: [string, string][], failKey?: string) {
  const data = new Map(initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem(key: string, value: string) {
      if (key === failKey) throw new Error('Quota exceeded');
      data.set(key, value);
    },
    removeItem: (key: string) => data.delete(key),
  };
}

describe('portable progress files', () => {
  it('round-trips the checkpoint and chronicle and uses existing checkpoint migrations', () => {
    const run = createRun(119, 'march', 'war');
    run.formation = 'inner';
    const file = encodeProgress({ run, chronicle })!;
    expect(decodeProgress(file)).toEqual({ run, chronicle });
    const old = JSON.parse(file);
    old.checkpoint.version = 11;
    delete old.checkpoint.run.formation;
    expect(decodeProgress(JSON.stringify(old))?.run).toEqual({ ...run, formation: 'advance' });
  });

  it('carries completed frame samples in both checkpoint copies without requiring valid samples to continue', () => {
    const run = createRun(119, 'march', 'war');
    run.wave = 1;
    const frames: FrameHistory = [{ wave: 0, samples: [
      { cap: '60', motion: 'full', width: 1280, height: 720, seconds: 9, fps: 59.8, p95: 18, stalls: 1 },
    ] }];
    const file = encodeProgress({ run, chronicle, frames })!;
    const imported = decodeProgress(file)!;
    expect(imported).toEqual({ run, chronicle, frames });
    const store = fakeStorage([]);
    expect(restoreProgress(imported, inspectProgress(store)?.revision, store)).toBe('restored');
    const checkpoint = store.getItem(checkpointKey)!;
    expect(store.getItem(checkpointBackupKey)).toBe(checkpoint);
    expect(decodeCheckpoint(checkpoint)).toEqual(run);
    expect(decodeCheckpointFrames(checkpoint, run)).toEqual(frames);

    const damaged = JSON.parse(file);
    damaged.checkpoint.frameHistory[0].wave = 1;
    expect(decodeProgress(JSON.stringify(damaged))).toEqual({ run, chronicle });
    damaged.checkpoint.frameHistory[0].wave = 0;
    damaged.checkpoint.frameHistory[0].samples[0].p95 = -1;
    expect(decodeProgress(JSON.stringify(damaged))).toEqual({ run, chronicle });
  });

  it('rejects corrupt, oversized or newer files as a whole', () => {
    const file = JSON.parse(encodeProgress({ run: createRun(1), chronicle })!);
    expect(decodeProgress('not a file')).toBeUndefined();
    expect(decodeProgress(' '.repeat(maxProgressFile + 1))).toBeUndefined();
    expect(decodeProgress(JSON.stringify({ ...file, version: 2 }))).toBeUndefined();
    expect(decodeProgress(JSON.stringify({ ...file, chronicle: { ...chronicle, merit: 4 } }))).toBeUndefined();
    expect(decodeProgress(JSON.stringify({ ...file, checkpoint: {} }))).toBeUndefined();
    const nested = '['.repeat(12000) + '0' + ']'.repeat(12000);
    expect(decodeProgress(`{"format":"nine-kingdoms-progress","version":1,"chronicle":${JSON.stringify(chronicle)},"checkpoint":${nested}}`)).toBeUndefined();
  });

  it('restores both checkpoint copies and can replace them with a chronicle-only backup', () => {
    const store = fakeStorage([]);
    const run = createRun(119, 'march', 'war');
    expect(restoreProgress({ run, chronicle }, inspectProgress(store)?.revision, store)).toBe('restored');
    expect(decodeCheckpoint(store.getItem(checkpointKey)!)).toEqual(run);
    expect(store.getItem(checkpointBackupKey)).toBe(store.getItem(checkpointKey));
    const career = decodeProgress(encodeProgress({ run: null, chronicle })!)!;
    expect(restoreProgress(career, inspectProgress(store)?.revision, store)).toBe('restored');
    expect([...store.data]).toEqual([[chronicleKey, JSON.stringify(chronicle)]]);
  });

  it.each([checkpointKey, checkpointBackupKey])('keeps a recorded expedition in %s closed and retains its raw revision', key => {
    const run = createRun(119, 'march', 'war');
    run.chronicleId = chronicle.records[0];
    const record = encodeCheckpoint(run)!;
    const active = createRun(81, 'march', 'iron');
    active.chronicleId = '2'.repeat(32);
    const other = key === checkpointKey ? encodeCheckpoint(active)! : 'damaged';
    const [primary, backup] = key === checkpointKey ? [record, other] : [other, record];
    const initial: [string, string][] = [[checkpointKey, primary], [checkpointBackupKey, backup], [chronicleKey, JSON.stringify(chronicle)]];
    const store = fakeStorage(initial);
    expect(inspectCheckpoint(store)).toEqual({ status: 'empty', revision: { primary, backup } });
    expect(inspectProgress(store)?.saved.status).toBe('empty');
    expect([...store.data]).toEqual(initial);
    expect(restoreProgress({ run: active, chronicle }, inspectProgress(store)?.revision, store)).toBe('restored');
    expect(inspectCheckpoint(store)).toMatchObject({ status: 'ready', run: active });
  });

  it('imports a legacy backup with a recorded expedition as chronicle-only and preserves a genuine earlier snapshot', () => {
    const run = createRun(119, 'march', 'war');
    run.chronicleId = chronicle.records[0];
    const earlier = encodeProgress({ run, chronicle: emptyChronicle() })!;
    expect(decodeProgress(earlier)).toEqual({ run, chronicle: emptyChronicle() });
    const legacy = { ...JSON.parse(earlier), chronicle };
    expect(decodeProgress(JSON.stringify(legacy))).toEqual({ run: null, chronicle });
    expect(JSON.parse(encodeProgress({ run, chronicle })!).checkpoint).toBeNull();
  });

  it('rolls back partial storage writes when a later key cannot be written', () => {
    const initial: [string, string][] = [
      [chronicleKey, JSON.stringify(emptyChronicle())], [checkpointKey, 'prior'], [checkpointBackupKey, 'older'],
    ];
    const store = fakeStorage(initial, checkpointBackupKey);
    expect(restoreProgress({ run: createRun(2), chronicle }, inspectProgress(store)?.revision, store)).toBe('unavailable');
    expect([...store.data]).toEqual(initial);
  });

  it.each([checkpointKey, checkpointBackupKey, chronicleKey])('preserves a newer value of %s until the new snapshot is confirmed', key => {
    const store = fakeStorage([]);
    const previous = inspectProgress(store)?.revision;
    expect(previous).toBeDefined();
    store.setItem(key, 'new revision');
    const imported = { run: createRun(2), chronicle };
    expect(restoreProgress(imported, previous, store)).toBe('changed');
    expect([...store.data]).toEqual([[key, 'new revision']]);
    expect(restoreProgress(imported, inspectProgress(store)?.revision, store)).toBe('restored');
    expect(decodeCheckpoint(store.getItem(checkpointKey)!)).toEqual(imported.run);
    expect(store.getItem(checkpointBackupKey)).toBe(store.getItem(checkpointKey));
    expect(store.getItem(chronicleKey)).toBe(JSON.stringify(chronicle));
  });
});
