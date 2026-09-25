// 单场追踪：每隔几秒打印各单位位置与生命，以及倒下事件。用法：node build/test/tests/unit/tools/trace.js 对局id 招式:等级,...
import type { ModuleId, ModuleLevel } from '../../../src/core/types.js';
import { autoplay, makeWorld } from './harness.js';

const [encounterId = 'volley', spec = '', actives = '1', matchIndex = '0'] = process.argv.slice(2);
const modules = spec
  .split(',')
  .filter(Boolean)
  .map((item) => {
    const [id, level] = item.split(':');
    return [id as ModuleId, Number(level ?? 1) as ModuleLevel] as [ModuleId, ModuleLevel];
  });
const world = makeWorld(encounterId, { modules }, { matchIndex: Number(matchIndex) });
let next = 0;
for (let i = 0; i < 200 * 60 && !world.result; i++) {
  if (actives === '1' && i % 12 === 0) autoplay(world);
  world.step();
  for (const e of world.drainEvents()) {
    if (e.type === 'death') console.log(`  ${world.t.toFixed(1)}s 倒下：${e.kind}`);
    if (e.type === 'cast') console.log(`  ${world.t.toFixed(1)}s 发动：${e.module}`);
  }
  if (world.t >= next) {
    next += 3;
    const line = world.units
      .filter((u) => u.alive)
      .map(
        (u) =>
          `${u.kind}@${u.x.toFixed(0)},${u.y.toFixed(0)}:${u.hp.toFixed(0)}${u.state === 'windup' ? '*' : ''}`,
      )
      .join(' ');
    console.log(`${world.t.toFixed(1)}s ${line}`);
  }
}
const s = world.stats;
console.log(
  '结果',
  world.result,
  world.t.toFixed(1),
  'dmgBySource',
  JSON.stringify(s.damageBySource),
  'taken',
  JSON.stringify(s.damageTakenByUnit),
);
console.log(
  'blockedByEnemy',
  s.blockedByEnemy,
  'reflects',
  s.reflects,
  'ricochets',
  s.ricochets,
  'impacts',
  s.impacts,
  'maxEcho',
  s.maxEcho,
  'enemyHeal',
  s.enemyHealing.toFixed(0),
);
