// 平衡检查：自动玩家按几种挑奖励的策略（不点集火、不调站位）在多个种子上打完整轮，
// 打印每一场第一次就赢的比例、平均用时，各对手的胜率，以及各物种的输出占比。
// 用法：npm run balance [-- --seeds 30 --difficulty normal --strategy mixed]
import { ENCOUNTERS } from '../../../src/core/content/encounters.js';
import { SPECIES, SPECIES_IDS } from '../../../src/core/content/species.js';
import type { Difficulty, SpeciesId } from '../../../src/core/types.js';
import { playRun, STRATEGIES, type RunLog, type Strategy } from './harness.js';

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const SEEDS = Number(option('seeds') ?? 24);
const DIFFICULTIES: Difficulty[] = option('difficulty')
  ? [option('difficulty') as Difficulty]
  : ['easy', 'normal', 'hard'];
const STRATS: readonly Strategy[] = option('strategy')
  ? [option('strategy') as Strategy]
  : STRATEGIES;
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '轻松', normal: '标准', hard: '硬核' };

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '-');
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const started = Date.now();
const normalLogs: RunLog[] = [];

for (const difficulty of DIFFICULTIES) {
  console.log(`\n== ${DIFFICULTY_LABEL[difficulty]}（${difficulty}）· 每种策略 ${SEEDS} 个种子 ==`);
  console.log('单元格：第一次就赢的比例 / 平均用时（秒）；括号内为换站位重试两次后的胜率');
  console.log(
    `${'策略'.padEnd(14)}${[1, 2, 3, 4, 5, 6, 7].map((i) => `第${i}场`.padEnd(17)).join('')}打通`,
  );
  for (const strategy of STRATS) {
    const logs: RunLog[] = [];
    for (let s = 1; s <= SEEDS; s++) {
      logs.push(playRun(1000 + s, difficulty, strategy, { retries: 2, force: true }));
    }
    if (difficulty === 'normal') normalLogs.push(...logs);
    const cells: string[] = [];
    for (let i = 0; i < 7; i++) {
      const battles = logs.map((l) => l.battles[i]).filter((b) => b !== undefined);
      const first = battles.filter((b) => b.firstWin).length;
      const won = battles.filter((b) => b.won).length;
      const time = avg(battles.map((b) => b.time));
      cells.push(
        `${pct(first, battles.length)}/${time.toFixed(0)}s(${pct(won, battles.length)})`.padEnd(17),
      );
    }
    const cleared = logs.filter((l) => l.cleared).length;
    console.log(`${strategy.padEnd(14)}${cells.join('')}${pct(cleared, logs.length)}`);
  }
}

if (normalLogs.length > 0) {
  console.log('\n== 标准难度：各对手（全部策略合计，第一次尝试）==');
  for (const e of ENCOUNTERS) {
    const battles = normalLogs.flatMap((l) => l.battles.filter((b) => b.encounterId === e.id));
    if (battles.length === 0) continue;
    const first = battles.filter((b) => b.firstWin).length;
    const time = avg(battles.map((b) => b.time));
    const timeouts = battles.filter((b) => b.timeout).length;
    console.log(
      `${`第${e.tier}档 ${e.name}`.padEnd(16, '　')} 场数 ${String(battles.length).padStart(3)}  胜率 ${pct(first, battles.length).padStart(4)}  用时 ${time.toFixed(1).padStart(5)}s  超时 ${timeouts}`,
    );
  }

  console.log('\n== 标准难度：各物种每只宠物的平均输出（相对全体平均 = 1.00）==');
  const perPet: Partial<Record<SpeciesId, number[]>> = {};
  const shares: Partial<Record<SpeciesId, number[]>> = {};
  for (const log of normalLogs) {
    for (const b of log.battles) {
      const total = Object.values(b.damageBySpecies).reduce((a, v) => a + (v ?? 0), 0);
      if (total <= 0) continue;
      for (const [species, dealt] of Object.entries(b.damageBySpecies) as Array<
        [SpeciesId, number]
      >) {
        const count = b.countBySpecies[species] ?? 1;
        (shares[species] ??= []).push(dealt / total);
        for (let i = 0; i < count; i++) (perPet[species] ??= []).push(dealt / count);
      }
    }
  }
  const overall = avg(SPECIES_IDS.flatMap((s) => perPet[s] ?? []));
  for (const s of SPECIES_IDS) {
    const list = perPet[s] ?? [];
    if (list.length === 0) continue;
    const index = overall > 0 ? avg(list) / overall : 0;
    console.log(
      `${SPECIES[s].names[0].padEnd(5, '　')}（${s.padEnd(6)}） 出场 ${String(list.length).padStart(4)}  输出指数 ${index.toFixed(2)}  平均占比 ${(avg(shares[s] ?? []) * 100).toFixed(0).padStart(3)}%`,
    );
  }
}
if (normalLogs.length > 0) {
  console.log('\n== 标准难度：我方伤害按来源的平均占比 ==');
  const bySource = new Map<string, number[]>();
  const battles = normalLogs.flatMap((l) => l.battles);
  for (const b of battles) {
    const total = Object.values(b.damageBySkill).reduce((a, v) => a + (v ?? 0), 0);
    if (total <= 0) continue;
    for (const [k, v] of Object.entries(b.damageBySkill)) {
      const list = bySource.get(k) ?? [];
      list.push((v ?? 0) / total);
      bySource.set(k, list);
    }
  }
  const rows = [...bySource].map(
    ([k, list]) => [k, (list.reduce((a, v) => a + v, 0) / battles.length) * 100] as const,
  );
  rows.sort((a, b) => b[1] - a[1]);
  console.log(rows.map(([k, v]) => `${k} ${v.toFixed(1)}%`).join('  '));
  const echoes = battles.map((b) => b.maxEcho);
  console.log(
    `平均最长回响 ${avg(echoes).toFixed(1)}，打赢时平均存活 ${(avg(battles.filter((b) => b.firstWin).map((b) => b.survivors)) * 100).toFixed(0)}%`,
  );
}
console.log(`\n用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
