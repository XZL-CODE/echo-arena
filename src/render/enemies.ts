// 对手的造型：木箭手、壳壳、发条鼠、爆爆虫、护士蜗牛、布熊、镜甲骑士、炮台蛙、弹簧小丑盒、发条大王。
// 坐标以单位位置为原点（脚下），r 是碰撞半径；整体已按 UNIT_DRAW_SCALE 放大。
import type { Unit } from '../core/sim/entities.js';
import { BRASS, gear, GOLD, shieldArc, STEEL, windKey, type ArcStyle } from './parts.js';
import { starPath } from './shapes.js';
import {
  blush,
  circleP,
  ellipseP,
  eyes,
  flat,
  glowDot,
  line,
  metalBands,
  OUTLINE,
  polyP,
  recent,
  roundRectP,
  shade,
  spec,
  type Mat,
} from './toon.js';
import type { Pose, UnitVisual } from './units.js';

const TAU = Math.PI * 2;

export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  p: Pose,
): void {
  switch (u.kind) {
    case 'archer':
      drawArcher(ctx, u, r, p);
      break;
    case 'shell':
      drawShell(ctx, u, r, p);
      break;
    case 'mouse':
      drawMouse(ctx, u, r, p);
      break;
    case 'bomber':
      drawBomber(ctx, u, v, r, p);
      break;
    case 'snail':
      drawSnail(ctx, r, p);
      break;
    case 'brute':
      drawBrute(ctx, u, r, p);
      break;
    case 'mirror':
      drawMirror(ctx, u, r, p);
      break;
    case 'mortar':
      drawMortar(ctx, u, r, p);
      break;
    case 'jack':
      drawJack(ctx, u, r, p);
      break;
    case 'king':
      drawKing(ctx, u, r, p);
      break;
    default:
      break;
  }
}

// ---- 木箭手：戴兜帽的木头小兵 ----

const WOOD_FACE: Mat = { light: '#ffe4bd', base: '#dfa771', dark: '#8e5a30', gloss: 0.25 };
const CLOAK: Mat = { light: '#c070ad', base: '#8a3f7c', dark: '#3a1236', gloss: 0.15 };
const HOOD: Mat = { light: '#a95896', base: '#72306a', dark: '#2f0d2c', gloss: 0.15 };
const LEATHER: Mat = { light: '#c08a58', base: '#7c4a26', dark: '#3a200c', gloss: 0.25 };

function drawArcher(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const hy = -r * 1.0;

  // 背上的箭筒
  ctx.save();
  ctx.translate(-f * r * 0.55, -r * 0.62);
  ctx.rotate(-f * 0.38);
  for (let i = -1; i <= 1; i++) {
    const fl = polyP([
      [i * r * 0.12 - r * 0.08, -r * 0.55],
      [i * r * 0.12, -r * 0.88],
      [i * r * 0.12 + r * 0.08, -r * 0.55],
    ]);
    flat(
      ctx,
      fl,
      { x: -r * 0.2, y: -r * 0.9, w: r * 0.4, h: r * 0.35 },
      { light: '#ffc2b0', base: '#ff8a6a', dark: '#b8452c', gloss: 0 },
      1.2,
    );
  }
  const quiver = roundRectP(-r * 0.22, -r * 0.6, r * 0.44, r * 1.0, r * 0.12);
  shade(ctx, quiver, { x: -r * 0.22, y: -r * 0.6, w: r * 0.44, h: r }, LEATHER, 1.8);
  ctx.restore();

  // 斗篷身体
  const cloak = new Path2D();
  cloak.moveTo(-r * 0.46, -r * 0.6);
  cloak.quadraticCurveTo(-r * 0.98, r * 0.1, -r * 0.84, r * 0.5);
  cloak.quadraticCurveTo(0, r * 0.66, r * 0.84, r * 0.5);
  cloak.quadraticCurveTo(r * 0.98, r * 0.1, r * 0.46, -r * 0.6);
  cloak.closePath();
  shade(ctx, cloak, { x: -r * 0.98, y: -r * 0.6, w: r * 1.96, h: r * 1.2 }, CLOAK, 2.4);
  // 斗篷褶皱与腰带
  ctx.beginPath();
  for (const k of [-0.42, 0.1, 0.5]) {
    ctx.moveTo(k * r, -r * 0.2);
    ctx.quadraticCurveTo(k * r * 1.2, r * 0.15, k * r * 1.1, r * 0.5);
  }
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(40, 8, 36, 0.55)';
  ctx.stroke();
  const belt = new Path2D();
  belt.moveTo(-r * 0.66, -r * 0.08);
  belt.quadraticCurveTo(0, r * 0.1, r * 0.66, -r * 0.08);
  line(ctx, belt, '#7c4a26', r * 0.12, 1.2);

  // 兜帽（头后）、木头脑袋、帽檐
  const tip = new Path2D();
  tip.moveTo(-f * r * 0.2, hy - r * 0.62);
  tip.quadraticCurveTo(-f * r * 0.95, hy - r * 0.75, -f * r * 1.1, hy - r * 0.1);
  tip.quadraticCurveTo(-f * r * 0.7, hy - r * 0.2, -f * r * 0.5, hy + r * 0.2);
  tip.closePath();
  shade(ctx, tip, { x: -r * 1.1, y: hy - r * 0.75, w: r * 1.1, h: r * 0.95 }, HOOD, 2);
  const back = circleP(-f * r * 0.06, hy - r * 0.02, r * 0.72);
  shade(ctx, back, { x: -r * 0.8, y: hy - r * 0.74, w: r * 1.44, h: r * 1.44 }, HOOD, 2.2);
  const head = circleP(f * r * 0.04, hy + r * 0.04, r * 0.56);
  shade(ctx, head, { x: -r * 0.52, y: hy - r * 0.52, w: r * 1.12, h: r * 1.12 }, WOOD_FACE, 2);
  // 帽檐投在脸上的阴影
  const shadowBand = ellipseP(f * r * 0.04, hy - r * 0.34, r * 0.54, r * 0.24);
  ctx.fillStyle = 'rgba(60, 20, 40, 0.35)';
  ctx.fill(shadowBand);
  const brim = new Path2D();
  brim.arc(f * r * 0.04, hy + r * 0.04, r * 0.6, Math.PI * 1.1, Math.PI * 1.9);
  line(ctx, brim, '#8c3f80', r * 0.2, 1.6);
  eyes(ctx, f * r * 0.16, hy + r * 0.08, r * 0.22, r * 0.15, p.look, p.expr, p.blink, t, {
    lid: '#dfa771',
    iris: '#3a1d1d',
  });

  // 弓：蓄力时拉满，箭头亮起
  const draw = p.windup;
  ctx.save();
  ctx.translate(0, -r * 0.28);
  ctx.rotate(u.facing);
  ctx.translate(r * 0.9, 0);
  const R = r * 0.8;
  const limb = new Path2D();
  limb.arc(-R * 0.4, 0, R, -1.05, 1.05);
  line(ctx, limb, '#b8804a', 3.4, 1.5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 230, 190, 0.7)';
  ctx.stroke(limb);
  const tipX = -R * 0.4 + Math.cos(1.05) * R;
  const tipY = Math.sin(1.05) * R;
  const pullX = tipX - draw * r * 0.75;
  ctx.beginPath();
  ctx.moveTo(tipX, -tipY);
  ctx.lineTo(pullX, 0);
  ctx.lineTo(tipX, tipY);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#fff4dc';
  ctx.stroke();
  if (draw > 0) {
    const head = pullX + r * 1.15;
    ctx.beginPath();
    ctx.moveTo(pullX, 0);
    ctx.lineTo(head, 0);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#6b4226';
    ctx.stroke();
    glowDot(ctx, head, 0, r * 0.9, 'rgba(255, 140, 100, 1)', draw);
    const arrowHead = polyP([
      [head + 6, 0],
      [head - 2, -4.2],
      [head - 2, 4.2],
    ]);
    ctx.fillStyle = '#ffb08a';
    ctx.fill(arrowHead);
    ctx.lineWidth = 1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(arrowHead);
  }
  ctx.restore();
}

// ---- 壳壳：背着螺旋大壳的寄居蟹，正面举着壳盾 ----

const SHELL: Mat = { light: '#ecccfa', base: '#a96dcd', dark: '#4a1f6b', gloss: 0.9 };
const CRAB: Mat = { light: '#ffc6b6', base: '#ff7c6a', dark: '#ad3528', gloss: 0.55 };
const SHELL_ARC: ArcStyle = { face: '#d6b3ef', core: '#ffffff', glow: 'rgba(214, 160, 255, 1)' };

function drawShell(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const snap = recent(t, u.attackAt, 0.25);

  // 小腿
  for (let i = 0; i < 3; i++) {
    const phase = p.step * 1.3 + i * 2.1;
    const lift = p.moving ? Math.max(0, Math.sin(phase)) * r * 0.12 : 0;
    const x = (i - 1) * r * 0.5 + f * r * 0.1;
    const leg = new Path2D();
    leg.moveTo(x, r * 0.1);
    leg.lineTo(x + f * r * 0.12, r * 0.42 - lift);
    line(ctx, leg, CRAB.base, 3, 1.4);
  }

  // 蟹身从壳口探出来
  const bx = f * r * 0.62;
  const body = ellipseP(bx, -r * 0.18, r * 0.42, r * 0.36);
  shade(ctx, body, { x: bx - r * 0.42, y: -r * 0.54, w: r * 0.84, h: r * 0.72 }, CRAB, 2);
  // 眼柄
  for (const dx of [-0.14, 0.18]) {
    const stx = bx + f * dx * r;
    const stalk = new Path2D();
    stalk.moveTo(stx, -r * 0.4);
    stalk.lineTo(stx + f * r * 0.06, -r * 0.92);
    line(ctx, stalk, CRAB.base, 2.4, 1.3);
    const eyeX = stx + f * r * 0.06;
    ctx.beginPath();
    ctx.arc(eyeX, -r * 0.98, r * 0.14, 0, TAU);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    if (p.expr === 'hurt' || p.blink) {
      ctx.beginPath();
      ctx.moveTo(eyeX - r * 0.1, -r * 0.98);
      ctx.lineTo(eyeX + r * 0.1, -r * 0.98);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(eyeX + p.look.x * r * 0.05, -r * 0.97, r * 0.07, 0, TAU);
      ctx.fillStyle = OUTLINE;
      ctx.fill();
      // 皱眉
      ctx.beginPath();
      ctx.moveTo(eyeX - r * 0.14, -r * 1.16 + (dx < 0 ? -r * 0.04 : r * 0.04) * f);
      ctx.lineTo(eyeX + r * 0.14, -r * 1.16 - (dx < 0 ? -r * 0.04 : r * 0.04) * f);
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
  }

  // 螺旋大壳
  const sx = -f * r * 0.12;
  const sy = -r * 0.5;
  const sr = r * 0.95;
  const shellPath = circleP(sx, sy, sr);
  shade(ctx, shellPath, { x: sx - sr, y: sy - sr, w: sr * 2, h: sr * 2 }, SHELL, 2.6);
  spiral(ctx, sx, sy, sr * 0.82, f, 'rgba(60, 20, 90, 0.55)', 'rgba(255, 235, 255, 0.55)');
  // 壳顶的三个小尖角
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 - f * (0.3 + i * 0.42);
    const px = sx + Math.cos(a) * sr * 0.92;
    const py = sy + Math.sin(a) * sr * 0.92;
    const spike = polyP([
      [px + Math.cos(a) * r * 0.32, py + Math.sin(a) * r * 0.32],
      [px + Math.cos(a + 1.4) * r * 0.14, py + Math.sin(a + 1.4) * r * 0.14],
      [px + Math.cos(a - 1.4) * r * 0.14, py + Math.sin(a - 1.4) * r * 0.14],
    ]);
    flat(ctx, spike, { x: px - r * 0.2, y: py - r * 0.3, w: r * 0.4, h: r * 0.4 }, SHELL, 1.6);
  }

  // 大钳子：攻击时夹一下
  ctx.save();
  ctx.translate(bx + f * r * 0.38, -r * 0.02);
  ctx.rotate(f * (-0.25 + snap * 0.5));
  const claw = new Path2D();
  claw.moveTo(0, 0);
  claw.quadraticCurveTo(f * r * 0.5, -r * 0.42, f * r * 0.62, -r * 0.05);
  claw.lineTo(f * r * 0.34, -r * 0.02);
  claw.quadraticCurveTo(f * r * 0.46, r * 0.22, 0, r * 0.2);
  claw.closePath();
  shade(ctx, claw, { x: -r * 0.1, y: -r * 0.42, w: r * 0.72, h: r * 0.64 }, CRAB, 2);
  ctx.restore();

  const shield = u.def.shield;
  if (shield) shieldArc(ctx, r, u.facing, shield.arc, recent(t, u.blockAt, 0.25), t, SHELL_ARC);
}

function spiral(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  f: number,
  dark: string,
  light: string,
): void {
  const path = new Path2D();
  for (let i = 0; i <= 40; i++) {
    const a = i * 0.36;
    const rr = r * (1 - i / 44);
    const px = x + Math.cos(a) * rr * f;
    const py = y + Math.sin(a) * rr;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = dark;
  ctx.stroke(path);
  ctx.save();
  ctx.translate(-0.8, -1.2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = light;
  ctx.stroke(path);
  ctx.restore();
}

// ---- 发条鼠：铁皮玩具老鼠，背上的钥匙转个不停 ----

const MOUSE_TIN: Mat = {
  light: '#fbf8ff',
  base: '#bfb1d9',
  dark: '#5e5280',
  gloss: 0.95,
  metal: true,
};
const PINK: Mat = { light: '#ffdce6', base: '#ff9fbb', dark: '#c05677', gloss: 0.5 };

function drawMouse(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const spin = t * (p.moving ? 22 : 6) + u.id;

  // 卷卷的发条尾巴
  const tail = new Path2D();
  tail.moveTo(-f * r * 0.85, r * 0.05);
  for (let i = 1; i <= 16; i++) {
    const k = i / 16;
    const a = k * TAU * 1.3 + t * 3;
    tail.lineTo(
      -f * (r * 0.95 + k * r * 0.7) + Math.cos(a) * r * 0.16,
      -k * r * 0.5 + Math.sin(a) * r * 0.16,
    );
  }
  line(ctx, tail, '#d9d0ea', 1.6, 1.2);

  // 两个小轮子
  for (const side of [-1, 1] as const) {
    const wx = side * r * 0.52;
    const wheel = circleP(wx, r * 0.36, r * 0.22);
    shade(
      ctx,
      wheel,
      { x: wx - r * 0.22, y: r * 0.14, w: r * 0.44, h: r * 0.44 },
      { light: '#77708a', base: '#3c3648', dark: '#16131c', gloss: 0.4 },
      1.6,
    );
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = spin * f + (k * TAU) / 3;
      ctx.moveTo(wx, r * 0.36);
      ctx.lineTo(wx + Math.cos(a) * r * 0.16, r * 0.36 + Math.sin(a) * r * 0.16);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#b9b2c8';
    ctx.stroke();
  }

  // 后耳朵
  ear(ctx, -f * r * 0.1, -r * 0.88, r * 0.34, true);

  // 水滴形的铁皮身体，鼻尖朝前
  const body = new Path2D();
  body.moveTo(f * r * 1.12, -r * 0.18);
  body.quadraticCurveTo(f * r * 0.3, -r * 1.3, -f * r * 0.92, -r * 0.35);
  body.quadraticCurveTo(-f * r * 1.0, r * 0.45, 0, r * 0.42);
  body.quadraticCurveTo(f * r * 0.72, r * 0.36, f * r * 1.12, -r * 0.18);
  body.closePath();
  shade(ctx, body, { x: -r, y: -r * 1.0, w: r * 2.1, h: r * 1.42 }, MOUSE_TIN, 2.2);
  // 铁皮接缝与铆钉
  const seam = new Path2D();
  seam.moveTo(-f * r * 0.05, -r * 0.8);
  seam.quadraticCurveTo(f * r * 0.1, -r * 0.2, -f * r * 0.05, r * 0.38);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(50, 40, 80, 0.5)';
  ctx.stroke(seam);
  for (const k of [-0.55, -0.1, 0.25]) {
    ctx.beginPath();
    ctx.arc(f * r * 0.06, k * r, 1.4, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  // 前耳朵、眼睛、鼻子与胡须
  ear(ctx, f * r * 0.22, -r * 0.84, r * 0.36, false);
  const ex = f * r * 0.6;
  const ey = -r * 0.42;
  if (p.expr === 'hurt' || p.blink) {
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.12, ey);
    ctx.lineTo(ex + r * 0.12, ey);
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  } else {
    shade(
      ctx,
      circleP(ex, ey, r * 0.15),
      { x: ex - r * 0.15, y: ey - r * 0.15, w: r * 0.3, h: r * 0.3 },
      { light: '#6a5a7a', base: '#241a2a', dark: '#000000', gloss: 1 },
      1.2,
    );
    ctx.beginPath();
    ctx.moveTo(ex - f * r * 0.2, ey - r * 0.28);
    ctx.lineTo(ex + f * r * 0.14, ey - r * 0.18);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  const nx = f * r * 1.12;
  shade(
    ctx,
    circleP(nx, -r * 0.18, r * 0.14),
    { x: nx - r * 0.14, y: -r * 0.32, w: r * 0.28, h: r * 0.28 },
    PINK,
    1.4,
  );
  ctx.beginPath();
  for (const dy of [-0.1, 0.06]) {
    ctx.moveTo(nx - f * r * 0.1, -r * 0.14 + dy * r);
    ctx.lineTo(nx + f * r * 0.35, -r * 0.2 + dy * r * 2.2);
  }
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = 'rgba(36, 26, 31, 0.7)';
  ctx.stroke();

  // 背上的发条钥匙
  ctx.save();
  ctx.translate(-f * r * 0.42, -r * 0.82);
  ctx.rotate(-f * 0.5);
  windKey(ctx, 0, 0, r * 0.55, spin);
  ctx.restore();
}

function ear(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, back: boolean) {
  shade(
    ctx,
    circleP(x, y, s),
    { x: x - s, y: y - s, w: s * 2, h: s * 2 },
    back ? { ...MOUSE_TIN, light: '#d9d2ea', base: '#9d90bc' } : MOUSE_TIN,
    1.8,
  );
  const inner = circleP(x + s * 0.05, y + s * 0.08, s * 0.58);
  flat(ctx, inner, { x: x - s * 0.6, y: y - s * 0.5, w: s * 1.2, h: s * 1.2 }, PINK, 0);
}

// ---- 爆爆虫：带引信的炸弹甲虫，点燃后发烫、胀大、抖个不停 ----

const BOMB: Mat = { light: '#9a68ad', base: '#4a2257', dark: '#16061c', gloss: 1 };

function drawBomber(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual, r: number, p: Pose) {
  const t = p.t;
  const fusing = u.state === 'fuse';
  const k = fusing ? p.windup : 0;
  const jitter = fusing ? Math.sin(t * 57) * k * r * 0.08 : 0;
  const grow = 1 + k * 0.2;
  const cy = -r * 0.3;
  ctx.save();
  ctx.translate(jitter, 0);
  ctx.translate(0, r * 0.5);
  ctx.scale(grow, grow);
  ctx.translate(0, -r * 0.5);

  // 六条小腿
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1] as const) {
      const phase = p.step * 1.6 + i * 2 + (side > 0 ? 0 : 1);
      const x0 = side * r * (0.3 + i * 0.22);
      const leg = new Path2D();
      leg.moveTo(x0, r * 0.2);
      leg.lineTo(
        x0 + side * r * 0.3,
        r * 0.5 - (p.moving ? Math.max(0, Math.sin(phase)) * r * 0.14 : 0),
      );
      line(ctx, leg, '#2b1430', 2, 1.2);
    }
  }

  const body = circleP(0, cy, r);
  shade(ctx, body, { x: -r, y: cy - r, w: r * 2, h: r * 2 }, BOMB, 2.4);
  if (k > 0) {
    // 发烫：越接近爆炸越红越亮；减少闪烁时只平稳地变亮，不跳动。
    const pulse = v.reduceFlashes ? 1 : 0.75 + 0.25 * Math.sin(t * (10 + k * 8));
    const heat = ctx.createRadialGradient(0, cy, 0, 0, cy, r);
    heat.addColorStop(0, `rgba(255, 200, 120, ${0.9 * k * pulse})`);
    heat.addColorStop(0.6, `rgba(255, 110, 50, ${0.6 * k * pulse})`);
    heat.addColorStop(1, `rgba(255, 60, 30, ${0.3 * k * pulse})`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = heat;
    ctx.fill(body);
    ctx.restore();
    glowDot(ctx, 0, cy, r * 2.2, 'rgba(255, 120, 60, 0.9)', k * 0.5 * pulse);
  }

  // 铜箍
  const band = new Path2D();
  band.ellipse(0, cy + r * 0.28, r * 0.98, r * 0.3, 0, 0.12, Math.PI - 0.12);
  line(ctx, band, '#e4ae47', r * 0.16, 1.3);
  // 脸
  eyes(ctx, 0, cy - r * 0.08, r * 0.32, r * 0.22, p.look, p.expr, p.blink, t, {
    lid: '#4a2257',
    iris: '#ff9d5c',
  });
  const grin = new Path2D();
  grin.moveTo(-r * 0.32, cy + r * 0.22);
  for (let i = 1; i <= 6; i++) {
    grin.lineTo(-r * 0.32 + (i * r * 0.64) / 6, cy + r * 0.22 + (i % 2 === 0 ? 0 : r * 0.08));
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffd6a5';
  ctx.stroke(grin);

  // 引信座与引信
  const cap = roundRectP(-r * 0.24, cy - r * 1.12, r * 0.48, r * 0.24, r * 0.06);
  shade(ctx, cap, { x: -r * 0.24, y: cy - r * 1.12, w: r * 0.48, h: r * 0.24 }, BRASS, 1.6);
  const fuse = new Path2D();
  fuse.moveTo(0, cy - r * 1.1);
  fuse.quadraticCurveTo(r * 0.35, cy - r * 1.45, r * 0.2, cy - r * 1.7);
  line(ctx, fuse, '#e6d4ad', 2.2, 1.2);
  const sx = r * 0.2;
  const sy = cy - r * 1.74;
  const spark = 1 + Math.sin(t * 17 + u.id) * 0.2 + k * 1.2;
  glowDot(
    ctx,
    sx,
    sy,
    r * (0.7 + k * 0.9) * spark,
    fusing ? 'rgba(255, 120, 60, 1)' : 'rgba(255, 210, 110, 1)',
    0.9,
  );
  starPath(ctx, sx, sy, 6, r * 0.28 * spark, r * 0.1 * spark, t * 9);
  ctx.fillStyle = fusing ? '#fff1c2' : '#ffe08a';
  ctx.fill();
  ctx.restore();
}

// ---- 护士蜗牛：戴护士帽，隔一会儿给附近的对手回血 ----

const SNAIL_SHELL: Mat = { light: '#fdeaf6', base: '#e3a7d2', dark: '#8a4a80', gloss: 0.9 };
const SNAIL_BODY: Mat = { light: '#fffaf0', base: '#f5e0bd', dark: '#c09a68', gloss: 0.6 };

function drawSnail(ctx: CanvasRenderingContext2D, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const healing = p.windup;
  if (healing > 0) glowDot(ctx, 0, -r * 0.4, r * 2.1, 'rgba(255, 170, 200, 1)', healing * 0.6);

  // 身体：前端抬起的头
  const stretch = p.moving ? Math.sin(p.step * 0.8) * r * 0.06 : 0;
  const body = new Path2D();
  body.moveTo(-f * r * 0.95, r * 0.42);
  body.quadraticCurveTo(f * r * 0.2, r * 0.6, f * (r * 1.12 + stretch), r * 0.2);
  body.quadraticCurveTo(f * (r * 1.32 + stretch), -r * 0.62, f * r * 0.86, -r * 0.7);
  body.quadraticCurveTo(f * r * 0.46, -r * 0.5, f * r * 0.5, r * 0.1);
  body.closePath();
  shade(ctx, body, { x: -r, y: -r * 0.7, w: r * 2.3, h: r * 1.3 }, SNAIL_BODY, 2.2);

  // 触角上的眼睛
  const hx = f * (r * 0.95 + stretch);
  for (const d of [-0.2, 0.18]) {
    const stalk = new Path2D();
    stalk.moveTo(hx + f * d * r, -r * 0.55);
    stalk.lineTo(hx + f * (d * r * 1.4 + r * 0.08), -r * 1.12);
    line(ctx, stalk, SNAIL_BODY.base, 2.2, 1.2);
    const ex = hx + f * (d * r * 1.4 + r * 0.08);
    ctx.beginPath();
    ctx.arc(ex, -r * 1.18, r * 0.13, 0, TAU);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    if (!p.blink && p.expr !== 'hurt') {
      ctx.beginPath();
      ctx.arc(ex + p.look.x * r * 0.04, -r * 1.16, r * 0.07, 0, TAU);
      ctx.fillStyle = OUTLINE;
      ctx.fill();
    }
  }
  blush(ctx, hx + f * r * 0.1, -r * 0.2, r * 0.15);
  const smile = new Path2D();
  smile.arc(hx + f * r * 0.12, -r * 0.3, r * 0.14, 0.3, Math.PI - 0.3);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(smile);

  // 护士帽
  ctx.save();
  ctx.translate(hx - f * r * 0.02, -r * 0.72);
  ctx.rotate(f * 0.15);
  const cap = new Path2D();
  cap.moveTo(-r * 0.32, r * 0.05);
  cap.lineTo(-r * 0.24, -r * 0.2);
  cap.quadraticCurveTo(0, -r * 0.3, r * 0.24, -r * 0.2);
  cap.lineTo(r * 0.32, r * 0.05);
  cap.closePath();
  shade(
    ctx,
    cap,
    { x: -r * 0.32, y: -r * 0.3, w: r * 0.64, h: r * 0.35 },
    { light: '#ffffff', base: '#f3f0f5', dark: '#b7aec0', gloss: 0.4 },
    1.4,
  );
  ctx.fillStyle = '#ff4f73';
  ctx.fillRect(-r * 0.04, -r * 0.2, r * 0.08, r * 0.2);
  ctx.fillRect(-r * 0.1, -r * 0.14, r * 0.2, r * 0.08);
  ctx.restore();

  // 螺旋壳
  const sx = -f * r * 0.22;
  const sy = -r * 0.36;
  const sr = r * 0.8;
  shade(
    ctx,
    circleP(sx, sy, sr),
    { x: sx - sr, y: sy - sr, w: sr * 2, h: sr * 2 },
    SNAIL_SHELL,
    2.4,
  );
  spiral(ctx, sx, sy, sr * 0.8, -f, 'rgba(110, 40, 100, 0.5)', 'rgba(255, 245, 252, 0.7)');

  // 回血前：浮起的小十字
  if (healing > 0) {
    ctx.save();
    ctx.globalAlpha *= healing;
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.9 + i / 3) % 1;
      const cx = sx + Math.sin(i * 2.1 + t) * r * 0.9;
      const cy = sy - r * 0.6 - k * r * 1.1;
      ctx.globalAlpha = healing * (1 - k);
      ctx.fillStyle = '#ff7aa3';
      ctx.fillRect(cx - r * 0.05, cy - r * 0.16, r * 0.1, r * 0.32);
      ctx.fillRect(cx - r * 0.16, cy - r * 0.05, r * 0.32, r * 0.1);
    }
    ctx.restore();
  }
}

// ---- 布熊：缝着补丁的毛绒蛮兵，一只纽扣眼 ----

const PLUSH: Mat = { light: '#dcaa88', base: '#a8714f', dark: '#52301f', gloss: 0 };
const MUZZLE: Mat = { light: '#fff2df', base: '#e9c69e', dark: '#aa8456', gloss: 0.1 };
const PATCH: Mat = { light: '#c07cb0', base: '#7b3f6e', dark: '#3c1435', gloss: 0 };

function fuzzy(x: number, y: number, r: number, seed: number): Path2D {
  const path = new Path2D();
  const n = 34;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (1 + 0.035 * Math.sin(i * 7.3 + seed) + 0.02 * Math.sin(i * 3.1 + seed * 2));
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

function drawBrute(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const w = p.windup;
  const cy = -r * 0.36;

  // 后手
  const bx = -f * r * 0.98;
  shade(
    ctx,
    fuzzy(bx, -r * 0.18, r * 0.34, 3),
    { x: bx - r * 0.34, y: -r * 0.52, w: r * 0.68, h: r * 0.68 },
    { ...PLUSH, base: '#8f5c3f' },
    2.2,
  );

  // 耳朵
  for (const side of [-1, 1] as const) {
    const ex = side * r * 0.62;
    shade(
      ctx,
      fuzzy(ex, cy - r * 0.78, r * 0.3, side),
      { x: ex - r * 0.3, y: cy - r * 1.08, w: r * 0.6, h: r * 0.6 },
      PLUSH,
      2.2,
    );
    flat(
      ctx,
      circleP(ex, cy - r * 0.76, r * 0.15),
      { x: ex - r * 0.15, y: cy - r * 0.9, w: r * 0.3, h: r * 0.3 },
      MUZZLE,
      0,
    );
  }
  // 身体
  const body = fuzzy(0, cy, r, u.id);
  shade(ctx, body, { x: -r, y: cy - r, w: r * 2, h: r * 2 }, PLUSH, 2.8);
  // 补丁与缝线
  const patch = roundRectP(-f * r * 0.7, cy + r * 0.12, r * 0.42, r * 0.36, 3);
  flat(ctx, patch, { x: -f * r * 0.7, y: cy + r * 0.12, w: r * 0.42, h: r * 0.36 }, PATCH, 1.4);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const x = -r * 0.08 + i * r * 0.1;
    ctx.moveTo(x, cy + r * 0.5);
    ctx.lineTo(x + r * 0.06, cy + r * 0.62);
    ctx.moveTo(x + r * 0.06, cy + r * 0.5);
    ctx.lineTo(x, cy + r * 0.62);
  }
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // 口鼻
  const mx = f * r * 0.3;
  const muzzle = ellipseP(mx, cy + r * 0.02, r * 0.36, r * 0.26);
  shade(ctx, muzzle, { x: mx - r * 0.36, y: cy - r * 0.24, w: r * 0.72, h: r * 0.52 }, MUZZLE, 1.8);
  shade(
    ctx,
    ellipseP(mx + f * r * 0.1, cy - r * 0.08, r * 0.12, r * 0.09),
    { x: mx, y: cy - r * 0.17, w: r * 0.24, h: r * 0.18 },
    { light: '#6b5460', base: '#241a1f', dark: '#000000', gloss: 1 },
    1.2,
  );
  const mouth = new Path2D();
  mouth.moveTo(mx - r * 0.16, cy + r * 0.16);
  mouth.quadraticCurveTo(mx, cy + r * 0.08, mx + r * 0.16, cy + r * 0.16);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(mouth);

  // 眼睛：一只生气的眼睛，一只纽扣眼
  const ey = cy - r * 0.42;
  eyes(ctx, f * r * 0.06, ey, r * 0.3, r * 0.15, p.look, p.expr, p.blink, t, { lid: '#a8714f' });
  const bxEye = f * r * 0.06 - f * r * 0.3;
  shade(
    ctx,
    circleP(bxEye, ey, r * 0.2),
    { x: bxEye - r * 0.2, y: ey - r * 0.2, w: r * 0.4, h: r * 0.4 },
    { light: '#7a5a6a', base: '#2a1d24', dark: '#0a0508', gloss: 1 },
    1.6,
  );
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(bxEye + dx * r * 0.06, ey + dy * r * 0.06, r * 0.03, 0, TAU);
    ctx.fill();
  }

  // 前手：蓄力时举过头顶，出拳时砸出去
  const punch = p.attack;
  const fx = Math.cos(u.facing) * r * (1.04 + punch * 0.5);
  const fy = Math.sin(u.facing) * r * 0.55 - r * 0.2 - w * r * 1.0;
  if (w > 0) glowDot(ctx, fx, fy, r * 0.9, 'rgba(255, 110, 90, 1)', w * 0.6);
  shade(
    ctx,
    fuzzy(fx, fy, r * 0.4, 5),
    { x: fx - r * 0.4, y: fy - r * 0.4, w: r * 0.8, h: r * 0.8 },
    PLUSH,
    2.4,
  );
  const pad = ellipseP(fx + Math.cos(u.facing) * r * 0.14, fy + r * 0.05, r * 0.18, r * 0.14);
  flat(ctx, pad, { x: fx - r * 0.2, y: fy - r * 0.1, w: r * 0.4, h: r * 0.3 }, MUZZLE, 1);
}

// ---- 镜甲骑士：镀铬盔甲，镜盾会把弹丸反射回去 ----

const CHROME: Mat = { light: '#ffffff', base: '#b9c5d4', dark: '#34405a', gloss: 1 };
const CAPE: Mat = { light: '#a26ce0', base: '#6a3d9a', dark: '#26104a', gloss: 0.2 };
const MIRROR_ARC: ArcStyle = { face: '#eef7ff', core: '#ffffff', glow: 'rgba(200, 170, 255, 1)' };

function drawMirror(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const sheen = Math.sin(t * 0.9 + u.id) * 0.35;

  // 披风在身后飘
  const wave = Math.sin(t * (p.moving ? 9 : 3) + u.id) * r * 0.1;
  const cape = new Path2D();
  cape.moveTo(-f * r * 0.1, -r * 0.92);
  cape.quadraticCurveTo(-f * r * 1.15, -r * 0.35 + wave, -f * (r * 0.98 + wave), r * 0.52);
  cape.lineTo(-f * r * 0.1 + wave * 0.5, r * 0.42);
  cape.lineTo(f * r * 0.2, r * 0.3);
  cape.closePath();
  shade(ctx, cape, { x: -r * 1.2, y: -r * 0.92, w: r * 1.4, h: r * 1.45 }, CAPE, 2);

  // 靴子
  for (const side of [-1, 1] as const) {
    const lift = p.moving ? Math.max(0, Math.sin(p.step + (side > 0 ? 0 : Math.PI))) * r * 0.12 : 0;
    const boot = roundRectP(side * r * 0.36 - r * 0.24, r * 0.3 - lift, r * 0.48, r * 0.3, r * 0.1);
    shade(
      ctx,
      boot,
      { x: side * r * 0.36 - r * 0.24, y: r * 0.3, w: r * 0.48, h: r * 0.3 },
      STEEL,
      1.8,
    );
  }

  // 胸甲：亮带随时间缓缓滑过
  const tx = -r * 0.74;
  const ty = -r * 0.66;
  const tw = r * 1.48;
  const th = r * 1.04;
  const torso = roundRectP(tx, ty, tw, th, r * 0.34);
  const torsoBox = { x: tx, y: ty, w: tw, h: th };
  shade(ctx, torso, torsoBox, CHROME, 2.6);
  metalBands(ctx, torso, torsoBox, sheen, 1.1);
  const waist = new Path2D();
  waist.moveTo(tx + 3, ty + th * 0.62);
  waist.quadraticCurveTo(0, ty + th * 0.74, tx + tw - 3, ty + th * 0.62);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(30, 40, 60, 0.55)';
  ctx.stroke(waist);
  const ridge = new Path2D();
  ridge.moveTo(f * r * 0.08, ty + 3);
  ridge.lineTo(f * r * 0.08, ty + th * 0.6);
  ctx.stroke(ridge);
  shade(
    ctx,
    circleP(f * r * 0.08, ty + th * 0.68, r * 0.12),
    { x: f * r * 0.08 - r * 0.12, y: ty + th * 0.68 - r * 0.12, w: r * 0.24, h: r * 0.24 },
    { light: '#f2d9ff', base: '#b36bff', dark: '#4d1a8c', gloss: 1 },
    1.4,
  );
  // 护肩
  for (const side of [-1, 1] as const) {
    const px = side * r * 0.74;
    const pad = ellipseP(px, ty + r * 0.08, r * 0.32, r * 0.24, side * 0.3);
    const padBox = { x: px - r * 0.32, y: ty - r * 0.16, w: r * 0.64, h: r * 0.48 };
    shade(ctx, pad, padBox, CHROME, 2);
  }

  // 头盔：一道横向眼缝发着紫光
  const hx = -r * 0.6 + f * r * 0.05;
  const hy = -r * 1.36;
  const hw = r * 1.2;
  const hh = r * 0.8;
  const helm = roundRectP(hx, hy, hw, hh, r * 0.42);
  const helmBox = { x: hx, y: hy, w: hw, h: hh };
  shade(ctx, helm, helmBox, CHROME, 2.4);
  metalBands(ctx, helm, helmBox, sheen + 0.2, 0.9);
  const crest = new Path2D();
  crest.moveTo(hx + hw / 2, hy + 2);
  crest.lineTo(hx + hw / 2, hy + hh * 0.42);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(30, 40, 60, 0.5)';
  ctx.stroke(crest);
  const slitX = hx + hw * 0.12 + f * r * 0.08;
  const slitY = hy + hh * 0.5;
  glowDot(
    ctx,
    slitX + hw * 0.38,
    slitY,
    r * 0.75,
    'rgba(200, 150, 255, 1)',
    p.expr === 'hurt' ? 0.15 : 0.6,
  );
  const slit = roundRectP(slitX, slitY - r * 0.08, hw * 0.76, r * 0.16, r * 0.08);
  ctx.fillStyle = '#140b22';
  ctx.fill(slit);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(slit);
  if (!p.blink && p.expr !== 'hurt') {
    const lookX = p.look.x * r * 0.08;
    for (const k of [0.3, 0.7]) {
      glowDot(ctx, slitX + hw * 0.76 * k + lookX, slitY, r * 0.16, 'rgba(236, 210, 255, 1)', 1);
    }
  }
  // 羽饰
  const plume = new Path2D();
  plume.moveTo(hx + hw / 2 - r * 0.06, hy + 2);
  plume.bezierCurveTo(
    -f * r * 0.2,
    hy - r * 0.6,
    -f * r * 0.8,
    hy - r * 0.62,
    -f * r * 1.02,
    hy - r * 0.1,
  );
  plume.bezierCurveTo(
    -f * r * 0.7,
    hy - r * 0.3,
    -f * r * 0.3,
    hy - r * 0.26,
    hx + hw / 2 + r * 0.1,
    hy + 3,
  );
  plume.closePath();
  shade(
    ctx,
    plume,
    { x: -r, y: hy - r * 0.62, w: r * 1.1, h: r * 0.66 },
    { light: '#e8c4ff', base: '#c77dff', dark: '#6a2aa8', gloss: 0.3 },
    1.8,
  );

  const shield = u.def.shield;
  if (shield) shieldArc(ctx, r, u.facing, shield.arc, recent(t, u.blockAt, 0.3), t, MIRROR_ARC);
}

// ---- 炮台蛙：背着迫击炮的青蛙 ----

const FROG: Mat = { light: '#e6bdea', base: '#a86fae', dark: '#4f2255', gloss: 0.85 };
const FROG_BELLY: Mat = { light: '#fff6f0', base: '#f1d5dc', dark: '#b88f9c', gloss: 0.3 };
const GUNMETAL: Mat = {
  light: '#a29cb8',
  base: '#4a4458',
  dark: '#15121c',
  gloss: 0.9,
  metal: true,
};

function drawMortar(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const recoil = recent(t, u.attackAt, 0.3);

  // 背上的炮管：斜向后上方，开炮时后坐
  ctx.save();
  ctx.translate(-f * r * 0.25, -r * 0.82);
  ctx.rotate(f > 0 ? -Math.PI * 0.3 : -Math.PI * 0.7);
  const kick = recoil * r * 0.25;
  const barrel = roundRectP(-kick, -r * 0.3, r * 1.3, r * 0.6, r * 0.16);
  shade(ctx, barrel, { x: -kick, y: -r * 0.3, w: r * 1.3, h: r * 0.6 }, GUNMETAL, 2.2);
  for (const k of [0.32, 0.98]) {
    const ring = roundRectP(r * k - kick, -r * 0.35, r * 0.14, r * 0.7, 2);
    shade(ctx, ring, { x: r * k - kick, y: -r * 0.35, w: r * 0.14, h: r * 0.7 }, BRASS, 1.3);
  }
  const muzzle = ellipseP(r * 1.3 - kick, 0, r * 0.12, r * 0.3);
  ctx.fillStyle = '#0b0910';
  ctx.fill(muzzle);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(muzzle);
  if (p.windup > 0) {
    glowDot(ctx, r * 0.2 - kick, -r * 0.32, r * 0.7, 'rgba(255, 170, 70, 1)', p.windup);
  }
  ctx.restore();

  // 青蛙身体
  const body = ellipseP(0, -r * 0.2, r * 1.06, r * 0.8);
  shade(ctx, body, { x: -r * 1.06, y: -r, w: r * 2.12, h: r * 1.6 }, FROG, 2.5);
  const belly = ellipseP(f * r * 0.15, r * 0.08, r * 0.62, r * 0.42);
  shade(
    ctx,
    belly,
    { x: f * r * 0.15 - r * 0.62, y: -r * 0.34, w: r * 1.24, h: r * 0.84 },
    FROG_BELLY,
    0,
  );
  for (const [sx, sy, sr] of [
    [-0.55, -0.55, 0.13],
    [-0.8, -0.2, 0.09],
    [-0.35, -0.3, 0.07],
  ] as const) {
    ctx.beginPath();
    ctx.arc(f * sx * r, sy * r, sr * r, 0, TAU);
    ctx.fillStyle = 'rgba(80, 30, 90, 0.35)';
    ctx.fill();
  }
  // 前脚
  for (const side of [-1, 1] as const) {
    const fx = side * r * 0.5 + f * r * 0.2;
    const foot = ellipseP(fx, r * 0.5, r * 0.26, r * 0.12);
    shade(ctx, foot, { x: fx - r * 0.26, y: r * 0.38, w: r * 0.52, h: r * 0.24 }, FROG, 1.6);
  }
  // 鼓起的眼包
  for (const side of [-1, 1] as const) {
    const ex = side * r * 0.46 + f * r * 0.1;
    shade(
      ctx,
      circleP(ex, -r * 0.84, r * 0.32),
      { x: ex - r * 0.32, y: -r * 1.16, w: r * 0.64, h: r * 0.64 },
      FROG,
      2,
    );
  }
  eyes(ctx, f * r * 0.1, -r * 0.86, r * 0.46, r * 0.19, p.look, p.expr, p.blink, t, {
    lid: '#a86fae',
    iris: '#2a1a3a',
  });
  const mouth = new Path2D();
  mouth.moveTo(-r * 0.46 + f * r * 0.1, -r * 0.38);
  mouth.quadraticCurveTo(f * r * 0.1, -r * 0.2, r * 0.46 + f * r * 0.1, -r * 0.38);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(mouth);
  blush(ctx, f * r * 0.1 - r * 0.62, -r * 0.4, r * 0.16);
  blush(ctx, f * r * 0.1 + r * 0.62, -r * 0.4, r * 0.16);
}

// ---- 弹簧小丑盒：盒盖一掀，弹出小丑脑袋 ----

const BOX_FRONT: Mat = { light: '#ffb8da', base: '#dc5d9c', dark: '#7c1f50', gloss: 0.8 };
const BOX_TOP: Mat = { light: '#ffd4e8', base: '#f08dbd', dark: '#a8387a', gloss: 0.6 };
const BOX_SIDE: Mat = { light: '#c95a90', base: '#98336a', dark: '#4c0f30', gloss: 0.4 };
const CLOWN: Mat = { light: '#ffffff', base: '#fdf1e6', dark: '#c7b3a2', gloss: 0.5 };

function drawJack(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const shake = p.windup > 0 ? Math.sin(t * 60) * r * 0.05 * p.windup : 0;
  const pop = recent(t, u.attackAt, 0.55);
  ctx.save();
  ctx.translate(shake, 0);

  const x0 = -r * 0.92;
  const x1 = r * 0.92;
  const y0 = -r * 0.98;
  const y1 = r * 0.5;
  const dx = -f * r * 0.3;
  const dy = -r * 0.32;

  // 侧面与顶面（透视出盒子的厚度）
  const sideX = f > 0 ? x0 : x1;
  const side = polyP([
    [sideX, y0],
    [sideX + dx, y0 + dy],
    [sideX + dx, y1 + dy],
    [sideX, y1],
  ]);
  flat(ctx, side, { x: sideX - r * 0.3, y: y0 + dy, w: r * 0.3, h: y1 - y0 }, BOX_SIDE, 2);

  // 弹出来的小丑（在盒盖后面）
  if (pop > 0) {
    const h = r * 1.3 * Math.sin(Math.min(1, pop * 1.3) * Math.PI * 0.5 + (1 - pop) * 0.3);
    const spring = new Path2D();
    for (let i = 0; i <= 8; i++) {
      const yy = y0 - (h * i) / 8;
      if (i === 0) spring.moveTo(i % 2 === 0 ? -r * 0.18 : r * 0.18, yy);
      else spring.lineTo(i % 2 === 0 ? -r * 0.18 : r * 0.18, yy);
    }
    line(ctx, spring, '#e6d4ad', 2.4, 1.2);
    clownHead(ctx, 0, y0 - h - r * 0.2, r * 0.42, f);
  }

  // 顶面（盒盖）：弹出时掀开
  const lidOpen = Math.max(pop, p.windup > 0.6 ? (Math.sin(t * 40) * 0.5 + 0.5) * 0.15 : 0);
  ctx.save();
  const hingeX = f > 0 ? x0 + dx : x1 + dx;
  ctx.translate(hingeX, y0 + dy);
  ctx.rotate(-f * lidOpen * 1.6);
  ctx.translate(-hingeX, -(y0 + dy));
  const top = polyP([
    [x0, y0],
    [x1, y0],
    [x1 + dx, y0 + dy],
    [x0 + dx, y0 + dy],
  ]);
  shade(
    ctx,
    top,
    { x: Math.min(x0, x0 + dx), y: y0 + dy, w: x1 - x0 + Math.abs(dx), h: -dy },
    BOX_TOP,
    2,
  );
  ctx.restore();

  // 正面
  const front = roundRectP(x0, y0, x1 - x0, y1 - y0, r * 0.1);
  shade(ctx, front, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, BOX_FRONT, 2.6);
  // 正面的星星花纹
  for (const [sx, sy, s] of [
    [-0.5, -0.55, 0.16],
    [0.42, -0.42, 0.13],
    [-0.08, 0.02, 0.18],
    [0.55, 0.16, 0.11],
    [-0.6, 0.22, 0.12],
  ] as const) {
    starPath(ctx, sx * r, sy * r, 5, s * r, s * r * 0.45, t * 0.5 + sx);
    ctx.fillStyle = 'rgba(255, 244, 220, 0.85)';
    ctx.fill();
  }
  // 盒子上的一张怪脸
  eyes(ctx, f * r * 0.1, -r * 0.4, r * 0.3, r * 0.17, p.look, p.expr, p.blink, t, {
    lid: '#dc5d9c',
  });

  // 侧面的摇柄
  ctx.save();
  ctx.translate(f * r * 0.96, -r * 0.2);
  ctx.rotate(t * (p.windup > 0 ? 16 : 2) + u.id);
  const crank = new Path2D();
  crank.moveTo(0, 0);
  crank.lineTo(r * 0.36, 0);
  crank.lineTo(r * 0.36, r * 0.26);
  line(ctx, crank, '#e4ae47', 2.8, 1.3);
  shade(
    ctx,
    circleP(r * 0.36, r * 0.3, r * 0.09),
    { x: r * 0.27, y: r * 0.21, w: r * 0.18, h: r * 0.18 },
    { light: '#ffb0b0', base: '#e63946', dark: '#85121d', gloss: 0.9 },
    1.2,
  );
  ctx.restore();
  ctx.restore();
}

function clownHead(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, f: number) {
  // 帽子
  const hat = polyP([
    [x - s * 0.7, y - s * 0.55],
    [x + s * 0.7, y - s * 0.55],
    [x - f * s * 0.2, y - s * 1.6],
  ]);
  shade(
    ctx,
    hat,
    { x: x - s * 0.7, y: y - s * 1.6, w: s * 1.4, h: s * 1.05 },
    { light: '#bdf3ff', base: '#4cc3e6', dark: '#1d6d8a', gloss: 0.5 },
    1.6,
  );
  shade(
    ctx,
    circleP(x - f * s * 0.2, y - s * 1.62, s * 0.18),
    { x: x - s * 0.4, y: y - s * 1.8, w: s * 0.36, h: s * 0.36 },
    { light: '#fff6b0', base: '#ffd23c', dark: '#b37a0c', gloss: 0.6 },
    1.2,
  );
  shade(ctx, circleP(x, y, s), { x: x - s, y: y - s, w: s * 2, h: s * 2 }, CLOWN, 1.8);
  // 笑脸
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(x + side * s * 0.35, y - s * 0.2, s * 0.12, 0, TAU);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
  }
  const grin = new Path2D();
  grin.arc(x, y + s * 0.1, s * 0.5, 0.2, Math.PI - 0.2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#d6284e';
  ctx.stroke(grin);
  shade(
    ctx,
    circleP(x + f * s * 0.05, y + s * 0.08, s * 0.2),
    { x: x - s * 0.2, y: y - s * 0.12, w: s * 0.4, h: s * 0.4 },
    { light: '#ffb0b0', base: '#f0233f', dark: '#8a0a1c', gloss: 1 },
    1.2,
  );
}

// ---- 发条大王：首领。紫色王袍、肚子上的玻璃窗里齿轮在转 ----

const ROYAL: Mat = { light: '#d2b2f6', base: '#8a5cc2', dark: '#2e145a', gloss: 0.9 };
const ROYAL_ANGRY: Mat = { light: '#f0b4ec', base: '#a64aa4', dark: '#3a0c3c', gloss: 0.9 };
const VELVET: Mat = { light: '#ff8a8a', base: '#c42a33', dark: '#4f070e', gloss: 0.25 };
const ERMINE: Mat = { light: '#ffffff', base: '#f3eee4', dark: '#b3a894', gloss: 0.1 };
const GEM_CYAN: Mat = { light: '#e8feff', base: '#5fe0f2', dark: '#136f86', gloss: 1 };
const GEM_PINK: Mat = { light: '#ffe0f0', base: '#ff5fb0', dark: '#8c0f55', gloss: 1 };

function drawKing(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const angry = u.phase >= 3;
  const charging = u.state === 'charge' || (u.state === 'windup' && u.pending === 'charge');
  const cy = -r * 0.36;

  // 披风
  const wave = Math.sin(t * (charging ? 12 : 2.5)) * r * 0.06;
  const cape = new Path2D();
  cape.moveTo(-r * 0.78, cy - r * 0.62);
  cape.quadraticCurveTo(-r * 1.25 - wave, cy + r * 0.3, -r * 1.12, r * 0.55);
  cape.quadraticCurveTo(0, r * 0.78 + wave, r * 1.12, r * 0.55);
  cape.quadraticCurveTo(r * 1.25 + wave, cy + r * 0.3, r * 0.78, cy - r * 0.62);
  cape.closePath();
  shade(ctx, cape, { x: -r * 1.25, y: cy - r * 0.62, w: r * 2.5, h: r * 1.6 }, VELVET, 2.6);
  const trim = new Path2D();
  trim.moveTo(-r * 1.12, r * 0.52);
  trim.quadraticCurveTo(0, r * 0.76 + wave, r * 1.12, r * 0.52);
  line(ctx, trim, ERMINE.base, r * 0.14, 1.6);
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(
      i * r * 0.3,
      r * 0.6 + (1 - Math.abs(i) / 3) * r * 0.1,
      r * 0.035,
      r * 0.06,
      0,
      0,
      TAU,
    );
    ctx.fillStyle = OUTLINE;
    ctx.fill();
  }

  // 背后的大发条钥匙
  ctx.save();
  ctx.translate(-f * r * 0.9, cy - r * 0.05);
  ctx.rotate(-f * Math.PI * 0.5);
  windKey(ctx, 0, 0, r * 0.7, t * (charging ? 14 : 2.2));
  ctx.restore();

  // 身体
  const body = circleP(0, cy, r);
  const box = { x: -r, y: cy - r, w: r * 2, h: r * 2 };
  shade(ctx, body, box, angry ? ROYAL_ANGRY : ROYAL, 3.2);
  // 金腰带（限定在身体里）
  ctx.save();
  ctx.clip(body);
  const belt = roundRectP(-r * 1.1, cy + r * 0.18, r * 2.2, r * 0.24, 2);
  shade(ctx, belt, { x: -r, y: cy + r * 0.18, w: r * 2, h: r * 0.24 }, GOLD, 1.8);
  ctx.restore();
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(body);

  // 肚子上的玻璃窗：里面的齿轮在转
  const wx = f * r * 0.34;
  const wy = cy + r * 0.44;
  const wr = r * 0.3;
  const win = circleP(wx, wy, wr);
  ctx.fillStyle = '#2a1640';
  ctx.fill(win);
  ctx.save();
  ctx.clip(win);
  const speed = charging ? 6 : 1.4;
  gear(ctx, wx - wr * 0.3, wy - wr * 0.1, wr * 0.62, 8, t * speed, GOLD, 1.2);
  gear(ctx, wx + wr * 0.5, wy + wr * 0.35, wr * 0.42, 6, -t * speed * 1.45 + 0.3, BRASS, 1.2);
  const glass = ctx.createLinearGradient(wx - wr, wy - wr, wx + wr, wy + wr);
  glass.addColorStop(0, 'rgba(255,255,255,0.45)');
  glass.addColorStop(0.4, 'rgba(255,255,255,0.05)');
  glass.addColorStop(1, 'rgba(180,220,255,0.15)');
  ctx.fillStyle = glass;
  ctx.fill(win);
  ctx.restore();
  const frame = new Path2D();
  frame.arc(wx, wy, wr, 0, TAU);
  line(ctx, frame, '#f2c44f', r * 0.07, 1.4);

  // 肩上的齿轮
  gear(ctx, -f * r * 0.86, cy - r * 0.52, r * 0.24, 8, t * 1.2, GOLD, 1.6);

  // 脸
  const fx = f * r * 0.12;
  eyes(ctx, fx, cy - r * 0.34, r * 0.3, r * 0.17, p.look, p.expr, p.blink, t, {
    lid: angry ? '#a64aa4' : '#8a5cc2',
    iris: angry ? '#ff4d4d' : '#3a1d5a',
  });
  if (angry && p.expr !== 'hurt' && p.expr !== 'dizzy') {
    for (const side of [-1, 1] as const)
      glowDot(ctx, fx + side * r * 0.3, cy - r * 0.32, r * 0.3, 'rgba(255, 80, 80, 1)', 0.7);
  }
  // 翘八字胡
  const stache = new Path2D();
  const my = cy - r * 0.06;
  for (const side of [-1, 1] as const) {
    stache.moveTo(fx, my);
    stache.bezierCurveTo(
      fx + side * r * 0.2,
      my + r * 0.14,
      fx + side * r * 0.42,
      my + r * 0.08,
      fx + side * r * 0.5,
      my - r * 0.1,
    );
    stache.bezierCurveTo(
      fx + side * r * 0.52,
      my - r * 0.02,
      fx + side * r * 0.44,
      my + r * 0.02,
      fx + side * r * 0.4,
      my - r * 0.02,
    );
  }
  line(ctx, stache, '#3a2440', r * 0.07, 1.4);

  // 王冠
  ctx.save();
  ctx.translate(0, cy - r * 0.96);
  ctx.rotate(f * 0.06 + Math.sin(t * 2) * 0.02);
  const crown = new Path2D();
  const cw = r * 0.62;
  crown.moveTo(-cw, r * 0.12);
  crown.lineTo(-cw * 1.05, -r * 0.3);
  crown.lineTo(-cw * 0.5, -r * 0.08);
  crown.lineTo(0, -r * 0.42);
  crown.lineTo(cw * 0.5, -r * 0.08);
  crown.lineTo(cw * 1.05, -r * 0.3);
  crown.lineTo(cw, r * 0.12);
  crown.closePath();
  shade(ctx, crown, { x: -cw * 1.05, y: -r * 0.42, w: cw * 2.1, h: r * 0.54 }, GOLD, 2.4);
  const band = roundRectP(-cw * 1.04, r * 0.04, cw * 2.08, r * 0.16, r * 0.06);
  shade(ctx, band, { x: -cw, y: r * 0.04, w: cw * 2, h: r * 0.16 }, ERMINE, 1.8);
  for (const [gx, m] of [
    [-cw * 0.55, GEM_CYAN],
    [0, GEM_PINK],
    [cw * 0.55, GEM_CYAN],
  ] as const) {
    const gy = gx === 0 ? -r * 0.12 : -r * 0.02;
    const gs = gx === 0 ? r * 0.09 : r * 0.07;
    shade(ctx, circleP(gx, gy, gs), { x: gx - gs, y: gy - gs, w: gs * 2, h: gs * 2 }, m, 1.2);
  }
  for (const k of [-1.05, 0, 1.05]) {
    const tipY = k === 0 ? -r * 0.42 : -r * 0.3;
    shade(
      ctx,
      circleP(cw * k, tipY, r * 0.05),
      { x: cw * k - r * 0.05, y: tipY - r * 0.05, w: r * 0.1, h: r * 0.1 },
      GOLD,
      1,
    );
  }
  ctx.restore();

  // 暴走时头顶冒蒸汽
  if (angry) {
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.8 + i / 4) % 1;
      const side = i % 2 === 0 ? -1 : 1;
      const sx = side * (r * 0.7 + k * r * 0.5);
      const sy = cy - r * 0.8 - k * r * 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, r * (0.1 + k * 0.18), 0, TAU);
      ctx.fillStyle = `rgba(255, 245, 250, ${0.45 * (1 - k)})`;
      ctx.fill();
    }
  }
  spec(ctx, -r * 0.4, cy - r * 0.62, r * 0.22, r * 0.12, 0.6);
}
