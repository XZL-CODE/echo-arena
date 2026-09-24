// 招式效果与连锁规则：每个招式都要在可重复的场景里真的改变战斗。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EncounterDef, EncounterUnit } from '../../src/core/content/encounters.js';
import { MODULE_TUNING, SIM } from '../../src/core/content/tuning.js';
import type { Formation, ModuleId, ModuleLevel } from '../../src/core/types.js';
import { makeWorld, simulate } from './tools/harness.js';

function encounter(enemies: EncounterUnit[], extra: Partial<EncounterDef> = {}): EncounterDef {
  return { id: 'test', tier: 1, name: '测试', intro: '', enemies, relevant: [], ...extra };
}

function formation(
  guard = { x: 360, y: 330 },
  slinger = { x: 150, y: 330 },
  bell = { x: 220, y: 380 },
): Formation {
  return { units: { guard, slinger, bell }, gadgets: [] };
}

const archers = (x: number, ys: number[]): EncounterUnit[] =>
  ys.map((y) => ({ kind: 'archer', x, y }));
type Mods = Array<[ModuleId, ModuleLevel]>;

function run(enc: EncounterDef, modules: Mods, seconds: number, form = formation()) {
  const world = makeWorld(enc, { modules }, { formation: form });
  world.run(seconds);
  return world;
}

test('反射盾：挡下的箭会弹回，对射手造成伤害；没有反射盾时不会', () => {
  const enc = encounter(archers(900, [300, 360]));
  const with_ = run(enc, [['reflect', 1]], 12);
  const without = run(enc, [], 12);
  assert.ok(with_.stats.reflects > 0, '应当发生反射');
  assert.ok((with_.stats.damageBySource.reflect ?? 0) > 0, '反射的箭应当造成伤害');
  assert.equal(without.stats.reflects, 0);
  assert.equal(without.stats.damageBySource.reflect ?? 0, 0);
});

test('反射盾·折射：弹回的箭命中后继续弹向附近敌人，回响至少到 2', () => {
  const enc = encounter(archers(880, [270, 330, 390]));
  const world = run(enc, [['reflect', 2]], 15);
  assert.ok(world.stats.ricochets > 0, '应当发生折射弹射');
  assert.ok(world.stats.maxEcho >= 2, `最长回响应至少为 2，实际 ${world.stats.maxEcho}`);
});

test('弹射弹：小弹的弹丸命中后弹向另一个敌人', () => {
  const enc = encounter([
    { kind: 'shell', x: 700, y: 300 },
    { kind: 'shell', x: 720, y: 360 },
    { kind: 'shell', x: 700, y: 420 },
  ]);
  const form = formation({ x: 90, y: 600 }, { x: 380, y: 360 }, { x: 60, y: 620 });
  const with_ = run(enc, [['ricochet', 2]], 10, form);
  const without = run(enc, [], 10, form);
  assert.ok((with_.stats.damageBySource.ricochet ?? 0) > 0);
  assert.equal(without.stats.damageBySource.ricochet ?? 0, 0);
});

test('橡皮弹：弹丸撞墙或盾牌会反弹', () => {
  const enc = encounter([{ kind: 'shell', x: 700, y: 330 }]);
  const world = run(
    enc,
    [['rubber', 1]],
    10,
    formation({ x: 90, y: 600 }, { x: 380, y: 330 }, { x: 60, y: 620 }),
  );
  assert.ok(world.stats.bounces > 0, '应当发生反弹');
  const plain = run(
    enc,
    [],
    10,
    formation({ x: 90, y: 600 }, { x: 380, y: 330 }, { x: 60, y: 620 }),
  );
  assert.equal(plain.stats.bounces, 0);
});

test('撞击：被击飞的敌人撞到同伴或墙时造成伤害；没有撞击招式时不造成伤害', () => {
  const pack: EncounterUnit[] = [
    { kind: 'mouse', x: 520, y: 330 },
    { kind: 'mouse', x: 560, y: 320 },
    { kind: 'mouse', x: 560, y: 345 },
    { kind: 'mouse', x: 600, y: 330 },
  ];
  const with_ = run(
    encounter(pack),
    [
      ['impact', 1],
      ['heavy', 1],
    ],
    12,
  );
  const without = run(encounter(pack), [['heavy', 1]], 12);
  assert.ok(with_.stats.impacts > 0, '应当发生撞击');
  assert.ok((with_.stats.damageBySource.impact ?? 0) > 0);
  assert.equal(without.stats.impacts, 0);
});

test('连爆：被回响伤害击倒的敌人会爆炸', () => {
  const enc = encounter(archers(860, [250, 290, 330, 370, 410]));
  const world = run(
    enc,
    [
      ['reflect', 2],
      ['burst', 1],
    ],
    30,
  );
  assert.ok(world.stats.blasts > 0, '应当发生连爆');
  assert.ok((world.stats.damageBySource.burst ?? 0) > 0);
});

test('冲锋：阿铁冲到指定位置，撞开沿途敌人', () => {
  const enc = encounter(archers(640, [310, 350]));
  const world = makeWorld(enc, { modules: [['charge', 1]] }, { formation: formation() });
  const guard = world.playerUnit('guard');
  assert.ok(guard);
  const startX = guard.x;
  assert.ok(world.castActive('guard', 700, 330));
  world.run(0.6);
  assert.ok(guard.x - startX > 200, `阿铁应当前冲，移动了 ${guard.x - startX}`);
  assert.ok((world.stats.damageBySource.charge ?? 0) > 0);
  assert.equal(world.castActive('guard', 700, 330), false, '冷却中不能再次发动');
});

test('漩涡：把范围内的敌人吸向中心', () => {
  const enc = encounter([
    { kind: 'shell', x: 820, y: 220 },
    { kind: 'shell', x: 820, y: 440 },
  ]);
  const world = makeWorld(enc, { modules: [['vortex', 1]] }, { formation: formation() });
  const [a, b] = world.aliveOf(1);
  assert.ok(a && b);
  const before = Math.abs(a.y - b.y);
  assert.ok(world.castActive('bell', 820, 330));
  world.run(1.2);
  const after = Math.abs(a.y - b.y);
  assert.ok(after < before - 60, `两只壳壳应被拉近：${before} → ${after}`);
});

test('贯穿射：一发大弹打穿一条直线上的多个敌人', () => {
  const enc = encounter([
    { kind: 'shell', x: 600, y: 330 },
    { kind: 'shell', x: 700, y: 330 },
    { kind: 'shell', x: 800, y: 330 },
  ]);
  const world = makeWorld(
    enc,
    { modules: [['pierce', 1]] },
    { formation: formation({ x: 90, y: 600 }) },
  );
  assert.ok(world.castActive('slinger', 900, 330));
  world.run(1.2);
  const hit = world.aliveOf(1).filter((u) => u.hp < u.maxHp).length;
  assert.equal(hit, 3, '三只壳壳都应被贯穿大弹击中（无视正面盾）');
});

test('镜桩：敌方弹丸碰到镜桩会转向，打到对手', () => {
  const enc = encounter(archers(900, [330]));
  const form = formation({ x: 300, y: 330 });
  form.gadgets = [{ module: 'mirrorpost', index: 0, x: 600, y: 330 }];
  const world = makeWorld(
    enc,
    { modules: [['mirrorpost', 1]], gadgets: form.gadgets },
    { formation: form },
  );
  world.run(12);
  assert.ok((world.stats.damageBySource.mirrorpost ?? 0) > 0, '镜桩转向的箭应当命中');
});

test('弹簧桩：被击飞撞上它的敌人会被弹开并受伤', () => {
  const enc = encounter([{ kind: 'shell', x: 640, y: 330 }]);
  const form = formation({ x: 300, y: 600 }, { x: 60, y: 60 }, { x: 60, y: 620 });
  form.gadgets = [{ module: 'spring', index: 0, x: 540, y: 330 }];
  const world = makeWorld(
    enc,
    { modules: [['spring', 1]], gadgets: form.gadgets },
    { formation: form },
  );
  const shell = world.aliveOf(1)[0]!;
  world.knock(shell, -1, 0, 900, { team: 0, echo: 0, chain: world.newChain(), source: 'guard' });
  world.run(1);
  assert.ok((world.stats.damageBySource.spring ?? 0) > 0, '壳壳撞上弹簧桩应当受伤');
  assert.ok(shell.x > 560, `壳壳应被弹回右侧，x = ${shell.x}`);
});

test('磁铃：摇铃把阿铁附近的敌人拉过去', () => {
  const enc = encounter([{ kind: 'shell', x: 560, y: 330 }]);
  const form = formation({ x: 330, y: 330 }, { x: 60, y: 60 }, { x: 250, y: 330 });
  const world = makeWorld(enc, { modules: [['magnet', 1]] }, { formation: form });
  const guard = world.playerUnit('guard');
  guard!.hp -= 50; // 让叮当有理由摇铃
  const shell = world.aliveOf(1)[0]!;
  const events: string[] = [];
  for (let i = 0; i < 60 * 3; i++) {
    world.step();
    for (const e of world.drainEvents()) if (e.type === 'pulse') events.push(e.kind);
  }
  assert.ok(events.includes('magnet'), '应当发生磁铃拉扯');
  assert.ok(shell.x < 520, `壳壳应被拉近，x = ${shell.x}`);
});

test('厚甲：阿铁生命提高且不会被击退', () => {
  const enc = encounter([{ kind: 'brute', x: 700, y: 330 }]);
  const world = makeWorld(enc, { modules: [['bulwark', 1]] }, { formation: formation() });
  const guard = world.playerUnit('guard')!;
  assert.equal(guard.maxHp, Math.round(340 * (1 + MODULE_TUNING.bulwark.hpBonus)));
  world.knock(guard, 1, 0, 800, { team: 1, echo: 0, chain: 1, source: 'enemy' });
  assert.equal(guard.vx, 0);
});

test('回响等级提高伤害', () => {
  const world = makeWorld(encounter([{ kind: 'brute', x: 900, y: 330 }]), { modules: [] });
  const brute = world.aliveOf(1)[0]!;
  const base = world.damage(brute, 10, { team: 0, source: 'slinger', echo: 0, chain: 1 });
  const echoed = world.damage(brute, 10, { team: 0, source: 'slinger', echo: 3, chain: 1 });
  assert.equal(base, 10);
  assert.ok(Math.abs(echoed - 10 * (1 + SIM.echoBonus * 3)) < 1e-6);
});

test('同一配置与种子的战斗完全可复现', () => {
  const a = makeWorld(
    'mirrors',
    {
      modules: [
        ['reflect', 2],
        ['ricochet', 1],
      ],
    },
    { seed: 7 },
  );
  const b = makeWorld(
    'mirrors',
    {
      modules: [
        ['reflect', 2],
        ['ricochet', 1],
      ],
    },
    { seed: 7 },
  );
  a.run(25);
  b.run(25);
  const snap = (w: typeof a) =>
    JSON.stringify(w.units.map((u) => [u.kind, u.x.toFixed(3), u.y.toFixed(3), u.hp.toFixed(3)]));
  assert.equal(snap(a), snap(b));
});

test('镜盾与反射盾来回乒乓时有上限，不会无限增长', () => {
  const enc = encounter([
    { kind: 'mirror', x: 620, y: 300 },
    { kind: 'mirror', x: 620, y: 360 },
    ...archers(1000, [200, 260, 320, 380, 440]),
  ]);
  const world = makeWorld(
    enc,
    {
      modules: [
        ['reflect', 2],
        ['ricochet', 2],
      ],
    },
    { formation: formation() },
  );
  let maxProjectiles = 0;
  for (let i = 0; i < 60 * 40 && !world.result; i++) {
    world.step();
    world.events.length = 0;
    maxProjectiles = Math.max(maxProjectiles, world.projectiles.length);
    for (const p of world.projectiles) assert.ok(p.reflects <= SIM.maxReflects);
  }
  assert.ok(maxProjectiles <= SIM.maxProjectiles);
});

test('每一场对局都会在时限内结束，且模拟足够快', () => {
  for (const id of [
    'volley',
    'shellwall',
    'raid',
    'swarm',
    'medics',
    'mirrors',
    'mortars',
    'factory',
    'elite',
    'king',
  ]) {
    const started = Date.now();
    const outcome = simulate(
      makeWorld(id, {
        modules: [
          ['reflect', 1],
          ['ricochet', 1],
        ],
      }),
      true,
    );
    const elapsed = Date.now() - started;
    assert.ok(outcome.time <= SIM.timeLimit + 0.1, `${id} 超时`);
    assert.ok(elapsed < 4000, `${id} 模拟过慢：${elapsed}ms`);
  }
});
