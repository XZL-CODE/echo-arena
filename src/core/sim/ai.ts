// 行为：状态计时、挑目标、走位、基础攻击，决定什么时候放技能与大招。
// 双方用同一套逻辑；只有玩家一方听从集火。行为保持简单、稳定、可预期。
import { DRAGON, SPECIES } from '../content/species.js';
import { ENERGY, SIM } from '../content/tuning.js';
import { normalize } from '../math.js';
import type { SkillId } from '../types.js';
import {
  advanceAction,
  castTime,
  handlerFor,
  startBasic,
  startCast,
  startTransform,
} from './actions.js';
import { bossChoice, shouldTransform } from './boss.js';
import type { Unit } from './entities.js';
import { approach, continueFootwork, isRanged, stand, startStrafe, walk } from './footwork.js';
import { faceToward } from './motion.js';
import { edgeDist } from './query.js';
import type { SkillPlan } from './skillkit.js';
import { addTo } from './stats.js';
import type { World } from './world.js';

/** 远程单位连续后撤的最长时间（秒），之后站定射击，等威胁解除再恢复。 */
const KITE_LIMIT = 2;
/** 泡泡獭在队友生命低于这一比例时改为治疗。 */
const HEAL_BELOW = 0.7;

export function updateUnit(world: World, u: Unit, dt: number): void {
  tickStatuses(world, u, dt);
  if (!u.alive) return;
  // 行走速度与步法每一步重新决定；站着、出手、施法、被控制时都是 none。
  u.mvx = 0;
  u.mvy = 0;
  u.footwork = 'none';
  if (shouldTransform(u)) {
    startTransform(world, u);
    return;
  }
  if (u.action) {
    advanceAction(world, u, dt);
    return;
  }
  if (u.slide || u.stun > 0) {
    u.foot = null;
    world.setAct(u, 'stunned', Math.max(u.stun, 0.2));
    return;
  }
  if (tryUlt(world, u)) return;
  if (u.guard > 0) {
    holdGuard(world, u, dt);
    return;
  }
  if (trySkill(world, u)) return;
  fight(world, u, dt);
}

function tickStatuses(world: World, u: Unit, dt: number): void {
  if (u.attackCd > 0) u.attackCd -= dt;
  if (u.skillCd > 0) u.skillCd = Math.max(0, u.skillCd - dt);
  if (u.role === 'boss') {
    u.breathCd -= dt;
    u.tailCd -= dt;
    u.summonCd -= dt;
  }
  if (u.stun > 0) u.stun = Math.max(0, u.stun - dt);
  if (u.airborne > 0) u.airborne = Math.max(0, u.airborne - dt);
  if (u.root > 0) u.root = Math.max(0, u.root - dt);
  if (u.guard > 0) u.guard = Math.max(0, u.guard - dt);
  if (u.stoneSkin > 0) u.stoneSkin = Math.max(0, u.stoneSkin - dt);
  if (u.taunt > 0) {
    u.taunt -= dt;
    if (u.taunt <= 0) {
      u.taunt = 0;
      u.tauntBy = 0;
    }
  }
  if (u.shieldTime > 0) {
    u.shieldTime -= dt;
    if (u.shieldTime <= 0) {
      u.shieldTime = 0;
      u.shield = 0;
    }
  }
  if (u.burn > 0) {
    u.burnTick -= dt;
    if (u.burnTick <= 0) {
      u.burnTick += SIM.dotTick;
      world.damage(u, u.burnDps * SIM.dotTick, {
        team: u.team === 0 ? 1 : 0,
        sourceId: u.burnBy,
        source: u.burnSource,
        element: 'fire',
        echo: 0,
        chain: 0,
        dot: true,
      });
    }
    u.burn = Math.max(0, u.burn - dt);
    if (u.burn <= 0) u.burnDps = 0;
  }
}

// ---- 技能与大招 ----

function ultOf(u: Unit): SkillId | null {
  if (u.species === 'dragon') return u.form === 2 ? DRAGON.ult.id : null;
  return u.form === 3 ? SPECIES[u.species].ult.id : null;
}

/** 能量满了就放大招（找不到合适的目标就先等着，能量保持满格）。 */
function tryUlt(world: World, u: Unit): boolean {
  if (u.energy < ENERGY.full) return false;
  const id = ultOf(u);
  if (!id) return false;
  const plan = handlerFor(id).plan(world, u);
  if (!plan) return false;
  startCast(world, u, id, plan, castTime(id), true);
  u.energy = 0;
  u.energyAnnounced = false;
  if (!world.result) {
    if (u.team === 0 && u.uid) addTo(world.stats.ultsByUid, u.uid, 1);
    else if (u.team === 1) world.stats.enemyUlts++;
  }
  world.emit({ type: 'ult', unitId: u.id, skill: id, x: u.x, y: u.y, tx: plan.x, ty: plan.y });
  return true;
}

function trySkill(world: World, u: Unit): boolean {
  let id: SkillId;
  let plan: SkillPlan | null;
  if (u.species === 'dragon') {
    const choice = bossChoice(world, u);
    if (!choice) return false;
    id = choice.id;
    plan = choice.plan;
  } else {
    if (u.skillCd > 0) return false;
    id = SPECIES[u.species].skill.id;
    plan = handlerFor(id).plan(world, u);
    if (!plan) return false;
    u.skillCd = u.skillCdMax;
  }
  startCast(world, u, id, plan, castTime(id), false);
  world.gainEnergy(u, ENERGY.perSkill);
  if (!world.result && u.team === 0 && u.uid) addTo(world.stats.skillsByUid, u.uid, 1);
  world.emit({
    type: 'skill',
    unitId: u.id,
    skill: id,
    form: u.form,
    x: u.x,
    y: u.y,
    tx: plan.x,
    ty: plan.y,
  });
  return true;
}

/** 玄甲壁：原地架盾，转身正对最近的敌人。 */
function holdGuard(world: World, u: Unit, dt: number): void {
  u.foot = null;
  const threat = nearestByEdge(world, u);
  if (threat) faceToward(u, threat.x, threat.y, dt, 6);
  world.setAct(u, 'guard', u.guard);
}

// ---- 目标 ----

function nearestByEdge(world: World, u: Unit): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const e of world.units) {
    if (!e.alive || e.team === u.team) continue;
    const d = edgeDist(u, e);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** 坦克保护队友：正在追打别的队友的近战敌人算作“更近”，坦克会回身去拦。 */
const PEEL_BONUS = 140;

function targetScore(world: World, u: Unit, e: Unit): number {
  let d = edgeDist(u, e);
  if (u.role === 'tank' && !isRanged(e) && e.targetId !== u.id) {
    const victim = world.unitById(e.targetId);
    if (victim && victim.alive && victim.team === u.team) d -= PEEL_BONUS;
  }
  return d;
}

function bestTarget(world: World, u: Unit): Unit | null {
  if (u.role !== 'tank') return nearestByEdge(world, u);
  let best: Unit | null = null;
  let bestScore = Infinity;
  for (const e of world.units) {
    if (!e.alive || e.team === u.team) continue;
    const score = targetScore(world, u, e);
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/**
 * 挑选目标：挑衅 > 集火（仅玩家一方）> 正在打的目标（够得着就不换）> 最近的敌人。
 * 每隔一小段时间才重新比较，避免在两个差不多远的敌人之间来回跳。
 */
function pickTarget(world: World, u: Unit): Unit | null {
  if (u.taunt > 0) {
    const t = world.unitById(u.tauntBy);
    if (t && t.alive && t.team !== u.team) return t;
  }
  if (u.team === 0 && world.focusId) {
    const f = world.unitById(world.focusId);
    if (f && f.alive) return f;
  }
  const current = u.targetId ? world.unitById(u.targetId) : undefined;
  const valid = current !== undefined && current.alive && current.team !== u.team;
  if (valid && world.t < u.retargetAt) return current;
  u.retargetAt = world.t + 0.4;
  const best = bestTarget(world, u);
  if (!valid || !best) return best;
  const currentScore = targetScore(world, u, current);
  if (u.role !== 'tank' && edgeDist(u, current) <= u.range + 4) return current;
  return targetScore(world, u, best) < currentScore - 40 ? best : current;
}

/** 泡泡獭要治疗的队友：生命比例最低、低于 70%、离得不太远（包括自己）。 */
function healTarget(world: World, u: Unit): Unit | null {
  let best: Unit | null = null;
  for (const a of world.units) {
    if (!a.alive || a.team !== u.team || a.hp >= a.maxHp * HEAL_BELOW) continue;
    if (a !== u && edgeDist(u, a) > u.range + 160) continue;
    if (!best || a.hp / a.maxHp < best.hp / best.maxHp) best = a;
  }
  return best;
}

// ---- 战斗与走位 ----

function fight(world: World, u: Unit, dt: number): void {
  if (u.species === 'otter') {
    const patient = healTarget(world, u);
    if (patient) {
      tend(world, u, patient, dt);
      return;
    }
  }
  const target = pickTarget(world, u);
  if (!target) {
    stand(world, u);
    return;
  }
  if (target.id !== u.targetId) {
    u.targetId = target.id;
    u.foot = null;
    // 近战的站位方向：从目标看过来的方向，再偏向自己包抄的一侧，大家围成一圈而不是排队。
    u.slot = Math.atan2(u.y - target.y, u.x - target.x) + u.flank * u.spread * 0.8;
  }
  if (continueFootwork(world, u, target, dt)) return;
  if (isRanged(u)) rangedFight(world, u, target, dt);
  else meleeFight(world, u, target, dt);
}

function meleeFight(world: World, u: Unit, target: Unit, dt: number): void {
  if (edgeDist(u, target) <= u.range) {
    faceToward(u, target.x, target.y, dt);
    if (u.attackCd <= 0) startBasic(world, u, target);
    else stand(world, u);
    return;
  }
  // 压上去：站到目标身边自己的那个方位。
  const reach = target.radius + u.radius + u.range * 0.5;
  const gx = target.x + Math.cos(u.slot) * reach;
  const gy = target.y + Math.sin(u.slot) * reach;
  approach(world, u, gx, gy, dt, target);
}

function rangedFight(world: World, u: Unit, target: Unit, dt: number): void {
  if (edgeDist(u, target) > u.range) {
    approach(world, u, target.x, target.y, dt, target);
    return;
  }
  if (kite(world, u, dt)) return;
  faceToward(u, target.x, target.y, dt);
  if (u.attackCd <= 0) {
    startBasic(world, u, target);
    return;
  }
  // 两次射击之间横移，同时往保持距离靠拢。
  if (u.root > 0) {
    stand(world, u);
    return;
  }
  startStrafe(world, u, target);
  continueFootwork(world, u, target, dt);
}

function tend(world: World, u: Unit, ally: Unit, dt: number): void {
  if (ally === u || edgeDist(u, ally) <= u.range) {
    if (ally !== u) faceToward(u, ally.x, ally.y, dt);
    if (u.attackCd <= 0) startBasic(world, u, ally, true);
    else stand(world, u);
    return;
  }
  approach(world, u, ally.x, ally.y, dt, ally);
}

/** 远程被近战贴身时后撤一小段，偏向本方一侧；攻击冷却好了照样出手。 */
function kite(world: World, u: Unit, dt: number): boolean {
  let threat: Unit | null = null;
  for (const e of world.units) {
    if (!e.alive || e.team === u.team || isRanged(e) || e.targetId !== u.id) continue;
    if (edgeDist(u, e) < 40 && (!threat || edgeDist(u, e) < edgeDist(u, threat))) threat = e;
  }
  if (!threat) {
    u.kiteTime = Math.max(0, u.kiteTime - dt * 0.5);
    return false;
  }
  if (u.kiteTime > KITE_LIMIT || u.attackCd <= 0 || u.root > 0) return false;
  u.kiteTime += dt;
  u.foot = null;
  const away = normalize(u.x - threat.x, u.y - threat.y, u.team === 0 ? -1 : 1, 0);
  const home = u.team === 0 ? -0.7 : 0.7;
  const center = (world.height / 2 - u.y) / world.height;
  const dir = normalize(away.x + home, away.y + center, away.x, away.y);
  walk(world, u, u.x + dir.x * 60, u.y + dir.y * 60, dt, { tag: 'step', mul: 0.9, face: threat });
  return true;
}
