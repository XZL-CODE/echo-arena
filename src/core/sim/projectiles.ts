// 弹丸：飞行、撞墙反弹、盾牌格挡与反射、命中后的弹射与穿透。
import { MODULE_TUNING, SIM } from '../content/tuning.js';
import { dist2, normalize, turnToward, wrapAngle } from '../math.js';
import type { Obstacle, Projectile, Unit } from './entities.js';
import { nearestOpponent } from './query.js';
import type { World } from './world.js';

export function updateProjectiles(world: World, dt: number): void {
  for (const p of world.projectiles) {
    if (!p.alive) continue;
    p.px = p.x;
    p.py = p.y;
    seek(world, p, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
      world.emit({ type: 'fizzle', x: p.x, y: p.y, team: p.team });
      continue;
    }
    if (!handleWalls(world, p)) continue;
    if (!handleObstacles(world, p)) continue;
    for (const u of world.units) {
      if (!u.alive || u.team === p.team || p.hitIds.includes(u.id)) continue;
      const rr = u.radius + p.radius;
      if (dist2(p.x, p.y, u.x, u.y) > rr * rr) continue;
      onHit(world, p, u);
      if (!p.alive) break;
    }
  }
  world.projectiles = world.projectiles.filter((p) => p.alive);
}

/** 追踪目标：反射、弹射和转向后的弹丸会可靠地飞向它指向的单位。 */
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

function handleWalls(world: World, p: Projectile): boolean {
  let nx = 0;
  let ny = 0;
  if (p.x < p.radius) {
    p.x = p.radius;
    nx = 1;
  } else if (p.x > world.width - p.radius) {
    p.x = world.width - p.radius;
    nx = -1;
  }
  if (p.y < p.radius) {
    p.y = p.radius;
    ny = 1;
  } else if (p.y > world.height - p.radius) {
    p.y = world.height - p.radius;
    ny = -1;
  }
  if (nx === 0 && ny === 0) return true;
  return bounceOrDie(world, p, nx, ny, p.x, p.y);
}

/** 撞墙：有反弹次数就按法线反弹并提升回响，否则消失。 */
function bounceOrDie(
  world: World,
  p: Projectile,
  nx: number,
  ny: number,
  x: number,
  y: number,
): boolean {
  if (p.wallBounce <= 0) {
    p.alive = false;
    world.emit({ type: 'fizzle', x, y, team: p.team });
    return false;
  }
  const n = normalize(nx, ny);
  const vn = p.vx * n.x + p.vy * n.y;
  if (vn < 0) {
    p.vx -= 2 * vn * n.x;
    p.vy -= 2 * vn * n.y;
  }
  p.wallBounce--;
  p.echo++;
  p.hitIds = [];
  p.seekId = 0;
  if (p.team === 0 && p.kind !== 'bigshot') p.source = 'rubber';
  if (p.homing) {
    const target = nearestOpponent(world, x, y, p.team);
    if (target) {
      p.seekId = target.id;
      p.seekTurn = MODULE_TUNING.rubber.homingTurn;
    }
  }
  if (!world.result && p.team === 0) world.stats.bounces++;
  world.emit({ type: 'bounce', x, y, echo: p.echo });
  world.echoEvent(x, y, p.echo, p.chain, p.source, p.team);
  return true;
}

function handleObstacles(world: World, p: Projectile): boolean {
  for (const o of world.obstacles) {
    const rr = o.r + p.radius;
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > rr * rr) continue;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d;
    const ny = dy / d;
    if (o.kind === 'mirrorpost') {
      if (p.team === 1) redirectAtMirror(world, p, o, nx, ny);
      continue;
    }
    p.x = o.x + nx * (rr + 0.5);
    p.y = o.y + ny * (rr + 0.5);
    if (o.kind === 'spring') {
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        p.vx -= 2 * vn * nx;
        p.vy -= 2 * vn * ny;
      }
      o.hitAt = world.t;
      world.emit({ type: 'spring', x: o.x, y: o.y, obstacleId: o.id });
      continue;
    }
    if (!bounceOrDie(world, p, nx, ny, o.x + nx * o.r, o.y + ny * o.r)) return false;
  }
  return true;
}

/** 镜桩：敌方弹丸转为我方，飞向离镜桩最近的对手。 */
function redirectAtMirror(world: World, p: Projectile, o: Obstacle, nx: number, ny: number): void {
  o.hitAt = world.t;
  p.team = 0;
  p.source = 'mirrorpost';
  p.echo++;
  p.reflects++;
  p.hitIds = [];
  p.ricochet = 0;
  p.x = o.x + nx * (o.r + p.radius + 1);
  p.y = o.y + ny * (o.r + p.radius + 1);
  const speed = Math.max(Math.hypot(p.vx, p.vy), 420);
  const target = nearestOpponent(world, o.x, o.y, 0);
  if (target) {
    const dir = normalize(target.x - p.x, target.y - p.y);
    p.vx = dir.x * speed;
    p.vy = dir.y * speed;
    p.seekId = target.id;
    p.seekTurn = 12;
  } else {
    p.vx = nx * speed;
    p.vy = ny * speed;
  }
  p.life = Math.max(p.life, 2);
  if (!world.result) world.stats.reflects++;
  world.emit({ type: 'redirect', x: o.x, y: o.y, echo: p.echo });
  world.echoEvent(o.x, o.y, p.echo, p.chain, 'mirrorpost', 0);
}

/** 阿铁装备反射盾后获得的正面盾牌角度（半角）。 */
export const REFLECT_SHIELD_ARC = (62 * Math.PI) / 180;

/** 单位当前的正面盾牌；阿铁只有装备反射盾时才有盾。 */
export function shieldOf(world: World, u: Unit): { arc: number; reflect: boolean } | null {
  if (u.kind === 'guard') {
    return world.level('reflect') > 0 ? { arc: REFLECT_SHIELD_ARC, reflect: true } : null;
  }
  return u.def.shield ?? null;
}

/** 弹丸是否从单位正面的盾牌角度内飞来。贯穿大弹无视盾牌。 */
function shieldBlocks(world: World, u: Unit, p: Projectile): { reflect: boolean } | null {
  const shield = shieldOf(world, u);
  if (!shield || p.kind === 'bigshot') return null;
  const incoming = Math.atan2(p.y - u.y, p.x - u.x);
  return Math.abs(wrapAngle(incoming - u.facing)) <= shield.arc ? shield : null;
}

function onHit(world: World, p: Projectile, u: Unit): void {
  const shield = shieldBlocks(world, u, p);
  if (shield) {
    u.blockAt = world.t;
    if (shield.reflect && p.reflects < SIM.maxReflects) {
      reflect(world, p, u);
      return;
    }
    if (p.wallBounce > 0) {
      // 橡皮弹碰到盾牌会弹开，寻的弹丸改找别的目标。
      const n = normalize(p.x - u.x, p.y - u.y, -1, 0);
      p.x = u.x + n.x * (u.radius + p.radius + 1);
      p.y = u.y + n.y * (u.radius + p.radius + 1);
      world.emit({ type: 'block', unitId: u.id, x: p.x, y: p.y, team: u.team });
      bounceOrDie(world, p, n.x, n.y, p.x, p.y);
      if (p.homing) {
        const next = nearestOpponent(world, p.x, p.y, p.team, [u.id]);
        if (next) p.seekId = next.id;
      }
      return;
    }
    p.alive = false;
    world.emit({ type: 'block', unitId: u.id, x: p.x, y: p.y, team: u.team });
    if (!world.result) {
      if (u.team === 1) world.stats.blockedByEnemy++;
      else world.stats.blockedByGuard++;
    }
    return;
  }

  const owner = world.unitById(p.ownerId);
  world.damage(u, p.damage, {
    team: p.team,
    source: p.source,
    echo: p.echo,
    chain: p.chain,
    attackerKind: owner?.kind,
  });
  if (p.knock > 0 && u.alive) {
    let dir = normalize(p.vx, p.vy);
    if (p.kind === 'bigshot') {
      // 贯穿大弹把沿线敌人向两侧推开。
      const side = -(u.x - p.x) * dir.y + (u.y - p.y) * dir.x;
      const s = side >= 0 ? 1 : -1;
      dir = normalize(dir.x * 0.6 - dir.y * s, dir.y * 0.6 + dir.x * s);
    }
    world.knock(u, dir.x, dir.y, p.knock, {
      team: p.team,
      echo: p.echo,
      chain: p.chain,
      source: p.source,
    });
  }
  p.hitIds.push(u.id);
  if (p.pierce > 0) {
    p.pierce--;
    return;
  }
  if (p.ricochet > 0 && ricochet(world, p, u)) return;
  p.alive = false;
}

function ricochet(world: World, p: Projectile, from: Unit): boolean {
  const next = nearestOpponent(world, from.x, from.y, p.team, p.hitIds, p.ricochetRange);
  if (!next) return false;
  p.ricochet--;
  p.echo++;
  const speed = Math.max(Math.hypot(p.vx, p.vy), 480);
  const dir = normalize(next.x - from.x, next.y - from.y);
  p.x = from.x + dir.x * (from.radius + p.radius + 1);
  p.y = from.y + dir.y * (from.radius + p.radius + 1);
  p.vx = dir.x * speed;
  p.vy = dir.y * speed;
  p.seekId = next.id;
  p.seekTurn = 14;
  p.life = Math.max(p.life, 1.5);
  if (p.team === 0 && p.source !== 'reflect') p.source = 'ricochet';
  if (!world.result && p.team === 0) world.stats.ricochets++;
  world.emit({ type: 'ricochet', x1: from.x, y1: from.y, x2: next.x, y2: next.y, echo: p.echo });
  world.echoEvent(from.x, from.y, p.echo, p.chain, p.source, p.team);
  return true;
}

/** 反射：弹丸改为反射者一方，飞回原射手（射手已倒下则飞向最近的对手）。 */
function reflect(world: World, p: Projectile, u: Unit): void {
  const newTeam = u.team;
  p.team = newTeam;
  p.reflects++;
  p.echo++;
  p.hitIds = [];
  const shooter = world.unitById(p.ownerId);
  const target =
    shooter && shooter.alive && shooter.team !== newTeam
      ? shooter
      : nearestOpponent(world, u.x, u.y, newTeam);
  p.ownerId = u.id;
  const speed = Math.max(Math.hypot(p.vx, p.vy), 380) * 1.05;
  const dir = target ? normalize(target.x - u.x, target.y - u.y) : normalize(-p.vx, -p.vy);
  p.x = u.x + dir.x * (u.radius + p.radius + 2);
  p.y = u.y + dir.y * (u.radius + p.radius + 2);
  p.vx = dir.x * speed;
  p.vy = dir.y * speed;
  p.seekId = target ? target.id : 0;
  p.seekTurn = 8;
  p.life = Math.max(p.life, 2.2);
  p.wallBounce = 0;
  p.homing = false;
  p.pierce = 0;
  if (newTeam === 0) {
    p.source = 'reflect';
    const lv2 = world.level('reflect') >= 2;
    p.ricochet = lv2 ? MODULE_TUNING.reflect.ricochetsLv2 : 0;
    p.ricochetRange = MODULE_TUNING.reflect.ricochetRange;
    if (!world.result) world.stats.reflects++;
  } else {
    p.source = 'enemy';
    p.ricochet = 0;
    if (!world.result) world.stats.reflectedByEnemy++;
  }
  world.emit({ type: 'reflect', unitId: u.id, x: p.x, y: p.y, echo: p.echo, team: newTeam });
  world.echoEvent(p.x, p.y, p.echo, p.chain, p.source, newTeam);
}
