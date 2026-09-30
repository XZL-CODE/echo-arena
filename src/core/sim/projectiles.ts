// 弹丸：飞行、抛射落地、泡泡与玄甲的反射、水墙反射、命中后的弹射、穿透、爆炸与晶片。
import { SKILLS } from '../content/species.js';
import { ENERGY, SIM } from '../content/tuning.js';
import {
  clamp,
  dist,
  dist2,
  lerp,
  normalize,
  segmentDist2,
  turnToward,
  wrapAngle,
} from '../math.js';
import type { Team } from '../types.js';
import type { Projectile, Unit, Zone } from './entities.js';
import { nearestOpponent } from './query.js';
import type { World } from './world.js';

export function updateProjectiles(world: World, dt: number): void {
  for (const p of world.projectiles) {
    if (!p.alive) continue;
    p.px = p.x;
    p.py = p.y;
    if (p.lob) {
      updateLob(world, p, dt);
      continue;
    }
    seek(world, p, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.trailZoneId) updateTrail(world, p);
    if (crossWaterWall(world, p)) continue;
    if (p.life <= 0) {
      expire(world, p);
      continue;
    }
    if (p.x < -20 || p.x > world.width + 20 || p.y < -20 || p.y > world.height + 20) {
      p.alive = false;
      continue;
    }
    const team = p.team;
    for (const u of world.units) {
      if (!u.alive || u.team === p.team || p.hitIds.includes(u.id)) continue;
      const rr = u.radius + p.radius;
      if (dist2(p.x, p.y, u.x, u.y) > rr * rr) continue;
      onHit(world, p, u);
      // 被反射后换了阵营，这一步不再判定命中。
      if (!p.alive || p.team !== team) break;
    }
  }
  world.projectiles = world.projectiles.filter((p) => p.alive);
}

/** 追踪目标：反射、弹射后的弹丸会可靠地飞向它指向的单位。 */
function seek(world: World, p: Projectile, dt: number): void {
  if (!p.seekId) return;
  const target = world.unitById(p.seekId);
  if (!target || !target.alive || target.team === p.team) {
    p.seekId = 0;
    return;
  }
  const speed = Math.hypot(p.vx, p.vy);
  const current = Math.atan2(p.vy, p.vx);
  const wanted = Math.atan2(target.y - p.y, target.x - p.x);
  const next = turnToward(current, wanted, p.seekTurn * dt);
  p.vx = Math.cos(next) * speed;
  p.vy = Math.sin(next) * speed;
}

/** 抛射：沿直线飞向出手时就定好的落点，高度走抛物线；陨石从高处直落。 */
function updateLob(world: World, p: Projectile, dt: number): void {
  p.t += dt;
  const s = clamp(p.t / p.flight, 0, 1);
  p.x = lerp(p.fromX, p.tx, s);
  p.y = lerp(p.fromY, p.ty, s);
  p.z = p.kind === 'meteor' ? p.peak * (1 - s) : 4 * p.peak * s * (1 - s);
  if (s < 1) return;
  p.alive = false;
  p.z = 0;
  const hits = detonate(world, p, p.tx, p.ty);
  if (hits > 0 && p.source === 'basic') giveBasicEnergy(world, p);
}

/** 凤凰飞过的地方留下燃烧带：燃烧带的长度跟着凤凰延伸。 */
function updateTrail(world: World, p: Projectile): void {
  const zone = world.zones.find((z) => z.id === p.trailZoneId);
  if (!zone) return;
  zone.length = dist(zone.x, zone.y, clamp(p.x, 0, world.width), clamp(p.y, 0, world.height));
}

function expire(world: World, p: Projectile): void {
  p.alive = false;
  if (p.blastAtEnd) detonate(world, p, p.x, p.y);
}

function giveBasicEnergy(world: World, p: Projectile): void {
  const owner = world.unitById(p.ownerId);
  if (owner) world.gainEnergy(owner, ENERGY.perBasicHit);
}

function onHit(world: World, p: Projectile, u: Unit): void {
  if (p.reflectable && u.shield > 0) {
    // 泡泡护盾：弹丸被弹回去，泡泡按弹丸伤害消耗。
    u.shield -= p.damage;
    if (u.shield <= 0) {
      u.shield = 0;
      u.shieldTime = 0;
    }
    reflect(world, p, u.team, u.id, u.x, u.y, u.radius, 0);
    return;
  }
  if (p.reflectable && u.guard > 0 && fromFront(u, p)) {
    const form = Math.min(3, Math.max(1, u.form));
    const ricochet = SKILLS.turtle.skill.ricochet[form - 1] ?? 0;
    reflect(world, p, u.team, u.id, u.x, u.y, u.radius, ricochet);
    return;
  }

  const first = p.hitIds.length === 0;
  p.hitIds.push(u.id);
  if (p.splash > 0 && p.pierce <= 0) {
    p.alive = false;
    detonate(world, p, p.x, p.y);
  } else {
    world.damage(u, p.damage, {
      team: p.team,
      sourceId: p.ownerId,
      source: p.source,
      element: p.element,
      echo: p.echo,
      chain: p.chain,
      burst: p.burst,
    });
    applyOnHit(world, p, u);
  }
  if (first && p.source === 'basic') giveBasicEnergy(world, p);
  if (!p.alive) return;
  if (p.pierce > 0) {
    p.pierce--;
    return;
  }
  if (p.ricochet > 0 && ricochet(world, p, u)) return;
  p.alive = false;
}

function applyOnHit(world: World, p: Projectile, u: Unit): void {
  if (!u.alive) return;
  if (p.burnDps > 0) world.burnUnit(u, p.burnDps, p.burnTime, p.ownerId, p.source);
  if (p.stun > 0) world.stunUnit(u, p.stun);
  if (p.knock > 0) {
    const dir = normalize(p.vx, p.vy);
    const owner = world.unitById(p.ownerId);
    world.knock(u, dir.x, dir.y, p.knock, {
      team: p.team,
      ownerId: p.ownerId,
      echo: p.echo,
      chain: p.chain,
      source: p.source,
      power: owner?.atk ?? p.damage,
      element: p.element,
    });
  }
}

/** 正面半角内飞来的弹丸（玄甲壁）。 */
function fromFront(u: Unit, p: Projectile): boolean {
  const incoming = Math.atan2(p.y - u.y, p.x - u.x);
  return Math.abs(wrapAngle(incoming - u.facing)) <= SKILLS.turtle.skill.arc;
}

/**
 * 反射：弹丸改为反射者一方，回响 +1，飞回原射手（射手已倒下则飞向最近的对手）。
 * 每颗弹丸最多被反射 SIM.maxReflects 次，之后直接被吸收，避免两边来回弹个不停。
 */
function reflect(
  world: World,
  p: Projectile,
  team: Team,
  reflectorId: number,
  x: number,
  y: number,
  radius: number,
  ricochet: number,
): void {
  if (p.reflects >= SIM.maxReflects) {
    p.alive = false;
    return;
  }
  p.team = team;
  p.reflects++;
  p.echo = Math.min(SIM.echoCap, p.echo + 1);
  p.hitIds = [];
  const shooter = world.unitById(p.shooterId);
  const target =
    shooter && shooter.alive && shooter.team !== team
      ? shooter
      : nearestOpponent(world, x, y, team);
  p.ownerId = reflectorId;
  p.shooterId = reflectorId;
  p.source = 'reflect';
  p.ricochet = ricochet;
  p.pierce = 0;
  const speed = Math.max(Math.hypot(p.vx, p.vy), 380) * 1.05;
  const dir = target ? normalize(target.x - x, target.y - y) : normalize(-p.vx, -p.vy);
  p.x = x + dir.x * (radius + p.radius + 2);
  p.y = y + dir.y * (radius + p.radius + 2);
  p.vx = dir.x * speed;
  p.vy = dir.y * speed;
  p.seekId = target ? target.id : 0;
  p.seekTurn = 8;
  p.life = Math.max(p.life, 2.2);
  if (!world.result && team === 0) world.stats.reflects++;
  world.emit({ type: 'reflect', unitId: reflectorId, x: p.x, y: p.y, echo: p.echo });
  world.echoEvent(p.x, p.y, p.echo, p.chain, 'reflect', team);
}

/** 敌方弹丸碰到水墙（玄武壁垒）会被弹回。 */
function crossWaterWall(world: World, p: Projectile): boolean {
  if (!p.reflectable) return false;
  for (const z of world.zones) {
    if (z.kind !== 'waterWall' || z.team === p.team) continue;
    const [ax, ay, bx, by] = zoneSegment(z);
    const r = z.r + p.radius;
    if (segmentDist2(p.x, p.y, ax, ay, bx, by) > r * r) continue;
    reflect(world, p, z.team, z.ownerId, p.x, p.y, 0, 0);
    // 弹回后先离开水墙，避免同一步再次判定。
    const n = normalize(p.vx, p.vy);
    p.x += n.x * (z.r + p.radius + 2);
    p.y += n.y * (z.r + p.radius + 2);
    return true;
  }
  return false;
}

/** 线形区域的两个端点。 */
export function zoneSegment(z: Zone): [number, number, number, number] {
  const angle = z.angle ?? 0;
  const length = z.length ?? 0;
  return [z.x, z.y, z.x + Math.cos(angle) * length, z.y + Math.sin(angle) * length];
}

function ricochet(world: World, p: Projectile, from: Unit): boolean {
  const next = nearestOpponent(world, from.x, from.y, p.team, p.hitIds, p.ricochetRange);
  if (!next) return false;
  p.ricochet--;
  p.echo = Math.min(SIM.echoCap, p.echo + 1);
  const speed = Math.max(Math.hypot(p.vx, p.vy), 480);
  const dir = normalize(next.x - from.x, next.y - from.y);
  p.x = from.x + dir.x * (from.radius + p.radius + 1);
  p.y = from.y + dir.y * (from.radius + p.radius + 1);
  p.vx = dir.x * speed;
  p.vy = dir.y * speed;
  p.seekId = next.id;
  p.seekTurn = 14;
  p.life = Math.max(p.life, 1.2);
  if (!world.result && p.team === 0) world.stats.chains++;
  world.emit({
    type: 'chain',
    x1: from.x,
    y1: from.y,
    x2: next.x,
    y2: next.y,
    echo: p.echo,
    element: p.element,
  });
  world.echoEvent(from.x, from.y, p.echo, p.chain, p.source, p.team);
  return true;
}

/** 爆炸、留下燃烧地面、向外飞出晶片。返回爆炸波及的单位数。 */
function detonate(world: World, p: Projectile, x: number, y: number): number {
  let hits = 0;
  if (p.splash > 0) {
    hits = world.blast({
      x,
      y,
      radius: p.splash,
      damage: p.damage,
      team: p.team,
      sourceId: p.ownerId,
      source: p.source,
      element: p.element,
      echo: p.echo,
      chain: p.chain,
      knock: p.knock,
      stun: p.stun,
      burnDps: p.burnDps,
      burnTime: p.burnTime,
      burst: p.burst,
    });
  }
  if (p.groundDps > 0 && p.groundTime > 0) {
    world.addZone({
      kind: 'burn',
      team: p.team,
      x,
      y,
      r: Math.max(p.splash, 60),
      duration: p.groundTime,
      ownerId: p.ownerId,
      source: p.source,
      element: p.element,
      chain: p.chain,
      damage: p.groundDps,
    });
  }
  if (p.shards > 0) shatter(world, p, x, y);
  return hits;
}

/** 晶簇碎裂：晶片均匀地向四周飞出，每片命中第一个碰到的敌人（回响 +1）。 */
function shatter(world: World, p: Projectile, x: number, y: number): void {
  const echo = Math.min(SIM.echoCap, p.echo + 1);
  const owner = world.unitById(p.ownerId);
  const offset = owner ? owner.rng.range(0, Math.PI * 2) : 0;
  for (let i = 0; i < p.shards; i++) {
    const a = offset + (i / p.shards) * Math.PI * 2;
    world.spawnProjectile({
      kind: 'shard',
      team: p.team,
      x: x + Math.cos(a) * 12,
      y: y + Math.sin(a) * 12,
      vx: Math.cos(a) * p.shardSpeed,
      vy: Math.sin(a) * p.shardSpeed,
      element: p.element,
      damage: p.shardDamage,
      radius: 5,
      ownerId: p.ownerId,
      source: p.source,
      chain: p.chain,
      echo,
      life: p.shardRange / p.shardSpeed,
    });
  }
  world.echoEvent(x, y, echo, p.chain, p.source, p.team);
}
