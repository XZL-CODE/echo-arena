// 单场追踪：每隔几秒打印双方存活单位的位置与生命，以及技能、大招、倒下等事件。
// 用法：node build/test/tests/unit/tools/trace.js [对手id] [种子] [第几场(0起)] [难度] [策略]
// 玩家军团按策略自动打到这一场时的军团；不给对手 id（或给 -）时用这一轮本来的对手。
import { encounterById } from '../../../src/core/content/encounters.js';
import { formName } from '../../../src/core/content/species.js';
import { battleConfig } from '../../../src/core/run/run.js';
import { World } from '../../../src/core/sim/world.js';
import type { Difficulty } from '../../../src/core/types.js';
import { advanceTo, type Strategy } from './harness.js';

const [
  encounterId = '-',
  seedText = '1',
  matchText = '0',
  difficulty = 'normal',
  strategy = 'evolve-first',
] = process.argv.slice(2);
const run = advanceTo(
  Number(seedText),
  difficulty as Difficulty,
  strategy as Strategy,
  Number(matchText),
);
const config = battleConfig(run);
const world = new World(
  encounterId !== '-' ? { ...config, encounter: encounterById(encounterId) } : config,
);

const name = (id: number): string => {
  const u = world.unitById(id);
  return u ? `${u.team === 0 ? '我' : '敌'}·${formName(u.species, u.form)}` : `#${id}`;
};
const round = (_key: string, v: unknown) => (typeof v === 'number' ? Math.round(v) : v);

let next = 0;
for (let i = 0; i < 200 * 60 && !world.result; i++) {
  world.step();
  for (const e of world.drainEvents()) {
    const t = world.t.toFixed(1);
    if (e.type === 'death') console.log(`  ${t}s 倒下：${name(e.unitId)}`);
    else if (e.type === 'ult') console.log(`  ${t}s 大招：${name(e.unitId)} ${e.skill}`);
    else if (e.type === 'transform') console.log(`  ${t}s 变身：${name(e.unitId)}`);
    else if (e.type === 'echo' && e.level >= 4) console.log(`  ${t}s 回响 ×${e.level} ${e.source}`);
  }
  if (world.t >= next) {
    next += 5;
    const line = world.units
      .filter((u) => u.alive)
      .map((u) => `${name(u.id)}@${u.x.toFixed(0)},${u.y.toFixed(0)}:${u.hp.toFixed(0)}`)
      .join(' ');
    console.log(`${world.t.toFixed(1)}s ${line}`);
  }
}
const s = world.stats;
console.log('结果', world.result, world.t.toFixed(1), '最长回响', s.maxEcho);
console.log('技能伤害', JSON.stringify(s.damageBySkill, round));
console.log(
  '宠物伤害',
  run.legion
    .map((p) => `${formName(p.species, p.form)}:${Math.round(s.damageByUid[p.uid] ?? 0)}`)
    .join(' '),
);
console.log(
  `反射 ${s.reflects} 连锁 ${s.chains} 撞击 ${s.impacts} 连爆 ${s.blasts} 大招 ${JSON.stringify(s.ultsByUid)} 敌方大招 ${s.enemyUlts}`,
);
