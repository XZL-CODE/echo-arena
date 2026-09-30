// 岩系 · 熊：石头熊（幼年）→ 岩甲熊（进化）→ 岩王（人形态）。
import { ellipsoid, place } from '../kit/geo.js';
import { crystals, rockPlates } from '../kit/extras.js';
import { animalEars, humanoid } from '../kit/humanoid.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';
import { hammer } from '../kit/weapons.js';

const BROWN = 0x8a5a3a;
const TAN = 0xf0d0a0;
const STONE = 0x8a8a96;
const MAGMA = 0xff8a2a;
const GOLD = 0xffc84e;

/** 石头熊：圆滚滚的小熊，背上驮着一块石板。 */
export function bearCub(): Blueprint {
  const q = quadruped({
    id: 'bear-1',
    body: { length: 0.18, radius: 0.12 },
    legs: { height: 0.08, radius: 0.04, paw: 0x5a3a24 },
    head: { radius: 0.14, width: 1.08 },
    snout: { length: 0.04, radius: 0.06, color: TAN, nose: 0x2a1a14 },
    ears: { kind: 'round', size: 0.075, color: BROWN, inner: 0xd8a080 },
    coat: BROWN,
    under: TAN,
    tail: { kind: 'stub', size: 0.6, color: BROWN },
    eyes: { iris: 0x2a1408, glow: 0xffb04a, size: 1.02 },
  });
  const { b } = q;
  rockPlates(b, 'body', [0, 0.11, -0.01], 0.07, STONE, 3, 3);
  return b.build();
}

/** 岩甲熊：高大的熊，背与肩披着岩甲，缝隙透出熔岩光，肩头长着橙色晶簇。 */
export function bearEvolved(): Blueprint {
  const q = quadruped({
    id: 'bear-2',
    scale: 1.8,
    body: { length: 0.2, radius: 0.11 },
    legs: { height: 0.11, radius: 0.04, jointed: true, paw: 0x3a2618 },
    head: { radius: 0.105, width: 1.08, forward: 0.1 },
    snout: { length: 0.05, radius: 0.05, color: TAN, nose: 0x1a1210 },
    ears: { kind: 'round', size: 0.06, color: 0x6a4228, inner: 0xc88a68 },
    coat: 0x6a4228,
    under: 0xd8b088,
    tail: { kind: 'stub', size: 0.5, color: 0x6a4228 },
    eyes: { iris: 0x2a0a04, glow: MAGMA, style: 'fierce', tilt: 0.1 },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  rockPlates(b, 'body', [0, X(0.1), X(0.0)], X(0.07), 0x6a6a76, 5, 7);
  rockPlates(b, 'chest', [0, X(0.1), X(0.02)], X(0.05), 0x6a6a76, 3, 11);
  crystals(b, 'chest', [X(0.08), X(0.12), 0], X(0.06), MAGMA, 3, 0.6, 5, 1.2);
  crystals(b, 'chest', [X(-0.08), X(0.12), 0], X(0.05), MAGMA, 2, 0.6, 9, 1.2);
  b.part(
    'head',
    place(ellipsoid(X(0.05), X(0.018), X(0.04), 12, 8), [0, X(0.07), X(0.05)], [-0.4, 0, 0]),
    { color: 0x6a6a76 },
  );
  return b.build();
}

/**
 * 岩王：魁梧的熊耳战士。岩石胸甲与带尖刺的巨大肩甲、赤褐披风，
 * 双手握着石锤，身后熔岩晶环。
 */
export function bearHuman(): Blueprint {
  const f = humanoid({
    id: 'bear-3',
    sex: 'm',
    height: 1.95,
    build: 1.32,
    skin: 0xf0d2b8,
    eyes: { iris: 0xd87a1a, glow: 0xffc86a, style: 'sharp' },
    hair: { style: 'wild', color: 0x5a3422, tip: 0x8a5a3a, bangs: 7, seed: 31 },
    outfit: {
      suit: 0x3a2618,
      legs: 0x2a1c14,
      chestplate: { color: 0x6a6a76, trim: MAGMA },
      pauldrons: { color: 0x5a5a66, trim: GOLD, size: 1.7, spikes: true },
      cape: { color: 0x7a2a1a, lining: 0x3a140c, trim: GOLD, length: 0.9, width: 1.2 },
      gloves: { color: 0x4a3222, length: 0.55 },
      boots: { color: 0x4a3222, height: 0.85, trim: GOLD },
      belt: 0x5a3a24,
      gold: GOLD,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  animalEars(f, 'bear', 0x6a4228, 0xc88a68, undefined, 1.2);
  crystals(b, 'chest', [0, X(0.05), X(0.13)], X(0.05), MAGMA, 1, 0.1, 3, 1.4);
  hammer(b, 'grip', s * 1.5, { main: 0x7a7a86, accent: GOLD, glow: MAGMA, grip: 0x4a2e1c });
  crystals(b, 'grip', [0, X(0.62), 0], X(0.06), MAGMA, 3, 0.8, 7, 1.3);
  b.attach('halo', 'chest', [0, X(0.26), X(-0.3)], {
    radius: X(0.46),
    style: 'crystal',
    color: MAGMA,
    accent: 0xffe0a0,
    count: 14,
    spin: 0.12,
  });
  return b.build();
}
