// 人形态（3 阶）的大招：能量满 100 自动施放，前摇不能被打断。
import { SKILLS } from '../content/species.js';
import { ARENA, SIM } from '../content/tuning.js';
import { clamp, dist, normalize } from '../math.js';
import type { SpeciesId } from '../types.js';
import type { Unit } from './entities.js';
import { clampToArena, faceNow, forward } from './motion.js';
import { centroid, densestCluster, nearestOpponent, unitsInRadius } from './query.js';
import {
  allies,
  dashStep,
  lobTo,
  nearestPath,
  opponents,
  other,
  planAt,
  planOn,
  ram,
  rayToWall,
  slideInfo,
  strike,
  transfer,
  type SkillHandler,
} from './skillkit.js';
import type { World } from './world.js';

/** 以敌人最密集的地方为目标（范围不限）。 */
function clusterPlan(world: World, u: Unit, radius: number) {
  const c = densestCluster(world, u.team, u.x, u.y, Infinity, radius);
  return c ? planAt(c.x, c.y) : null;
}

/** 狐火·千本斩：依次瞬身斩过至多 6 个敌人（回响逐次 +1），随后全部引爆，再瞬身回原位。 */
const foxUlt: SkillHandler = {
  plan(world, u) {
    return planOn(nearestOpponent(world, u.x, u.y, u.team));
  },
  fire(world, u, a) {
    const T = SKILLS.fox.ult;
    a.queue = nearestPath(world, u, u.x, u.y, T.hops).map((e) => e.id);
    if (a.queue.length === 0) return;
    a.fromX = u.x;
    a.fromY = u.y;
    a.step = 0;
    a.timer = 0;
    a.phase = 2;
    world.setAct(u, 'dash', a.queue.length * T.interval + 0.2, true);
  },
  tick(world, u, a, dt) {
    const T = SKILLS.fox.ult;
    a.timer -= dt;
    if (a.timer > 0) return false;
    while (a.step < a.queue.length) {
      const t = world.unitById(a.queue[a.step] as number);
      a.step++;
      if (!t || !t.alive) continue;
      const dir = normalize(t.x - u.x, t.y - u.y, forward(u), 0);
      const reach = t.radius + u.radius + 4;
      const to = clampToArena(t.x + dir.x * reach, t.y + dir.y * reach, u.radius + 2);
      world.emit({ type: 'blink', unitId: u.id, fromX: u.x, fromY: u.y, toX: to.x, toY: to.y });
      u.x = to.x;
      u.y = to.y;
      faceNow(u, t.x, t.y);
      const echo = a.hits.length;
      transfer(world, u, t.x, t.y, echo, a.chain, T.id);
      strike(world, u, t, T.mult, T.id, a.chain, echo);
      a.hits.push(t.id);
      a.timer = T.interval;
      return false;
    }
    a.hits.forEach((id, i) => {
      const t = world.unitById(id);
      if (!t) return;
      world.blast({
        x: t.x,
        y: t.y,
        radius: T.blastRadius,
        damage: u.atk * T.blastMult,
        team: u.team,
        sourceId: u.id,
        source: T.id,
        element: u.element,
        echo: Math.min(SIM.echoCap, i + 1),
        chain: a.chain,
        transfer: true,
      });
    });
    const back = clampToArena(a.fromX, a.fromY, u.radius + 2);
    world.emit({ type: 'blink', unitId: u.id, fromX: u.x, fromY: u.y, toX: back.x, toY: back.y });
    u.x = back.x;
    u.y = back.y;
    return true;
  },
};

/** 凤凰陨：火凤穿过敌人最密集处一直飞到场边，沿路留下燃烧带；被它击倒的敌人连环爆炸。 */
const birdUlt: SkillHandler = {
  plan(world, u) {
    return clusterPlan(world, u, 120);
  },
  fire(world, u, a) {
    const T = SKILLS.bird.ult;
    const dir = normalize(a.tx - u.x, a.ty - u.y, forward(u), 0);
    const length = Math.max(60, rayToWall(u.x, u.y, dir.x, dir.y));
    const flight = length / T.speed;
    const zone = world.addZone({
      kind: 'burn',
      team: u.team,
      x: u.x,
      y: u.y,
      r: T.width / 2,
      angle: Math.atan2(dir.y, dir.x),
      length: 0,
      duration: flight + T.groundTime,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
      damage: u.atk * T.groundRatio,
      tick: SIM.dotTick,
    });
    world.spawnProjectile({
      kind: 'phoenix',
      team: u.team,
      x: u.x,
      y: u.y,
      vx: dir.x * T.speed,
      vy: dir.y * T.speed,
      element: u.element,
      damage: u.atk * T.mult,
      radius: T.width / 2,
      pierce: 99,
      reflectable: false,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
      life: flight,
      tx: u.x + dir.x * length,
      ty: u.y + dir.y * length,
      burst: { radius: T.burstRadius, damage: u.atk * T.burstMult },
      trailZoneId: zone.id,
    });
  },
};

/** 潮汐颂：治疗并护住全体队友；浪潮向前推开敌人，撞在一起的敌人产生撞击回响。 */
const otterUlt: SkillHandler = {
  plan(world, u) {
    if (opponents(world, u).length === 0) return null;
    return planAt(u.x + forward(u) * SKILLS.otter.ult.range, u.y);
  },
  fire(world, u, a) {
    const T = SKILLS.otter.ult;
    for (const ally of allies(world, u)) {
      world.heal(ally, ally.maxHp * T.heal, u.id);
      world.addShield(ally, ally.maxHp * T.shield, T.duration, u.id);
    }
    const fx = forward(u);
    for (const e of opponents(world, u)) {
      const along = (e.x - u.x) * fx;
      if (along < -40 || along > T.range) continue;
      world.after(Math.max(0, along) / T.waveSpeed, () => {
        if (!e.alive) return;
        strike(world, u, e, T.mult, T.id, a.chain);
        const n = normalize(fx, (e.y - u.y) / 600);
        world.knock(e, n.x, n.y, T.knock, slideInfo(u, T.id, a.chain));
      });
    }
  },
};

/** 玄武壁垒：在我方最前排前方立起水墙，弹回敌方弹丸（弹丸处理在 projectiles.ts），我方受伤减少。 */
const turtleUlt: SkillHandler = {
  plan(world, u) {
    return opponents(world, u).length > 0 ? planAt(u.x, u.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.turtle.ult;
    const team = allies(world, u);
    const fx = forward(u);
    const front =
      fx > 0
        ? Math.max(...team.map((x) => x.x + x.radius))
        : Math.min(...team.map((x) => x.x - x.radius));
    const wallX = clamp(front + fx * T.offset, 60, ARENA.width - 60);
    const cy = centroid(team)?.y ?? u.y;
    const y0 = clamp(cy - T.length / 2, 10, ARENA.height - T.length - 10);
    world.addZone({
      kind: 'waterWall',
      team: u.team,
      x: wallX,
      y: y0,
      r: 14,
      angle: Math.PI / 2,
      length: T.length,
      duration: T.duration,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
      reduction: T.reduction,
    });
  },
};

/** 森罗箭雨：敌人密集处降下十波箭雨，再射出三支贯穿箭。 */
const bunnyUlt: SkillHandler = {
  plan(world, u) {
    const c = densestCluster(world, u.team, u.x, u.y, u.range + 250, SKILLS.bunny.ult.radius);
    return c ? planAt(c.x, c.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.bunny.ult;
    world.addZone({
      kind: 'arrowRain',
      team: u.team,
      x: a.tx,
      y: a.ty,
      r: T.radius,
      duration: T.duration,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
      damage: u.atk * T.mult,
      waves: T.waves,
      tick: 0.1,
    });
    const base = Math.atan2(a.ty - u.y, a.tx - u.x);
    for (let i = 0; i < T.pierceArrows; i++) {
      const angle = base + (i - (T.pierceArrows - 1) / 2) * 0.1;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      world.spawnProjectile({
        kind: 'arrow',
        team: u.team,
        x: u.x + cos * (u.radius + 4),
        y: u.y + sin * (u.radius + 4),
        vx: cos * 760,
        vy: sin * 760,
        element: u.element,
        damage: u.atk * T.pierceMult,
        radius: 8,
        pierce: 99,
        reflectable: false,
        ownerId: u.id,
        source: T.id,
        chain: a.chain,
        life: 1.6,
      });
    }
  },
};

/** 万花缚：大范围缠绕拉拢，结束时花朵绽放爆炸并治疗全体队友（在 zones.ts 结算）。 */
const deerUlt: SkillHandler = {
  plan(world, u) {
    const c = densestCluster(world, u.team, u.x, u.y, u.range + 300, SKILLS.deer.ult.radius);
    return c ? planAt(c.x, c.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.deer.ult;
    world.addZone({
      kind: 'vines',
      team: u.team,
      x: a.tx,
      y: a.ty,
      r: T.radius,
      duration: T.root,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
      root: T.root,
      pull: T.pullSpeed,
      damage: u.atk * T.mult,
      heal: T.heal,
    });
    for (const e of unitsInRadius(world, a.tx, a.ty, T.radius, other(u.team))) {
      world.rootUnit(e, T.root);
    }
  },
};

/** 九霄雷落：依次雷击至多 10 个敌人（回响逐次 +1），最后在敌阵中心落下惊雷击晕。 */
const catUlt: SkillHandler = {
  plan(world, u) {
    return planOn(nearestOpponent(world, u.x, u.y, u.team));
  },
  fire(world, u, a) {
    const T = SKILLS.cat.ult;
    const targets = opponents(world, u)
      .sort((p, q) => dist(u.x, u.y, p.x, p.y) - dist(u.x, u.y, q.x, q.y) || p.id - q.id)
      .slice(0, T.strikes);
    let px = u.x;
    let py = u.y;
    targets.forEach((t, i) => {
      const fromX = px;
      const fromY = py;
      world.after(i * T.interval, () => {
        if (!t.alive) return;
        world.emit({
          type: 'chain',
          x1: fromX,
          y1: fromY,
          x2: t.x,
          y2: t.y,
          echo: Math.min(i, SIM.echoCap),
          element: u.element,
        });
        transfer(world, u, t.x, t.y, i, a.chain, T.id);
        strike(world, u, t, T.mult, T.id, a.chain, i);
      });
      px = t.x;
      py = t.y;
    });
    const finale = targets.length * T.interval + 0.15;
    world.after(finale, () => {
      const c = densestCluster(world, u.team, u.x, u.y, Infinity, T.radius);
      if (!c) return;
      world.blast({
        x: c.x,
        y: c.y,
        radius: T.radius,
        damage: u.atk * T.finalMult,
        team: u.team,
        sourceId: u.id,
        source: T.id,
        element: u.element,
        echo: 0,
        chain: a.chain,
        stun: T.stun,
      });
    });
    // 落雷期间一直保持施法姿势。
    a.dur = a.t + finale + 0.2;
    world.setAct(u, 'ult', a.dur, false);
  },
};

/** 雷狼噬：穿过敌阵来回冲锋三次，每次击退并击晕，最后在敌阵中心引发雷爆。 */
const wolfUlt: SkillHandler = {
  plan(world, u) {
    return clusterPlan(world, u, 150);
  },
  fire(world, u, a) {
    const T = SKILLS.wolf.ult;
    const dir = normalize(a.tx - u.x, a.ty - u.y, forward(u), 0);
    const pad = u.radius + 6;
    const beyond = clampToArena(a.tx + dir.x * T.overshoot, a.ty + dir.y * T.overshoot, pad);
    const behind = clampToArena(a.tx - dir.x * T.overshoot, a.ty - dir.y * T.overshoot, pad);
    a.path = [beyond, behind, beyond].slice(0, T.passes);
    a.step = 0;
    a.timer = 0;
    a.phase = 2;
    world.setAct(u, 'dash', 1.6, true);
    world.emit({
      type: 'dash',
      unitId: u.id,
      fromX: u.x,
      fromY: u.y,
      toX: beyond.x,
      toY: beyond.y,
    });
  },
  tick(world, u, a, dt) {
    const T = SKILLS.wolf.ult;
    const arrived = dashStep(world, u, a, T.speed, dt, (e) =>
      ram(world, u, e, a, T.id, T.mult, T.knock, T.stun),
    );
    if (!arrived) return false;
    a.step++;
    a.hits = [];
    a.timer = 0;
    const next = a.path[a.step];
    if (next) {
      world.emit({ type: 'dash', unitId: u.id, fromX: u.x, fromY: u.y, toX: next.x, toY: next.y });
      return false;
    }
    world.blast({
      x: a.tx,
      y: a.ty,
      radius: T.blastRadius,
      damage: u.atk * T.blastMult,
      team: u.team,
      sourceId: u.id,
      source: T.id,
      element: u.element,
      echo: 0,
      chain: a.chain,
    });
    return true;
  },
};

/** 岩王崩山：一圈岩刺把周围敌人掀到空中，附近队友披上石肤。 */
const bearUlt: SkillHandler = {
  plan(world, u) {
    const T = SKILLS.bear.ult;
    const near = opponents(world, u).some((e) => dist(u.x, u.y, e.x, e.y) <= T.radius + e.radius);
    return near ? planAt(u.x, u.y) : null;
  },
  fire(world, u, a) {
    const T = SKILLS.bear.ult;
    world.addZone({
      kind: 'spikeRing',
      team: u.team,
      x: u.x,
      y: u.y,
      r: T.radius,
      duration: 1,
      ownerId: u.id,
      source: T.id,
      chain: a.chain,
    });
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
    for (const ally of allies(world, u)) {
      if (dist(u.x, u.y, ally.x, ally.y) > T.skinRadius) continue;
      ally.stoneSkin = Math.max(ally.stoneSkin, T.skinTime);
      world.emitStatus(ally, 'stoneSkin', T.skinTime);
    }
  },
};

/** 晶陨：巨型晶石从高空砸向敌人最密集处，再向四周炸出晶片。 */
const lizardUlt: SkillHandler = {
  plan(world, u) {
    return clusterPlan(world, u, SKILLS.lizard.ult.radius);
  },
  fire(world, u, a) {
    const T = SKILLS.lizard.ult;
    const fromX = a.tx - forward(u) * 220;
    const fromY = a.ty - 160;
    lobTo(world, u, a.tx, a.ty, 'meteor', T.flight, 600, {
      damage: u.atk * T.mult,
      radius: 30,
      splash: T.radius,
      source: T.id,
      chain: a.chain,
      fromX,
      fromY,
      shards: T.shards,
      shardDamage: u.atk * T.shardMult,
      shardSpeed: T.shardSpeed,
      shardRange: T.shardRange,
    });
  },
};

export const SPECIES_ULTS: Record<SpeciesId, SkillHandler> = {
  fox: foxUlt,
  bird: birdUlt,
  otter: otterUlt,
  turtle: turtleUlt,
  bunny: bunnyUlt,
  deer: deerUlt,
  cat: catUlt,
  wolf: wolfUlt,
  bear: bearUlt,
  lizard: lizardUlt,
};
