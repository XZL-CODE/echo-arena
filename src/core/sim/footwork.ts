// 步法：远距离接近时走弧线、左右迂回；近战出手后后撤或绕着目标侧移，敏捷的近战不时从目标身边
// 绕到另一侧（交叉换位）；远程在两次射击之间横移并保持距离。
// 步法只改变走位，攻击节奏基本不变，也不产生冲刺、瞬身之类的技能事件。
// 随机都来自单位自己的种子随机流，结果可复现。
import { ARENA, SIM } from '../content/tuning.js';
import { clamp, dist, normalize } from '../math.js';
import type { FootMove, Footwork, Unit } from './entities.js';
import { faceToward } from './motion.js';
import { edgeDist } from './query.js';
import type { World } from './world.js';

/** 远于这个距离才走弧线；越接近弧度越小，到达时为 0。 */
const WEAVE_MIN = 150;
/** 弧线偏移的上限与占剩余距离的比例。 */
const WEAVE_MAX = 120;
const WEAVE_RATIO = 0.33;

export function isRanged(u: Unit): boolean {
  return u.range > 60;
}

/** 物种的灵活程度：近战出手后做闪避步法的概率。 */
export function agility(u: Unit): number {
  if (u.role === 'boss') return 0.2;
  switch (u.species) {
    case 'fox':
    case 'cat':
    case 'wolf':
    case 'bunny':
      return 0.55;
    case 'bear':
    case 'turtle':
      return 0.2;
    default:
      return 0.35;
  }
}

interface WalkOptions {
  tag: Footwork;
  mul?: number;
  /** 面朝的点；不给时面朝行进方向。 */
  face?: { x: number; y: number };
}

/** 行走：朝目标点走，同时和身边的单位保持距离（队友之间让得更多），不叠在一起。 */
export function walk(
  world: World,
  u: Unit,
  tx: number,
  ty: number,
  dt: number,
  o: WalkOptions,
): void {
  if (u.root > 0) {
    if (o.face) faceToward(u, o.face.x, o.face.y, dt);
    stand(world, u);
    return;
  }
  const gx = clamp(tx, u.radius, ARENA.width - u.radius);
  const gy = clamp(ty, u.radius, ARENA.height - u.radius);
  const dx = gx - u.x;
  const dy = gy - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) {
    if (o.face) faceToward(u, o.face.x, o.face.y, dt);
    stand(world, u);
    return;
  }
  let sx = dx / d;
  let sy = dy / d;
  for (const other of world.units) {
    if (other === u || !other.alive) continue;
    const ox = u.x - other.x;
    const oy = u.y - other.y;
    const minD = u.radius + other.radius + 8;
    const d2 = ox * ox + oy * oy;
    if (d2 >= minD * minD || d2 < 1e-6) continue;
    const od = Math.sqrt(d2);
    const push = ((minD - od) / minD) * (other.team === u.team ? 1.4 : 0.5);
    sx += (ox / od) * push;
    sy += (oy / od) * push;
  }
  const dir = normalize(sx, sy, dx / d, dy / d);
  const speed = Math.min(u.speed * (o.mul ?? 1), d / SIM.dt);
  u.mvx = dir.x * speed;
  u.mvy = dir.y * speed;
  if (o.face) faceToward(u, o.face.x, o.face.y, dt);
  else faceToward(u, u.x + dir.x, u.y + dir.y, dt);
  u.footwork = o.tag;
  world.setAct(u, 'move', 0);
}

/** 站定（可以在原地出手或施法）。 */
export function stand(world: World, u: Unit): void {
  u.footwork = 'none';
  if (u.act === 'move') world.setAct(u, 'idle', 0);
}

/**
 * 接近目标点：远时朝偏向自己包抄一侧的点走，并叠加平滑的左右迂回，走出弧线；
 * 越接近偏移越小。远距离面朝行进方向，近了面朝 lookAt。
 */
export function approach(
  world: World,
  u: Unit,
  gx: number,
  gy: number,
  dt: number,
  lookAt: { x: number; y: number },
): void {
  const dx = gx - u.x;
  const dy = gy - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= WEAVE_MIN) {
    walk(world, u, gx, gy, dt, { tag: 'approach', face: lookAt });
    return;
  }
  const fade = clamp((d - WEAVE_MIN) / 250, 0, 1);
  const amp = Math.min(WEAVE_MAX, d * WEAVE_RATIO) * fade;
  const wave = u.flank * 0.55 + 0.45 * Math.sin(u.weavePhase + world.t * u.weaveFreq);
  walk(world, u, gx - (dy / d) * amp * wave, gy + (dx / d) * amp * wave, dt, { tag: 'approach' });
}

/** 继续当前的步法；返回 true 表示这一步在走步法。 */
export function continueFootwork(world: World, u: Unit, target: Unit, dt: number): boolean {
  const m = u.foot;
  if (!m) return false;
  m.t += dt;
  // 后撤、侧移、横移都在攻击冷却里进行：冷却好了就停下出手，攻击节奏基本不变。
  const ready = m.kind !== 'cross' && u.attackCd <= 0;
  if (u.root > 0 || !target.alive || target.id !== m.targetId || m.t >= m.dur || ready) {
    u.foot = null;
    return false;
  }
  if (m.kind === 'step' || m.kind === 'strafe') {
    walk(world, u, m.tx, m.ty, dt, { tag: m.kind, mul: m.speedMul, face: target });
    return true;
  }
  const k = clamp(m.t / m.dur, 0, 1);
  const a = m.angle + m.sweep * k;
  const tx = target.x + Math.cos(a) * m.radius;
  const ty = target.y + Math.sin(a) * m.radius;
  // 绕身侧移时面朝目标；交叉换位是快速跑动，面朝行进方向。
  const face = m.kind === 'circle' ? target : undefined;
  walk(world, u, tx, ty, dt, { tag: m.kind, mul: m.speedMul, face });
  return true;
}

function newMove(kind: FootMove['kind'], target: Unit, dur: number, speedMul: number): FootMove {
  return {
    kind,
    t: 0,
    dur,
    targetId: target.id,
    angle: 0,
    sweep: 0,
    radius: 0,
    tx: 0,
    ty: 0,
    speedMul,
  };
}

/** 基础攻击出手之后：近战可能后撤、侧移或交叉换位，远程开始横移。 */
export function afterBasic(world: World, u: Unit, target: Unit): void {
  if (!target.alive || u.root > 0) return;
  if (isRanged(u)) {
    startStrafe(world, u, target);
    return;
  }
  if (agility(u) >= 0.5 && world.t >= u.crossAt) {
    u.crossAt = world.t + u.rng.range(3, 6);
    if (u.rng.next() < 0.5) {
      startCross(u, target);
      return;
    }
  }
  if (u.rng.next() >= agility(u)) return;
  const dur = Math.min(u.rng.range(0.25, 0.5), Math.max(0.15, u.attackCd * 0.7));
  const angle = Math.atan2(u.y - target.y, u.x - target.x);
  if (u.rng.next() < 0.5) {
    // 后撤一小步，保持面朝目标。
    const away = u.rng.range(40, 70);
    const m = newMove('step', target, dur, 1.2);
    m.tx = u.x + Math.cos(angle) * away;
    m.ty = u.y + Math.sin(angle) * away;
    u.foot = m;
  } else {
    // 绕着目标侧移 30–70 度，方向随机。
    const m = newMove('circle', target, dur, 1.2);
    m.angle = angle;
    m.sweep = (u.rng.next() < 0.5 ? -1 : 1) * u.rng.range(30, 70) * (Math.PI / 180);
    m.radius = dist(u.x, u.y, target.x, target.y);
    u.foot = m;
  }
}

/** 交叉换位：沿弧线从目标身边绕到另一侧，之后从新的一侧继续打。 */
function startCross(u: Unit, target: Unit): void {
  const radius = target.radius + u.radius + Math.max(u.range, 18) + 12;
  const angle = Math.atan2(u.y - target.y, u.x - target.x);
  const sweep = (u.rng.next() < 0.5 ? -1 : 1) * Math.PI;
  const m = newMove('cross', target, (radius * Math.PI) / (u.speed * 1.5), 1.5);
  m.angle = angle;
  m.sweep = sweep;
  m.radius = radius;
  u.foot = m;
  u.slot = angle + sweep;
}

/**
 * 远程横移：垂直于目标方向走 30–60 像素，每 1–2 秒换一次方向；
 * 同时往保持距离（最大射程的 70–90%）靠拢。
 */
export function startStrafe(world: World, u: Unit, target: Unit): void {
  if (world.t >= u.strafeSwitchAt) {
    u.strafeDir = u.strafeDir === 1 ? -1 : 1;
    u.strafeSwitchAt = world.t + u.rng.range(1, 2);
  }
  const to = normalize(target.x - u.x, target.y - u.y, u.team === 0 ? 1 : -1, 0);
  const hold = u.range * u.holdFactor;
  const radial = clamp((edgeDist(u, target) - hold) / Math.max(1, hold), -0.6, 0.6);
  const dir = normalize(-to.y * u.strafeDir + to.x * radial, to.x * u.strafeDir + to.y * radial);
  const length = u.rng.range(30, 60);
  const m = newMove('strafe', target, length / (u.speed * 0.8) + 0.1, 0.8);
  m.tx = u.x + dir.x * length;
  m.ty = u.y + dir.y * length;
  u.foot = m;
}
