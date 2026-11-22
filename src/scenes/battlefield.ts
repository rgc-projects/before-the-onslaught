import type { GameEvent, Point, RouteId, Run } from '../core/types';
import { buildings, map } from '../data/content';
import { isForeground, watchForeground } from '../platform/foreground';
import { buildingStats } from '../systems/buildings';
import { actorDefinition, maxActorHp, position, STEP_MS } from '../systems/combat';
import { distance } from '../systems/grid';
import type { Approach } from '../ui/approach';
import { HEIGHT, WIDTH, TILE, ROW, drawTerrain, pixel, soldier, structure } from './art';
import { BattleFeedback } from './feedback';
import type { Motion } from './feedback';
import { FramePacer } from './frame-rate';
import type { FrameRate } from './frame-rate';
import { hasAttackClip, hasMovementClip } from './unit-motion';
import type { UnitPose } from './unit-motion';

type Walk = { at: Point; distance: number; right: boolean };

function drawApproach(ctx: CanvasRenderingContext2D, approach: Approach | undefined, draft: boolean): void {
  if (!approach?.steps.length) return;
  const from = pixel(map.entry);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (const step of approach.steps) {
    const at = pixel(step);
    ctx.lineTo(at.x, at.y);
  }
  ctx.setLineDash(draft ? [] : [4, 7]);
  ctx.strokeStyle = draft ? '#9ce7ee' : '#fae3aa99';
  ctx.lineWidth = draft ? 3 : 2;
  ctx.stroke();
  ctx.setLineDash([]);
}

export async function mountBattlefield(
  parent: HTMLElement,
  state: () => Run,
  advance: () => GameEvent[],
  motion: () => Motion,
  frameRate: () => FrameRate,
  rangePreview: () => { tile: Point; reach: number } | undefined,
  approaches: Readonly<{ current?: Approach; draft?: Approach }>,
  onBattlePaint: () => void,
  onReady: () => void,
) {
  const { default: Phaser } = await import('phaser');
  const feedback = new BattleFeedback();
  let dirty = true;
  class Battlefield extends Phaser.Scene {
    private context!: CanvasRenderingContext2D;
    private ground!: HTMLCanvasElement;
    private crossing?: RouteId;
    private elapsed = 0;
    private discardDelta = false;
    private previousRun?: Run;
    private currentApproach?: Approach;
    private draftApproach?: Approach;
    private frameKey = '';
    private locomotion = new Map<number, Walk>();

    create(): void {
      this.ground = document.createElement('canvas');
      this.ground.width = WIDTH;
      this.ground.height = HEIGHT;
      this.context = this.game.canvas.getContext('2d')!;
      this.context.imageSmoothingEnabled = false;
      this.game.canvas.setAttribute('aria-hidden', 'true');
      const invalidate = () => { dirty = true; };
      this.scale.on(Phaser.Scale.Events.RESIZE, invalidate);
      const unwatch = watchForeground(() => {
        this.elapsed = 0;
        this.discardDelta = true;
      });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.scale.off(Phaser.Scale.Events.RESIZE, invalidate);
        unwatch();
      });
      this.paint(state(), motion(), rangePreview());
      onReady();
    }

    tick(delta: number, foreground: boolean): void {
      const run = state();
      const mode = motion();
      const frameDelta = this.discardDelta ? 0 : Math.min(250, delta);
      this.discardDelta = !foreground;
      const ticking = run.phase === 'battle' && !run.paused && foreground;
      if (run !== this.previousRun) {
        this.previousRun = run;
        feedback.clear();
        this.locomotion.clear();
        this.elapsed = 0;
        dirty = true;
      }
      if (run.phase !== 'battle') this.locomotion.clear();
      if (!ticking) this.elapsed = 0;
      else {
        this.elapsed += frameDelta;
        while (this.elapsed >= STEP_MS && run.phase === 'battle' && !run.paused) {
          this.elapsed -= STEP_MS;
          dirty = true;
          if (mode === 'off') advance();
          else feedback.present(advance());
          this.trackMovement(run);
        }
      }
      const pending = feedback.pending;
      if (pending) {
        if (mode === 'off') feedback.clear();
        else if (!run.paused && foreground) feedback.tick(frameDelta);
        dirty ||= pending !== feedback.pending;
      }
    }

    private trackMovement(run: Run): void {
      const walking = new Map<number, Walk>();
      for (const actor of run.actors) {
        if (!hasMovementClip(actor.def)) continue;
        const at = position(actor);
        const previous = this.locomotion.get(actor.id);
        const right = actor.to && actor.to.x !== actor.tile.x ? actor.to.x > actor.tile.x : previous?.right ?? false;
        walking.set(actor.id, { at, distance: previous ? previous.distance + distance(previous.at, at) : actor.travel, right });
      }
      this.locomotion = walking;
    }

    update(): void {
      const run = state();
      const mode = motion();
      const preview = rangePreview();
      const key = `${run.phase}:${run.paused}:${mode}:${document.documentElement.dataset.atlasReady}:${preview?.tile.x}:${preview?.tile.y}:${preview?.reach}`;
      const animating = mode === 'full' && !run.paused && (run.phase === 'battle' || feedback.pending > 0);
      const approachChanged = this.currentApproach !== approaches.current || this.draftApproach !== approaches.draft;
      if (!(dirty || key !== this.frameKey || animating || approachChanged)) return;
      this.currentApproach = approaches.current;
      this.draftApproach = approaches.draft;
      this.frameKey = key;
      this.paint(run, mode, preview);
      if (run.phase === 'battle' && !run.paused) onBattlePaint();
      dirty = false;
    }

    private paint(run: Run, mode: Motion, preview: ReturnType<typeof rangePreview>): void {
      const ctx = this.context;
      if (this.crossing !== run.route) {
        this.crossing = run.route;
        drawTerrain(this.ground.getContext('2d')!, run.route);
      }
      ctx.drawImage(this.ground, 0, 0);
      if (run.phase === 'planning') {
        if (preview) {
          const center = pixel(preview.tile);
          ctx.beginPath();
          ctx.ellipse(center.x, center.y, preview.reach * TILE, preview.reach * ROW, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#e9d17924';
          ctx.strokeStyle = '#ffeea68f';
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
        }
        drawApproach(ctx, approaches.current, false);
        drawApproach(ctx, approaches.draft, true);
      }
      const layers: { y: number; draw: () => void }[] = [
        { y: map.keep.y, draw: () => structure(ctx, 'keep', map.keep) },
      ];
      for (const building of run.buildings) {
        layers.push({ y: building.tile.y, draw: () => {
          const definition = buildings.get(building.def)!;
          feedback.drawEntity(ctx, building.id, building.tile, mode, () =>
            structure(ctx, building.def, building.tile, definition.art, definition.width, building.level));
          const fraction = building.hp / buildingStats(building).hp;
          if (fraction < 1) {
            const at = pixel(building.tile);
            ctx.fillStyle = '#26302b';
            ctx.fillRect(at.x - 15, at.y + 20, 30, 4);
            ctx.fillStyle = '#d6a263';
            ctx.fillRect(at.x - 15, at.y + 20, 30 * fraction, 3);
          }
        } });
      }
      if (run.phase === 'planning') for (const rally of run.rally) {
        layers.push({ y: rally.tile.y, draw: () => feedback.drawEntity(ctx, rally.id, rally.tile, mode, () =>
          soldier(ctx, rally.tile, false, rally.def)) });
      }
      if (run.phase === 'battle') for (const actor of run.actors) {
        const at = position(actor);
        const track = mode === 'full' ? this.locomotion.get(actor.id) : undefined;
        if (actor.to && !run.paused && mode === 'full') {
          const extra = Math.min(1 - actor.travel, this.elapsed / 1000 * actorDefinition(actor).speed);
          at.x += (actor.to.x - actor.tile.x) * extra;
          at.y += (actor.to.y - actor.tile.y) * extra;
        }
        let pose: UnitPose | undefined;
        if (track) {
          const attack = feedback.attackPose(actor.id);
          const slam = feedback.slamPose(actor.id);
          if (slam !== undefined) pose = { kind: 'slam', progress: slam, right: track.right };
          else if (attack && hasAttackClip(actor.def, attack.style)) {
            const right = attack.towards.x === actor.tile.x ? track.right : attack.towards.x > actor.tile.x;
            pose = { kind: 'attack', progress: attack.progress, right };
          } else if (actor.to) {
            pose = { kind: 'move', distance: track.distance + distance(track.at, at), right: track.right };
          } else {
            pose = { kind: 'idle', right: track.right };
          }
        }
        layers.push({ y: at.y, draw: () => feedback.drawEntity(ctx, actor.id, at, mode, () =>
          soldier(ctx, at, actor.side === 'enemy', actor.def, actor.hp / maxActorHp(actor), pose)) });
      }
      for (const layer of layers.sort((a, b) => a.y - b.y)) layer.draw();
      const obstacle = run.phase === 'planning' ? (approaches.draft ?? approaches.current)?.obstacle : undefined;
      if (obstacle) {
        const at = pixel(obstacle.tile);
        ctx.strokeStyle = '#ffac84';
        ctx.lineWidth = 2;
        ctx.strokeRect(at.x - TILE / 2 + 5, at.y - ROW / 2 + 5, TILE - 10, ROW - 10);
      }
      if (mode !== 'off') for (const shot of run.shots) {
        const a = pixel(shot.from);
        const target = shot.target.kind === 'actor' ? run.actors.find(actor => actor.id === shot.target.id) : undefined;
        const b = pixel(target ? position(target) : shot.end);
        const progress = Math.min(1, (shot.duration - shot.ticks + (mode === 'full' ? this.elapsed / STEP_MS : 0)) / shot.duration);
        const x = a.x + (b.x - a.x) * progress;
        const y = a.y + (b.y - a.y) * progress - 17 - Math.sin(progress * Math.PI) * 16;
        ctx.strokeStyle = shot.hostile ? '#ffa98c' : shot.splash ? '#b9a5ff' : '#ffe2a0';
        ctx.lineWidth = shot.splash ? 3.5 : 2;
        ctx.beginPath();
        ctx.moveTo(x - Math.sign(b.x - a.x) * 10, y - Math.sign(b.y - a.y) * 4);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      feedback.draw(ctx, mode);
    }
  }
  const scene = new Battlefield();
  const pacer = new FramePacer();
  class BattlefieldGame extends Phaser.Game {
    private stopping = false;

    override step(time: number, delta: number): void {
      const foreground = isForeground();
      if (!this.isPaused && !this.stopping && scene.sys.isActive()) scene.tick(delta, foreground);
      if (this.stopping || (foreground && pacer.allows(time, frameRate()))) super.step(time, delta);
    }

    override destroy(removeCanvas: boolean, noReturn?: boolean): void {
      this.stopping = true;
      super.destroy(removeCanvas, noReturn);
    }
  }

  new BattlefieldGame({
    // The scene paints the board directly. Preserve it when a static frame is reused.
    type: Phaser.CANVAS, parent, width: WIDTH, height: HEIGHT, transparent: true, clearBeforeRender: false, banner: false,
    fps: { smoothStep: false },
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene],
  });
  return (events: readonly GameEvent[]) => {
    dirty = true;
    if (motion() !== 'off') feedback.present(events);
  };
}

export function cellStyle(): string {
  return `--columns:${map.width};--rows:${map.height};--map-width:${map.width * TILE};--map-height:${map.height * ROW}`;
}
