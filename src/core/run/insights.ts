// 结算提示：只根据战斗中真实记录的数据生成，不编造分析。
import { ELEMENT_NAME } from '../content/elements.js';
import { formName, SPECIES, skillName } from '../content/species.js';
import type { BattleStats, DeathRecord, PetRecord } from '../sim/stats.js';
import type { BossId, DamageSource, SkillId, SpeciesId } from '../types.js';
import { totalRetries, type RunState } from './run.js';

export interface InsightLine {
  /** 图标键。 */
  icon: 'echo' | 'star' | 'skill' | 'counter' | 'unit' | 'warn' | 'time' | 'info';
  text: string;
}

export interface BattleSummary {
  result: 'win' | 'lose';
  time: string;
  /** 伤害最高的宠物（没有记录时为 null）。 */
  mvpUid: number | null;
  lines: InsightLine[];
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function sourceName(source: DamageSource): string {
  if (source === 'basic') return '普通攻击';
  if (source === 'impact') return '撞击';
  if (source === 'reflect') return '反射';
  return skillName(source as SkillId);
}

function petName(pets: readonly PetRecord[], uid: number): string {
  const pet = pets.find((p) => p.uid === uid);
  return pet ? formName(pet.species, pet.form) : '宠物';
}

function deathName(d: DeathRecord): string {
  return formName(d.species, d.form);
}

function killerName(d: DeathRecord): string {
  return d.bySpecies ? formName(d.bySpecies, d.byForm) : '持续伤害';
}

function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function topEntry(record: Record<number, number>): [number, number] | null {
  let best: [number, number] | null = null;
  for (const [k, v] of Object.entries(record)) {
    if (v > 0 && (!best || v > best[1])) best = [Number(k), v];
  }
  return best;
}

/** 后排：射手、法师、辅助。 */
function isBackline(species: SpeciesId | BossId): boolean {
  if (species === 'dragon') return false;
  const role = SPECIES[species].role;
  return role === 'ranged' || role === 'mage' || role === 'support';
}

export interface SummaryContext {
  /** 剩余对手生命占比（失败时展示）。 */
  enemyHpLeft?: number;
}

export function summarizeBattle(stats: BattleStats, ctx: SummaryContext = {}): BattleSummary {
  const lines: InsightLine[] = [];
  const result = stats.result === 'win' ? 'win' : 'lose';
  const total = stats.totalDealt;
  const mvp = topEntry(stats.damageByUid);

  if (result === 'lose') {
    if (stats.timeout) lines.push({ icon: 'time', text: '时间耗尽，没能分出胜负' });
    loseLines(stats, lines);
  }

  if (mvp && total > 0) {
    lines.push({
      icon: 'star',
      text: `${petName(stats.pets, mvp[0])}打出了 ${share(mvp[1], total)}% 的伤害`,
    });
  }
  const skills = (Object.entries(stats.damageBySkill) as Array<[DamageSource, number]>)
    .filter(([k, v]) => k !== 'basic' && v > 0)
    .sort((a, b) => b[1] - a[1]);
  const topSkill = skills[0];
  if (topSkill && total > 0 && share(topSkill[1], total) >= 10) {
    lines.push({
      icon: 'skill',
      text: `伤害最高的招式：${sourceName(topSkill[0])}（${share(topSkill[1], total)}%）`,
    });
  }
  if (stats.maxEcho >= 2) {
    const chain =
      stats.bestChainSources.length > 1
        ? `：${stats.bestChainSources.map(sourceName).join(' → ')}`
        : '';
    lines.push({ icon: 'echo', text: `最长回响 ×${stats.maxEcho}${chain}` });
  }
  counterLines(stats, lines);
  const ults = Object.values(stats.ultsByUid).reduce((sum, v) => sum + v, 0);
  if (ults > 0) lines.push({ icon: 'info', text: `我方放了 ${ults} 次大招` });
  if (result === 'lose' && ctx.enemyHpLeft !== undefined && ctx.enemyHpLeft > 0) {
    lines.push({
      icon: 'info',
      text: `对手还剩 ${Math.max(1, Math.round(ctx.enemyHpLeft * 100))}% 的生命`,
    });
  }
  if (result === 'lose' && stats.focusUsed === 0 && !stats.timeout) {
    lines.push({ icon: 'info', text: '这场没有点选集火：点一个敌人，全军会先打它' });
  }
  return {
    result,
    time: formatTime(stats.duration),
    mvpUid: mvp ? mvp[0] : null,
    lines: lines.slice(0, 5),
  };
}

function loseLines(stats: BattleStats, lines: InsightLine[]): void {
  const deaths = stats.playerDeaths;
  const first = deaths[0];
  if (!first) return;
  const early = deaths.slice(0, Math.min(3, deaths.length));
  if (early.length >= 2 && early.every((d) => isBackline(d.species))) {
    lines.push({
      icon: 'warn',
      text: `后排先倒下了：${early.map(deathName).join('、')}。试着让坦克站到它们前面`,
    });
    return;
  }
  lines.push({
    icon: 'unit',
    text: `${formatTime(first.time)} ${deathName(first)}被${killerName(first)}击倒`,
  });
}

function counterLines(stats: BattleStats, lines: InsightLine[]): void {
  const total = stats.totalDealt;
  if (stats.counterBonus >= 30 && stats.counterBonus >= total * 0.05) {
    lines.push({
      icon: 'counter',
      text: `属性克制多打出 ${Math.round(stats.counterBonus)} 点伤害（${stats.counterHits} 次命中）`,
    });
  }
  if (stats.counteredLoss >= 30 && stats.counteredLoss >= total * 0.05) {
    lines.push({
      icon: 'warn',
      text: `被属性克制少打了 ${Math.round(stats.counteredLoss)} 点伤害`,
    });
  }
  if (stats.enemyCounterBonus >= 40 && stats.enemyCounterBonus >= stats.totalTaken * 0.08) {
    lines.push({
      icon: 'warn',
      text: `对手靠属性克制多打了 ${Math.round(stats.enemyCounterBonus)} 点伤害`,
    });
  }
}

export interface RunSummary {
  time: string;
  retries: number;
  bestEcho: number;
  /** 整轮伤害最高的几只宠物。 */
  topPets: Array<{ uid: number; name: string; share: number }>;
  /** 整轮伤害最高的几种招式（不含普通攻击）。 */
  topSkills: Array<{ name: string; share: number }>;
  /** 军团里各属性的数量。 */
  elements: Array<{ name: string; count: number }>;
}

/** 整轮结算：谁扛起了这一轮、靠什么招式赢的。 */
export function summarizeRun(run: RunState): RunSummary {
  const byUid: Record<number, number> = {};
  const bySkill: Partial<Record<DamageSource, number>> = {};
  let total = 0;
  for (const record of run.records) {
    for (const [k, v] of Object.entries(record.damageByUid)) {
      byUid[Number(k)] = (byUid[Number(k)] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(record.damageBySkill) as Array<[DamageSource, number]>) {
      bySkill[k] = (bySkill[k] ?? 0) + v;
      total += v;
    }
  }
  const topPets = Object.entries(byUid)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([uid, v]) => {
      const pet = run.legion.find((p) => p.uid === uid);
      return { uid, name: pet ? formName(pet.species, pet.form) : '宠物', share: share(v, total) };
    });
  const topSkills = (Object.entries(bySkill) as Array<[DamageSource, number]>)
    .filter(([k, v]) => k !== 'basic' && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => ({ name: sourceName(k), share: share(v, total) }));
  const counts = new Map<string, number>();
  for (const pet of run.legion) {
    const name = ELEMENT_NAME[SPECIES[pet.species].element];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    time: formatTime(run.battleTime),
    retries: totalRetries(run),
    bestEcho: run.records.reduce((m, r) => Math.max(m, r.maxEcho), 0),
    topPets,
    topSkills,
    elements: [...counts].map(([name, count]) => ({ name, count })),
  };
}
