// 木系 · 鹿：芽芽鹿（幼年）→ 花角鹿（进化）→ 花神（人形态）。
import * as THREE from 'three';
import { ellipsoid, place, tube, type V3 } from '../kit/geo.js';
import { antlers, flower } from '../kit/extras.js';
import { humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';
import { staff } from '../kit/weapons.js';

const FAWN = 0xd89a5a;
const CREAM = 0xfff2dc;
const SPROUT = 0x7ad06a;
const BLOSSOM = 0xff9ac8;

/** 鹿斑：背上几块浅色圆斑。 */
function spots(base: THREE.ColorRepresentation, spot: THREE.ColorRepresentation, scale: number) {
  const c0 = new THREE.Color(base);
  const c1 = new THREE.Color(spot);
  const pts: Array<[number, number]> = [
    [0.05, 0.05],
    [-0.05, 0.06],
    [0.07, -0.05],
    [-0.06, -0.07],
    [0.0, -0.12],
    [0.02, 0.13],
  ];
  return (p: THREE.Vector3) => {
    if (p.y < 0.02 * scale) return c0.clone();
    let k = 0;
    for (const [x, z] of pts) {
      const d = Math.hypot(Math.abs(p.x) - Math.abs(x) * scale, p.z - z * scale);
      k = Math.max(k, 1 - smooth(0.012 * scale, 0.02 * scale, d));
    }
    return c0.clone().lerp(c1, k);
  };
}

/** 芽芽鹿：细长腿的小鹿，额头冒出两根带叶的嫩芽。 */
export function deerFawn(): Blueprint {
  const q = quadruped({
    id: 'deer-1',
    body: { length: 0.18, radius: 0.085 },
    legs: { height: 0.17, radius: 0.022, jointed: true, paw: 0x5a3a24 },
    head: { radius: 0.11, width: 1.05, lift: 0.2 },
    snout: { length: 0.04, radius: 0.04, color: CREAM, nose: 0x3a2020 },
    ears: { kind: 'fox', size: 0.1, color: FAWN, inner: 0xffd8c0, spread: 0.8 },
    coat: FAWN,
    under: CREAM,
    tail: { kind: 'stub', size: 0.55, color: 0xffffff },
    eyes: { iris: 0x3a200a, glow: 0x9aff7a, size: 1.1 },
  });
  const { b } = q;
  b.part('body', ellipsoid(0.088, 0.086, 0.14, 40, 28), { color: spots(FAWN, CREAM, 1) });
  for (const side of [1, -1]) {
    const root: V3 = [side * 0.04, 0.08, 0.02];
    b.part(
      'head',
      tube([root, [side * 0.05, 0.13, 0.0], [side * 0.06, 0.16, -0.02]], {
        radius: (t) => 0.008 * (1 - t * 0.5),
        radial: 6,
        segments: 8,
      }),
      {
        color: SPROUT,
      },
    );
    flower(
      b,
      'head',
      [side * 0.06, 0.165, -0.02],
      0.022,
      SPROUT,
      0xd8ff9a,
      [0.4, 0, side * -0.4],
      2,
    );
  }
  return b.build();
}

/** 花角鹿：分叉的鹿角上开满粉花，脖子一圈嫩叶。 */
export function deerEvolved(): Blueprint {
  const q = quadruped({
    id: 'deer-2',
    scale: 1.6,
    body: { length: 0.22, radius: 0.075 },
    legs: { height: 0.24, radius: 0.019, jointed: true, paw: 0x4a2e1c },
    head: { radius: 0.085, width: 1.02, lift: 0.3, forward: 0.1 },
    snout: { length: 0.06, radius: 0.034, color: CREAM, nose: 0x2a1a1a },
    ears: { kind: 'fox', size: 0.085, color: 0xc8864a, inner: 0xffd8c0, spread: 0.85 },
    coat: 0xc8864a,
    under: CREAM,
    tail: { kind: 'stub', size: 0.5, color: 0xffffff },
    eyes: { iris: 0x2a1808, glow: 0xb8ff8a },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  b.part('body', ellipsoid(X(0.077), X(0.076), X(0.16), 40, 28), {
    color: spots(0xc8864a, CREAM, s),
  });
  for (const side of [1, -1]) {
    const tips = antlers(
      b,
      'head',
      [side * X(0.035), X(0.06), X(0.0)],
      X(0.16),
      0x8a6a4a,
      SPROUT,
      3,
      side,
    );
    tips.forEach((tip, i) =>
      flower(b, 'head', tip, X(0.022), i % 2 ? 0xffffff : BLOSSOM, 0xffe27a, [0.2, 0, side * -0.3]),
    );
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 2.6;
    b.part(
      'neck',
      place(
        ellipsoid(X(0.02), X(0.04), X(0.008), 10, 8),
        [Math.sin(a) * X(0.05), X(0.01), Math.cos(a) * X(0.04)],
        [-0.8, a, 0],
      ),
      {
        color: SPROUT,
      },
    );
  }
  return b.build();
}

/**
 * 花神：鹿角上开满花的女神。粉紫长发、淡绿长裙与粉色披肩，手持开花的枝杖，
 * 身后花瓣光环，身边花瓣环绕。
 */
export function deerHuman(): Blueprint {
  const f = humanoid({
    id: 'deer-3',
    sex: 'f',
    height: 1.66,
    skin: 0xffede4,
    eyes: { iris: 0xd0508a, glow: 0xb8ffb0, style: 'anime' },
    hair: {
      style: 'long',
      color: 0xf0a8d0,
      tip: 0xfff0f8,
      tipFrom: 0.55,
      bangs: 9,
      length: 0.72,
      seed: 21,
    },
    hairBones: 3,
    outfit: {
      suit: 0x4a8a5a,
      legs: 0xf0f8e8,
      dress: { color: 0x9ad88a, trim: 0xffe8a0, length: 0.78, flare: 1.35 },
      coat: {
        color: 0xf8c8dc,
        lining: 0xffe8f0,
        trim: 0xffe8a0,
        length: 0.3,
        open: 1.5,
        sleeves: 'wide',
        highCollar: false,
        gem: 0x9aff8a,
      },
      boots: { color: 0x8a6a4a, height: 0.4, trim: 0xffe8a0 },
      belt: 0x5a9a4a,
      sash: 0xf8c8dc,
      gold: 0xffe8a0,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  // 鹿角与花
  for (const side of [1, -1]) {
    const root: V3 = [side * X(0.055), X(0.22), X(-0.01)];
    const tips = antlers(b, 'head', root, X(0.2), 0xa07a52, 0xd8ffb0, 3, side);
    tips.forEach((tip, i) =>
      flower(b, 'head', tip, X(0.026), i % 2 ? 0xffffff : BLOSSOM, 0xffe27a, [0.2, 0, side * -0.3]),
    );
  }
  // 小鹿耳
  for (const side of [1, -1]) {
    b.part(
      'head',
      place(
        ellipsoid(X(0.016), X(0.04), X(0.008), 12, 10),
        [side * X(0.105), X(0.15), X(0.0)],
        [0, 0, side * -1.1],
      ),
      { color: FAWN },
    );
  }
  flower(b, 'head', [X(-0.08), X(0.19), X(0.06)], X(0.03), BLOSSOM, 0xffe27a, [0.3, 0, 0.6]);
  const top = staff(b, 'grip', s, { main: 0x8a6a4a, accent: 0xffe8a0 }, 1.1);
  b.part(
    'grip',
    tube(
      [
        top,
        [top[0] + X(0.05), top[1] + X(0.06), top[2]],
        [top[0] + X(0.02), top[1] + X(0.12), top[2]],
      ],
      { radius: X(0.01), radial: 6, segments: 10 },
    ),
    {
      color: 0x8a6a4a,
    },
  );
  flower(
    b,
    'grip',
    [top[0] + X(0.02), top[1] + X(0.12), top[2]],
    X(0.05),
    BLOSSOM,
    0xfff27a,
    [0, 0, 0],
  );
  b.attach('halo', 'chest', [0, X(0.2), X(-0.2)], {
    radius: X(0.38),
    style: 'petal',
    color: BLOSSOM,
    accent: 0xffffff,
    count: 18,
    spin: 0.2,
  });
  b.attach('orbit', 'root', [0, X(0.9), 0], {
    kind: 'crystal',
    count: 5,
    radius: X(0.6),
    size: X(0.022),
    color: 0xffb0d8,
    speed: 0.7,
  });
  void mix;
  return b.build();
}
