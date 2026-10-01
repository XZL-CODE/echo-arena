// 通用规则：属性克制、回响、能量与大招、状态、首领变身、集火、步法、复现与时限。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  counterMult,
  counters,
  counterSign,
  ELEMENT_NAME,
  ELEMENTS,
} from '../../src/core/content/elements.js';
import { ENCOUNTERS } from '../../src/core/content/encounters.js';
import { DRAGON } from '../../src/core/content/species.js';
import { ARENA, ENERGY, SIM } from '../../src/core/content/tuning.js';
import { battleConfig } from '../../src/core/run/run.js';
import type { Unit } from '../../src/core/sim/entities.js';
import type { SimEvent } from '../../src/core/sim/events.js';
import { World, type DamageInfo } from '../../src/core/sim/world.js';
import type { Element } from '../../src/core/types.js';
import {
  advanceTo,
  foe,
  makeWorld,
  quiet,
  runFor,
  simulate,
  testEncounter,
} from './tools/harness.js';

type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

function only<T extends SimEvent['type']>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function hitInfo(attacker: Unit, echo = 0): DamageInfo {
  return {
    team: attacker.team,
    sourceId: attacker.id,
    source: 'basic',
    element: attacker.element,
    echo,
    chain: 1,
  };
}

test('场地：18 × 11 米，双方布阵区之间留出接近的距离', () => {
  assert.equal(ARENA.width, 1800);
  assert.equal(ARENA.height, 1100);
  assert.ok(ARENA.playerZoneMaxX < ARENA.enemyZoneMinX);
  for (const e of ENCOUNTERS) {
    for (const p of e.legion) {
      assert.ok(p.x >= ARENA.enemyZoneMinX && p.x <= ARENA.width - ARENA.margin, e.id);
      assert.ok(p.y >= ARENA.margin && p.y <= ARENA.height - ARENA.margin, e.id);
    }
  }
});

test('属性克制：水 > 火 > 木 > 岩 > 雷 > 水', () => {
  const cycle: Element[] = ['water', 'fire', 'wood', 'rock', 'thunder'];
  cycle.forEach((a, i) => {
    const b = cycle[(i + 1) % cycle.length] as Element;
    assert.ok(counters(a, b), `${a} 克 ${b}`);
    assert.ok(!counters(b, a));
    assert.equal(counterMult(a, b), 1.3);
    assert.equal(counterMult(b, a), 0.85);
    assert.equal(counterSign(a, b), 1);
    assert.equal(counterSign(b, a), -1);
  });
  assert.equal(counterMult('fire', 'fire'), 1);
  assert.equal(counterMult('fire', 'rock'), 1);
  assert.equal(counterSign('water', 'wood'), 0);
  assert.deepEqual(
    ELEMENTS.map((e) => ELEMENT_NAME[e]),
    ['火', '水', '木', '岩', '雷'],
  );
});

test('伤害：克制倍率、回响加成（上限 8 级），伤害事件标出克制关系', () => {
  const world = makeWorld(
    [foe('fox', 1, 1300, 550), foe('turtle', 1, 1300, 700)],
    [{ species: 'otter', form: 1, x: 300, y: 550 }],
  );
  const otter = world.petByUid(1) as Unit;
  const [fox, turtle] = world.units.filter((u) => u.team === 1) as [Unit, Unit];
  fox.maxHp = fox.hp = 10000;
  turtle.maxHp = turtle.hp = 10000;

  assert.equal(world.damage(fox, 10, hitInfo(otter)), 13, '水打火 ×1.3');
  assert.equal(world.damage(turtle, 10, hitInfo(otter)), 10, '同系不加成');
  assert.ok(Math.abs(world.damage(turtle, 10, hitInfo(otter, 2)) - 15) < 1e-9, '回响 2 级 ×1.5');
  const capped = world.damage(turtle, 10, hitInfo(otter, 20));
  assert.ok(Math.abs(capped - 10 * (1 + SIM.echoBonus * SIM.echoCap)) < 1e-9, '回响最多算 8 级');
  const hits = only(world.drainEvents(), 'hit');
  assert.deepEqual(
    hits.map((h) => h.counter),
    [1, 0, 0, 0],
  );
  assert.equal(hits[3]?.echo, SIM.echoCap);

  const burn = world.damage(otter, 10, hitInfo(fox));
  assert.ok(Math.abs(burn - 8.5) < 1e-9, '火打水被克制 ×0.85');
  assert.equal(only(world.drainEvents(), 'hit')[0]?.counter, -1);
});

test('只有人形态有能量：满 100 自动放大招，放大招不会被打断', () => {
  const world = makeWorld(
    [foe('bear', 1, 760, 520), foe('bear', 1, 760, 580)],
    [
      { species: 'bear', form: 3, x: 600, y: 550 },
      { species: 'bear', form: 2, x: 560, y: 450 },
      { species: 'bear', form: 1, x: 560, y: 650 },
    ],
  );
  const [three, two, one] = [1, 2, 3].map((uid) => world.petByUid(uid) as Unit) as [
    Unit,
    Unit,
    Unit,
  ];
  assert.equal(three.energy, ENERGY.start);
  assert.equal(two.energy, -1);
  assert.equal(one.energy, -1);
  quiet(world, [three]);
  three.skillCd = 999;

  // 挨打也会积累能量，没有大招的单位不会。
  world.damage(two, 50, hitInfo(world.units.find((u) => u.team === 1) as Unit));
  assert.equal(two.energy, -1);
  const before = three.energy;
  world.damage(three, three.maxHp * 0.1, hitInfo(world.units.find((u) => u.team === 1) as Unit));
  assert.ok(Math.abs(three.energy - before - 0.1 * ENERGY.perDamageTaken) < 1e-6);

  three.energy = 99.9;
  const events: SimEvent[] = [];
  for (let i = 0; i < 60 * 3 && !only(events, 'ult').length; i++) {
    world.step();
    events.push(...world.drainEvents());
  }
  assert.ok(only(events, 'energyFull').some((e) => e.unitId === three.id));
  const ult = only(events, 'ult').find((e) => e.unitId === three.id);
  assert.ok(ult, '能量满了放出大招');
  assert.equal(three.act, 'ult');
  world.stunUnit(three, 2);
  world.knock(three, 1, 0, 2000, {
    team: 1,
    ownerId: 0,
    echo: 0,
    chain: 0,
    source: 'basic',
    power: 10,
    element: 'rock',
  });
  assert.equal(three.stun, 0, '大招前摇不会被眩晕打断');
  assert.equal(three.slide, null, '也不会被击退');
  assert.equal(three.action?.kind, 'bearUlt');
  const after = runFor(world, 2);
  assert.ok(
    only(after, 'zone').some((e) => e.kind === 'spikeRing'),
    '大招照常生效',
  );
  assert.equal(only(after, 'ult').filter((e) => e.unitId !== three.id).length, 0);
});

test('2 阶以下整场都不会放大招', () => {
  const world = makeWorld('sprouts', [
    { species: 'fox', form: 2, x: 500, y: 450 },
    { species: 'bear', form: 2, x: 600, y: 550 },
    { species: 'bird', form: 1, x: 300, y: 650 },
  ]);
  let ults = 0;
  for (let i = 0; i < 60 * 60 && !world.result; i++) {
    world.step();
    ults += only(world.drainEvents(), 'ult').length;
  }
  assert.equal(ults, 0);
});

test('状态：灼烧持续掉血，定身不能走但能打，眩晕什么都做不了，挑衅强制换目标', () => {
  const world = makeWorld(
    [foe('wolf', 1, 900, 550), foe('fox', 1, 1100, 700)],
    [
      { species: 'bunny', form: 1, x: 500, y: 550 },
      { species: 'turtle', form: 1, x: 600, y: 400 },
    ],
  );
  quiet(world);
  const bunny = world.petByUid(1) as Unit;
  const turtle = world.petByUid(2) as Unit;
  const [wolf, fox] = world.units.filter((u) => u.team === 1) as [Unit, Unit];

  world.burnUnit(wolf, 10, 2, bunny.id, 'basic');
  const burnHits = only(runFor(world, 2.1), 'hit').filter((e) => e.dot && e.targetId === wolf.id);
  assert.ok(burnHits.length >= 3, `灼烧按间隔结算：${burnHits.length}`);
  assert.equal(wolf.burn, 0);

  // 定身：原地不动，但够得着就照样攻击。
  bunny.x = 500;
  world.rootUnit(bunny, 3);
  const x0 = bunny.x;
  const rooted = runFor(world, 1.5);
  assert.ok(Math.abs(bunny.x - x0) < 1, '定身时不走动');
  assert.ok(
    only(rooted, 'attack').some((e) => e.unitId === bunny.id),
    '定身时照样攻击',
  );

  // 眩晕：不出手，也不走动。
  world.stunUnit(fox, 1.5, true);
  assert.ok(fox.airborne > 0);
  const stunned = runFor(world, 1);
  assert.ok(!stunned.some((e) => e.type === 'attack' && e.unitId === fox.id));
  assert.equal(fox.act, 'stunned');

  // 挑衅：强制攻击挑衅者。
  world.tauntUnit(wolf, turtle.id, 2);
  runFor(world, 0.2);
  assert.equal(wolf.targetId, turtle.id);
});

test('击飞撞墙：被我方技能撞飞的敌人撞到场地边缘，产生撞击回响', () => {
  const world = makeWorld(
    [foe('cat', 1, 1650, 550)],
    [{ species: 'wolf', form: 1, x: 300, y: 550 }],
  );
  quiet(world);
  const wolf = world.petByUid(1) as Unit;
  const cat = world.units.find((u) => u.team === 1) as Unit;
  world.knock(cat, 1, 0, 900, {
    team: 0,
    ownerId: wolf.id,
    echo: 0,
    chain: world.newChain(),
    source: 'wolfSkill',
    power: wolf.atk,
    element: wolf.element,
  });
  const events = runFor(world, 0.5);
  const impact = only(events, 'impact')[0];
  assert.ok(impact, '撞墙了');
  assert.equal(impact.echo, 1);
  assert.ok(only(events, 'hit').some((e) => e.source === 'impact' && e.targetId === cat.id));
  assert.equal(world.stats.impacts, 1);
});

test('首领烛龙：生命降到一半化为人形，变身时不受伤，人形才有能量与大招', () => {
  const world = new World({
    encounter: testEncounter([], { boss: { x: 1400, y: 550 } }),
    seed: 3,
    difficulty: 'normal',
    matchIndex: 6,
    legion: [{ uid: 1, species: 'bear', form: 3, x: 400, y: 550 }],
  });
  const boss = world.units.find((u) => u.species === 'dragon') as Unit;
  const bear = world.petByUid(1) as Unit;
  quiet(world);
  assert.equal(boss.form, 1);
  assert.equal(boss.radius, DRAGON.stats[0].radius);
  assert.equal(boss.energy, -1);
  world.damage(boss, boss.maxHp * 10, hitInfo(bear));
  assert.ok(boss.alive, '巨龙形态不会被一下打死');
  assert.ok(boss.hp >= boss.maxHp * 0.45 && boss.hp <= boss.maxHp * 0.5);
  const events: SimEvent[] = [];
  world.step();
  events.push(...world.drainEvents());
  assert.equal(boss.action?.kind, 'transform');
  assert.equal(world.damage(boss, 500, hitInfo(bear)), 0, '变身时不受伤');
  events.push(...runFor(world, DRAGON.transformTime + 0.3));
  assert.ok(only(events, 'transform').some((e) => e.unitId === boss.id));
  assert.equal(boss.form, 2);
  assert.equal(boss.radius, DRAGON.stats[1].radius);
  assert.equal(boss.energy, ENERGY.start);
  assert.ok(world.formsSeen.includes('dragon-1') && world.formsSeen.includes('dragon-2'));
});

test('首领烛龙：不时召唤两只幼年宠物助战', () => {
  const world = new World({
    encounter: testEncounter([], { boss: { x: 1400, y: 550 } }),
    seed: 5,
    difficulty: 'normal',
    matchIndex: 6,
    legion: [{ uid: 1, species: 'turtle', form: 3, x: 300, y: 550 }],
  });
  const boss = world.units.find((u) => u.species === 'dragon') as Unit;
  boss.summonCd = 0;
  const events = runFor(world, 1.5);
  const spawns = only(events, 'spawn');
  assert.equal(spawns.length, DRAGON.summon.count);
  for (const s of spawns) {
    const pet = world.unitById(s.unitId) as Unit;
    assert.equal(pet.team, 1);
    assert.equal(pet.form, 1);
    assert.equal(pet.summonedBy, boss.id);
    assert.equal(pet.uid, 0);
  }
});

test('集火：我方全体改打被点的敌人；再点一次取消；对手不理会集火', () => {
  const world = makeWorld(
    [foe('bear', 1, 900, 550), foe('bunny', 1, 1400, 300)],
    [
      { species: 'wolf', form: 1, x: 600, y: 550 },
      { species: 'cat', form: 1, x: 400, y: 450 },
      { species: 'bird', form: 1, x: 400, y: 650 },
    ],
  );
  quiet(world);
  runFor(world, 1);
  const [bear, bunny] = world.units.filter((u) => u.team === 1) as [Unit, Unit];
  const players = world.units.filter((u) => u.team === 0);
  assert.ok(
    players.every((u) => u.targetId === bear.id),
    '默认打最近的敌人',
  );

  world.setFocus(bunny.id);
  assert.equal(world.focusId, bunny.id);
  runFor(world, 0.1);
  assert.ok(
    players.every((u) => u.targetId === bunny.id),
    '全体改打集火目标',
  );
  assert.ok(world.units.filter((u) => u.team === 1).every((u) => u.targetId !== bunny.id));
  assert.equal(world.stats.focusUsed, 1);

  world.setFocus(bunny.id);
  assert.equal(world.focusId, 0, '再点一次取消');
  world.setFocus(players[0]?.id ?? 0);
  assert.equal(world.focusId, 0, '不能集火自己人');

  world.setFocus(bunny.id);
  world.damage(bunny, 99999, hitInfo(players[0] as Unit));
  assert.equal(world.focusId, 0, '集火目标倒下后自动取消');
});

test('步法：接近、后撤、绕身、交叉换位、横移都会出现，但不会产生冲刺或瞬身事件', () => {
  const world = makeWorld('sprouts', [
    { species: 'fox', form: 1, x: 460, y: 450 },
    { species: 'wolf', form: 1, x: 460, y: 650 },
    { species: 'bunny', form: 1, x: 330, y: 550 },
    { species: 'turtle', form: 1, x: 580, y: 550 },
  ]);
  quiet(world);
  const seen = new Set<string>();
  let dashes = 0;
  let overlap = 0;
  for (let i = 0; i < 60 * 40 && !world.result; i++) {
    world.step();
    for (const e of world.drainEvents()) if (e.type === 'dash' || e.type === 'blink') dashes++;
    const alive = world.units.filter((u) => u.alive);
    for (const u of alive) {
      seen.add(u.footwork);
      for (const o of alive) {
        if (o.id <= u.id || o.team !== u.team) continue;
        const d = Math.hypot(u.x - o.x, u.y - o.y);
        overlap = Math.max(overlap, u.radius + o.radius - d);
      }
    }
  }
  for (const kind of ['approach', 'step', 'circle', 'cross', 'strafe', 'none']) {
    assert.ok(seen.has(kind), `出现了 ${kind}`);
  }
  assert.equal(dashes, 0, '普通步法不产生冲刺、瞬身事件');
  assert.ok(overlap < 16, `队友之间不会叠在一起：最大重叠 ${overlap.toFixed(1)}`);
});

test('同一配置与种子的战斗完全可复现', () => {
  const run = advanceTo(7, 'normal', 'evolve-first', 3);
  const config = battleConfig(run);
  const snap = (w: World) =>
    JSON.stringify(
      w.units.map((u) => [u.species, u.form, u.x.toFixed(4), u.y.toFixed(4), u.hp.toFixed(4)]),
    );
  const a = new World(config);
  const b = new World(config);
  a.run(40);
  b.run(40);
  assert.equal(snap(a), snap(b));
  assert.equal(a.stats.maxEcho, b.stats.maxEcho);
  const full = simulate(new World(config));
  const again = simulate(new World(config));
  assert.equal(full.result, again.result);
  assert.equal(full.time, again.time);
});

test('加时：60 秒后伤害逐级提高；180 秒仍未分出胜负判负', () => {
  const world = makeWorld(
    [foe('turtle', 3, 1500, 550)],
    [{ species: 'turtle', form: 3, x: 300, y: 550 }],
  );
  world.t = SIM.overtimeStart - 0.01;
  const events = runFor(world, 0.1);
  assert.ok(only(events, 'overtime').some((e) => e.level === 1));
  assert.ok(Math.abs(world.overtimeMult() - (1 + SIM.overtimeBonus)) < 1e-9);
  world.t = SIM.timeLimit - 0.01;
  const end = runFor(world, 0.1);
  assert.equal(world.result, 'lose');
  assert.equal(world.stats.timeout, true);
  assert.ok(only(end, 'end').some((e) => e.result === 'lose'));
});

test('回响有上限；两边都在架盾时弹丸来回反射也有次数上限，不会无限增长', () => {
  const world = makeWorld(
    [
      foe('turtle', 2, 900, 480),
      foe('turtle', 2, 900, 620),
      foe('bunny', 2, 1200, 400),
      foe('bunny', 2, 1200, 700),
      foe('cat', 2, 1250, 550),
    ],
    [
      { species: 'turtle', form: 2, x: 640, y: 480 },
      { species: 'turtle', form: 2, x: 640, y: 620 },
      { species: 'bunny', form: 2, x: 380, y: 400 },
      { species: 'bunny', form: 2, x: 380, y: 700 },
      { species: 'cat', form: 2, x: 330, y: 550 },
    ],
  );
  let maxProjectiles = 0;
  let maxEcho = 0;
  for (let i = 0; i < 60 * 60 && !world.result; i++) {
    for (const u of world.units) if (u.species === 'turtle' && u.alive) u.guard = 1;
    world.step();
    for (const e of world.drainEvents())
      if (e.type === 'echo') maxEcho = Math.max(maxEcho, e.level);
    maxProjectiles = Math.max(maxProjectiles, world.projectiles.length);
    for (const p of world.projectiles) {
      assert.ok(p.reflects <= SIM.maxReflects);
      assert.ok(p.echo <= SIM.echoCap);
    }
  }
  assert.ok(world.stats.reflects > 0, '确实发生了反射');
  assert.ok(maxEcho <= SIM.echoCap);
  assert.ok(maxProjectiles <= SIM.maxProjectiles);
});

test('每一场对局都会在时限内结束，且模拟足够快', () => {
  for (const e of ENCOUNTERS) {
    const run = advanceTo(11, 'normal', 'mixed', e.tier - 1);
    const started = Date.now();
    const outcome = simulate(new World({ ...battleConfig(run), encounter: e }));
    const elapsed = Date.now() - started;
    assert.ok(outcome.time <= SIM.timeLimit + SIM.dt, `${e.id} 超时`);
    assert.ok(outcome.world.result !== null, `${e.id} 没有结果`);
    assert.ok(elapsed < 4000, `${e.id} 模拟过慢：${elapsed}ms`);
  }
});
