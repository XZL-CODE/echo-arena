// 我方三名队员的造型：铁皮卫士阿铁、弹弓雀小弹、铃铛精叮当。
// 坐标以单位位置为原点（脚下），r 是碰撞半径；整体已按 UNIT_DRAW_SCALE 放大。
import type { Unit } from '../core/sim/entities.js';
import { ALLY_SHIELD, BRASS, BRASS_DIM, fist, GOLD, note, shieldArc, windKey } from './parts.js';
import {
  blush,
  circleP,
  ellipseP,
  eyes,
  flat,
  glowDot,
  line,
  OUTLINE,
  polyP,
  recent,
  roundRectP,
  shade,
  type Mat,
} from './toon.js';
import type { Pose, UnitVisual } from './units.js';

const TAU = Math.PI * 2;

export function drawAlly(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  p: Pose,
): void {
  if (u.kind === 'guard') drawGuard(ctx, u, v, r, p);
  else if (u.kind === 'slinger') drawSlinger(ctx, u, r, p);
  else drawBell(ctx, u, v, r, p);
}

// ---- 阿铁：铁皮罐头骑士，深色面罩里一对发光的眼睛 ----

const TIN: Mat = { light: '#f7fbff', base: '#bccddc', dark: '#566d83', gloss: 0.95, metal: true };
const TIN_RIM: Mat = {
  light: '#ffffff',
  base: '#d8e4ee',
  dark: '#7990a5',
  gloss: 0.6,
  metal: true,
};
const TIN_DARK: Mat = {
  light: '#b9c8d6',
  base: '#7d93a7',
  dark: '#3f5164',
  gloss: 0.5,
  metal: true,
};
const VISOR: Mat = { light: '#5a78a6', base: '#26344f', dark: '#0d131f', gloss: 0.9 };
const RUBBER: Mat = { light: '#737889', base: '#434758', dark: '#1c1e28', gloss: 0.25 };
const PLUME: Mat = { light: '#ffa593', base: '#e5503d', dark: '#861c18', gloss: 0.2 };
const RUBY: Mat = { light: '#ffd0d0', base: '#ff4f5e', dark: '#8c0f24', gloss: 1 };

function drawGuard(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  p: Pose,
): void {
  const f = p.flip;
  const t = p.t;
  if (v.booster) booster(ctx, -f * r * 1.0, -r * 0.42, r, p);

  // 后手
  const sway = p.moving ? Math.sin(p.step) * r * 0.08 : 0;
  fist(ctx, -f * r * 1.0, -r * 0.22 + sway, r * 0.27, BRASS_DIM, u.facing + Math.PI, 2);

  // 两只小脚，走路时交替抬起
  for (const side of [-1, 1] as const) {
    const phase = p.step + (side > 0 ? 0 : Math.PI);
    const lift = p.moving ? Math.max(0, Math.sin(phase)) * r * 0.14 : 0;
    const fx = side * r * 0.46 + f * r * 0.06;
    const foot = roundRectP(fx - r * 0.3, r * 0.4 - lift, r * 0.6, r * 0.28, r * 0.13);
    flat(ctx, foot, { x: fx - r * 0.3, y: r * 0.4 - lift, w: r * 0.6, h: r * 0.28 }, RUBBER, 2);
  }

  // 罐身
  const bx = -r * 0.9;
  const by = -r * 1.16;
  const bw = r * 1.8;
  const bh = r * 1.7;
  const body = roundRectP(bx, by, bw, bh, r * 0.42);
  shade(ctx, body, { x: bx, y: by, w: bw, h: bh }, TIN, 2.7);
  // 罐身上的两道压纹
  for (const k of [0.66, 0.86]) {
    const yy = by + bh * k;
    ctx.beginPath();
    ctx.moveTo(bx + 3, yy);
    ctx.lineTo(bx + bw - 3, yy);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(38, 52, 68, 0.45)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx + 4, yy + 1.6);
    ctx.lineTo(bx + bw - 4, yy + 1.6);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.stroke();
  }
  // 罐口
  const lid = ellipseP(0, by + r * 0.12, r * 0.82, r * 0.19);
  shade(ctx, lid, { x: -r * 0.82, y: by - r * 0.07, w: r * 1.64, h: r * 0.38 }, TIN_RIM, 1.8);

  // 腰带与铆钉
  const beltY = -r * 0.04;
  const belt = roundRectP(bx - 1.5, beltY, bw + 3, r * 0.3, r * 0.1);
  shade(ctx, belt, { x: bx, y: beltY, w: bw, h: r * 0.3 }, v.armor ? GOLD : TIN_DARK, 2);
  for (const k of [-0.6, -0.2, 0.2, 0.6]) {
    const rx = k * r;
    const ry = beltY + r * 0.15;
    ctx.beginPath();
    ctx.arc(rx, ry, r * 0.07, 0, TAU);
    ctx.fillStyle = v.armor ? '#fff1b8' : '#e9f1f7';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(36, 26, 31, 0.6)';
    ctx.stroke();
  }

  // 面罩与发光的眼睛
  const vx = -r * 0.66 + f * r * 0.08;
  const vy = -r * 0.9;
  const vw = r * 1.32;
  const vh = r * 0.52;
  const visor = roundRectP(vx, vy, vw, vh, r * 0.25);
  shade(ctx, visor, { x: vx, y: vy, w: vw, h: vh }, VISOR, 2.2);
  visorEyes(ctx, f * r * 0.14, vy + vh * 0.52, r * 0.27, r * 0.15, p);

  if (v.armor) armor(ctx, r, f, t);
  else windKey(ctx, -f * r * 0.1, by + r * 0.1, r * 0.62, t * 2.2 + u.id);

  // 前手：蓄力时收回、握拳发光，出拳时打出去
  const w = p.windup;
  const reach = r * (1.02 + p.attack * 0.62 - w * 0.3);
  const fx = Math.cos(u.facing) * reach;
  const fy = Math.sin(u.facing) * reach * 0.55 - r * 0.2 - w * r * 0.12;
  if (w > 0) glowDot(ctx, fx, fy, r * 0.8, 'rgba(255, 210, 110, 0.9)', w * 0.7);
  fist(ctx, fx, fy, r * 0.36, BRASS, u.facing, 2.3);

  if (v.shield) {
    shieldArc(ctx, r, u.facing, (62 * Math.PI) / 180, recent(t, u.blockAt, 0.3), t, ALLY_SHIELD);
  }
}

/** 面罩里的眼睛：两块发光的青色灯片，表情靠形状变化。 */
function visorEyes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  gap: number,
  h: number,
  p: Pose,
): void {
  const lookX = p.look.x * h * 0.35;
  for (const side of [-1, 1] as const) {
    const ex = cx + side * gap + lookX;
    glowDot(ctx, ex, cy, h * 2.8, 'rgba(110, 236, 255, 0.95)', 0.5);
    const path = new Path2D();
    if (p.expr === 'hurt') {
      path.moveTo(ex - side * h * 0.6, cy - h * 0.7);
      path.lineTo(ex + side * h * 0.45, cy);
      path.lineTo(ex - side * h * 0.6, cy + h * 0.7);
      line(ctx, path, '#c9fbff', h * 0.42, 0);
      continue;
    }
    if (p.expr === 'dizzy') {
      for (let i = 0; i <= 14; i++) {
        const a = p.t * 9 * side + i * 0.7;
        const rr = h * 0.85 * (i / 14);
        if (i === 0) path.moveTo(ex + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else path.lineTo(ex + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      line(ctx, path, '#c9fbff', h * 0.3, 0);
      continue;
    }
    if (p.blink) {
      path.moveTo(ex - h * 0.55, cy + h * 0.2);
      path.lineTo(ex + h * 0.55, cy + h * 0.2);
      line(ctx, path, '#c9fbff', h * 0.34, 0);
      continue;
    }
    const w = h * 0.62;
    if (p.expr === 'focus') {
      // 眯起来的眼睛：上沿向内压低
      path.moveTo(ex + side * w, cy - h * 0.55);
      path.lineTo(ex - side * w, cy - h * 0.05);
      path.lineTo(ex - side * w, cy + h * 0.72);
      path.lineTo(ex + side * w, cy + h * 0.72);
      path.closePath();
    } else {
      const eye = roundRectP(ex - w, cy - h, w * 2, h * 2, w);
      path.addPath(eye);
    }
    ctx.fillStyle = '#c9fbff';
    ctx.fill(path);
    ctx.lineJoin = 'round';
    ctx.lineWidth = h * 0.22;
    ctx.strokeStyle = '#6ee6ff';
    ctx.stroke(path);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(ex - w * 0.3, cy - h * 0.35, h * 0.2, 0, TAU);
    ctx.fill();
  }
}

/** 厚甲：金色胸甲、护肩与头盔上的红羽饰。 */
function armor(ctx: CanvasRenderingContext2D, r: number, f: number, t: number): void {
  const plate = new Path2D();
  plate.moveTo(-r * 0.58, -r * 0.36);
  plate.lineTo(r * 0.58, -r * 0.36);
  plate.lineTo(r * 0.54, r * 0.02);
  plate.quadraticCurveTo(0, r * 0.38, -r * 0.54, r * 0.02);
  plate.closePath();
  shade(ctx, plate, { x: -r * 0.58, y: -r * 0.36, w: r * 1.16, h: r * 0.7 }, GOLD, 2.2);
  shade(
    ctx,
    circleP(0, -r * 0.1, r * 0.13),
    { x: -r * 0.13, y: -r * 0.23, w: r * 0.26, h: r * 0.26 },
    RUBY,
    1.4,
  );
  for (const side of [-1, 1] as const) {
    const px = side * r * 0.84;
    const pad = ellipseP(px, -r * 0.92, r * 0.34, r * 0.24, side * 0.25);
    shade(ctx, pad, { x: px - r * 0.34, y: -r * 1.16, w: r * 0.68, h: r * 0.48 }, GOLD, 2);
  }
  // 羽饰随呼吸轻轻摆动
  ctx.save();
  ctx.translate(0, -r * 1.12);
  ctx.rotate(Math.sin(t * 3) * 0.07 - f * 0.1);
  const plume = new Path2D();
  plume.moveTo(-r * 0.12, 0);
  plume.bezierCurveTo(-f * r * 0.1, -r * 0.8, -f * r * 0.9, -r * 0.95, -f * r * 1.05, -r * 0.45);
  plume.bezierCurveTo(-f * r * 0.6, -r * 0.6, -f * r * 0.1, -r * 0.4, r * 0.14, 0);
  plume.closePath();
  shade(ctx, plume, { x: -r * 1.05, y: -r * 0.95, w: r * 1.2, h: r * 0.95 }, PLUME, 2);
  ctx.beginPath();
  ctx.moveTo(-f * r * 0.1, -r * 0.2);
  ctx.quadraticCurveTo(-f * r * 0.4, -r * 0.72, -f * r * 0.9, -r * 0.62);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255, 220, 210, 0.7)';
  ctx.stroke();
  ctx.restore();
  // 头盔座
  const cap = roundRectP(-r * 0.2, -r * 1.24, r * 0.4, r * 0.16, r * 0.06);
  shade(ctx, cap, { x: -r * 0.2, y: -r * 1.24, w: r * 0.4, h: r * 0.16 }, GOLD, 1.6);
}

/** 冲锋：背后的粗弹簧，冲刺时发烫发亮。 */
function booster(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose): void {
  ctx.save();
  ctx.translate(x, y);
  const coil = new Path2D();
  const turns = 5;
  for (let i = 0; i <= turns * 2; i++) {
    const yy = -r * 0.5 + (i / (turns * 2)) * r;
    const xx = (i % 2 === 0 ? -1 : 1) * r * 0.2;
    if (i === 0) coil.moveTo(xx, yy);
    else coil.lineTo(xx, yy);
  }
  if (p.dash) glowDot(ctx, 0, 0, r * 1.1, 'rgba(255, 170, 80, 0.95)', 0.9);
  line(ctx, coil, p.dash ? '#ffcf6b' : '#e3ae47', 3.4, 1.5);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(255, 250, 220, 0.8)';
  ctx.stroke(coil);
  ctx.restore();
}

// ---- 小弹：圆滚滚的弹弓雀，额头上推着飞行护目镜 ----

const FEATHER: Mat = { light: '#fff9cc', base: '#ffd23c', dark: '#d9850f', gloss: 0.9 };
const BELLY: Mat = { light: '#fffef5', base: '#fff0c2', dark: '#e6c07a', gloss: 0.3 };
const WING: Mat = { light: '#ffe68c', base: '#f6b42a', dark: '#b3650c', gloss: 0.5 };
const BEAK: Mat = { light: '#ffd3a0', base: '#ff8f3d', dark: '#bd4d17', gloss: 0.75 };
const SCARF: Mat = { light: '#ffa6d2', base: '#ff5a9e', dark: '#a91a5c', gloss: 0.3 };
const GLASS: Mat = { light: '#f2fdff', base: '#88dcf2', dark: '#27708f', gloss: 1 };

function drawSlinger(ctx: CanvasRenderingContext2D, u: Unit, r: number, p: Pose): void {
  const f = p.flip;
  const t = p.t;
  const cy = -r * 0.38;
  const flap = Math.sin(t * (p.moving ? 24 : 5) + u.id) * (p.moving ? 0.6 : 0.2) + p.attack * 0.35;

  // 尾羽（朝身后上方翘起）
  for (const [a, len] of [
    [0.15, 0.62],
    [0.5, 0.72],
    [0.85, 0.58],
  ] as const) {
    const ang = f > 0 ? Math.PI + a : -a;
    const wob = Math.sin(t * 7 + a * 5) * 0.05;
    const ox = -f * r * 0.7;
    const oy = cy + r * 0.32;
    const tx = ox + Math.cos(ang + wob) * r * len * 0.5;
    const ty = oy + Math.sin(ang + wob) * r * len * 0.5;
    const tail = ellipseP(tx, ty, r * len * 0.52, r * 0.15, ang + wob);
    flat(ctx, tail, { x: tx - r * 0.3, y: ty - r * 0.3, w: r * 0.6, h: r * 0.6 }, WING, 1.8);
  }

  // 围巾在身后飘
  scarfTail(ctx, -f * r * 0.62, cy + r * 0.42, r, f, t, p.moving);

  // 后面的翅膀
  wing(ctx, -f * r * 0.86, cy + r * 0.06, r, -f, flap);

  // 身体
  shade(ctx, circleP(0, cy, r), { x: -r, y: cy - r, w: r * 2, h: r * 2 }, FEATHER, 2.5);
  const belly = ellipseP(f * r * 0.2, cy + r * 0.34, r * 0.6, r * 0.5);
  shade(ctx, belly, { x: f * r * 0.2 - r * 0.6, y: cy - r * 0.16, w: r * 1.2, h: r }, BELLY, 0);

  // 围巾
  const band = new Path2D();
  band.moveTo(-r * 0.86, cy + r * 0.34);
  band.quadraticCurveTo(0, cy + r * 0.78, r * 0.86, cy + r * 0.34);
  band.lineTo(r * 0.8, cy + r * 0.56);
  band.quadraticCurveTo(0, cy + r * 1.0, -r * 0.8, cy + r * 0.56);
  band.closePath();
  shade(ctx, band, { x: -r * 0.86, y: cy + r * 0.34, w: r * 1.72, h: r * 0.66 }, SCARF, 2);

  // 眼睛、腮红、嘴
  eyes(ctx, f * r * 0.18, cy - r * 0.16, r * 0.34, r * 0.25, p.look, p.expr, p.blink, t, {
    lid: '#ffd23c',
    iris: '#3a2a55',
  });
  blush(ctx, f * r * 0.62, cy + r * 0.14, r * 0.18);
  blush(ctx, -f * r * 0.2, cy + r * 0.14, r * 0.15);
  const open = p.attack * 0.45 + (p.expr === 'hurt' ? 0.3 : 0);
  beak(ctx, f * r * 0.62, cy + r * 0.04, r, f, open);

  // 额头上的护目镜
  const strap = new Path2D();
  strap.ellipse(0, cy - r * 0.45, r * 0.98, r * 0.4, 0, Math.PI * 1.08, Math.PI * 1.92);
  line(ctx, strap, '#7a4a2c', r * 0.16, 1.4);
  for (const side of [-1, 1] as const) {
    const gx = f * r * 0.12 + side * r * 0.3;
    const gy = cy - r * 0.74;
    shade(
      ctx,
      circleP(gx, gy, r * 0.22),
      { x: gx - r * 0.22, y: gy - r * 0.22, w: r * 0.44, h: r * 0.44 },
      BRASS,
      1.8,
    );
    shade(
      ctx,
      circleP(gx, gy, r * 0.14),
      { x: gx - r * 0.14, y: gy - r * 0.14, w: r * 0.28, h: r * 0.28 },
      GLASS,
      1,
    );
  }
  // 呆毛
  const tuft = new Path2D();
  tuft.moveTo(-r * 0.06, cy - r * 0.96);
  tuft.quadraticCurveTo(-r * 0.4, cy - r * 1.55, r * 0.05, cy - r * 1.45);
  tuft.moveTo(r * 0.08, cy - r * 0.96);
  tuft.quadraticCurveTo(r * 0.35, cy - r * 1.6, r * 0.62, cy - r * 1.25);
  line(ctx, tuft, '#ffcc33', 2.2, 1.3);

  // 前面的翅膀与弹弓
  wing(ctx, f * r * 0.86, cy + r * 0.12, r, f, flap * 0.6);
  slingshot(ctx, u, r, cy, p);
}

function wing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  side: number,
  flap: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(side * (0.45 + flap));
  const path = new Path2D();
  path.moveTo(0, -r * 0.42);
  path.quadraticCurveTo(side * r * 0.5, -r * 0.2, side * r * 0.3, r * 0.42);
  path.quadraticCurveTo(side * r * 0.05, r * 0.2, 0, -r * 0.42);
  path.closePath();
  shade(ctx, path, { x: -r * 0.3, y: -r * 0.42, w: r * 0.6, h: r * 0.84 }, WING, 1.9);
  ctx.restore();
}

function beak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  f: number,
  open: number,
) {
  const upper = polyP([
    [x - f * r * 0.06, y - r * 0.16],
    [x + f * r * 0.46, y + r * 0.02],
    [x - f * r * 0.06, y + r * 0.12],
  ]);
  ctx.save();
  ctx.translate(x - f * r * 0.04, y + r * 0.08);
  ctx.rotate(f * open * 0.5);
  ctx.translate(-(x - f * r * 0.04), -(y + r * 0.08));
  const lower = polyP([
    [x - f * r * 0.04, y + r * 0.06],
    [x + f * r * 0.34, y + r * 0.12],
    [x - f * r * 0.02, y + r * 0.26],
  ]);
  shade(ctx, lower, { x: x - r * 0.1, y, w: r * 0.44, h: r * 0.26 }, BEAK, 1.7);
  ctx.restore();
  shade(ctx, upper, { x: x - r * 0.1, y: y - r * 0.16, w: r * 0.56, h: r * 0.3 }, BEAK, 1.8);
}

function scarfTail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  f: number,
  t: number,
  moving: boolean,
) {
  const len = r * (moving ? 1.25 : 0.95);
  const amp = r * (moving ? 0.16 : 0.08);
  const top: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const px = x - f * len * k;
    const wave = Math.sin(t * (moving ? 14 : 5) - k * 5) * amp * k;
    const lift = -k * r * (moving ? 0.1 : 0.35);
    const half = r * 0.13 * (1 - k * 0.35);
    top.push([px, y + lift + wave - half]);
    bottom.push([px, y + lift + wave + half]);
  }
  const path = polyP([...top, ...bottom.reverse()]);
  flat(ctx, path, { x: x - len, y: y - r * 0.4, w: len, h: r * 0.6 }, SCARF, 1.8);
}

function slingshot(ctx: CanvasRenderingContext2D, u: Unit, r: number, cy: number, p: Pose) {
  const pull = p.windup;
  const snap = recent(p.t, u.attackAt, 0.14);
  ctx.save();
  ctx.translate(0, cy + r * 0.12);
  ctx.rotate(u.facing);
  ctx.translate(r * 1.06, 0);
  const fork = new Path2D();
  fork.moveTo(-r * 0.38, 0);
  fork.lineTo(0, 0);
  fork.lineTo(r * 0.3, -r * 0.34);
  fork.moveTo(0, 0);
  fork.lineTo(r * 0.3, r * 0.34);
  line(ctx, fork, '#a86d3a', 3.6, 1.5);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(255, 226, 180, 0.7)';
  ctx.stroke(fork);
  const back = -r * 0.18 - pull * r * 0.62 + snap * r * 0.3;
  const band = new Path2D();
  band.moveTo(r * 0.3, -r * 0.34);
  band.lineTo(back, 0);
  band.lineTo(r * 0.3, r * 0.34);
  line(ctx, band, '#ff5fa2', 1.8, 0.8);
  if (pull > 0) {
    glowDot(ctx, back, 0, r * 0.75, 'rgba(255, 240, 170, 1)', pull * 0.8);
    ctx.beginPath();
    ctx.arc(back, 0, r * 0.2, 0, TAU);
    ctx.fillStyle = '#fff6cc';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  ctx.restore();
}

// ---- 叮当：会摇铃治疗的铜铃精 ----

const BELL: Mat = { light: '#fff8d2', base: '#f3c24a', dark: '#8f5a0c', gloss: 1, metal: true };
const BELL_LIP: Mat = {
  light: '#ffe18c',
  base: '#d69a2a',
  dark: '#6f440b',
  gloss: 0.8,
  metal: true,
};
const CLAPPER: Mat = { light: '#d99a66', base: '#8a5a35', dark: '#3f2410', gloss: 0.7 };
const RIBBON: Mat = { light: '#ffb6a2', base: '#ee6a4e', dark: '#962a18', gloss: 0.4 };
const HEART: Mat = { light: '#ffd6e3', base: '#ff7aa3', dark: '#b3255a', gloss: 0.95 };
const MAGNET: Mat = { light: '#ffa0a0', base: '#e63946', dark: '#85121d', gloss: 0.8 };

function drawBell(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual, r: number, p: Pose) {
  const t = p.t;
  const ring = recent(t, u.attackAt, 0.7);
  const heal = Math.max(p.windup, recent(t, u.attackAt, 0.55));
  if (heal > 0) glowDot(ctx, 0, -r * 0.5, r * 2.2, 'rgba(255, 186, 214, 0.95)', heal * 0.6);

  const swing =
    Math.sin(t * 18) * ring * 0.3 +
    Math.sin(t * 2 + u.id) * 0.05 +
    Math.sin(t * 34) * p.windup * 0.05;
  ctx.save();
  ctx.translate(0, -r * 1.46);
  ctx.rotate(swing);
  ctx.translate(0, r * 1.46);

  // 铃身
  const body = new Path2D();
  body.moveTo(-r * 0.96, r * 0.34);
  body.quadraticCurveTo(-r * 0.86, -r * 0.2, -r * 0.62, -r * 0.9);
  body.quadraticCurveTo(-r * 0.42, -r * 1.42, 0, -r * 1.42);
  body.quadraticCurveTo(r * 0.42, -r * 1.42, r * 0.62, -r * 0.9);
  body.quadraticCurveTo(r * 0.86, -r * 0.2, r * 0.96, r * 0.34);
  body.quadraticCurveTo(0, r * 0.52, -r * 0.96, r * 0.34);
  body.closePath();
  shade(ctx, body, { x: -r * 0.96, y: -r * 1.42, w: r * 1.92, h: r * 1.9 }, BELL, 2.5);
  // 铃身上的一道饰纹
  const stripe = new Path2D();
  stripe.moveTo(-r * 0.86, r * 0.02);
  stripe.quadraticCurveTo(0, r * 0.2, r * 0.86, r * 0.02);
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = 'rgba(150, 92, 20, 0.55)';
  ctx.stroke(stripe);
  ctx.lineWidth = r * 0.04;
  ctx.strokeStyle = 'rgba(255, 244, 200, 0.7)';
  ctx.translate(0, -r * 0.05);
  ctx.stroke(stripe);
  ctx.translate(0, r * 0.05);

  // 铃口与铃舌
  const lip = ellipseP(0, r * 0.36, r * 1.0, r * 0.25);
  shade(ctx, lip, { x: -r, y: r * 0.11, w: r * 2, h: r * 0.5 }, BELL_LIP, 2.2);
  const mouth = ellipseP(0, r * 0.4, r * 0.8, r * 0.14);
  ctx.fillStyle = '#3a220c';
  ctx.fill(mouth);
  const cx = Math.sin(t * 18) * ring * r * 0.32;
  shade(
    ctx,
    circleP(cx, r * 0.56, r * 0.2),
    { x: cx - r * 0.2, y: r * 0.36, w: r * 0.4, h: r * 0.4 },
    CLAPPER,
    1.8,
  );

  // 脸
  eyes(ctx, 0, -r * 0.5, r * 0.3, r * 0.21, p.look, p.expr, p.blink, t, {
    lid: '#f3c24a',
    iris: '#4a2a18',
  });
  blush(ctx, -r * 0.52, -r * 0.2, r * 0.17);
  blush(ctx, r * 0.52, -r * 0.2, r * 0.17);
  const mouthPath = new Path2D();
  if (ring > 0.2 || p.windup > 0) mouthPath.ellipse(0, -r * 0.12, r * 0.11, r * 0.13, 0, 0, TAU);
  else mouthPath.arc(0, -r * 0.2, r * 0.13, 0.25, Math.PI - 0.25);
  if (ring > 0.2 || p.windup > 0) {
    ctx.fillStyle = '#7a2a2a';
    ctx.fill(mouthPath);
  }
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(mouthPath);

  // 顶上的挂环与装饰
  const loop = new Path2D();
  loop.arc(0, -r * 1.5, r * 0.16, 0, TAU);
  line(ctx, loop, '#e4ae47', 2.6, 1.4);
  ctx.translate(0, -r * 1.72);
  if (v.bellCharm === 'magnet') magnet(ctx, r);
  else if (v.bellCharm === 'heart') heart(ctx, r);
  else bow(ctx, r);
  ctx.restore();

  // 摇铃时飘出音符
  if (ring > 0) {
    ctx.save();
    ctx.globalAlpha *= Math.min(1, ring * 1.6);
    const rise = (1 - ring) * r * 1.2;
    note(ctx, -r * 1.25, -r * 1.1 - rise, r * 0.32, '#ffd1e0');
    note(ctx, r * 1.2, -r * 1.35 - rise * 1.2, r * 0.26, '#fff1b8');
    ctx.restore();
  }
}

function bow(ctx: CanvasRenderingContext2D, r: number) {
  for (const side of [-1, 1] as const) {
    const loop = new Path2D();
    loop.moveTo(0, 0);
    loop.quadraticCurveTo(side * r * 0.62, -r * 0.5, side * r * 0.56, r * 0.14);
    loop.closePath();
    shade(
      ctx,
      loop,
      { x: side > 0 ? 0 : -r * 0.62, y: -r * 0.5, w: r * 0.62, h: r * 0.64 },
      RIBBON,
      1.6,
    );
  }
  shade(
    ctx,
    circleP(0, 0, r * 0.14),
    { x: -r * 0.14, y: -r * 0.14, w: r * 0.28, h: r * 0.28 },
    RIBBON,
    1.4,
  );
}

function heart(ctx: CanvasRenderingContext2D, r: number) {
  const s = r * 0.5;
  const path = new Path2D();
  path.moveTo(0, s * 0.5);
  path.bezierCurveTo(-s * 1.1, -s * 0.3, -s * 0.5, -s * 1.1, 0, -s * 0.5);
  path.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.1, -s * 0.3, 0, s * 0.5);
  path.closePath();
  shade(ctx, path, { x: -s, y: -s, w: s * 2, h: s * 1.5 }, HEART, 1.7);
}

function magnet(ctx: CanvasRenderingContext2D, r: number) {
  const s = r * 0.42;
  const arc = new Path2D();
  arc.arc(0, 0, s, Math.PI, 0);
  ctx.lineCap = 'butt';
  ctx.lineWidth = s * 0.78;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(arc);
  ctx.lineWidth = s * 0.5;
  ctx.strokeStyle = MAGNET.base;
  ctx.stroke(arc);
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = MAGNET.light;
  ctx.stroke(arc);
  for (const side of [-1, 1] as const) {
    const tip = roundRectP(side * s - s * 0.3, -s * 0.05, s * 0.6, s * 0.46, 2);
    shade(
      ctx,
      tip,
      { x: side * s - s * 0.3, y: 0, w: s * 0.6, h: s * 0.46 },
      { light: '#ffffff', base: '#d9e2ea', dark: '#7d8c9b', gloss: 0.8, metal: true },
      1.4,
    );
  }
}
