// 火系 · 狐：小焰狐（幼年）→ 焰尾狐（进化）→ 九焰（人形态）。
import { ellipsoid, extrude, flameShape, place, type V3 } from '../kit/geo.js';
import { animalEars, fluffyTail, humanoid } from '../kit/humanoid.js';
import { alongAxis, mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';
import { katana } from '../kit/weapons.js';

const ORANGE = 0xff8a3d;
const CREAM = 0xfff0d8;
const DARK = 0x5a2a22;
const FLAME_A = 0xffe27a;
const FLAME_B = 0xff6a1f;

/** 小焰狐：大脑袋、短腿、蓬松的火尖尾巴，额前一撮小火苗。 */
export function foxCub(): Blueprint {
  const q = quadruped({
    id: 'fox-1',
    body: { length: 0.2, radius: 0.105 },
    legs: { height: 0.12, radius: 0.034, paw: DARK },
    head: { radius: 0.15, width: 1.06 },
    snout: { length: 0.05, radius: 0.052, color: CREAM },
    ears: { kind: 'fox', size: 0.16, color: ORANGE, inner: 0xffcfbf, tip: DARK },
    coat: ORANGE,
    under: CREAM,
    tail: { kind: 'fluffy', size: 1, color: ORANGE, tip: CREAM },
    eyes: { iris: 0x7a3a10, glow: 0xffb13b, size: 1.05 },
  });
  const { b } = q;
  b.part(
    'head',
    place(extrude(flameShape(0.07, 0.1, 0.12), 0.022), [0, 0.12, 0.05], [-0.7, 0, 0]),
    {
      color: alongAxis('y', FLAME_B, FLAME_A, 0.0, 0.09),
      glow: 1.2,
      rim: 0.3,
    },
  );
  b.attach('flame', 'tail3', [0, 0.1, 0.02], { size: 0.1, color: FLAME_B, core: FLAME_A });
  return b.build();
}

/** 焰尾狐：身形舒展、三条火尾、脖子一圈火焰鬃毛，腿上深色“袜子”。 */
export function foxEvolved(): Blueprint {
  const q = quadruped({
    id: 'fox-2',
    scale: 1.42,
    body: { length: 0.26, radius: 0.095 },
    legs: { height: 0.2, radius: 0.028, jointed: true, paw: DARK },
    head: { radius: 0.125, width: 1.05, lift: 0.15, forward: 0.1 },
    snout: { length: 0.085, radius: 0.045, color: CREAM },
    ears: { kind: 'fox', size: 0.15, color: ORANGE, inner: 0xffcfbf, tip: DARK, spread: 0.55 },
    coat: ORANGE,
    under: CREAM,
    tail: { kind: 'fluffy', size: 1.05, color: ORANGE, tip: 0xffd27a, count: 3, up: 1.1 },
    eyes: { iris: 0x8a2a08, glow: 0xffa531, size: 0.95, tilt: 0.14 },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  // 火焰鬃毛：一圈往后飘的火苗
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 2.4;
    const flame = extrude(flameShape(X(0.05), X(0.085), 0.2), X(0.016));
    b.part(
      'neck',
      place(
        flame,
        [Math.sin(a) * X(0.05), X(0.04) + Math.cos(a) * X(0.02), X(-0.02)],
        [-1.1, a * 0.5, -a * 0.6],
      ),
      {
        color: alongAxis('y', FLAME_B, FLAME_A, 0.0, X(0.075)),
        glow: 1.1,
        rim: 0.3,
      },
    );
  }
  // 额头的火纹
  b.part(
    'head',
    place(
      extrude(flameShape(X(0.05), X(0.07), 0.05), X(0.012)),
      [0, X(0.075), X(0.085)],
      [-0.9, 0, 0],
    ),
    {
      color: alongAxis('y', FLAME_B, FLAME_A, 0, X(0.06)),
      glow: 1.3,
      rim: 0.2,
    },
  );
  for (let i = 0; i < 3; i++) {
    const fan = (i - 1) * 1;
    b.attach('flame', 'tail3', [fan * X(0.15), X(0.3 * 1.05 * 1.1) - X(0.2), X(0.02)], {
      size: X(0.085),
      color: FLAME_B,
      core: FLAME_A,
    });
  }
  return b.build();
}

/**
 * 九焰：狐耳剑姬。黑色长大衣（下摆渐变成赤红、金色镶边）、赤红短裙与腰带、过膝长靴，
 * 三条燃着火的大狐尾，身后一圈火焰光环，身边绕着三团狐火，手持焰刃。
 */
export function foxHuman(): Blueprint {
  const coatDark = 0x2a1e30;
  const crimson = 0xc0202c;
  const gold = 0xffc54a;
  const f = humanoid({
    id: 'fox-3',
    sex: 'f',
    skin: 0xffe9de,
    eyes: { iris: 0xe0541c, glow: 0xffc24a, style: 'sharp' },
    hair: {
      style: 'long',
      color: 0xff5a26,
      tip: 0xffe0a8,
      tipFrom: 0.5,
      bangs: 9,
      length: 0.62,
      seed: 3,
    },
    hairBones: 3,
    tailBones: 3,
    outfit: {
      suit: 0x8a1622,
      legs: 0x241a26,
      dress: { color: crimson, trim: gold, length: 0.2, flare: 0.8 },
      coat: {
        color: coatDark,
        lining: crimson,
        trim: gold,
        length: 0.66,
        open: 0.95,
        sleeves: 'wide',
        highCollar: false,
        slits: true,
        pattern: (p) => mix(coatDark, crimson, smooth(-0.3, -0.62, p.y)),
        gem: 0xff5a2a,
      },
      gloves: { color: 0x241a26, length: 0.3 },
      boots: { color: 0x2a1e2c, height: 1.3, trim: gold },
      belt: crimson,
      sash: crimson,
      gold,
    },
  });
  const { b, s: sc } = f;
  const X = (v: number) => v * sc;
  animalEars(f, 'fox', 0xff6a2a, 0xffe6d2, 0x3a1414, 1.15);
  const tails: V3[][] = [-1, 0, 1].map((fan) => [
    [0, 0, 0],
    [fan * X(0.07), X(0.0), X(-0.12)],
    [fan * X(0.2), X(0.12), X(-0.24)],
    [fan * X(0.3), X(0.32), X(-0.26)],
    [fan * X(0.33), X(0.48), X(-0.16)],
  ]);
  for (const curve of tails)
    fluffyTail(f, ['tail1', 'tail2', 'tail3'], 0xff7a33, 0xfff0d8, 1.25, curve);
  for (const curve of tails) {
    const tip = curve[4] as V3;
    b.attach('flame', 'tail1', [tip[0], tip[1] + X(0.05), tip[2]], {
      size: X(0.13),
      color: FLAME_B,
      core: FLAME_A,
    });
  }
  // 发间的红色发绳与金铃
  b.part(
    'head',
    place(ellipsoid(X(0.018), X(0.018), X(0.018), 12, 10), [X(0.085), X(0.2), X(-0.05)]),
    { color: gold, gloss: 1, glow: 0.3 },
  );
  katana(b, 'weapon', sc, { main: 0xfff3e6, accent: gold, glow: 0xff6a1f, grip: 0x5a1018 }, 0.78);
  b.attach('halo', 'chest', [0, X(0.2), X(-0.2)], {
    radius: X(0.36),
    style: 'flame',
    color: 0xff7a2a,
    accent: 0xffe27a,
    count: 14,
    spin: 0.35,
  });
  b.attach('orbit', 'root', [0, X(1.05), 0], {
    kind: 'flame',
    count: 3,
    radius: X(0.62),
    size: X(0.07),
    color: 0xff6a1f,
    core: 0xffe27a,
    speed: 1.1,
  });
  return b.build();
}
