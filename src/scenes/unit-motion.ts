import motionAtlas from '../../assets/generated/unit-motion.json';
import marshalAtlas from '../../assets/generated/marshal-motion.json';
import captainAtlas from '../../assets/generated/captain-motion.json';
import spearAtlas from '../../assets/generated/spear-motion.json';
import type { AttackStyle } from '../core/types';

export type UnitPose = { right: boolean } & ({ kind: 'move'; distance: number } | { kind: 'attack' | 'slam'; progress: number } | { kind: 'idle' });
type Clip = { image: HTMLImageElement | undefined; row: number; width: number; height: number; baseline: number;
  stride: number; walkFrames: number; actionFrames: number; idleFrame?: number; slamFrames?: number; action?: AttackStyle };

function imageAt(url: URL): HTMLImageElement | undefined {
  if (typeof Image === 'undefined') return undefined;
  const image = new Image();
  image.src = url.href;
  return image;
}

const shared = {
  image: imageAt(new URL('../../assets/generated/unit-motion.webp', import.meta.url)),
  width: motionAtlas.cellWidth, height: motionAtlas.cellHeight, baseline: motionAtlas.baseline,
  walkFrames: motionAtlas.walkFrames, actionFrames: motionAtlas.actionFrames,
};
const clips: Record<string, Clip | undefined> = {
  guard: { image: imageAt(new URL('../../assets/generated/guard-walk.png', import.meta.url)),
    row: 0, width: 48, height: 44, baseline: 40, stride: 0.9, walkFrames: 6, actionFrames: 0 },
  spear: { ...spearAtlas, image: imageAt(new URL('../../assets/generated/spear-motion.webp', import.meta.url)),
    row: 0, width: spearAtlas.cellWidth, height: spearAtlas.cellHeight, stride: 0.82, action: 'melee' },
  archer: { ...shared, row: motionAtlas.rows.archer, stride: 0.85, action: 'arrow' },
  lancer: { ...shared, row: motionAtlas.rows.lancer, stride: 1.14, action: 'heavy' },
  captain: { ...captainAtlas, image: imageAt(new URL('../../assets/generated/captain-motion.webp', import.meta.url)),
    row: 0, width: captainAtlas.cellWidth, height: captainAtlas.cellHeight, stride: 0.86, action: 'melee' },
  marshal: { ...marshalAtlas, image: imageAt(new URL('../../assets/generated/marshal-motion.webp', import.meta.url)),
    row: 0, width: marshalAtlas.cellWidth, height: marshalAtlas.cellHeight, stride: 0.92, action: 'heavy' },
};

export const hasMovementClip = (id: string): boolean => Object.hasOwn(clips, id);
export const hasAttackClip = (id: string, style: AttackStyle): boolean => Object.hasOwn(clips, id) && clips[id]?.action === style;

export function drawUnitPose(ctx: CanvasRenderingContext2D, id: string, x: number, bottom: number, pose: UnitPose): boolean {
  const clip = clips[id];
  if (!clip?.image?.complete || !clip.image.naturalWidth) return false;
  let frame: number;
  if (pose.kind === 'idle') {
    if (clip.idleFrame === undefined) return false;
    frame = clip.idleFrame;
  } else if (pose.kind === 'move') frame = Math.floor(pose.distance / clip.stride * clip.walkFrames) % clip.walkFrames;
  else {
    const count = pose.kind === 'slam' ? clip.slamFrames : clip.actionFrames;
    if (!count) return false;
    const offset = clip.walkFrames + (pose.kind === 'slam' ? clip.actionFrames : 0);
    frame = offset + Math.min(count - 1, Math.floor(pose.progress * count));
  }
  const { width, height, baseline } = clip;
  const xAnchor = Math.round(x);
  const yAnchor = Math.round(bottom);
  const smooth = ctx.imageSmoothingEnabled;
  if (pose.right) {
    ctx.save();
    ctx.translate(xAnchor, yAnchor);
    ctx.scale(-1, 1);
  }
  if (smooth) ctx.imageSmoothingEnabled = false;
  ctx.drawImage(clip.image, frame * width, clip.row * height, width, height,
    (pose.right ? 0 : xAnchor) - width / 2, (pose.right ? 0 : yAnchor) - baseline, width, height);
  if (pose.right) ctx.restore();
  else if (smooth) ctx.imageSmoothingEnabled = true;
  return true;
}
