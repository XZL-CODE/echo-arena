// 常用的空间查询。
import { dist2, segmentDist2 } from '../math.js';
import type { Team } from '../types.js';
import type { Unit } from './entities.js';
import type { World } from './world.js';

/** 离 (x, y) 最近的、属于 team 对手的存活单位。 */
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

/** 两单位边缘之间的距离。 */
export function edgeDist(a: Unit, b: Unit): number {
  return Math.sqrt(dist2(a.x, a.y, b.x, b.y)) - a.radius - b.radius;
}

/** 从 a 到 b 的直线是否没有被柱子（或弹簧桩）挡住。 */
export function clearShot(world: World, a: Unit, b: Unit, projectileRadius = 5): boolean {
  for (const o of world.obstacles) {
    if (o.kind === 'mirrorpost') continue;
    const r = o.r + projectileRadius;
    if (segmentDist2(o.x, o.y, a.x, a.y, b.x, b.y) < r * r) return false;
  }
  return true;
}
