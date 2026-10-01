// 技能共用的类型与小工具：挑目标、结算伤害、击飞信息。
import { ARENA, SIM } from '../content/tuning.js';
import { dist, normalize } from '../math.js';
import type { DamageSource, Form, Team } from '../types.js';
import type { Action, Projectile, ProjectileKind, SlideInfo, Unit } from './entities.js';
import { forward } from './motion.js';
import { edgeDist } from './query.js';
import type { DamageInfo, World } from './world.js';

/** 施放计划：目标单位（0 表示只看位置）与目标位置。 */
export interface SkillPlan {
  targetId: number;
  x: number;
  y: number;
}

export interface SkillHandler {
  /** 现在值不值得放；值得就给出目标，否则 null（等下一次）。 */
  plan(world: World, u: Unit): SkillPlan | null;
  /** 前摇结束时生效。需要多段过程（冲刺、瞬身）时把 action.phase 设为 2。 */
  fire(world: World, u: Unit, a: Action): void;
  /** 多段过程的推进，返回 true 表示结束。 */
  tick?(world: World, u: Unit, a: Action, dt: number): boolean;
}

export function other(team: Team): Team {
  return team === 0 ? 1 : 0;
}

export function opponents(world: World, u: Unit): Unit[] {
  return world.units.filter((e) => e.alive && e.team !== u.team);
}

export function allies(world: World, u: Unit): Unit[] {
  return world.units.filter((a) => a.alive && a.team === u.team);
}

/** 按形态取数组里的值（1–3 阶）。 */
export function byForm<T>(values: readonly T[], form: Form): T {
  return values[Math.min(values.length, form) - 1] as T;
}

/** 玩家一方的集火目标（对手一方不理会集火）。 */
export function focusTarget(world: World, u: Unit): Unit | null {
  if (u.team !== 0 || !world.focusId) return null;
  const f = world.unitById(world.focusId);
  return f && f.alive ? f : null;
}

/** 边缘距离不超过 reach 的对手里离得最近的一个；有集火目标且够得着时优先它。 */
export function targetInReach(world: World, u: Unit, reach: number): Unit | null {
  const focus = focusTarget(world, u);
  if (focus && edgeDist(u, focus) <= reach) return focus;
  if (u.taunt > 0) {
    const t = world.unitById(u.tauntBy);
    if (t && t.alive && edgeDist(u, t) <= reach) return t;
  }
  let best: Unit | null = null;
  let bestD = reach;
  for (const e of opponents(world, u)) {
    const d = edgeDist(u, e);
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function planOn(target: Unit | null): SkillPlan | null {
  return target ? { targetId: target.id, x: target.x, y: target.y } : null;
}

export function planAt(x: number, y: number): SkillPlan {
  return { targetId: 0, x, y };
}

export function damageInfo(u: Unit, source: DamageSource, chain: number, echo = 0): DamageInfo {
  return { team: u.team, sourceId: u.id, source, element: u.element, echo, chain };
}

/** 以施放者攻击力的 mult 倍伤害命中目标。 */
export function strike(
  world: World,
  u: Unit,
  target: Unit,
  mult: number,
  source: DamageSource,
  chain: number,
  echo = 0,
): number {
  return world.damage(target, u.atk * mult, damageInfo(u, source, chain, echo));
}

export function slideInfo(u: Unit, source: DamageSource, chain: number, echo = 0): SlideInfo {
  return {
    team: u.team,
    ownerId: u.id,
    echo,
    chain,
    source,
    power: u.atk,
    element: u.element,
  };
}

/**
 * 一次“传递”（额外命中、连锁跳跃）：记回响事件，计入我方的连锁次数。
 * 回响等级在调用处决定。
 */
export function transfer(
  world: World,
  u: Unit,
  x: number,
  y: number,
  echo: number,
  chain: number,
  source: DamageSource,
): void {
  if (echo <= 0) return;
  if (!world.result && u.team === 0) world.stats.chains++;
  world.echoEvent(x, y, Math.min(echo, SIM.echoCap), chain, source, u.team);
}

/** 从 (x, y) 出发，按“最近的下一个”依次串起至多 count 个对手。 */
export function nearestPath(world: World, u: Unit, x: number, y: number, count: number): Unit[] {
  const pool = opponents(world, u);
  const out: Unit[] = [];
  let cx = x;
  let cy = y;
  while (out.length < count && pool.length > 0) {
    let bestIndex = 0;
    let bestD = Infinity;
    pool.forEach((e, i) => {
      const d = dist(cx, cy, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        bestIndex = i;
      }
    });
    const next = pool.splice(bestIndex, 1)[0] as Unit;
    out.push(next);
    cx = next.x;
    cy = next.y;
  }
  return out;
}

/** 生命最低（绝对值）的对手。 */
export function lowestHp(units: readonly Unit[]): Unit | null {
  let best: Unit | null = null;
  for (const u of units) if (!best || u.hp < best.hp) best = u;
  return best;
}

type ProjectileExtra = Partial<Projectile> & Pick<Projectile, 'damage'>;

/** 朝 (tx, ty) 平射一颗弹丸。 */
export function shootAt(
  world: World,
  u: Unit,
  tx: number,
  ty: number,
  kind: ProjectileKind,
  speed: number,
  extra: ProjectileExtra,
): Projectile {
  const dir = normalize(tx - u.x, ty - u.y, forward(u), 0);
  u.facing = Math.atan2(dir.y, dir.x);
  return world.spawnProjectile({
    kind,
    team: u.team,
    x: u.x + dir.x * (u.radius + 4),
    y: u.y + dir.y * (u.radius + 4),
    vx: dir.x * speed,
    vy: dir.y * speed,
    element: u.element,
    ownerId: u.id,
    tx,
    ty,
    ...extra,
  });
}

/** 抛射到 (tx, ty)：落点在出手时就确定，飞行中不会被挡下，也不能被反射。 */
export function lobTo(
  world: World,
  u: Unit,
  tx: number,
  ty: number,
  kind: ProjectileKind,
  flight: number,
  peak: number,
  extra: ProjectileExtra,
): Projectile {
  const x = extra.fromX ?? u.x;
  const y = extra.fromY ?? u.y;
  return world.spawnProjectile({
    kind,
    team: u.team,
    x,
    y,
    vx: (tx - x) / flight,
    vy: (ty - y) / flight,
    element: u.element,
    ownerId: u.id,
    lob: true,
    fromX: x,
    fromY: y,
    tx,
    ty,
    flight,
    peak,
    life: flight + 1,
    reflectable: false,
    ...extra,
  });
}

/** 预判目标走位后的瞄准点（只算一部分，走动中的目标仍有机会躲开）。 */
export function leadPoint(u: Unit, target: Unit, speed: number): { x: number; y: number } {
  const t = (dist(u.x, u.y, target.x, target.y) / Math.max(1, speed)) * 0.7;
  return { x: target.x + (target.mvx + target.vx) * t, y: target.y + (target.mvy + target.vy) * t };
}

/** 从 (x, y) 沿方向 (dx, dy) 到场地边缘的距离。 */
export function rayToWall(x: number, y: number, dx: number, dy: number): number {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (ARENA.width - x) / dx);
  if (dx < -1e-9) t = Math.min(t, -x / dx);
  if (dy > 1e-9) t = Math.min(t, (ARENA.height - y) / dy);
  if (dy < -1e-9) t = Math.min(t, -y / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * 沿 action.path 的当前路点冲刺一步；沿途碰到的对手各处理一次（action.hits 记录）。
 * 到达路点（或冲不动了）返回 true。
 */
export function dashStep(
  world: World,
  u: Unit,
  a: Action,
  speed: number,
  dt: number,
  onContact: (e: Unit) => void,
): boolean {
  const wp = a.path[a.step];
  if (!wp) return true;
  const dx = wp.x - u.x;
  const dy = wp.y - u.y;
  const d = Math.hypot(dx, dy);
  const move = Math.min(d, speed * dt);
  if (d > 1e-6) {
    u.x += (dx / d) * move;
    u.y += (dy / d) * move;
    u.facing = Math.atan2(dy, dx);
  }
  for (const e of opponents(world, u)) {
    if (a.hits.includes(e.id)) continue;
    if (dist(u.x, u.y, e.x, e.y) > u.radius + e.radius + 6) continue;
    a.hits.push(e.id);
    onContact(e);
  }
  a.timer += dt;
  return d - move < 1 || a.timer > 2;
}

/** 冲锋撞到对手：造成伤害，往路线两侧（带一点向前）撞飞，可附带眩晕。 */
export function ram(
  world: World,
  u: Unit,
  e: Unit,
  a: Action,
  source: DamageSource,
  mult: number,
  knock: number,
  stun: number,
): void {
  strike(world, u, e, mult, source, a.chain);
  if (!e.alive) return;
  const fx = Math.cos(u.facing);
  const fy = Math.sin(u.facing);
  const side = (e.x - u.x) * -fy + (e.y - u.y) * fx >= 0 ? 1 : -1;
  const n = normalize(-fy * side + fx * 0.5, fx * side + fy * 0.5, fx, fy);
  world.knock(e, n.x, n.y, knock, slideInfo(u, source, a.chain));
  if (stun > 0) world.stunUnit(e, stun);
}
