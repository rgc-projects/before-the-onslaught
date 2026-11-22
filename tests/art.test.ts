import { describe, expect, it } from 'vitest';
import packed from '../assets/generated/nine-kingdoms-sprites.json';
import { buildings, cards, enemies, units } from '../src/data/content';

describe('production sprite coverage', () => {
  it('covers every battle entity and card illustration and keeps each frame inside its own atlas cell', () => {
    const keys = [...new Set(['keep', ...buildings.keys(), ...units.keys(), ...enemies.keys(),
      ...[...cards.values()].map(card => card.ref || card.id)])];
    expect(Object.keys(packed.sprites).sort()).toEqual(keys.sort());
    const slots = new Set<string>();
    for (const { column, row, frame: [x, y, width, height] } of Object.values(packed.sprites)) {
      expect(column).toBeLessThan(packed.columns);
      expect(row).toBeLessThan(packed.rows);
      expect(x).toBeGreaterThanOrEqual(column * packed.cell);
      expect(y).toBeGreaterThanOrEqual(row * packed.cell);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x + width).toBeLessThanOrEqual((column + 1) * packed.cell);
      expect(y + height).toBeLessThanOrEqual((row + 1) * packed.cell);
      slots.add(`${column},${row}`);
    }
    expect(slots.size).toBe(keys.length);
  });
});
