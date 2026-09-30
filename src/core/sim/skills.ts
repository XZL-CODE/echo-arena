// 十种宠物的自动技能：冷却好了、而且场面上值得放时自动施放；2 阶起技能变强。
// 技能优先改变行为（路线、目标、连锁、站位），数值是次要的。
import { SKILLS } from '../content/species.js';
import { dist, normalize } from '../math.js';
import type { SpeciesId } from '../types.js';
import type { Action, Unit } from './entities.js';
import { clampToArena, faceNow, forward } from './motion.js';
import {
  densestCluster,
  edgeDist,
  lowestHpRatio,
  nearestOpponent,
  unitsInRadius,
  unitsOnSegment,
} from './query.js';
import {
  allies,
  byForm,
  damageInfo,
  dashStep,
  focusTarget,
  leadPoint,
  lobTo,
  lowestHp,
  opponents,
  other,
  planAt,
  planOn,
  ram,
  shootAt,
  strike,
  targetInReach,
  transfer,
  type SkillHandler,
} from './skillkit.js';
import type { World } from './world.js';

/** 范围技能至少要罩住两个敌人才放；只剩一两个敌人时一个也放。 */
function worthIt(world: World, u: Unit, count: number): boolean {
  return count >= 2 || (count >= 1 && opponents(world, u).length <= 2);
}

// ---- 火：焰狐、火团雀 ----

/** 焰爪突袭：冲向够得着的、生命最低的敌人（或集火目标），2 阶起接着冲向下一个。 */
const foxSkill: SkillHandler = {
  plan(world, u) {
    if (u.root > 0) return null;
    const T = SKILLS.fox.skill;
    const focus = focusTarget(world, u);
    if (focus && edgeDist(u, focus) <= T.reach) return planOn(focus);
    return planOn(lowestHp(opponents(world, u).filter((e) => edgeDist(u, e) <= T.reach)));
  },
  fire(world, u, a) {
    const target = world.unitById(a.targetId);
    if (!target || !target.alive) return;
    a.phase = 2;
    a.step = 0;
    a.timer = 0;
    world.setAct(u, 'dash', 0.5, true);
    world.emit({
      type: 'dash',
      unitId: u.id,
      fromX: u.x,
      fromY: u.y,
      toX: target.x,
      toY: target.y,
    });
  },
  tick(world, u, a, dt) {
    const T = SKILLS.fox.skill;
    const target = world.unitById(a.targetId);
    if (!target || !target.alive) return !foxNextHop(world, u, a);
    const contact = u.radius + target.radius + 4;
    const d = dist(u.x, u.y, target.x, target.y);
    const step = T.speed * dt;
    faceNow(u, target.x, target.y);
    if (d > contact + step) {
      u.x += ((target.x - u.x) / d) * step;
      u.y += ((target.y - u.y) / d) * step;
      a.timer += dt;
      return a.timer > 0.8;
    }
    if (d > contact) {
      u.x += ((target.x - u.x) / d) * (d - contact);
      u.y += ((target.y - u.y) / d) * (d - contact);
    }
    // 第一击回响 0，之后每多冲一个目标回响 +1。
    const echo = a.hits.length;
    transfer(world, u, target.x, target.y, echo, a.chain, T.id);
    strike(world, u, target, T.mult, T.id, a.chain, echo);
    if (target.alive) world.burnUnit(target, u.atk * T.burnRatio, T.burnTime, u.id, T.id);
    a.hits.push(target.id);
    return !foxNextHop(world, u, a);
  },
};

function foxNextHop(world: World, u: Unit, a: Action): boolean {
  const T = SKILLS.fox.skill;
  if (a.hits.length >= byForm(T.hops, u.form)) return false;
  const next = lowestHp(
    opponents(world, u).filter((e) => !a.hits.includes(e.id) && edgeDist(u, e) <= T.hopReach),
  );
  if (!next) return false;
  a.targetId = next.id;
  a.timer = 0;
  world.emit({ type: 'dash', unitId: u.id, fromX: u.x, fromY: u.y, toX: next.x, toY: next.y });
  return true;
}

/** 烈焰弹：向敌人最密集处投下大火球；2 阶起落地留下燃烧地面。 */
const birdSkill: SkillHandler = {
  plan(world, u) {
    const T = SKILLS.bird.skill;
    const c = densestCluster(world, u.team, u.x, u.y, u.range + 120, T.radius);
    return c && worthIt(world, u, c.count) ? planAt(c.x, c.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.bird.skill;
    const d = dist(u.x, u.y, a.tx, a.ty);
    shootAt(world, u, a.tx, a.ty, 'bigfireball', T.speed, {
      damage: u.atk * T.mult,
      radius: 14,
      splash: T.radius,
      source: T.id,
      chain: a.chain,
      life: Math.max(0.1, (d - u.radius - 4) / T.speed),
      blastAtEnd: true,
      groundDps: u.form >= 2 ? u.atk * T.groundRatio : 0,
      groundTime: T.groundTime,
    });
  },
};

// ---- 水：泡泡獭、盾盾龟 ----

/** 泡泡护盾：套给生命最低、还没有护盾的队友（2 阶起两个）。护盾会把敌方弹丸弹回去。 */
const otterSkill: SkillHandler = {
  plan(world, u) {
    const T = SKILLS.otter.skill;
    const needy = allies(world, u).filter(
      (x) => x.shield <= 0 && dist(u.x, u.y, x.x, x.y) <= T.reach && x.hp < x.maxHp * 0.85,
    );
    return planOn(lowestHpRatio(needy));
  },
  fire(world, u) {
    const T = SKILLS.otter.skill;
    const pool = allies(world, u)
      .filter((x) => x.shield <= 0 && dist(u.x, u.y, x.x, x.y) <= T.reach + 40)
      .sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp || p.id - q.id);
    for (const ally of pool.slice(0, byForm(T.targets, u.form))) {
      world.addShield(ally, u.atk * T.shieldMult, T.duration, u.id);
    }
  },
};

/** 玄甲壁：原地架盾，挑衅附近敌人；正面飞来的弹丸弹回去（弹丸处理在 projectiles.ts）。 */
const turtleSkill: SkillHandler = {
  plan(world, u) {
    const T = SKILLS.turtle.skill;
    const near = opponents(world, u).some((e) => edgeDist(u, e) <= T.tauntRadius + 60);
    const incoming = world.projectiles.some(
      (p) =>
        p.alive && p.team !== u.team && p.reflectable && !p.lob && dist(p.x, p.y, u.x, u.y) < 240,
    );
    if (!near && !incoming) return null;
    return planOn(nearestOpponent(world, u.x, u.y, u.team));
  },
  fire(world, u) {
    const T = SKILLS.turtle.skill;
    u.guard = T.duration;
    world.emitStatus(u, 'guard', T.duration);
    for (const e of opponents(world, u)) {
      if (edgeDist(u, e) <= T.tauntRadius) world.tauntUnit(e, u.id, T.tauntTime);
    }
  },
};

// ---- 木：叶耳兔、芽芽鹿 ----

/** 万叶连射：三支箭分给至多 3 个目标；2 阶起每支箭命中后再弹一次。 */
const bunnySkill: SkillHandler = {
  plan(world, u) {
    return planOn(targetInReach(world, u, u.range));
  },
  fire(world, u, a) {
    const T = SKILLS.bunny.skill;
    const first = world.unitById(a.targetId);
    const targets: Unit[] = first && first.alive ? [first] : [];
    const others = opponents(world, u)
      .filter((e) => e !== first && edgeDist(u, e) <= u.range + 40)
      .sort((p, q) => edgeDist(u, p) - edgeDist(u, q) || p.id - q.id);
    targets.push(...others.slice(0, Math.max(0, T.arrows - targets.length)));
    if (targets.length === 0) return;
    for (let i = 0; i < T.arrows; i++) {
      const t = targets[i % targets.length] as Unit;
      const aim = leadPoint(u, t, 700);
      shootAt(world, u, aim.x, aim.y, 'arrow', 700, {
        damage: u.atk * T.mult,
        radius: 6,
        source: T.id,
        chain: a.chain,
        ricochet: u.form >= 2 ? 1 : 0,
        seekId: t.id,
        seekTurn: 5,
        life: 1.6,
      });
    }
  },
};

/** 藤缚：在敌人密集处缠住敌人并拉向中心；2 阶起范围更大，并治疗附近队友。 */
const deerSkill: SkillHandler = {
  plan(world, u) {
    const r = byForm(SKILLS.deer.skill.radius, u.form);
    const c = densestCluster(world, u.team, u.x, u.y, u.range + 80, r);
    return c && worthIt(world, u, c.count) ? planAt(c.x, c.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.deer.skill;
    const r = byForm(T.radius, u.form);
    world.addZone({
      kind: 'vines',
      team: u.team,
      x: a.tx,
      y: a.ty,
      r,
      duration: T.root,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
      root: T.root,
      pull: T.pullSpeed,
    });
    for (const e of unitsInRadius(world, a.tx, a.ty, r, other(u.team))) world.rootUnit(e, T.root);
    if (u.form < 2) return;
    for (const ally of unitsInRadius(world, a.tx, a.ty, r + 80, u.team)) {
      world.heal(ally, ally.maxHp * T.heal, u.id);
    }
  },
};

// ---- 雷：电团猫、雷牙狼 ----

/** 连环雷：闪电一个接一个地跳到最近的下一个敌人，每跳回响 +1。 */
const catSkill: SkillHandler = {
  plan(world, u) {
    return planOn(targetInReach(world, u, u.range));
  },
  fire(world, u, a) {
    const T = SKILLS.cat.skill;
    const first = world.unitById(a.targetId);
    const target = first && first.alive ? first : targetInReach(world, u, u.range + 40);
    if (!target) return;
    catBolt(world, u, u.x, u.y, target, 0, byForm(T.targets, u.form), [], a.chain);
  },
};

function catBolt(
  world: World,
  u: Unit,
  fromX: number,
  fromY: number,
  target: Unit,
  index: number,
  total: number,
  hitIds: number[],
  chain: number,
): void {
  const T = SKILLS.cat.skill;
  if (!target.alive) return;
  world.emit({
    type: 'chain',
    x1: fromX,
    y1: fromY,
    x2: target.x,
    y2: target.y,
    echo: Math.min(index, 8),
    element: u.element,
  });
  transfer(world, u, target.x, target.y, index, chain, T.id);
  world.damage(target, u.atk * T.mult, damageInfo(u, T.id, chain, index));
  hitIds.push(target.id);
  if (index + 1 >= total) return;
  const next = nearestOpponent(world, target.x, target.y, u.team, hitIds, T.jumpRange);
  if (!next) return;
  const x = target.x;
  const y = target.y;
  world.after(T.delay, () => catBolt(world, u, x, y, next, index + 1, total, hitIds, chain));
}

/** 奔雷突：直线冲锋穿过目标，把沿途敌人往两侧撞飞；2 阶起终点落雷击晕。 */
const wolfSkill: SkillHandler = {
  plan(world, u) {
    if (u.root > 0) return null;
    return planOn(targetInReach(world, u, SKILLS.wolf.skill.distance - 20));
  },
  fire(world, u, a) {
    const T = SKILLS.wolf.skill;
    const dir = normalize(a.tx - u.x, a.ty - u.y, forward(u), 0);
    const len = Math.min(T.distance, dist(u.x, u.y, a.tx, a.ty) + 80);
    const end = clampToArena(u.x + dir.x * len, u.y + dir.y * len, u.radius + 4);
    a.path = [end];
    a.step = 0;
    a.timer = 0;
    a.phase = 2;
    faceNow(u, end.x, end.y);
    world.setAct(u, 'dash', len / T.speed, true);
    world.emit({ type: 'dash', unitId: u.id, fromX: u.x, fromY: u.y, toX: end.x, toY: end.y });
  },
  tick(world, u, a, dt) {
    const T = SKILLS.wolf.skill;
    const done = dashStep(world, u, a, T.speed, dt, (e) =>
      ram(world, u, e, a, T.id, T.mult, T.knock, 0),
    );
    if (!done) return false;
    if (u.form >= 2) {
      world.blast({
        x: u.x,
        y: u.y,
        radius: T.slamRadius,
        damage: u.atk * T.slamMult,
        team: u.team,
        sourceId: u.id,
        source: T.id,
        element: u.element,
        echo: 0,
        chain: a.chain,
        stun: T.slamStun,
      });
    }
    return true;
  },
};

// ---- 岩：石头熊、晶晶蜥 ----

/** 裂地击：砸地把周围敌人掀到空中；2 阶起再向前掀起一排岩刺。 */
const bearSkill: SkillHandler = {
  plan(world, u) {
    const T = SKILLS.bear.skill;
    const near = opponents(world, u).filter((e) => dist(u.x, u.y, e.x, e.y) <= T.radius + e.radius);
    const aim = targetInReach(world, u, u.form >= 2 ? T.spikeLength * 0.8 : T.radius);
    if (!aim) return null;
    let score = near.length;
    if (u.form >= 2) {
      const dir = normalize(aim.x - u.x, aim.y - u.y);
      const ex = u.x + dir.x * T.spikeLength;
      const ey = u.y + dir.y * T.spikeLength;
      score += unitsOnSegment(world, u.x, u.y, ex, ey, T.spikeWidth, other(u.team)).filter(
        (e) => !near.includes(e),
      ).length;
    }
    return worthIt(world, u, score) ? planAt(aim.x, aim.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.bear.skill;
    world.blast({
      x: u.x,
      y: u.y,
      radius: T.radius,
      damage: u.atk * T.mult,
      team: u.team,
      sourceId: u.id,
      source: T.id,
      element: u.element,
      echo: 0,
      chain: a.chain,
      knockUp: T.knockUp,
    });
    if (u.form < 2) return;
    const angle = Math.atan2(a.ty - u.y, a.tx - u.x);
    const ex = u.x + Math.cos(angle) * T.spikeLength;
    const ey = u.y + Math.sin(angle) * T.spikeLength;
    world.addZone({
      kind: 'spikes',
      team: u.team,
      x: u.x,
      y: u.y,
      r: T.spikeWidth,
      angle,
      length: T.spikeLength,
      duration: 0.8,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
    });
    for (const e of unitsOnSegment(world, u.x, u.y, ex, ey, T.spikeWidth, other(u.team))) {
      // 已经被砸地掀起的不再挨一次。
      if (dist(u.x, u.y, e.x, e.y) <= T.radius + e.radius) continue;
      strike(world, u, e, T.spikeMult, T.id, a.chain);
      world.stunUnit(e, T.knockUp, true);
    }
  },
};

/** 晶簇爆：把大晶簇抛进敌阵，落地碎成晶片向外飞射，每片命中第一个碰到的敌人（回响 +1）。 */
const lizardSkill: SkillHandler = {
  plan(world, u) {
    const c = densestCluster(world, u.team, u.x, u.y, u.range + 60, 110);
    return c ? planAt(c.x, c.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.lizard.skill;
    lobTo(world, u, a.tx, a.ty, 'bigcrystal', T.flight, 160, {
      damage: u.atk * T.mult,
      radius: 12,
      splash: T.radius,
      source: T.id,
      chain: a.chain,
      shards: byForm(T.shards, u.form),
      shardDamage: u.atk * T.shardMult,
      shardSpeed: T.shardSpeed,
      shardRange: T.shardRange,
    });
  },
};

export const SPECIES_SKILLS: Record<SpeciesId, SkillHandler> = {
  fox: foxSkill,
  bird: birdSkill,
  otter: otterSkill,
  turtle: turtleSkill,
  bunny: bunnySkill,
  deer: deerSkill,
  cat: catSkill,
  wolf: wolfSkill,
  bear: bearSkill,
  lizard: lizardSkill,
};
