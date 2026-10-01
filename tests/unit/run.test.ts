// 一轮的流程：开局军团与伙伴、军团上限、收服与进化、人形态的解锁时机、重试、通关、布阵、图鉴与结算提示。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARMY_CAPS, encounterById, RUN_TIERS } from '../../src/core/content/encounters.js';
import { ALL_FORM_IDS, SPECIES } from '../../src/core/content/species.js';
import { ARENA } from '../../src/core/content/tuning.js';
import { codexFromLegion, codexFromWorld, mergeCodex } from '../../src/core/run/codex.js';
import { autoFormation, clampToPlayerZone } from '../../src/core/run/formation.js';
import { summarizeBattle, summarizeRun } from '../../src/core/run/insights.js';
import {
  armyCap,
  battleConfig,
  beginBattle,
  canChooseStarter,
  chooseStarter,
  createPracticeRun,
  createRun,
  currentEncounter,
  finishBattle,
  leaveBattle,
  partnerOf,
  pickReward,
  setFormation,
  totalRetries,
  type RunState,
} from '../../src/core/run/run.js';
import { createStats, type BattleStats } from '../../src/core/sim/stats.js';
import { World } from '../../src/core/sim/world.js';
import type { LegionPet } from '../../src/core/types.js';
import { chooseReward, playRun, simulate } from './tools/harness.js';

const NOW = new Date('2026-09-30T00:00:00Z');
const win = (duration = 40): BattleStats => ({ ...createStats(), result: 'win', duration });
const lose = (duration = 40): BattleStats => ({ ...createStats(), result: 'lose', duration });

function inPlayerZone(p: { x: number; y: number }): boolean {
  return (
    p.x >= ARENA.margin &&
    p.x <= ARENA.playerZoneMaxX &&
    p.y >= ARENA.margin &&
    p.y <= ARENA.height - ARENA.margin
  );
}

/** 连赢到第 matchIndex 场的战前（奖励都选第一个）。 */
function winUntil(run: RunState, matchIndex: number): RunState {
  let r = run;
  while (r.matchIndex < matchIndex) {
    r = finishBattle(beginBattle(r), win());
    r = pickReward(r, { capture: 0, evolve: 0 });
  }
  return r;
}

test('新的一轮：7 场按档位 1–7，开局 5 只宠物：进化形态的伙伴 + 4 只幼年', () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const run = createRun(seed, 'normal', NOW);
    assert.equal(run.order.length, 7);
    assert.deepEqual(
      run.order.map((id) => encounterById(id).tier),
      [...RUN_TIERS],
    );
    assert.equal(run.legion.length, ARMY_CAPS[0]);
    const partner = partnerOf(run);
    assert.ok(partner);
    assert.equal(partner.form, 2, '伙伴开局就是进化形态');
    assert.equal(partner.species, run.starters[0], '默认选中第一只');
    assert.equal(run.legion.filter((p) => p.form === 1).length, 4);
    const roles = run.legion.map((p) => SPECIES[p.species].role);
    assert.ok(roles.includes('tank'), '至少一只坦克');
    assert.ok(roles.includes('support'), '至少一只辅助');
    assert.equal(new Set(run.starters).size, 3);
    assert.equal(new Set(run.legion.map((p) => p.uid)).size, 5);
    assert.ok(run.legion.every(inPlayerZone));
    assert.deepEqual(createRun(seed, 'normal', NOW), run, '同一种子开局相同');
  }
});

test('伙伴三选一：第一场开战前可以改选，改选后仍是进化形态；开战后不能再改', () => {
  let run = createRun(5, 'normal', NOW);
  const other = run.starters[1];
  assert.ok(other);
  assert.ok(canChooseStarter(run));
  run = chooseStarter(run, other);
  assert.equal(partnerOf(run)?.species, other);
  assert.equal(partnerOf(run)?.form, 2);
  assert.equal(partnerOf(run)?.uid, run.partnerUid);
  assert.ok(run.legion.every(inPlayerZone));
  const notOffered = (['fox', 'bird', 'otter', 'turtle', 'bunny'] as const).find(
    (s) => !run.starters.includes(s),
  );
  if (notOffered) assert.equal(chooseStarter(run, notOffered), run, '只能选提供的三只');
  run = beginBattle(run);
  assert.equal(canChooseStarter(run), false);
  assert.equal(chooseStarter(run, run.starters[0] as never), run);
});

test('军团上限依次为 5、6、7、8、9、10、10', () => {
  assert.deepEqual([...ARMY_CAPS], [5, 6, 7, 8, 9, 10, 10]);
  let run = createRun(8, 'normal', NOW);
  for (let i = 0; i < 6; i++) {
    assert.equal(armyCap(run), ARMY_CAPS[i]);
    assert.ok(run.legion.length <= armyCap(run));
    run = pickReward(finishBattle(beginBattle(run), win()), { capture: 0, evolve: 0 });
  }
  assert.equal(run.legion.length, 10);
  assert.equal(armyCap(run), 10);
});

test('胜利后同时给出收服与进化两行奖励；两者一起生效，然后进入下一场', () => {
  let run = createRun(11, 'normal', NOW);
  run = finishBattle(beginBattle(run), win(35));
  assert.equal(run.phase, 'reward');
  const rewards = run.rewards;
  assert.ok(rewards);
  assert.equal(rewards.capture.length, 3);
  assert.equal(new Set(rewards.capture.map((c) => c.species)).size, 3);
  const beaten = new Set(encounterById(run.order[0] as string).legion.map((p) => p.species));
  assert.ok(beaten.has(rewards.capture[0]?.species as never), '先从刚打败的训练家那里收服');
  assert.ok(
    rewards.capture.every((c) => c.form === 1),
    '前几次奖励只有幼年',
  );
  assert.ok(rewards.evolve.length > 0 && rewards.evolve.length <= 3);
  assert.ok(
    rewards.evolve.every((e) => e.from === 1 && e.to === 2),
    '第一次奖励还不能进化到人形态',
  );
  const again = finishBattle(beginBattle(createRun(11, 'normal', NOW)), win(35));
  assert.deepEqual(again.rewards, rewards, '奖励由种子决定');

  const pick = rewards.evolve[0];
  const capture = rewards.capture[1];
  assert.ok(pick && capture);
  const next = pickReward(run, { capture: 1, evolve: 0 });
  assert.equal(next.phase, 'prep');
  assert.equal(next.matchIndex, 1);
  assert.equal(next.rewards, null);
  assert.equal(next.legion.length, 6);
  const newcomer = next.legion.find((p) => p.uid === run.nextUid);
  assert.ok(newcomer, '新宠物拿到新的 uid');
  assert.equal(newcomer.species, capture.species);
  assert.ok(inPlayerZone(newcomer));
  assert.ok(
    next.legion.every(
      (p) => p === newcomer || Math.hypot(p.x - newcomer.x, p.y - newcomer.y) >= 40,
    ),
    '新宠物站在空位上',
  );
  assert.equal(next.legion.find((p) => p.uid === pick.uid)?.form, 2);
  assert.equal(next.records[0]?.won, true);
  assert.equal(next.records[0]?.winTime, 35);
});

test('从第二次奖励起可以进化到人形态，而且候选里一定有一个', () => {
  let run = winUntil(createRun(21, 'normal', NOW), 1);
  run = finishBattle(beginBattle(run), win());
  const toThree = run.rewards?.evolve.filter((e) => e.from === 2 && e.to === 3) ?? [];
  assert.ok(toThree.length > 0);
  const index = run.rewards?.evolve.indexOf(toThree[0] as never) ?? -1;
  const next = pickReward(run, { evolve: index });
  assert.equal(next.legion.find((p) => p.uid === toThree[0]?.uid)?.form, 3);
});

test('收服候选：中后期出现进化形态；军团满员时没有收服这一行', () => {
  let run = winUntil(createRun(31, 'normal', NOW), 3);
  run = finishBattle(beginBattle(run), win());
  assert.equal(run.rewards?.capture.filter((c) => c.form === 2).length, 1);
  run = pickReward(run, { capture: 0, evolve: 0 });
  run = finishBattle(beginBattle(run), win());
  assert.equal(run.rewards?.capture.filter((c) => c.form === 2).length, 2);
  run = pickReward(run, { capture: 0, evolve: 0 });
  run = finishBattle(beginBattle(run), win());
  assert.equal(run.legion.length, 10);
  assert.equal(run.rewards?.capture.length, 0, '下一场上限 10 只，已经满了');
  assert.ok((run.rewards?.evolve.length ?? 0) > 0);
});

test('输了留在战前准备：重试次数累加，同一场的种子不变；中途离开不计结果', () => {
  let run = createRun(41, 'normal', NOW);
  const seed = battleConfig(run).seed;
  run = finishBattle(beginBattle(run), lose(30));
  run = finishBattle(beginBattle(run), lose(25));
  assert.equal(run.phase, 'prep');
  assert.equal(run.records[0]?.attempts, 2);
  assert.equal(run.inBattle, false);
  assert.equal(battleConfig(run).seed, seed);
  assert.equal(run.battleTime, 55);
  run = leaveBattle(beginBattle(run));
  assert.equal(run.inBattle, false);
  run = finishBattle(beginBattle(run), win(20));
  assert.equal(totalRetries(run), 3);
});

test('打赢最后一场（首领）整轮结束', () => {
  let run = winUntil(createRun(51, 'normal', NOW), 6);
  assert.equal(currentEncounter(run).tier, 7);
  assert.ok(currentEncounter(run).boss);
  run = finishBattle(beginBattle(run), win(80));
  assert.equal(run.phase, 'complete');
  assert.equal(run.rewards, null);
  const summary = summarizeRun(run);
  assert.equal(summary.retries, 0);
  assert.ok(summary.elements.length > 0);
});

test('布阵：站位限制在玩家区内；自动布阵坦克在前、辅助在后', () => {
  let run = createRun(61, 'normal', NOW);
  const uid = run.legion[0]?.uid as number;
  run = setFormation(run, { [uid]: { x: 1500, y: -50 } });
  const moved = run.legion.find((p) => p.uid === uid) as LegionPet;
  assert.ok(inPlayerZone(moved));
  assert.equal(moved.x, ARENA.playerZoneMaxX);
  assert.deepEqual(clampToPlayerZone({ x: -100, y: 5000 }), {
    x: ARENA.margin,
    y: ARENA.height - ARENA.margin,
  });
  const spots = autoFormation(run.legion);
  const xOf = (role: string) =>
    run.legion
      .filter((p) => SPECIES[p.species].role === role)
      .map((p) => (spots[p.uid] as { x: number }).x);
  for (const tank of xOf('tank')) {
    for (const support of xOf('support')) assert.ok(tank > support, '坦克站在辅助前面');
  }
  const config = battleConfig(run);
  assert.deepEqual(
    config.legion.map((p) => p.uid),
    run.legion.map((p) => p.uid),
  );
});

test('教学战：固定种子、轻松难度、第一场，伙伴是人形态的九焰', () => {
  const run = createPracticeRun(NOW);
  assert.equal(run.difficulty, 'easy');
  assert.equal(run.matchIndex, 0);
  assert.equal(currentEncounter(run).tier, 1);
  const partner = partnerOf(run);
  assert.equal(partner?.species, 'fox');
  assert.equal(partner?.form, 3);
  assert.equal(run.legion.length, 5);
  assert.deepEqual(createPracticeRun(NOW), run);
  const world = new World(battleConfig(run));
  assert.ok(world.units.some((u) => u.team === 0 && u.species === 'fox' && u.energy >= 0));
});

test('图鉴：记录战斗中出现的所有形态（含召唤与变身）和拥有的形态', () => {
  const run = createRun(71, 'normal', NOW);
  const world = new World(battleConfig(run));
  const seen = codexFromWorld(world);
  for (const p of run.legion) assert.ok(seen.includes(`${p.species}-${p.form}`));
  for (const p of currentEncounter(run).legion) assert.ok(seen.includes(`${p.species}-${p.form}`));
  assert.deepEqual(codexFromLegion([{ species: 'fox', form: 3 }]), ['fox-3']);
  const merged = mergeCodex(['dragon-2', 'fox-1', 'bogus'], ['fox-1', 'bird-2']);
  assert.deepEqual(merged, ['fox-1', 'bird-2', 'dragon-2'], '去重、去掉不认识的、按图鉴顺序');
  assert.equal(ALL_FORM_IDS.length, 32);
});

test('结算提示只陈述记录到的事实', () => {
  const stats: BattleStats = { ...createStats(), result: 'win', duration: 48, maxEcho: 4 };
  stats.pets = [
    { uid: 1, species: 'fox', form: 3 },
    { uid: 2, species: 'turtle', form: 1 },
  ];
  stats.damageByUid = { 1: 750, 2: 250 };
  stats.totalDealt = 1000;
  stats.damageBySkill = { foxUlt: 500, basic: 400, reflect: 100 };
  stats.bestChainSources = ['reflect', 'catSkill'];
  stats.counterBonus = 120;
  stats.counterHits = 9;
  stats.ultsByUid = { 1: 2 };
  const w = summarizeBattle(stats);
  assert.equal(w.result, 'win');
  assert.equal(w.time, '0:48');
  assert.equal(w.mvpUid, 1);
  const text = w.lines.map((l) => l.text);
  assert.ok(
    text.some((t) => t.includes('九焰') && t.includes('75%')),
    text.join('|'),
  );
  assert.ok(
    text.some((t) => t.includes('狐火·千本斩（50%）')),
    text.join('|'),
  );
  assert.ok(
    text.some((t) => t.includes('回响 ×4') && t.includes('反射 → 连环雷')),
    text.join('|'),
  );
  assert.ok(
    text.some((t) => t.includes('属性克制多打出 120')),
    text.join('|'),
  );

  const loss: BattleStats = { ...createStats(), result: 'lose', duration: 30 };
  loss.pets = [{ uid: 3, species: 'bunny', form: 1 }];
  loss.playerDeaths = [
    {
      uid: 3,
      species: 'bunny',
      form: 1,
      team: 0,
      time: 12,
      bySpecies: 'fox',
      byForm: 2,
      source: 'basic',
    },
    {
      uid: 4,
      species: 'otter',
      form: 1,
      team: 0,
      time: 15,
      bySpecies: 'fox',
      byForm: 2,
      source: 'foxSkill',
    },
  ];
  const l = summarizeBattle(loss, { enemyHpLeft: 0.23 });
  const lossText = l.lines.map((x) => x.text);
  assert.ok(
    lossText.some((t) => t.startsWith('后排先倒下了：叶耳兔、泡泡獭')),
    lossText.join('|'),
  );
  assert.ok(lossText.some((t) => t.includes('23%')));
  assert.ok(
    lossText.some((t) => t.includes('集火')),
    '没有用过集火时提醒',
  );
  assert.ok(!lossText.some((t) => t.includes('克制')), '没有克制数据时不提克制');
});

test('自动玩家（不点集火）能在轻松难度打通一整轮', () => {
  const log = playRun(3, 'easy', 'evolve-first', { retries: 2 });
  assert.equal(log.battles.length, 7);
  assert.ok(log.cleared, `停在第 ${log.battles.length} 场`);
});

test('自动挑奖励的策略总是挑合法的选项', () => {
  let run = createRun(81, 'normal', NOW);
  for (const strategy of ['evolve-first', 'capture-first', 'mixed', 'partner-carry'] as const) {
    let r = finishBattle(beginBattle(run), win());
    const pick = chooseReward(r, strategy);
    assert.ok(pick.capture === undefined || (r.rewards?.capture[pick.capture] ?? null) !== null);
    assert.ok(pick.evolve === undefined || (r.rewards?.evolve[pick.evolve] ?? null) !== null);
    r = pickReward(r, pick);
    assert.equal(r.phase, 'prep');
  }
  run = beginBattle(run);
  const outcome = simulate(new World(battleConfig(run)));
  assert.ok(outcome.world.result !== null);
});
