// 移动积分、击飞滑行、撞墙与台球式碰撞。
import { MODULE_TUNING, SIM } from '../content/tuning.js';
import type { Obstacle, Unit } from './entities.js';
import type { World } from './world.js';

const WALL_RESTITUTION = 0.45;
const UNIT_RESTITUTION = 0.6;
const LOUD_BUMP_SPEED = 260;

export function impactDamage(world: World, speed: number): number {
  const tune = MODULE_TUNING.impact;
  const base = tune.base + tune.perSpeed * speed;
  return world.level('impact') >= 2 ? base * tune.lv2Mult : base;
}

export function integrate(world: World, dt: number): void {
  for (const u of world.units) {
    if (!u.alive) continue;
    if (u.impactCooldown > 0) u.impactCooldown -= dt;
    if (u.def.immovable) {
      u.vx = 0;
      u.vy = 0;
      continue;
    }
    const speed = Math.hypot(u.vx, u.vy);
    if (speed > 0) {
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      const next = Math.max(0, speed - SIM.friction * dt);
      const k = next / speed;
      u.vx *= k;
      u.vy *= k;
      if (next < SIM.slideSpeed && !u.held) u.slide = null;
    }
    u.x += u.mvx * dt;
    u.y += u.mvy * dt;
    keepInArena(world, u);
    for (const o of world.obstacles) collideObstacle(world, u, o);
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

/** 撞上墙或柱子：法线方向反弹；被我方击飞的对手在撞击招式下受伤并提升回响。 */
function wallContact(world: World, u: Unit, nx: number, ny: number): void {
  const vn = u.vx * nx + u.vy * ny;
  if (vn >= 0) return;
  const speedIn = -vn;
  u.vx -= (1 + WALL_RESTITUTION) * vn * nx;
  u.vy -= (1 + WALL_RESTITUTION) * vn * ny;
  if (!u.slide || speedIn < SIM.impactMinSpeed) return;
  const x = u.x - nx * u.radius;
  const y = u.y - ny * u.radius;
  const slide = u.slide;
  const level = world.level('impact');
  const damaging = level > 0 && slide.team === 0 && u.team === 1 && u.impactCooldown <= 0;
  if (damaging) {
    const echo = slide.echo + 1;
    u.impactCooldown = 0.2;
    slide.echo = echo;
    if (!world.result) world.stats.impacts++;
    world.echoEvent(x, y, echo, slide.chain, 'impact', 0);
    world.emit({ type: 'impact', x, y, strength: speedIn, echo, damaging: true });
    world.damage(u, impactDamage(world, speedIn), {
      team: 0,
      source: 'impact',
      echo,
      chain: slide.chain,
    });
    if (level >= 2 && u.alive) u.stun = Math.max(u.stun, MODULE_TUNING.impact.lv2Stun);
  } else if (speedIn > LOUD_BUMP_SPEED) {
    world.emit({ type: 'impact', x, y, strength: speedIn, echo: 0, damaging: false });
  }
}

function collideObstacle(world: World, u: Unit, o: Obstacle): void {
  const dx = u.x - o.x;
  const dy = u.y - o.y;
  const minD = u.radius + o.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d;
  const ny = dy / d;
  u.x = o.x + nx * minD;
  u.y = o.y + ny * minD;
  if (o.kind === 'spring') springContact(world, u, o, nx, ny);
  else wallContact(world, u, nx, ny);
}

/** 弹簧桩：把撞上来的对手猛力弹开（回响 +1）；我方队员只有被击飞时才会被弹开。 */
function springContact(world: World, u: Unit, o: Obstacle, nx: number, ny: number): void {
  if (u.team === 0 && !u.slide) return;
  if (u.impactCooldown > 0) {
    wallContact(world, u, nx, ny);
    return;
  }
  const tune = MODULE_TUNING.spring;
  const vn = u.vx * nx + u.vy * ny;
  const speedIn = Math.max(0, -vn);
  const out = Math.max(speedIn * 1.2, tune.bounceSpeed / Math.sqrt(u.mass));
  const tx = u.vx - vn * nx;
  const ty = u.vy - vn * ny;
  u.vx = tx * 0.6 + nx * out;
  u.vy = ty * 0.6 + ny * out;
  u.impactCooldown = 0.25;
  o.hitAt = world.t;
  world.emit({ type: 'spring', x: o.x, y: o.y, obstacleId: o.id });
  if (u.team !== 1) return;

  const prev = u.slide;
  const fromPlayer = prev !== null && prev.team === 0;
  const echo = fromPlayer ? prev.echo + 1 : 1;
  const chain = fromPlayer ? prev.chain : world.newChain();
  u.slide = { team: 0, echo, chain, source: 'spring' };
  if (u.state === 'windup') world.interrupt(u);
  world.echoEvent(o.x + nx * o.r, o.y + ny * o.r, echo, chain, 'spring', 0);
  world.damage(u, tune.damage, { team: 0, source: 'spring', echo, chain });
}

function resolvePair(world: World, a: Unit, b: Unit): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minD = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return;
  const invA = a.def.immovable ? 0 : 1 / a.mass;
  const invB = b.def.immovable ? 0 : 1 / b.mass;
  if (invA + invB === 0) return;
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
    const speed = -rvn;
    if (speed > SIM.impactMinSpeed) unitImpact(world, a, b, speed);
  }

  const overlap = minD - d;
  const corr = (overlap / (invA + invB)) * 0.6;
  a.x -= nx * corr * invA;
  a.y -= ny * corr * invA;
  b.x += nx * corr * invB;
  b.y += ny * corr * invB;
}

/** 被我方击飞的对手撞上另一个对手：双方受伤，被撞者也被撞开，回响沿着链条传下去。 */
function unitImpact(world: World, a: Unit, b: Unit, speed: number): void {
  let striker: Unit | null = null;
  let struck: Unit | null = null;
  if (a.slide?.team === 0 && a.team === 1 && b.team === 1) {
    striker = a;
    struck = b;
  } else if (b.slide?.team === 0 && b.team === 1 && a.team === 1) {
    striker = b;
    struck = a;
  }
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  const level = world.level('impact');
  if (
    striker &&
    struck &&
    striker.slide &&
    level > 0 &&
    striker.impactCooldown <= 0 &&
    struck.impactCooldown <= 0
  ) {
    const slide = striker.slide;
    const echo = slide.echo + 1;
    const chain = slide.chain;
    const damage = impactDamage(world, speed);
    striker.impactCooldown = 0.2;
    struck.impactCooldown = 0.2;
    slide.echo = echo;
    struck.slide = { team: 0, echo, chain, source: 'impact' };
    if (struck.state === 'windup') world.interrupt(struck);
    if (level >= 2) struck.stun = Math.max(struck.stun, MODULE_TUNING.impact.lv2Stun);
    if (!world.result) world.stats.impacts++;
    world.echoEvent(x, y, echo, chain, 'impact', 0);
    world.emit({ type: 'impact', x, y, strength: speed, echo, damaging: true });
    world.damage(striker, damage, { team: 0, source: 'impact', echo, chain });
    world.damage(struck, damage, { team: 0, source: 'impact', echo, chain });
  } else if (speed > LOUD_BUMP_SPEED) {
    world.emit({ type: 'impact', x, y, strength: speed, echo: 0, damaging: false });
  }
}
