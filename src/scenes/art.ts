import type { Point, RouteId } from '../core/types';
import { map } from '../data/content';
import { terrain } from '../systems/grid';
import { drawSprite } from './sprites';
import { drawUnitPose } from './unit-motion';
import type { UnitPose } from './unit-motion';

export const TILE = 76;
export const ROW = 62;
export const WIDTH = map.width * TILE;
export const HEIGHT = map.height * ROW;
export const pixel = ({ x, y }: Point): Point => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * ROW });

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function poly(ctx: CanvasRenderingContext2D, color: string, points: number[]): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function oval(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
}

function pine(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  oval(ctx, '#1c3027a9', 4, 0, 14, 5);
  rect(ctx, '#413f2b', -2, -12, 4, 14);
  for (const [height, spread] of [[-6, 13], [-14, 10], [-23, 7]]) {
    poly(ctx, '#263e33', [-spread, height, 0, height - 21, spread, height + 1, 3, height + 5]);
    poly(ctx, '#416348', [-spread + 1, height - 1, 0, height - 21, 2, height, -4, height + 1]);
    rect(ctx, '#6c7952', -spread + 4, height - 5, 3, 1);
  }
  ctx.restore();
}

export function drawTerrain(ctx: CanvasRenderingContext2D, crossing: RouteId): void {
  let seed = 907;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const greens = ['#667b51', '#60764c', '#6d8055', '#657950', '#708356'];
  const riverLeft = map.riverX * TILE;
  const water = ctx.createLinearGradient(riverLeft, 0, riverLeft + TILE, 0);
  water.addColorStop(0, '#526f59');
  water.addColorStop(0.18, '#417a78');
  water.addColorStop(0.53, '#306677');
  water.addColorStop(0.83, '#3e7980');
  water.addColorStop(1, '#557861');
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const left = x * TILE;
      const top = y * ROW;
      const type = terrain({ x, y }, crossing);
      rect(ctx, greens[Math.floor(rand() * greens.length)], left, top, TILE, ROW);
      for (let i = 0; i < 25; i++) {
        const px = left + 4 + Math.floor(rand() * 67);
        const py = top + 4 + Math.floor(rand() * 53);
        rect(ctx, i % 2 ? '#9fa47747' : '#334e373c', px, py, 2 + Math.floor(rand() * 4), 1 + Math.floor(rand() * 2));
        if (i % 6 === 0) {
          rect(ctx, '#3f60464e', px + 2, py - 3, 1, 4);
          rect(ctx, '#b6ae7885', px + 3, py - 3, 2, 1);
        }
      }
      if (type === 'water' || type === 'bridge') {
        ctx.fillStyle = water;
        ctx.fillRect(left, top, TILE, ROW);
        for (let bank = 0; bank < ROW; bank += 4) {
          const edge = 3 + Math.round(Math.sin((top + bank) / 13) * 2 + Math.cos((top + bank) / 4));
          rect(ctx, '#59704e', left, top + bank, edge, 4);
          rect(ctx, '#8ba3716e', left + edge, top + bank, 2, 4);
          rect(ctx, '#59704e', left + TILE - edge, top + bank, edge, 4);
          rect(ctx, '#93a87e67', left + TILE - edge - 2, top + bank, 2, 4);
        }
        for (let i = 0; i < 19; i++) {
          const px = left + 9 + Math.floor(rand() * 45);
          const py = top + Math.floor(rand() * 59);
          rect(ctx, i % 3 ? '#9ed4cb38' : '#234e6265', px, py, 3 + Math.floor(rand() * 13), 1);
          if (i % 4 === 0) rect(ctx, '#daf0d747', px + 3, py + 1, 4, 1);
        }
        if (type === 'bridge') {
          rect(ctx, '#263e39aa', left - 5, top + 19, TILE + 10, 29);
          rect(ctx, '#48392c', left - 4, top + 18, TILE + 8, 27);
          for (let i = -3; i <= TILE; i += 7) {
            rect(ctx, i % 3 ? '#a98555' : '#bd9b61', left + i, top + 20, 6, 23);
            rect(ctx, '#d2ac72', left + i, top + 21, 1, 20);
            rect(ctx, '#76563e', left + i + 3, top + 24, 1, 2);
            rect(ctx, '#76563e', left + i + 3, top + 38, 1, 2);
          }
          rect(ctx, '#d5b477', left - 4, top + 18, TILE + 8, 2);
          rect(ctx, '#795b3f', left - 4, top + 43, TILE + 8, 3);
        }
      }
      if (type === 'rock') {
        for (let i = 0; i < 7; i++) {
          const px = left + 8 + rand() * 54;
          const py = top + 15 + rand() * 42;
          if (i < 4) pine(ctx, px, py, 0.48 + rand() * 0.4);
          else {
            poly(ctx, '#445347', [px - 11, py, px - 8, py - 8, px + 1, py - 12, px + 11, py - 3, px + 7, py + 4]);
            poly(ctx, '#87917e', [px - 8, py - 8, px + 1, py - 12, px + 7, py - 6, px - 3, py - 3]);
            rect(ctx, '#a3a38b', px - 2, py - 8, 5, 1);
          }
        }
      }
      if (type === 'entry') {
        oval(ctx, '#b49867', left + 37, top + 33, 29, 17);
        rect(ctx, '#4c3a2c', left + 20, top + 13, 3, 34);
        poly(ctx, '#ae5444', [left + 23, top + 13, left + 48, top + 15, left + 40, top + 21, left + 48, top + 27, left + 23, top + 25]);
      }
      ctx.strokeStyle = '#263d304f';
      ctx.strokeRect(left + 0.5, top + 0.5, TILE - 1, ROW - 1);
    }
  }

  const shade = ctx.createRadialGradient(WIDTH * 0.55, HEIGHT * 0.51, 160, WIDTH * 0.5, HEIGHT * 0.5, 505);
  shade.addColorStop(0, '#16242300');
  shade.addColorStop(1, '#16242374');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

const buildingColors: Record<string, string> = {
  market: '#a9833d', storehouse: '#8d6939', barracks: '#586e9b', stable: '#a96145', bowcamp: '#527b52',
  magetower: '#905d75', arcanetower: '#7c65a7', bombard: '#8e663e', shrine: '#d5a96e', lab: '#538a93',
  hall: '#a18857', altar: '#7aa88d',
};
const buildingMarks: Record<string, string> = {
  market: '◈', storehouse: '▦', barracks: '▲', stable: '♞', bowcamp: '⇥', magetower: '✧', arcanetower: '✦',
  bombard: '●', shrine: '✚', lab: '◇', hall: '♜', altar: '☾',
};

export function structure(ctx: CanvasRenderingContext2D, name: string, at: Point, art?: string, width = 1, level = 1): void {
  const { x, y } = pixel(at);
  const keep = name === 'keep';
  const center = x + (width - 1) * TILE / 2;
  if (drawSprite(ctx, name, center, y + 19, keep ? 73 : width * TILE - 13, keep ? 83 : 62)) {
    if (level === 2) {
      rect(ctx, '#26332a', center + 17, y - 20, 13, 10);
      rect(ctx, '#e5bc71', center + 20, y - 18, 2, 6);
      rect(ctx, '#e5bc71', center + 25, y - 18, 2, 6);
    }
    return;
  }
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  oval(ctx, '#232e27ad', 4, 16, name === 'keep' ? 33 : 24, 10);
  if (name === 'farm') {
    poly(ctx, '#a18a53', [-25, 12, -16, -12, 25, -12, 19, 15]);
    for (let i = -14; i < 22; i += 8) {
      poly(ctx, '#686242', [i, -10, i + 4, -10, i - 2, 13, i - 7, 13]);
      for (let j = -8; j < 12; j += 5) rect(ctx, '#d2b765', i - j * 0.22, j, 3, 2);
    }
    rect(ctx, '#483d2e', 17, -16, 12, 15);
    poly(ctx, '#b18251', [14, -16, 23, -23, 33, -16, 28, -12, 18, -12]);
  } else if (name === 'wall') {
    for (let i = -25; i <= 23; i += 8) {
      rect(ctx, '#3e3d31', i, -14, 7, 31);
      rect(ctx, '#a58759', i + 1, -13, 4, 27);
      poly(ctx, '#c1a170', [i, -14, i + 3, -22, i + 7, -14]);
    }
    rect(ctx, '#75563d', -25, -5, 55, 4);
    rect(ctx, '#594534', -25, 6, 55, 4);
  } else if (name === 'watch' || name === 'keep') {
    const keep = name === 'keep';
    const w = keep ? 25 : 15;
    const top = keep ? -28 : -21;
    rect(ctx, '#393f3c', -w - 3, top, w * 2 + 6, 38);
    rect(ctx, '#89958b', -w, top + 1, w * 2, 36);
    rect(ctx, '#657370', 5, top + 2, w - 5, 36);
    for (let row = 0; row < 5; row++) {
      rect(ctx, '#4e5e58', -w, top + 4 + row * 8, w * 2, 1);
      for (let col = -w + (row % 2) * 5; col < w - 3; col += 10) rect(ctx, '#adb3a269', col, top + 5 + row * 8, 6, 2);
    }
    if (keep) {
      rect(ctx, '#333d38', -8, -3, 16, 19);
      rect(ctx, '#5c4734', -5, 1, 10, 15);
      for (const side of [-1, 1]) {
        rect(ctx, '#a4aa94', side * 24 - 6, -30, 12, 41);
        poly(ctx, '#416164', [side * 24 - 10, -29, side * 24, -48, side * 24 + 10, -29]);
      }
    } else {
      rect(ctx, '#283e3c', -3, -13, 6, 12);
      rect(ctx, '#c2a674', -2, -11, 3, 4);
    }
    poly(ctx, '#2a4448', [-w - 4, top + 1, 0, top - 20, w + 4, top + 1, 0, top + 7]);
    poly(ctx, '#537674', [-w - 4, top + 1, 0, top - 20, 0, top + 7]);
    if (keep) {
      rect(ctx, '#dac194', -1, top - 31, 2, 15);
      poly(ctx, '#c99b58', [1, top - 31, 19, top - 28, 14, top - 23, 1, top - 26]);
    }
  } else if (art === 'mine') {
    poly(ctx, '#63716b', [-30, 15, -25, -13, -11, -23, 4, -17, 15, -27, 28, -8, 31, 15]);
    poly(ctx, '#8e9b86', [-25, -13, -11, -23, 4, -17, 13, -25, 7, -9, -14, -6]);
    rect(ctx, '#303932', -10, -5, 23, 20);
    rect(ctx, '#a17449', -12, -8, 27, 5);
    for (const x of [-12, 11]) rect(ctx, '#956e45', x, -5, 4, 22);
  } else {
    const color = buildingColors[name] ?? '#809a9b';
    const wide = width > 1 ? 68 : 28;
    if (width > 1) ctx.translate(TILE / 2, 0);
    if (art === 'arcane') {
      poly(ctx, '#56675e', [-24, 16, -18, -7, 17, -7, 25, 16, 10, 23, -12, 23]);
      poly(ctx, color, [0, -36, 16, -19, 10, 1, 0, 7, -10, 1, -16, -19]);
      poly(ctx, '#efe5b9', [0, -31, 6, -19, 0, -8, -5, -19]);
    } else {
      oval(ctx, '#232e2790', 4, 15, wide, 11);
      rect(ctx, '#747360', -wide, -13, wide * 2, 29);
      rect(ctx, '#474e46', 4, -11, wide - 4, 27);
      poly(ctx, color, [-wide - 4, -10, -wide + 10, -27, wide - 11, -27, wide + 5, -10]);
      rect(ctx, '#302f28', -5, 3, 10, 13);
      for (let i = -wide + 5; i < wide - 3; i += 12) rect(ctx, '#c2a680', i, -5, 5, 3);
    }
    ctx.font = 'bold 15px Georgia';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff0bd';
    ctx.fillText(buildingMarks[name] ?? '◆', 0, art === 'arcane' ? 14 : -12);
    if (width > 1) ctx.translate(-TILE / 2, 0);
  }
  if (level === 2) {
    rect(ctx, '#3a412c', 12, -30, 12, 11);
    rect(ctx, '#ebc879', 14, -28, 2, 7);
    rect(ctx, '#ebc879', 19, -28, 2, 7);
  }
  ctx.restore();
}

const soldierColors: Record<string, string> = {
  archer: '#b4bb6a', skirmisher: '#b69a57', lancer: '#cb8657', rider: '#c17c59', mage: '#a28bd0',
  hexer: '#bb71b0', sentinel: '#8fa9b8', stalker: '#656e96', colossus: '#9e8068', ogre: '#8f7751',
  medic: '#b9d69b', summoner: '#70a58a', drake: '#d18357', captain: '#b8a2b1', marshal: '#d7544f', waykeeper: '#dbc77e',
};
export function soldier(ctx: CanvasRenderingContext2D, tile: Point, enemy: boolean, id: string, fraction?: number, pose?: UnitPose): void {
  const heavy = ['breaker', 'sentinel', 'ogre', 'colossus', 'marshal', 'drake', 'waykeeper'].includes(id);
  const { x, y } = pixel(tile);
  const boss = id === 'marshal';
  const mounted = id === 'lancer' || id === 'rider' || id === 'drake';
  const width = boss ? 61 : mounted || heavy ? 44 : 32;
  const height = boss ? 65 : heavy ? 47 : mounted ? 44 : 38;
  if ((pose && drawUnitPose(ctx, id, x, y + 15, pose)) || drawSprite(ctx, id, x, y + 15, width, height)) {
    if (fraction !== undefined && fraction < 1) {
      const bar = boss ? 34 : heavy ? 27 : 21;
      const top = y - height + 11;
      rect(ctx, '#25302b', x - bar / 2, top, bar, 4);
      rect(ctx, enemy ? '#ef977b' : '#9bdbb9', x - bar / 2 + 1, top + 1, (bar - 2) * fraction, 2);
    }
    return;
  }
  const scale = id === 'marshal' ? 1.65 : heavy ? 1.25 : 1;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y + 5));
  ctx.scale(scale, scale);
  const fabric = soldierColors[id] ?? (enemy ? '#a35243' : '#548f96');
  oval(ctx, '#202f2799', 1, 8, 9, 4);
  rect(ctx, '#373b34', -6, 3, 4, 7);
  rect(ctx, '#373b34', 2, 3, 4, 7);
  poly(ctx, fabric, [-8, 4, -7, -7, 7, -7, 8, 5, 0, 7]);
  rect(ctx, '#c7b18b', -4, -13, 8, 7);
  rect(ctx, '#687068', -5, -15, 10, 4);
  rect(ctx, '#dfd3ac', 7, -11, 2, 12);
  if (id === 'lancer' || id === 'rider') {
    rect(ctx, '#745544', -12, 3, 24, 7);
    rect(ctx, '#e5d9bd', 4, -13, 10, 2);
  }
  if (id === 'mage' || id === 'hexer' || id === 'summoner' || id === 'medic') {
    poly(ctx, '#efe2aa', [9, -17, 13, -13, 9, -9, 5, -13]);
  }
  if (id === 'marshal') {
    rect(ctx, '#3c2d30', -9, -27, 18, 8);
    poly(ctx, '#f2ca83', [-8, -23, -8, -31, -3, -26, 0, -32, 4, -26, 8, -31, 8, -23]);
  }
  if (heavy || !enemy) {
    poly(ctx, '#a29168', [-9, -6, -3, -4, -3, 4, -7, 7, -11, 3]);
    rect(ctx, '#554b3c', -8, -4, 2, 8);
  }
  if (fraction !== undefined && fraction < 1) {
    rect(ctx, '#232f2b', -10, -21, 20, 3);
    rect(ctx, enemy ? '#de8566' : '#8bc6a8', -10, -21, 20 * fraction, 2);
  }
  ctx.restore();
}
