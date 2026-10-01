// 造型蓝图登记表：按 id 取蓝图（生成一次后缓存）。
import type { AnimProfile } from '../anim/animator.js';
import { withDetail } from '../kit/geo.js';
import type { Blueprint } from '../kit/rig.js';
import { birdChick, birdEvolved, birdHuman } from './bird.js';
import { bearCub, bearEvolved, bearHuman } from './bear.js';
import { bunnyEvolved, bunnyHuman, bunnyKit } from './bunny.js';
import { catEvolved, catHuman, catKitten } from './cat.js';
import { deerEvolved, deerFawn, deerHuman } from './deer.js';
import { dragonBeast, dragonLord } from './dragon.js';
import { foxCub, foxEvolved, foxHuman } from './fox.js';
import { lizardEvolved, lizardHatchling, lizardHuman } from './lizard.js';
import { otterEvolved, otterHuman, otterPup } from './otter.js';
import { turtleEvolved, turtleHatchling, turtleHuman } from './turtle.js';
import { wolfEvolved, wolfHuman, wolfPup } from './wolf.js';

const BUILDERS: Record<string, () => Blueprint> = {
  'fox-1': foxCub,
  'fox-2': foxEvolved,
  'fox-3': foxHuman,
  'bird-1': birdChick,
  'bird-2': birdEvolved,
  'bird-3': birdHuman,
  'otter-1': otterPup,
  'otter-2': otterEvolved,
  'otter-3': otterHuman,
  'turtle-1': turtleHatchling,
  'turtle-2': turtleEvolved,
  'turtle-3': turtleHuman,
  'bunny-1': bunnyKit,
  'bunny-2': bunnyEvolved,
  'bunny-3': bunnyHuman,
  'deer-1': deerFawn,
  'deer-2': deerEvolved,
  'deer-3': deerHuman,
  'cat-1': catKitten,
  'cat-2': catEvolved,
  'cat-3': catHuman,
  'wolf-1': wolfPup,
  'wolf-2': wolfEvolved,
  'wolf-3': wolfHuman,
  'bear-1': bearCub,
  'bear-2': bearEvolved,
  'bear-3': bearHuman,
  'lizard-1': lizardHatchling,
  'lizard-2': lizardEvolved,
  'lizard-3': lizardHuman,
  'dragon-1': dragonBeast,
  'dragon-2': dragonLord,
};

/** 每个造型的动作骨架与攻击样式。 */
export const PROFILES: Record<string, AnimProfile> = {
  'fox-1': { rig: 'quad', attack: 'bite' },
  'fox-2': { rig: 'quad', attack: 'pounce' },
  'fox-3': { rig: 'biped', attack: 'slash', armed: true },
  'bird-1': { rig: 'bird', attack: 'spit' },
  'bird-2': { rig: 'bird', attack: 'spit' },
  'bird-3': { rig: 'biped', attack: 'cast', armed: false },
  'otter-1': { rig: 'quad', attack: 'spit' },
  'otter-2': { rig: 'quad', attack: 'spit' },
  'otter-3': { rig: 'biped', attack: 'cast', armed: false },
  'turtle-1': { rig: 'quad', attack: 'bite', heft: 1.2 },
  'turtle-2': { rig: 'quad', attack: 'bite', heft: 1.4 },
  'turtle-3': { rig: 'biped', attack: 'thrust', armed: true, heft: 1.2 },
  'bunny-1': { rig: 'quad', attack: 'spit' },
  'bunny-2': { rig: 'quad', attack: 'spit' },
  'bunny-3': { rig: 'biped', attack: 'bow', armed: false },
  'deer-1': { rig: 'quad', attack: 'spit' },
  'deer-2': { rig: 'quad', attack: 'spit' },
  'deer-3': { rig: 'biped', attack: 'cast', armed: false },
  'cat-1': { rig: 'quad', attack: 'spit' },
  'cat-2': { rig: 'quad', attack: 'spit' },
  'cat-3': { rig: 'biped', attack: 'cast', armed: false },
  'wolf-1': { rig: 'quad', attack: 'bite' },
  'wolf-2': { rig: 'quad', attack: 'pounce' },
  'wolf-3': { rig: 'biped', attack: 'punch', armed: false },
  'bear-1': { rig: 'quad', attack: 'bite', heft: 1.2 },
  'bear-2': { rig: 'quad', attack: 'pounce', heft: 1.5 },
  'bear-3': { rig: 'biped', attack: 'smash', armed: true, heft: 1.3 },
  'lizard-1': { rig: 'quad', attack: 'spit' },
  'lizard-2': { rig: 'quad', attack: 'spit', heft: 1.2 },
  'lizard-3': { rig: 'biped', attack: 'cast', armed: false },
  'dragon-1': { rig: 'quad', attack: 'pounce', heft: 1.8 },
  'dragon-2': { rig: 'biped', attack: 'slash', armed: true, heft: 1.1 },
};

export function profileOf(id: string): AnimProfile {
  return PROFILES[id] ?? { rig: 'quad', attack: 'bite' };
}

const cache = new Map<string, Blueprint>();

/** 细节档：hi 展示用（特写、图鉴、进化演出），lo 战斗用（同屏最多 20 只）。 */
export type Lod = 'hi' | 'lo';

export function blueprint(id: string, lod: Lod = 'hi'): Blueprint {
  const key = `${id}@${lod}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const build = BUILDERS[id];
  if (!build) throw new Error(`没有这个造型：${id}`);
  const bp = withDetail(lod === 'hi' ? 1 : 0.5, build);
  cache.set(key, bp);
  return bp;
}

export function hasBlueprint(id: string): boolean {
  return id in BUILDERS;
}

export function blueprintIds(): string[] {
  return Object.keys(BUILDERS);
}
