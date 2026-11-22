import type { Motion } from './feedback';

export const frameRates = ['display', '30', '60', '120', '144'] as const;
export type FrameRate = typeof frameRates[number];
export const defaultFrameRate: FrameRate = 'display';

export function isFrameRate(value: unknown): value is FrameRate {
  return frameRates.some(rate => rate === value);
}

// Browser frame timestamps can arrive slightly before an exact refresh interval.
const FRAME_TOLERANCE_MS = 0.25;

export class FramePacer {
  private rate?: FrameRate;
  private next = 0;

  allows(time: number, rate: FrameRate): boolean {
    if (rate === 'display') {
      this.rate = rate;
      return true;
    }
    const interval = 1000 / Number(rate);
    if (this.rate !== rate) {
      this.rate = rate;
      this.next = time + interval;
      return true;
    }
    if (time + FRAME_TOLERANCE_MS < this.next) return false;

    // Preserve the fractional interval on displays whose refresh rate is not a multiple of the cap.
    const missed = Math.max(0, Math.floor((time - this.next) / interval));
    this.next += (missed + 1) * interval;
    return true;
  }
}

type FrameSample = { cap: FrameRate; motion: Motion; width: number; height: number; intervals: number[] };
export type FrameSummary = Omit<FrameSample, 'intervals'> & { seconds: number; fps: number; p95: number; stalls: number };

export class BattleFrameSamples {
  private readonly samples = new Map<string, FrameSample>();
  private current?: FrameSample;
  private lastTime?: number;

  pause(): void {
    this.lastTime = undefined;
  }

  clear(): void {
    this.samples.clear();
    this.current = undefined;
    this.pause();
  }

  record(time: number, cap: FrameRate, motion: Motion, width: number, height: number): void {
    if (!this.current || this.current.cap !== cap || this.current.motion !== motion || this.current.width !== width || this.current.height !== height) {
      const key = `${cap}:${motion}:${width}:${height}`;
      this.current = this.samples.get(key) ?? { cap, motion, width, height, intervals: [] };
      this.samples.set(key, this.current);
      this.pause();
    }
    if (this.lastTime !== undefined && time > this.lastTime) this.current.intervals.push(time - this.lastTime);
    this.lastTime = time;
  }

  summary(): FrameSummary[] {
    return [...this.samples.values()].flatMap(({ cap, motion, width, height, intervals }) => {
      if (!intervals.length) return [];
      const total = intervals.reduce((sum, interval) => sum + interval, 0);
      const ranked = [...intervals].sort((a, b) => a - b);
      return [{ cap, motion, width, height, seconds: total / 1000, fps: intervals.length * 1000 / total,
        p95: ranked[Math.ceil(ranked.length * 0.95) - 1], stalls: intervals.filter(interval => interval > 50).length }];
    });
  }
}
