import { describe, expect, it } from 'vitest';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { emptyChronicle } from '../src/core/chronicle';
import { createRun, dispatch, step } from '../src/core/game';
import type { Actor } from '../src/core/types';
import { battleLimit, cards } from '../src/data/content';
import { decodeProgress, encodeProgress } from '../src/platform/progress-file';
import { runReportText, waveReportText, waveReview } from '../src/ui/wave-report';

describe('wave review', () => {
  it('archives the cleared wave and keeps its original layout after refresh, migration and defeat', () => {
    const run = createRun(119, 'march');
    const tower = { x: 5, y: 2 };
    expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf('watch'), tile: tower }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf('watch'), tile: { x: 5, y: 4 } }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf('guard'), tile: { x: 6, y: 3 } }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'formation', value: 'bank' }, []).ok).toBe(true);
    dispatch(run, { kind: 'start' }, []);
    while (run.phase === 'battle') step(run, []);
    expect(run.phase).toBe('reward');
    const [reward] = run.rewards;
    const old = JSON.parse(encodeCheckpoint(run)!);
    old.version = 13;
    delete old.run.pastWaves;
    const migrated = decodeCheckpoint(JSON.stringify(old))!;
    expect(migrated.pastWaves).toEqual([]);
    expect(dispatch(migrated, { kind: 'reward', card: reward }, []).ok).toBe(true);
    expect(migrated.pastWaves.map(wave => wave.wave)).toEqual([0]);

    expect(dispatch(run, { kind: 'reward', card: reward }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'relocate', id: run.buildings[0].id, tile: { x: 7, y: 1 } }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'formation', value: 'inner' }, []).ok).toBe(true);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    const backup = encodeProgress({ run: restored, chronicle: emptyChronicle() })!;
    expect(decodeProgress(backup)?.run?.pastWaves).toEqual(run.pastWaves);
    expect(restored.pastWaves[0].buildings[0].tile).toEqual(tower);
    expect(restored.pastWaves[0].formation).toBe('bank');

    const corrupt = JSON.parse(encodeCheckpoint(run)!);
    corrupt.run.pastWaves[0].wave = 4;
    const withoutHistory = decodeCheckpoint(JSON.stringify(corrupt))!;
    expect(withoutHistory.pastWaves).toEqual([]);
    expect(withoutHistory.buildings).toEqual(restored.buildings);
    for (const state of [restored, withoutHistory]) {
      state.keepHp = 1;
      dispatch(state, { kind: 'start' }, []);
      state.schedule = [];
      state.actors = [{ id: 99, def: 'raider', side: 'enemy', tile: { x: 8, y: 3 }, hp: 12, travel: 0, cooldown: 0 }];
      step(state, []);
      expect(state.phase).toBe('lost');
    }
    const text = runReportText(restored)!;
    expect(text).toContain('记录 2 / 2 个已完成波次');
    expect(text).toContain(`领取军令 ${cards.get(reward)!.name}`);
    expect(text).toMatch(/第 1 \/ 6 波 · 本波守住.*固守东岸.*第 6 列第 3 行 · 松岗箭塔.*第 2 \/ 6 波 · 防线失守.*收缩内线.*最后一次攻击/s);
    expect(runReportText(withoutHistory)).toContain('记录 1 / 2 个已完成波次\r\n部分早期波次没有可用战报。');
  });

  it('records the actual shortfall and survives a refresh during rewards', () => {
    const run = createRun(119, 'march');
    for (const [card, x, y] of [['watch', 5, 2], ['watch', 5, 4], ['guard', 6, 3], ['bowcamp', 7, 3]] as const) {
      expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf(card), tile: { x, y } }, []).ok).toBe(true);
    }
    run.wallet.food = 1;
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    expect(run.actors.map(actor => actor.def)).toEqual(['guard']);
    expect(run.waveReport).toMatchObject({ deployed: 1, foodAvailable: 1, foodSpent: 1, foodNeeded: 2, unfed: ['archer'] });
    while (run.phase === 'battle') step(run, []);
    expect(run.phase).toBe('reward');
    const checkpoint = encodeCheckpoint(run)!;
    const restored = decodeCheckpoint(checkpoint)!;
    expect(restored.waveReport).toEqual(run.waveReport);
    expect(waveReview(restored)).toContain('缺粮未出阵 1 支 · 雾林弓手 × 1');
    const report = waveReportText(restored);
    expect(report).toBe(waveReportText(run));
    expect(report).toContain('第 1 / 6 波 · 本波守住');
    expect(report).toContain('缺粮未出阵 1 支 · 雾林弓手 × 1');
    expect(report).toContain('第 6 列第 3 行 · 松岗箭塔');
    expect(report).toContain('第 7 列第 4 行 · 边境卫士');
    expect(dispatch(restored, { kind: 'reward', card: restored.rewards[0] }, []).ok).toBe(true);
    expect(restored.waveReport).toBeNull();
    expect(waveReportText(restored)).toBeUndefined();
    const legacy = JSON.parse(checkpoint);
    legacy.version = 9;
    delete legacy.run.waveReport;
    expect(decodeCheckpoint(JSON.stringify(legacy))?.waveReport).toBeNull();
    expect(waveReportText(decodeCheckpoint(JSON.stringify(legacy))!)).toBeUndefined();
    const corrupt = JSON.parse(checkpoint);
    corrupt.run.waveReport.unfed = ['bad-unit'];
    expect(decodeCheckpoint(JSON.stringify(corrupt))).toBeUndefined();
  });

  it.each([['raider', 8], ['skirmisher', 7]] as const)('identifies the keep-breaking attack from %s', (def, x) => {
    const run = createRun(119);
    run.keepHp = 1;
    dispatch(run, { kind: 'start' }, []);
    run.schedule = [];
    const attacker: Actor = { id: 99, def, side: 'enemy', tile: { x, y: 3 }, hp: 12, travel: 0, cooldown: 0 };
    run.actors = [attacker, { ...attacker, id: 100, tile: { x: 0, y: 3 }, cooldown: 500 }];
    step(run, []);
    if (run.shots.length) run.actors.shift();
    for (let steps = 0; steps < 6 && run.phase === 'battle'; steps++) step(run, []);
    expect(run.phase).toBe('lost');
    expect(run.keepHp).toBe(0);
    expect(run.waveReport?.lastKeepHit).toEqual({ enemy: def, from: { x, y: 3 } });
    expect(run.waveReport?.keepDamage).toEqual([{ enemy: def, damage: 1, hits: 1 }]);
    expect(waveReview(run)).toContain(`第 ${x + 1} 列、第 4 行发起最后一次攻击`);
    expect(waveReportText(run)).toContain(`第 ${x + 1} 列、第 4 行发起最后一次攻击`);
  });

  it('totals real losses by enemy and restores the totals on a reward checkpoint', () => {
    const run = createRun(119, 'march');
    run.wave = 1;
    expect(dispatch(run, { kind: 'encounter', choice: 'stone' }, []).ok).toBe(true);
    dispatch(run, { kind: 'start' }, []);
    run.schedule = [];
    const raider: Actor = { id: 81, def: 'raider', side: 'enemy', tile: { x: 8, y: 3 }, hp: 12, travel: 0, cooldown: 0 };
    run.actors = [raider, { ...raider, id: 82 }, { ...raider, id: 83, def: 'skirmisher', tile: { x: 7, y: 3 } }];
    for (let i = 0; i < 4; i++) step(run, []);
    expect(run.keepHp).toBe(24);
    const sources = [
      { enemy: 'raider', damage: 4, hits: 2 },
      { enemy: 'skirmisher', damage: 2, hits: 1 },
    ];
    expect(run.waveReport?.keepDamage).toEqual(sources);
    run.actors = [];
    step(run, []);
    expect(run.phase).toBe('reward');
    const checkpoint = encodeCheckpoint(run)!;
    const restored = decodeCheckpoint(checkpoint)!;
    expect(restored.waveReport?.keepDamage).toEqual(sources);
    expect(waveReview(restored)).toContain('4 生命 · 2 次命中');
    const backup = encodeProgress({ run: restored, chronicle: emptyChronicle() })!;
    expect(decodeProgress(backup)?.run?.waveReport?.keepDamage).toEqual(sources);

    const corrupt = JSON.parse(checkpoint);
    corrupt.run.waveReport.keepDamage[0].damage++;
    expect(decodeCheckpoint(JSON.stringify(corrupt))).toBeUndefined();
    const legacy = JSON.parse(checkpoint);
    legacy.version = 12;
    delete legacy.run.waveReport.keepDamage;
    const migrated = decodeCheckpoint(JSON.stringify(legacy))!;
    expect(migrated.waveReport?.keepDamage).toBeNull();
    expect(migrated.waveReport?.lastKeepHit).toEqual({ enemy: 'skirmisher', from: { x: 7, y: 3 } });
    expect(waveReview(migrated)).not.toContain('城堡伤害来源');
    expect(waveReportText(migrated)).not.toContain('城堡伤害来源');
    expect(waveReportText(migrated)).toContain('本波城堡损失 6 生命');
    expect(decodeCheckpoint(encodeCheckpoint(migrated)!)?.waveReport).toEqual(migrated.waveReport);
  });

  it('labels a timeout while the keep is still standing', () => {
    const run = createRun(119);
    dispatch(run, { kind: 'start' }, []);
    run.tick = battleLimit - 1;
    step(run, []);
    expect(run.phase).toBe('lost');
    expect(waveReview(run)).toContain('到达战斗时限时，仍有敌军未被清除');
    expect(run.waveReport?.lastKeepHit).toBeNull();
  });
});
