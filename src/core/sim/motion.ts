// 朝向与场地边界的小工具，行为、技能与首领共用。
import { ARENA } from '../content/tuning.js';
import { clamp, turnToward } from '../math.js';
import type { Point } from '../types.js';
import type { Unit } from './entities.js';

/** 转身角速度（弧度/秒）。 */
export const TURN_RATE = 9;

export function faceToward(u: Unit, x: number, y: number, dt: number, rate = TURN_RATE): void {
  if (Math.abs(x - u.x) < 1e-6 && Math.abs(y - u.y) < 1e-6) return;
  u.facing = turnToward(u.facing, Math.atan2(y - u.y, x - u.x), rate * dt);
}

export function faceNow(u: Unit, x: number, y: number): void {
  if (Math.abs(x - u.x) < 1e-6 && Math.abs(y - u.y) < 1e-6) return;
  u.facing = Math.atan2(y - u.y, x - u.x);
}

/** 把点限制在场地内（离边缘至少 pad）。 */
export function clampToArena(x: number, y: number, pad: number): Point {
  return {
    x: clamp(x, pad, ARENA.width - pad),
    y: clamp(y, pad, ARENA.height - pad),
  };
}

/** 本方的前进方向：玩家一方朝 +x，对手朝 -x。 */
export function forward(u: Unit): number {
  return u.team === 0 ? 1 : -1;
}
