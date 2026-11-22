import { describe, expect, it, vi } from 'vitest';
import { BattleFeedback } from '../src/scenes/feedback';
import { pixel, ROW, TILE } from '../src/scenes/art';

describe('battle presentation', () => {
  it('returns an attacking sprite to the base pose after overlapping effects', () => {
    const feedback = new BattleFeedback();
    const ctx = { save: vi.fn(), translate: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn() };
    const canvas = ctx as unknown as CanvasRenderingContext2D;
    const tile = { x: 3, y: 2 };
    const attack = { kind: 'attack' as const, id: 7, at: tile, towards: { x: 4, y: 2 }, style: 'melee' as const };
    const paint = vi.fn();
    feedback.present([attack]);
    feedback.tick(240);
    expect(feedback.attackPose(7)?.progress).toBe(0);
    feedback.draw(canvas, 'full');
    feedback.tick(100);
    feedback.present([attack]);
    feedback.draw(canvas, 'full');
    feedback.tick(110);
    ctx.restore.mockClear();
    feedback.drawEntity(canvas, 7, tile, 'full', paint);
    expect(ctx.translate).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
    feedback.tick(100);
    feedback.drawEntity(canvas, 7, tile, 'full', paint);
    expect(ctx.translate).toHaveBeenCalledOnce();
    expect(paint).toHaveBeenCalledTimes(2);
  });

  it('keeps numbers still in reduced mode and omits decorative feedback in off mode', () => {
    const feedback = new BattleFeedback();
    const ctx = { save: vi.fn(), restore: vi.fn(), strokeText: vi.fn(), fillText: vi.fn() };
    const canvas = ctx as unknown as CanvasRenderingContext2D;
    feedback.present([{ kind: 'hit', at: { x: 3, y: 2 }, amount: 6, hostile: true }]);
    feedback.draw(canvas, 'off');
    expect(ctx.fillText).not.toHaveBeenCalled();
    feedback.draw(canvas, 'reduced');
    feedback.tick(200);
    feedback.draw(canvas, 'reduced');
    expect(ctx.fillText.mock.calls[0]).toEqual(ctx.fillText.mock.calls[1]);
    feedback.draw(canvas, 'full');
    expect(ctx.fillText.mock.calls[2][2]).toBeLessThan(ctx.fillText.mock.calls[1][2]);
  });

  it('rasterizes each amount and color once and reuses it as the numbers rise', () => {
    const feedback = new BattleFeedback();
    const raster = { measureText: vi.fn(() => ({ width: 17 })), strokeText: vi.fn(), fillText: vi.fn() };
    const ownerDocument = { createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => raster })) };
    const ctx = { canvas: { ownerDocument }, save: vi.fn(), restore: vi.fn(), drawImage: vi.fn() };
    const target = ctx as unknown as CanvasRenderingContext2D;
    const at = { x: 3, y: 2 };
    feedback.present([
      { kind: 'hit', at, amount: 6, hostile: true },
      { kind: 'hit', at, amount: 6, hostile: false },
      { kind: 'heal', at, amount: 6 },
    ]);
    feedback.draw(target, 'full');
    feedback.tick(200);
    feedback.draw(target, 'full');
    expect(ownerDocument.createElement).toHaveBeenCalledTimes(3);
    expect(raster.strokeText.mock.calls.map(([label]) => label)).toEqual(['−6', '−6', '+6']);
    expect(ctx.drawImage).toHaveBeenCalledTimes(6);
    expect(ctx.drawImage.mock.calls[3][0]).toBe(ctx.drawImage.mock.calls[0][0]);
    expect(ctx.drawImage.mock.calls[3][2]).toBeLessThan(ctx.drawImage.mock.calls[0][2]);
  });

  it('combines damage at the same position and separates damage, healing, and later hits', () => {
    const feedback = new BattleFeedback();
    const ctx = { save: vi.fn(), restore: vi.fn(), strokeText: vi.fn(), fillText: vi.fn() };
    const canvas = ctx as unknown as CanvasRenderingContext2D;
    const at = { x: 4, y: 3 };
    feedback.present([
      { kind: 'hit', at, amount: 4, hostile: true },
      { kind: 'hit', at, amount: 7, hostile: true },
      { kind: 'heal', at, amount: 3 },
    ]);
    feedback.draw(canvas, 'reduced');
    const first = [...ctx.fillText.mock.calls];
    expect(first.map(([text]) => text)).toEqual(['−11', '+3']);
    expect(Math.abs(first[0][1] - first[1][1])).toBeGreaterThanOrEqual(28);

    feedback.tick(100);
    feedback.present([{ kind: 'hit', at, amount: 2, hostile: true }]);
    ctx.fillText.mockClear();
    feedback.draw(canvas, 'reduced');
    expect(ctx.fillText.mock.calls.slice(0, 2)).toEqual(first);
    const [, newX, newY] = ctx.fillText.mock.calls[2];
    expect(first.every(([, x, y]) => Math.abs(newX - x) >= 28 || Math.abs(newY - y) >= 24)).toBe(true);
  });

  it('keeps the marshal grounded during a same-tick swing and releases the slam pose after it settles', () => {
    const feedback = new BattleFeedback();
    const ctx = { save: vi.fn(), translate: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(), arc: vi.fn(),
      stroke: vi.fn(), fillRect: vi.fn() };
    const canvas = ctx as unknown as CanvasRenderingContext2D;
    const at = { x: 5, y: 4 };
    feedback.present([
      { kind: 'effect', at, style: 'boss', radius: 2.4, sourceId: 7 },
      { kind: 'attack', at, towards: { x: 6, y: 4 }, id: 7, style: 'heavy' },
    ]);
    expect(feedback.slamPose(7)).toBe(0);
    expect(feedback.slamPose(8)).toBeUndefined();
    expect(feedback.attackPose(7)?.style).toBe('heavy');
    feedback.draw(canvas, 'full');
    feedback.tick(100);
    const paint = vi.fn();
    feedback.drawEntity(canvas, 7, at, 'full', paint);
    expect(ctx.translate).not.toHaveBeenCalled();
    expect(paint).toHaveBeenCalledOnce();
    feedback.tick(560);
    expect(feedback.slamPose(7)).toBeUndefined();
    expect(feedback.attackPose(7)).toBeUndefined();
  });

  it('draws stationary, full-radius impact outlines in reduced mode and omits them in off mode', () => {
    const feedback = new BattleFeedback();
    const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(), stroke: vi.fn(), fillRect: vi.fn() };
    const canvas = ctx as unknown as CanvasRenderingContext2D;
    const at = { x: 2.25, y: 4 };
    const center = pixel(at);
    feedback.present([
      { kind: 'effect', at, radius: 2.4, style: 'boss', sourceId: 7 },
      { kind: 'effect', at, radius: 1.25, style: 'arcane' },
    ]);
    feedback.draw(canvas, 'off');
    expect(ctx.ellipse).not.toHaveBeenCalled();
    feedback.draw(canvas, 'reduced');
    feedback.tick(420);
    feedback.draw(canvas, 'reduced');
    const round = [2.4, 1.25].map(radius => [center.x, center.y, radius * TILE, radius * ROW, 0, 0, Math.PI * 2]);
    expect(ctx.ellipse.mock.calls).toEqual([...round, ...round]);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('draws an eased casting pose and actual target marker with accessible motion levels', () => {
    const feedback = new BattleFeedback();
    const ctx = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(),
      moveTo: vi.fn(), quadraticCurveTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn() };
    const canvas = ctx as unknown as CanvasRenderingContext2D;
    const paint = vi.fn();
    const at = { x: 4, y: 3 };
    const towards = { x: 2.3, y: 2 };
    const target = pixel(towards);
    feedback.present([{ kind: 'support', id: 7, at, towards, style: 'heal' }]);
    feedback.draw(canvas, 'full');
    feedback.tick(110);
    feedback.drawEntity(canvas, 7, at, 'full', paint);
    expect(ctx.rotate.mock.calls[0][0]).toBeLessThan(0);
    feedback.draw(canvas, 'full');
    expect(ctx.quadraticCurveTo.mock.calls[0].slice(2)).toEqual([target.x, target.y - 14]);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    feedback.tick(150);
    feedback.draw(canvas, 'reduced');
    expect(ctx.ellipse.mock.calls[1]).toEqual(ctx.ellipse.mock.calls[2]);
    expect(ctx.ellipse.mock.calls[2].slice(0, 2)).toEqual([target.x, target.y + 5]);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(2);
    feedback.draw(canvas, 'off');
    expect(ctx.ellipse).toHaveBeenCalledTimes(3);
    feedback.tick(180);
    feedback.drawEntity(canvas, 7, at, 'full', paint);
    expect(ctx.rotate).toHaveBeenCalledOnce();
    expect(paint).toHaveBeenCalledTimes(2);
  });
});
