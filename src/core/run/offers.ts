// 胜利奖励：三选一。至少一个新思路、至少一个进阶（如果有可进阶的），
// 并保证至少一个选项对下一场有用——但不标出哪个是“答案”。
import { encounterById } from '../content/encounters.js';
import { ALL_MODULES, MODULE_DEFS } from '../content/modules.js';
import { hashSeed, Rng } from '../rng.js';
import type { ModuleId } from '../types.js';
import type { RunState } from './run.js';

export interface Offer {
  id: ModuleId;
  kind: 'new' | 'upgrade';
}

export const OFFER_COUNT = 3;

export function generateOffers(run: RunState): Offer[] {
  const rng = new Rng(hashSeed(run.seed, 'offers', run.matchIndex));
  const nextId = run.order[run.matchIndex + 1];
  const relevant = nextId ? encounterById(nextId).relevant : [];
  const fresh = ALL_MODULES.filter((id) => !run.levels[id]);
  const upgrades = ALL_MODULES.filter((id) => run.levels[id] === 1);
  const chosen: Offer[] = [];
  const taken = new Set<ModuleId>();

  const take = (id: ModuleId | undefined, kind: Offer['kind']) => {
    if (!id || taken.has(id)) return;
    taken.add(id);
    chosen.push({ id, kind });
  };
  const pickFrom = (pool: ModuleId[]) => {
    const available = pool.filter((id) => !taken.has(id));
    if (available.length === 0) return undefined;
    // 尽量避开已选中选项的所属队员，让三个选项代表不同方向。
    const owners = new Set(chosen.map((o) => MODULE_DEFS[o.id].owner));
    const varied = available.filter((id) => !owners.has(MODULE_DEFS[id].owner));
    return rng.pick(varied.length > 0 ? varied : available);
  };

  const relevantFresh = fresh.filter((id) => relevant.includes(id));
  take(pickFrom(relevantFresh.length > 0 ? relevantFresh : fresh), 'new');
  take(pickFrom(upgrades), 'upgrade');
  while (chosen.length < OFFER_COUNT) {
    const pool = fresh.filter((id) => !taken.has(id));
    const id = pickFrom(pool.length > 0 ? pool : upgrades);
    if (!id) break;
    take(id, run.levels[id] ? 'upgrade' : 'new');
  }
  return rng.shuffle(chosen);
}
