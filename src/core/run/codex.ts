// 图鉴：记录见过（双方出场、召唤、变身）或拥有过的形态标识，如 fox-3、dragon-2。
import { ALL_FORM_IDS, formId } from '../content/species.js';
import type { World } from '../sim/world.js';
import type { LegionPet } from '../types.js';

const KNOWN = new Set(ALL_FORM_IDS);

export function isFormId(id: unknown): id is string {
  return typeof id === 'string' && KNOWN.has(id);
}

/** 这场战斗里出现过的全部形态（包括开战后召唤的宠物与首领变身）。 */
export function codexFromWorld(world: World): string[] {
  return world.formsSeen.filter(isFormId);
}

/** 军团里拥有的形态。 */
export function codexFromLegion(
  legion: ReadonlyArray<Pick<LegionPet, 'species' | 'form'>>,
): string[] {
  return legion.map((p) => formId(p.species, p.form)).filter(isFormId);
}

/** 合并进图鉴：去重、去掉不认识的标识，按图鉴顺序排列。 */
export function mergeCodex(codex: readonly string[], ids: readonly string[]): string[] {
  const seen = new Set([...codex, ...ids].filter(isFormId));
  return ALL_FORM_IDS.filter((id) => seen.has(id));
}

export function codexProgress(codex: readonly string[]): { seen: number; total: number } {
  return { seen: mergeCodex([], codex).length, total: ALL_FORM_IDS.length };
}
