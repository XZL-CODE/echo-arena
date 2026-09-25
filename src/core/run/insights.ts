// 结算提示：只根据战斗中真实记录的数据生成，不编造分析。
import { MODULE_DEFS } from '../content/modules.js';
import { unitDef } from '../content/units.js';
import type { BattleStats } from '../sim/stats.js';
import {
  PLAYER_UNITS,
  type DamageSource,
  type ModuleId,
  type PlayerUnitKind,
  type UnitKind,
} from '../types.js';
import { ownedModules, totalRetries, type RunState } from './run.js';

export interface InsightLine {
  /** 图标键：echo / source / unit / warn / time / info。 */
  icon: 'echo' | 'source' | 'unit' | 'warn' | 'time' | 'info';
  text: string;
}

export interface BattleSummary {
  result: 'win' | 'lose';
  time: string;
  lines: InsightLine[];
}

const EXTRA_SOURCE_NAMES: Partial<Record<DamageSource, string>> = {
  guard: '阿铁的铁拳',
  slinger: '小弹的弹弓',
  bell: '叮当',
  detonate: '引爆爆爆虫',
  enemy: '对手',
};

export function sourceName(source: DamageSource): string {
  const extra = EXTRA_SOURCE_NAMES[source];
  if (extra) return extra;
  return MODULE_DEFS[source as ModuleId]?.name ?? source;
}

export function killerName(by: UnitKind | DamageSource | null): string {
  if (!by) return '对手';
  if (by === 'enemy' || by === 'detonate') return '爆炸';
  try {
    return unitDef(by as UnitKind).name;
  } catch {
    return sourceName(by as DamageSource);
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sortedSources(
  damage: Partial<Record<DamageSource, number>>,
): Array<[DamageSource, number]> {
  return (Object.entries(damage) as Array<[DamageSource, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

function chainText(sources: DamageSource[]): string {
  return sources.map(sourceName).join(' → ');
}

export interface SummaryContext {
  /** 结束时仍存活的对手种类。 */
  survivors: UnitKind[];
  /** 剩余对手生命占比。 */
  enemyHpLeft: number;
  /** 本场携带的主动招式。 */
  actives: ModuleId[];
}

export function summarizeBattle(stats: BattleStats, ctx: SummaryContext): BattleSummary {
  const lines: InsightLine[] = [];
  const result = stats.result === 'win' ? 'win' : 'lose';
  const sources = sortedSources(stats.damageBySource);
  const totalDealt = sources.reduce((sum, [, v]) => sum + v, 0);

  if (stats.maxEcho >= 2) {
    const chain = stats.bestChainSources.length > 1 ? `：${chainText(stats.bestChainSources)}` : '';
    lines.push({ icon: 'echo', text: `最长回响 ×${stats.maxEcho}${chain}` });
  }

  if (result === 'win') {
    const top = sources[0];
    if (top && totalDealt > 0) {
      lines.push({
        icon: 'source',
        text: `主要伤害来自${sourceName(top[0])}（${Math.round((top[1] / totalDealt) * 100)}%）`,
      });
    }
    const taken = PLAYER_UNITS.map(
      (k) => [k, stats.damageTakenByUnit[k]] as [PlayerUnitKind, number],
    );
    const totalTaken = taken.reduce((sum, [, v]) => sum + v, 0);
    const tank = taken.sort((a, b) => b[1] - a[1])[0];
    if (tank && totalTaken > 30) {
      lines.push({
        icon: 'unit',
        text: `${unitDef(tank[0]).name}承受了 ${Math.round((tank[1] / totalTaken) * 100)}% 的伤害`,
      });
    }
    if (stats.reflects >= 5) lines.push({ icon: 'info', text: `弹回了 ${stats.reflects} 发弹丸` });
    else if (stats.impacts >= 5) lines.push({ icon: 'info', text: `撞击了 ${stats.impacts} 次` });
    else if (stats.blasts >= 4) lines.push({ icon: 'info', text: `引发了 ${stats.blasts} 次爆炸` });
    return { result, time: formatTime(stats.duration), lines: lines.slice(0, 4) };
  }

  if (stats.timeout) lines.push({ icon: 'time', text: '时间耗尽，没能分出胜负' });
  const first = stats.playerDeaths[0];
  if (first) {
    lines.push({
      icon: 'unit',
      text: `${formatTime(first.time)} ${unitDef(first.kind).name}被${killerName(first.by)}击倒`,
    });
  }
  if (stats.enemyHealing >= 40) {
    const alive = ctx.survivors.includes('snail');
    lines.push({
      icon: 'warn',
      text: `蜗医一共治疗了 ${Math.round(stats.enemyHealing)} 点生命${alive ? '，到最后都没被击倒' : ''}`,
    });
  }
  if (stats.blockedByEnemy >= 8) {
    lines.push({ icon: 'warn', text: `你的弹丸被对手的正面盾挡下了 ${stats.blockedByEnemy} 次` });
  }
  if (stats.reflectedByEnemy >= 5) {
    lines.push({ icon: 'warn', text: `镜甲骑士把 ${stats.reflectedByEnemy} 发弹丸反射了回来` });
  }
  const unused = ctx.actives.filter((id) => !stats.activesUsed[id]);
  if (unused.length > 0) {
    lines.push({
      icon: 'info',
      text: `这场没有使用主动招式：${unused.map((id) => MODULE_DEFS[id].name).join('、')}`,
    });
  }
  if (ctx.enemyHpLeft > 0) {
    lines.push({
      icon: 'info',
      text: `对手还剩 ${Math.max(1, Math.round(ctx.enemyHpLeft * 100))}% 的生命`,
    });
  }
  return { result, time: formatTime(stats.duration), lines: lines.slice(0, 4) };
}

export interface RunSummary {
  time: string;
  retries: number;
  bestEcho: number;
  topSources: Array<{ name: string; share: number }>;
  untried: string[];
}

/** 整轮结算：你靠什么赢的、还有哪些办法没试过。 */
export function summarizeRun(run: RunState): RunSummary {
  const total: Partial<Record<DamageSource, number>> = {};
  for (const record of run.records) {
    for (const [k, v] of Object.entries(record.damageBySource) as Array<[DamageSource, number]>) {
      total[k] = (total[k] ?? 0) + v;
    }
  }
  const sources = sortedSources(total);
  const sum = sources.reduce((acc, [, v]) => acc + v, 0);
  const owned = new Set(ownedModules(run));
  return {
    time: formatTime(run.battleTime),
    retries: totalRetries(run),
    bestEcho: run.records.reduce((m, r) => Math.max(m, r.maxEcho), 0),
    topSources: sources.slice(0, 3).map(([k, v]) => ({
      name: sourceName(k),
      share: sum > 0 ? Math.round((v / sum) * 100) : 0,
    })),
    untried: (Object.keys(MODULE_DEFS) as ModuleId[])
      .filter((id) => !owned.has(id))
      .map((id) => MODULE_DEFS[id].name),
  };
}
