// 装配规则：每名队员 2 个槽位；专属招式只能给对应队员；每人最多 1 个主动招式。
import { MODULE_DEFS, SLOTS_PER_UNIT } from '../content/modules.js';
import {
  PLAYER_UNITS,
  type Loadout,
  type ModuleId,
  type ModuleLevel,
  type PlayerUnitKind,
} from '../types.js';

export type EquipCheck = { ok: true } | { ok: false; reason: string };

const UNIT_NAMES: Record<PlayerUnitKind, string> = { guard: '阿铁', slinger: '小弹', bell: '叮当' };

export function emptyLoadout(): Loadout {
  return {
    guard: Array(SLOTS_PER_UNIT).fill(null),
    slinger: Array(SLOTS_PER_UNIT).fill(null),
    bell: Array(SLOTS_PER_UNIT).fill(null),
  };
}

export function cloneLoadout(loadout: Loadout): Loadout {
  return { guard: [...loadout.guard], slinger: [...loadout.slinger], bell: [...loadout.bell] };
}

export function findEquipped(
  loadout: Loadout,
  id: ModuleId,
): { unit: PlayerUnitKind; slot: number } | null {
  for (const unit of PLAYER_UNITS) {
    const slot = loadout[unit].indexOf(id);
    if (slot >= 0) return { unit, slot };
  }
  return null;
}

/** 检查能否把招式放进指定队员的指定槽位（会替换该槽位原有招式）。 */
export function canEquip(
  loadout: Loadout,
  id: ModuleId,
  unit: PlayerUnitKind,
  slot: number,
): EquipCheck {
  const def = MODULE_DEFS[id];
  if (slot < 0 || slot >= SLOTS_PER_UNIT) return { ok: false, reason: '没有这个槽位' };
  if (def.owner !== 'any' && def.owner !== unit) {
    return { ok: false, reason: `${def.name}只能装给${UNIT_NAMES[def.owner]}` };
  }
  if (def.type === 'active') {
    const other = loadout[unit].find(
      (m, i) => i !== slot && m !== null && m !== id && MODULE_DEFS[m].type === 'active',
    );
    if (other) {
      return {
        ok: false,
        reason: `${UNIT_NAMES[unit]}已经带着主动招式「${MODULE_DEFS[other].name}」`,
      };
    }
  }
  return { ok: true };
}

/** 装备：先从其他槽位移除同一招式，再放进目标槽位。不合法时返回原配置。 */
export function equip(loadout: Loadout, id: ModuleId, unit: PlayerUnitKind, slot: number): Loadout {
  const next = unequip(loadout, id);
  if (!canEquip(next, id, unit, slot).ok) return loadout;
  next[unit][slot] = id;
  return next;
}

export function unequip(loadout: Loadout, id: ModuleId): Loadout {
  const next = cloneLoadout(loadout);
  for (const unit of PLAYER_UNITS) {
    next[unit] = next[unit].map((m) => (m === id ? null : m));
  }
  return next;
}

/** 可以放下这个招式的空槽位（按队员顺序）。 */
export function freeSlotsFor(
  loadout: Loadout,
  id: ModuleId,
): Array<{ unit: PlayerUnitKind; slot: number }> {
  const out: Array<{ unit: PlayerUnitKind; slot: number }> = [];
  const def = MODULE_DEFS[id];
  const units = def.owner === 'any' ? PLAYER_UNITS : [def.owner];
  for (const unit of units) {
    loadout[unit].forEach((m, slot) => {
      if (m === null && canEquip(loadout, id, unit, slot).ok) out.push({ unit, slot });
    });
  }
  return out;
}

/** 自动装进第一个可用空槽；没有空槽时返回 null。 */
export function autoEquip(loadout: Loadout, id: ModuleId): Loadout | null {
  if (findEquipped(loadout, id)) return loadout;
  const free = freeSlotsFor(loadout, id);
  const first = free[0];
  if (!first) return null;
  return equip(loadout, id, first.unit, first.slot);
}

/** 清理存档里的配置：去掉未拥有、重复或不合法的条目。 */
export function sanitizeLoadout(
  raw: unknown,
  owned: Partial<Record<ModuleId, ModuleLevel>>,
): Loadout {
  let loadout = emptyLoadout();
  if (!raw || typeof raw !== 'object') return loadout;
  const record = raw as Record<string, unknown>;
  for (const unit of PLAYER_UNITS) {
    const slots = Array.isArray(record[unit]) ? (record[unit] as unknown[]) : [];
    slots.slice(0, SLOTS_PER_UNIT).forEach((value, slot) => {
      if (typeof value !== 'string' || !(value in MODULE_DEFS)) return;
      const id = value as ModuleId;
      if (!owned[id] || findEquipped(loadout, id)) return;
      if (canEquip(loadout, id, unit, slot).ok) loadout = equip(loadout, id, unit, slot);
    });
  }
  return loadout;
}
