// 火系 · 雀：火团雀（幼年）→ 炎翎鸟（进化）→ 朱雀（人形态）。
import { ellipsoid, place, tube, type V3 } from '../kit/geo.js';
import { bird } from '../kit/bird.js';
import { featherWings } from '../kit/extras.js';
import { humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import type { Blueprint } from '../kit/rig.js';
import { staff } from '../kit/weapons.js';

const RED = 0xff4a36;
const CRIMSON = 0xd8262e;
const GOLD = 0xffc84e;
const FLAME = 0xffe27a;

/** 火团雀：圆滚滚的小火球，头顶三根火焰羽冠。 */
export function birdChick(): Blueprint {
  const { b } = bird({
    id: 'bird-1',
    body: { radius: 0.13, length: 0.06 },
    neck: 0.02,
    head: 0.105,
    legs: 0.045,
    plumage: RED,
    belly: 0xffe0a0,
    wing: { color: RED, tip: 0xff9a3a, span: 0.12, feathers: 4 },
    tail: { color: 0xff7a2a, tip: FLAME, length: 0.1, plumes: 3 },
    crest: { color: 0xff8a2a, tip: FLAME, length: 0.1, count: 3 },
    beak: 0xffb03a,
    eyes: { iris: 0x5a1a08, glow: 0xffa531 },
  });
  b.attach('flame', 'head', [0, 0.16, -0.02], { size: 0.06, color: 0xff6a1f, core: FLAME });
  return b.build();
}

/** 炎翎鸟：修长的火鸟，长尾羽燃着火，大翅膀展开时金光闪闪。 */
export function birdEvolved(): Blueprint {
  const { b, s } = bird({
    id: 'bird-2',
    scale: 1.4,
    body: { radius: 0.1, length: 0.2 },
    neck: 0.12,
    head: 0.075,
    legs: 0.19,
    plumage: CRIMSON,
    belly: GOLD,
    wing: { color: CRIMSON, tip: GOLD, span: 0.34, feathers: 7 },
    tail: { color: 0xff5a2a, tip: FLAME, length: 0.5, plumes: 5 },
    crest: { color: 0xff7a2a, tip: FLAME, length: 0.2, count: 4 },
    beak: GOLD,
    eyes: { iris: 0x7a1a08, glow: 0xffb13b, style: 'fierce' },
  });
  const X = (v: number) => v * s;
  for (const k of [-1, 0, 1]) {
    b.attach('flame', 'tail2', [k * X(0.18), -X(0.06), -X(0.3)], {
      size: X(0.07),
      color: 0xff5a1f,
      core: FLAME,
    });
  }
  return b.build();
}

/**
 * 朱雀：火羽法师。赤红金边长袍、立领、金色羽饰发冠，背后一对燃烧的羽翼，
 * 手持顶着火球的金杖，身后一轮金色日轮。
 */
export function birdHuman(): Blueprint {
  const f = humanoid({
    id: 'bird-3',
    sex: 'm',
    height: 1.76,
    skin: 0xffe6d8,
    eyes: { iris: 0xd87a14, glow: 0xffd65a, style: 'sharp' },
    hair: {
      style: 'long',
      color: CRIMSON,
      tip: GOLD,
      tipFrom: 0.55,
      bangs: 8,
      length: 0.5,
      seed: 11,
    },
    hairBones: 3,
    wings: true,
    outfit: {
      suit: 0x6a1420,
      legs: 0x2a1418,
      coat: {
        color: CRIMSON,
        lining: GOLD,
        trim: GOLD,
        length: 0.92,
        open: 0.55,
        sleeves: 'wide',
        highCollar: true,
        pattern: (p) => mix(CRIMSON, 0x8a1020, smooth(-0.4, -0.9, p.y)),
        gem: 0xffb13b,
      },
      boots: { color: 0x3a1a1a, height: 0.85, trim: GOLD },
      gloves: { color: 0x3a1a1a, length: 0.25 },
      belt: GOLD,
      sash: 0xff8a2a,
      gold: GOLD,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  // 发冠：几根向后翘的金羽
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.28;
    const base: V3 = [Math.sin(a) * X(0.07), X(0.23), X(-0.02) + Math.cos(a) * X(0.02)];
    b.part(
      'head',
      tube(
        [
          base,
          [base[0] * 1.4, base[1] + X(0.08), base[2] - X(0.06)],
          [base[0] * 1.8, base[1] + X(0.13 - Math.abs(a) * 0.08), base[2] - X(0.16)],
        ],
        {
          radius: (t) => X(0.012) * (1 - t) + 0.001,
          flat: 2,
          radial: 6,
          segments: 10,
          up: [0, 0, 1],
        },
      ),
      { color: (_p, t) => mix(GOLD, FLAME, t), glow: 0.8, gloss: 1 },
    );
  }
  b.part('head', place(ellipsoid(X(0.02), X(0.02), X(0.012), 12, 8), [0, X(0.21), X(0.09)]), {
    color: 0xff4a2a,
    glow: 1.4,
    gloss: 1,
  });
  featherWings(b, X(0.62), CRIMSON, FLAME, 9, 1.1, 0.4);
  const top = staff(b, 'grip', s, { main: GOLD, accent: 0xff7a2a }, 1.1);
  b.attach('flame', 'grip', [top[0], top[1] + X(0.03), top[2]], {
    size: X(0.13),
    color: 0xff5a1f,
    core: FLAME,
  });
  b.attach('halo', 'chest', [0, X(0.24), X(-0.24)], {
    radius: X(0.42),
    style: 'thorn',
    color: GOLD,
    accent: 0xfff0c0,
    count: 20,
    spin: 0.2,
  });
  return b.build();
}
