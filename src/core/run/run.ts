// 一轮的进程：7 场对局、战前检查点、胜利后的三选一奖励与整轮结算。
// 全部是可序列化的普通数据；界面只调用这里的函数来推进状态。
import { DEFAULT_FORMATION, encounterById, ENCOUNTERS, RUN_TIERS } from '../content/encounters.js';
import {
  DEFAULT_STARTING_CHOICE,
  gadgetCount,
  MODULE_DEFS,
  STARTING_CHOICES,
} from '../content/modules.js';
import { ARENA } from '../content/tuning.js';
import { clamp } from '../math.js';
import { hashSeed, Rng } from '../rng.js';
import type { BattleConfig } from '../sim/world.js';
import type { BattleStats } from '../sim/stats.js';
import {
  PLAYER_UNITS,
  type DamageSource,
  type Difficulty,
  type Formation,
  type GadgetPlacement,
  type Loadout,
  type ModuleId,
  type ModuleLevel,
} from '../types.js';
import { autoEquip, emptyLoadout, findEquipped, unequip } from './loadout.js';
import { generateOffers, type Offer } from './offers.js';

export type RunPhase = 'prep' | 'reward' | 'complete';

export interface MatchRecord {
  encounterId: string;
  attempts: number;
  won: boolean;
  winTime: number;
  maxEcho: number;
  /** 获胜那一场的伤害来源拆分。 */
  damageBySource: Partial<Record<DamageSource, number>>;
}

export interface RunState {
  seed: number;
  difficulty: Difficulty;
  startedAt: string;
  /** 战斗累计时长（秒）。 */
  battleTime: number;
  order: string[];
  matchIndex: number;
  phase: RunPhase;
  levels: Partial<Record<ModuleId, ModuleLevel>>;
  loadout: Loadout;
  formation: Formation;
  offers: Offer[] | null;
  records: MatchRecord[];
  /** 进入战斗时置为 true；如果在战斗中关闭，重新进入时据此提示“已回到战前”。 */
  inBattle: boolean;
}

export const RUN_LENGTH = RUN_TIERS.length;

export function defaultFormation(): Formation {
  return {
    units: {
      guard: { ...DEFAULT_FORMATION.guard },
      slinger: { ...DEFAULT_FORMATION.slinger },
      bell: { ...DEFAULT_FORMATION.bell },
    },
    gadgets: [],
  };
}

/** 按层级为这一轮抽取 7 场对局（同层不重复）。 */
export function rollOrder(seed: number): string[] {
  const rng = new Rng(hashSeed(seed, 'order'));
  const pools = new Map<number, string[]>();
  for (const e of ENCOUNTERS) {
    const pool = pools.get(e.tier) ?? [];
    pool.push(e.id);
    pools.set(e.tier, pool);
  }
  for (const pool of pools.values()) rng.shuffle(pool);
  return RUN_TIERS.map((tier) => {
    const pool = pools.get(tier) ?? [];
    const id = pool.shift();
    if (!id) throw new Error(`Not enough encounters for tier ${tier}`);
    return id;
  });
}

export function createRun(seed: number, difficulty: Difficulty, now = new Date()): RunState {
  const order = rollOrder(seed);
  const loadout = autoEquip(emptyLoadout(), DEFAULT_STARTING_CHOICE) ?? emptyLoadout();
  return {
    seed,
    difficulty,
    startedAt: now.toISOString(),
    battleTime: 0,
    order,
    matchIndex: 0,
    phase: 'prep',
    levels: { [DEFAULT_STARTING_CHOICE]: 1 },
    loadout,
    formation: defaultFormation(),
    offers: null,
    records: order.map((encounterId) => ({
      encounterId,
      attempts: 0,
      won: false,
      winTime: 0,
      maxEcho: 0,
      damageBySource: {},
    })),
    inBattle: false,
  };
}

export function currentEncounter(run: RunState) {
  return encounterById(run.order[run.matchIndex] as string);
}

export function nextEncounter(run: RunState) {
  const id = run.order[run.matchIndex + 1];
  return id ? encounterById(id) : null;
}

/** 第一场开战之前可以改选开局招式。 */
export function canChooseStarter(run: RunState): boolean {
  return run.matchIndex === 0 && (run.records[0]?.attempts ?? 0) === 0;
}

export function chooseStarter(run: RunState, id: ModuleId): RunState {
  if (!canChooseStarter(run) || !STARTING_CHOICES.includes(id)) return run;
  let loadout = run.loadout;
  for (const other of STARTING_CHOICES) loadout = unequip(loadout, other);
  loadout = autoEquip(loadout, id) ?? loadout;
  return { ...run, levels: { [id]: 1 }, loadout };
}

export function setLoadout(run: RunState, loadout: Loadout): RunState {
  return { ...run, loadout, formation: ensureGadgets(run.formation, run.levels, loadout) };
}

export function setFormation(run: RunState, formation: Formation): RunState {
  return { ...run, formation: clampFormation(formation) };
}

/** 该场战斗的配置。同一场的每次重试使用同一个种子，便于比较改动的效果。 */
export function battleConfig(run: RunState): BattleConfig {
  return {
    encounter: currentEncounter(run),
    seed: hashSeed(run.seed, 'match', run.matchIndex),
    difficulty: run.difficulty,
    matchIndex: run.matchIndex,
    loadout: run.loadout,
    levels: run.levels,
    formation: run.formation,
  };
}

export function beginBattle(run: RunState): RunState {
  const records = run.records.map((r, i) =>
    i === run.matchIndex ? { ...r, attempts: r.attempts + 1 } : r,
  );
  return { ...run, records, inBattle: true };
}

/** 从战斗中退回准备（暂停菜单里的“回到准备”），这一次不计入结果。 */
export function leaveBattle(run: RunState): RunState {
  return { ...run, inBattle: false };
}

export function finishBattle(run: RunState, stats: BattleStats): RunState {
  const win = stats.result === 'win';
  const records = run.records.map((r, i) => {
    if (i !== run.matchIndex) return r;
    const next = { ...r, maxEcho: Math.max(r.maxEcho, stats.maxEcho) };
    if (win) {
      next.won = true;
      next.winTime = stats.duration;
      next.damageBySource = { ...stats.damageBySource };
    }
    return next;
  });
  const base: RunState = {
    ...run,
    records,
    inBattle: false,
    battleTime: run.battleTime + stats.duration,
  };
  if (!win) return base;
  if (run.matchIndex >= run.order.length - 1) return { ...base, phase: 'complete' };
  return { ...base, phase: 'reward', offers: generateOffers(base) };
}

/** 选择奖励：新招式自动装进空槽（没有空槽就放进招式库），进阶直接生效。 */
export function pickReward(run: RunState, id: ModuleId): RunState {
  if (run.phase !== 'reward' || !run.offers?.some((o) => o.id === id)) return run;
  const levels = { ...run.levels };
  let loadout = run.loadout;
  if (levels[id]) {
    levels[id] = 2;
  } else {
    levels[id] = 1;
    loadout = autoEquip(loadout, id) ?? loadout;
  }
  const formation = ensureGadgets({ ...run.formation }, levels, loadout);
  return {
    ...run,
    levels,
    loadout,
    formation,
    offers: null,
    phase: 'prep',
    matchIndex: run.matchIndex + 1,
  };
}

/** 为已装备的机关补齐默认位置，去掉多余或未装备的机关。 */
export function ensureGadgets(
  formation: Formation,
  levels: Partial<Record<ModuleId, ModuleLevel>>,
  loadout: Loadout,
): Formation {
  const gadgets: GadgetPlacement[] = [];
  for (const module of ['mirrorpost', 'spring'] as const) {
    const level = levels[module];
    if (!level || !findEquipped(loadout, module)) continue;
    for (let index = 0; index < gadgetCount(level); index++) {
      const existing = formation.gadgets.find((g) => g.module === module && g.index === index);
      gadgets.push(existing ?? defaultGadgetPlacement(module, index));
    }
  }
  return { ...formation, gadgets };
}

export function defaultGadgetPlacement(
  module: 'mirrorpost' | 'spring',
  index: number,
): GadgetPlacement {
  const x = module === 'mirrorpost' ? 520 : 600;
  const y = module === 'mirrorpost' ? 200 + index * 260 : 330 + (index === 0 ? -60 : 120);
  return { module, index, x, y };
}

export function clampFormation(formation: Formation): Formation {
  const units = { ...formation.units };
  for (const kind of PLAYER_UNITS) {
    const p = units[kind];
    units[kind] = {
      x: clamp(p.x, 30, ARENA.playerZoneMaxX),
      y: clamp(p.y, 30, ARENA.height - 30),
    };
  }
  const gadgets = formation.gadgets.map((g) => ({
    ...g,
    x: clamp(g.x, ARENA.margin, ARENA.gadgetZoneMaxX),
    y: clamp(g.y, ARENA.margin, ARENA.height - ARENA.margin),
  }));
  return { units, gadgets };
}

/** 整轮的重试次数（每场的尝试次数减去最终那一次）。 */
export function totalRetries(run: RunState): number {
  return run.records.reduce((sum, r) => sum + Math.max(0, r.attempts - (r.won ? 1 : 0)), 0);
}

export function ownedModules(run: RunState): ModuleId[] {
  return (Object.keys(run.levels) as ModuleId[]).filter((id) => id in MODULE_DEFS);
}
