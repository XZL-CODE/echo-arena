// 岩系 · 蜥：晶晶蜥（幼年）→ 晶甲蜥（进化）→ 晶龙（人形态）。
import { ellipsoid, place, tube, type V3 } from '../kit/geo.js';
import { crystals } from '../kit/extras.js';
import { horns, humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';
import { staff } from '../kit/weapons.js';

const GREEN = 0x5ab87a;
const PALE = 0xfff2c0;
const PINK = 0xff7ad0;
const VIOLET = 0xb088ff;
const GOLD = 0xffc84e;

/** 晶晶蜥：绿色的小蜥蜴，背脊一排粉紫色小水晶。 */
export function lizardHatchling(): Blueprint {
  const q = quadruped({
    id: 'lizard-1',
    body: { length: 0.22, radius: 0.085 },
    legs: { height: 0.05, radius: 0.028, paw: 0x3a8a5a },
    head: { radius: 0.12, width: 1.12, forward: 0.1 },
    snout: { length: 0.05, radius: 0.055, color: 0x7ad09a, nose: 0x2a4a3a },
    ears: { kind: 'fin', size: 0.08, color: GREEN, tip: PINK, spread: 0.7 },
    coat: GREEN,
    under: PALE,
    tail: { kind: 'thick', size: 1.1, color: GREEN, tip: 0x3a8a5a },
    eyes: { iris: 0x2a0a3a, glow: PINK, size: 1.05 },
    mouth: 'smile',
  });
  const { b } = q;
  for (let i = 0; i < 4; i++)
    crystals(
      b,
      'body',
      [0, 0.07, 0.08 - i * 0.055],
      0.035 - i * 0.004,
      i % 2 ? VIOLET : PINK,
      1,
      0.2,
      i + 1,
      1,
    );
  crystals(b, 'tail1', [0, 0.03, -0.03], 0.025, PINK, 1, 0.2, 7, 1);
  return b.build();
}

/** 晶甲蜥：背上长满大块紫晶，头上一对晶角，尾巴末端是晶锤。 */
export function lizardEvolved(): Blueprint {
  const q = quadruped({
    id: 'lizard-2',
    scale: 1.6,
    body: { length: 0.3, radius: 0.08 },
    legs: { height: 0.07, radius: 0.03, jointed: true, paw: 0x2a6a4a },
    head: { radius: 0.095, width: 1.1, forward: 0.2, lift: -0.1 },
    snout: { length: 0.08, radius: 0.045, color: 0x6ac08a, nose: 0x1a3a2a },
    ears: { kind: 'fin', size: 0.07, color: 0x3a9a6a, tip: VIOLET, spread: 0.7 },
    coat: 0x3a9a6a,
    under: PALE,
    tail: { kind: 'thick', size: 1.4, color: 0x3a9a6a, tip: 0x1a5a3a },
    eyes: { iris: 0x1a0a2a, glow: VIOLET, style: 'fierce', tilt: 0.12 },
    mouth: 'smile',
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  for (let i = 0; i < 5; i++)
    crystals(
      b,
      'body',
      [0, X(0.065), X(0.12 - i * 0.06)],
      X(0.06 - i * 0.004),
      i % 2 ? PINK : VIOLET,
      2,
      0.5,
      i + 3,
      1.1,
    );
  for (const side of [1, -1]) {
    b.part(
      'head',
      tube(
        [
          [side * X(0.04), X(0.07), X(-0.01)],
          [side * X(0.06), X(0.12), X(-0.05)],
          [side * X(0.05), X(0.15), X(-0.1)],
        ],
        { radius: (t) => X(0.012) * (1 - t) + 0.001, radial: 6, segments: 10 },
      ),
      {
        color: (_p, t) => mix(0x3a2a4a, VIOLET, t),
        glow: 0.6,
      },
    );
  }
  crystals(b, 'tail3', [0, 0, X(-0.02)], X(0.05), PINK, 3, 0.8, 11, 1.2);
  return b.build();
}

/**
 * 晶龙：龙角晶术师。银紫长发、深紫长大衣与披风、金边与晶石胸针，龙尾末端长着晶簇，
 * 手持顶着巨大紫晶的法杖，身后晶石光环，身边漂浮着晶片。
 */
export function lizardHuman(): Blueprint {
  const f = humanoid({
    id: 'lizard-3',
    sex: 'm',
    height: 1.8,
    skin: 0xf6e4dc,
    eyes: { iris: 0x8a4ad8, glow: 0xe0b8ff, style: 'sharp' },
    hair: {
      style: 'long',
      color: 0xe8e0ff,
      tip: VIOLET,
      tipFrom: 0.5,
      bangs: 8,
      length: 0.6,
      seed: 37,
    },
    hairBones: 3,
    tailBones: 3,
    outfit: {
      suit: 0x2a1e3a,
      legs: 0x1e1628,
      coat: {
        color: 0x2e2244,
        lining: VIOLET,
        trim: GOLD,
        length: 0.85,
        open: 0.6,
        sleeves: 'long',
        highCollar: true,
        slits: true,
        pattern: (p) => mix(0x2e2244, 0x4a2a6a, smooth(-0.3, -0.8, p.y)),
        gem: PINK,
      },
      cape: { color: 0x3a2a5a, lining: 0x1a1030, trim: GOLD, length: 1.0, width: 1.0 },
      gloves: { color: 0x1e1628, length: 0.35 },
      boots: { color: 0x2a1e3a, height: 0.85, trim: GOLD },
      belt: GOLD,
      gold: GOLD,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  horns(f, 0x2a1e3a, VIOLET, 0.2, 1, GOLD);
  // 龙尾：粗壮、带鳞纹，末端晶簇
  const tail: V3[] = [
    [0, 0, 0],
    [0, X(-0.12), X(-0.14)],
    [X(0.05), X(-0.3), X(-0.3)],
    [X(0.12), X(-0.4), X(-0.52)],
  ];
  b.chain(
    ['tail1', 'tail2', 'tail3'],
    tube(tail, { radius: (t) => X(0.07) * (1 - t * 0.8) + X(0.008), radial: 12, segments: 30 }),
    {
      color: (_p, t) => mix(0x3a9a6a, 0x2a1e3a, smooth(0.2, 0.9, t)),
      gloss: 0.4,
    },
  );
  crystals(b, 'tail3', [X(0.1), X(-0.3), X(-0.3)], X(0.07), VIOLET, 3, 0.7, 13, 1.2);
  b.part(
    'head',
    place(ellipsoid(X(0.006), X(0.006), X(0.006), 8, 6), [X(0.09), X(0.08), X(0.06)]),
    { color: PINK, glow: 1.5, line: 0 },
  );
  const top = staff(b, 'grip', s, { main: 0x2a1e3a, accent: GOLD }, 1.15);
  crystals(b, 'grip', [top[0], top[1] - 0.02, top[2]], X(0.12), VIOLET, 3, 0.4, 17, 1.4);
  b.attach('halo', 'chest', [0, X(0.24), X(-0.26)], {
    radius: X(0.44),
    style: 'crystal',
    color: VIOLET,
    accent: PINK,
    count: 16,
    spin: 0.18,
  });
  b.attach('orbit', 'root', [0, X(1.05), 0], {
    kind: 'crystal',
    count: 4,
    radius: X(0.6),
    size: X(0.04),
    color: 0xd0a8ff,
    speed: 0.8,
  });
  return b.build();
}
