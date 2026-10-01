// 布阵：站位限制在玩家区内；自动布阵按定位分列——坦克最前，近战其次，远程与法师在后，辅助最后。
import { formStats, SPECIES } from '../content/species.js';
import { ARENA } from '../content/tuning.js';
import { clamp, dist } from '../math.js';
import type { LegionPet, Point, Role } from '../types.js';

const COLUMN_X: Record<Role, number> = {
  tank: 580,
  fighter: 460,
  assassin: 460,
  ranged: 330,
  mage: 330,
  support: 200,
};

/** 两只宠物之间至少留出的距离（新宠物找空位时用）。 */
const MIN_GAP = 56;

/** 把站位限制在玩家区内。 */
export function clampToPlayerZone(p: Point, radius = 0): Point {
  const pad = Math.max(ARENA.margin, radius);
  return {
    x: clamp(p.x, pad, ARENA.playerZoneMaxX),
    y: clamp(p.y, pad, ARENA.height - pad),
  };
}

type Placeable = Pick<LegionPet, 'uid' | 'species' | 'form'>;

/** 同一列的宠物上下均匀排开（按 uid 排序，结果稳定）。 */
export function autoFormation(legion: readonly Placeable[]): Record<number, Point> {
  const columns = new Map<number, Placeable[]>();
  for (const pet of [...legion].sort((a, b) => a.uid - b.uid)) {
    const x = COLUMN_X[SPECIES[pet.species].role];
    const column = columns.get(x) ?? [];
    column.push(pet);
    columns.set(x, column);
  }
  const out: Record<number, Point> = {};
  for (const [x, pets] of columns) {
    const n = pets.length;
    const gap = n > 1 ? Math.min(140, 700 / (n - 1)) : 0;
    pets.forEach((pet, i) => {
      out[pet.uid] = clampToPlayerZone(
        { x, y: ARENA.height / 2 + (i - (n - 1) / 2) * gap },
        formStats(pet.species, pet.form).radius,
      );
    });
  }
  return out;
}

/** 整支军团重新自动布阵。 */
export function applyAutoFormation(legion: readonly LegionPet[]): LegionPet[] {
  const spots = autoFormation(legion);
  return legion.map((pet) => ({ ...pet, ...(spots[pet.uid] as Point) }));
}

/** 按 uid 设定站位（只改给出的宠物），全部限制在玩家区内。 */
export function placeLegion(
  legion: readonly LegionPet[],
  positions: Readonly<Record<number, Point>>,
): LegionPet[] {
  return legion.map((pet) => {
    const p = positions[pet.uid];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return pet;
    return { ...pet, ...clampToPlayerZone(p, formStats(pet.species, pet.form).radius) };
  });
}

/** 给新加入的宠物找位置：先试它所在定位的那一列，被占了就沿着这一列上下找，再往后排找。 */
export function freeSpotFor(legion: readonly LegionPet[], pet: Placeable): Point {
  const radius = formStats(pet.species, pet.form).radius;
  const baseX = COLUMN_X[SPECIES[pet.species].role];
  const others = legion.filter((p) => p.uid !== pet.uid);
  for (const dx of [0, -70, 70, -140]) {
    for (let k = 0; k <= 8; k++) {
      const offset = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 70;
      const spot = clampToPlayerZone({ x: baseX + dx, y: ARENA.height / 2 + offset }, radius);
      if (others.every((o) => dist(o.x, o.y, spot.x, spot.y) >= MIN_GAP)) return spot;
    }
  }
  return clampToPlayerZone({ x: baseX, y: ARENA.height / 2 }, radius);
}
