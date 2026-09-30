// 人形态的通用身体：约 6 头身的少年少女 / 青年比例（长腿、窄腰、小头），
// 服装分层：贴身内衬 → 长大衣 / 裙装 → 披风、肩甲、胸甲 → 金色镶边与饰物。物种再加耳朵、角、尾巴、武器与光环。
import * as THREE from 'three';
import type { Expression, EyeStyle } from './face.js';
import { deform, ellipsoid, lathe, limb, place, shell, tube, type V3 } from './geo.js';
import { addHair, type HairOptions, type HeadFrame } from './hair.js';
import { mix, smooth } from './palette.js';
import { BlueprintBuilder, type ColorFn, type PartStyle } from './rig.js';

export type Sex = 'm' | 'f';

export interface CoatOptions {
  color: THREE.ColorRepresentation;
  lining?: THREE.ColorRepresentation;
  trim?: THREE.ColorRepresentation;
  /** 下摆长度（米，从腰往下）。 */
  length: number;
  /** 前襟开口（弧度，0 = 合拢）。 */
  open?: number;
  sleeves?: 'long' | 'wide' | 'short' | 'none';
  highCollar?: boolean;
  /** 下摆两侧开衩（战斗大衣）。 */
  slits?: boolean;
  /** 衣身花纹（按模型坐标取色，可选）。 */
  pattern?: ColorFn;
  /** 胸针宝石颜色。 */
  gem?: THREE.ColorRepresentation;
}

export interface Outfit {
  /** 贴身内衬（躯干、手臂）。 */
  suit: THREE.ColorRepresentation;
  /** 腿（裤子 / 长袜）。 */
  legs: THREE.ColorRepresentation;
  coat?: CoatOptions;
  /** 裙装（从腰到下摆），length 米。 */
  dress?: {
    color: THREE.ColorRepresentation;
    trim?: THREE.ColorRepresentation;
    length: number;
    flare?: number;
  };
  cape?: {
    color: THREE.ColorRepresentation;
    lining?: THREE.ColorRepresentation;
    trim?: THREE.ColorRepresentation;
    length: number;
    width?: number;
  };
  pauldrons?: {
    color: THREE.ColorRepresentation;
    trim?: THREE.ColorRepresentation;
    size?: number;
    spikes?: boolean;
  };
  chestplate?: { color: THREE.ColorRepresentation; trim?: THREE.ColorRepresentation };
  gloves?: { color: THREE.ColorRepresentation; length?: number };
  boots: { color: THREE.ColorRepresentation; height?: number; trim?: THREE.ColorRepresentation };
  belt?: THREE.ColorRepresentation;
  /** 腰间垂下的飘带。 */
  sash?: THREE.ColorRepresentation;
  /** 金饰颜色。 */
  gold?: THREE.ColorRepresentation;
}

export interface HumanoidOptions {
  id: string;
  sex: Sex;
  /** 身高（米），默认女 1.62、男 1.74。 */
  height?: number;
  /** 体格（0.9 纤细 … 1.3 魁梧）。 */
  build?: number;
  skin: THREE.ColorRepresentation;
  eyes: {
    iris: THREE.ColorRepresentation;
    glow?: THREE.ColorRepresentation;
    lash?: THREE.ColorRepresentation;
    style?: EyeStyle;
  };
  hair: HairOptions;
  outfit: Outfit;
  resting?: Expression;
  hairBones?: number;
  tailBones?: number;
  wings?: boolean;
}

export interface HumanoidFrame {
  b: BlueprintBuilder;
  head: HeadFrame;
  /** 相对标准身材的缩放。 */
  s: number;
  sex: Sex;
  build: number;
  skin: THREE.Color;
  gold: THREE.Color;
  /** 肩关节、腰、髋在模型坐标的高度（放披风、腰带、尾巴用）。 */
  shoulderY: number;
  waistY: number;
}

interface Proportions {
  hips: number;
  waist: number;
  chest: number;
  neck: number;
  head: number;
  headC: V3;
  headR: V3;
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  foreArm: number;
  hipX: number;
  thigh: number;
  shin: number;
  pelvis: V3;
  chestProfile: Array<[number, number]>;
  waistProfile: Array<[number, number]>;
  arm: [number, number];
  fore: [number, number];
  thighR: [number, number];
  shinR: [number, number];
  neckR: number;
  hand: number;
}

const FEMALE: Proportions = {
  hips: 0.9,
  waist: 0.1,
  chest: 0.14,
  neck: 0.155,
  head: 0.055,
  headC: [0, 0.118, 0.014],
  headR: [0.1, 0.128, 0.11],
  shoulderX: 0.152,
  shoulderY: 0.13,
  upperArm: 0.255,
  foreArm: 0.225,
  hipX: 0.083,
  thigh: 0.41,
  shin: 0.39,
  pelvis: [0.128, 0.098, 0.096],
  chestProfile: [
    [0.096, -0.05],
    [0.108, 0.0],
    [0.122, 0.05],
    [0.12, 0.095],
    [0.112, 0.122],
    [0.08, 0.145],
    [0.04, 0.158],
  ],
  waistProfile: [
    [0.106, -0.03],
    [0.094, 0.03],
    [0.097, 0.09],
    [0.104, 0.12],
  ],
  arm: [0.033, 0.027],
  fore: [0.027, 0.02],
  thighR: [0.07, 0.047],
  shinR: [0.046, 0.03],
  neckR: 0.03,
  hand: 0.9,
};

const MALE: Proportions = {
  hips: 0.96,
  waist: 0.11,
  chest: 0.15,
  neck: 0.175,
  head: 0.06,
  headC: [0, 0.12, 0.012],
  headR: [0.104, 0.13, 0.114],
  shoulderX: 0.185,
  shoulderY: 0.135,
  upperArm: 0.28,
  foreArm: 0.245,
  hipX: 0.09,
  thigh: 0.44,
  shin: 0.41,
  pelvis: [0.124, 0.1, 0.1],
  chestProfile: [
    [0.116, -0.05],
    [0.13, 0.0],
    [0.148, 0.06],
    [0.152, 0.11],
    [0.138, 0.148],
    [0.09, 0.168],
    [0.048, 0.176],
  ],
  waistProfile: [
    [0.118, -0.03],
    [0.116, 0.04],
    [0.12, 0.1],
    [0.126, 0.13],
  ],
  arm: [0.042, 0.034],
  fore: [0.034, 0.026],
  thighR: [0.077, 0.054],
  shinR: [0.053, 0.036],
  neckR: 0.039,
  hand: 1.05,
};

/** 搭骨架、身体与服装，返回构建器（物种代码继续加部件后 build()）。 */
export function humanoid(o: HumanoidOptions): HumanoidFrame {
  const P = o.sex === 'f' ? FEMALE : MALE;
  const baseH = o.sex === 'f' ? 1.62 : 1.74;
  const s = (o.height ?? baseH) / baseH;
  const k = o.build ?? 1;
  const X = (v: number) => v * s;
  const b = new BlueprintBuilder(o.id);
  const out = o.outfit;
  const gold = new THREE.Color(out.gold ?? 0xffc84e);
  const skin = new THREE.Color(o.skin);

  // ---- 骨架 ----
  b.bone('root', null, [0, 0, 0])
    .bone('hips', 'root', [0, X(P.hips), 0])
    .bone('spine', 'hips', [0, X(P.waist), 0])
    .bone('chest', 'spine', [0, X(P.chest), 0])
    .bone('neck', 'chest', [0, X(P.neck), X(-0.004)])
    .bone('head', 'neck', [0, X(P.head), X(0.008)]);
  for (const [side, n] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    b.bone(`arm${n}`, 'chest', [side * X(P.shoulderX * k), X(P.shoulderY), X(-0.008)])
      .bone(`fore${n}`, `arm${n}`, [0, X(-P.upperArm), 0])
      .bone(`hand${n}`, `fore${n}`, [0, X(-P.foreArm), 0])
      .bone(`thigh${n}`, 'hips', [side * X(P.hipX * k), X(-0.04), 0])
      .bone(`shin${n}`, `thigh${n}`, [0, X(-P.thigh), 0])
      .bone(`foot${n}`, `shin${n}`, [0, X(-P.shin + 0.06), 0]);
  }
  // weapon / offhand：刀剑类，刃朝前下方；grip / offgrip：杖、弓、锤这类竖着握的。
  b.bone('weapon', 'handR', [0, X(-0.055), X(0.01)], [2.05, 0, 0]);
  b.bone('offhand', 'handL', [0, X(-0.055), X(0.01)], [2.05, 0, 0]);
  b.bone('grip', 'handR', [0, X(-0.05), X(0.012)]);
  b.bone('offgrip', 'handL', [0, X(-0.05), X(0.012)]);
  const hairBones: string[] = [];
  for (let i = 0; i < (o.hairBones ?? 0); i++) {
    const name = `hair${i + 1}`;
    b.bone(
      name,
      i === 0 ? 'head' : `hair${i}`,
      i === 0 ? [0, X(0.1), X(-0.12)] : [0, X(-0.2), X(-0.02)],
    );
    hairBones.push(name);
  }
  const tailBones: string[] = [];
  for (let i = 0; i < (o.tailBones ?? 0); i++) {
    const name = `tail${i + 1}`;
    b.bone(
      name,
      i === 0 ? 'hips' : `tail${i}`,
      i === 0 ? [0, X(-0.02), X(-0.1)] : [0, X(0.03), X(-0.16)],
    );
    tailBones.push(name);
  }
  const capeBones: string[] = [];
  if (out.cape) {
    const segs = 3;
    const seg = X(out.cape.length / segs);
    for (let i = 0; i < segs; i++) {
      const name = `cape${i + 1}`;
      b.bone(
        name,
        i === 0 ? 'chest' : `cape${i}`,
        i === 0 ? [0, X(0.13), X(-0.1)] : [0, -seg, X(-0.02)],
      );
      capeBones.push(name);
    }
  }
  const coatBones: string[] = [];
  if (out.coat || out.dress) {
    const len = X((out.coat?.length ?? out.dress?.length ?? 0.4) / 2);
    b.bone('coat1', 'hips', [0, X(-0.02), X(-0.1)]);
    b.bone('coat2', 'coat1', [0, -len, X(-0.03)]);
    coatBones.push('coat1', 'coat2');
  }
  if (o.wings) {
    b.bone('wingL', 'chest', [X(0.06), X(0.1), X(-0.09)]);
    b.bone('wingR', 'chest', [X(-0.06), X(0.1), X(-0.09)]);
  }

  const shoulderY = b.bonePosition('armL').y;
  const waistY = b.bonePosition('spine').y;
  b.height = b.toModel('head', P.headC).y + X(P.headR[1]) + X(0.02);

  // ---- 头 ----
  const head: HeadFrame = {
    bone: 'head',
    center: [X(P.headC[0]), X(P.headC[1]), X(P.headC[2])],
    radii: [X(P.headR[0]), X(P.headR[1]), X(P.headR[2])],
  };
  const headGeo = ellipsoid(1, 1, 1, 64, 48);
  deform(
    headGeo,
    (p) => {
      // 动漫脸：下半张脸收成尖下巴，脸颊到下巴是一条顺滑的 V 线；后脑勺饱满
      if (p.y < 0.05) {
        const d = Math.min(1, (0.05 - p.y) / 1.05);
        const taperX = 1 - 0.42 * Math.pow(d, 1.35);
        p.x *= taperX;
        if (p.z > 0) p.z *= 1 - 0.1 * d + 0.12 * d * Math.max(0, p.z);
        else p.z *= 1 - 0.25 * d;
      }
      if (p.z < 0) p.z *= 1.06;
    },
    false,
  );
  // 保留球面法线（不按变形后的尖下巴重算）：脸上的明暗像圆脸一样柔和，这是动漫角色常用的做法。
  headGeo.scale(...head.radii);
  headGeo.translate(...head.center);
  const skinStyle: PartStyle = { color: skin, rim: 0.45, soft: 1 };
  // 刘海在额头投下的阴影：额头上部的皮肤偏暗偏粉
  const shade = skin.clone().multiply(new THREE.Color(0.86, 0.74, 0.8));
  b.part('head', headGeo, {
    ...skinStyle,
    color: (p) =>
      skin.clone().lerp(shade, smooth(head.center[1] + X(0.03), head.center[1] + X(0.075), p.y)),
  });
  b.headCenter = b.toModel('head', head.center);
  // 耳朵（多半被头发盖住）与鼻尖
  for (const side of [1, -1]) {
    b.part(
      'head',
      place(ellipsoid(X(0.012), X(0.024), X(0.016), 12, 10), [
        side * X(P.headR[0] * 0.93),
        head.center[1] - X(0.012),
        head.center[2] - X(0.012),
      ]),
      skinStyle,
    );
  }
  b.part(
    'head',
    place(ellipsoid(X(0.008), X(0.012), X(0.01), 10, 8), [
      0,
      head.center[1] - X(0.035),
      head.center[2] + X(P.headR[2] * 0.99),
    ]),
    {
      color: mix(skin, 0xe89a8a, 0.4),
      line: 0,
      soft: 1,
    },
  );
  b.face({
    bone: 'head',
    center: head.center,
    radii: head.radii,
    eyes: {
      yaw: 0.4,
      pitch: -0.08,
      width: 0.72,
      height: o.eyes.style === 'anime' ? 0.72 : 0.66,
      style: o.eyes.style ?? 'sharp',
      iris: o.eyes.iris,
      glow: o.eyes.glow,
      lash: o.eyes.lash ?? 0x1c1018,
    },
    mouth: { pitch: -0.52, width: 0.17, height: 0.1, style: 'smile' },
    blush: o.sex === 'f' ? { yaw: 0.6, pitch: -0.3, width: 0.26, height: 0.13 } : undefined,
    resting: o.resting,
  });
  addHair(b, head, { ...o.hair, bones: hairBones });

  // ---- 躯干（内衬） ----
  const suit = new THREE.Color(out.suit);
  const suitStyle: PartStyle = { color: suit };
  b.part(
    'neck',
    limb([0, X(-0.03), 0], [0, X(P.head + 0.02), X(0.01)], X(P.neckR), X(P.neckR * 0.95)),
    skinStyle,
  );
  const chestGeo = lathe(
    P.chestProfile.map(([r, y]) => [X(r * k), X(y)] as [number, number]),
    { segments: 36, smooth: 4, squash: o.sex === 'f' ? 0.74 : 0.7 },
  );
  b.part('chest', chestGeo, suitStyle);
  if (o.sex === 'f') {
    for (const side of [1, -1]) {
      b.part(
        'chest',
        place(ellipsoid(X(0.046), X(0.042), X(0.03), 20, 14), [
          side * X(0.048),
          X(0.045),
          X(0.062),
        ]),
        suitStyle,
      );
    }
  }
  b.part(
    'spine',
    lathe(
      P.waistProfile.map(([r, y]) => [X(r * k), X(y)] as [number, number]),
      { segments: 36, smooth: 3, squash: 0.74 },
    ),
    suitStyle,
  );
  b.part(
    'hips',
    place(ellipsoid(X(P.pelvis[0] * k), X(P.pelvis[1]), X(P.pelvis[2]), 32, 22), [
      0,
      X(-0.012),
      X(-0.004),
    ]),
    {
      color: out.legs,
    },
  );
  // 肩头（三角肌）
  for (const side of [1, -1]) {
    b.part(
      'chest',
      place(ellipsoid(X(P.arm[0] * 1.18), X(P.arm[0] * 1.05), X(P.arm[0] * 1.15), 20, 14), [
        side * X(P.shoulderX * k * 0.93),
        X(P.shoulderY - 0.004),
        X(-0.008),
      ]),
      {
        color: out.coat && out.coat.sleeves !== 'none' ? out.coat.color : suit,
      },
    );
  }

  // ---- 手臂 ----
  const sleeveColor =
    out.coat && out.coat.sleeves !== 'none' ? new THREE.Color(out.coat.color) : suit;
  const gloveColor = out.gloves ? new THREE.Color(out.gloves.color) : null;
  const gloveLen = out.gloves?.length ?? 0.35;
  for (const n of ['L', 'R'] as const) {
    const side = n === 'L' ? 1 : -1;
    b.part(`arm${n}`, limb([0, 0, 0], [0, X(-P.upperArm), 0], X(P.arm[0] * k), X(P.arm[1] * k)), {
      color: sleeveColor,
    });
    const foreLen = X(P.foreArm);
    b.part(
      `fore${n}`,
      limb([0, 0, 0], [0, -foreLen + X(0.01), 0], X(P.fore[0] * k), X(P.fore[1] * k)),
      {
        color: (p) => (gloveColor && -p.y > foreLen * (1 - gloveLen) ? gloveColor : sleeveColor),
      },
    );
    if (gloveColor) {
      b.part(
        `fore${n}`,
        place(
          new THREE.TorusGeometry(X(P.fore[0] * k * 0.95), X(0.006), 6, 18),
          [0, -foreLen * (1 - gloveLen), 0],
          [Math.PI / 2, 0, 0],
        ),
        {
          color: gold,
          gloss: 0.8,
        },
      );
    }
    // 手：掌 + 四指合拢 + 拇指
    const hs = X(P.hand);
    const handColor = gloveColor ?? skin;
    const handStyle: PartStyle = { color: handColor, soft: gloveColor ? 0 : 1, rim: 0.4 };
    b.part(
      `hand${n}`,
      place(ellipsoid(0.027 * hs, 0.036 * hs, 0.014 * hs, 14, 10), [0, -0.03 * hs, 0.002 * hs]),
      handStyle,
    );
    b.part(
      `hand${n}`,
      place(
        ellipsoid(0.024 * hs, 0.03 * hs, 0.012 * hs, 14, 10),
        [0, -0.068 * hs, 0.006 * hs],
        [0.25, 0, 0],
      ),
      handStyle,
    );
    b.part(
      `hand${n}`,
      limb(
        [side * -0.02 * hs, -0.02 * hs, 0.008 * hs],
        [side * -0.03 * hs, -0.05 * hs, 0.022 * hs],
        0.009 * hs,
        0.007 * hs,
        8,
      ),
      handStyle,
    );
  }

  // ---- 腿 ----
  const bootH = out.boots.height ?? 0.7;
  const bootColor = new THREE.Color(out.boots.color);
  const legColor = new THREE.Color(out.legs);
  for (const n of ['L', 'R'] as const) {
    b.part(
      `thigh${n}`,
      limb([0, X(0.02), 0], [0, X(-P.thigh), 0], X(P.thighR[0] * k), X(P.thighR[1] * k)),
      {
        color: (p) => (bootH > 1 && -p.y > X(P.thigh) * (2 - bootH) ? bootColor : legColor),
      },
    );
    const shinLen = X(P.shin - 0.06);
    b.part(`shin${n}`, limb([0, 0, 0], [0, -shinLen, 0], X(P.shinR[0] * k), X(P.shinR[1] * k)), {
      color: (p) => (-p.y > shinLen * (1 - Math.min(1, bootH)) ? bootColor : legColor),
    });
    // 膝盖
    b.part(
      `shin${n}`,
      place(ellipsoid(X(P.shinR[0] * 1.05 * k), X(0.035), X(P.shinR[0] * k), 14, 10), [
        0,
        X(0.005),
        X(0.008),
      ]),
      {
        color: bootH >= 0.98 ? bootColor : legColor,
      },
    );
    const bootTopY = bootH > 1 ? X(P.thigh) * (bootH - 1) : -shinLen * (1 - bootH);
    const trimBone = bootH > 1 ? `shin${n}` : `shin${n}`;
    b.part(
      trimBone,
      place(
        new THREE.TorusGeometry(X(P.shinR[0] * k * (bootH > 1 ? 1.05 : 0.98)), X(0.009), 6, 20),
        [0, Math.min(X(0.02), bootTopY), 0],
        [Math.PI / 2, 0, 0],
      ),
      {
        color: out.boots.trim ?? gold,
        gloss: 0.7,
      },
    );
    // 靴子：鞋头 + 鞋跟
    b.part(
      `foot${n}`,
      place(ellipsoid(X(0.04), X(0.036), X(0.1), 18, 12), [0, X(-0.03), X(0.045)]),
      { color: bootColor, gloss: 0.35 },
    );
    b.part(
      `foot${n}`,
      place(ellipsoid(X(0.036), X(0.03), X(0.04), 14, 10), [0, X(-0.04), X(-0.015)]),
      { color: mix(bootColor, 0x000000, 0.2) },
    );
  }

  // ---- 裙装 ----
  if (out.dress) {
    const d = out.dress;
    const len = X(d.length);
    const flare = d.flare ?? 1;
    const top = X(P.pelvis[0] * k * 1.02);
    const g = shell(
      [
        [top * 0.92, X(0.05)],
        [top, X(0.0)],
        [top * (1 + 0.35 * flare), -len * 0.45],
        [top * (1 + 0.65 * flare), -len],
      ],
      {
        segments: 48,
        smooth: 3,
        thickness: X(0.006),
        squash: 0.86,
        wave: (phi, t) => Math.sin(phi * 10) * X(0.012) * t * flare,
      },
    );
    const trim = d.trim ?? gold;
    b.chain(['hips', ...coatBones], g, {
      color: (_p, t) => mix(d.color, trim, smooth(0.9, 0.95, t)),
    });
  }

  // ---- 大衣 ----
  if (out.coat) {
    addCoat(b, out.coat, P, k, s, gold, coatBones, o.sex);
  }

  // ---- 腰带与飘带 ----
  if (out.belt) {
    const r = X(P.waistProfile[0]?.[0] ?? 0.1) * k * 1.06;
    b.part(
      'spine',
      shell(
        [
          [r, X(-0.005)],
          [r * 1.02, X(-0.03)],
          [r, X(-0.055)],
        ],
        { segments: 36, thickness: X(0.006), squash: 0.76 },
      ),
      {
        color: out.belt,
        gloss: 0.4,
      },
    );
    b.part(
      'spine',
      place(ellipsoid(X(0.024), X(0.022), X(0.012), 14, 10), [0, X(-0.03), r * 0.78]),
      { color: gold, gloss: 1, glow: 0.2 },
    );
  }
  if (out.sash) {
    for (const side of [1, -1]) {
      const g = tube(
        [
          [side * X(0.07), X(-0.03), X(0.06)],
          [side * X(0.1), X(-0.12), X(0.05)],
          [side * X(0.11), X(-0.28), X(0.02)],
          [side * X(0.12), X(-0.42), X(0.0)],
        ],
        {
          radius: (t) => X(0.022) * (1 - t * 0.3),
          flat: 2.6,
          radial: 6,
          segments: 18,
          up: [0, 0, 1],
        },
      );
      b.chain(['spine', ...coatBones], g, { color: out.sash });
    }
  }

  // ---- 披风 ----
  if (out.cape) addCape(b, out.cape, P, k, s, gold, capeBones);

  // ---- 肩甲 / 胸甲 ----
  if (out.pauldrons) {
    const pd = out.pauldrons;
    const size = X(0.075 * (pd.size ?? 1) * (o.sex === 'm' ? 1.12 : 1));
    for (const n of ['L', 'R'] as const) {
      const side = n === 'L' ? 1 : -1;
      const cap = shell(
        [
          [size * 0.2, size * 0.62],
          [size * 0.75, size * 0.42],
          [size * 1.02, size * 0.05],
          [size * 1.06, -size * 0.28],
        ],
        { segments: 28, smooth: 3, thickness: X(0.008) },
      );
      b.part(`arm${n}`, place(cap, [side * X(0.01), X(0.012), 0], [0, 0, side * -0.28]), {
        color: (_p, t) => mix(pd.color, pd.trim ?? gold, smooth(0.86, 0.93, t)),
        gloss: 0.8,
      });
      if (pd.spikes) {
        for (let i = 0; i < 3; i++) {
          const a = (i - 1) * 0.5;
          const g = tube(
            [
              [side * size * 0.3 + Math.sin(a) * size * 0.3, size * 0.55, Math.cos(a) * size * 0.1],
              [
                side * size * 0.55 + Math.sin(a) * size * 0.4,
                size * 0.95,
                Math.cos(a) * size * 0.1 - size * 0.1,
              ],
              [side * size * 0.85 + Math.sin(a) * size * 0.4, size * 1.3, -size * 0.25],
            ],
            { radius: (t) => size * 0.13 * (1 - t) + X(0.001), radial: 8, segments: 10 },
          );
          b.part(`arm${n}`, g, { color: pd.trim ?? gold, gloss: 1 });
        }
      }
    }
  }
  if (out.chestplate) {
    const cp = out.chestplate;
    const prof = P.chestProfile.map(([r, y]) => [X(r * k * 1.07), X(y)] as [number, number]);
    const g = shell(prof.slice(0, 6), {
      phiStart: -1.25,
      phiLength: 2.5,
      segments: 28,
      smooth: 3,
      thickness: X(0.008),
      squash: o.sex === 'f' ? 0.8 : 0.76,
    });
    b.part('chest', g, {
      color: (_p, t) =>
        mix(cp.color, cp.trim ?? gold, smooth(0.9, 0.96, t) + (1 - smooth(0.03, 0.08, t))),
      gloss: 0.9,
    });
  }

  return { b, head, s, sex: o.sex, build: k, skin, gold, shoulderY, waistY };
}

/** 长大衣：上身一层、立领、下摆（前襟开口、可开衩），袖子，金色镶边。 */
function addCoat(
  b: BlueprintBuilder,
  c: CoatOptions,
  P: Proportions,
  k: number,
  s: number,
  gold: THREE.Color,
  coatBones: string[],
  sex: Sex,
): void {
  const X = (v: number) => v * s;
  const trim = new THREE.Color(c.trim ?? gold);
  const lining = new THREE.Color(c.lining ?? mix(c.color, 0x000000, 0.35));
  const open = c.open ?? 0.5;
  const body = c.pattern ?? (() => new THREE.Color(c.color));
  // 上身：比内衬大一圈，正面留出 V 形开口露出内衬
  const prof = P.chestProfile.map(([r, y]) => [X(r * k * 1.08), X(y)] as [number, number]);
  const upper = shell(prof, {
    phiStart: open * 0.55,
    phiLength: Math.PI * 2 - open * 1.1,
    segments: 40,
    smooth: 3,
    thickness: X(0.007),
    squash: sex === 'f' ? 0.78 : 0.74,
  });
  b.part('chest', upper, { color: (p, t) => (t > 0.88 ? trim : new THREE.Color(body(p, t))) });
  // 前襟两道金边（从领口到腰），上半段翻出三角形的翻领
  const sq = sex === 'f' ? 0.78 : 0.74;
  for (const side of [1, -1]) {
    const pts: V3[] = prof.map(
      ([r, y]) =>
        [side * Math.sin(open * 0.55) * r * 1.01, y, Math.cos(open * 0.55) * r * sq * 1.01] as V3,
    );
    b.part('chest', tube(pts, { radius: X(0.006), radial: 6, segments: 24 }), {
      color: trim,
      gloss: 0.8,
    });
    const top = prof[prof.length - 2] as [number, number];
    const mid = prof[3] as [number, number];
    const a = open * 0.55;
    const lapel = new THREE.Shape();
    lapel.moveTo(0, 0);
    lapel.lineTo(X(0.05), X(0.03));
    lapel.lineTo(X(0.012), X(0.12));
    lapel.lineTo(-X(0.004), X(0.1));
    const lg = new THREE.ExtrudeGeometry(lapel, {
      depth: X(0.006),
      bevelEnabled: true,
      bevelThickness: X(0.003),
      bevelSize: X(0.002),
      bevelSegments: 1,
    });
    lg.computeVertexNormals();
    const px = side * Math.sin(a) * mid[0] * 1.02;
    const pz = Math.cos(a) * mid[0] * sq * 1.04;
    b.part('chest', place(lg, [px, mid[1], pz], [-0.12, side * 0.35, 0], [side, 1, 1]), {
      color: (p) =>
        p.x * side > X(0.038) || p.y > X(0.108) ? trim : new THREE.Color(c.lining ?? c.color),
    });
    void top;
  }
  // 领口的宝石胸针
  const brooch = prof[prof.length - 2] as [number, number];
  b.part(
    'chest',
    place(
      new THREE.OctahedronGeometry(X(0.016), 0),
      [0, brooch[1] - X(0.02), brooch[0] * sq + X(0.008)],
      [0, 0, 0],
      [1, 1.3, 0.6],
    ),
    {
      color: c.gem ?? 0xff3a4a,
      glow: 1.4,
      gloss: 1,
    },
  );
  const waist = P.waistProfile.map(([r, y]) => [X(r * k * 1.1), X(y)] as [number, number]);
  b.part(
    'spine',
    shell(waist, {
      phiStart: open * 0.35,
      phiLength: Math.PI * 2 - open * 0.7,
      segments: 36,
      thickness: X(0.007),
      squash: 0.76,
    }),
    {
      color: (p, t) => new THREE.Color(body(p, t)),
    },
  );
  if (c.highCollar !== false) {
    const nr = X(P.neckR * 1.9);
    const collar = shell(
      [
        [nr * 1.25, X(0.2)],
        [nr * 1.05, X(0.17)],
        [nr * 1.12, X(0.135)],
      ],
      {
        phiStart: 0.55,
        phiLength: Math.PI * 2 - 1.1,
        segments: 28,
        smooth: 2,
        thickness: X(0.006),
      },
    );
    b.part('chest', place(collar, [0, X(0.0), X(-0.01)]), {
      color: (_p, t) => (t < 0.18 ? trim : new THREE.Color(c.color)),
    });
  }
  // 下摆：从腰到 length，后片跟着 coat 骨头飘动
  const len = X(c.length);
  const r0 = X(P.pelvis[0] * k * 1.1);
  const hem = shell(
    [
      [r0 * 0.95, X(0.04)],
      [r0 * 1.02, X(-0.02)],
      [r0 * 1.22, -len * 0.4],
      [r0 * 1.45, -len],
    ],
    {
      phiStart: open,
      phiLength: Math.PI * 2 - open * 2,
      segments: 48,
      smooth: 3,
      thickness: X(0.007),
      squash: 0.9,
      wave: c.slits
        ? (phi, t) => {
            // 两侧开衩：在 ±90° 附近把下摆往外掀一点
            const side = Math.abs(Math.sin(phi));
            return side > 0.97 ? X(0.012) * t : 0;
          }
        : undefined,
    },
  );
  b.chain(['hips', ...coatBones], hem, {
    color: (p, t) => (t > 0.94 ? trim : t > 0.9 ? lining : new THREE.Color(body(p, t))),
  });
  // 袖子
  const sl = c.sleeves ?? 'long';
  if (sl === 'wide') {
    for (const n of ['L', 'R'] as const) {
      const cuff = shell(
        [
          [X(P.fore[0] * 1.6), X(0.02)],
          [X(0.05), X(-0.06)],
          [X(0.08), X(-0.16)],
          [X(0.095), X(-P.foreArm + 0.02)],
        ],
        { segments: 28, smooth: 3, thickness: X(0.006), squash: 0.75 },
      );
      b.part(`fore${n}`, place(cuff, [0, 0, X(-0.012)]), {
        color: (_p, t) => (t > 0.9 ? trim : t > 0.86 ? lining : new THREE.Color(c.color)),
      });
    }
  } else if (sl === 'long') {
    for (const n of ['L', 'R'] as const) {
      b.part(
        `fore${n}`,
        place(
          new THREE.TorusGeometry(X(P.fore[1] * 1.3), X(0.008), 6, 18),
          [0, X(-P.foreArm + 0.05), 0],
          [Math.PI / 2, 0, 0],
        ),
        {
          color: trim,
          gloss: 0.8,
        },
      );
    }
  }
}

/** 披风：从肩后垂下的弧形厚片，沿 cape 骨头摆动，内衬另一种颜色，下沿金边。 */
function addCape(
  b: BlueprintBuilder,
  cape: NonNullable<Outfit['cape']>,
  P: Proportions,
  k: number,
  s: number,
  gold: THREE.Color,
  bones: string[],
): void {
  const X = (v: number) => v * s;
  const len = X(cape.length);
  const w = (cape.width ?? 1) * X(P.shoulderX * k * 1.1);
  const top = X(P.shoulderY + 0.03);
  const g = shell(
    [
      [w * 0.85, top],
      [w, top - X(0.08)],
      [w * 1.15, top - len * 0.45],
      [w * 1.35, top - len],
    ],
    {
      phiStart: Math.PI - 1.35,
      phiLength: 2.7,
      segments: 36,
      smooth: 3,
      thickness: X(0.008),
      squash: 0.62,
      wave: (phi, t) => Math.sin(phi * 7) * X(0.015) * t,
    },
  );
  const trim = new THREE.Color(cape.trim ?? gold);
  const lining = new THREE.Color(cape.lining ?? mix(cape.color, 0x000000, 0.4));
  b.chain(['chest', ...bones], g, {
    color: (p, t) => {
      if (t > 0.95) return trim;
      // 披风内侧（朝前的一面）用内衬色：按位置判断离身体更近的那层
      const r = Math.hypot(p.x, p.z / 0.62);
      return r < w * (1 + 0.35 * t) * 0.985 ? lining : new THREE.Color(cape.color);
    },
  });
}

/** 动物耳朵：长在头顶两侧。 */
export function animalEars(
  f: HumanoidFrame,
  kind: 'fox' | 'cat' | 'wolf' | 'bear' | 'bunny',
  outer: THREE.ColorRepresentation,
  inner: THREE.ColorRepresentation,
  tip?: THREE.ColorRepresentation,
  scale = 1,
): void {
  const { b, head, s } = f;
  const X = (v: number) => v * s * scale;
  for (const side of [1, -1]) {
    const yaw = side * (kind === 'bunny' ? 0.3 : 0.55);
    const pitch = kind === 'bunny' ? 1.15 : 0.95;
    const base: V3 = [
      head.center[0] + Math.sin(yaw) * Math.cos(pitch) * head.radii[0] * 1.02,
      head.center[1] + Math.sin(pitch) * head.radii[1] * 1.02,
      head.center[2] + Math.cos(yaw) * Math.cos(pitch) * head.radii[2] * 1.02,
    ];
    const len = X(kind === 'bunny' ? 0.24 : kind === 'bear' ? 0.06 : kind === 'fox' ? 0.15 : 0.11);
    const width = X(
      kind === 'bunny' ? 0.06 : kind === 'bear' ? 0.07 : kind === 'fox' ? 0.1 : 0.085,
    );
    const tilt = side * (kind === 'bunny' ? 0.15 : kind === 'bear' ? 0.9 : 0.38);
    if (kind === 'bear') {
      b.part(
        'head',
        place(ellipsoid(width * 0.6, width * 0.55, width * 0.3, 20, 14), base, [0, 0, -tilt * 0.5]),
        { color: outer },
      );
      b.part(
        'head',
        place(
          ellipsoid(width * 0.36, width * 0.32, width * 0.12, 16, 10),
          [base[0], base[1], base[2] + width * 0.18],
          [0, 0, -tilt * 0.5],
        ),
        {
          color: inner,
          line: 0.5,
        },
      );
      continue;
    }
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.quadraticCurveTo(-width * 0.55, len * 0.6, 0, len);
    shape.quadraticCurveTo(width * 0.55, len * 0.6, width / 2, 0);
    shape.quadraticCurveTo(0, -len * 0.08, -width / 2, 0);
    const ear = new THREE.ExtrudeGeometry(shape, {
      depth: X(0.02),
      bevelEnabled: true,
      bevelThickness: X(0.008),
      bevelSize: X(0.006),
      bevelSegments: 2,
      curveSegments: 12,
    });
    ear.translate(0, 0, -X(0.01));
    ear.computeVertexNormals();
    const innerShape = new THREE.Shape();
    innerShape.moveTo(-width * 0.3, len * 0.08);
    innerShape.quadraticCurveTo(-width * 0.28, len * 0.55, 0, len * 0.8);
    innerShape.quadraticCurveTo(width * 0.28, len * 0.55, width * 0.3, len * 0.08);
    innerShape.quadraticCurveTo(0, len * 0.02, -width * 0.3, len * 0.08);
    const innerGeo = new THREE.ExtrudeGeometry(innerShape, {
      depth: X(0.005),
      bevelEnabled: true,
      bevelThickness: X(0.003),
      bevelSize: X(0.003),
      bevelSegments: 1,
      curveSegments: 10,
    });
    innerGeo.translate(0, 0, X(0.018));
    const rot: V3 = [-0.3, side * 0.25, -tilt];
    const tipColor = tip ?? outer;
    b.part('head', place(ear, base, rot), {
      color: (p) => mix(outer, tipColor, smooth(len * 0.6, len * 0.8, p.y)),
    });
    b.part('head', place(innerGeo, base, rot), { color: inner, line: 0.4, rim: 0.3 });
  }
}

/** 蓬松尾巴挂在 tail 骨链上。curve 是沿尾巴的控制点（hips 局部坐标）。 */
export function fluffyTail(
  f: HumanoidFrame,
  bones: string[],
  base: THREE.ColorRepresentation,
  tip: THREE.ColorRepresentation,
  size: number,
  curve: V3[],
): void {
  const X = (v: number) => v * f.s;
  const g = tube(curve, {
    radius: (t) =>
      X(0.09 * size) *
      (t < 0.35
        ? 0.3 + 0.7 * Math.sin((t / 0.35) * (Math.PI / 2))
        : Math.cos(((t - 0.35) / 0.65) * (Math.PI / 2)) * 0.97 + 0.03),
    radial: 16,
    segments: 36,
  });
  f.b.chain(bones, g, { color: (_p, t) => mix(base, tip, smooth(0.62, 0.8, t)) });
}

/** 角：从头顶两侧长出的弯角（龙角、羊角、鹿角的主干），带金色环纹。 */
export function horns(
  f: HumanoidFrame,
  color: THREE.ColorRepresentation,
  tip: THREE.ColorRepresentation,
  length = 0.2,
  curl = 1,
  bands?: THREE.ColorRepresentation,
): void {
  const { b, head, s } = f;
  const X = (v: number) => v * s;
  for (const side of [1, -1]) {
    const yaw = side * 0.62;
    const root = new THREE.Vector3(
      head.center[0] + Math.sin(yaw) * Math.cos(0.72) * head.radii[0] * 0.98,
      head.center[1] + Math.sin(0.72) * head.radii[1] * 0.98,
      head.center[2] + Math.cos(yaw) * Math.cos(0.72) * head.radii[2] * 0.98,
    );
    const L = X(length);
    const pts: V3[] = [
      [root.x, root.y, root.z],
      [root.x + side * L * 0.25, root.y + L * 0.3, root.z - L * 0.25 * curl],
      [root.x + side * L * 0.35, root.y + L * 0.55, root.z - L * 0.65 * curl],
      [root.x + side * L * 0.3, root.y + L * 0.62 + L * 0.2 * (1 - curl), root.z - L * 1.0 * curl],
    ];
    const bandColor = bands ? new THREE.Color(bands) : null;
    b.part(
      'head',
      tube(pts, { radius: (t) => X(0.026) * (1 - t) + X(0.002), radial: 12, segments: 28 }),
      {
        color: (_p, t) => {
          if (bandColor && (Math.abs(t - 0.3) < 0.03 || Math.abs(t - 0.5) < 0.025))
            return bandColor;
          return mix(color, tip, smooth(0.4, 0.95, t));
        },
        gloss: 0.8,
      },
    );
  }
}

export { mix };
