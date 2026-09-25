// 二维数学小工具。规则层只用纯函数和普通对象，便于测试与序列化。

export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** 返回单位向量；长度为 0 时返回给定的备用方向。 */
export function normalize(x: number, y: number, fallbackX = 1, fallbackY = 0): Vec {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return { x: fallbackX, y: fallbackY };
  return { x: x / len, y: y / len };
}

/** 把角度规整到 (-π, π]。 */
export function wrapAngle(angle: number): number {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** 以最大角速度把 current 转向 target。 */
export function turnToward(current: number, target: number, maxStep: number): number {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * maxStep);
}

/** 点到线段的最近距离的平方。 */
export function segmentDist2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1) : 0;
  return dist2(px, py, ax + abx * t, ay + aby * t);
}
