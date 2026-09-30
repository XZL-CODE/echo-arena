// 几种玩具共用的零件：发条钥匙、拳头、正面盾牌弧、齿轮、音符。
import { circleP, ellipseP, flat, OUTLINE, roundRectP, shade, type Mat } from './toon.js';

export const BRASS: Mat = {
  light: '#fff2bd',
  base: '#e4ae47',
  dark: '#8c5a16',
  gloss: 1,
  metal: true,
};
export const BRASS_DIM: Mat = {
  light: '#e9cf86',
  base: '#b88632',
  dark: '#6a4210',
  gloss: 0.6,
  metal: true,
};
export const GOLD: Mat = {
  light: '#fff7cf',
  base: '#f2c44f',
  dark: '#9a6814',
  gloss: 1,
  metal: true,
};
export const STEEL: Mat = {
  light: '#f6f9fc',
  base: '#aebccb',
  dark: '#53647a',
  gloss: 0.9,
  metal: true,
};

/**
 * 发条钥匙：绕竖轴转动（水平方向按 cos 缩放，转到侧面时变成一条线）。
 * (x, y) 是钥匙杆插进身体的位置，钥匙朝上。
 */
export function windKey(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  m: Mat = BRASS,
): void {
  ctx.save();
  ctx.translate(x, y);
  const stem = roundRectP(-size * 0.12, -size * 0.6, size * 0.24, size * 0.66, size * 0.08);
  flat(ctx, stem, { x: -size * 0.12, y: -size * 0.6, w: size * 0.24, h: size * 0.66 }, m, 1.4);
  ctx.translate(0, -size * 0.82);
  const c = Math.cos(angle);
  ctx.scale(Math.max(0.12, Math.abs(c)), 1);
  for (const side of [-1, 1] as const) {
    const lx = side * size * 0.44;
    const lobe = ellipseP(lx, 0, size * 0.46, size * 0.34);
    const facingUs = c * side > 0;
    shade(
      ctx,
      lobe,
      { x: lx - size * 0.46, y: -size * 0.34, w: size * 0.92, h: size * 0.68 },
      facingUs ? m : BRASS_DIM,
      1.5,
    );
    const hole = ellipseP(lx + side * size * 0.08, 0, size * 0.14, size * 0.1);
    ctx.fillStyle = 'rgba(60, 36, 12, 0.75)';
    ctx.fill(hole);
  }
  const hub = circleP(0, 0, size * 0.16);
  shade(ctx, hub, { x: -size * 0.16, y: -size * 0.16, w: size * 0.32, h: size * 0.32 }, m, 1.3);
  ctx.restore();
}

/** 圆拳头：朝 facing 一侧有三道指节。 */
export function fist(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  m: Mat,
  facing: number,
  edge = 2.2,
): void {
  shade(ctx, circleP(x, y, s), { x: x - s, y: y - s, w: s * 2, h: s * 2 }, m, edge);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(s * 0.34, i * s * 0.36 - s * 0.13);
    ctx.quadraticCurveTo(s * 0.62, i * s * 0.36, s * 0.34, i * s * 0.36 + s * 0.13);
  }
  ctx.lineWidth = Math.max(1, s * 0.12);
  ctx.strokeStyle = 'rgba(36, 26, 31, 0.55)';
  ctx.stroke();
  ctx.restore();
}

export interface ArcStyle {
  /** 盾面颜色、中间的亮线、外围光晕。 */
  face: string;
  core: string;
  glow: string;
}

export const ALLY_SHIELD: ArcStyle = {
  face: '#8fe6ff',
  core: '#f2fdff',
  glow: 'rgba(120, 225, 255, 1)',
};

/**
 * 正面盾牌：沿朝向画一段弧，弧的宽度就是真正能挡住弹丸的角度。
 * glow 是刚挡下弹丸后的闪光（0..1），一道亮点沿弧来回扫过，看起来像能量或镜面。
 */
export function shieldArc(
  ctx: CanvasRenderingContext2D,
  r: number,
  facing: number,
  arc: number,
  glow: number,
  t: number,
  style: ArcStyle,
): void {
  ctx.save();
  ctx.translate(0, -r * 0.42);
  ctx.scale(1, 0.9);
  const R = r + 8;
  const path = new Path2D();
  path.arc(0, 0, R, facing - arc, facing + arc);
  ctx.lineCap = 'round';
  ctx.lineWidth = 10.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(path);
  ctx.lineWidth = 7;
  ctx.strokeStyle = style.face;
  ctx.stroke(path);
  const inner = new Path2D();
  inner.arc(0, 0, R - 1.2, facing - arc * 0.9, facing + arc * 0.9);
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.core;
  ctx.stroke(inner);

  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.22 + glow * 0.6;
  ctx.lineWidth = 13 + glow * 10;
  ctx.strokeStyle = style.glow;
  ctx.stroke(path);
  // 扫过的亮点
  const sweep = facing - arc * 0.85 + ((Math.sin(t * 1.7) + 1) / 2) * arc * 1.7;
  const gx = Math.cos(sweep) * R;
  const gy = Math.sin(sweep) * R;
  const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 9);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.55 + glow * 0.45;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(gx, gy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 有厚度的金色齿轮（发条大王肚子里、肩上）。 */
export function gear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  teeth: number,
  rotation: number,
  m: Mat = GOLD,
  edge = 1.6,
): void {
  const path = new Path2D();
  const inner = r * 0.74;
  for (let i = 0; i < teeth * 4; i++) {
    const a = rotation + (i / (teeth * 4)) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  shade(ctx, path, { x: x - r, y: y - r, w: r * 2, h: r * 2 }, m, edge);
  const hole = circleP(x, y, r * 0.28);
  ctx.fillStyle = 'rgba(40, 24, 10, 0.8)';
  ctx.fill(hole);
}

/** 音符（叮当摇铃时飘出来）。 */
export function note(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.2);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.42, s * 0.3, -0.4, 0, Math.PI * 2);
  ctx.moveTo(s * 0.36, -s * 0.05);
  ctx.lineTo(s * 0.36, -s * 1.2);
  ctx.quadraticCurveTo(s * 0.9, -s * 0.95, s * 0.8, -s * 0.5);
  ctx.lineWidth = s * 0.34;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}
