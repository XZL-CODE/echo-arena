// 首领烛龙：巨龙形态喷吐龙息、甩尾击退、不时召唤幼年宠物；生命过半化为人形，获得大招烛照九幽。
import { DRAGON, SPECIES_IDS } from '../content/species.js';
import { SIM } from '../content/tuning.js';
import { clamp, dist, normalize } from '../math.js';
import type { SkillId } from '../types.js';
import type { Unit } from './entities.js';
import { forward } from './motion.js';
import { densestCluster, nearestOpponent } from './query.js';
import {
  lobTo,
  opponents,
  planAt,
  planOn,
  targetInReach,
  type SkillHandler,
  type SkillPlan,
} from './skillkit.js';
import type { World } from './world.js';

export type BossSkillId = 'dragonBreath' | 'dragonTail' | 'dragonSummon' | 'dragonUlt';

/** 龙息：向目标方向喷出一道宽火焰，穿过沿路所有敌人并点燃。 */
const breath: SkillHandler = {
  plan(world, u) {
    return planOn(targetInReach(world, u, DRAGON.breath.range));
  },
  fire(world, u, a) {
    const T = DRAGON.breath;
    const speed = 600;
    const dir = normalize(a.tx - u.x, a.ty - u.y, forward(u), 0);
    world.spawnProjectile({
      kind: 'breath',
      team: u.team,
      x: u.x + dir.x * u.radius * 0.8,
      y: u.y + dir.y * u.radius * 0.8,
      vx: dir.x * speed,
      vy: dir.y * speed,
      element: u.element,
      damage: u.atk * T.mult,
      radius: T.width / 2,
      pierce: 99,
      reflectable: false,
      life: T.range / speed,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
      burnDps: u.atk * T.burnRatio,
      burnTime: T.burnTime,
      tx: u.x + dir.x * T.range,
      ty: u.y + dir.y * T.range,
    });
  },
};

/** 甩尾：把身边的敌人重重扫开，被扫飞的撞到别人或墙还会再受伤。 */
const tail: SkillHandler = {
  plan(world, u) {
    const reach = u.radius + DRAGON.tail.reach;
    const near = opponents(world, u).filter((e) => dist(u.x, u.y, e.x, e.y) <= reach + e.radius);
    return near.length >= 2 ? planAt(u.x, u.y) : null;
  },
  fire(world, u, a) {
    const T = DRAGON.tail;
    world.blast({
      x: u.x,
      y: u.y,
      radius: u.radius + T.reach,
      damage: u.atk * T.mult,
      team: u.team,
      sourceId: u.id,
      source: T.id,
      element: u.element,
      echo: 0,
      chain: a.chain,
      knock: T.knock,
    });
  },
};

/** 召唤：身边出现两只幼年宠物助战（场上召唤物有上限）。 */
const summon: SkillHandler = {
  plan(world, u) {
    const alive = world.units.filter((m) => m.alive);
    const mine = alive.filter((m) => m.summonedBy === u.id).length;
    if (mine + DRAGON.summon.count > DRAGON.summon.maxAlive) return null;
    if (alive.length + DRAGON.summon.count > SIM.maxUnits) return null;
    return planAt(u.x, u.y);
  },
  fire(world, u) {
    for (let i = 0; i < DRAGON.summon.count; i++) {
      const species = u.rng.pick(SPECIES_IDS);
      const side = i % 2 === 0 ? -1 : 1;
      const x = clamp(u.x + forward(u) * (u.radius + 30), 40, world.width - 40);
      const y = clamp(u.y + side * (u.radius + 36), 40, world.height - 40);
      const pet = world.spawnPet(species, 1, u.team, x, y, 0, u.id);
      world.emit({ type: 'spawn', unitId: pet.id });
    }
  },
};

/** 烛照九幽：火雨依次落在每个敌人身上，再向敌人最密集处砸下陨石。 */
const ult: SkillHandler = {
  plan(world, u) {
    return planOn(nearestOpponent(world, u.x, u.y, u.team));
  },
  fire(world, u, a) {
    const T = DRAGON.ult;
    const targets = opponents(world, u)
      .sort((p, q) => p.x - q.x || p.id - q.id)
      .slice(0, 10);
    targets.forEach((t, i) => {
      world.after(i * T.rainInterval, () => {
        if (!t.alive) return;
        world.blast({
          x: t.x,
          y: t.y,
          radius: 40,
          damage: u.atk * T.rainMult,
          team: u.team,
          sourceId: u.id,
          source: T.id,
          element: u.element,
          echo: 0,
          chain: a.chain,
        });
      });
    });
    const c = densestCluster(world, u.team, u.x, u.y, Infinity, T.meteorRadius);
    if (!c) return;
    lobTo(world, u, c.x, c.y, 'meteor', T.flight, 600, {
      damage: u.atk * T.meteorMult,
      radius: 30,
      splash: T.meteorRadius,
      source: T.id,
      chain: a.chain,
      fromX: c.x - forward(u) * 220,
      fromY: c.y - 160,
    });
  },
};

export const BOSS_HANDLERS: Record<BossSkillId, SkillHandler> = {
  dragonBreath: breath,
  dragonTail: tail,
  dragonSummon: summon,
  dragonUlt: ult,
};

export interface BossChoice {
  id: SkillId;
  plan: SkillPlan;
  cast: number;
}

/** 首领的下一招（召唤 > 甩尾 > 龙息）；都不合适就普通攻击。选中后进入冷却。 */
export function bossChoice(world: World, u: Unit): BossChoice | null {
  if (u.summonCd <= 0) {
    const plan = summon.plan(world, u);
    u.summonCd = DRAGON.summon.cooldown * (u.form === 1 ? 1 : 1.25);
    if (plan) return { id: DRAGON.summon.id, plan, cast: DRAGON.summon.cast };
  }
  if (u.form === 1 && u.tailCd <= 0) {
    const plan = tail.plan(world, u);
    if (plan) {
      u.tailCd = DRAGON.tail.cooldown;
      return { id: DRAGON.tail.id, plan, cast: DRAGON.tail.cast };
    }
  }
  if (u.breathCd <= 0) {
    const plan = breath.plan(world, u);
    if (plan) {
      u.breathCd = DRAGON.breath.cooldown;
      return { id: DRAGON.breath.id, plan, cast: DRAGON.breath.cast };
    }
  }
  return null;
}

/** 生命降到一半、还是巨龙形态时立刻变身（不理会眩晕和正在进行的动作）。 */
export function shouldTransform(u: Unit): boolean {
  return (
    u.role === 'boss' &&
    u.form === 1 &&
    u.hp <= u.maxHp * DRAGON.transformAt &&
    u.action?.kind !== 'transform'
  );
}
