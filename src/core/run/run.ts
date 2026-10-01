// 一轮的进程：选伙伴、7 场对局、战前检查点、胜利后的收服与进化、整轮结算。
// 全部是可序列化的普通数据；界面只调用这里的函数来推进状态。
import {
  ARMY_CAPS,
  encounterById,
  ENCOUNTERS,
  RUN_TIERS,
  type EncounterDef,
} from '../content/encounters.js';
import { SPECIES, SPECIES_IDS } from '../content/species.js';
import { hashSeed, Rng } from '../rng.js';
import type { BattleStats } from '../sim/stats.js';
import type { BattleConfig } from '../sim/world.js';
import type {
  DamageSource,
  Difficulty,
  Form,
  LegionPet,
  Point,
  Role,
  SpeciesId,
} from '../types.js';
import { applyAutoFormation, freeSpotFor, placeLegion } from './formation.js';
import { generateRewards, type RewardOffer } from './rewards.js';

export type RunPhase = 'prep' | 'reward' | 'complete';

export interface MatchRecord {
  encounterId: string;
  attempts: number;
  won: boolean;
  winTime: number;
  maxEcho: number;
  /** 获胜那一场的伤害来源拆分（技能 id、basic、impact、reflect）。 */
  damageBySkill: Partial<Record<DamageSource, number>>;
  /** 获胜那一场每只宠物造成的伤害（uid → 伤害）。 */
  damageByUid: Record<number, number>;
}

export interface RunState {
  seed: number;
  difficulty: Difficulty;
  startedAt: string;
  /** 战斗累计时长（秒）。 */
  battleTime: number;
  /** 7 场对局的对手 id。 */
  order: string[];
  matchIndex: number;
  phase: RunPhase;
  /** 玩家军团与站位。 */
  legion: LegionPet[];
  /** 下一只新宠物的 uid。 */
  nextUid: number;
  /** 伙伴：开局选的那一只（开局就是进化形态）。 */
  partnerUid: number;
  /** 开局可选的三只伙伴。 */
  starters: SpeciesId[];
  /** 待选的奖励（仅在 reward 阶段）。 */
  rewards: RewardOffer | null;
  records: MatchRecord[];
  /** 进入战斗时置为 true；如果在战斗中关闭，重新进入时据此提示“已回到战前”。 */
  inBattle: boolean;
}

export const RUN_LENGTH = RUN_TIERS.length;

/** 按档位为这一轮抽取 7 场对局。 */
export function rollOrder(seed: number): string[] {
  const rng = new Rng(hashSeed(seed, 'order'));
  return RUN_TIERS.map((tier) => {
    const pool = ENCOUNTERS.filter((e) => e.tier === tier);
    if (pool.length === 0) throw new Error(`No encounter for tier ${tier}`);
    return rng.pick(pool).id;
  });
}

/**
 * 开局军团：4 只幼年同伴（一只坦克、一只辅助、两只输出）+ 三选一的伙伴。
 * 同伴不和伙伴候选重复，所以换伙伴不会破坏定位搭配。伙伴候选尽量属性各不相同。
 */
function rollStart(seed: number): { companions: SpeciesId[]; starters: SpeciesId[] } {
  const rng = new Rng(hashSeed(seed, 'start'));
  const byRole = (role: Role) => SPECIES_IDS.filter((s) => SPECIES[s].role === role);
  const tank = rng.pick(byRole('tank'));
  const support = rng.pick(byRole('support'));
  const damage = rng.shuffle(
    SPECIES_IDS.filter((s) => SPECIES[s].role !== 'tank' && SPECIES[s].role !== 'support'),
  );
  const companions = [tank, support, ...damage.slice(0, 2)];
  const pool = rng.shuffle(SPECIES_IDS.filter((s) => !companions.includes(s)));
  const starters: SpeciesId[] = [];
  for (const s of pool) {
    if (starters.length >= 3) break;
    if (!starters.some((x) => SPECIES[x].element === SPECIES[s].element)) starters.push(s);
  }
  for (const s of pool) if (starters.length < 3 && !starters.includes(s)) starters.push(s);
  return { companions, starters };
}

export function createRun(seed: number, difficulty: Difficulty, now = new Date()): RunState {
  const order = rollOrder(seed);
  const { companions, starters } = rollStart(seed);
  const partner = starters[0] as SpeciesId;
  const pets: LegionPet[] = [
    { uid: 1, species: partner, form: 2, x: 0, y: 0 },
    ...companions.map((species, i) => ({ uid: i + 2, species, form: 1 as Form, x: 0, y: 0 })),
  ];
  return {
    seed,
    difficulty,
    startedAt: now.toISOString(),
    battleTime: 0,
    order,
    matchIndex: 0,
    phase: 'prep',
    legion: applyAutoFormation(pets),
    nextUid: pets.length + 1,
    partnerUid: 1,
    starters,
    rewards: null,
    records: order.map((encounterId) => emptyRecord(encounterId)),
    inBattle: false,
  };
}

function emptyRecord(encounterId: string): MatchRecord {
  return {
    encounterId,
    attempts: 0,
    won: false,
    winTime: 0,
    maxEcho: 0,
    damageBySkill: {},
    damageByUid: {},
  };
}

export function currentEncounter(run: RunState): EncounterDef {
  return encounterById(run.order[run.matchIndex] as string);
}

export function nextEncounter(run: RunState): EncounterDef | null {
  const id = run.order[run.matchIndex + 1];
  return id ? encounterById(id) : null;
}

/** 本场可上场的宠物数上限。 */
export function armyCap(run: RunState, matchIndex = run.matchIndex): number {
  return ARMY_CAPS[Math.min(matchIndex, ARMY_CAPS.length - 1)] ?? 10;
}

export function partnerOf(run: RunState): LegionPet | undefined {
  return run.legion.find((p) => p.uid === run.partnerUid);
}

/** 第一场开战之前可以改选伙伴。 */
export function canChooseStarter(run: RunState): boolean {
  return run.matchIndex === 0 && (run.records[0]?.attempts ?? 0) === 0 && run.phase === 'prep';
}

/** 改选伙伴：保留 uid 与形态，换物种后按新定位找空位。 */
export function chooseStarter(run: RunState, species: SpeciesId): RunState {
  if (!canChooseStarter(run) || !run.starters.includes(species)) return run;
  const partner = partnerOf(run);
  if (!partner || partner.species === species) return run;
  const changed = { ...partner, species };
  const others = run.legion.filter((p) => p.uid !== partner.uid);
  const spot = freeSpotFor(others, changed);
  const legion = run.legion.map((p) => (p.uid === partner.uid ? { ...changed, ...spot } : p));
  return { ...run, legion };
}

/** 按 uid 调整站位（限制在玩家区内）。 */
export function setFormation(run: RunState, positions: Readonly<Record<number, Point>>): RunState {
  return { ...run, legion: placeLegion(run.legion, positions) };
}

/** 整支军团恢复自动布阵。 */
export function resetFormation(run: RunState): RunState {
  return { ...run, legion: applyAutoFormation(run.legion) };
}

/** 该场战斗的配置。同一场的每次重试使用同一个种子，便于比较改动的效果。 */
export function battleConfig(run: RunState): BattleConfig {
  return {
    encounter: currentEncounter(run),
    seed: hashSeed(run.seed, 'match', run.matchIndex),
    difficulty: run.difficulty,
    matchIndex: run.matchIndex,
    legion: run.legion.map((p) => ({ ...p })),
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
      next.damageBySkill = { ...stats.damageBySkill };
      next.damageByUid = { ...stats.damageByUid };
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
  const rewards = generateRewards(
    run.seed,
    run.matchIndex,
    run.order[run.matchIndex] as string,
    run.legion,
  );
  return { ...base, phase: 'reward', rewards };
}

export interface RewardPick {
  /** 收服第几只候选（不填则不收服）。 */
  capture?: number;
  /** 进化第几个候选（不填则不进化）。 */
  evolve?: number;
}

/** 领取奖励：收服与进化同时生效，然后进入下一场的战前准备。 */
export function pickReward(run: RunState, pick: RewardPick): RunState {
  if (run.phase !== 'reward' || !run.rewards) return run;
  let legion = run.legion;
  let nextUid = run.nextUid;
  const evolve = pick.evolve === undefined ? undefined : run.rewards.evolve[pick.evolve];
  if (evolve) {
    legion = legion.map((p) =>
      p.uid === evolve.uid && p.form === evolve.from ? { ...p, form: evolve.to } : p,
    );
  }
  const capture = pick.capture === undefined ? undefined : run.rewards.capture[pick.capture];
  if (capture && legion.length < armyCap(run, run.matchIndex + 1)) {
    const pet: LegionPet = {
      uid: nextUid++,
      species: capture.species,
      form: capture.form,
      x: 0,
      y: 0,
    };
    legion = [...legion, { ...pet, ...freeSpotFor(legion, pet) }];
  }
  return {
    ...run,
    legion,
    nextUid,
    rewards: null,
    phase: 'prep',
    matchIndex: run.matchIndex + 1,
  };
}

/** 整轮的重试次数（每场的尝试次数减去最终那一次）。 */
export function totalRetries(run: RunState): number {
  return run.records.reduce((sum, r) => sum + Math.max(0, r.attempts - (r.won ? 1 : 0)), 0);
}

/** 教学战用的种子。 */
export const PRACTICE_SEED = 20260930;

/**
 * 教学战：轻松难度的第一场（森林新芽队），军团固定；伙伴是人形态的九焰，好把大招也教到。
 * 只存在于内存里，不写进存档。
 */
export function createPracticeRun(now = new Date()): RunState {
  const run = createRun(PRACTICE_SEED, 'easy', now);
  const order = ['sprouts', ...run.order.slice(1)];
  const pets: LegionPet[] = [
    { uid: 1, species: 'fox', form: 3, x: 0, y: 0 },
    { uid: 2, species: 'turtle', form: 1, x: 0, y: 0 },
    { uid: 3, species: 'otter', form: 1, x: 0, y: 0 },
    { uid: 4, species: 'bunny', form: 1, x: 0, y: 0 },
    { uid: 5, species: 'cat', form: 1, x: 0, y: 0 },
  ];
  return {
    ...run,
    order,
    legion: applyAutoFormation(pets),
    nextUid: pets.length + 1,
    partnerUid: 1,
    starters: ['fox', 'wolf', 'lizard'],
    records: order.map((encounterId) => emptyRecord(encounterId)),
  };
}
