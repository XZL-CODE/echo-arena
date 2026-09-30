// 测试与平衡脚本共用：搭建指定阵容的战斗、推进到结束，以及按几种策略自动打完一整轮。
// 自动玩家不点集火、不手动调站位，比真人弱。
import {
  encounterById,
  type EncounterDef,
  type EncounterPet,
} from '../../../src/core/content/encounters.js';
import { SPECIES } from '../../../src/core/content/species.js';
import { hashSeed, Rng } from '../../../src/core/rng.js';
import { applyAutoFormation } from '../../../src/core/run/formation.js';
import {
  battleConfig,
  beginBattle,
  createRun,
  finishBattle,
  pickReward,
  setFormation,
  type RewardPick,
  type RunState,
} from '../../../src/core/run/run.js';
import type { Unit } from '../../../src/core/sim/entities.js';
import type { SimEvent } from '../../../src/core/sim/events.js';
import { createStats, type BattleStats } from '../../../src/core/sim/stats.js';
import { World } from '../../../src/core/sim/world.js';
import type {
  DamageSource,
  Difficulty,
  Form,
  LegionPet,
  SpeciesId,
} from '../../../src/core/types.js';

export interface PetSpec {
  species: SpeciesId;
  form: Form;
  x: number;
  y: number;
}

/** 测试用的对手：只有给定的军团。 */
export function testEncounter(
  legion: EncounterPet[],
  extra: Partial<EncounterDef> = {},
): EncounterDef {
  return {
    id: 'test',
    tier: 1,
    trainer: '测试',
    name: '测试',
    intro: '',
    theme: 'mixed',
    legion,
    ...extra,
  };
}

/** 按给定阵容搭建一场战斗（玩家宠物 uid 从 1 起）。 */
export function makeWorld(
  enemies: EncounterDef | string | EncounterPet[],
  players: PetSpec[],
  options: { seed?: number; difficulty?: Difficulty; matchIndex?: number } = {},
): World {
  const encounter =
    typeof enemies === 'string'
      ? encounterById(enemies)
      : Array.isArray(enemies)
        ? testEncounter(enemies)
        : enemies;
  return new World({
    encounter,
    seed: options.seed ?? 1,
    difficulty: options.difficulty ?? 'normal',
    matchIndex: options.matchIndex ?? 0,
    legion: players.map((p, i) => ({ uid: i + 1, ...p })),
  });
}

/** 场景测试用的对手宠物（位置在对手出场区之外也可以）。 */
export function foe(species: SpeciesId, form: Form, x: number, y: number): EncounterPet {
  return { species, form, x, y };
}

/**
 * 让场上所有单位暂时不放技能和大招（keep 里的单位除外），便于单独观察一个行为。
 * 单位本身是普通对象，测试直接改冷却与能量。
 */
export function quiet(world: World, keep: readonly Unit[] = []): void {
  for (const u of world.units) {
    if (keep.includes(u)) continue;
    u.skillCd = 999;
    u.energy = -1;
    u.breathCd = 999;
    u.tailCd = 999;
    u.summonCd = 999;
  }
}

/** 推进若干秒，收集这段时间的全部事件。 */
export function runFor(world: World, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    world.step();
    out.push(...world.drainEvents());
  }
  return out;
}

export interface BattleOutcome {
  result: 'win' | 'lose';
  time: number;
  hpLeft: number;
  maxEcho: number;
  world: World;
}

/** 推进到分出胜负（或到时限）。 */
export function simulate(world: World, maxSeconds = 200): BattleOutcome {
  const maxSteps = Math.round(maxSeconds * 60);
  for (let i = 0; i < maxSteps && !world.result; i++) {
    world.step();
    world.events.length = 0;
  }
  const players = world.units.filter((u) => u.team === 0);
  const hpLeft =
    players.reduce((sum, u) => sum + Math.max(0, u.hp), 0) /
    Math.max(
      1,
      players.reduce((sum, u) => sum + u.maxHp, 0),
    );
  return {
    result: world.result ?? 'lose',
    time: world.t,
    hpLeft,
    maxEcho: world.stats.maxEcho,
    world,
  };
}

// ---- 自动玩家 ----

export type Strategy = 'evolve-first' | 'capture-first' | 'mixed' | 'partner-carry';
export const STRATEGIES: readonly Strategy[] = [
  'evolve-first',
  'capture-first',
  'mixed',
  'partner-carry',
];

function roleCount(legion: readonly LegionPet[], role: string): number {
  return legion.filter((p) => SPECIES[p.species].role === role).length;
}

/** 候选宠物对当前军团的价值：形态越高越好，缺坦克、缺辅助时优先补上。 */
function captureValue(legion: readonly LegionPet[], species: SpeciesId, form: Form): number {
  const role = SPECIES[species].role;
  let value = form * 10;
  if (role === 'tank' && roleCount(legion, 'tank') < 2) value += 6;
  if (role === 'support' && roleCount(legion, 'support') < 2) value += 5;
  value -= legion.filter((p) => p.species === species).length * 3;
  return value;
}

function bestIndex<T>(items: readonly T[], score: (item: T) => number): number | undefined {
  let best: number | undefined;
  let bestScore = -Infinity;
  items.forEach((item, i) => {
    const s = score(item);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}

/** 按策略挑奖励（收服与进化两行各挑一个）。 */
export function chooseReward(
  run: RunState,
  strategy: Strategy,
  lastDamage: Record<number, number> = {},
): RewardPick {
  const rewards = run.rewards;
  if (!rewards) return {};
  const rng = new Rng(hashSeed(run.seed, 'autopick', run.matchIndex, strategy));
  const capture = rewards.capture;
  const evolve = rewards.evolve;
  switch (strategy) {
    case 'evolve-first':
      return {
        evolve: bestIndex(evolve, (e) => e.to * 10 + (e.uid === run.partnerUid ? 5 : 0)),
        capture: bestIndex(capture, (c) => captureValue(run.legion, c.species, c.form)),
      };
    case 'capture-first':
      return {
        capture: bestIndex(
          capture,
          (c) => captureValue(run.legion, c.species, c.form) + c.form * 5,
        ),
        // 先把幼年都进化起来，队伍整体变强。
        evolve: bestIndex(evolve, (e) => (e.from === 1 ? 20 : 0) + e.uid * 0.01),
      };
    case 'partner-carry':
      // 伙伴优先进化，其次是上一场打得最多的宠物。
      return {
        evolve: bestIndex(
          evolve,
          (e) => (e.uid === run.partnerUid ? 100 : 0) + (lastDamage[e.uid] ?? 0) / 100,
        ),
        capture: bestIndex(capture, (c) => captureValue(run.legion, c.species, c.form)),
      };
    case 'mixed':
    default:
      return {
        capture: capture.length > 0 ? rng.int(capture.length) : undefined,
        evolve: evolve.length > 0 ? rng.int(evolve.length) : undefined,
      };
  }
}

/** 重试时换一种站位：上下翻转，或整体前移。 */
function variantFormation(run: RunState, attempt: number): RunState {
  const auto = applyAutoFormation(run.legion);
  const positions: Record<number, { x: number; y: number }> = {};
  for (const pet of auto) {
    positions[pet.uid] =
      attempt % 2 === 1 ? { x: pet.x, y: 800 - pet.y } : { x: pet.x + 50, y: pet.y };
  }
  return setFormation(run, positions);
}

export interface BattleLog {
  matchIndex: number;
  encounterId: string;
  /** 第一次就赢了。 */
  firstWin: boolean;
  /** 最终赢了（含重试）。 */
  won: boolean;
  attempts: number;
  /** 第一次尝试的战斗时长。 */
  time: number;
  /** 这一场（第一次尝试）各物种造成的伤害与上场只数。 */
  damageBySpecies: Partial<Record<SpeciesId, number>>;
  countBySpecies: Partial<Record<SpeciesId, number>>;
  /** 这一场（第一次尝试）按来源拆分的伤害与最长回响。 */
  damageBySkill: Partial<Record<DamageSource, number>>;
  maxEcho: number;
  /** 打赢时还站着的玩家宠物比例。 */
  survivors: number;
  timeout: boolean;
}

export interface RunLog {
  seed: number;
  strategy: Strategy;
  difficulty: Difficulty;
  battles: BattleLog[];
  /** 没有靠强制推进就打通了。 */
  cleared: boolean;
}

/** 按策略把一轮推进到第 matchIndex 场的战前（输了也强制推进），用于追踪中后期的战斗。 */
export function advanceTo(
  seed: number,
  difficulty: Difficulty,
  strategy: Strategy,
  matchIndex: number,
): RunState {
  let run = createRun(seed, difficulty);
  let lastDamage: Record<number, number> = {};
  while (run.matchIndex < matchIndex && run.phase !== 'complete') {
    if (run.phase === 'reward') {
      run = pickReward(run, chooseReward(run, strategy, lastDamage));
      continue;
    }
    run = beginBattle(run);
    const { stats } = playBattle(run);
    lastDamage = { ...stats.damageByUid };
    run = finishBattle(run, { ...stats, result: 'win' });
  }
  return run;
}

function playBattle(run: RunState): { stats: BattleStats; world: World } {
  const world = new World(battleConfig(run));
  const outcome = simulate(world);
  return { stats: outcome.world.stats, world };
}

/**
 * 自动打完一整轮。输了会换站位重试 retries 次；force 为 true 时仍然输了就强制推进，
 * 这样后面的场次也能统计到（这些场次不算打通）。
 */
export function playRun(
  seed: number,
  difficulty: Difficulty,
  strategy: Strategy,
  options: { retries?: number; force?: boolean } = {},
): RunLog {
  const retries = options.retries ?? 2;
  let run = createRun(seed, difficulty);
  const log: RunLog = { seed, strategy, difficulty, battles: [], cleared: true };
  let lastDamage: Record<number, number> = {};
  while (run.phase !== 'complete') {
    if (run.phase === 'reward') {
      run = pickReward(run, chooseReward(run, strategy, lastDamage));
      continue;
    }
    let entry: BattleLog | null = null;
    let won = false;
    for (let attempt = 0; attempt <= retries && !won; attempt++) {
      if (attempt > 0) run = variantFormation(run, attempt);
      run = beginBattle(run);
      const { stats, world } = playBattle(run);
      if (!entry) {
        const bySpecies: Partial<Record<SpeciesId, number>> = {};
        const count: Partial<Record<SpeciesId, number>> = {};
        for (const pet of run.legion) {
          const dealt = stats.damageByUid[pet.uid] ?? 0;
          bySpecies[pet.species] = (bySpecies[pet.species] ?? 0) + dealt;
          count[pet.species] = (count[pet.species] ?? 0) + 1;
        }
        entry = {
          matchIndex: run.matchIndex,
          encounterId: run.order[run.matchIndex] as string,
          firstWin: stats.result === 'win',
          won: false,
          attempts: 0,
          time: world.t,
          damageBySpecies: bySpecies,
          countBySpecies: count,
          damageBySkill: { ...stats.damageBySkill },
          maxEcho: stats.maxEcho,
          survivors:
            world.units.filter((u) => u.team === 0 && u.alive).length /
            Math.max(1, world.units.filter((u) => u.team === 0).length),
          timeout: stats.timeout,
        };
      }
      entry.attempts = attempt + 1;
      run = finishBattle(run, stats);
      won = stats.result === 'win';
      if (won) lastDamage = { ...stats.damageByUid };
    }
    const done = entry as BattleLog;
    done.won = won;
    log.battles.push(done);
    if (!won) {
      log.cleared = false;
      if (!options.force) break;
      run = finishBattle(beginBattle(run), { ...createStats(), result: 'win', duration: 0 });
    }
  }
  return log;
}
