// 水系 · 龟：盾盾龟（幼年）→ 潮甲龟（进化）→ 玄武（人形态）。
import * as THREE from 'three';
import { ellipsoid, place, tube, type V3 } from '../kit/geo.js';
import { crystals, turtleShell } from '../kit/extras.js';
import { horns, humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { quadruped } from '../kit/quadruped.js';
import type { Blueprint } from '../kit/rig.js';
import { shield, trident } from '../kit/weapons.js';

const SKIN = 0x6ad0b0;
const PLATE = 0x2a8a8a;
const SEAM = 0x1a4a58;
const RIM = 0xffe2a0;
const TEAL = 0x1e5a64;
const GOLD = 0xffc84e;

/** 盾盾龟：背着六角纹大龟壳的小龟。 */
export function turtleHatchling(): Blueprint {
  const q = quadruped({
    id: 'turtle-1',
    body: { length: 0.16, radius: 0.1 },
    legs: { height: 0.06, radius: 0.036, paw: 0x4ab090 },
    head: { radius: 0.12, width: 1.05, forward: 0.15 },
    snout: { length: 0.02, radius: 0.05, color: 0xbdf0dc, nose: 0x2a4a44 },
    ears: { kind: 'none', size: 0 },
    coat: SKIN,
    under: 0xfff2c8,
    tail: { kind: 'stub', size: 0.6, color: SKIN },
    eyes: { iris: 0x103a3a, glow: 0x7fffd8, size: 1.05 },
  });
  const { b } = q;
  turtleShell(b, 'body', [0, 0.02, -0.01], 0.155, 0.14, 0.18, PLATE, SEAM, RIM);
  return b.build();
}

/** 潮甲龟：壳上长着珊瑚，壳边一圈浪花。 */
export function turtleEvolved(): Blueprint {
  const q = quadruped({
    id: 'turtle-2',
    scale: 1.6,
    body: { length: 0.2, radius: 0.1 },
    legs: { height: 0.08, radius: 0.04, paw: 0x3a9a80 },
    head: { radius: 0.1, width: 1.05, forward: 0.3, lift: -0.1 },
    snout: { length: 0.03, radius: 0.045, color: 0xbdf0dc, nose: 0x1a3a34 },
    ears: { kind: 'none', size: 0 },
    coat: 0x4ab89a,
    under: 0xfff2c8,
    tail: { kind: 'stub', size: 0.7, color: 0x4ab89a },
    eyes: { iris: 0x0a2a2a, glow: 0x7fffd8, style: 'fierce' },
    blush: false,
  });
  const { b, s } = q;
  const X = (v: number) => v * s;
  turtleShell(b, 'body', [0, X(0.03), X(-0.01)], X(0.17), X(0.16), X(0.2), 0x1f6f7a, SEAM, RIM);
  // 壳顶的珊瑚枝
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const base: V3 = [Math.cos(a) * X(0.06), X(0.17), Math.sin(a) * X(0.07) - X(0.01)];
    const pts: V3[] = [
      base,
      [base[0] * 1.3, base[1] + X(0.06), base[2] * 1.3],
      [base[0] * 1.2, base[1] + X(0.1), base[2] * 1.5],
    ];
    b.part(
      'body',
      tube(pts, { radius: (t) => X(0.014) * (1 - t * 0.6), radial: 7, segments: 10 }),
      {
        color: (_p, t) => mix(0xff7a8a, 0xffd0a0, t),
        glow: 0.3,
      },
    );
  }
  crystals(b, 'body', [0, X(0.16), X(-0.08)], X(0.06), 0x7fe6ff, 3, 0.6, 4, 0.8);
  return b.build();
}

/**
 * 玄武：深青铠甲的骑士，背负龟甲，左臂龟壳大盾（盾面缠着一条青蛇），右手三叉戟，
 * 身后六角符文光环。
 */
export function turtleHuman(): Blueprint {
  const f = humanoid({
    id: 'turtle-3',
    sex: 'm',
    height: 1.84,
    build: 1.22,
    skin: 0xf6ddc8,
    eyes: { iris: 0x14807a, glow: 0x7fffe0, style: 'sharp' },
    hair: { style: 'short', color: 0x1e3a4a, tip: 0x2a8a8a, bangs: 7, seed: 13 },
    outfit: {
      suit: 0x1a2a3a,
      legs: 0x1a2432,
      chestplate: { color: TEAL, trim: GOLD },
      pauldrons: { color: TEAL, trim: GOLD, size: 1.4, spikes: false },
      cape: { color: 0x184850, lining: 0x0e2a30, trim: GOLD, length: 0.95, width: 1.1 },
      gloves: { color: 0x2a3a48, length: 0.5 },
      boots: { color: 0x2a3a48, height: 0.9, trim: GOLD },
      belt: 0x3a2a1a,
      gold: GOLD,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  // 额前的鳍形头冠
  horns(f, 0x2a8a8a, 0x9fffe8, 0.12, 0.6, GOLD);
  // 背后的龟甲
  turtleShell(b, 'chest', [0, X(0.02), X(-0.1)], X(0.2), X(0.24), X(0.12), PLATE, SEAM, GOLD);
  b.part('chest', place(ellipsoid(X(0.2), X(0.26), X(0.05), 24, 16), [0, X(0.02), X(-0.09)]), {
    color: SEAM,
  });
  // 左臂龟壳大盾 + 缠绕的青蛇
  shield(b, 'offgrip', s, { main: 0x2a8a8a, accent: GOLD }, 0.26);
  const snake: V3[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 3.2;
    snake.push([
      Math.cos(a) * X(0.18 - i * 0.004),
      Math.sin(a) * X(0.18 - i * 0.004),
      X(0.1 + Math.sin(i) * 0.01),
    ]);
  }
  b.part(
    'offgrip',
    tube(snake, { radius: (t) => X(0.016) * (1 - t * 0.6) + X(0.003), radial: 8, segments: 60 }),
    {
      color: (_p, t) => mix(0x2ad0a0, 0x1a6a5a, smooth(0, 1, t)),
      gloss: 0.6,
    },
  );
  trident(b, 'grip', s, { main: 0x2a3a48, accent: 0xbff4ff, glow: 0x7fffe8 });
  b.attach('halo', 'chest', [0, X(0.26), X(-0.3)], {
    radius: X(0.44),
    style: 'rune',
    color: 0x5affd8,
    accent: GOLD,
    count: 12,
    spin: 0.15,
  });
  void THREE;
  return b.build();
}
