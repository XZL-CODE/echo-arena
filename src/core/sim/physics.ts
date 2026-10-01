// 移动积分、击飞滑行、撞墙与单位碰撞。
// 被对方技能击飞的单位撞到别的单位或墙时产生撞击：双方受伤，回响 +1，被撞的一方也被撞开，链条继续。
import { SIM } from '../content/tuning.js';
import type { Unit } from './entities.js';
import type { DamageInfo, World } from './world.js';

const WALL_RESTITUTION = 0.45;
const UNIT_RESTITUTION = 0.6;
/** 两次撞击之间的最短间隔，避免贴在一起时每帧都算一次。 */
const IMPACT_COOLDOWN = 0.25;

/** 撞击伤害：击飞者攻击力 ×（0.35 + 撞击速度 / 900）。 */
export function impactDamage(power: number, speed: number): number {
  return power * (0.35 + speed / 900);
}

export function integrate(world: World, dt: number): void {
  for (const u of world.units) {
    if (!u.alive) continue;
    if (u.impactCooldown > 0) u.impactCooldown -= dt;
    const speed = Math.hypot(u.vx, u.vy);
    if (speed > 0) {
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      const next = Math.max(0, speed - SIM.friction * dt);
      const k = next / speed;
      u.vx *= k;
      u.vy *= k;
      if (next < SIM.slideSpeed) u.slide = null;
    }
    u.x += u.mvx * dt;
    u.y += u.mvy * dt;
    keepInArena(world, u);
  }

  const alive = world.units.filter((u) => u.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      resolvePair(world, alive[i] as Unit, alive[j] as Unit);
    }
  }
}

function keepInArena(world: World, u: Unit): void {
  const r = u.radius;
  if (u.x < r) {
    u.x = r;
    wallContact(world, u, 1, 0);
  } else if (u.x > world.width - r) {
    u.x = world.width - r;
    wallContact(world, u, -1, 0);
  }
  if (u.y < r) {
    u.y = r;
    wallContact(world, u, 0, 1);
  } else if (u.y > world.height - r) {
    u.y = world.height - r;
    wallContact(world, u, 0, -1);
  }
}

/** 被对方技能击飞（普通攻击的小幅击退不算）：撞到东西会产生撞击。 */
function knockedBySkill(u: Unit): boolean {
  return u.slide !== null && u.slide.team !== u.team && u.slide.source !== 'basic';
}

/** 撞墙：沿法线反弹；被对方技能击飞的单位撞墙会受伤并提升回响。 */
function wallContact(world: World, u: Unit, nx: number, ny: number): void {
  const vn = u.vx * nx + u.vy * ny;
  if (vn >= 0) return;
  const speedIn = -vn;
  u.vx -= (1 + WALL_RESTITUTION) * vn * nx;
  u.vy -= (1 + WALL_RESTITUTION) * vn * ny;
  const slide = u.slide;
  if (!slide || !knockedBySkill(u) || speedIn < SIM.impactMinSpeed) return;
  if (u.impactCooldown > 0) return;
  u.impactCooldown = IMPACT_COOLDOWN;
  const echo = Math.min(SIM.echoCap, slide.echo + 1);
  slide.echo = echo;
  const x = u.x - nx * u.radius;
  const y = u.y - ny * u.radius;
  if (!world.result && slide.team === 0) world.stats.impacts++;
  world.echoEvent(x, y, echo, slide.chain, 'impact', slide.team);
  world.emit({ type: 'impact', x, y, strength: speedIn, echo });
  world.damage(u, impactDamage(slide.power, speedIn), impactInfo(u, echo));
}

function impactInfo(striker: Unit, echo: number): DamageInfo {
  const slide = striker.slide;
  return {
    team: slide ? slide.team : striker.team === 0 ? 1 : 0,
    sourceId: slide?.ownerId ?? 0,
    source: 'impact',
    element: slide?.element ?? striker.element,
    echo,
    chain: slide?.chain ?? 0,
  };
}

function resolvePair(world: World, a: Unit, b: Unit): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minD = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return;
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const d = Math.sqrt(d2);
  const nx = d > 1e-6 ? dx / d : 1;
  const ny = d > 1e-6 ? dy / d : 0;

  const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rvn < 0 && (a.slide || b.slide)) {
    const j = (-(1 + UNIT_RESTITUTION) * rvn) / (invA + invB);
    a.vx -= j * invA * nx;
    a.vy -= j * invA * ny;
    b.vx += j * invB * nx;
    b.vy += j * invB * ny;
    if (-rvn > SIM.impactMinSpeed) unitImpact(world, a, b, -rvn);
  }

  const overlap = minD - d;
  const corr = (overlap / (invA + invB)) * 0.6;
  a.x -= nx * corr * invA;
  a.y -= ny * corr * invA;
  b.x += nx * corr * invB;
  b.y += ny * corr * invB;
}

/**
 * 被对方技能击飞的单位撞上另一个单位：撞人者受伤；被撞者如果也是击飞者的对手，
 * 一起受伤并被撞开，回响沿着链条传下去。
 */
function unitImpact(world: World, a: Unit, b: Unit, speed: number): void {
  let striker: Unit | null = null;
  let struck: Unit | null = null;
  if (knockedBySkill(a)) {
    striker = a;
    struck = b;
  } else if (knockedBySkill(b)) {
    striker = b;
    struck = a;
  }
  if (!striker || !struck || !striker.slide) return;
  if (striker.impactCooldown > 0 || struck.impactCooldown > 0) return;
  const slide = striker.slide;
  const echo = Math.min(SIM.echoCap, slide.echo + 1);
  slide.echo = echo;
  striker.impactCooldown = IMPACT_COOLDOWN;
  struck.impactCooldown = IMPACT_COOLDOWN;
  const hurtStruck = struck.team !== slide.team;
  if (hurtStruck && Math.hypot(struck.vx, struck.vy) > SIM.slideSpeed) {
    struck.slide = { ...slide, echo };
    world.interrupt(struck);
  }
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  if (!world.result && slide.team === 0) world.stats.impacts++;
  world.echoEvent(x, y, echo, slide.chain, 'impact', slide.team);
  world.emit({ type: 'impact', x, y, strength: speed, echo });
  const damage = impactDamage(slide.power, speed);
  const info = impactInfo(striker, echo);
  world.damage(striker, damage, info);
  if (hurtStruck) world.damage(struck, damage, info);
}
