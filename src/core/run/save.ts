// 存档格式：设置、当前这一轮（战前检查点）与长期记录。读取时逐项校验，坏数据不会让游戏崩溃。
import { ENCOUNTERS } from '../content/encounters.js';
import { MODULE_DEFS } from '../content/modules.js';
import type { Difficulty, GadgetPlacement, ModuleId, ModuleLevel } from '../types.js';
import { PLAYER_UNITS } from '../types.js';
import { sanitizeLoadout } from './loadout.js';
import type { Offer } from './offers.js';
import {
  clampFormation,
  defaultFormation,
  ensureGadgets,
  RUN_LENGTH,
  type MatchRecord,
  type RunPhase,
  type RunState,
} from './run.js';

export const SAVE_VERSION = 1;

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  screenShake: boolean;
  reduceFlashes: boolean;
  autoPause: boolean;
  damageNumbers: boolean;
  /** 新开一轮时使用的难度。 */
  difficulty: Difficulty;
  /** 已经看过的一次性提示。 */
  seenHints: string[];
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
    difficulty: 'normal',
    seenHints: [],
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
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const difficulty = (v: unknown, fallback: Difficulty): Difficulty =>
  DIFFICULTIES.includes(v as Difficulty) ? (v as Difficulty) : fallback;

function parseSettings(raw: unknown): Settings {
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
    difficulty: difficulty(raw.difficulty, d.difficulty),
    seenHints: Array.isArray(raw.seenHints)
      ? raw.seenHints.filter((h): h is string => typeof h === 'string').slice(0, 50)
      : [],
  };
}

function parseRecords(raw: unknown): Records {
  const d = defaultRecords();
  if (!isObject(raw)) return d;
  return {
    runsStarted: num(raw.runsStarted, 0, 0),
    runsCompleted: num(raw.runsCompleted, 0, 0),
    bestEcho: num(raw.bestEcho, 0, 0),
    fastestClear: raw.fastestClear === null ? null : num(raw.fastestClear, 0, 0) || null,
    clearedDifficulties: Array.isArray(raw.clearedDifficulties)
      ? DIFFICULTIES.filter((x) => (raw.clearedDifficulties as unknown[]).includes(x))
      : [],
  };
}

function parseLevels(raw: unknown): Partial<Record<ModuleId, ModuleLevel>> {
  const out: Partial<Record<ModuleId, ModuleLevel>> = {};
  if (!isObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in MODULE_DEFS)) continue;
    if (value === 1 || value === 2) out[key as ModuleId] = value;
  }
  return out;
}

function parseRun(raw: unknown): RunState | null {
  if (!isObject(raw)) return null;
  const known = new Set(ENCOUNTERS.map((e) => e.id));
  const order = Array.isArray(raw.order)
    ? raw.order.filter((id): id is string => typeof id === 'string')
    : [];
  if (order.length !== RUN_LENGTH || order.some((id) => !known.has(id))) return null;

  const levels = parseLevels(raw.levels);
  const loadout = sanitizeLoadout(raw.loadout, levels);
  const phase: RunPhase = raw.phase === 'reward' || raw.phase === 'complete' ? raw.phase : 'prep';
  const matchIndex = Math.round(num(raw.matchIndex, 0, 0, RUN_LENGTH - 1));

  const formationRaw = isObject(raw.formation) ? raw.formation : {};
  const base = defaultFormation();
  const unitsRaw = isObject(formationRaw.units) ? formationRaw.units : {};
  for (const kind of PLAYER_UNITS) {
    const p = unitsRaw[kind];
    if (isObject(p))
      base.units[kind] = { x: num(p.x, base.units[kind].x), y: num(p.y, base.units[kind].y) };
  }
  const gadgets: GadgetPlacement[] = Array.isArray(formationRaw.gadgets)
    ? formationRaw.gadgets.filter(isObject).flatMap((g) => {
        if (g.module !== 'mirrorpost' && g.module !== 'spring') return [];
        return [
          {
            module: g.module,
            index: Math.round(num(g.index, 0, 0, 1)),
            x: num(g.x, 520),
            y: num(g.y, 330),
          },
        ];
      })
    : [];
  const formation = ensureGadgets(clampFormation({ units: base.units, gadgets }), levels, loadout);

  const records: MatchRecord[] = order.map((encounterId, i) => {
    const r =
      Array.isArray(raw.records) && isObject(raw.records[i]) ? (raw.records[i] as Json) : {};
    const damage: Partial<Record<string, number>> = {};
    if (isObject(r.damageBySource)) {
      for (const [k, v] of Object.entries(r.damageBySource)) damage[k] = num(v, 0, 0);
    }
    return {
      encounterId,
      attempts: Math.round(num(r.attempts, 0, 0)),
      won: bool(r.won, false),
      winTime: num(r.winTime, 0, 0),
      maxEcho: num(r.maxEcho, 0, 0),
      damageBySource: damage,
    };
  });

  let offers: Offer[] | null = null;
  if (phase === 'reward' && Array.isArray(raw.offers)) {
    offers = raw.offers.filter(isObject).flatMap((o) => {
      if (typeof o.id !== 'string' || !(o.id in MODULE_DEFS)) return [];
      return [
        {
          id: o.id as ModuleId,
          kind: o.kind === 'upgrade' ? ('upgrade' as const) : ('new' as const),
        },
      ];
    });
  }

  return {
    seed: Math.round(num(raw.seed, 1)) >>> 0,
    difficulty: difficulty(raw.difficulty, 'normal'),
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : new Date().toISOString(),
    battleTime: num(raw.battleTime, 0, 0),
    order,
    matchIndex,
    phase: phase === 'reward' && (!offers || offers.length === 0) ? 'prep' : phase,
    levels,
    loadout,
    formation,
    offers,
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
  return {
    app: 'echo-arena',
    version: SAVE_VERSION,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date(0).toISOString(),
    settings: parseSettings(raw.settings),
    run: parseRun(raw.run),
    records: parseRecords(raw.records),
  };
}
