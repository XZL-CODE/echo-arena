// 雷系 · 猫：电团猫（幼年）→ 雷纹猫（进化）→ 雷音（人形态）。
import * as THREE from 'three';
import { ellipsoid, place, tube } from '../kit/geo.js';
import { boltTail, sparks } from '../kit/extras.js';
import { animalEars, humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';

const YELLOW = 0xffd23a;
const CREAM = 0xfff6dc;
const BLUE = 0x4ab8ff;
const VIOLET = 0x7a4ad8;

/** 电团猫：毛茸茸的黄色小猫，闪电形尾巴，脸颊冒电火花。 */
export function catKitten(): Blueprint {
  const q = quadruped({
    id: 'cat-1',
    body: { length: 0.16, radius: 0.1 },
    legs: { height: 0.07, radius: 0.03, paw: CREAM },
    head: { radius: 0.14, width: 1.12 },
    snout: { length: 0.018, radius: 0.045, color: CREAM, nose: 0xff8aa0 },
    ears: { kind: 'cat', size: 0.11, color: YELLOW, inner: 0xffc8a0, tip: 0x3a2a4a },
    coat: YELLOW,
    under: CREAM,
    tail: { kind: 'none', size: 0 },
    eyes: { iris: 0x0a2a5a, glow: 0x7fd8ff, size: 1.12 },
  });
  const { b } = q;
  b.bone('tail1', 'hips', [0, 0.04, -0.08]).bone('tail2', 'tail1', [0, 0.08, -0.05]);
  boltTail(b, ['tail1', 'tail2'], 0.22, YELLOW, BLUE, 0.02);
  // 头顶一撮翘起的绒毛与脸颊电火花
  b.part(
    'head',
    tube(
      [
        [0, 0.12, 0.02],
        [0.01, 0.17, 0.04],
        [0.04, 0.19, 0.02],
      ],
      { radius: (t) => 0.018 * (1 - t) + 0.002, radial: 8, segments: 10 },
    ),
    {
      color: YELLOW,
    },
  );
  for (const side of [1, -1]) sparks(b, 'head', [side * 0.14, -0.04, 0.04], 0.05, BLUE, 1);
  return b.build();
}

/** 雷纹猫：身形像猞猁，耳尖长簇毛，身上蓝色闪电纹。 */
export function catEvolved(): Blueprint {
  const stripes = (base: number, mark: number) => {
    const c0 = new THREE.Color(base);
    const c1 = new THREE.Color(mark);
    return (p: THREE.Vector3) => {
      const zig = Math.abs(((p.z * 18 + Math.abs(p.x) * 6) % 2) - 1);
      const band = p.y > 0.02 && zig < 0.18 ? 1 : 0;
      return c0.clone().lerp(c1, band);
    };
  };
  const q = quadruped({
    id: 'cat-2',
    scale: 1.45,
    body: { length: 0.24, radius: 0.085 },
    legs: { height: 0.16, radius: 0.024, jointed: true, paw: 0x2a2a48 },
    head: { radius: 0.105, width: 1.08, lift: 0.15, forward: 0.05 },
    snout: { length: 0.025, radius: 0.038, color: CREAM, nose: 0x2a1a2a },
    ears: { kind: 'cat', size: 0.1, color: 0xf8c832, inner: 0xffc8a0, tip: 0x1a1a3a },
    coat: 0xf8c832,
    under: CREAM,
    tail: { kind: 'none', size: 0 },
    eyes: { iris: 0x0a1a4a, glow: 0x7fe0ff, style: 'fierce', tilt: 0.1 },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  b.part('body', ellipsoid(X(0.087), X(0.085), X(0.19), 40, 28), {
    color: stripes(0xf8c832, 0x2a6ad8),
  });
  b.bone('tail1', 'hips', [0, X(0.03), X(-0.1)]).bone('tail2', 'tail1', [0, X(0.1), X(-0.06)]);
  boltTail(b, ['tail1', 'tail2'], X(0.28), 0xf8c832, BLUE, X(0.018));
  // 耳尖的长簇毛
  const tuft = () =>
    tube(
      [
        [0, X(0.085), 0],
        [0, X(0.12), X(-0.01)],
        [0, X(0.15), X(-0.02)],
      ],
      { radius: (t) => X(0.008) * (1 - t) + 0.001, radial: 5, segments: 6 },
    );
  b.part('earL', tuft(), { color: 0x1a1a3a });
  b.part('earR', tuft(), { color: 0x1a1a3a });
  // 颈后一圈电光鬃毛
  sparks(b, 'neck', [0, X(0.05), X(-0.03)], X(0.07), BLUE, 3);
  return b.build();
}

/**
 * 雷音：雷系猫耳魔导士。紫发金色发梢、紫黑长外套配金边、短裙长袜，
 * 身边漂浮着电球，身后雷电光环。
 */
export function catHuman(): Blueprint {
  const f = humanoid({
    id: 'cat-3',
    sex: 'f',
    skin: 0xffeadf,
    eyes: { iris: 0xd8a01a, glow: 0xfff07a, style: 'sharp' },
    hair: {
      style: 'long',
      color: VIOLET,
      tip: 0xffe45a,
      tipFrom: 0.62,
      bangs: 9,
      length: 0.5,
      ahoge: true,
      seed: 23,
    },
    hairBones: 3,
    tailBones: 2,
    outfit: {
      suit: 0x3a2a6a,
      legs: 0x1a1428,
      dress: { color: 0x6a3ad0, trim: 0xffd84a, length: 0.2, flare: 1 },
      coat: {
        color: 0x241a3e,
        lining: 0xffd84a,
        trim: 0xffd84a,
        length: 0.55,
        open: 1.1,
        sleeves: 'long',
        highCollar: true,
        slits: true,
        gem: 0x7fe0ff,
      },
      gloves: { color: 0x1a1428, length: 0.4 },
      boots: { color: 0x1a1428, height: 1.2, trim: 0xffd84a },
      belt: 0xffd84a,
      gold: 0xffd84a,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  animalEars(f, 'cat', VIOLET, 0xffd0e8, 0x1a1428, 1.05);
  b.chain(
    ['tail1', 'tail2'],
    tube(
      [
        [0, 0, 0],
        [0, X(-0.08), X(-0.12)],
        [X(0.05), X(-0.02), X(-0.26)],
        [X(0.08), X(0.12), X(-0.3)],
      ],
      { radius: (t) => X(0.022) * (1 - t * 0.4), radial: 10, segments: 24 },
    ),
    { color: (_p, t) => mix(VIOLET, 0xffe45a, smooth(0.8, 0.95, t)) },
  );
  // 铃铛项圈
  b.part('neck', place(ellipsoid(X(0.018), X(0.018), X(0.018), 12, 10), [0, X(0.0), X(0.045)]), {
    color: 0xffd84a,
    gloss: 1,
    glow: 0.2,
  });
  // 发间闪电发夹
  sparks(b, 'head', [X(-0.08), X(0.2), X(0.07)], X(0.06), 0xffe45a, 1);
  b.attach('halo', 'chest', [0, X(0.22), X(-0.22)], {
    radius: X(0.38),
    style: 'bolt',
    color: 0xffe45a,
    accent: 0x9ad8ff,
    count: 14,
    spin: 0.4,
  });
  b.attach('orbit', 'root', [0, X(1.0), 0], {
    kind: 'orb',
    count: 3,
    radius: X(0.55),
    size: X(0.04),
    color: 0x9ae0ff,
    speed: 1.6,
  });
  return b.build();
}
