// 造型用的颜色工具：渐变、混色、按高度/沿长度取色。
import * as THREE from 'three';
import type { ColorFn } from './rig.js';

export function mix(
  a: THREE.ColorRepresentation,
  b: THREE.ColorRepresentation,
  t: number,
): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 沿管子长度（t）的渐变：from 颜色在 t<a，to 颜色在 t>b。 */
export function alongT(
  from: THREE.ColorRepresentation,
  to: THREE.ColorRepresentation,
  a = 0.6,
  b = 0.85,
): ColorFn {
  const c0 = new THREE.Color(from);
  const c1 = new THREE.Color(to);
  return (_p, t) => c0.clone().lerp(c1, smooth(a, b, t));
}

/** 按局部坐标的某个轴渐变（例如耳朵尖、爪子）。 */
export function alongAxis(
  axis: 'x' | 'y' | 'z',
  from: THREE.ColorRepresentation,
  to: THREE.ColorRepresentation,
  a: number,
  b: number,
): ColorFn {
  const c0 = new THREE.Color(from);
  const c1 = new THREE.Color(to);
  return (p) => c0.clone().lerp(c1, smooth(a, b, p[axis]));
}

/** 身体下半部分（腹部）用另一种颜色，交界柔和。 */
export function belly(
  top: THREE.ColorRepresentation,
  under: THREE.ColorRepresentation,
  level: number,
  soft = 0.02,
  frontOnly = -1,
): ColorFn {
  const c0 = new THREE.Color(top);
  const c1 = new THREE.Color(under);
  return (p) => {
    let k = 1 - smooth(level - soft, level + soft, p.y);
    if (frontOnly > -1) k *= smooth(frontOnly - soft, frontOnly + soft, p.z);
    return c0.clone().lerp(c1, k);
  };
}

/** 任意条件取色：cond 为真的顶点用 b。 */
export function where(
  a: THREE.ColorRepresentation,
  b: THREE.ColorRepresentation,
  cond: (p: THREE.Vector3) => number,
): ColorFn {
  const c0 = new THREE.Color(a);
  const c1 = new THREE.Color(b);
  return (p) => c0.clone().lerp(c1, Math.max(0, Math.min(1, cond(p))));
}

export { smooth };
