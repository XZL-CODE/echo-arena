// 每个物种的技能都要在可重复的场景里真的改变战斗：路线、目标、连锁、站位。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKILLS } from '../../src/core/content/species.js';
import { dist } from '../../src/core/math.js';
import type { Unit } from '../../src/core/sim/entities.js';
import type { SimEvent } from '../../src/core/sim/events.js';
import type { World } from '../../src/core/sim/world.js';
import type { SpeciesId } from '../../src/core/types.js';
import { foe, makeWorld, quiet, runFor } from './tools/harness.js';

type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

function only<T extends SimEvent['type']>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

/** 记下之后生成的全部弹丸种类（有的晶片生成当步就命中，不会留在弹丸列表里）。 */
function recordSpawns(world: World): string[] {
  const kinds: string[] = [];
  const original = world.spawnProjectile.bind(world);
  world.spawnProjectile = (init) => {
    kinds.push(init.kind);
    return original(init);
  };
  return kinds;
}

function pet(world: World, uid: number): Unit {
  const u = world.petByUid(uid);
  assert.ok(u, `找不到 uid ${uid}`);
  return u;
}

function enemies(world: World): Unit[] {
  return world.units.filter((u) => u.team === 1);
}

/** 只让一只宠物放技能：冷却清零，其他单位全部不放技能。 */
function armSkill(world: World, u: Unit): void {
  quiet(world, [u]);
  u.energy = -1;
  u.skillCd = 0;
}

test('焰狐 2 阶：焰爪突袭先冲生命最低的敌人，再冲第二个，第二击回响 +1', () => {
  const world = makeWorld(
    [foe('cat', 1, 880, 500), foe('bunny', 1, 960, 620)],
    [{ species: 'fox', form: 2, x: 600, y: 550 }],
  );
  const fox = pet(world, 1);
  const [cat, bunny] = enemies(world) as [Unit, Unit];
  cat.hp = 90;
  bunny.hp = 160;
  armSkill(world, fox);
  const events = runFor(world, 1.5);
  const hits = only(events, 'hit').filter((e) => e.source === 'foxSkill' && !e.dot);
  assert.deepEqual(
    hits.map((h) => h.targetId),
    [cat.id, bunny.id],
    '先冲生命最低的电团猫，再冲叶耳兔',
  );
  assert.deepEqual(
    hits.map((h) => h.echo),
    [0, 1],
  );
  assert.ok(only(events, 'dash').length >= 2, '每一段冲刺都有 dash 事件');
  assert.ok(only(events, 'echo').some((e) => e.level === 1 && e.source === 'foxSkill'));
  assert.ok(bunny.burn > 0 || only(events, 'status').some((e) => e.status === 'burn'));
});

test('焰狐 1 阶：只冲一个目标', () => {
  const world = makeWorld(
    [foe('cat', 1, 880, 500), foe('bunny', 1, 960, 620)],
    [{ species: 'fox', form: 1, x: 600, y: 550 }],
  );
  const fox = pet(world, 1);
  armSkill(world, fox);
  const hits = only(runFor(world, 1.5), 'hit').filter((e) => e.source === 'foxSkill' && !e.dot);
  assert.equal(hits.length, 1);
});

test('电团猫：连环雷依次跳 4 个敌人，回响 0 → 3', () => {
  const xs = [800, 910, 1020, 1130, 1240];
  const world = makeWorld(
    xs.map((x) => foe('bear', 1, x, 550)),
    [{ species: 'cat', form: 1, x: 600, y: 550 }],
  );
  const cat = pet(world, 1);
  armSkill(world, cat);
  const events = runFor(world, 1.2);
  const chains = only(events, 'chain');
  assert.deepEqual(
    chains.map((c) => c.echo),
    [0, 1, 2, 3],
  );
  const hits = only(events, 'hit').filter((e) => e.source === 'catSkill');
  assert.equal(new Set(hits.map((h) => h.targetId)).size, 4, '每跳一个不同的敌人');
  assert.deepEqual(
    hits.map((h) => h.echo),
    [0, 1, 2, 3],
  );
  // 伤害随回响递增：同样的目标属性下，后面的跳跃伤害更高。
  assert.ok((hits[3] as EventOf<'hit'>).amount > (hits[0] as EventOf<'hit'>).amount);
});

test('雷纹猫 2 阶：连环雷最多跳 6 个敌人', () => {
  const xs = [800, 890, 980, 1070, 1160, 1250, 1340];
  const world = makeWorld(
    xs.map((x) => foe('bear', 1, x, 550)),
    [{ species: 'cat', form: 2, x: 600, y: 550 }],
  );
  const cat = pet(world, 1);
  armSkill(world, cat);
  const chains = only(runFor(world, 1.5), 'chain');
  assert.equal(chains.length, 6);
});

test('盾盾龟：玄甲壁挑衅附近敌人，正面飞来的弹丸被弹回射手（回响 +1）', () => {
  const world = makeWorld(
    [foe('wolf', 1, 740, 650), foe('bunny', 1, 950, 470)],
    [{ species: 'turtle', form: 1, x: 600, y: 550 }],
  );
  const turtle = pet(world, 1);
  const [wolf, bunny] = enemies(world) as [Unit, Unit];
  armSkill(world, turtle);
  const cast = runFor(world, 0.3);
  assert.ok(only(cast, 'skill').some((e) => e.unitId === turtle.id && e.skill === 'turtleSkill'));
  assert.ok(turtle.guard > 0, '正在架盾');
  assert.equal(wolf.tauntBy, turtle.id, '附近的敌人被挑衅');
  assert.ok(wolf.taunt > 0);

  const arrow = world.spawnProjectile({
    kind: 'arrow',
    team: 1,
    x: turtle.x + 150,
    y: turtle.y - 10,
    vx: -600,
    vy: 40,
    element: 'wood',
    damage: 10,
    ownerId: bunny.id,
    radius: 6,
  });
  const events = runFor(world, 1.5);
  const reflect = only(events, 'reflect').find((e) => e.unitId === turtle.id);
  assert.ok(reflect, '箭被玄甲壁弹回');
  assert.equal(reflect.echo, 1);
  assert.equal(arrow.team, 0, '弹回后成了我方弹丸');
  const back = only(events, 'hit').find((e) => e.source === 'reflect' && e.targetId === bunny.id);
  assert.ok(back, '弹回的箭打中了射手');
  assert.equal(back.echo, 1);
});

test('泡泡獭：泡泡护盾套给受伤的队友，吸收伤害，并把敌方弹丸弹回去', () => {
  const world = makeWorld(
    [foe('bunny', 1, 1000, 550)],
    [
      { species: 'otter', form: 1, x: 420, y: 550 },
      { species: 'turtle', form: 1, x: 600, y: 550 },
    ],
  );
  const otter = pet(world, 1);
  const turtle = pet(world, 2);
  const bunny = enemies(world)[0] as Unit;
  turtle.hp = turtle.maxHp * 0.5;
  armSkill(world, otter);
  const events = runFor(world, 0.5);
  assert.ok(only(events, 'shield').some((e) => e.targetId === turtle.id));
  const shield = turtle.shield;
  assert.ok(shield > 0, '队友有了泡泡');

  const hp = turtle.hp;
  world.damage(turtle, 20, {
    team: 1,
    sourceId: bunny.id,
    source: 'basic',
    element: 'thunder',
    echo: 0,
    chain: 0,
  });
  assert.equal(turtle.hp, hp, '泡泡先吸收伤害');
  assert.ok(turtle.shield < shield);

  const arrow = world.spawnProjectile({
    kind: 'arrow',
    team: 1,
    x: turtle.x + 120,
    y: turtle.y,
    vx: -600,
    vy: 0,
    element: 'wood',
    damage: 10,
    ownerId: bunny.id,
  });
  const after = runFor(world, 1);
  assert.ok(only(after, 'reflect').some((e) => e.unitId === turtle.id && e.echo === 1));
  assert.equal(arrow.team, 0);
});

test('迅雷狼崽：奔雷突把敌人往两侧撞飞，撞上同伴产生撞击回响', () => {
  const world = makeWorld(
    [foe('cat', 1, 770, 550), foe('cat', 1, 770, 505), foe('cat', 1, 770, 595)],
    [{ species: 'wolf', form: 1, x: 560, y: 550 }],
  );
  const wolf = pet(world, 1);
  armSkill(world, wolf);
  const events = runFor(world, 1.5);
  assert.ok(only(events, 'dash').some((e) => e.unitId === wolf.id));
  const impacts = only(events, 'impact');
  assert.ok(impacts.length > 0, '被撞飞的敌人撞到了别人或墙');
  assert.ok(impacts.every((e) => e.echo >= 1));
  assert.ok(only(events, 'echo').some((e) => e.source === 'impact' && e.level >= 1));
  assert.ok(only(events, 'hit').some((e) => e.source === 'impact' && e.echo >= 1));
  assert.ok(world.stats.impacts > 0);
});

test('迅雷狼 2 阶：冲锋终点落雷，击晕附近敌人', () => {
  const world = makeWorld(
    [foe('bear', 1, 800, 550), foe('bear', 1, 860, 600)],
    [{ species: 'wolf', form: 2, x: 600, y: 550 }],
  );
  const wolf = pet(world, 1);
  armSkill(world, wolf);
  const events = runFor(world, 1.2);
  assert.ok(only(events, 'explode').some((e) => e.source === 'wolfSkill'));
  assert.ok(only(events, 'status').some((e) => e.status === 'stun'));
});

test('花角鹿：藤缚缠住敌人并把它们拉到一起', () => {
  const world = makeWorld(
    [foe('bunny', 1, 800, 500), foe('bunny', 1, 800, 600), foe('bunny', 1, 860, 550)],
    [{ species: 'deer', form: 2, x: 600, y: 550 }],
  );
  const deer = pet(world, 1);
  const foes = enemies(world);
  for (const e of foes) e.speed = 0;
  const spread = () => {
    let sum = 0;
    for (let i = 0; i < foes.length; i++) {
      for (let j = i + 1; j < foes.length; j++) {
        const a = foes[i] as Unit;
        const b = foes[j] as Unit;
        sum += dist(a.x, a.y, b.x, b.y);
      }
    }
    return sum;
  };
  const before = spread();
  armSkill(world, deer);
  const events = runFor(world, 0.6);
  const zone = only(events, 'zone').find((e) => e.kind === 'vines');
  assert.ok(zone, '长出了藤蔓');
  assert.equal(zone.r, SKILLS.deer.skill.radius[1]);
  assert.ok(
    foes.every((e) => e.root > 0),
    '圈里的敌人都被定身',
  );
  runFor(world, 1);
  assert.ok(spread() < before * 0.85, `敌人被拉近：${before.toFixed(0)} → ${spread().toFixed(0)}`);
});

test('晶晶蜥：晶簇落地碎成晶片向外飞射，晶片命中回响 +1', () => {
  const world = makeWorld(
    [
      foe('bear', 1, 900, 550),
      foe('bear', 1, 960, 480),
      foe('bear', 1, 960, 620),
      foe('bear', 1, 1020, 550),
    ],
    [{ species: 'lizard', form: 1, x: 600, y: 550 }],
  );
  const lizard = pet(world, 1);
  armSkill(world, lizard);
  const spawned = recordSpawns(world);
  const events = runFor(world, 2.2);
  assert.ok(spawned.includes('bigcrystal'), '抛出了大晶簇');
  assert.equal(
    spawned.filter((k) => k === 'shard').length,
    SKILLS.lizard.skill.shards[0],
    '碎成 6 片',
  );
  const shardHits = only(events, 'hit').filter((e) => e.source === 'lizardSkill' && e.echo >= 1);
  assert.ok(shardHits.length > 0, '晶片命中了敌人');
});

test('石头熊：裂地击把周围敌人掀到空中', () => {
  const world = makeWorld(
    [foe('fox', 1, 660, 520), foe('fox', 1, 660, 580)],
    [{ species: 'bear', form: 1, x: 600, y: 550 }],
  );
  const bear = pet(world, 1);
  armSkill(world, bear);
  const events = runFor(world, 0.5);
  const ups = only(events, 'status').filter((e) => e.status === 'knockup');
  assert.equal(ups.length, 2);
  for (const e of enemies(world)) {
    assert.ok(e.airborne > 0, '敌人被掀到空中');
    assert.ok(e.stun > 0);
  }
});

test('岩甲熊 2 阶：裂地击再向前掀起一排岩刺', () => {
  const world = makeWorld(
    [foe('fox', 1, 660, 550), foe('fox', 1, 800, 550)],
    [{ species: 'bear', form: 2, x: 600, y: 550 }],
  );
  const bear = pet(world, 1);
  armSkill(world, bear);
  const events = runFor(world, 0.5);
  assert.ok(only(events, 'zone').some((e) => e.kind === 'spikes' && (e.length ?? 0) > 200));
  const far = enemies(world)[1] as Unit;
  assert.ok(far.airborne > 0, '岩刺把远处的敌人也掀起');
});

test('青叶兔 2 阶：箭命中后弹向下一个敌人（回响 +1）', () => {
  const world = makeWorld(
    [foe('bear', 1, 850, 550), foe('bear', 1, 950, 610)],
    [{ species: 'bunny', form: 2, x: 600, y: 550 }],
  );
  quiet(world);
  const events = runFor(world, 3);
  const chains = only(events, 'chain');
  assert.ok(chains.length > 0, '发生了弹射');
  assert.ok(chains.every((c) => c.echo === 1));
  assert.ok(only(events, 'hit').some((e) => e.source === 'basic' && e.echo === 1));
});

test('叶耳兔 1 阶：普通攻击不弹射', () => {
  const world = makeWorld(
    [foe('bear', 1, 850, 550), foe('bear', 1, 950, 610)],
    [{ species: 'bunny', form: 1, x: 600, y: 550 }],
  );
  quiet(world);
  assert.equal(only(runFor(world, 3), 'chain').length, 0);
});

test('炎翎鸟 2 阶：烈焰弹在敌人扎堆处大范围爆炸，并留下燃烧地面', () => {
  const world = makeWorld(
    [foe('bear', 1, 850, 520), foe('bear', 1, 850, 580), foe('bear', 1, 900, 550)],
    [{ species: 'bird', form: 2, x: 600, y: 550 }],
  );
  const bird = pet(world, 1);
  armSkill(world, bird);
  const events = runFor(world, 1.5);
  const blast = only(events, 'explode').find((e) => e.source === 'birdSkill');
  assert.ok(blast, '大火球爆炸');
  assert.equal(blast.radius, SKILLS.bird.skill.radius);
  const hit = new Set(
    only(events, 'hit')
      .filter((e) => e.source === 'birdSkill')
      .map((e) => e.targetId),
  );
  assert.ok(hit.size >= 2, '一次炸到多个敌人');
  assert.ok(
    only(events, 'zone').some((e) => e.kind === 'burn'),
    '留下燃烧地面',
  );
});

// ---- 大招 ----

interface UltCase {
  species: SpeciesId;
  seconds: number;
  check(world: World, events: SimEvent[], me: Unit, ally: Unit): void;
}

const ULT_CASES: UltCase[] = [
  {
    species: 'fox',
    seconds: 2.5,
    check(_world, events, me) {
      const blinks = only(events, 'blink').filter((e) => e.unitId === me.id);
      assert.ok(blinks.length >= 4, `瞬身多次：${blinks.length}`);
      const echoes = only(events, 'hit')
        .filter((e) => e.source === 'foxUlt' && e.echo >= 1)
        .map((e) => e.echo);
      assert.ok(Math.max(...echoes) >= 3, '每斩一个回响 +1');
      assert.ok(
        only(events, 'explode').some((e) => e.source === 'foxUlt'),
        '斩过的目标引爆',
      );
      assert.ok(dist(me.x, me.y, 600, 550) < 80, '最后瞬身回到原位');
    },
  },
  {
    species: 'bird',
    seconds: 2.5,
    check(world, events) {
      const trail = only(events, 'zone').find((e) => e.kind === 'burn');
      assert.ok(trail, '凤凰留下燃烧带');
      const zone = world.zones.find((z) => z.id === trail.zoneId);
      assert.ok(zone && (zone.length ?? 0) > 300, '燃烧带沿着凤凰的路线延伸');
      assert.ok(only(events, 'hit').filter((e) => e.source === 'birdUlt').length >= 3);
    },
  },
  {
    species: 'otter',
    seconds: 2,
    check(world, events, me, ally) {
      assert.ok(only(events, 'shield').some((e) => e.targetId === ally.id));
      assert.ok(only(events, 'heal').some((e) => e.targetId === ally.id && e.sourceId === me.id));
      assert.ok(
        only(events, 'hit').some((e) => e.source === 'otterUlt'),
        '浪潮打到了前方的敌人',
      );
      assert.ok(
        enemies(world).some((e) => e.x > 800),
        '敌人被浪潮推开',
      );
    },
  },
  {
    species: 'turtle',
    seconds: 1.5,
    check(world, events, _me, ally) {
      assert.ok(only(events, 'zone').some((e) => e.kind === 'waterWall'));
      assert.ok(world.zones.some((z) => z.kind === 'waterWall'));
      assert.ok(world.reductionOf(ally) < 0.7, '水墙存在时我方受伤减少');
    },
  },
  {
    species: 'bunny',
    seconds: 2.5,
    check(_world, events) {
      assert.ok(only(events, 'zone').some((e) => e.kind === 'arrowRain'));
      assert.ok(only(events, 'hit').filter((e) => e.source === 'bunnyUlt').length >= 6);
    },
  },
  {
    species: 'deer',
    seconds: 4.5,
    check(_world, events, me) {
      const vines = only(events, 'zone').find((e) => e.kind === 'vines');
      assert.ok(vines && vines.r === SKILLS.deer.ult.radius);
      assert.ok(
        only(events, 'zone').some((e) => e.kind === 'blossom'),
        '最后花朵绽放',
      );
      assert.ok(
        only(events, 'heal').some((e) => e.sourceId === me.id),
        '绽放时治疗队友',
      );
      assert.ok(only(events, 'explode').some((e) => e.source === 'deerUlt' && e.echo === 1));
    },
  },
  {
    species: 'cat',
    seconds: 2.5,
    check(_world, events) {
      const echoes = only(events, 'chain').map((e) => e.echo);
      assert.deepEqual(
        echoes,
        echoes.map((_, i) => i),
        '依次落雷，回响逐次 +1',
      );
      assert.ok(echoes.length >= 4);
      assert.ok(
        only(events, 'status').some((e) => e.status === 'stun'),
        '最后的惊雷击晕',
      );
    },
  },
  {
    species: 'wolf',
    seconds: 3,
    check(_world, events, me) {
      assert.ok(only(events, 'dash').filter((e) => e.unitId === me.id).length >= 3, '来回三次');
      assert.ok(only(events, 'status').filter((e) => e.status === 'stun').length >= 2);
    },
  },
  {
    species: 'bear',
    seconds: 2,
    check(world, events, _me, ally) {
      assert.ok(only(events, 'zone').some((e) => e.kind === 'spikeRing'));
      assert.ok(only(events, 'status').filter((e) => e.status === 'knockup').length >= 2);
      assert.ok(ally.stoneSkin > 0, '附近的队友披上石肤');
      assert.ok(world.reductionOf(ally) < 0.8);
    },
  },
  {
    species: 'lizard',
    seconds: 3,
    check(_world, events) {
      assert.ok(only(events, 'explode').some((e) => e.source === 'lizardUlt' && e.radius === 150));
      assert.ok(
        only(events, 'hit').some((e) => e.source === 'lizardUlt' && e.echo >= 1),
        '炸出的晶片命中敌人',
      );
    },
  },
];

for (const c of ULT_CASES) {
  test(`${c.species} 人形态：能量满了自动放大招`, () => {
    const world = makeWorld(
      [
        foe('bear', 1, 730, 510),
        foe('bear', 1, 730, 590),
        foe('bear', 1, 790, 550),
        foe('bear', 1, 850, 480),
        foe('bear', 1, 850, 620),
      ],
      [
        { species: c.species, form: 3, x: 600, y: 550 },
        { species: 'turtle', form: 1, x: 540, y: 470 },
      ],
    );
    const me = pet(world, 1);
    const ally = pet(world, 2);
    ally.hp = ally.maxHp * 0.5;
    quiet(world, [me]);
    me.skillCd = 999;
    me.energy = 100;
    const spawned = recordSpawns(world);
    const events = runFor(world, c.seconds);
    const ult = only(events, 'ult').find((e) => e.unitId === me.id);
    assert.ok(ult, '放出了大招');
    assert.equal(ult.skill, SKILLS[c.species].ult.id);
    assert.ok(me.energy < 60, '放完大招能量清空后重新积累');
    if (c.species === 'lizard') {
      assert.ok(spawned.includes('meteor'), '巨型晶石从天而降');
      assert.equal(
        spawned.filter((k) => k === 'shard').length,
        SKILLS.lizard.ult.shards,
        '炸出 12 片晶片',
      );
    }
    c.check(world, events, me, ally);
  });
}
