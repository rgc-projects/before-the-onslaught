import type { AttackStyle, EffectStyle, GameEvent, Point } from '../core/types';
import { HEIGHT, pixel, ROW, TILE, WIDTH } from './art';

export type Motion = 'full' | 'reduced' | 'off';
type VisibleEvent = Exclude<GameEvent, { kind: 'phase' | 'resources' | 'withdrawn' }>;
type CombatAmount = Extract<VisibleEvent, { kind: 'hit' | 'heal' }>;
type NumberLabel = { text: string; color: string; x: number; y: number; lift: number; halfWidth: number };
type Timeline = { event: VisibleEvent; age: number; duration: number; drawn: boolean; label?: NumberLabel };

const durations: Record<VisibleEvent['kind'], number> = {
  attack: 210, hit: 520, heal: 620, support: 440, death: 460, effect: 540, boss: 900, placed: 420, upgraded: 600,
};
const SLAM_MS = 660;
const attackColors: Record<AttackStyle, string> = { melee: '#ffe2a2', arrow: '#e6ca93', arcane: '#ccadff', heavy: '#ffad72' };
const effectColors: Record<EffectStyle, string> = { arcane: '#c8adff', heal: '#b6eca0', charge: '#ffe1a0', siege: '#ef9868', boss: '#ff8b7a' };
const NUMBER_FONT = 'bold 16px Georgia';
const NUMBER_BASELINE = 18;
const NUMBER_LIFT = 20;
const NUMBER_GAP = 4;
const NUMBER_CACHE_LIMIT = 64;
const numberOffsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function paintNumber(ctx: CanvasRenderingContext2D, text: string, color: string, x: number, y: number): void {
  ctx.font = NUMBER_FONT;
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#20302a';
  ctx.lineWidth = 2;
  ctx.fillStyle = color;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function drawSupport(ctx: CanvasRenderingContext2D, event: Extract<GameEvent, { kind: 'support' }>, progress: number, full: boolean): void {
  const from = pixel(event.at);
  const target = pixel(event.towards);
  const summoning = event.style === 'summon';
  const color = summoning ? '#d7baff' : '#b7efa0';
  const radius = summoning ? 0.38 : 0.28;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(target.x, target.y + 5, radius * TILE, radius * ROW * 0.74, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (!full || (from.x === target.x && from.y === target.y)) return;

  const startY = from.y - 18;
  const endY = summoning ? target.y + 4 : target.y - 14;
  const midX = (from.x + target.x) / 2;
  const highY = Math.min(startY, endY) - 20;
  ctx.beginPath();
  ctx.moveTo(from.x, startY);
  ctx.quadraticCurveTo(midX, highY, target.x, endY);
  ctx.stroke();
  const remaining = (1 - progress) ** 2;
  const travel = 1 - remaining;
  const x = remaining ** 2 * from.x + 2 * remaining * travel * midX + travel ** 2 * target.x;
  const y = remaining ** 2 * startY + 2 * remaining * travel * highY + travel ** 2 * endY;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
}

export class BattleFeedback {
  private entries: Timeline[] = [];
  private poses = new Map<number, Timeline>();
  private slams = new Map<number, Timeline>();
  private numbers = new Map<string, HTMLCanvasElement>();

  get pending(): number { return this.entries.length; }

  clear(): void {
    this.entries = [];
    this.poses.clear();
    this.slams.clear();
  }

  present(events: readonly GameEvent[]): void {
    const amounts = new Map<string, CombatAmount>();
    for (const event of events) {
      if (event.kind === 'withdrawn') {
        this.entries = this.entries.filter(entry => !('id' in entry.event) || entry.event.id !== event.id);
        this.poses.delete(event.id);
        this.slams.delete(event.id);
      }
      if (!('at' in event)) continue;
      if (event.kind === 'hit' || event.kind === 'heal') {
        const key = `${event.at.x}:${event.at.y}:${event.kind}:${event.kind === 'hit' && event.hostile}`;
        const current = amounts.get(key);
        if (current) current.amount += event.amount;
        else amounts.set(key, { ...event });
      } else this.add(event);
    }
    for (const amount of amounts.values()) this.add(amount, this.placeNumber(amount));
    if (this.entries.length > 120) this.entries = this.entries.slice(-120);
  }

  private add(event: VisibleEvent, label?: NumberLabel): void {
    const slam = event.kind === 'effect' && event.style === 'boss';
    const entry = { event, age: 0, duration: slam ? SLAM_MS : durations[event.kind], drawn: false, label };
    this.entries.push(entry);
    if ('id' in event) this.poses.set(event.id, entry);
    if (slam && event.sourceId !== undefined) this.slams.set(event.sourceId, entry);
  }

  private placeNumber(event: CombatAmount): NumberLabel {
    const color = event.kind === 'heal' ? '#b7efa0' : event.hostile ? '#ffb6a1' : '#ffebaf';
    const text = `${event.kind === 'heal' ? '+' : '−'}${event.amount}`;
    const at = pixel(event.at);
    const halfWidth = text.length * 5 + 4;
    const position = (column: number, row: number): NumberLabel => {
      const x = Math.max(halfWidth, Math.min(WIDTH - halfWidth, Math.round(at.x + column * (2 * halfWidth + 10))));
      const y = Math.max(NUMBER_BASELINE, Math.min(HEIGHT - NUMBER_GAP, Math.round(at.y - 15 + row * 42)));
      return { text, color, x, y, halfWidth, lift: Math.min(NUMBER_LIFT, y - NUMBER_BASELINE) };
    };
    for (const [column, row] of numberOffsets) {
      const candidate = position(column, row);
      // Reserve the entire rising path so an existing label can keep its position.
      const overlaps = this.entries.some(({ label }) => label
        && Math.abs(candidate.x - label.x) < candidate.halfWidth + label.halfWidth + NUMBER_GAP
        && candidate.y - candidate.lift - NUMBER_BASELINE - NUMBER_GAP < label.y
        && label.y - label.lift - NUMBER_BASELINE - NUMBER_GAP < candidate.y);
      if (!overlaps) return candidate;
    }
    return position(0, 0);
  }

  tick(delta: number): void {
    // A render cap or stalled callback may delay the first frame of a new effect.
    for (const entry of this.entries) if (entry.drawn) entry.age += delta;
    this.entries = this.entries.filter(entry => entry.age < entry.duration);
    for (const [id, entry] of this.poses) if (!this.entries.includes(entry)) this.poses.delete(id);
    for (const [id, entry] of this.slams) if (!this.entries.includes(entry)) this.slams.delete(id);
  }

  attackPose(id: number): { style: AttackStyle; progress: number; towards: Point } | undefined {
    const entry = this.poses.get(id);
    if (entry?.event.kind !== 'attack') return undefined;
    return { style: entry.event.style, progress: Math.min(1, entry.age / entry.duration), towards: entry.event.towards };
  }

  slamPose(id: number): number | undefined {
    const entry = this.slams.get(id);
    return entry ? entry.age / entry.duration : undefined;
  }

  private numberTexture(owner: Document | undefined, text: string, color: string): HTMLCanvasElement | undefined {
    const key = `${color}${text}`;
    const existing = this.numbers.get(key);
    if (existing) return existing;
    const texture = owner?.createElement('canvas');
    const raster = texture?.getContext('2d');
    if (!texture || !raster) return undefined;
    raster.font = NUMBER_FONT;
    texture.width = 2 * Math.ceil(raster.measureText(text).width / 2) + 8;
    texture.height = 24;
    paintNumber(raster, text, color, texture.width / 2, NUMBER_BASELINE);
    if (this.numbers.size === NUMBER_CACHE_LIMIT) this.numbers.delete(this.numbers.keys().next().value!);
    this.numbers.set(key, texture);
    return texture;
  }

  drawEntity(ctx: CanvasRenderingContext2D, id: number, tile: Point, motion: Motion, paint: () => void): void {
    const entry = this.poses.get(id);
    if (motion !== 'full' || !entry || this.slams.has(id)) {
      paint();
      return;
    }
    const progress = Math.min(1, entry.age / entry.duration);
    const pulse = Math.sin(progress * Math.PI);
    const at = pixel(tile);
    ctx.save();
    const event = entry.event;
    if (event.kind === 'attack') {
      const target = pixel(event.towards);
      const distance = Math.hypot(target.x - at.x, target.y - at.y) || 1;
      const offset = pulse * (event.style === 'melee' || event.style === 'heavy' ? 8 : -3);
      ctx.translate((target.x - at.x) * offset / distance, (target.y - at.y) * offset / distance);
    } else if (event.kind === 'support') {
      const facing = Math.sign(event.towards.x - tile.x);
      ctx.translate(at.x, at.y - pulse * (event.style === 'summon' ? 6 : 3));
      ctx.rotate(facing * pulse * 0.10);
      ctx.translate(-at.x, -at.y);
    } else {
      const scale = 1 + pulse * (event.kind === 'upgraded' ? 0.10 : 0.07);
      ctx.translate(at.x, at.y - pulse * (event.kind === 'placed' ? 6 : 2));
      ctx.scale(scale, scale);
      ctx.translate(-at.x, -at.y);
    }
    paint();
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, motion: Motion): void {
    if (motion === 'off') return;
    const full = motion === 'full';
    ctx.save();
    for (const entry of this.entries) {
      if (entry.label) continue;
      entry.drawn = true;
      const { event, age, duration } = entry;
      const progress = age / duration;
      const fade = 1 - progress;
      const at = pixel(event.at);
      ctx.globalAlpha = full ? Math.min(1, fade * 1.4) : 0.86;
      if (event.kind === 'support') {
        drawSupport(ctx, event, progress, full);
        continue;
      }
      const slam = event.kind === 'effect' && event.style === 'boss';
      if (!full && event.kind !== 'effect') continue;
      if (event.kind === 'attack') {
        const to = pixel(event.towards);
        const distance = Math.hypot(to.x - at.x, to.y - at.y) || 1;
        const bearing = Math.atan2(to.y - at.y, to.x - at.x);
        const length = event.style === 'melee' || event.style === 'heavy' ? 19 : 14;
        const x = at.x + (to.x - at.x) * length / distance;
        const y = at.y - 5 + (to.y - at.y) * length / distance;
        ctx.strokeStyle = attackColors[event.style];
        ctx.lineWidth = event.style === 'heavy' ? 4 : 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 5 + progress * 11, bearing - 0.9, bearing + 0.9);
        ctx.stroke();
        continue;
      }
      const color = event.kind === 'effect' ? effectColors[event.style] : event.kind === 'boss' ? '#f78476' : '#f4d694';
      const radius = event.kind === 'effect' ? event.radius : event.kind === 'boss' ? 1.3 : event.kind === 'death' ? 0.5 : 0.42;
      const spread = radius * (0.15 + 0.85 * (1 - fade ** 2));
      ctx.strokeStyle = color;
      ctx.lineWidth = event.kind === 'boss' ? 3.5 : slam ? 2 : 2.25;
      ctx.beginPath();
      if (slam || !full) ctx.ellipse(at.x, at.y, radius * TILE, radius * ROW, 0, 0, Math.PI * 2);
      else ctx.ellipse(at.x, at.y + 5, spread * TILE, spread * ROW * 0.78, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (!full || (event.kind !== 'death' && event.kind !== 'effect' && event.kind !== 'boss')) continue;
      ctx.fillStyle = color;
      for (let index = 0; index < 6; index++) {
        const angle = index * Math.PI / 3 + 0.25;
        const x = at.x + Math.cos(angle) * spread * TILE;
        const y = at.y + Math.sin(angle) * spread * ROW * 0.78 - progress * 9;
        ctx.fillRect(Math.round(x), Math.round(y), 3, 3);
      }
    }
    for (const entry of this.entries) {
      const { label, age, duration } = entry;
      if (!label) continue;
      const fade = 1 - age / duration;
      const y = label.y - (full ? label.lift * (1 - fade ** 2) : 0);
      ctx.globalAlpha = full ? Math.min(1, fade * 1.4) : 0.86;
      const texture = this.numberTexture(ctx.canvas?.ownerDocument, label.text, label.color);
      if (texture) ctx.drawImage(texture, label.x - texture.width / 2, Math.round(y) - NUMBER_BASELINE);
      else paintNumber(ctx, label.text, label.color, label.x, y);
      entry.drawn = true;
    }
    ctx.restore();
  }
}
