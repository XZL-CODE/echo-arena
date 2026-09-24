// 玩具单位的程序化绘制：形状、描边、眨眼、走路摇摆、受击形变。
// 画法偏“桌面上的小玩具”：正面朝向玩家，按朝向左右翻转，武器与盾牌指向实际朝向。
import type { Unit } from '../core/sim/entities.js';
import { PALETTE } from './palette.js';
import { circlePath, ellipsePath, gearPath, roundRectPath, starPath } from './shapes.js';

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
}

const OUTLINE = PALETTE.outline;
const TAU = Math.PI * 2;

/** 画面上把玩具画得比碰撞体积大一些，便于看清（不影响规则）。 */
export const UNIT_DRAW_SCALE = 1.28;

function since(t: number, stamp: number): number {
  return t - stamp;
}

/** 受击后短暂的挤压与闪白。 */
function hitPulse(t: number, hitAt: number): number {
  const dt = since(t, hitAt);
  return dt >= 0 && dt < 0.18 ? 1 - dt / 0.18 : 0;
}

function recent(t: number, stamp: number, window: number): number {
  const dt = since(t, stamp);
  return dt >= 0 && dt < window ? 1 - dt / window : 0;
}

function stroke(ctx: CanvasRenderingContext2D, width = 2.4): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function vgrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/** 眼睛：看向朝向，偶尔眨眼。 */
function eyes(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  t: number,
  cx: number,
  cy: number,
  gap: number,
  size: number,
  angry = false,
): void {
  const blink = (t * 0.9 + u.id * 0.37) % 4.2 > 4.05;
  const lookX = Math.cos(u.facing) * size * 0.35;
  const lookY = Math.sin(u.facing) * size * 0.25;
  for (const side of [-1, 1]) {
    const ex = cx + side * gap;
    if (blink) {
      ctx.beginPath();
      ctx.moveTo(ex - size * 0.8, cy);
      ctx.lineTo(ex + size * 0.8, cy);
      ctx.lineWidth = 2;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      continue;
    }
    ellipsePath(ctx, ex, cy, size * 0.8, size);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ellipsePath(ctx, ex + lookX, cy + lookY, size * 0.45, size * 0.58);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    circlePath(ctx, ex + lookX - size * 0.15, cy + lookY - size * 0.22, size * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (angry) {
      ctx.beginPath();
      ctx.moveTo(ex - side * size * 0.9, cy - size * 1.35);
      ctx.lineTo(ex + side * size * 0.7, cy - size * 0.95);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
  }
}

/** 底座：我方奶白圆环，对手深梅色尖角环。 */
function base(ctx: CanvasRenderingContext2D, u: Unit, r: number): void {
  const y = r * 0.62;
  ellipsePath(ctx, 3, y + 3, r * 1.05, r * 0.42);
  ctx.fillStyle = PALETTE.shadow;
  ctx.fill();
  ellipsePath(ctx, 0, y, r * 1.02, r * 0.4);
  ctx.fillStyle = u.team === 0 ? PALETTE.allyBase : PALETTE.enemyBase;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  if (u.team === 1) {
    ctx.fillStyle = PALETTE.enemyBase;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const px = Math.cos(a) * r * 1.02;
      const py = y + Math.sin(a) * r * 0.4;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 3);
      ctx.lineTo(px + Math.cos(a + 1.3) * 4, py + Math.sin(a + 1.3) * 2);
      ctx.lineTo(px + Math.cos(a - 1.3) * 4, py + Math.sin(a - 1.3) * 2);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

/** 正面盾牌：沿朝向画出一段弧，弧的宽度就是真正能挡住弹丸的角度。 */
export function shieldArc(
  ctx: CanvasRenderingContext2D,
  r: number,
  facing: number,
  arc: number,
  color: string,
  glow: number,
): void {
  ctx.save();
  ctx.translate(0, -r * 0.4);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r + 7, facing - arc, facing + arc);
  ctx.lineWidth = 9;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r + 7, facing - arc, facing + arc);
  ctx.lineWidth = 5.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (glow > 0) {
    ctx.globalAlpha = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r + 7, facing - arc, facing + arc);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.restore();
}

export function drawUnit(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual): void {
  const r = u.radius;
  const t = v.t;
  const moving = Math.hypot(u.mvx, u.mvy) > 5 || Math.hypot(u.vx, u.vy) > 40;
  const hit = hitPulse(t, u.hitAt);
  const bob = moving ? Math.abs(Math.sin(t * 11 + u.id)) * 2.6 : Math.sin(t * 2.2 + u.id) * 0.8;
  const squash = 1 + hit * 0.14;
  const appear = v.appear;

  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.scale(UNIT_DRAW_SCALE, UNIT_DRAW_SCALE);
  if (appear < 1) {
    const s = 0.4 + 0.6 * easeOutBack(appear);
    ctx.scale(s, s);
    ctx.globalAlpha *= Math.min(1, appear * 2);
  }
  base(ctx, u, r);
  if (v.selected) {
    ellipsePath(ctx, 0, r * 0.62, r * 1.3, r * 0.55);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.focus;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -t * 20;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.translate(0, -bob);
  ctx.scale(squash, 2 - squash);
  const flip = Math.cos(u.facing) < -0.2 ? -1 : 1;

  switch (u.kind) {
    case 'guard':
      drawGuard(ctx, u, v, r, flip);
      break;
    case 'slinger':
      drawSlinger(ctx, u, v, r, flip);
      break;
    case 'bell':
      drawBell(ctx, u, v, r);
      break;
    case 'archer':
      drawArcher(ctx, u, v, r, flip);
      break;
    case 'shell':
      drawShell(ctx, u, v, r, flip);
      break;
    case 'mouse':
      drawMouse(ctx, u, v, r, flip);
      break;
    case 'bomber':
      drawBomber(ctx, u, v, r);
      break;
    case 'snail':
      drawSnail(ctx, u, v, r, flip);
      break;
    case 'brute':
      drawBrute(ctx, u, v, r, flip);
      break;
    case 'mirror':
      drawMirror(ctx, u, v, r, flip);
      break;
    case 'mortar':
      drawMortar(ctx, u, v, r, flip);
      break;
    case 'jack':
      drawJack(ctx, u, v, r);
      break;
    case 'king':
      drawKing(ctx, u, v, r, flip);
      break;
  }

  if (hit > 0 && !v.reduceFlashes) {
    // 受击闪白：只覆盖身体的柔光，不影响周围地面。
    ctx.globalAlpha = hit * 0.45;
    ellipsePath(ctx, 0, -r * 0.4, r * 1.05, r * 1.1);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // 晕眩的星星与被吸住的旋涡标记。
  if (u.stun > 0 || u.state === 'stunned') {
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + (i * TAU) / 3;
      starPath(ctx, Math.cos(a) * r * 0.9, -r * 1.35 + Math.sin(a) * r * 0.25, 5, 5, 2.2, a);
      ctx.fillStyle = '#ffe066';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// ---- 我方 ----

function drawGuard(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  // 背后的冲锋弹簧
  if (v.booster) {
    ctx.save();
    const bx = -flip * r * 0.95;
    ctx.translate(bx, -r * 0.2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = -r * 0.45 + i * r * 0.22;
      ctx.moveTo(-6, y);
      ctx.lineTo(6, y + r * 0.11);
    }
    ctx.stroke();
    ctx.strokeStyle = '#e8b04a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }
  // 身体：铁皮罐
  roundRectPath(ctx, -r * 0.92, -r * 1.25, r * 1.84, r * 1.9, r * 0.45);
  ctx.fillStyle = vgrad(ctx, -r * 1.25, r * 0.65, '#d6e5f0', '#7f9ab2');
  ctx.fill();
  stroke(ctx, v.armor ? 3.4 : 2.6);
  // 腰带与铆钉
  ctx.fillStyle = v.armor ? '#d9a441' : '#6f879c';
  ctx.fillRect(-r * 0.92, -r * 0.08, r * 1.84, r * 0.26);
  ctx.strokeRect(-r * 0.92, -r * 0.08, r * 1.84, r * 0.26);
  ctx.fillStyle = '#f4f8fb';
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    circlePath(ctx, x * r, r * 0.05, 1.8);
    ctx.fill();
  }
  if (v.armor) {
    // 厚甲：胸甲与头冠
    roundRectPath(ctx, -r * 0.55, -r * 0.62, r * 1.1, r * 0.5, 5);
    ctx.fillStyle = '#e6b653';
    ctx.fill();
    stroke(ctx, 2);
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 1.25);
    ctx.quadraticCurveTo(0, -r * 1.75, r * 0.25, -r * 1.25);
    ctx.fillStyle = '#e07a5f';
    ctx.fill();
    stroke(ctx, 2);
  } else {
    // 发条钥匙
    ctx.save();
    ctx.translate(0, -r * 1.3);
    ctx.rotate(Math.sin(t * 3) * 0.3);
    ctx.fillStyle = '#e8b04a';
    ctx.fillRect(-2, -8, 4, 8);
    ellipsePath(ctx, -5, -10, 4.5, 3.5);
    ctx.fill();
    stroke(ctx, 1.6);
    ellipsePath(ctx, 5, -10, 4.5, 3.5);
    ctx.fill();
    stroke(ctx, 1.6);
    ctx.restore();
  }
  eyes(ctx, u, t, flip * r * 0.12, -r * 0.62, r * 0.3, r * 0.2);
  // 铁拳：攻击时向朝向方向打出去
  const punch = recent(t, u.attackAt, 0.22);
  const windup = u.state === 'windup' ? 1 - Math.max(0, u.stateTime) / u.def.windup : 0;
  const reach = r * (0.95 + punch * 0.55 - windup * 0.2);
  const fx = Math.cos(u.facing) * reach;
  const fy = Math.sin(u.facing) * reach * 0.6 - r * 0.2;
  circlePath(ctx, fx, fy, r * 0.34);
  ctx.fillStyle = vgrad(ctx, fy - r * 0.34, fy + r * 0.34, '#f3cf73', '#c88b2e');
  ctx.fill();
  stroke(ctx, 2.2);
  if (v.shield) {
    ctx.save();
    ctx.scale(1, 0.92);
    shieldArc(ctx, r, u.facing, (62 * Math.PI) / 180, '#bff4ff', recent(t, u.blockAt, 0.25));
    ctx.restore();
  }
}

function drawSlinger(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  const flap = Math.sin(t * (Math.hypot(u.mvx, u.mvy) > 5 ? 22 : 4) + u.id) * 0.4;
  // 翅膀
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * r * 0.88, -r * 0.2);
    ctx.rotate(side * (0.4 + flap));
    ellipsePath(ctx, 0, 0, r * 0.28, r * 0.5);
    ctx.fillStyle = '#f2b531';
    ctx.fill();
    stroke(ctx, 2);
    ctx.restore();
  }
  // 身体
  circlePath(ctx, 0, -r * 0.35, r);
  ctx.fillStyle = vgrad(ctx, -r * 1.35, r * 0.65, '#fff0a0', '#f6b93b');
  ctx.fill();
  stroke(ctx);
  // 呆毛
  ctx.beginPath();
  ctx.moveTo(-2, -r * 1.3);
  ctx.quadraticCurveTo(-8, -r * 1.75, 2, -r * 1.7);
  ctx.moveTo(2, -r * 1.3);
  ctx.quadraticCurveTo(8, -r * 1.8, 10, -r * 1.55);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  eyes(ctx, u, t, flip * r * 0.1, -r * 0.55, r * 0.34, r * 0.22);
  // 嘴
  ctx.beginPath();
  ctx.moveTo(flip * r * 0.55, -r * 0.3);
  ctx.lineTo(flip * r * 0.95, -r * 0.2);
  ctx.lineTo(flip * r * 0.55, -r * 0.08);
  ctx.closePath();
  ctx.fillStyle = '#ff8c42';
  ctx.fill();
  stroke(ctx, 1.8);
  // 弹弓：朝向方向，蓄力时皮筋往后拉
  const pull =
    u.state === 'windup' ? 1 - Math.max(0, u.stateTime) / Math.max(0.01, u.def.windup) : 0;
  const snap = recent(t, u.attackAt, 0.12);
  ctx.save();
  ctx.rotate(u.facing);
  ctx.translate(r * 1.05, -r * 0.1);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = '#7a4a2a';
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(0, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(6, -6);
  ctx.moveTo(0, 0);
  ctx.lineTo(6, 6);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#ff6fb5';
  ctx.beginPath();
  ctx.moveTo(6, -6);
  ctx.lineTo(-4 - pull * 10 + snap * 6, 0);
  ctx.lineTo(6, 6);
  ctx.stroke();
  ctx.restore();
}

function drawBell(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual, r: number): void {
  const t = v.t;
  const ring = recent(t, u.attackAt, 0.6);
  const swing = Math.sin(t * 18) * ring * 0.35 + Math.sin(t * 2 + u.id) * 0.05;
  ctx.save();
  ctx.rotate(swing);
  // 铃身
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, r * 0.35);
  ctx.quadraticCurveTo(-r * 0.9, -r * 1.35, 0, -r * 1.4);
  ctx.quadraticCurveTo(r * 0.9, -r * 1.35, r * 0.95, r * 0.35);
  ctx.quadraticCurveTo(0, r * 0.55, -r * 0.95, r * 0.35);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, -r * 1.4, r * 0.5, '#ffe89a', '#e2a42c');
  ctx.fill();
  stroke(ctx);
  // 铃口
  ellipsePath(ctx, 0, r * 0.35, r * 0.98, r * 0.24);
  ctx.fillStyle = '#c78a1f';
  ctx.fill();
  stroke(ctx, 2);
  // 铃舌
  circlePath(ctx, Math.sin(t * 18) * ring * 6, r * 0.6, r * 0.2);
  ctx.fillStyle = '#8a5a35';
  ctx.fill();
  stroke(ctx, 1.8);
  eyes(ctx, u, t, 0, -r * 0.5, r * 0.3, r * 0.2);
  // 头顶装饰
  ctx.translate(0, -r * 1.45);
  if (v.bellCharm === 'magnet') {
    ctx.lineWidth = 5;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(0, -2, 7, Math.PI, 0);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e63946';
    ctx.stroke();
    ctx.fillStyle = '#dfe7ee';
    ctx.fillRect(-9, -3, 4, 5);
    ctx.fillRect(5, -3, 4, 5);
  } else if (v.bellCharm === 'heart') {
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-11, -4, -5, -12, 0, -6);
    ctx.bezierCurveTo(5, -12, 11, -4, 0, 4);
    ctx.fillStyle = '#ff8fb1';
    ctx.fill();
    stroke(ctx, 1.8);
  } else {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * 12, -9, side * 11, 3);
      ctx.closePath();
      ctx.fillStyle = '#e76f51';
      ctx.fill();
      stroke(ctx, 1.6);
    }
    circlePath(ctx, 0, 0, 3);
    ctx.fillStyle = '#e76f51';
    ctx.fill();
    stroke(ctx, 1.4);
  }
  ctx.restore();
}

// ---- 对手 ----

function drawArcher(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  // 木头身体
  ctx.beginPath();
  ctx.moveTo(-r * 0.75, r * 0.45);
  ctx.quadraticCurveTo(-r * 0.85, -r * 0.4, 0, -r * 0.55);
  ctx.quadraticCurveTo(r * 0.85, -r * 0.4, r * 0.75, r * 0.45);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, -r * 0.6, r * 0.45, '#8c4d7c', '#5d2c55');
  ctx.fill();
  stroke(ctx);
  // 木头脑袋
  circlePath(ctx, 0, -r * 0.95, r * 0.62);
  ctx.fillStyle = vgrad(ctx, -r * 1.6, -r * 0.3, '#e9c08e', '#c28b5a');
  ctx.fill();
  stroke(ctx);
  // 兜帽
  ctx.beginPath();
  ctx.arc(0, -r * 0.95, r * 0.66, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#6e3263';
  ctx.stroke();
  eyes(ctx, u, t, flip * r * 0.1, -r * 0.92, r * 0.22, r * 0.14, true);
  // 弓
  const draw = u.state === 'windup' ? 1 - Math.max(0, u.stateTime) / u.def.windup : 0;
  ctx.save();
  ctx.rotate(u.facing);
  ctx.translate(r * 0.95, -r * 0.2);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.75, -1.1, 1.1);
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = '#b07a4c';
  ctx.stroke();
  const tipX = Math.cos(1.1) * r * 0.75;
  const tipY = Math.sin(1.1) * r * 0.75;
  const pullX = tipX - draw * r * 0.7;
  ctx.beginPath();
  ctx.moveTo(tipX, -tipY);
  ctx.lineTo(pullX, 0);
  ctx.lineTo(tipX, tipY);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#f6ead3';
  ctx.stroke();
  if (draw > 0) {
    ctx.beginPath();
    ctx.moveTo(pullX, 0);
    ctx.lineTo(pullX + r * 1.1, 0);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#6b4226';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pullX + r * 1.1 + 5, 0);
    ctx.lineTo(pullX + r * 1.1 - 1, -3.5);
    ctx.lineTo(pullX + r * 1.1 - 1, 3.5);
    ctx.closePath();
    ctx.fillStyle = PALETTE.arrow;
    ctx.fill();
  }
  ctx.restore();
}

function drawShell(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  // 蟹钳
  const snap = recent(t, u.attackAt, 0.2);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(flip * r * 0.7, -r * 0.05 + side * r * 0.35);
    ctx.rotate(flip * (0.3 + snap * 0.5) * side);
    ellipsePath(ctx, flip * r * 0.25, 0, r * 0.3, r * 0.2);
    ctx.fillStyle = '#ff8a7a';
    ctx.fill();
    stroke(ctx, 1.8);
    ctx.restore();
  }
  // 螺旋大壳
  circlePath(ctx, -flip * r * 0.1, -r * 0.45, r * 0.95);
  ctx.fillStyle = vgrad(ctx, -r * 1.4, r * 0.5, '#b183c9', '#6b3f86');
  ctx.fill();
  stroke(ctx);
  ctx.beginPath();
  for (let i = 0; i <= 28; i++) {
    const a = i * 0.45;
    const rr = r * 0.78 * (1 - i / 32);
    const x = -flip * r * 0.1 + Math.cos(a) * rr * flip;
    const y = -r * 0.45 + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(36,26,31,0.55)';
  ctx.stroke();
  // 探出来的眼睛
  for (const dx of [0.35, 0.65]) {
    ctx.beginPath();
    ctx.moveTo(flip * r * dx, -r * 0.5);
    ctx.lineTo(flip * r * (dx + 0.1), -r * 1.15);
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    circlePath(ctx, flip * r * (dx + 0.1), -r * 1.2, 4);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    stroke(ctx, 1.4);
    circlePath(ctx, flip * r * (dx + 0.1) + Math.cos(u.facing) * 1.5, -r * 1.2, 1.8);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
  }
  // 正面壳盾（真实的格挡角度）
  const shield = u.def.shield;
  if (shield) {
    ctx.save();
    ctx.scale(1, 0.9);
    shieldArc(ctx, r, u.facing, shield.arc, '#caa2e0', recent(t, u.blockAt, 0.2));
    ctx.restore();
  }
}

function drawMouse(
  ctx: CanvasRenderingContext2D,
  _u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  // 尾巴
  ctx.beginPath();
  ctx.moveTo(-flip * r * 0.8, r * 0.1);
  ctx.quadraticCurveTo(-flip * r * 1.6, -r * 0.2 + Math.sin(t * 12) * 4, -flip * r * 1.5, -r * 0.8);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 身体（水滴）
  ctx.beginPath();
  ctx.moveTo(flip * r * 1.1, -r * 0.2);
  ctx.quadraticCurveTo(flip * r * 0.2, -r * 1.3, -flip * r * 0.9, -r * 0.35);
  ctx.quadraticCurveTo(-flip * r * 0.9, r * 0.45, 0, r * 0.4);
  ctx.quadraticCurveTo(flip * r * 0.7, r * 0.35, flip * r * 1.1, -r * 0.2);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, -r * 1.1, r * 0.4, '#c9bddb', '#8d7fa8');
  ctx.fill();
  stroke(ctx);
  // 耳朵
  circlePath(ctx, flip * r * 0.15, -r * 0.9, r * 0.36);
  ctx.fillStyle = '#ffb3c7';
  ctx.fill();
  stroke(ctx, 1.8);
  // 眼睛与鼻子
  circlePath(ctx, flip * r * 0.55, -r * 0.45, 2.6);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  circlePath(ctx, flip * r * 1.08, -r * 0.2, 2.4);
  ctx.fillStyle = '#ff6f91';
  ctx.fill();
  // 背上的发条钥匙
  ctx.save();
  ctx.translate(-flip * r * 0.35, -r * 0.95);
  ctx.rotate(t * 9);
  ctx.fillStyle = '#e8b04a';
  ctx.fillRect(-1.5, -6, 3, 6);
  ellipsePath(ctx, -3.5, -7, 3.2, 2.4);
  ctx.fill();
  stroke(ctx, 1.2);
  ellipsePath(ctx, 3.5, -7, 3.2, 2.4);
  ctx.fill();
  stroke(ctx, 1.2);
  ctx.restore();
}

function drawBomber(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual, r: number): void {
  const t = v.t;
  const fusing = u.state === 'fuse';
  const progress = fusing ? 1 - Math.max(0, u.stateTime) / Math.max(0.01, u.def.windup) : 0;
  const pulse = fusing ? Math.sin(t * (20 + progress * 40)) * 0.5 + 0.5 : 0;
  const grow = 1 + progress * 0.18;
  ctx.save();
  ctx.scale(grow, grow);
  // 小脚
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(x * r, r * 0.3);
    ctx.lineTo(x * r * 1.2, r * 0.55 + Math.sin(t * 20 + x * 9) * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  circlePath(ctx, 0, -r * 0.3, r);
  ctx.fillStyle = vgrad(ctx, -r * 1.3, r * 0.7, '#6d4077', '#35193b');
  ctx.fill();
  stroke(ctx);
  if (fusing && !v.reduceFlashes) {
    ctx.globalAlpha = pulse * 0.7;
    circlePath(ctx, 0, -r * 0.3, r);
    ctx.fillStyle = '#ffd6a5';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 亮点
  ellipsePath(ctx, -r * 0.35, -r * 0.75, r * 0.25, r * 0.15);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  eyes(ctx, u, t, 0, -r * 0.35, r * 0.3, r * 0.2, true);
  // 引信与火星
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.25);
  ctx.quadraticCurveTo(r * 0.3, -r * 1.6, r * 0.15, -r * 1.85);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = '#d9c9a3';
  ctx.stroke();
  const spark = 3 + Math.sin(t * 30 + u.id) * 1.5 + progress * 4;
  starPath(ctx, r * 0.15, -r * 1.9, 6, spark + 2, spark * 0.45, t * 8);
  ctx.fillStyle = fusing ? '#ff5e3a' : '#ffd166';
  ctx.fill();
  ctx.restore();
}

function drawSnail(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  // 身体
  ctx.beginPath();
  ctx.moveTo(-flip * r * 0.9, r * 0.4);
  ctx.quadraticCurveTo(flip * r * 0.2, r * 0.55, flip * r * 1.1, r * 0.15);
  ctx.quadraticCurveTo(flip * r * 1.25, -r * 0.55, flip * r * 0.8, -r * 0.6);
  ctx.lineTo(flip * r * 0.5, r * 0.1);
  ctx.closePath();
  ctx.fillStyle = '#f3e3c3';
  ctx.fill();
  stroke(ctx, 2);
  // 触角
  for (const d of [0.75, 1.05]) {
    ctx.beginPath();
    ctx.moveTo(flip * r * d * 0.9, -r * 0.5);
    ctx.lineTo(flip * r * d, -r * 1.05);
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    circlePath(ctx, flip * r * d, -r * 1.1, 2.6);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
  }
  // 壳
  circlePath(ctx, -flip * r * 0.2, -r * 0.35, r * 0.82);
  ctx.fillStyle = vgrad(ctx, -r * 1.2, r * 0.5, '#d9b8d1', '#9c6f94');
  ctx.fill();
  stroke(ctx);
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = i * 0.5;
    const rr = r * 0.65 * (1 - i / 28);
    const x = -flip * r * 0.2 + Math.cos(a) * rr;
    const y = -r * 0.35 + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(36,26,31,0.5)';
  ctx.stroke();
  // 护士帽
  ctx.save();
  ctx.translate(flip * r * 0.85, -r * 0.75);
  roundRectPath(ctx, -7, -6, 14, 8, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  stroke(ctx, 1.4);
  ctx.fillStyle = '#ff6f91';
  ctx.fillRect(-1.2, -5, 2.4, 6);
  ctx.fillRect(-3, -3.2, 6, 2.4);
  ctx.restore();
  if (u.state === 'windup') {
    ctx.globalAlpha = 0.5 + Math.sin(t * 20) * 0.3;
    circlePath(ctx, -flip * r * 0.2, -r * 0.35, r * 1.05);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.heal;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawBrute(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  const windup = u.state === 'windup' ? 1 - Math.max(0, u.stateTime) / u.def.windup : 0;
  const punch = recent(t, u.attackAt, 0.25);
  // 耳朵
  for (const side of [-1, 1]) {
    circlePath(ctx, side * r * 0.6, -r * 1.05, r * 0.3);
    ctx.fillStyle = '#8e5a45';
    ctx.fill();
    stroke(ctx, 2);
  }
  // 身体
  circlePath(ctx, 0, -r * 0.35, r);
  ctx.fillStyle = vgrad(ctx, -r * 1.35, r * 0.65, '#a0705a', '#6a3f30');
  ctx.fill();
  stroke(ctx, 2.8);
  // 补丁与缝线
  roundRectPath(ctx, -flip * r * 0.65, -r * 0.3, r * 0.4, r * 0.35, 3);
  ctx.fillStyle = '#7b3f6e';
  ctx.fill();
  stroke(ctx, 1.4);
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, r * 0.15);
  ctx.lineTo(r * 0.25, r * 0.15);
  for (let i = 0; i < 4; i++) {
    const x = -r * 0.05 + i * r * 0.09;
    ctx.moveTo(x, r * 0.08);
    ctx.lineTo(x, r * 0.22);
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 口鼻
  ellipsePath(ctx, flip * r * 0.3, -r * 0.35, r * 0.34, r * 0.24);
  ctx.fillStyle = '#d9b08c';
  ctx.fill();
  stroke(ctx, 1.6);
  circlePath(ctx, flip * r * 0.42, -r * 0.42, 3);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  eyes(ctx, u, t, flip * r * 0.05, -r * 0.8, r * 0.28, r * 0.15, true);
  // 拳头：蓄力时举高，出拳时前伸
  const fx = Math.cos(u.facing) * r * (1 + punch * 0.5);
  const fy = Math.sin(u.facing) * r * 0.6 - r * 0.2 - windup * r * 0.9;
  circlePath(ctx, fx, fy, r * 0.38);
  ctx.fillStyle = '#8e5a45';
  ctx.fill();
  stroke(ctx, 2.2);
  if (windup > 0) {
    ctx.globalAlpha = 0.35 + windup * 0.5;
    circlePath(ctx, fx, fy, r * 0.38 + 4 + windup * 5);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = PALETTE.taunt;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawMirror(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  // 披风
  ctx.beginPath();
  ctx.moveTo(-flip * r * 0.2, -r * 1.0);
  ctx.quadraticCurveTo(-flip * r * 1.2, -r * 0.2, -flip * r * 0.8, r * 0.45);
  ctx.lineTo(flip * r * 0.1, r * 0.3);
  ctx.closePath();
  ctx.fillStyle = '#6a3d9a';
  ctx.fill();
  stroke(ctx, 2);
  // 盔甲身体
  roundRectPath(ctx, -r * 0.7, -r * 1.2, r * 1.4, r * 1.75, r * 0.5);
  ctx.fillStyle = vgrad(ctx, -r * 1.2, r * 0.55, '#eef3f7', '#9aa8b5');
  ctx.fill();
  stroke(ctx);
  // 头盔缝
  roundRectPath(ctx, flip > 0 ? -r * 0.1 : -r * 0.45, -r * 0.85, r * 0.55, r * 0.14, 3);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  // 羽饰
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.2);
  ctx.quadraticCurveTo(-flip * r * 0.6, -r * 1.8, -flip * r * 0.9, -r * 1.35);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#c77dff';
  ctx.stroke();
  // 镜盾（真实的反射角度）
  const shield = u.def.shield;
  if (shield) {
    ctx.save();
    ctx.scale(1, 0.9);
    shieldArc(ctx, r, u.facing, shield.arc, '#f4fbff', recent(t, u.blockAt, 0.3));
    ctx.restore();
  }
}

function drawMortar(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  const recoil = recent(t, u.attackAt, 0.3);
  // 炮管（背上，斜向上）
  ctx.save();
  ctx.translate(-flip * r * 0.2, -r * 0.9);
  ctx.rotate(flip * -0.7 + (flip > 0 ? 0 : Math.PI));
  roundRectPath(ctx, -4 - recoil * 4, -6, r * 1.1, 12, 4);
  ctx.fillStyle = '#4a4458';
  ctx.fill();
  stroke(ctx, 2);
  ctx.restore();
  // 青蛙身体
  ellipsePath(ctx, 0, -r * 0.2, r * 1.05, r * 0.8);
  ctx.fillStyle = vgrad(ctx, -r, r * 0.6, '#a86fae', '#6b3b6e');
  ctx.fill();
  stroke(ctx);
  // 鼓起的眼睛
  for (const side of [-1, 1]) {
    circlePath(ctx, side * r * 0.45, -r * 0.85, r * 0.3);
    ctx.fillStyle = '#a86fae';
    ctx.fill();
    stroke(ctx, 2);
  }
  eyes(ctx, u, t, 0, -r * 0.88, r * 0.45, r * 0.16);
  // 嘴
  ctx.beginPath();
  ctx.arc(flip * r * 0.1, -r * 0.35, r * 0.4, 0.2, Math.PI - 0.2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  if (u.state === 'windup') {
    circlePath(ctx, 0, -r * 1.6, 3 + Math.sin(t * 25) * 1.5);
    ctx.fillStyle = '#ffae42';
    ctx.fill();
  }
}

function drawJack(ctx: CanvasRenderingContext2D, u: Unit, v: UnitVisual, r: number): void {
  const t = v.t;
  const shake = u.state === 'windup' ? Math.sin(t * 60) * 2 : 0;
  const pop = recent(t, u.attackAt, 0.5);
  ctx.save();
  ctx.translate(shake, 0);
  // 弹出的弹簧与小丑头
  if (pop > 0) {
    const h = r * 1.1 * Math.sin(pop * Math.PI);
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const y = -r * 0.9 - (h * i) / 6;
      ctx.lineTo(i % 2 === 0 ? -6 : 6, y);
    }
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#d9c9a3';
    ctx.stroke();
    circlePath(ctx, 0, -r * 0.95 - h, 8);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    stroke(ctx, 1.6);
  }
  // 盒子
  roundRectPath(ctx, -r * 0.95, -r * 1.05, r * 1.9, r * 1.55, 7);
  ctx.fillStyle = vgrad(ctx, -r * 1.05, r * 0.5, '#d46a9f', '#9b3f6f');
  ctx.fill();
  stroke(ctx, 2.6);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const [x, y] of [
    [-0.5, -0.6],
    [0.45, -0.5],
    [-0.1, 0.0],
    [0.55, 0.15],
    [-0.6, 0.2],
  ] as const) {
    circlePath(ctx, x * r, y * r, 3.2);
    ctx.fill();
  }
  // 盖子
  roundRectPath(ctx, -r, -r * 1.2 - pop * 6, r * 2, r * 0.3, 4);
  ctx.fillStyle = '#7b2f57';
  ctx.fill();
  stroke(ctx, 2);
  // 摇柄
  ctx.save();
  ctx.translate(r * 0.95, -r * 0.3);
  ctx.rotate(t * (u.state === 'windup' ? 14 : 2));
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e8b04a';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(8, 0);
  ctx.lineTo(8, 6);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawKing(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  v: UnitVisual,
  r: number,
  flip: number,
): void {
  const t = v.t;
  const angry = u.phase >= 3;
  // 背后的大发条钥匙
  ctx.save();
  ctx.translate(-flip * r * 0.95, -r * 0.4);
  ctx.rotate(t * (u.state === 'charge' ? 16 : 2.5));
  ctx.fillStyle = '#e8b04a';
  ctx.fillRect(-3, -3, 20, 6);
  for (const a of [0, Math.PI]) {
    ellipsePath(ctx, 20 + Math.cos(a) * 0, Math.sin(a) * 9, 7, 5);
  }
  ctx.fill();
  stroke(ctx, 2);
  ctx.restore();
  // 齿轮装饰
  gearPath(ctx, flip * r * 0.8, r * 0.1, r * 0.32, 8, t * 1.5);
  ctx.fillStyle = '#c9a227';
  ctx.fill();
  stroke(ctx, 1.8);
  // 身体
  circlePath(ctx, 0, -r * 0.35, r);
  ctx.fillStyle = vgrad(
    ctx,
    -r * 1.35,
    r * 0.65,
    angry ? '#9b4dca' : '#8a5cc2',
    angry ? '#4d1f6e' : '#4a2a7a',
  );
  ctx.fill();
  stroke(ctx, 3.2);
  // 金色腰带
  ctx.save();
  circlePath(ctx, 0, -r * 0.35, r);
  ctx.clip();
  ctx.fillStyle = '#e8c547';
  ctx.fillRect(-r, -r * 0.05, r * 2, r * 0.22);
  ctx.restore();
  // 脸
  eyes(ctx, u, t, flip * r * 0.1, -r * 0.6, r * 0.32, r * 0.16, true);
  if (angry) {
    for (const side of [-1, 1]) {
      circlePath(ctx, flip * r * 0.1 + side * r * 0.32, -r * 0.6, r * 0.07);
      ctx.fillStyle = '#ff4d4d';
      ctx.fill();
    }
  }
  // 八字胡
  ctx.beginPath();
  ctx.moveTo(flip * r * 0.1, -r * 0.32);
  ctx.quadraticCurveTo(flip * r * 0.1 - r * 0.35, -r * 0.18, flip * r * 0.1 - r * 0.45, -r * 0.35);
  ctx.moveTo(flip * r * 0.1, -r * 0.32);
  ctx.quadraticCurveTo(flip * r * 0.1 + r * 0.35, -r * 0.18, flip * r * 0.1 + r * 0.45, -r * 0.35);
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 王冠
  ctx.save();
  ctx.translate(0, -r * 1.3);
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, 6);
  ctx.lineTo(-r * 0.6, -10);
  ctx.lineTo(-r * 0.3, -2);
  ctx.lineTo(0, -14);
  ctx.lineTo(r * 0.3, -2);
  ctx.lineTo(r * 0.6, -10);
  ctx.lineTo(r * 0.55, 6);
  ctx.closePath();
  ctx.fillStyle = '#f2c94c';
  ctx.fill();
  stroke(ctx, 2.2);
  for (const x of [-0.3, 0, 0.3]) {
    circlePath(ctx, x * r, 1, 3);
    ctx.fillStyle = x === 0 ? '#ff6fb5' : '#7ee8fa';
    ctx.fill();
  }
  ctx.restore();
}
