// 测试与平衡脚本共用：按招式清单搭建战斗，并用一个简单的“自动玩家”发动主动招式。
import {
  DEFAULT_FORMATION,
  encounterById,
  type EncounterDef,
} from '../../../src/core/content/encounters.js';
import { autoEquip, emptyLoadout } from '../../../src/core/run/loadout.js';
import { dist } from '../../../src/core/math.js';
import type { World } from '../../../src/core/sim/world.js';
import { World as BattleWorld } from '../../../src/core/sim/world.js';
import {
  PLAYER_UNITS,
  type Difficulty,
  type Formation,
  type GadgetPlacement,
  type ModuleId,
  type ModuleLevel,
} from '../../../src/core/types.js';

export interface BuildSpec {
  modules: Array<[ModuleId, ModuleLevel]>;
  gadgets?: GadgetPlacement[];
}

export function makeWorld(
  encounterId: string | EncounterDef,
  build: BuildSpec,
  options: {
    seed?: number;
    difficulty?: Difficulty;
    matchIndex?: number;
    formation?: Formation;
  } = {},
): World {
  let loadout = emptyLoadout();
  const levels: Partial<Record<ModuleId, ModuleLevel>> = {};
  for (const [id, level] of build.modules) {
    levels[id] = level;
    const next = autoEquip(loadout, id);
    if (!next) throw new Error(`No slot for ${id}`);
    loadout = next;
  }
  const formation: Formation = options.formation ?? {
    units: {
      guard: { ...DEFAULT_FORMATION.guard },
      slinger: { ...DEFAULT_FORMATION.slinger },
      bell: { ...DEFAULT_FORMATION.bell },
    },
    gadgets: build.gadgets ?? defaultGadgets(build),
  };
  return new BattleWorld({
    encounter: typeof encounterId === 'string' ? encounterById(encounterId) : encounterId,
    seed: options.seed ?? 1,
    difficulty: options.difficulty ?? 'normal',
    matchIndex: options.matchIndex ?? 0,
    loadout,
    levels,
    formation,
  });
}

function defaultGadgets(build: BuildSpec): GadgetPlacement[] {
  const out: GadgetPlacement[] = [];
  for (const [id, level] of build.modules) {
    if (id !== 'mirrorpost' && id !== 'spring') continue;
    const count = level === 2 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      out.push({ module: id, index: i, x: 520, y: count === 1 ? 330 : 240 + i * 180 });
    }
  }
  return out;
}

/** 简单策略：主动招式一冷却好就往敌人最密集的地方放；优先集火治疗者和惊喜盒。 */
export function autoplay(world: World): void {
  const enemies = world.aliveOf(1);
  if (enemies.length === 0) return;
  const priority = enemies.find((e) => e.kind === 'snail');
  if (priority && world.focusId !== priority.id) world.setFocus(priority.id);

  for (const kind of PLAYER_UNITS) {
    const u = world.playerUnit(kind);
    if (!u || !u.alive || !u.active || u.activeCd > 0) continue;
    let best = enemies[0];
    let bestScore = -1;
    for (const e of enemies) {
      let score = 0;
      if (u.active === 'pierce') {
        const dx = e.x - u.x;
        const dy = e.y - u.y;
        const len = Math.hypot(dx, dy) || 1;
        for (const o of enemies) {
          const cross = Math.abs(((o.x - u.x) * dy - (o.y - u.y) * dx) / len);
          const along = ((o.x - u.x) * dx + (o.y - u.y) * dy) / len;
          if (along > 0 && cross < 34) score++;
        }
      } else {
        for (const o of enemies) if (dist(e.x, e.y, o.x, o.y) < 150) score++;
        if (u.active === 'charge' && dist(u.x, u.y, e.x, e.y) > 420) score -= 10;
      }
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) continue;
    if (u.active === 'vortex' && bestScore < 2 && enemies.length > 1) continue;
    world.castActive(kind, best.x, best.y);
  }
}

export interface BattleOutcome {
  result: 'win' | 'lose';
  time: number;
  hpLeft: number;
  maxEcho: number;
  world: World;
}

export function simulate(world: World, withActives = true, maxSeconds = 200): BattleOutcome {
  const maxSteps = Math.round(maxSeconds * 60);
  for (let i = 0; i < maxSteps && !world.result; i++) {
    if (withActives && i % 12 === 0) autoplay(world);
    world.step();
    world.events.length = 0;
  }
  const players = world.units.filter((u) => u.team === 0);
  const hpLeft =
    players.reduce((sum, u) => sum + Math.max(0, u.hp), 0) /
    players.reduce((sum, u) => sum + u.maxHp, 0);
  return {
    result: world.result ?? 'lose',
    time: world.t,
    hpLeft,
    maxEcho: world.stats.maxEcho,
    world,
  };
}
