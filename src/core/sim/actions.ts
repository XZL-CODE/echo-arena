// 动作的推进：基础攻击与技能的前摇 → 生效 →（冲刺、瞬身等多段过程）→ 收招。
import {
  DRAGON,
  SKILL_DEFS,
  SKILLS,
  SPECIES,
  SPECIES_IDS,
  type AttackDef,
} from '../content/species.js';
import { ENERGY } from '../content/tuning.js';
import { dist, normalize } from '../math.js';
import type { SkillId } from '../types.js';
import { BOSS_HANDLERS } from './boss.js';
import type { Action, ActionKind, Unit, UnitAct } from './entities.js';
import { afterBasic } from './footwork.js';
import { faceToward, forward } from './motion.js';
import { edgeDist } from './query.js';
import {
  damageInfo,
  leadPoint,
  lobTo,
  shootAt,
  slideInfo,
  type SkillHandler,
  type SkillPlan,
} from './skillkit.js';
import { SPECIES_SKILLS } from './skills.js';
import { SPECIES_ULTS } from './ults.js';
import type { World } from './world.js';

/** 基础攻击出手后的收招时间。 */
const RECOVER = 0.15;

/** 技能 id → 行为。 */
const HANDLERS = new Map<SkillId, SkillHandler>([
  ...SPECIES_IDS.flatMap((s): Array<[SkillId, SkillHandler]> => [
    [SKILLS[s].skill.id, SPECIES_SKILLS[s]],
    [SKILLS[s].ult.id, SPECIES_ULTS[s]],
  ]),
  ...(Object.entries(BOSS_HANDLERS) as Array<[SkillId, SkillHandler]>),
]);

export function handlerFor(id: SkillId): SkillHandler {
  const handler = HANDLERS.get(id);
  if (!handler) throw new Error(`Unknown skill: ${id}`);
  return handler;
}

export function attackOf(u: Unit): AttackDef {
  return u.species === 'dragon' ? DRAGON.attack : SPECIES[u.species].attack;
}

function newAction(
  world: World,
  kind: ActionKind,
  act: UnitAct,
  fireAt: number,
  dur: number,
  plan: SkillPlan,
  unstoppable: boolean,
): Action {
  return {
    kind,
    act,
    t: 0,
    fireAt,
    dur,
    phase: 0,
    unstoppable,
    targetId: plan.targetId,
    tx: plan.x,
    ty: plan.y,
    hits: [],
    queue: [],
    path: [],
    step: 0,
    timer: 0,
    chain: world.newChain(),
    echo: 0,
    fromX: 0,
    fromY: 0,
  };
}

/** 开始一次基础攻击（heal 为泡泡獭给队友治疗）。 */
export function startBasic(world: World, u: Unit, target: Unit, heal = false): void {
  const def = attackOf(u);
  u.attackCd = u.interval;
  const plan = { targetId: target.id, x: target.x, y: target.y };
  u.action = newAction(
    world,
    heal ? 'heal' : 'basic',
    'attack',
    def.windup,
    def.windup + RECOVER,
    plan,
    false,
  );
  world.setAct(u, 'attack', u.action.dur, true);
}

/** 开始施放技能或大招（大招不能被打断）。 */
export function startCast(
  world: World,
  u: Unit,
  id: SkillId,
  plan: SkillPlan,
  cast: number,
  ult: boolean,
): void {
  const recover = ult ? 0.3 : 0.2;
  u.action = newAction(world, id, ult ? 'ult' : 'skill', cast, cast + recover, plan, ult);
  world.setAct(u, u.action.act, u.action.dur, true);
}

/** 首领变身：前摇期间不会受伤，结束时化为人形。 */
export function startTransform(world: World, u: Unit): void {
  const time = DRAGON.transformTime;
  u.action = newAction(world, 'transform', 'skill', time, time + 0.2, planHere(u), true);
  u.stun = 0;
  u.airborne = 0;
  u.slide = null;
  u.vx = 0;
  u.vy = 0;
  world.setAct(u, 'skill', u.action.dur, true);
}

function planHere(u: Unit): SkillPlan {
  return { targetId: 0, x: u.x, y: u.y };
}

export function advanceAction(world: World, u: Unit, dt: number): void {
  const a = u.action as Action;
  a.t += dt;
  if (a.phase === 0) {
    if (a.targetId) {
      const t = world.unitById(a.targetId);
      if (t && t.alive) {
        a.tx = t.x;
        a.ty = t.y;
      }
    }
    faceToward(u, a.tx, a.ty, dt, 14);
    if (a.t < a.fireAt) return;
    a.phase = 1;
    fire(world, u, a);
    if (u.action !== a) return;
  }
  if (a.phase === 2) {
    const handler =
      a.kind === 'basic' || a.kind === 'heal' || a.kind === 'transform' ? null : handlerFor(a.kind);
    if (!handler?.tick || handler.tick(world, u, a, dt)) finish(world, u, a);
    return;
  }
  if (a.t >= a.dur) finish(world, u, a);
}

function finish(world: World, u: Unit, a: Action): void {
  u.action = null;
  world.setAct(u, u.guard > 0 ? 'guard' : 'idle', u.guard > 0 ? u.guard : 0);
  // 普通攻击收招后接步法：近战后撤、侧移或交叉换位，远程横移。
  if (a.kind === 'basic') {
    const target = world.unitById(a.targetId);
    if (target && target.alive && target.team !== u.team) afterBasic(world, u, target);
  }
}

function fire(world: World, u: Unit, a: Action): void {
  if (a.kind === 'basic') fireBasic(world, u, a);
  else if (a.kind === 'heal') fireHeal(world, u, a);
  else if (a.kind === 'transform') world.transformBoss(u);
  else handlerFor(a.kind).fire(world, u, a);
}

function fireBasic(world: World, u: Unit, a: Action): void {
  const target = world.unitById(a.targetId);
  if (!target || !target.alive) return;
  const def = attackOf(u);
  world.emit({
    type: 'attack',
    unitId: u.id,
    targetId: target.id,
    style: def.style,
    x: u.x,
    y: u.y,
    tx: target.x,
    ty: target.y,
  });
  if (def.style === 'melee') meleeHit(world, u, target, def, a.chain);
  else if (def.style === 'cast') {
    if (edgeDist(u, target) > u.range + 40) return;
    world.damage(target, u.atk, damageInfo(u, 'basic', a.chain));
    world.gainEnergy(u, ENERGY.perBasicHit);
  } else if (def.style === 'lob') {
    const aim = leadPoint(u, target, dist(u.x, u.y, target.x, target.y) / (def.flight ?? 1));
    lobTo(world, u, aim.x, aim.y, def.projectile ?? 'crystal', def.flight ?? 1, 120, {
      damage: u.atk,
      radius: 8,
      splash: def.splash ?? 0,
      chain: a.chain,
    });
  } else {
    const speed = def.speed ?? 500;
    const aim = leadPoint(u, target, speed);
    const ricochet = u.species === 'bunny' && u.form >= 2 ? 1 : 0;
    shootAt(world, u, aim.x, aim.y, def.projectile ?? 'spark', speed, {
      damage: u.atk,
      radius: def.splash ? 9 : 6,
      splash: def.splash ?? 0,
      chain: a.chain,
      ricochet,
      life: (u.range + 200) / speed,
    });
  }
}

/** 近战命中：主目标全额伤害，有溅射的对周围敌人造成一半伤害；可附带小幅击退。 */
function meleeHit(world: World, u: Unit, target: Unit, def: AttackDef, chain: number): void {
  if (edgeDist(u, target) > u.range + 14) return;
  world.damage(target, u.atk, damageInfo(u, 'basic', chain));
  world.gainEnergy(u, ENERGY.perBasicHit);
  if (def.splash) {
    for (const e of world.units) {
      if (!e.alive || e.team === u.team || e === target) continue;
      if (dist(target.x, target.y, e.x, e.y) > def.splash + e.radius) continue;
      world.damage(e, u.atk * 0.5, damageInfo(u, 'basic', chain));
    }
  }
  if (def.knock && target.alive) {
    const n = normalize(target.x - u.x, target.y - u.y, forward(u), 0);
    world.knock(target, n.x, n.y, def.knock, slideInfo(u, 'basic', chain));
  }
}

/** 泡泡獭的治疗：普通攻击改为给受伤队友回血。 */
function fireHeal(world: World, u: Unit, a: Action): void {
  const ally = world.unitById(a.targetId);
  if (!ally || !ally.alive) return;
  if (ally !== u && edgeDist(u, ally) > u.range + 40) return;
  world.emit({
    type: 'attack',
    unitId: u.id,
    targetId: ally.id,
    style: 'heal',
    x: u.x,
    y: u.y,
    tx: ally.x,
    ty: ally.y,
  });
  world.heal(ally, u.atk * (attackOf(u).heal ?? 1), u.id);
  // 治疗不是命中，只给一半能量：否则潮音几乎每隔几秒就能放一次全队治疗。
  world.gainEnergy(u, ENERGY.perBasicHit / 2);
}

/** 技能与大招的前摇时长。 */
export function castTime(id: SkillId): number {
  return SKILL_DEFS[id].cast;
}
