import { FramePacer } from '../src/scenes/frame-rate.ts';

const loadImage = async path => {
  const image = new Image();
  image.src = new URL(path, import.meta.url).href;
  await image.decode();
  return image;
};

const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
const cellCount = 6;
const cycleMs = 600;
const cellWidth = 48;
const cellHeight = 44;

function extractCells(image) {
  const across = image.width / 3;
  const down = image.height / 2;
  return Array.from({ length: cellCount }, (_, index) => {
    const surface = canvas(across, down);
    const ctx = surface.getContext('2d');
    ctx.drawImage(image, index % 3 * across, Math.floor(index / 3) * down, across, down, 0, 0, across, down);
    const pixels = ctx.getImageData(0, 0, across, down);
    let left = across, right = 0, top = down, bottom = 0;
    for (let y = 0; y < down; y++) for (let x = 0; x < across; x++) {
      const alpha = (y * across + x) * 4 + 3;
      if (pixels.data[alpha] < 190) { pixels.data[alpha] = 0; continue; }
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (right <= left || bottom <= top) throw new Error(`Empty sprite cell ${index + 1}`);
    ctx.putImageData(pixels, 0, 0);
    const trimmed = canvas(right - left + 1, bottom - top + 1);
    trimmed.getContext('2d').drawImage(surface, -left, -top);
    return trimmed;
  });
}

function bake(frames, draw) {
  const sheet = canvas(frames * cellWidth, cellHeight);
  const context = sheet.getContext('2d');
  context.imageSmoothingEnabled = false;
  for (let frame = 0; frame < frames; frame++) {
    context.save();
    context.translate(frame * cellWidth, 0);
    draw(context, frame);
    context.restore();
  }
  return sheet;
}

const [wholeImage, partImage] = await Promise.all([
  loadImage('../assets/prototypes/guard-motion/frames.png'), loadImage('../assets/prototypes/guard-motion/parts.png'),
]);
const frames = extractCells(wholeImage);
const [torso, shield, sword, thigh, shin, boot] = extractCells(partImage);
const scale = Math.min(32 / Math.max(...frames.map(sprite => sprite.width)), 38 / Math.max(...frames.map(sprite => sprite.height)));

const drawnSheet = bake(cellCount, (context, frame) => {
  const sprite = frames[frame];
  const w = Math.round(sprite.width * scale);
  const h = Math.round(sprite.height * scale);
  context.drawImage(sprite, Math.round((cellWidth - w) / 2), 40 - h, w, h);
});

function joint(context, sprite, x, y, angle, width, height, pivotX, pivotY) {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.drawImage(sprite, -pivotX, -pivotY, width, height);
  context.restore();
}

function drawLeg(context, x, y, phase, far) {
  const swing = Math.sin(phase);
  const hip = 0.43 * swing;
  const knee = hip - Math.max(0, Math.cos(phase)) * 0.61;
  const kneeX = x - Math.sin(hip) * 6.4;
  const kneeY = y + Math.cos(hip) * 6.4;
  const ankleX = kneeX - Math.sin(knee) * 5.7;
  const ankleY = kneeY + Math.cos(knee) * 5.7;
  context.save();
  if (far) context.filter = 'brightness(75%)';
  joint(context, thigh, x, y, hip, 6, 9, 3, 1);
  joint(context, shin, kneeX, kneeY, knee, 4, 8, 2, 2);
  joint(context, boot, ankleX, ankleY, knee * 0.23, 7, 6, 5, 2);
  context.restore();
}

const rigSheet = bake(cellCount, (context, frame) => {
  const phase = (frame + 0.33) / cellCount * Math.PI * 2;
  const swing = Math.sin(phase);
  const bob = 0.6 * Math.cos(phase * 2);
  drawLeg(context, 26, 23 + bob, phase + Math.PI, true);
  drawLeg(context, 21, 23 + bob, phase, false);
  joint(context, sword, 19, 17 + bob, 0.14 * swing, 17, 19, 14, 2);
  joint(context, torso, 24, 25 + bob, -0.025 * swing, 21, 28, 11, 24);
  joint(context, shield, 27, 19 + bob, -0.08 * swing, 12, 18, 7, 4);
});

document.getElementById('export-sheet').href = drawnSheet.toDataURL();
document.getElementById('export-rig').href = rigSheet.toDataURL();

const panels = [
  { context: document.getElementById('sheet').getContext('2d'), sheet: drawnSheet, cost: 0 },
  { context: document.getElementById('rig').getContext('2d'), sheet: rigSheet, cost: 0 },
];
const rate = document.getElementById('rate');
const formation = document.getElementById('formation');
const move = document.getElementById('move');
const reports = document.querySelectorAll('output');
const pacer = new FramePacer();
let first;
let lastReport;
let painted = 0;

function drawPanel(context, sheet, elapsed) {
  const { width, height } = context.canvas;
  const count = Number(formation.value);
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#556c4f';
  context.fillRect(0, 0, width, height);
  for (let index = 0; index < count; index++) {
    const progress = (elapsed + index * 103) / cycleMs;
    const frame = Math.floor(progress * cellCount) % cellCount;
    const distance = move.checked ? -((progress * 18) % 40) + 20 : 0;
    const x = count === 1 ? width / 2 + distance * 3 : 36 + index % 8 * 56 + distance;
    const ground = count === 1 ? height / 2 + 25 : 41 + Math.floor(index / 8) * 46;
    context.fillStyle = '#14241c50';
    context.beginPath();
    context.ellipse(Math.round(x), ground, 12, 3, 0, 0, Math.PI * 2);
    context.fill();
    context.drawImage(sheet, frame * cellWidth, 0, cellWidth, cellHeight, Math.round(x - cellWidth / 2), ground - 40, cellWidth, cellHeight);
  }
}

function animate(now) {
  first ??= now;
  lastReport ??= now;
  if (pacer.allows(now, rate.value)) {
    for (const panel of panels) {
      const before = performance.now();
      drawPanel(panel.context, panel.sheet, now - first);
      panel.cost += performance.now() - before;
    }
    painted++;
  }
  if (now - lastReport >= 1000) {
    const fps = Math.round(painted * 1000 / (now - lastReport));
    panels.forEach((panel, index) => {
      const drawTime = painted ? (panel.cost / painted).toFixed(2) : '—';
      reports[index].textContent = `${fps} FPS 实际绘制 · 每帧 Canvas 调用约 ${drawTime} 毫秒`;
      panel.cost = 0;
    });
    painted = 0;
    lastReport = now;
  }
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
