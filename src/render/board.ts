// 竞技场底图：木框、库边、毛毡与台灯光，按当前分辨率预先画好，每帧直接贴图。
import { ARENA } from '../core/content/tuning.js';
import { Rng } from '../core/rng.js';
import { PALETTE } from './palette.js';
import { RAIL, VIEW_H, VIEW_W, type View } from './view.js';
import { roundRectPath } from './shapes.js';

let noiseTile: HTMLCanvasElement | null = null;

function feltNoise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const size = 96;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const rng = new Rng(20260924);
  for (let i = 0; i < size * size; i++) {
    const v = rng.next();
    const light = v > 0.5;
    img.data[i * 4] = light ? 255 : 0;
    img.data[i * 4 + 1] = light ? 255 : 0;
    img.data[i * 4 + 2] = light ? 255 : 0;
    img.data[i * 4 + 3] = Math.floor(Math.abs(v - 0.5) * 34);
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = tile;
  return tile;
}

export function renderBoard(view: View): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = view.canvas.width;
  canvas.height = view.canvas.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const s = view.scale;
  ctx.setTransform(s, 0, 0, s, 0, 0);

  // 书桌
  ctx.fillStyle = PALETTE.desk;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 木框
  const frame = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  frame.addColorStop(0, PALETTE.railLight);
  frame.addColorStop(0.5, PALETTE.rail);
  frame.addColorStop(1, PALETTE.railDark);
  ctx.fillStyle = frame;
  roundRectPath(ctx, 1, 1, VIEW_W - 2, VIEW_H - 2, 26);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PALETTE.outline;
  ctx.stroke();

  // 木纹
  const grain = new Rng(7);
  ctx.save();
  roundRectPath(ctx, 1, 1, VIEW_W - 2, VIEW_H - 2, 26);
  ctx.clip();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = PALETTE.railDark;
  for (let i = 0; i < 46; i++) {
    const y = grain.range(0, VIEW_H);
    ctx.lineWidth = grain.range(0.6, 1.8);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      VIEW_W * 0.3,
      y + grain.range(-6, 6),
      VIEW_W * 0.7,
      y + grain.range(-6, 6),
      VIEW_W,
      y + grain.range(-4, 4),
    );
    ctx.stroke();
  }
  ctx.restore();

  // 库边准星（贝壳镶片）
  ctx.fillStyle = 'rgba(255, 244, 220, 0.75)';
  const diamonds = 6;
  for (let i = 1; i < diamonds; i++) {
    const x = RAIL + (ARENA.width / diamonds) * i;
    drawDiamond(ctx, x, RAIL / 2);
    drawDiamond(ctx, x, VIEW_H - RAIL / 2);
  }
  for (let i = 1; i < 4; i++) {
    const y = RAIL + (ARENA.height / 4) * i;
    drawDiamond(ctx, RAIL / 2, y);
    drawDiamond(ctx, VIEW_W - RAIL / 2, y);
  }

  // 库边（毛毡条）
  ctx.fillStyle = PALETTE.cushion;
  roundRectPath(ctx, RAIL - 9, RAIL - 9, ARENA.width + 18, ARENA.height + 18, 14);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();

  // 台面
  ctx.save();
  roundRectPath(ctx, RAIL, RAIL, ARENA.width, ARENA.height, 8);
  ctx.clip();
  ctx.fillStyle = PALETTE.felt;
  ctx.fillRect(RAIL, RAIL, ARENA.width, ARENA.height);
  const pattern = ctx.createPattern(feltNoise(), 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(RAIL, RAIL, ARENA.width, ARENA.height);
  }
  // 台灯的暖光与四角暗角
  const lamp = ctx.createRadialGradient(
    RAIL + ARENA.width * 0.5,
    RAIL + ARENA.height * 0.38,
    40,
    RAIL + ARENA.width * 0.5,
    RAIL + ARENA.height * 0.5,
    ARENA.width * 0.72,
  );
  lamp.addColorStop(0, 'rgba(255, 236, 190, 0.20)');
  lamp.addColorStop(0.55, 'rgba(255, 236, 190, 0.04)');
  lamp.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
  ctx.fillStyle = lamp;
  ctx.fillRect(RAIL, RAIL, ARENA.width, ARENA.height);
  // 库边投下的内阴影
  const edge = 26;
  const shades: Array<[number, number, number, number, number, number, number, number]> = [
    [RAIL, RAIL, ARENA.width, edge, RAIL, RAIL, RAIL, RAIL + edge],
    [RAIL, RAIL, edge, ARENA.height, RAIL, RAIL, RAIL + edge, RAIL],
  ];
  for (const [x, y, w, h, x0, y0, x1, y1] of shades) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  // 中线与开球点
  ctx.strokeStyle = PALETTE.chalk;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 10]);
  ctx.beginPath();
  ctx.moveTo(RAIL + ARENA.width / 2, RAIL + 18);
  ctx.lineTo(RAIL + ARENA.width / 2, RAIL + ARENA.height - 18);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = PALETTE.chalk;
  ctx.beginPath();
  ctx.arc(RAIL + ARENA.width / 2, RAIL + ARENA.height / 2, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return canvas;
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x + 3, y);
  ctx.lineTo(x, y + 4);
  ctx.lineTo(x - 3, y);
  ctx.closePath();
  ctx.fill();
}
