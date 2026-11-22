import { describe, expect, it } from 'vitest';
import { BattleFrameSamples, FramePacer } from '../src/scenes/frame-rate';
import type { FrameRate } from '../src/scenes/frame-rate';

function countFrames(refresh: number, rate: FrameRate): number {
  const pacer = new FramePacer();
  let frames = 0;
  for (let index = 0; index < refresh; index++) {
    const time = Math.round(index * 10000 / refresh) / 10;
    if (pacer.allows(time, rate)) frames++;
  }
  return frames;
}

describe('battlefield render cadence', () => {
  it('renders at display cadence and caps whole or fractional refresh ratios', () => {
    expect(countFrames(60, '60')).toBe(60);
    expect(countFrames(60, '144')).toBe(60);
    expect(countFrames(144, '30')).toBe(30);
    expect(countFrames(165, '60')).toBe(60);
    expect(countFrames(165, '120')).toBe(120);
    expect(countFrames(165, '144')).toBe(144);
    expect(countFrames(165, 'display')).toBe(165);
  });

  it('applies a new cap immediately and skips missed frames after a stall', () => {
    const pacer = new FramePacer();
    expect(pacer.allows(0, '30')).toBe(true);
    expect(pacer.allows(10, '30')).toBe(false);
    expect(pacer.allows(10, '120')).toBe(true);
    expect(pacer.allows(14, '120')).toBe(false);
    expect(pacer.allows(5010, '120')).toBe(true);
    expect(pacer.allows(5011, '120')).toBe(false);
    expect(pacer.allows(5011, 'display')).toBe(true);
    expect(pacer.allows(5012, '30')).toBe(true);
  });
});

describe('battle frame samples', () => {
  it('excludes paused time but counts slow frames while the battle is active', () => {
    const samples = new BattleFrameSamples();
    const paint = (time: number) => samples.record(time, '60', 'full', 1280, 720);
    paint(0);
    paint(16);
    paint(32);
    samples.pause();
    paint(3032);
    paint(3100);
    const [active] = samples.summary();
    expect(active).toMatchObject({ cap: '60', motion: 'full', seconds: 0.1, fps: 30, p95: 68, stalls: 1 });
  });

  it('groups by render configuration without interpolating between configurations or waves', () => {
    const samples = new BattleFrameSamples();
    samples.record(0, '60', 'full', 1280, 720);
    samples.record(16, '60', 'full', 1280, 720);
    samples.record(100, '120', 'full', 1280, 720);
    samples.record(108, '120', 'full', 1280, 720);
    samples.record(200, '120', 'off', 390, 844);
    samples.record(300, '120', 'off', 390, 844);
    samples.record(400, '60', 'full', 1280, 720);
    samples.record(416, '60', 'full', 1280, 720);
    expect(samples.summary()).toMatchObject([
      { cap: '60', width: 1280, seconds: 0.032, p95: 16, stalls: 0 },
      { cap: '120', width: 1280, seconds: 0.008, p95: 8, stalls: 0 },
      { cap: '120', width: 390, seconds: 0.1, p95: 100, stalls: 1 },
    ]);
    samples.clear();
    expect(samples.summary()).toEqual([]);
    samples.record(2000, '30', 'full', 1280, 800);
    expect(samples.summary()).toEqual([]);
  });
});
