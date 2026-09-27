// 一轮的流程、装配规则、奖励、存档与结算提示。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encounterById } from '../../src/core/content/encounters.js';
import {
  canEquip,
  emptyLoadout,
  equip,
  autoEquip,
  findEquipped,
} from '../../src/core/run/loadout.js';
import {
  battleConfig,
  beginBattle,
  canChooseStarter,
  chooseStarter,
  createPracticeRun,
  createRun,
  currentEncounter,
  finishBattle,
  pickReward,
  setLoadout,
} from '../../src/core/run/run.js';
import { summarizeBattle, summarizeRun } from '../../src/core/run/insights.js';
import { emptySave, GUIDE_PARTS, parseSave, serializeSave } from '../../src/core/run/save.js';
import { createStats } from '../../src/core/sim/stats.js';
import { World } from '../../src/core/sim/world.js';
import { autoplay } from './tools/harness.js';

test('新的一轮：7 场，层级依次为 0,1,2,2,3,3,4，且不重复', () => {
  for (const seed of [1, 2, 3, 99]) {
    const run = createRun(seed, 'normal');
    assert.equal(run.order.length, 7);
    assert.deepEqual(
      run.order.map((id) => encounterById(id).tier),
      [0, 1, 2, 2, 3, 3, 4],
    );
    assert.equal(new Set(run.order).size, 7);
    assert.equal(run.levels.reflect, 1, '默认开局招式是反射盾');
    assert.deepEqual(findEquipped(run.loadout, 'reflect'), { unit: 'guard', slot: 0 });
  }
});

test('开局招式可以在第一场开战前改选，开战后不能再改', () => {
  let run = createRun(5, 'normal');
  run = chooseStarter(run, 'charge');
  assert.deepEqual(Object.keys(run.levels), ['charge']);
  assert.ok(findEquipped(run.loadout, 'charge'));
  assert.equal(findEquipped(run.loadout, 'reflect'), null);
  run = beginBattle(run);
  assert.equal(canChooseStarter(run), false);
  assert.equal(chooseStarter(run, 'bulwark'), run);
});

test('教学战：第一场木箭齐射队、轻松难度，叮当带着漩涡；换开局招式时漩涡保留', () => {
  let run = createPracticeRun();
  assert.equal(currentEncounter(run).id, 'volley');
  assert.equal(run.difficulty, 'easy');
  assert.deepEqual(findEquipped(run.loadout, 'vortex'), { unit: 'bell', slot: 0 });
  assert.ok(findEquipped(run.loadout, 'reflect'));
  run = chooseStarter(run, 'charge');
  assert.deepEqual(Object.keys(run.levels).sort(), ['charge', 'vortex']);
  assert.ok(findEquipped(run.loadout, 'charge'));
  assert.equal(findEquipped(run.loadout, 'reflect'), null);
  assert.deepEqual(findEquipped(run.loadout, 'vortex'), { unit: 'bell', slot: 0 });
});

test('装配规则：专属招式、每人一个主动、同一招式只占一个槽', () => {
  let loadout = emptyLoadout();
  assert.equal(canEquip(loadout, 'reflect', 'slinger', 0).ok, false);
  loadout = equip(loadout, 'charge', 'guard', 0);
  assert.equal(canEquip(loadout, 'reflect', 'guard', 1).ok, true);
  loadout = equip(loadout, 'impact', 'guard', 1);
  loadout = equip(loadout, 'impact', 'bell', 0);
  assert.deepEqual(loadout.guard, ['charge', null], '移动招式时原槽位应清空');
  assert.deepEqual(loadout.bell, ['impact', null]);
  loadout = equip(loadout, 'vortex', 'bell', 1);
  assert.equal(autoEquip(loadout, 'burst')?.guard[1], 'burst', '通用招式放进按顺序的第一个空槽');
  const full = {
    guard: ['charge', 'reflect'],
    slinger: ['ricochet', 'rubber'],
    bell: ['vortex', 'mend'],
  } as typeof loadout;
  assert.equal(autoEquip(full, 'burst'), null);
});

test('胜利进入奖励：三个不同选项，含进阶；重复生成结果一致', () => {
  let run = beginBattle(createRun(11, 'normal'));
  const stats = { ...createStats(), result: 'win' as const, duration: 20 };
  run = finishBattle(run, stats);
  assert.equal(run.phase, 'reward');
  const offers = run.offers ?? [];
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((o) => o.id)).size, 3);
  assert.ok(
    offers.some((o) => o.kind === 'upgrade' && o.id === 'reflect'),
    '应当提供反射盾进阶',
  );
  assert.ok(offers.some((o) => o.kind === 'new'));
  const again = finishBattle(beginBattle(createRun(11, 'normal')), stats);
  assert.deepEqual(again.offers, run.offers);

  const fresh = offers.find((o) => o.kind === 'new')!;
  const next = pickReward(run, fresh.id);
  assert.equal(next.phase, 'prep');
  assert.equal(next.matchIndex, 1);
  assert.equal(next.levels[fresh.id], 1);
  assert.ok(findEquipped(next.loadout, fresh.id), '新招式有空槽时自动装备');
  const upgraded = pickReward(run, 'reflect');
  assert.equal(upgraded.levels.reflect, 2);
});

test('失败留在战前准备，重试次数累加，同一场种子不变', () => {
  let run = createRun(21, 'normal');
  const seed = battleConfig(run).seed;
  run = finishBattle(beginBattle(run), { ...createStats(), result: 'lose', duration: 30 });
  run = finishBattle(beginBattle(run), { ...createStats(), result: 'lose', duration: 25 });
  assert.equal(run.phase, 'prep');
  assert.equal(run.records[0]?.attempts, 2);
  assert.equal(run.inBattle, false);
  assert.equal(battleConfig(run).seed, seed);
});

test('完整一轮可以在简单难度下由自动策略打通', () => {
  let run = createRun(3, 'easy');
  let guard = 0;
  while (run.phase !== 'complete' && guard++ < 40) {
    if (run.phase === 'reward') {
      run = pickReward(run, run.offers![0]!.id);
      continue;
    }
    run = beginBattle(run);
    const world = new World(battleConfig(run));
    for (let i = 0; i < 180 * 60 && !world.result; i++) {
      if (i % 12 === 0) autoplay(world);
      world.step();
      world.events.length = 0;
    }
    run = finishBattle(run, world.stats);
  }
  assert.equal(run.phase, 'complete', `应当打通一轮，停在第 ${run.matchIndex + 1} 场`);
  const summary = summarizeRun(run);
  assert.ok(summary.topSources.length > 0);
  assert.ok(summary.untried.length > 0);
});

test('存档往返后内容一致；损坏或陌生的存档返回 null', () => {
  const data = emptySave();
  let run = createRun(8, 'hard');
  run = setLoadout(run, equip(run.loadout, 'reflect', 'guard', 1));
  data.run = beginBattle(run);
  data.settings.musicVolume = 0.2;
  data.records.bestEcho = 7;
  const parsed = parseSave(serializeSave(data));
  assert.ok(parsed);
  assert.deepEqual(parsed.run, data.run);
  assert.equal(parsed.settings.musicVolume, 0.2);
  assert.equal(parsed.records.bestEcho, 7);
  assert.equal(parseSave('{oops'), null);
  assert.equal(parseSave(JSON.stringify({ app: 'other' })), null);
});

test('新手指引进度：新存档为空，往返保留；旧版本存档按学过的课换算；非法值被过滤', () => {
  const fresh = emptySave();
  assert.deepEqual(fresh.settings.guideSeen, []);
  fresh.settings.guideSeen = ['prep', 'echo'];
  assert.deepEqual(parseSave(serializeSave(fresh))?.settings.guideSeen, ['prep', 'echo']);

  // 版本 1（v0.1.0）的存档没有 guideSeen：老玩家更新后不再自动弹出指引。
  const legacy = { app: 'echo-arena', version: 1, settings: { musicVolume: 0.3, seenHints: [] } };
  assert.deepEqual(parseSave(JSON.stringify(legacy))?.settings.guideSeen, [...GUIDE_PARTS]);

  // 版本 2（v0.2.0）只分三段：看过战斗算学过放招式和回响，看过结算算学过挑奖励。
  const v2 = (guideSeen: unknown) =>
    parseSave(JSON.stringify({ app: 'echo-arena', version: 2, settings: { guideSeen } }))?.settings
      .guideSeen;
  assert.deepEqual(v2(['prep', 'battle', 'result']), [...GUIDE_PARTS]);
  assert.deepEqual(v2(['prep']), ['prep']);
  assert.deepEqual(v2([]), []);
  assert.deepEqual(v2(['battle', 'boss', 3]), ['battle', 'skill', 'echo']);

  const junk = { app: 'echo-arena', version: 3, settings: { guideSeen: ['battle', 'boss', 3] } };
  assert.deepEqual(parseSave(JSON.stringify(junk))?.settings.guideSeen, ['battle']);
});

test('存档中的非法配置会被清理', () => {
  const data = emptySave();
  data.run = createRun(9, 'normal');
  const text = serializeSave(data).replace(
    '"guard":["reflect",null]',
    '"guard":["pierce","vortex"]',
  );
  const parsed = parseSave(text);
  assert.ok(parsed?.run);
  assert.deepEqual(parsed.run.loadout.guard, [null, null], '未拥有、不属于阿铁的招式应被移除');
});

test('结算提示只陈述记录到的事实', () => {
  const win = { ...createStats(), result: 'win' as const, duration: 48, maxEcho: 4 };
  win.bestChainSources = ['reflect', 'burst'];
  win.damageBySource = { reflect: 300, slinger: 100 };
  win.damageTakenByUnit = { guard: 200, slinger: 20, bell: 0 };
  const w = summarizeBattle(win, { survivors: [], enemyHpLeft: 0, actives: [] });
  assert.equal(w.time, '0:48');
  assert.ok(w.lines.some((l) => l.text.includes('回响 ×4') && l.text.includes('反射盾 → 连爆')));
  assert.ok(w.lines.some((l) => l.text.includes('反射盾（75%）')));

  const lose = { ...createStats(), result: 'lose' as const, duration: 30 };
  lose.playerDeaths = [{ kind: 'slinger', time: 14, by: 'mouse' }];
  const l = summarizeBattle(lose, {
    survivors: ['archer'],
    enemyHpLeft: 0.23,
    actives: ['charge'],
  });
  assert.ok(l.lines.some((x) => x.text === '0:14 小弹被发条鼠击倒'));
  assert.ok(l.lines.some((x) => x.text.includes('冲锋')));
  assert.ok(!l.lines.some((x) => x.text.includes('蜗医')), '没有治疗数据时不提蜗医');
});
