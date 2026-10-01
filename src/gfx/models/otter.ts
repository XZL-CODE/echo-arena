// 水系 · 獭：泡泡獭（幼年）→ 浪花獭（进化）→ 潮音（人形态）。
import * as THREE from 'three';
import { ellipsoid, place, tube, type V3 } from '../kit/geo.js';
import { humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';
import { staff } from '../kit/weapons.js';

const BROWN = 0x9a6a4c;
const CREAM = 0xfff0dc;
const AQUA = 0x39c6d8;
const DEEP = 0x1e7ab8;

/** 泡泡獭：抱着一个大泡泡的小水獭。 */
export function otterPup(): Blueprint {
  const q = quadruped({
    id: 'otter-1',
    body: { length: 0.22, radius: 0.1 },
    legs: { height: 0.07, radius: 0.03, paw: 0x6a4630 },
    head: { radius: 0.13, width: 1.1 },
    snout: { length: 0.035, radius: 0.055, color: CREAM, nose: 0x3a2a2a },
    ears: { kind: 'round', size: 0.07, color: BROWN, inner: 0xd8a888 },
    coat: BROWN,
    under: CREAM,
    tail: { kind: 'thick', size: 0.9, color: BROWN },
    eyes: { iris: 0x14304a, glow: 0x6ad8ff, size: 1.05 },
  });
  const { b } = q;
  // 胡须
  for (const side of [1, -1]) {
    for (const k of [-1, 1]) {
      b.part(
        'head',
        tube(
          [
            [side * 0.06, -0.05 + k * 0.008, 0.16],
            [side * 0.12, -0.05 + k * 0.02, 0.15],
            [side * 0.17, -0.055 + k * 0.035, 0.12],
          ],
          { radius: 0.0025, radial: 4, segments: 8 },
        ),
        { color: 0xffffff, line: 0 },
      );
    }
  }
  // 怀里的大泡泡
  b.glass(
    'chest',
    new THREE.SphereGeometry(0.075, 28, 18).translate(0, -0.02, 0.19),
    0x9fe8ff,
    0.32,
  );
  b.part('chest', place(ellipsoid(0.012, 0.012, 0.012, 8, 6), [-0.03, 0.02, 0.24]), {
    color: 0xffffff,
    glow: 1.5,
    line: 0,
  });
  return b.build();
}

/** 浪花獭：身边绕着一圈水环，尾巴尖是浪花的颜色。 */
export function otterEvolved(): Blueprint {
  const q = quadruped({
    id: 'otter-2',
    scale: 1.45,
    body: { length: 0.3, radius: 0.09 },
    legs: { height: 0.1, radius: 0.026, jointed: true, paw: 0x5a3a28 },
    head: { radius: 0.105, width: 1.08, lift: 0.1 },
    snout: { length: 0.05, radius: 0.045, color: CREAM, nose: 0x2a1e1e },
    ears: { kind: 'round', size: 0.05, color: 0x7a5440, inner: 0xd8a888 },
    coat: 0x7a5440,
    under: CREAM,
    tail: { kind: 'thick', size: 1.15, color: 0x7a5440, tip: AQUA },
    eyes: { iris: 0x0a2a4a, glow: 0x6ad8ff, style: 'fierce' },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  // 脖子上一圈水纹围巾
  b.part(
    'neck',
    place(
      new THREE.TorusGeometry(X(0.07), X(0.018), 10, 28),
      [0, X(0.0), X(0.02)],
      [Math.PI / 2 + 0.4, 0, 0],
    ),
    {
      color: (p) => mix(AQUA, 0xffffff, smooth(-0.01, 0.02, p.y) * 0.5),
      gloss: 1,
    },
  );
  // 浮在身边的水环（半透明）
  b.glass(
    'body',
    new THREE.TorusGeometry(X(0.2), X(0.022), 12, 48).rotateX(Math.PI / 2).translate(0, X(0.06), 0),
    0x7fe0ff,
    0.45,
  );
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.glass(
      'body',
      new THREE.SphereGeometry(X(0.025), 14, 10).translate(
        Math.cos(a) * X(0.2),
        X(0.1),
        Math.sin(a) * X(0.2),
      ),
      0x9fe8ff,
      0.45,
    );
  }
  return b.build();
}

/**
 * 潮音：水之歌姬。水蓝双马尾、白蓝长裙、半透明的水袖与飘带，手持珍珠法杖，
 * 身后一圈水泡光环。
 */
export function otterHuman(): Blueprint {
  const f = humanoid({
    id: 'otter-3',
    sex: 'f',
    skin: 0xffe9de,
    eyes: { iris: DEEP, glow: 0x7fe6ff, style: 'anime' },
    hair: {
      style: 'twintails',
      color: AQUA,
      tip: 0xc8f6ff,
      tipFrom: 0.6,
      bangs: 9,
      length: 0.62,
      tie: 0xffffff,
      seed: 5,
    },
    tailBones: 2,
    outfit: {
      suit: 0x2a5a9a,
      legs: 0xeaf6ff,
      dress: { color: 0x3ab0d8, trim: 0xffffff, length: 0.62, flare: 1.4 },
      coat: {
        color: 0xf2f8ff,
        lining: AQUA,
        trim: 0x8ad8ff,
        length: 0.2,
        open: 1.4,
        sleeves: 'wide',
        highCollar: false,
        gem: 0x7fe6ff,
      },
      boots: { color: 0xf2f8ff, height: 0.55, trim: 0x8ad8ff },
      belt: 0x1e7ab8,
      gold: 0xbff0ff,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  // 圆圆的獭耳
  for (const side of [1, -1]) {
    b.part(
      'head',
      place(
        ellipsoid(X(0.03), X(0.026), X(0.016), 16, 10),
        [side * X(0.085), X(0.23), X(-0.01)],
        [0, 0, -side * 0.5],
      ),
      { color: BROWN },
    );
    b.part(
      'head',
      place(
        ellipsoid(X(0.018), X(0.015), X(0.008), 12, 8),
        [side * X(0.085), X(0.23), X(0.004)],
        [0, 0, -side * 0.5],
      ),
      { color: 0xd8a888, line: 0.4 },
    );
  }
  // 獭尾
  b.chain(
    ['tail1', 'tail2'],
    tube(
      [
        [0, 0, 0],
        [0, X(-0.05), X(-0.12)],
        [0, X(-0.1), X(-0.25)],
      ],
      { radius: (t) => X(0.05) * (1 - t * 0.7) + X(0.005), radial: 12, segments: 16 },
    ),
    { color: (_p, t) => mix(BROWN, AQUA, smooth(0.6, 0.9, t)) },
  );
  // 头上的贝壳发饰
  b.part(
    'head',
    place(
      new THREE.SphereGeometry(X(0.03), 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1),
      [X(-0.07), X(0.22), X(0.05)],
      [0.6, 0, 0.4],
    ),
    {
      color: 0xffd8e8,
      gloss: 1,
    },
  );
  // 半透明的水飘带：从肩后绕到身前
  for (const side of [1, -1]) {
    const pts: V3[] = [
      [side * X(0.12), X(0.14), X(-0.08)],
      [side * X(0.3), X(0.0), X(-0.12)],
      [side * X(0.34), X(-0.25), X(0.02)],
      [side * X(0.26), X(-0.45), X(0.12)],
    ];
    b.glass(
      'chest',
      tube(pts, { radius: X(0.022), flat: 3, radial: 8, segments: 28, up: [0, 0, 1] }),
      0x7fe0ff,
      0.5,
    );
  }
  const top = staff(b, 'grip', s, { main: 0xeaf6ff, accent: 0x7fd0ff }, 1.05);
  b.attach('orb', 'grip', [top[0], top[1] + X(0.03), top[2]], { size: X(0.045), color: 0xbff4ff });
  b.attach('halo', 'chest', [0, X(0.2), X(-0.2)], {
    radius: X(0.36),
    style: 'bubble',
    color: 0x7fe6ff,
    accent: 0xffffff,
    count: 18,
    spin: 0.3,
  });
  b.attach('orbit', 'root', [0, X(0.95), 0], {
    kind: 'orb',
    count: 4,
    radius: X(0.55),
    size: X(0.03),
    color: 0x9fefff,
    speed: 0.9,
  });
  return b.build();
}
