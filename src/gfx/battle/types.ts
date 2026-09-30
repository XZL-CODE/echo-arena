// 画面层读取的战斗状态（规则层的 World 在结构上满足这些接口）。
// 模拟坐标：1 像素 = 1 厘米，x 向右、y 向下（朝镜头）；世界坐标：米，x 向右、z 朝镜头。
import * as THREE from 'three';

export type ElementId = 'fire' | 'water' | 'wood' | 'rock' | 'thunder';

export interface ViewUnit {
  id: number;
  uid: number;
  team: 0 | 1;
  species: string;
  form: number;
  element: ElementId;
  role: string;
  x: number;
  y: number;
  px: number;
  py: number;
  facing: number;
  radius: number;
  hp: number;
  maxHp: number;
  shield: number;
  energy: number;
  alive: boolean;
  diedAt: number;
  act: string;
  actAt: number;
  actDur: number;
  stun: number;
  airborne: number;
  root: number;
  burn: number;
  taunt: number;
  guard: number;
  stoneSkin: number;
  hitAt: number;
  spawnAt: number;
}

export interface ViewProjectile {
  id: number;
  kind: string;
  team: 0 | 1;
  x: number;
  y: number;
  px: number;
  py: number;
  z: number;
  vx: number;
  vy: number;
  element: ElementId;
  echo: number;
  alive: boolean;
}

export interface ViewZone {
  id: number;
  kind: string;
  team: 0 | 1;
  x: number;
  y: number;
  r: number;
  angle?: number;
  length?: number;
  t: number;
  duration: number;
}

export interface ViewWorld {
  units: readonly ViewUnit[];
  projectiles: readonly ViewProjectile[];
  zones: readonly ViewZone[];
  t: number;
  focusId: number;
  result: 'win' | 'lose' | null;
  /** 交战区尺寸（模拟像素）；缺省时沿用上一次的。 */
  width?: number;
  height?: number;
}

/** 交战区尺寸（模拟像素），由规则层的场地决定；世界坐标以它的中心为原点。 */
export const FIELD_PX = { width: 1800, height: 1100 };

/** 换场地尺寸（返回是否有变化）。 */
export function setFieldSize(width: number, height: number): boolean {
  if (FIELD_PX.width === width && FIELD_PX.height === height) return false;
  FIELD_PX.width = width;
  FIELD_PX.height = height;
  return true;
}

/** 模拟坐标 → 世界坐标（地面）。 */
export function toWorld(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((x - FIELD_PX.width / 2) / 100, 0, (y - FIELD_PX.height / 2) / 100);
}

/** 世界坐标 → 模拟坐标。 */
export function toSim(p: THREE.Vector3): { x: number; y: number } {
  return { x: p.x * 100 + FIELD_PX.width / 2, y: p.z * 100 + FIELD_PX.height / 2 };
}

export const TEAM_RIM: Record<0 | 1, number> = { 0: 0x7fe6ff, 1: 0xff7a6a };
export const TEAM_COLOR: Record<0 | 1, number> = { 0: 0x3aa8ff, 1: 0xff5a5a };

export const ELEMENT_COLOR: Record<ElementId, { main: number; light: number; dark: number }> = {
  fire: { main: 0xff6a2a, light: 0xffe27a, dark: 0xb8201a },
  water: { main: 0x3ab8ff, light: 0xbff4ff, dark: 0x1a5ab8 },
  wood: { main: 0x5ad06a, light: 0xd8ffb0, dark: 0x1e7a3a },
  rock: { main: 0xd8a060, light: 0xffe0b0, dark: 0x7a4a2a },
  thunder: { main: 0xffe45a, light: 0xffffff, dark: 0x8a6ad8 },
};
