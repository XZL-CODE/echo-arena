// 存档格式版本 4：往返、坏数据清理、旧版本（1–3）存档的迁移。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARENA } from '../../src/core/content/tuning.js';
import { beginBattle, createRun, finishBattle, pickReward } from '../../src/core/run/run.js';
import {
  defaultSettings,
  emptySave,
  GUIDE_PARTS,
  parseSave,
  SAVE_VERSION,
  serializeSave,
} from '../../src/core/run/save.js';
import { createStats } from '../../src/core/sim/stats.js';

const NOW = new Date('2026-09-30T00:00:00Z');
const win = () => ({ ...createStats(), result: 'win' as const, duration: 30 });

test('版本 4 与新手指引的课', () => {
  assert.equal(SAVE_VERSION, 4);
  assert.deepEqual([...GUIDE_PARTS], ['prep', 'battle', 'echo', 'ult', 'result', 'reward']);
  const d = defaultSettings();
  assert.equal(d.cinematics, true);
  assert.equal(d.quality, 'auto');
  assert.deepEqual(emptySave().codex, []);
});

test('存档往返后内容一致（设置、进行中的一轮、记录、图鉴）', () => {
  const data = emptySave();
  let run = createRun(8, 'hard', NOW);
  run = pickReward(finishBattle(beginBattle(run), win()), { capture: 2, evolve: 1 });
  data.run = beginBattle(run);
  data.settings.musicVolume = 0.2;
  data.settings.cinematics = false;
  data.settings.quality = 'low';
  data.settings.guideSeen = ['prep', 'ult'];
  data.records.bestEcho = 7;
  data.records.runsStarted = 3;
  data.codex = ['fox-1', 'dragon-2'];
  const parsed = parseSave(serializeSave(data, NOW));
  assert.ok(parsed);
  assert.equal(parsed.version, 4);
  assert.deepEqual(parsed.run, data.run);
  assert.deepEqual(parsed.settings, data.settings);
  assert.deepEqual(parsed.records, data.records);
  assert.deepEqual(parsed.codex, ['fox-1', 'dragon-2']);
});

test('待选奖励也能往返；奖励坏掉时按同一种子重新生成', () => {
  const data = emptySave();
  data.run = finishBattle(beginBattle(createRun(12, 'normal', NOW)), win());
  assert.equal(data.run.phase, 'reward');
  const text = serializeSave(data, NOW);
  assert.deepEqual(parseSave(text)?.run?.rewards, data.run.rewards);
  const raw = JSON.parse(text);
  raw.run.rewards = { capture: [{ species: 'dragon', form: 9 }], evolve: [{ uid: 999 }] };
  const repaired = parseSave(JSON.stringify(raw))?.run;
  assert.equal(repaired?.phase, 'reward');
  assert.deepEqual(repaired?.rewards, data.run.rewards);
});

test('损坏或陌生的存档返回 null', () => {
  assert.equal(parseSave(null), null);
  assert.equal(parseSave(''), null);
  assert.equal(parseSave('{oops'), null);
  assert.equal(parseSave('[1,2,3]'), null);
  assert.equal(parseSave(JSON.stringify({ app: 'other' })), null);
});

test('非法内容被清理：未知宠物、重复 uid、越界站位、非法设置', () => {
  const data = emptySave();
  data.run = createRun(9, 'normal', NOW);
  const raw = JSON.parse(serializeSave(data, NOW));
  const first = raw.run.legion[0];
  raw.run.legion.push({ uid: first.uid, species: 'fox', form: 1, x: 100, y: 100 });
  raw.run.legion.push({ uid: 77, species: 'dragon', form: 1, x: 100, y: 100 });
  raw.run.legion.push({ uid: 78, species: 'fox', form: 5, x: 100, y: 100 });
  raw.run.legion[1].x = 5000;
  raw.run.legion[1].y = -30;
  raw.settings.masterVolume = 7;
  raw.settings.quality = 'ultra';
  raw.settings.cinematics = 'yes';
  raw.settings.guideSeen = ['prep', 'skill', 3];
  raw.codex = ['fox-3', 'fox-9', 12];
  const parsed = parseSave(JSON.stringify(raw));
  assert.ok(parsed?.run);
  assert.equal(parsed.run.legion.length, 5, '重复、未知和非法形态的宠物被去掉');
  assert.ok(parsed.run.legion[1]);
  assert.equal(parsed.run.legion[1]?.x, ARENA.playerZoneMaxX);
  assert.equal(parsed.run.legion[1]?.y, ARENA.margin);
  assert.equal(parsed.settings.masterVolume, 1);
  assert.equal(parsed.settings.quality, 'auto');
  assert.equal(parsed.settings.cinematics, true);
  assert.deepEqual(parsed.settings.guideSeen, ['prep']);
  assert.deepEqual(parsed.codex, ['fox-3']);
  assert.ok(parsed.run.nextUid > Math.max(...parsed.run.legion.map((p) => p.uid)));

  raw.run.order = ['sprouts', 'blaze'];
  assert.equal(parseSave(JSON.stringify(raw))?.run, null, '对局顺序不对的一轮被丢弃');
  raw.run.order = ['blaze', 'sprouts', 'grove', 'blaze-elite', 'prodigy', 'tide-chief', 'dragon'];
  assert.equal(parseSave(JSON.stringify(raw))?.run, null, '档位不对的一轮被丢弃');
});

test('版本 1–3 的旧存档：保留设置和记录，丢弃旧玩法的那一轮，图鉴为空，新手指引重新教', () => {
  const oldRun = {
    seed: 5,
    difficulty: 'normal',
    order: ['volley', 'shellwall', 'swarm', 'medics', 'mortars', 'elite', 'king'],
    matchIndex: 3,
    phase: 'prep',
    levels: { reflect: 2 },
    loadout: { guard: ['reflect', null], slinger: [null, null], bell: [null, null] },
  };
  const records = {
    runsStarted: 4,
    runsCompleted: 1,
    bestEcho: 6,
    fastestClear: 812,
    clearedDifficulties: ['easy'],
  };
  for (const version of [1, 2, 3]) {
    const settings: Record<string, unknown> = {
      masterVolume: 0.3,
      muted: true,
      screenShake: false,
      difficulty: 'hard',
      seenHints: ['a'],
    };
    if (version >= 2) settings.guideSeen = ['prep', 'battle', 'result'];
    const text = JSON.stringify({ app: 'echo-arena', version, settings, run: oldRun, records });
    const parsed = parseSave(text);
    assert.ok(parsed, `版本 ${version}`);
    assert.equal(parsed.version, 4);
    assert.equal(parsed.run, null, '旧玩法的一轮被丢弃');
    assert.deepEqual(parsed.codex, []);
    assert.deepEqual(parsed.settings.guideSeen, [], '玩法变了，新手指引重新教');
    assert.equal(parsed.settings.masterVolume, 0.3);
    assert.equal(parsed.settings.muted, true);
    assert.equal(parsed.settings.screenShake, false);
    assert.equal(parsed.settings.difficulty, 'hard');
    assert.deepEqual(parsed.settings.seenHints, ['a']);
    assert.equal(parsed.settings.cinematics, true, '新增设置取默认值');
    assert.equal(parsed.settings.quality, 'auto');
    assert.deepEqual(parsed.records, records);
  }
});
