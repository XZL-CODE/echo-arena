// 平衡检查：每场对局在若干配置下各跑几个种子，打印胜率、用时、剩余生命与最长回响。
// 用法：npm run balance [-- 对局id ...]
import { ENCOUNTERS, RUN_TIERS } from '../../../src/core/content/encounters.js';
import type { ModuleId, ModuleLevel } from '../../../src/core/types.js';
import { makeWorld, simulate, type BuildSpec } from './harness.js';

type Mods = Array<[ModuleId, ModuleLevel]>;

const BUILDS: Record<number, Array<[string, Mods]>> = {
  0: [
    ['无招式', []],
    ['反射盾', [['reflect', 1]]],
    ['冲锋', [['charge', 1]]],
    ['厚甲', [['bulwark', 1]]],
  ],
  1: [
    ['反射+折射', [['reflect', 2]]],
    [
      '冲锋+橡皮',
      [
        ['charge', 1],
        ['rubber', 1],
      ],
    ],
    [
      '厚甲+重弹',
      [
        ['bulwark', 1],
        ['heavy', 1],
      ],
    ],
    [
      '反射+弹射',
      [
        ['reflect', 1],
        ['ricochet', 1],
      ],
    ],
  ],
  2: [
    [
      '反射2+弹射+漩涡',
      [
        ['reflect', 2],
        ['ricochet', 1],
        ['vortex', 1],
      ],
    ],
    [
      '冲锋+撞击+重弹',
      [
        ['charge', 1],
        ['impact', 1],
        ['heavy', 1],
      ],
    ],
    [
      '厚甲+治愈+橡皮',
      [
        ['bulwark', 1],
        ['mend', 1],
        ['rubber', 1],
      ],
    ],
    [
      '冲锋+弹射2+连爆',
      [
        ['charge', 1],
        ['ricochet', 2],
        ['burst', 1],
      ],
    ],
  ],
  3: [
    [
      '反射2+弹射2+漩涡+连爆',
      [
        ['reflect', 2],
        ['ricochet', 2],
        ['vortex', 1],
        ['burst', 1],
      ],
    ],
    [
      '冲锋2+撞击+重弹+磁铃',
      [
        ['charge', 2],
        ['impact', 1],
        ['heavy', 1],
        ['magnet', 1],
      ],
    ],
    [
      '厚甲+治愈2+橡皮2+贯穿',
      [
        ['bulwark', 1],
        ['mend', 2],
        ['rubber', 2],
        ['pierce', 1],
      ],
    ],
    [
      '冲锋+弹射2+连爆+漩涡2',
      [
        ['charge', 1],
        ['ricochet', 2],
        ['burst', 1],
        ['vortex', 2],
      ],
    ],
  ],
};

const MATCH_INDEX_FOR_TIER = [0, 1, 2.5, 4.5, 6];
const SEEDS = [1, 2, 3, 4];

const filter = process.argv.slice(2);
for (const encounter of ENCOUNTERS) {
  if (filter.length > 0 && !filter.includes(encounter.id)) continue;
  const tier = encounter.tier;
  const builds = BUILDS[Math.min(tier, 3)] ?? [];
  const matchIndex = Math.round(MATCH_INDEX_FOR_TIER[tier] ?? 0);
  console.log(
    `\n== ${encounter.name} (${encounter.id}, 层级 ${tier}, 第 ${matchIndex + 1} 场强度) ==`,
  );
  for (const [label, modules] of builds) {
    for (const actives of [false, true]) {
      let wins = 0;
      let time = 0;
      let hp = 0;
      let echo = 0;
      for (const seed of SEEDS) {
        const build: BuildSpec = { modules };
        const outcome = simulate(makeWorld(encounter.id, build, { seed, matchIndex }), actives);
        if (outcome.result === 'win') wins++;
        time += outcome.time;
        hp += outcome.hpLeft;
        echo = Math.max(echo, outcome.maxEcho);
      }
      const n = SEEDS.length;
      console.log(
        `${(label + (actives ? '（用主动）' : '')).padEnd(24, '　')} 胜 ${wins}/${n}  用时 ${(time / n).toFixed(1).padStart(5)}s  余血 ${((hp / n) * 100).toFixed(0).padStart(3)}%  最长回响 ${echo}`,
      );
    }
  }
}
void RUN_TIERS;
