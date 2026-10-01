// 木系 · 兔：叶耳兔（幼年）→ 青叶兔（进化）→ 森语（人形态）。
import * as THREE from 'three';
import { ellipsoid, extrude, leafShape, place, tube, type V3 } from '../kit/geo.js';
import { flower } from '../kit/extras.js';
import { animalEars, humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint, BlueprintBuilder } from '../kit/rig.js';
import { bow } from '../kit/weapons.js';

const WHITE = 0xfbfaf2;
const LEAF = 0x5ac05a;
const LEAF_LIGHT = 0xb8f07a;
const PINK = 0xff9ab0;

/** 叶片形的长耳朵：白色耳根渐变成嫩绿叶尖，中间一道叶脉。 */
function leafEars(b: BlueprintBuilder, size: number, s: number): void {
  const X = (v: number) => v * s;
  const w = size * 0.42;
  const h = size * 1.9;
  const ear = extrude(leafShape(w, h, 0.62), X(0.024));
  const style = { color: (p: THREE.Vector3) => mix(WHITE, LEAF, smooth(h * 0.25, h * 0.6, p.y)) };
  b.pair('earL', 'earR', place(ear, [0, 0, 0], [-0.15, 0, -0.14]), style);
  const vein = tube(
    [
      [0, h * 0.2, X(0.014)],
      [0, h * 0.55, X(0.016)],
      [0, h * 0.9, X(0.012)],
    ],
    { radius: X(0.004), radial: 5, segments: 10 },
  );
  b.pair('earL', 'earR', place(vein, [0, 0, 0], [-0.15, 0, -0.14]), {
    color: LEAF_LIGHT,
    glow: 0.4,
    line: 0,
  });
}

/** 叶耳兔：白绒绒的小兔，长着两片叶子耳朵，头顶一朵小花。 */
export function bunnyKit(): Blueprint {
  const q = quadruped({
    id: 'bunny-1',
    body: { length: 0.12, radius: 0.105 },
    legs: { height: 0.06, radius: 0.03, paw: WHITE },
    head: { radius: 0.13, width: 1.08, lift: 0.1 },
    snout: { length: 0.02, radius: 0.045, color: WHITE, nose: PINK },
    ears: { kind: 'none', size: 0 },
    coat: WHITE,
    under: 0xffffff,
    tail: { kind: 'stub', size: 0.9, color: 0xffffff },
    eyes: { iris: 0x1a4a1a, glow: 0x8aff8a, size: 1.1 },
  });
  const { b } = q;
  leafEars(b, 0.16, 1);
  flower(b, 'head', [0.05, 0.12, 0.05], 0.035, PINK, 0xffe27a, [0.3, 0, -0.3]);
  return b.build();
}

/** 青叶兔：脖子一圈叶片鬃毛，尾巴是一簇叶子，耳朵更长。 */
export function bunnyEvolved(): Blueprint {
  const q = quadruped({
    id: 'bunny-2',
    scale: 1.45,
    body: { length: 0.16, radius: 0.09 },
    legs: { height: 0.11, radius: 0.028, jointed: true, paw: 0xe8f4d8 },
    head: { radius: 0.105, width: 1.05, lift: 0.2 },
    snout: { length: 0.03, radius: 0.04, color: WHITE, nose: PINK },
    ears: { kind: 'none', size: 0 },
    coat: 0xeef6e0,
    under: 0xffffff,
    tail: { kind: 'stub', size: 0.6, color: 0xffffff },
    eyes: { iris: 0x14401a, glow: 0x9aff7a, style: 'fierce' },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  leafEars(b, 0.2 * 0.72, s);
  for (let i = 0; i < 9; i++) {
    const a = (i / 8 - 0.5) * 3.2;
    const leaf = extrude(leafShape(X(0.035), X(0.08), 0.6), X(0.008));
    b.part(
      'neck',
      place(
        leaf,
        [Math.sin(a) * X(0.05), X(-0.01) + Math.cos(a) * X(0.03), X(0.0)],
        [-1.3 + Math.cos(a) * 0.3, a * 0.6, -a * 0.55],
      ),
      {
        color: (p) => mix(LEAF, LEAF_LIGHT, smooth(0, X(0.07), p.y)),
      },
    );
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 4 - 0.5) * 1.8;
    const leaf = extrude(leafShape(X(0.03), X(0.07), 0.6), X(0.008));
    b.part('tail1', place(leaf, [0, X(0.02), X(-0.02)], [-0.6, a, 0]), {
      color: (p) => mix(LEAF, LEAF_LIGHT, smooth(0, X(0.06), p.y)),
    });
  }
  return b.build();
}

/**
 * 森语：兔耳弓箭手。嫩绿长发、白色兔耳、叶片披风，短裙与护腿，
 * 左手藤蔓长弓，身后一圈花叶光环，身边飘着叶片。
 */
export function bunnyHuman(): Blueprint {
  const f = humanoid({
    id: 'bunny-3',
    sex: 'f',
    skin: 0xffeadf,
    eyes: { iris: 0x2a8a3a, glow: 0xb8ff8a, style: 'sharp' },
    hair: {
      style: 'ponytail',
      color: 0x6ac86a,
      tip: 0xdfffb8,
      tipFrom: 0.55,
      bangs: 9,
      length: 0.55,
      tie: 0xffd05a,
      seed: 17,
    },
    hairBones: 2,
    tailBones: 1,
    outfit: {
      suit: 0x2a6a3a,
      legs: 0x3a2a1e,
      dress: { color: 0x3a8a4a, trim: 0xffd05a, length: 0.2, flare: 0.9 },
      cape: { color: 0x2f7a3a, lining: 0x1a4a22, trim: 0xffd05a, length: 0.78, width: 0.95 },
      gloves: { color: 0x5a3a24, length: 0.45 },
      boots: { color: 0x5a3a24, height: 1.1, trim: 0xffd05a },
      belt: 0x5a3a24,
      gold: 0xffd05a,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  animalEars(f, 'bunny', WHITE, 0xffd0dc, LEAF, 1.1);
  // 绒球尾巴
  b.part('tail1', place(ellipsoid(X(0.045), X(0.045), X(0.04), 16, 12), [0, X(0.02), X(0.02)]), {
    color: 0xffffff,
  });
  // 披风上的叶片肩饰
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const leaf = extrude(leafShape(X(0.05), X(0.12), 0.6), X(0.01));
      b.part(
        'chest',
        place(
          leaf,
          [side * X(0.13 + i * 0.02), X(0.14 - i * 0.02), X(-0.02)],
          [-0.3, 0, side * (-1.2 - i * 0.25)],
        ),
        {
          color: (p) => mix(LEAF, LEAF_LIGHT, smooth(0, X(0.1), p.y)),
        },
      );
    }
  }
  flower(b, 'head', [X(0.08), X(0.2), X(0.05)], X(0.03), PINK, 0xffe27a, [0.2, 0, -0.5]);
  bow(b, 'offgrip', s * 1.5, { main: 0x5a8a2a, accent: 0xffd05a, glow: 0xb8ff8a });
  // 背后箭袋
  b.part(
    'chest',
    place(
      new THREE.CylinderGeometry(X(0.035), X(0.03), X(0.28), 12, 1),
      [X(0.06), X(0.06), X(-0.12)],
      [0.2, 0, -0.5],
    ),
    { color: 0x5a3a24 },
  );
  for (let i = 0; i < 3; i++) {
    const tipPos: V3 = [X(0.12 + i * 0.012), X(0.22 + i * 0.01), X(-0.16)];
    b.part(
      'chest',
      place(extrude(leafShape(X(0.025), X(0.05), 0.6), X(0.006)), tipPos, [0.2, 0, -0.5]),
      { color: LEAF_LIGHT, glow: 0.5 },
    );
  }
  b.attach('halo', 'chest', [0, X(0.2), X(-0.22)], {
    radius: X(0.36),
    style: 'petal',
    color: LEAF_LIGHT,
    accent: PINK,
    count: 16,
    spin: 0.25,
  });
  b.attach('orbit', 'root', [0, X(0.9), 0], {
    kind: 'crystal',
    count: 3,
    radius: X(0.55),
    size: X(0.028),
    color: 0xb8ff7a,
    speed: 1.3,
  });
  return b.build();
}
