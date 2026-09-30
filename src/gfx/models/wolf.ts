// 雷系 · 狼：雷牙狼崽（幼年）→ 迅雷狼（进化）→ 雷狼（人形态）。
import { ellipsoid, place, tube, type V3 } from '../kit/geo.js';
import { sparks } from '../kit/extras.js';
import { animalEars, fluffyTail, humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';
import { gauntlet } from '../kit/weapons.js';

const GREY = 0x8a9ab8;
const WHITE = 0xf2f6ff;
const BOLT = 0xffe45a;
const ICE = 0x7fd0ff;

/** 雷牙狼崽：灰蓝色的小狼，头顶和肩上冒着闪电形的毛。 */
export function wolfPup(): Blueprint {
  const q = quadruped({
    id: 'wolf-1',
    body: { length: 0.2, radius: 0.1 },
    legs: { height: 0.1, radius: 0.032, paw: 0x5a6a88 },
    head: { radius: 0.135, width: 1.06 },
    snout: { length: 0.05, radius: 0.05, color: WHITE, nose: 0x1a1a2a },
    ears: { kind: 'wolf', size: 0.13, color: GREY, inner: 0xd8e0f0, tip: 0x3a4a6a },
    coat: GREY,
    under: WHITE,
    tail: { kind: 'fluffy', size: 0.9, color: GREY, tip: WHITE },
    eyes: { iris: 0x0a2a4a, glow: ICE, size: 1.05 },
  });
  const { b } = q;
  sparks(b, 'head', [0, 0.12, 0.02], 0.06, BOLT, 2);
  sparks(b, 'chest', [0, 0.08, -0.02], 0.05, BOLT, 3);
  return b.build();
}

/** 迅雷狼：修长的狼，脖颈到背脊一排电光鬃毛，腿上蓝色电纹。 */
export function wolfEvolved(): Blueprint {
  const q = quadruped({
    id: 'wolf-2',
    scale: 1.55,
    body: { length: 0.27, radius: 0.088 },
    legs: { height: 0.19, radius: 0.026, jointed: true, paw: 0x3a4a6a },
    head: { radius: 0.1, width: 1.02, lift: 0.1, forward: 0.12 },
    snout: { length: 0.085, radius: 0.042, color: WHITE, nose: 0x101018 },
    ears: {
      kind: 'wolf',
      size: 0.12,
      color: 0x6a7a9a,
      inner: 0xd8e0f0,
      tip: 0x2a3a5a,
      spread: 0.55,
    },
    coat: 0x6a7a9a,
    under: WHITE,
    tail: { kind: 'fluffy', size: 1.1, color: 0x6a7a9a, tip: ICE, up: 0.8 },
    eyes: { iris: 0x0a1a3a, glow: 0x9ae8ff, style: 'fierce', tilt: 0.12 },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  for (let i = 0; i < 5; i++)
    sparks(b, 'body', [0, X(0.08), X(0.12 - i * 0.07)], X(0.07), i % 2 ? ICE : BOLT, 1);
  sparks(b, 'neck', [0, X(0.07), X(-0.02)], X(0.08), BOLT, 3);
  return b.build();
}

/**
 * 雷狼：银发狼耳的拳斗士。藏青短外套配金边、长围巾、双手雷光拳套，
 * 身后雷电光环。
 */
export function wolfHuman(): Blueprint {
  const f = humanoid({
    id: 'wolf-3',
    sex: 'm',
    height: 1.78,
    build: 1.1,
    skin: 0xf8e2d4,
    eyes: { iris: 0x2a8ad8, glow: 0xbff0ff, style: 'sharp' },
    hair: { style: 'spiky', color: 0xe6ecf6, tip: 0x9ab8ff, bangs: 7, seed: 29 },
    tailBones: 3,
    outfit: {
      suit: 0x14182a,
      legs: 0x1e2438,
      coat: {
        color: 0x1e2a4a,
        lining: BOLT,
        trim: BOLT,
        length: 0.32,
        open: 0.8,
        sleeves: 'short',
        highCollar: true,
        slits: true,
        gem: ICE,
      },
      boots: { color: 0x2a3048, height: 0.8, trim: BOLT },
      belt: 0x3a2a1a,
      gold: BOLT,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  animalEars(f, 'wolf', 0xdfe6f2, 0x9aa8c8, 0x5a6a8a, 1.05);
  fluffyTail(f, ['tail1', 'tail2', 'tail3'], 0xc8d0e0, 0xffffff, 1.1, [
    [0, 0, 0],
    [0, X(-0.06), X(-0.12)],
    [0, X(-0.02), X(-0.28)],
    [0, X(0.1), X(-0.4)],
  ]);
  // 围巾：绕颈一圈，一端长长地飘在身后
  b.part('chest', place(ellipsoid(X(0.075), X(0.035), X(0.06), 20, 12), [0, X(0.16), X(-0.005)]), {
    color: 0xffd84a,
  });
  const scarf: V3[] = [
    [X(0.04), X(0.16), X(-0.05)],
    [X(0.07), X(0.1), X(-0.14)],
    [X(0.1), X(0.0), X(-0.22)],
    [X(0.12), X(-0.14), X(-0.28)],
  ];
  b.part(
    'chest',
    tube(scarf, { radius: X(0.028), flat: 2.4, radial: 8, segments: 22, up: [0, 0, 1] }),
    {
      color: (_p, t) => mix(0xffd84a, 0xff9a2a, smooth(0.6, 1, t)),
    },
  );
  // 脸上的伤疤与电纹
  b.part(
    'head',
    place(ellipsoid(X(0.02), X(0.003), X(0.004), 8, 4), [X(0.05), X(0.13), X(0.105)], [0, 0, 0.5]),
    { color: 0xd89a8a, line: 0 },
  );
  gauntlet(b, 'handR', s, { main: 0x2a3a5a, accent: BOLT, glow: BOLT });
  gauntlet(b, 'handL', s, { main: 0x2a3a5a, accent: BOLT, glow: BOLT });
  sparks(b, 'foreR', [0, X(-0.1), X(0.03)], X(0.07), BOLT, 2);
  sparks(b, 'foreL', [0, X(-0.1), X(0.03)], X(0.07), ICE, 2);
  b.attach('halo', 'chest', [0, X(0.22), X(-0.24)], {
    radius: X(0.4),
    style: 'bolt',
    color: BOLT,
    accent: ICE,
    count: 16,
    spin: 0.5,
  });
  return b.build();
}
