// 玩具单位的程序化绘制：站在棋子底座上的小玩具，有体积光、队伍色反光和成套的动作
// （走路弹跳、蓄力下蹲、出手前冲、受击后仰、冲锋拉伸、出场落地、倒下翻倒）。
// 这里是共用部分：投影、底座、姿态、闪白着色；各单位的造型在 allies.ts 与 enemies.ts。
import type { Unit } from '../core/sim/entities.js';
import { drawAlly } from './allies.js';
import { drawEnemy } from './enemies.js';
import { starPath } from './shapes.js';
import { OUTLINE, recent, setRim, type Box, type Expr } from './toon.js';

export interface UnitVisual {
  /** 插值后的位置。 */
  x: number;
  y: number;
  /** 当前战斗时间（秒）。 */
  t: number;
  /** 阿铁的外观附件。 */
  shield: boolean;
  armor: boolean;
  booster: boolean;
  /** 叮当的铃铛装饰。 */
  bellCharm: 'bow' | 'magnet' | 'heart';
  /** 出场动画进度 0..1。 */
  appear: number;
  /** 被选中（准备阶段）。 */
  selected: boolean;
  reduceFlashes: boolean;
  /** 台灯投下的影子偏移（竞技场单位），不传时用默认的右下方。 */
  shadowX?: number;
  shadowY?: number;
  /** 整体染色（冲锋残影等），amount 0..1。 */
  tint?: { color: string; amount: number };
}

/** 画单位造型时用到的姿态与表情。 */
export interface Pose {
  t: number;
  /** 朝右为 1，朝左为 -1。 */
  flip: 1 | -1;
  /** 视线方向（-1..1）。 */
  look: { x: number; y: number };
  expr: Expr;
  blink: boolean;
  /** 蓄力进度 0..1。 */
  windup: number;
  /** 出手后从 1 降到 0。 */
  attack: number;
  /** 受击后从 1 降到 0。 */
  hit: number;
  moving: boolean;
  /** 走路相位（弧度）。 */
  step: number;
  dash: boolean;
}

/** 画面上把玩具画得比碰撞体积大一些，便于看清（不影响规则）。 */
export const UNIT_DRAW_SCALE = 1.34;
/** 倒下动画的时长（秒）。 */
export const DEATH_TIME = 0.6;

const TAU = Math.PI * 2;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/** 蓄力总时长：首领的几种动作各不相同。 */
function windupTotal(u: Unit): number {
  if (u.kind === 'king') {
    if (u.pending === 'charge') return 1.1;
    if (u.pending === 'summon') return 0.6;
    if (u.pending === 'fan') return 0.5;
  }
  return u.def.windup;
}

export function windupProgress(u: Unit): number {
  if (u.state !== 'windup' && u.state !== 'fuse') return 0;
  return clamp01(1 - Math.max(0, u.stateTime) / Math.max(0.01, windupTotal(u)));
}

function makePose(u: Unit, t: number): Pose {
  const moving = Math.hypot(u.mvx, u.mvy) > 5 || Math.hypot(u.vx, u.vy) > 40;
  const flip = Math.cos(u.facing) < -0.2 ? -1 : 1;
  const hit = recent(t, u.hitAt, 0.26);
  const attack = recent(t, u.attackAt, 0.28);
  const windup = windupProgress(u);
  const dash = u.state === 'dash' || u.state === 'charge';
  let expr: Expr = u.team === 1 ? 'angry' : 'normal';
  if (u.team === 0 && (windup > 0 || dash || attack > 0.5)) expr = 'focus';
  if (hit > 0.4) expr = 'hurt';
  if (u.stun > 0 || u.state === 'stunned') expr = 'dizzy';
  const blink = expr !== 'hurt' && expr !== 'dizzy' && (t * 0.9 + u.id * 0.37) % 4.2 > 4.05;
  return {
    t,
    flip,
    look: { x: Math.cos(u.facing), y: Math.sin(u.facing) * 0.6 },
    expr,
    blink,
    windup,
    attack,
    hit,
    moving,
    step: t * 11 + u.id * 1.7,
    dash,
  };
}

/** 身体的弹跳、挤压与倾斜；以脚底为支点，看起来是站在底座上动。 */
function bodyTransform(ctx: CanvasRenderingContext2D, u: Unit, p: Pose, r: number): void {
  let bob = 0;
  let sx = 1;
  let sy = 1;
  let lean = 0;
  let dx = 0;
  if (p.moving && !p.dash) {
    const s = Math.abs(Math.sin(p.step));
    const contact = Math.pow(1 - s, 4);
    bob = s * r * 0.14;
    sy = 1 + 0.045 * s - 0.08 * contact;
    sx = 1 - 0.03 * s + 0.07 * contact;
    lean = Math.max(-1, Math.min(1, u.mvx / Math.max(1, u.speed))) * 0.1;
  } else {
    const breath = Math.sin(p.t * 2.4 + u.id);
    sy = 1 + 0.022 * breath;
    sx = 1 - 0.014 * breath;
  }
  if (p.windup > 0) {
    const w = easeOutCubic(p.windup);
    sy *= 1 - 0.1 * w;
    sx *= 1 + 0.07 * w;
    lean -= p.flip * 0.1 * w;
  }
  if (p.attack > 0) {
    const a = p.attack * p.attack;
    sy *= 1 + 0.06 * a;
    sx *= 1 - 0.035 * a;
    lean += p.flip * 0.13 * a;
    dx += Math.cos(u.facing) * r * 0.16 * a;
  }
  if (p.hit > 0) {
    const h = p.hit * p.hit;
    const away = Math.hypot(u.vx, u.vy) > 30 ? Math.sign(u.vx) || -p.flip : -p.flip;
    sx *= 1 + 0.13 * h;
    sy *= 1 - 0.11 * h;
    dx += away * r * 0.18 * h;
    lean += away * 0.2 * h;
  }
  if (p.dash) {
    const dir = Math.sign(u.dashX) || p.flip;
    sx *= 1.12;
    sy *= 0.9;
    lean += dir * 0.24;
  }
  if (u.slide) lean += Math.sin(p.t * 22 + u.id) * 0.24;
  if (u.held) lean += Math.sin(p.t * 16 + u.id) * 0.2;
  if (p.expr === 'dizzy') lean += Math.sin(p.t * 5 + u.id) * 0.12;
  const foot = r * 0.55;
  ctx.translate(dx, foot - bob);
  ctx.rotate(lean);
  ctx.scale(sx, sy);
  ctx.translate(0, -foot);
}

// ---- 投影与底座 ----

let shadowSprite: HTMLCanvasElement | null = null;

function shadowImage(): HTMLCanvasElement {
  if (shadowSprite) return shadowSprite;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(6, 12, 10, 0.55)');
  g.addColorStop(0.5, 'rgba(6, 12, 10, 0.34)');
  g.addColorStop(1, 'rgba(6, 12, 10, 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  shadowSprite = c;
  return c;
}

function softShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.drawImage(shadowImage(), x - rx, y - ry, rx * 2, ry * 2);
}

/** 棋子底座：我方奶白圆台加天青色圈，对手深梅色圆台加珊瑚色圈与一圈尖角。 */
function base(ctx: CanvasRenderingContext2D, u: Unit, r: number, t: number, calm: boolean): void {
  const y = r * 0.62;
  const rx = r * 1.04;
  const ry = r * 0.4;
  const th = Math.max(3, r * 0.17);
  const ally = u.team === 0;

  const side = new Path2D();
  side.moveTo(-rx, y);
  side.lineTo(-rx, y + th);
  side.ellipse(0, y + th, rx, ry, 0, Math.PI, 0, true);
  side.lineTo(rx, y);
  side.ellipse(0, y, rx, ry, 0, 0, Math.PI, false);
  side.closePath();
  const sg = ctx.createLinearGradient(-rx, 0, rx, 0);
  sg.addColorStop(0, ally ? '#e9d8b6' : '#4a2442');
  sg.addColorStop(0.35, ally ? '#cdb58c' : '#35162f');
  sg.addColorStop(1, ally ? '#8d7453' : '#1a0a17');
  ctx.fillStyle = sg;
  ctx.fill(side);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(side);

  const top = new Path2D();
  top.ellipse(0, y, rx, ry, 0, 0, TAU);
  const tg = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  tg.addColorStop(0, ally ? '#fffaf0' : '#5e2f55');
  tg.addColorStop(1, ally ? '#e6d2ac' : '#321630');
  ctx.fillStyle = tg;
  ctx.fill(top);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(top);

  // 队伍色的内圈：我方天青，对手珊瑚；磁铃共鸣时变成一圈蓝光；我方残血时变红。
  const resonance = u.resonance > 0;
  const low = ally && u.alive && u.hp / u.maxHp < 0.3;
  const beat = calm ? 0.85 : 0.7 + 0.3 * Math.sin(t * (low ? 6 : 9));
  ctx.beginPath();
  ctx.ellipse(0, y, rx * 0.8, ry * 0.76, 0, 0, TAU);
  ctx.lineWidth = resonance || low ? 3 : 2.2;
  ctx.strokeStyle = low
    ? `rgba(255, 96, 84, ${beat})`
    : resonance
      ? `rgba(154, 216, 255, ${beat})`
      : ally
        ? 'rgba(90, 209, 230, 0.95)'
        : 'rgba(255, 128, 110, 0.9)';
  ctx.stroke();

  if (!ally) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const px = Math.cos(a) * rx;
      const py = y + Math.sin(a) * ry;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * 7, py + Math.sin(a) * 3.5);
      ctx.lineTo(px + Math.cos(a + 1.3) * 4.5, py + Math.sin(a + 1.3) * 2.2);
      ctx.lineTo(px + Math.cos(a - 1.3) * 4.5, py + Math.sin(a - 1.3) * 2.2);
      ctx.closePath();
      ctx.fillStyle = '#3b1a35';
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 3);
      ctx.lineTo(px + Math.cos(a) * 2, py + Math.sin(a) * 1);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#ff8a7a';
      ctx.stroke();
    }
  }
}

function selectionRing(ctx: CanvasRenderingContext2D, r: number, t: number): void {
  const y = r * 0.62;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, y, r * 1.34, r * 0.58, 0, 0, TAU);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffd166';
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = -t * 20;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.25 + 0.1 * Math.sin(t * 4);
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();
}

// ---- 着色：受击闪白、出场、倒下、残影 ----

const pool: HTMLCanvasElement[] = [];
let poolIndex = 0;

/** 取一块离屏画布（轮流使用几块，避免同一帧里反复改写同一块）。 */
function scratch(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  let c = pool[poolIndex];
  if (!c) {
    c = document.createElement('canvas');
    pool[poolIndex] = c;
  }
  poolIndex = (poolIndex + 1) % 6;
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, Math.ceil(w / 64) * 64);
    c.height = Math.max(c.height, Math.ceil(h / 64) * 64);
  }
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

/**
 * 先把 draw 画到离屏画布，整体染上 color（只染已画出的像素），再贴回来。
 * box 是局部坐标下的外接框。
 */
export function withTint(
  ctx: CanvasRenderingContext2D,
  box: Box,
  color: string,
  amount: number,
  draw: (c: CanvasRenderingContext2D) => void,
): void {
  const m = ctx.getTransform();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ] as const) {
    xs.push(m.a * x + m.c * y + m.e);
    ys.push(m.b * x + m.d * y + m.f);
  }
  const minX = Math.floor(Math.min(...xs));
  const minY = Math.floor(Math.min(...ys));
  const w = Math.ceil(Math.max(...xs)) - minX + 2;
  const h = Math.ceil(Math.max(...ys)) - minY + 2;
  if (w <= 0 || h <= 0 || w > 2048 || h > 2048) {
    draw(ctx);
    return;
  }
  const [canvas, s] = scratch(w, h);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'source-over';
  s.clearRect(0, 0, w, h);
  s.setTransform(m.a, m.b, m.c, m.d, m.e - minX, m.f - minY);
  draw(s);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalAlpha = Math.min(1, amount);
  s.globalCompositeOperation = 'source-atop';
  s.fillStyle = color;
  s.fillRect(0, 0, w, h);
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, 0, 0, w, h, minX, minY, w, h);
  ctx.restore();
}

function unitBox(r: number): Box {
  return { x: -r * 3.1 - 10, y: -r * 3 - 16, w: r * 6.2 + 20, h: r * 4.3 + 30 };
}

function drawFigure(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual, r: number, p: Pose) {
  ctx.save();
  bodyTransform(ctx, u, p, r);
  if (u.team === 0) drawAlly(ctx, u, v, r, p);
  else drawEnemy(ctx, u, v, r, p);
  ctx.restore();
}

function stunStars(ctx: CanvasRenderingContext2D, r: number, t: number): void {
  const top = -r * 1.55;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, top, r * 0.95, r * 0.28, 0, 0, TAU);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 224, 102, 0.45)';
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = t * 4 + (i * TAU) / 3;
    const front = Math.sin(a) > 0;
    starPath(ctx, Math.cos(a) * r * 0.95, top + Math.sin(a) * r * 0.28, 5, front ? 5.5 : 4, 2.2, a);
    ctx.fillStyle = front ? '#ffe066' : '#d9b84a';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  ctx.restore();
}

/** 护盾（治愈铃·护盾）：一层淡淡的泡泡。 */
function shieldBubble(ctx: CanvasRenderingContext2D, r: number, t: number): void {
  const cy = -r * 0.45;
  const R = r * 1.35;
  const g = ctx.createRadialGradient(-R * 0.3, cy - R * 0.35, R * 0.1, 0, cy, R);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
  g.addColorStop(0.7, 'rgba(255, 194, 212, 0.08)');
  g.addColorStop(1, 'rgba(255, 194, 212, 0.4)');
  ctx.beginPath();
  ctx.arc(0, cy, R, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = `rgba(255, 214, 228, ${0.55 + 0.2 * Math.sin(t * 5)})`;
  ctx.stroke();
}

export function drawUnit(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual): void {
  const r = u.radius;
  const t = v.t;
  const dead = !u.alive;
  const k = dead ? (t - u.diedAt) / DEATH_TIME : 0;
  if (dead && (k >= 1 || k < 0)) return;
  const p = makePose(u, t);
  setRim(u.team);

  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.scale(UNIT_DRAW_SCALE, UNIT_DRAW_SCALE);

  // 出场：从上方落下、弹一下，带一层渐隐的白光。倒下：跳起、翻倒、变暗、淡出。
  let lift = 0;
  let scale = 1;
  let spin = 0;
  let alpha = 1;
  let tint: { color: string; amount: number } | null = v.tint ?? null;
  if (v.appear < 1) {
    const a = clamp01(v.appear);
    lift = (1 - a) * (1 - a) * r * 1.4;
    scale = 0.45 + 0.55 * easeOutBack(a);
    alpha = Math.min(1, a * 2.5);
    if (!v.reduceFlashes) tint = { color: '#ffffff', amount: (1 - a) * 0.85 };
  }
  if (dead) {
    const e = easeOutCubic(Math.min(1, k * 1.6));
    lift = Math.sin(Math.min(1, k * 1.8) * Math.PI) * r * 0.55;
    spin = (u.id % 2 === 0 ? 1 : -1) * e * 1.45;
    scale = 1 - 0.28 * k;
    alpha = k > 0.5 ? 1 - (k - 0.5) / 0.5 : 1;
    tint =
      k < 0.14 && !v.reduceFlashes
        ? { color: '#ffffff', amount: 0.85 * (1 - k / 0.14) }
        : { color: '#2a1d2e', amount: Math.min(0.55, k * 0.8) };
  }

  ctx.globalAlpha *= alpha;
  const shadowScale = Math.max(0.3, 1 - lift / (r * 3));
  softShadow(
    ctx,
    (v.shadowX ?? 2) / UNIT_DRAW_SCALE,
    r * 0.66 + (v.shadowY ?? 3) / UNIT_DRAW_SCALE,
    r * 1.25 * shadowScale,
    r * 0.52 * shadowScale,
  );

  const pivot = r * 0.62;
  ctx.translate(0, pivot - lift);
  ctx.rotate(spin);
  ctx.scale(scale, scale);
  ctx.translate(0, -pivot);

  const piece = (c: CanvasRenderingContext2D) => {
    base(c, u, r, t, v.reduceFlashes);
    if (v.selected) selectionRing(c, r, t);
    if (!tint) {
      // 受击闪白只染身体，底座不变。
      const flash = !v.reduceFlashes && p.hit > 0.55 ? (p.hit - 0.55) / 0.45 : 0;
      if (flash > 0)
        withTint(c, unitBox(r), '#ffffff', flash * 0.75, (b) => drawFigure(b, u, v, r, p));
      else drawFigure(c, u, v, r, p);
    } else {
      drawFigure(c, u, v, r, p);
    }
  };
  if (tint && tint.amount > 0.01) withTint(ctx, unitBox(r), tint.color, tint.amount, piece);
  else piece(ctx);

  if (!dead) {
    if (u.shieldHp > 0) shieldBubble(ctx, r, t);
    if (p.expr === 'dizzy') stunStars(ctx, r, t);
  }
  ctx.restore();
}
