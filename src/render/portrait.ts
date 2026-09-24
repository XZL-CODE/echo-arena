// 头像：用与战场相同的绘制代码，把单位画进一个小画布（界面卡片使用）。
import { unitDef } from '../core/content/units.js';
import { Rng } from '../core/rng.js';
import type { Unit } from '../core/sim/entities.js';
import type { UnitKind } from '../core/types.js';
import type { Looks } from './renderer.js';
import { drawUnit, UNIT_DRAW_SCALE } from './units.js';

const cache = new Map<string, string>();

function fakeUnit(kind: UnitKind): Unit {
  const def = unitDef(kind);
  return {
    id: 7,
    kind,
    def,
    team: def.team,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    mvx: 0,
    mvy: 0,
    facing: def.team === 0 ? 0.25 : Math.PI - 0.25,
    hp: def.hp,
    maxHp: def.hp,
    radius: def.radius,
    mass: def.mass,
    speed: def.speed,
    alive: true,
    diedAt: 0,
    state: 'idle',
    stateTime: 0,
    cooldown: 0,
    targetId: 0,
    aimX: 0,
    aimY: 0,
    stun: 0,
    slide: null,
    impactCooldown: 0,
    tauntBy: 0,
    tauntTime: 0,
    resonance: 0,
    shieldHp: 0,
    shieldTime: 0,
    held: false,
    rng: new Rng(1),
    shots: 0,
    timerA: 0,
    timerB: 0,
    timerC: 0,
    phase: 1,
    pending: '',
    spawnedBy: 0,
    active: null,
    activeCd: 0,
    dashX: 0,
    dashY: 0,
    dashLeft: 0,
    dashHits: [],
    dashChain: 0,
    hitAt: -9,
    attackAt: -9,
    blockAt: -9,
    healAt: -9,
    castAt: -9,
  };
}

/** 返回单位头像的 data URL（按种类与外观缓存）。 */
export function portrait(kind: UnitKind, looks: Looks | null = null, size = 72): string {
  const key = `${kind}|${size}|${looks ? JSON.stringify(looks) : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  const dpr = 2;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const u = fakeUnit(kind);
  const extent = u.radius * UNIT_DRAW_SCALE * 2.9;
  const s = (size * dpr) / extent;
  ctx.setTransform(s, 0, 0, s, (size * dpr) / 2, size * dpr * 0.62);
  drawUnit(ctx, u, {
    x: 0,
    y: 0,
    t: 0.4,
    shield: looks?.shield ?? false,
    armor: looks?.armor ?? false,
    booster: looks?.booster ?? false,
    bellCharm: looks?.bellCharm ?? 'bow',
    appear: 1,
    selected: false,
    reduceFlashes: true,
  });
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
