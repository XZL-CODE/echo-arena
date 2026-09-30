// 常用的空间查询。单位数量有上限，线性扫描足够快，也保证遍历顺序稳定。
import { dist, dist2, segmentDist2 } from '../math.js';
import type { Team } from '../types.js';
import type { Unit } from './entities.js';
import type { World } from './world.js';

/** 两单位边缘之间的距离。 */
export function edgeDist(a: Unit, b: Unit): number {
  return Math.sqrt(dist2(a.x, a.y, b.x, b.y)) - a.radius - b.radius;
}

/** 离 (x, y) 最近的、属于 team 对手的存活单位（中心距离）。 */
export function nearestOpponent(
  world: World,
  x: number,
  y: number,
  team: Team,
  exclude: readonly number[] = [],
  maxRange = Infinity,
): Unit | null {
  let best: Unit | null = null;
  let bestD2 = maxRange * maxRange;
  for (const u of world.units) {
    if (!u.alive || u.team === team || exclude.includes(u.id)) continue;
    const d2 = dist2(x, y, u.x, u.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = u;
    }
  }
  return best;
}

/** 圆内（按单位边缘计）的存活单位；team 为要找的那一方。 */
export function unitsInRadius(world: World, x: number, y: number, r: number, team: Team): Unit[] {
  return world.units.filter(
    (u) => u.alive && u.team === team && dist(x, y, u.x, u.y) <= r + u.radius,
  );
}

/** 线段（半宽 halfWidth）覆盖到的存活单位。 */
export function unitsOnSegment(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfWidth: number,
  team: Team,
): Unit[] {
  return world.units.filter((u) => {
    if (!u.alive || u.team !== team) return false;
    const r = halfWidth + u.radius;
    return segmentDist2(u.x, u.y, ax, ay, bx, by) <= r * r;
  });
}

export function centroid(units: readonly Unit[]): { x: number; y: number } | null {
  if (units.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / units.length, y: y / units.length };
}

export interface Cluster {
  x: number;
  y: number;
  count: number;
  members: Unit[];
}

/**
 * 敌人最密集的地方：以离 (x, y) 不超过 reach 的每个敌人为中心，数半径 radius 内的敌人，
 * 取最多的一组（相同则取更近的），返回这组敌人的中心。team 为施放者一方。
 */
export function densestCluster(
  world: World,
  team: Team,
  x: number,
  y: number,
  reach: number,
  radius: number,
): Cluster | null {
  const foes = world.units.filter((u) => u.alive && u.team !== team);
  let best: Cluster | null = null;
  let bestD = Infinity;
  for (const c of foes) {
    const d = dist(x, y, c.x, c.y) - c.radius;
    if (d > reach) continue;
    const members = foes.filter((u) => dist(c.x, c.y, u.x, u.y) <= radius + u.radius * 0.5);
    const count = members.length;
    if (!best || count > best.count || (count === best.count && d < bestD)) {
      const center = centroid(members) as { x: number; y: number };
      best = { x: center.x, y: center.y, count, members };
      bestD = d;
    }
  }
  return best;
}

/** 生命比例最低的单位。 */
export function lowestHpRatio(units: readonly Unit[]): Unit | null {
  let best: Unit | null = null;
  for (const u of units) {
    if (!best || u.hp / u.maxHp < best.hp / best.maxHp) best = u;
  }
  return best;
}
