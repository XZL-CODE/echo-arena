// 存档格式：设置、当前这一轮（战前检查点）、长期记录与图鉴。读取时逐项校验，坏数据不会让游戏崩溃。
import { ARMY_CAPS, ENCOUNTERS, RUN_TIERS } from '../content/encounters.js';
import { SPECIES_IDS } from '../content/species.js';
import type { Difficulty, Form, LegionPet, SpeciesId } from '../types.js';
import { mergeCodex } from './codex.js';
import { clampToPlayerZone } from './formation.js';
import {
  generateRewards,
  type CaptureOffer,
  type EvolveOffer,
  type RewardOffer,
} from './rewards.js';
import { RUN_LENGTH, type MatchRecord, type RunPhase, type RunState } from './run.js';

// 版本 2：设置里增加新手指引进度（guideSeen）。
// 版本 3：新手指引按课程记录。
// 版本 4：玩法改为宠物军团自动战斗。设置增加大招特写与画质，新增图鉴；旧的一轮不兼容，读入时丢弃。
export const SAVE_VERSION = 4;

/**
 * 新手指引的各课：战前准备、开战、第一次打出回响、第一次放大招、第一场结算、第一次挑奖励。
 * 每课在对应情形第一次出现时教一次。
 */
export const GUIDE_PARTS = ['prep', 'battle', 'echo', 'ult', 'result', 'reward'] as const;
export type GuidePart = (typeof GUIDE_PARTS)[number];

export type Quality = 'auto' | 'high' | 'medium' | 'low';
export const QUALITIES: readonly Quality[] = ['auto', 'high', 'medium', 'low'];

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  screenShake: boolean;
  reduceFlashes: boolean;
  autoPause: boolean;
  damageNumbers: boolean;
  /** 大招特写。 */
  cinematics: boolean;
  quality: Quality;
  /** 新开一轮时使用的难度。 */
  difficulty: Difficulty;
  /** 已经看过的一次性提示。 */
  seenHints: string[];
  /** 新手指引里已经学过或跳过的课。 */
  guideSeen: GuidePart[];
}

export interface Records {
  runsStarted: number;
  runsCompleted: number;
  bestEcho: number;
  /** 通关一轮的最短战斗时长（秒）。 */
  fastestClear: number | null;
  clearedDifficulties: Difficulty[];
}

export interface SaveData {
  app: 'echo-arena';
  version: number;
  savedAt: string;
  settings: Settings;
  run: RunState | null;
  records: Records;
  /** 图鉴：见过或拥有过的形态标识。 */
  codex: string[];
}

export function defaultSettings(): Settings {
  return {
    masterVolume: 0.8,
    sfxVolume: 0.8,
    musicVolume: 0.45,
    muted: false,
    screenShake: true,
    reduceFlashes: false,
    autoPause: true,
    damageNumbers: true,
    cinematics: true,
    quality: 'auto',
    difficulty: 'normal',
    seenHints: [],
    guideSeen: [],
  };
}

export function defaultRecords(): Records {
  return {
    runsStarted: 0,
    runsCompleted: 0,
    bestEcho: 0,
    fastestClear: null,
    clearedDifficulties: [],
  };
}

export function emptySave(): SaveData {
  return {
    app: 'echo-arena',
    version: SAVE_VERSION,
    savedAt: new Date(0).toISOString(),
    settings: defaultSettings(),
    run: null,
    records: defaultRecords(),
    codex: [],
  };
}

export function serializeSave(data: SaveData, now = new Date()): string {
  return JSON.stringify({
    ...data,
    app: 'echo-arena',
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
  });
}

// ---- 读取与校验 ----

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  Math.round(num(v, fallback, min, max));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const difficulty = (v: unknown, fallback: Difficulty): Difficulty =>
  DIFFICULTIES.includes(v as Difficulty) ? (v as Difficulty) : fallback;
const isSpecies = (v: unknown): v is SpeciesId => SPECIES_IDS.includes(v as SpeciesId);
const isForm = (v: unknown): v is Form => v === 1 || v === 2 || v === 3;

/**
 * 设置：逐项校验并补上新增项的默认值。
 * 版本 4 之前的存档来自旧玩法，新手指引要重新教，学习进度清空。
 */
function parseSettings(raw: unknown, version: number): Settings {
  const d = defaultSettings();
  if (!isObject(raw)) return d;
  return {
    masterVolume: num(raw.masterVolume, d.masterVolume, 0, 1),
    sfxVolume: num(raw.sfxVolume, d.sfxVolume, 0, 1),
    musicVolume: num(raw.musicVolume, d.musicVolume, 0, 1),
    muted: bool(raw.muted, d.muted),
    screenShake: bool(raw.screenShake, d.screenShake),
    reduceFlashes: bool(raw.reduceFlashes, d.reduceFlashes),
    autoPause: bool(raw.autoPause, d.autoPause),
    damageNumbers: bool(raw.damageNumbers, d.damageNumbers),
    cinematics: bool(raw.cinematics, d.cinematics),
    quality: QUALITIES.includes(raw.quality as Quality) ? (raw.quality as Quality) : d.quality,
    difficulty: difficulty(raw.difficulty, d.difficulty),
    seenHints: Array.isArray(raw.seenHints)
      ? raw.seenHints.filter((h): h is string => typeof h === 'string').slice(0, 50)
      : [],
    guideSeen:
      version >= SAVE_VERSION && Array.isArray(raw.guideSeen)
        ? GUIDE_PARTS.filter((part) => (raw.guideSeen as unknown[]).includes(part))
        : [],
  };
}

function parseRecords(raw: unknown): Records {
  const d = defaultRecords();
  if (!isObject(raw)) return d;
  return {
    runsStarted: int(raw.runsStarted, 0, 0),
    runsCompleted: int(raw.runsCompleted, 0, 0),
    bestEcho: num(raw.bestEcho, 0, 0),
    fastestClear: raw.fastestClear === null ? null : num(raw.fastestClear, 0, 0) || null,
    clearedDifficulties: Array.isArray(raw.clearedDifficulties)
      ? DIFFICULTIES.filter((x) => (raw.clearedDifficulties as unknown[]).includes(x))
      : [],
  };
}

function parseNumberMap(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = Number(k);
    if (Number.isInteger(key) && key > 0) out[key] = num(v, 0, 0);
  }
  return out;
}

function parseLegion(raw: unknown): LegionPet[] {
  if (!Array.isArray(raw)) return [];
  const out: LegionPet[] = [];
  for (const p of raw.filter(isObject)) {
    const uid = int(p.uid, 0);
    if (uid <= 0 || out.some((q) => q.uid === uid)) continue;
    if (!isSpecies(p.species) || !isForm(p.form)) continue;
    const spot = clampToPlayerZone({ x: num(p.x, 200), y: num(p.y, 400) });
    out.push({ uid, species: p.species, form: p.form, x: spot.x, y: spot.y });
  }
  return out.slice(0, ARMY_CAPS[ARMY_CAPS.length - 1] ?? 10);
}

function parseRewards(raw: unknown, legion: readonly LegionPet[]): RewardOffer | null {
  if (!isObject(raw)) return null;
  const capture: CaptureOffer[] = Array.isArray(raw.capture)
    ? raw.capture
        .filter(isObject)
        .flatMap((c) =>
          isSpecies(c.species) && isForm(c.form) && c.form <= 2
            ? [{ species: c.species, form: c.form }]
            : [],
        )
    : [];
  const evolve: EvolveOffer[] = Array.isArray(raw.evolve)
    ? raw.evolve.filter(isObject).flatMap((e) => {
        const pet = legion.find((p) => p.uid === e.uid);
        if (!pet || pet.form >= 3 || e.from !== pet.form || e.to !== pet.form + 1) return [];
        return [{ uid: pet.uid, species: pet.species, from: pet.form, to: (pet.form + 1) as Form }];
      })
    : [];
  if (capture.length === 0 && evolve.length === 0) return null;
  return { capture: capture.slice(0, 3), evolve: evolve.slice(0, 3) };
}

function parseRun(raw: unknown): RunState | null {
  if (!isObject(raw)) return null;
  const order = Array.isArray(raw.order)
    ? raw.order.filter((id): id is string => typeof id === 'string')
    : [];
  if (order.length !== RUN_LENGTH) return null;
  const tiersOk = order.every(
    (id, i) => ENCOUNTERS.find((e) => e.id === id)?.tier === RUN_TIERS[i],
  );
  if (!tiersOk) return null;

  const legion = parseLegion(raw.legion);
  if (legion.length === 0) return null;
  const maxUid = Math.max(...legion.map((p) => p.uid));
  const partnerUid = legion.some((p) => p.uid === raw.partnerUid)
    ? (raw.partnerUid as number)
    : (legion[0] as LegionPet).uid;
  const starters = Array.isArray(raw.starters)
    ? [...new Set(raw.starters.filter(isSpecies))].slice(0, 3)
    : [];
  const partner = legion.find((p) => p.uid === partnerUid) as LegionPet;

  const seed = int(raw.seed, 1) >>> 0;
  const matchIndex = int(raw.matchIndex, 0, 0, RUN_LENGTH - 1);
  let phase: RunPhase = raw.phase === 'reward' || raw.phase === 'complete' ? raw.phase : 'prep';
  let rewards: RewardOffer | null = null;
  if (phase === 'reward') {
    // 奖励由种子决定：存档里的候选不可用时按同一种子重新生成。
    rewards = parseRewards(raw.rewards, legion);
    if (!rewards && matchIndex < RUN_LENGTH - 1) {
      rewards = generateRewards(seed, matchIndex, order[matchIndex] as string, legion);
    }
    if (!rewards) phase = 'prep';
  }

  const records: MatchRecord[] = order.map((encounterId, i) => {
    const r =
      Array.isArray(raw.records) && isObject(raw.records[i]) ? (raw.records[i] as Json) : {};
    const damageBySkill: Partial<Record<string, number>> = {};
    if (isObject(r.damageBySkill)) {
      for (const [k, v] of Object.entries(r.damageBySkill)) damageBySkill[k] = num(v, 0, 0);
    }
    return {
      encounterId,
      attempts: int(r.attempts, 0, 0),
      won: bool(r.won, false),
      winTime: num(r.winTime, 0, 0),
      maxEcho: num(r.maxEcho, 0, 0),
      damageBySkill,
      damageByUid: parseNumberMap(r.damageByUid),
    };
  });

  return {
    seed,
    difficulty: difficulty(raw.difficulty, 'normal'),
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : new Date().toISOString(),
    battleTime: num(raw.battleTime, 0, 0),
    order,
    matchIndex,
    phase,
    legion,
    nextUid: Math.max(int(raw.nextUid, maxUid + 1), maxUid + 1),
    partnerUid,
    starters: starters.length > 0 ? starters : [partner.species],
    rewards,
    records,
    inBattle: bool(raw.inBattle, false),
  };
}

/** 解析存档文本；无法识别时返回 null（调用方回到全新状态）。 */
export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.app !== 'echo-arena') return null;
  const version = num(raw.version, 1);
  // 版本 4 之前是旧玩法（玩具小队），那一轮无法沿用：保留设置与记录，丢弃进行中的一轮。
  const current = version >= SAVE_VERSION;
  return {
    app: 'echo-arena',
    version: SAVE_VERSION,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date(0).toISOString(),
    settings: parseSettings(raw.settings, version),
    run: current ? parseRun(raw.run) : null,
    records: parseRecords(raw.records),
    codex: current && Array.isArray(raw.codex) ? mergeCodex([], raw.codex as string[]) : [],
  };
}
