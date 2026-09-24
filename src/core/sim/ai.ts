// 各类单位的行为。行为保持简单、稳定、可预期：玩家要能根据看到的东西推断改动的效果。
import { MODULE_TUNING, SIM } from '../content/tuning.js';
import { clamp, dist, normalize, turnToward, wrapAngle } from '../math.js';
import type { Unit } from './entities.js';
import { shieldOf } from './projectiles.js';
import { centroid, clearShot, edgeDist, nearestOpponent } from './query.js';
import type { World } from './world.js';

export function updateUnit(world: World, u: Unit, dt: number): void {
  tickTimers(u, dt);
  u.mvx = 0;
  u.mvy = 0;

  if (u.state === 'dash') {
    updateGuardDash(world, u, dt);
    return;
  }
  if (u.state === 'charge') {
    updateKingCharge(world, u, dt);
    return;
  }
  if (u.slide || u.held) return;
  if (u.stun > 0) {
    u.stun -= dt;
    return;
  }
  if (u.state === 'stunned' || u.state === 'recover') {
    u.stateTime -= dt;
    if (u.stateTime <= 0) u.state = 'idle';
    return;
  }

  switch (u.kind) {
    case 'guard':
      updateGuard(world, u, dt);
      break;
    case 'slinger':
      updateSlinger(world, u, dt);
      break;
    case 'bell':
      updateBell(world, u, dt);
      break;
    case 'archer':
      updateArcher(world, u, dt);
      break;
    case 'mouse':
      updateMelee(world, u, dt, backlineTarget(world, u));
      break;
    case 'shell':
    case 'mirror':
    case 'brute':
      updateMelee(world, u, dt, enemyTarget(world, u));
      break;
    case 'bomber':
      updateBomber(world, u, dt);
      break;
    case 'snail':
      updateSnail(world, u, dt);
      break;
    case 'mortar':
      updateMortar(world, u, dt);
      break;
    case 'jack':
      updateJack(world, u, dt);
      break;
    case 'king':
      updateKing(world, u, dt);
      break;
  }
}

function tickTimers(u: Unit, dt: number): void {
  if (u.cooldown > 0) u.cooldown -= dt;
  if (u.activeCd > 0) u.activeCd = Math.max(0, u.activeCd - dt);
  if (u.tauntTime > 0) {
    u.tauntTime -= dt;
    if (u.tauntTime <= 0) u.tauntBy = 0;
  }
  if (u.resonance > 0) u.resonance -= dt;
  if (u.shieldTime > 0) {
    u.shieldTime -= dt;
    if (u.shieldTime <= 0) u.shieldHp = 0;
  }
}

// ---- 通用 ----

function face(u: Unit, x: number, y: number, dt: number, speedMul = 1): void {
  const wanted = Math.atan2(y - u.y, x - u.x);
  u.facing = turnToward(u.facing, wanted, u.def.turnRate * speedMul * dt);
}

/** 朝目标行走，并绕开柱子与机关。 */
function moveToward(world: World, u: Unit, tx: number, ty: number, speedMul = 1): void {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return;
  let nx = dx / d;
  let ny = dy / d;
  const px = -ny;
  const py = nx;
  for (const o of world.obstacles) {
    const ox = o.x - u.x;
    const oy = o.y - u.y;
    const ahead = ox * nx + oy * ny;
    const clear = o.r + u.radius + 10;
    if (ahead <= 0 || ahead > Math.min(d + o.r, clear + 90)) continue;
    const lateral = ox * px + oy * py;
    if (Math.abs(lateral) >= clear) continue;
    const push = ((clear - Math.abs(lateral)) / clear) * 1.6;
    const side = lateral > 0 ? -1 : 1;
    nx += px * side * push;
    ny += py * side * push;
  }
  const len = Math.hypot(nx, ny) || 1;
  let speed = u.speed * speedMul;
  speed = Math.min(speed, d / SIM.dt);
  u.mvx = (nx / len) * speed;
  u.mvy = (ny / len) * speed;
}

/** 对手的目标：被挑衅时只打阿铁，否则打最近的队员。 */
function enemyTarget(world: World, u: Unit): Unit | null {
  if (u.tauntBy) {
    const t = world.unitById(u.tauntBy);
    if (t && t.alive) return t;
  }
  return nearestOpponent(world, u.x, u.y, u.team);
}

/** 发条鼠：专挑生命上限最低的队员（后排）。 */
function backlineTarget(world: World, u: Unit): Unit | null {
  if (u.tauntBy) {
    const t = world.unitById(u.tauntBy);
    if (t && t.alive) return t;
  }
  let best: Unit | null = null;
  for (const t of world.units) {
    if (!t.alive || t.team === u.team) continue;
    if (
      !best ||
      t.maxHp < best.maxHp ||
      (t.maxHp === best.maxHp && dist(u.x, u.y, t.x, t.y) < dist(u.x, u.y, best.x, best.y))
    ) {
      best = t;
    }
  }
  return best;
}

/** 我方的目标：集火标记优先，否则最近的对手。 */
function playerTarget(world: World, u: Unit): Unit | null {
  if (world.focusId) {
    const f = world.unitById(world.focusId);
    if (f && f.alive) return f;
  }
  return nearestOpponent(world, u.x, u.y, u.team);
}

function startWindup(u: Unit, duration: number, targetId: number, pending = ''): void {
  u.state = 'windup';
  u.stateTime = duration;
  u.targetId = targetId;
  u.pending = pending;
}

function meleeStrike(world: World, u: Unit, t: Unit, heavy: boolean): void {
  u.attackAt = world.t;
  const chain = world.newChain();
  const team = u.team;
  world.emit({ type: 'melee', unitId: u.id, targetId: t.id, x: t.x, y: t.y, heavy });
  world.damage(t, u.def.damage, {
    team,
    source: team === 0 ? 'guard' : 'enemy',
    echo: 0,
    chain,
    attackerKind: u.kind,
  });
  if (u.def.knock > 0 && t.alive) {
    const n = normalize(t.x - u.x, t.y - u.y, team === 0 ? 1 : -1, 0);
    world.knock(t, n.x, n.y, u.def.knock, {
      team,
      echo: 0,
      chain,
      source: team === 0 ? 'guard' : 'enemy',
    });
  }
}

// ---- 我方 ----

function updateGuard(world: World, u: Unit, dt: number): void {
  if (world.level('bulwark') >= 2) {
    u.timerA -= dt;
    if (u.timerA <= 0) {
      const tune = MODULE_TUNING.bulwark;
      u.timerA = tune.tauntInterval;
      let any = false;
      for (const e of world.units) {
        if (!e.alive || e.team !== 1 || e.kind === 'jack') continue;
        if (dist(u.x, u.y, e.x, e.y) > tune.tauntRadius) continue;
        e.tauntBy = u.id;
        e.tauntTime = tune.tauntDuration;
        any = true;
      }
      if (any) {
        world.emit({
          type: 'pulse',
          unitId: u.id,
          x: u.x,
          y: u.y,
          radius: tune.tauntRadius,
          kind: 'taunt',
        });
      }
    }
  }

  if (u.state === 'windup') {
    const t = world.unitById(u.targetId);
    if (t && t.alive) face(u, t.x, t.y, dt);
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      if (t && t.alive && edgeDist(u, t) <= u.def.range + 10) meleeStrike(world, u, t, false);
    }
    return;
  }

  const target = playerTarget(world, u);
  if (!target) {
    u.state = 'idle';
    return;
  }
  u.targetId = target.id;
  face(u, target.x, target.y, dt);
  if (edgeDist(u, target) > u.def.range) {
    moveToward(world, u, target.x, target.y);
    u.state = 'move';
  } else if (u.cooldown <= 0) {
    startWindup(u, u.def.windup, target.id);
    u.cooldown = u.def.cooldown;
  } else {
    u.state = 'idle';
  }
}

/** 冲锋：沿直线高速前进，撞开沿途对手；撞到不可推动的目标、墙或柱子时停下。 */
function updateGuardDash(world: World, u: Unit, dt: number): void {
  if (u.slide) {
    u.state = 'idle';
    return;
  }
  const tune = MODULE_TUNING.charge;
  const step = Math.min(tune.speed * dt, u.dashLeft);
  u.x += u.dashX * step;
  u.y += u.dashY * step;
  u.dashLeft -= step;
  u.facing = Math.atan2(u.dashY, u.dashX);
  let stop = false;
  for (const e of world.units) {
    if (!e.alive || e.team !== 1 || u.dashHits.includes(e.id)) continue;
    if (dist(u.x, u.y, e.x, e.y) > u.radius + e.radius + 6) continue;
    u.dashHits.push(e.id);
    world.damage(e, tune.damage, {
      team: 0,
      source: 'charge',
      echo: 0,
      chain: u.dashChain,
      attackerKind: 'guard',
    });
    if (e.def.immovable || e.mass >= 10) {
      stop = true;
      continue;
    }
    const side = normalize(e.x - u.x, e.y - u.y, u.dashX, u.dashY);
    const dir = normalize(u.dashX * 0.8 + side.x, u.dashY * 0.8 + side.y);
    world.knock(e, dir.x, dir.y, tune.knock, {
      team: 0,
      echo: 0,
      chain: u.dashChain,
      source: 'charge',
    });
  }
  if (
    u.x < u.radius ||
    u.x > world.width - u.radius ||
    u.y < u.radius ||
    u.y > world.height - u.radius
  ) {
    stop = true;
  }
  for (const o of world.obstacles) {
    if (o.kind === 'pillar' && dist(u.x, u.y, o.x, o.y) < u.radius + o.r) stop = true;
  }
  if (u.dashLeft > 0 && !stop) return;

  u.state = 'recover';
  u.stateTime = 0.2;
  const quake = world.level('charge') >= 2;
  world.emit({ type: 'dashEnd', unitId: u.id, x: u.x, y: u.y, quake });
  if (!quake) return;
  for (const e of world.units) {
    if (!e.alive || e.team !== 1) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d > tune.quakeRadius + e.radius) continue;
    world.damage(e, tune.quakeDamage, {
      team: 0,
      source: 'charge',
      echo: 0,
      chain: u.dashChain,
      attackerKind: 'guard',
    });
    const n = normalize(e.x - u.x, e.y - u.y, u.dashX, u.dashY);
    world.knock(e, n.x, n.y, tune.quakeKnock, {
      team: 0,
      echo: 0,
      chain: u.dashChain,
      source: 'charge',
    });
  }
}

function slingerTarget(world: World, u: Unit): Unit | null {
  if (world.focusId) {
    const f = world.unitById(world.focusId);
    if (f && f.alive) return f;
  }
  // 优先射程内、视线不被柱子挡住、盾牌没有正对自己的最近对手。
  let best: Unit | null = null;
  let bestScore = Infinity;
  for (const e of world.units) {
    if (!e.alive || e.team === u.team) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d > u.def.range + 80) continue;
    if (!clearShot(world, u, e)) continue;
    const score = d + (shieldFaces(world, e, u.x, u.y) ? 260 : 0);
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best ?? nearestOpponent(world, u.x, u.y, u.team);
}

/** 从 (x, y) 射向 e 的弹丸会不会被 e 的正面盾牌挡住。 */
function shieldFaces(world: World, e: Unit, x: number, y: number): boolean {
  const shield = shieldOf(world, e);
  if (!shield) return false;
  const incoming = Math.atan2(y - e.y, x - e.x);
  return Math.abs(wrapAngle(incoming - e.facing)) <= shield.arc;
}

/** 后撤方向：远离威胁，同时偏向场地中央，避免被逼进角落。 */
function retreatPoint(world: World, u: Unit, threat: Unit): { x: number; y: number } {
  const away = normalize(u.x - threat.x, u.y - threat.y, -1, 0);
  const cx = (world.width / 2 - u.x) / world.width;
  const cy = (world.height / 2 - u.y) / world.height;
  const dir = normalize(away.x + cx * 1.6, away.y + cy * 1.6, away.x, away.y);
  return { x: u.x + dir.x * 90, y: u.y + dir.y * 90 };
}

function updateSlinger(world: World, u: Unit, dt: number): void {
  if (u.state === 'windup') {
    const t = world.unitById(u.targetId);
    if (t && t.alive) face(u, t.x, t.y, dt, 2);
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      if (t && t.alive) fireSlinger(world, u, t);
    }
    return;
  }
  const target = slingerTarget(world, u);
  if (!target) {
    u.state = 'idle';
    return;
  }
  u.targetId = target.id;
  face(u, target.x, target.y, dt);
  const d = dist(u.x, u.y, target.x, target.y);
  const rubber = world.level('rubber') > 0;
  const hasShot = rubber || clearShot(world, u, target);
  const canShoot = u.cooldown <= 0 && d <= u.def.range && hasShot;

  // 被近战贴身时后撤，同时见缝插针地射击。
  const threat = nearestOpponent(world, u.x, u.y, u.team);
  if (threat && threat.def.range <= 30 && edgeDist(u, threat) < 70) {
    if (canShoot) {
      startWindup(u, u.def.windup, target.id);
      return;
    }
    const to = retreatPoint(world, u, threat);
    moveToward(world, u, to.x, to.y);
    u.state = 'move';
    return;
  }
  if (d > u.def.range * 0.95 || !hasShot) {
    moveToward(world, u, target.x, target.y);
    u.state = 'move';
    return;
  }
  if (canShoot) startWindup(u, u.def.windup, target.id);
  else u.state = 'idle';
}

function fireSlinger(world: World, u: Unit, t: Unit): void {
  const heavy = world.level('heavy');
  const ricochet = world.level('ricochet');
  const rubber = world.level('rubber');
  const heavyTune = MODULE_TUNING.heavy;
  u.shots++;
  const big = heavy >= 2 && u.shots % 3 === 0;
  const speed = heavy > 0 ? 500 : (u.def.projectileSpeed ?? 560);
  const lead = dist(u.x, u.y, t.x, t.y) / speed;
  const tvx = (t.x - t.px) / SIM.dt;
  const tvy = (t.y - t.py) / SIM.dt;
  const dir = normalize(t.x + tvx * lead * 0.8 - u.x, t.y + tvy * lead * 0.8 - u.y, 1, 0);
  u.facing = Math.atan2(dir.y, dir.x);
  u.attackAt = world.t;
  const radius = big ? heavyTune.bigRadius : heavy > 0 ? 6 : (u.def.projectileRadius ?? 5);
  world.spawnProjectile({
    kind: big ? 'bigpellet' : 'pellet',
    team: 0,
    x: u.x + dir.x * (u.radius + 2),
    y: u.y + dir.y * (u.radius + 2),
    vx: dir.x * speed,
    vy: dir.y * speed,
    radius,
    damage: u.def.damage * (heavy > 0 ? heavyTune.damageMult : 1) * (big ? 1.4 : 1),
    knock: heavy > 0 ? (big ? heavyTune.bigKnock : heavyTune.knock) : 0,
    ownerId: u.id,
    source: heavy > 0 ? 'heavy' : 'slinger',
    ricochet:
      ricochet >= 2
        ? MODULE_TUNING.ricochet.countLv2
        : ricochet === 1
          ? MODULE_TUNING.ricochet.countLv1
          : 0,
    ricochetRange: MODULE_TUNING.ricochet.range,
    wallBounce: rubber > 0 ? MODULE_TUNING.rubber.bounces : 0,
    homing: rubber >= 2,
    pierce: big ? 1 : 0,
    life: 2.4,
  });
  u.cooldown = u.def.cooldown * (heavy > 0 ? heavyTune.cooldownMult : 1);
  world.emit({ type: 'shoot', unitId: u.id, x: u.x, y: u.y, angle: u.facing, big });
}

function updateBell(world: World, u: Unit, dt: number): void {
  const mend = world.level('mend');
  const magnet = world.level('magnet');
  const healRadius = u.def.range + (mend > 0 ? MODULE_TUNING.mend.radiusBonus : 0);
  const guard = world.playerUnit('guard');
  const anchor = guard && guard.alive ? guard : undefined;

  if (u.state === 'windup') {
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      bellPulse(world, u, healRadius, mend, magnet, anchor ?? u);
    }
    return;
  }

  const threat = nearestOpponent(world, u.x, u.y, u.team);
  if (threat) face(u, threat.x, threat.y, dt);
  const follow = anchor ?? world.units.find((t) => t.alive && t.team === 0 && t.kind === 'slinger');
  if (threat && edgeDist(u, threat) < (threat.def.range <= 30 ? 50 : 90)) {
    const to = retreatPoint(world, u, threat);
    moveToward(world, u, to.x, to.y);
    u.state = 'move';
  } else if (follow) {
    // 待在阿铁身后、偏向我方一侧，不跑进敌阵。
    const foes = world.aliveOf(1);
    const c = centroid(foes) ?? { x: world.width, y: world.height / 2 };
    const away = normalize(follow.x - c.x, follow.y - c.y, -1, 0);
    const back = normalize(away.x - 0.8, away.y, -1, 0);
    const wantX = clamp(follow.x + back.x * 85, 30, world.width - 30);
    const wantY = clamp(follow.y + back.y * 85, 30, world.height - 30);
    if (dist(u.x, u.y, wantX, wantY) > 14) {
      moveToward(world, u, wantX, wantY);
      u.state = 'move';
    } else {
      u.state = 'idle';
    }
  }

  if (u.cooldown > 0) return;
  const needsHeal = world.units.some(
    (a) =>
      a.alive &&
      a.team === 0 &&
      a.hp < a.maxHp - 1 &&
      dist(u.x, u.y, a.x, a.y) <= healRadius + a.radius,
  );
  const pullAnchor = anchor ?? u;
  const canPull =
    magnet > 0 &&
    world.units.some(
      (e) =>
        e.alive &&
        e.team === 1 &&
        !e.def.immovable &&
        dist(pullAnchor.x, pullAnchor.y, e.x, e.y) <= MODULE_TUNING.magnet.radius &&
        edgeDist(pullAnchor, e) > 30,
    );
  if (needsHeal || canPull) {
    startWindup(u, u.def.windup, 0);
    u.cooldown = u.def.cooldown;
  }
}

function bellPulse(
  world: World,
  u: Unit,
  radius: number,
  mend: number,
  magnet: number,
  anchor: Unit,
): void {
  u.attackAt = world.t;
  const heal = u.def.damage * (mend > 0 ? MODULE_TUNING.mend.healMult : 1);
  for (const a of world.units) {
    if (!a.alive || a.team !== 0) continue;
    if (dist(u.x, u.y, a.x, a.y) > radius + a.radius) continue;
    world.heal(a, heal, u.x, u.y);
    if (mend >= 2) {
      a.shieldHp = MODULE_TUNING.mend.shield;
      a.shieldTime = MODULE_TUNING.mend.shieldTime;
    }
  }
  world.emit({ type: 'pulse', unitId: u.id, x: u.x, y: u.y, radius, kind: 'heal' });
  if (magnet <= 0) return;

  const tune = MODULE_TUNING.magnet;
  const chain = world.newChain();
  let any = false;
  for (const e of world.units) {
    if (!e.alive || e.team !== 1 || e.def.immovable) continue;
    const d = dist(anchor.x, anchor.y, e.x, e.y);
    if (d > tune.radius) continue;
    const gap = d - anchor.radius - e.radius - 12;
    if (gap <= 0) continue;
    const n = normalize(anchor.x - e.x, anchor.y - e.y);
    const v = Math.min(Math.sqrt(2 * SIM.friction * gap), tune.pull / Math.sqrt(e.mass));
    e.vx = n.x * v;
    e.vy = n.y * v;
    if (v > SIM.slideSpeed) {
      e.slide = { team: 0, echo: 0, chain, source: 'magnet' };
      if (e.state === 'windup') world.interrupt(e);
    }
    if (magnet >= 2) e.resonance = tune.resonanceTime;
    any = true;
  }
  if (any) {
    world.emit({
      type: 'pulse',
      unitId: u.id,
      x: anchor.x,
      y: anchor.y,
      radius: tune.radius,
      kind: 'magnet',
    });
  }
}

// ---- 对手 ----

function updateArcher(world: World, u: Unit, dt: number): void {
  if (u.state === 'windup') {
    const t = world.unitById(u.targetId);
    if (t && t.alive) {
      const k = Math.min(1, dt * 4);
      u.aimX += (t.x - u.aimX) * k;
      u.aimY += (t.y - u.aimY) * k;
    }
    face(u, u.aimX, u.aimY, dt, 2);
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      fireArrow(world, u);
    }
    return;
  }
  const target = enemyTarget(world, u);
  if (!target) return;
  u.targetId = target.id;
  face(u, target.x, target.y, dt);
  // 齐射阵形：开场先守住位置；长时间没有目标进入射程才缓慢前压。
  if (dist(u.x, u.y, target.x, target.y) > u.def.range && world.t > ARCHER_HOLD_TIME) {
    moveToward(world, u, target.x, target.y, 0.6);
    u.state = 'move';
  } else {
    u.state = 'idle';
  }
}

const ARCHER_HOLD_TIME = 9;

function fireArrow(world: World, u: Unit): void {
  const angle = Math.atan2(u.aimY - u.y, u.aimX - u.x) + u.rng.range(-0.05, 0.05);
  const speed = u.def.projectileSpeed ?? 430;
  u.facing = angle;
  u.attackAt = world.t;
  world.spawnProjectile({
    kind: 'arrow',
    team: 1,
    x: u.x + Math.cos(angle) * (u.radius + 2),
    y: u.y + Math.sin(angle) * (u.radius + 2),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: u.def.projectileRadius ?? 4,
    damage: u.def.damage,
    ownerId: u.id,
    source: 'enemy',
    life: 2.6,
  });
  world.emit({ type: 'shoot', unitId: u.id, x: u.x, y: u.y, angle, big: false });
}

function updateMelee(world: World, u: Unit, dt: number, target: Unit | null): void {
  const heavy = u.kind === 'brute';
  if (u.state === 'windup') {
    const t = world.unitById(u.targetId);
    if (t && t.alive) face(u, t.x, t.y, dt);
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      if (t && t.alive && edgeDist(u, t) <= u.def.range + 10) meleeStrike(world, u, t, heavy);
    }
    return;
  }
  if (!target) {
    u.state = 'idle';
    return;
  }
  u.targetId = target.id;
  face(u, target.x, target.y, dt);
  if (edgeDist(u, target) > u.def.range) {
    moveToward(world, u, target.x, target.y);
    u.state = 'move';
  } else if (u.cooldown <= 0) {
    startWindup(u, u.def.windup, target.id);
    u.cooldown = u.def.cooldown;
    if (heavy) world.emit({ type: 'windup', unitId: u.id, kind: u.kind, duration: u.def.windup });
  } else {
    u.state = 'idle';
  }
}

function updateBomber(world: World, u: Unit, dt: number): void {
  if (u.state === 'fuse') {
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      world.kill(u, {
        team: 1,
        source: 'enemy',
        echo: 0,
        chain: world.newChain(),
        attackerKind: 'bomber',
      });
    }
    return;
  }
  const target = enemyTarget(world, u);
  if (!target) return;
  u.targetId = target.id;
  face(u, target.x, target.y, dt);
  if (edgeDist(u, target) > u.def.range) {
    moveToward(world, u, target.x, target.y);
    u.state = 'move';
  } else {
    u.state = 'fuse';
    u.stateTime = u.def.windup;
    world.emit({ type: 'fuse', unitId: u.id });
  }
}

function updateSnail(world: World, u: Unit, dt: number): void {
  if (u.state === 'windup') {
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      const t = world.unitById(u.targetId);
      if (t && t.alive && dist(u.x, u.y, t.x, t.y) <= u.def.range + 40) {
        u.attackAt = world.t;
        world.heal(t, u.def.damage * world.enemyHpMult, u.x, u.y);
      }
    }
    return;
  }

  const players = world.aliveOf(0);
  const pc = centroid(players);
  const allies = world.units.filter((e) => e.alive && e.team === 1 && e.kind !== 'snail');
  const ac = centroid(allies);
  let wantX = u.x;
  let wantY = u.y;
  if (ac && pc) {
    const away = normalize(ac.x - pc.x, ac.y - pc.y, 1, 0);
    wantX = ac.x + away.x * 110;
    wantY = ac.y + away.y * 110;
  } else if (pc) {
    const away = normalize(u.x - pc.x, u.y - pc.y, 1, 0);
    wantX = u.x + away.x * 60;
    wantY = u.y + away.y * 60;
  }
  wantX = clamp(wantX, 40, world.width - 40);
  wantY = clamp(wantY, 40, world.height - 40);
  if (dist(u.x, u.y, wantX, wantY) > 12) {
    moveToward(world, u, wantX, wantY);
    u.state = 'move';
  }
  if (pc) face(u, pc.x, pc.y, dt);

  if (u.cooldown > 0) return;
  let best: Unit | null = null;
  for (const e of world.units) {
    if (!e.alive || e.team !== 1 || e.hp >= e.maxHp - 2) continue;
    if (e === u && allies.length > 0) continue;
    if (dist(u.x, u.y, e.x, e.y) > u.def.range) continue;
    if (!best || e.hp / e.maxHp < best.hp / best.maxHp) best = e;
  }
  if (best) {
    startWindup(u, u.def.windup, best.id);
    u.cooldown = u.def.cooldown;
  }
}

function updateMortar(world: World, u: Unit, dt: number): void {
  if (u.state === 'windup') {
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      u.attackAt = world.t;
      world.lobs.push({
        id: world.newId(),
        fromX: u.x,
        fromY: u.y,
        x: u.aimX,
        y: u.aimY,
        r: 62,
        time: 0,
        duration: 1.3,
        damage: u.def.damage,
        knock: u.def.knock,
      });
      world.emit({ type: 'lob', x: u.x, y: u.y, toX: u.aimX, toY: u.aimY });
    }
    return;
  }
  const nearest = nearestOpponent(world, u.x, u.y, u.team);
  if (!nearest) return;
  face(u, nearest.x, nearest.y, dt);
  if (dist(u.x, u.y, nearest.x, nearest.y) > u.def.range) {
    moveToward(world, u, nearest.x, nearest.y);
    u.state = 'move';
    return;
  }
  if (u.cooldown > 0) return;
  const players = world.aliveOf(0);
  const target = u.tauntBy ? world.unitById(u.tauntBy) : u.rng.pick(players);
  if (!target || !target.alive) return;
  u.aimX = target.x;
  u.aimY = target.y;
  startWindup(u, u.def.windup, target.id);
  u.cooldown = u.def.cooldown;
}

function updateJack(world: World, u: Unit, dt: number): void {
  if (u.state === 'windup') {
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      u.state = 'idle';
      u.attackAt = world.t;
      const y = clamp(u.y + u.rng.range(-26, 26), 30, world.height - 30);
      world.spawnUnit('mouse', u.x - u.radius - 18, y, true, u.id);
    }
    return;
  }
  u.timerA -= dt;
  if (u.timerA > 0) return;
  u.timerA = u.def.cooldown;
  // 每个惊喜盒最多弹出 JACK_SPAWN_LIMIT 只，场上同时最多 3 只，避免无止境的消耗战。
  if (u.shots >= JACK_SPAWN_LIMIT) return;
  const mine = world.units.filter((m) => m.alive && m.spawnedBy === u.id).length;
  const total = world.units.filter((m) => m.alive).length;
  if (mine < 3 && total < SIM.maxUnits) {
    u.shots++;
    startWindup(u, u.def.windup, 0);
  }
}

const JACK_SPAWN_LIMIT = 6;

const KING_FAN_INTERVAL = [2.8, 3.5, 4.2];

function updateKing(world: World, u: Unit, dt: number): void {
  const ratio = u.hp / u.maxHp;
  const phase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
  if (phase > u.phase) {
    u.phase = phase;
    u.timerB = 1.2;
    u.timerC = 2.5;
    world.emit({ type: 'phase', unitId: u.id, phase });
  }
  u.timerA -= dt;
  u.timerB -= dt;
  u.timerC -= dt;

  if (u.state === 'windup') {
    if (u.pending !== 'charge') {
      const t = world.unitById(u.targetId);
      if (t && t.alive) face(u, t.x, t.y, dt);
    }
    u.stateTime -= dt;
    if (u.stateTime <= 0) {
      const action = u.pending;
      u.state = 'idle';
      u.pending = '';
      performKingAction(world, u, action);
    }
    return;
  }

  const target = enemyTarget(world, u);
  if (!target) return;
  u.targetId = target.id;
  face(u, target.x, target.y, dt);

  if (u.phase >= 3 && u.timerC <= 0) {
    const dir = normalize(target.x - u.x, target.y - u.y, -1, 0);
    u.dashX = dir.x;
    u.dashY = dir.y;
    u.facing = Math.atan2(dir.y, dir.x);
    u.aimX = u.x + dir.x * 1400;
    u.aimY = u.y + dir.y * 1400;
    u.timerC = 7;
    startWindup(u, 1.1, target.id, 'charge');
    world.emit({ type: 'windup', unitId: u.id, kind: 'king', duration: 1.1 });
    return;
  }
  if (u.phase >= 2 && u.timerB <= 0) {
    u.timerB = 9;
    startWindup(u, 0.6, target.id, 'summon');
    world.emit({ type: 'windup', unitId: u.id, kind: 'king', duration: 0.6 });
    return;
  }
  if (u.timerA <= 0) {
    u.timerA = KING_FAN_INTERVAL[u.phase - 1] ?? 3;
    u.aimX = target.x;
    u.aimY = target.y;
    startWindup(u, 0.5, target.id, 'fan');
    return;
  }
  if (edgeDist(u, target) <= u.def.range) {
    if (u.cooldown <= 0) {
      startWindup(u, u.def.windup, target.id, 'melee');
      u.cooldown = u.def.cooldown;
    }
    return;
  }
  moveToward(world, u, target.x, target.y);
  u.state = 'move';
}

function performKingAction(world: World, u: Unit, action: string): void {
  u.attackAt = world.t;
  if (action === 'fan') {
    const base = Math.atan2(u.aimY - u.y, u.aimX - u.x);
    const speed = u.def.projectileSpeed ?? 330;
    for (let i = -3; i <= 3; i++) {
      const a = base + i * 0.17;
      world.spawnProjectile({
        kind: 'cog',
        team: 1,
        x: u.x + Math.cos(a) * (u.radius + 6),
        y: u.y + Math.sin(a) * (u.radius + 6),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: u.def.projectileRadius ?? 7,
        damage: 10,
        ownerId: u.id,
        source: 'enemy',
        life: 3.6,
      });
    }
    world.emit({ type: 'shoot', unitId: u.id, x: u.x, y: u.y, angle: base, big: true });
  } else if (action === 'summon') {
    const total = world.units.filter((m) => m.alive).length;
    if (total + 3 > SIM.maxUnits) return;
    world.spawnUnit('mouse', u.x, clamp(u.y - u.radius - 24, 30, world.height - 30), true, u.id);
    world.spawnUnit('mouse', u.x, clamp(u.y + u.radius + 24, 30, world.height - 30), true, u.id);
    world.spawnUnit('bomber', u.x - u.radius - 24, u.y, true, u.id);
  } else if (action === 'melee') {
    const t = world.unitById(u.targetId);
    if (t && t.alive && edgeDist(u, t) <= u.def.range + 12) meleeStrike(world, u, t, true);
  } else if (action === 'charge') {
    u.state = 'charge';
    u.dashLeft = 1.6;
    u.dashHits = [];
    u.dashChain = world.newChain();
  }
}

/** 首领冲撞：直线冲刺，撞飞路上的队员；撞到墙、柱子或弹簧桩后晕眩（受到伤害提高）。 */
function updateKingCharge(world: World, u: Unit, dt: number): void {
  const speed = 620;
  u.x += u.dashX * speed * dt;
  u.y += u.dashY * speed * dt;
  u.dashLeft -= dt;
  u.facing = Math.atan2(u.dashY, u.dashX);
  for (const p of world.units) {
    if (!p.alive || p.team !== 0 || u.dashHits.includes(p.id)) continue;
    if (dist(u.x, u.y, p.x, p.y) > u.radius + p.radius + 4) continue;
    u.dashHits.push(p.id);
    world.damage(p, 24, {
      team: 1,
      source: 'enemy',
      echo: 0,
      chain: u.dashChain,
      attackerKind: 'king',
    });
    const side = normalize(p.x - u.x, p.y - u.y, u.dashX, u.dashY);
    const dir = normalize(u.dashX * 0.7 + side.x, u.dashY * 0.7 + side.y);
    world.knock(p, dir.x, dir.y, 800, { team: 1, echo: 0, chain: u.dashChain, source: 'enemy' });
  }
  let hit = false;
  if (
    u.x < u.radius ||
    u.x > world.width - u.radius ||
    u.y < u.radius ||
    u.y > world.height - u.radius
  ) {
    u.x = clamp(u.x, u.radius, world.width - u.radius);
    u.y = clamp(u.y, u.radius, world.height - u.radius);
    hit = true;
  }
  for (const o of world.obstacles) {
    const d = dist(u.x, u.y, o.x, o.y);
    if (d >= u.radius + o.r) continue;
    const n = normalize(u.x - o.x, u.y - o.y, -u.dashX, -u.dashY);
    u.x = o.x + n.x * (u.radius + o.r);
    u.y = o.y + n.y * (u.radius + o.r);
    o.hitAt = world.t;
    if (o.kind === 'spring') world.emit({ type: 'spring', x: o.x, y: o.y, obstacleId: o.id });
    hit = true;
  }
  if (hit) {
    u.state = 'stunned';
    u.stateTime = 2.4;
    world.emit({
      type: 'impact',
      x: u.x + u.dashX * u.radius,
      y: u.y + u.dashY * u.radius,
      strength: 900,
      echo: 0,
      damaging: false,
    });
    world.emit({ type: 'stunned', unitId: u.id, x: u.x, y: u.y, duration: 2.4 });
    return;
  }
  if (u.dashLeft <= 0) {
    u.state = 'recover';
    u.stateTime = 0.5;
  }
}
