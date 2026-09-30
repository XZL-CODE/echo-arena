// 四足宠物的通用身体（狐、狼、猫、熊、鹿、獭、蜥蜴……）：幼年大头短腿，进化后腿更长、身形更舒展。
import * as THREE from 'three';
import type { Expression, MouthStyle } from './face.js';
import { deform, ellipsoid, extrude, leafShape, limb, place, puff, tube, type V3 } from './geo.js';
import { mix, smooth } from './palette.js';
import { BlueprintBuilder, type ColorFn, type PartStyle } from './rig.js';

export type EarKind = 'fox' | 'cat' | 'wolf' | 'bear' | 'round' | 'bunny' | 'fin' | 'none';
export type TailKind = 'fluffy' | 'thin' | 'thick' | 'stub' | 'flat' | 'none';

export interface QuadOptions {
  id: string;
  /** 整体缩放（1 = 幼年大小，约 0.6 米高）。 */
  scale?: number;
  /** 身体长短与粗细。 */
  body: { length: number; radius: number; height?: number };
  /** 腿：高度（髋到地面）、粗细、是否两段（进化形态）。 */
  legs: { height: number; radius: number; jointed?: boolean; paw?: THREE.ColorRepresentation };
  head: { radius: number; width?: number; lift?: number; forward?: number };
  snout: {
    length: number;
    radius: number;
    color?: THREE.ColorRepresentation;
    nose?: THREE.ColorRepresentation;
  };
  ears: {
    kind: EarKind;
    size: number;
    color?: THREE.ColorRepresentation;
    inner?: THREE.ColorRepresentation;
    tip?: THREE.ColorRepresentation;
    spread?: number;
  };
  coat: THREE.ColorRepresentation;
  /** 腹部 / 胸口 / 下半张脸的浅色。 */
  under?: THREE.ColorRepresentation;
  tail: {
    kind: TailKind;
    size: number;
    color?: THREE.ColorRepresentation;
    tip?: THREE.ColorRepresentation;
    count?: number;
    up?: number;
  };
  eyes: {
    iris: THREE.ColorRepresentation;
    glow?: THREE.ColorRepresentation;
    size?: number;
    yaw?: number;
    pitch?: number;
    tilt?: number;
    style?: 'mascot' | 'fierce';
  };
  mouth?: MouthStyle;
  blush?: boolean;
  resting?: Expression;
}

export interface QuadFrame {
  b: BlueprintBuilder;
  s: number;
  /** 头部椭球（head 骨局部坐标）。 */
  headCenter: V3;
  headRadii: V3;
  tailBones: string[];
}

export function quadruped(o: QuadOptions): QuadFrame {
  const s = o.scale ?? 1;
  const X = (v: number) => v * s;
  const b = new BlueprintBuilder(o.id);
  const L = X(o.body.length);
  const R = X(o.body.radius);
  const legH = X(o.legs.height);
  const bodyY = legH + R * 0.55;
  const headR = X(o.head.radius);
  const headW = headR * (o.head.width ?? 1.08);
  const jointed = o.legs.jointed ?? false;

  b.bone('root', null, [0, 0, 0])
    .bone('body', 'root', [0, bodyY, 0])
    .bone('chest', 'body', [0, R * 0.08, L * 0.42])
    .bone('neck', 'chest', [0, R * 0.55, L * 0.28])
    .bone('head', 'neck', [
      0,
      headR * (0.72 + (o.head.lift ?? 0)),
      headR * (0.25 + (o.head.forward ?? 0)),
    ])
    .bone('hips', 'body', [0, 0, -L * 0.42]);
  const earY = headR * 0.72;
  const spread = o.ears.spread ?? 0.62;
  b.bone('earL', 'head', [headW * spread * 0.85, earY, -headR * 0.1]);
  b.bone('earR', 'head', [-headW * spread * 0.85, earY, -headR * 0.1]);
  const legX = R * 0.6;
  for (const [n, parent, z, side] of [
    ['FL', 'chest', L * 0.08, 1],
    ['FR', 'chest', L * 0.08, -1],
    ['BL', 'hips', -L * 0.02, 1],
    ['BR', 'hips', -L * 0.02, -1],
  ] as const) {
    const top = parent === 'chest' ? bodyY + R * 0.08 - R * 0.45 : bodyY - R * 0.45;
    b.bone(`leg${n}`, parent, [side * legX, -R * 0.45, z]);
    if (jointed) {
      b.bone(`shin${n}`, `leg${n}`, [
        0,
        -(top - X(0.02)) * 0.5,
        n.startsWith('B') ? -X(0.015) : X(0.01),
      ]);
      b.bone(`paw${n}`, `shin${n}`, [0, -(top - X(0.02)) * 0.5 + X(0.0), 0]);
    } else {
      b.bone(`paw${n}`, `leg${n}`, [0, -(top - X(0.035)), 0]);
    }
  }
  const tailBones: string[] = [];
  const tailSeg = o.tail.kind === 'none' ? 0 : 3;
  for (let i = 0; i < tailSeg; i++) {
    const name = `tail${i + 1}`;
    const seg = X(0.07 * o.tail.size);
    b.bone(
      name,
      i === 0 ? 'hips' : `tail${i}`,
      i === 0 ? [0, R * 0.35, -L * 0.2] : [0, seg * 0.7, -seg],
    );
    tailBones.push(name);
  }

  const coat = new THREE.Color(o.coat);
  const under = new THREE.Color(o.under ?? o.coat);
  const coatStyle: PartStyle = { color: coat };

  // ---- 躯干 ----
  const torso = ellipsoid(R * 1.02, R, L * 0.62 + R * 0.5, 48, 32);
  b.part('body', torso, {
    color: (p) =>
      coat
        .clone()
        .lerp(under, (1 - smooth(-R * 0.45, -R * 0.2, p.y)) * smooth(-L * 0.25, L * 0.1, p.z)),
  });
  b.part('chest', place(ellipsoid(R * 0.8, R * 0.86, R * 0.72, 32, 22), [0, R * 0.12, R * 0.3]), {
    color: (p) =>
      coat
        .clone()
        .lerp(under, smooth(R * 0.2, R * 0.55, p.z) * (1 - smooth(R * 0.55, R * 0.8, p.y))),
  });
  b.part(
    'neck',
    limb([0, -R * 0.35, -R * 0.1], [0, headR * 0.4, headR * 0.05], R * 0.62, headR * 0.55),
    {
      color: (p) => coat.clone().lerp(under, smooth(R * 0.25, R * 0.5, p.z)),
    },
  );

  // ---- 头 ----
  const hc: V3 = [0, 0, 0];
  const hr: V3 = [headW, headR * 0.93, headR * 0.92];
  const headGeo = ellipsoid(1, 1, 1, 64, 44);
  deform(headGeo, (p) => {
    // 脸颊往两侧鼓，下巴收一点
    if (p.y < 0.1) p.x *= 1 + 0.08 * Math.max(0, 0.6 - Math.abs(p.y - -0.25));
  });
  headGeo.scale(...hr);
  b.part('head', headGeo, { color: coat });
  // 下半张脸（浅色口鼻与两颊）：用一个嵌进头里的椭球做出清楚的分界
  if (o.under) {
    b.part(
      'head',
      place(ellipsoid(headW * 0.78, headR * 0.52, headR * 0.62, 48, 32), [
        0,
        -headR * 0.34,
        headR * 0.34,
      ]),
      { color: under },
    );
  }
  const snoutLen = X(o.snout.length);
  const snoutR = X(o.snout.radius);
  const snoutCenter: V3 = [0, -headR * 0.3, headR * 0.72 + snoutLen * 0.4];
  b.part(
    'head',
    place(ellipsoid(snoutR * 1.15, snoutR * 0.85, snoutR + snoutLen * 0.5, 32, 22), snoutCenter),
    {
      color: o.snout.color ?? under,
    },
  );
  b.part(
    'head',
    place(ellipsoid(snoutR * 0.42, snoutR * 0.3, snoutR * 0.28, 16, 12), [
      0,
      snoutCenter[1] + snoutR * 0.48,
      snoutCenter[2] + snoutR + snoutLen * 0.42,
    ]),
    { color: o.snout.nose ?? 0x2b1b1f, gloss: 1, rim: 0.3 },
  );

  // ---- 耳朵 ----
  addEars(b, o, headR, s);

  // ---- 腿 ----
  const pawColor = o.legs.paw ?? coat;
  const legR = X(o.legs.radius);
  for (const n of ['FL', 'FR', 'BL', 'BR'] as const) {
    const back = n.startsWith('B');
    if (jointed) {
      const upper = b.bonePosition(`leg${n}`).y - b.bonePosition(`shin${n}`).y;
      const lower = b.bonePosition(`shin${n}`).y - b.bonePosition(`paw${n}`).y;
      b.part(
        `leg${n}`,
        limb(
          [0, legR * 0.4, 0],
          [0, -upper, back ? -X(0.015) : X(0.01)],
          legR * (back ? 1.35 : 1.15),
          legR * 0.85,
        ),
        coatStyle,
      );
      b.part(`shin${n}`, limb([0, 0, 0], [0, -lower + legR * 0.4, 0], legR * 0.85, legR * 0.75), {
        color: (p) => mix(coat, pawColor, smooth(-lower * 0.45, -lower * 0.75, p.y)),
      });
    } else {
      const len = b.bonePosition(`leg${n}`).y - b.bonePosition(`paw${n}`).y;
      b.part(
        `leg${n}`,
        limb(
          [0, legR * 0.3, 0],
          [0, -len + legR * 0.5, 0],
          legR * (back ? 1.2 : 1.05),
          legR * 0.92,
        ),
        {
          color: (p) => mix(coat, pawColor, smooth(-len * 0.45, -len * 0.75, p.y)),
        },
      );
    }
    b.part(
      `paw${n}`,
      place(ellipsoid(legR * 1.18, legR * 0.82, legR * 1.4, 18, 12), [0, legR * 0.25, legR * 0.35]),
      { color: pawColor },
    );
  }

  // ---- 尾巴 ----
  if (o.tail.kind !== 'none') addTail(b, o, tailBones, s);

  // ---- 脸 ----
  const eyeSize = o.eyes.size ?? 1;
  b.face({
    bone: 'head',
    center: hc,
    radii: hr,
    eyes: {
      yaw: o.eyes.yaw ?? 0.44,
      pitch: o.eyes.pitch ?? 0.06,
      width: 0.42 * eyeSize,
      height: 0.54 * eyeSize,
      style: o.eyes.style ?? 'mascot',
      iris: o.eyes.iris,
      glow: o.eyes.glow,
      tilt: o.eyes.tilt,
    },
    mouth:
      o.mouth === 'none'
        ? undefined
        : {
            pitch: -0.42,
            width: 0.62,
            height: 0.5,
            style: o.mouth ?? 'cat',
            center: snoutCenter,
            radii: [snoutR * 1.15, snoutR * 0.85, snoutR + snoutLen * 0.5],
          },
    blush: o.blush === false ? undefined : { yaw: 0.8, pitch: -0.2, width: 0.32, height: 0.22 },
    resting: o.resting,
  });
  b.height = bodyY + R * 0.3 + headR * 2.1;
  b.headCenter = b.bonePosition('head');
  return { b, s, headCenter: hc, headRadii: hr, tailBones };
}

function addEars(b: BlueprintBuilder, o: QuadOptions, headR: number, s: number): void {
  const e = o.ears;
  if (e.kind === 'none') return;
  const X = (v: number) => v * s;
  const color = e.color ?? o.coat;
  const inner = e.inner ?? mix(color, 0xffc0c0, 0.5);
  const tip = e.tip ?? color;
  const size = X(e.size);
  if (e.kind === 'round' || e.kind === 'bear') {
    const ear = ellipsoid(size * 0.62, size * 0.56, size * 0.32, 20, 14);
    const innerEar = place(ellipsoid(size * 0.38, size * 0.34, size * 0.12, 16, 10), [
      0,
      0,
      size * 0.2,
    ]);
    b.pair('earL', 'earR', place(ear, [0, size * 0.1, 0], [0, 0, -0.3]), { color });
    b.pair('earL', 'earR', place(innerEar, [0, size * 0.1, 0], [0, 0, -0.3]), {
      color: inner,
      line: 0.5,
    });
    return;
  }
  if (e.kind === 'fin') {
    const fin = extrude(leafShape(size * 0.5, size, 0.7), X(0.012));
    b.pair('earL', 'earR', place(fin, [0, 0, 0], [-0.3, 0.2, -0.9]), {
      color: (p) => mix(color, tip, smooth(size * 0.5, size, p.y)),
    });
    return;
  }
  const w = e.kind === 'bunny' ? size * 0.42 : e.kind === 'cat' ? size * 0.78 : size * 0.72;
  const h = e.kind === 'bunny' ? size * 1.9 : size;
  const shape = leafShape(w, h, e.kind === 'cat' ? 0.55 : 0.62);
  const ear = extrude(shape, X(0.026));
  const innerShape = leafShape(w * 0.58, h * 0.68, 0.6);
  const innerEar = place(extrude(innerShape, X(0.01)), [0, h * 0.06, X(0.02)]);
  const tilt = e.kind === 'bunny' ? 0.12 : e.kind === 'cat' ? 0.3 : 0.36;
  const rot: V3 = [-0.12, 0, -tilt];
  b.pair('earL', 'earR', place(ear, [0, 0, 0], rot), {
    color: (p) => mix(color, tip, smooth(h * 0.6, h * 0.82, p.y)),
  });
  b.pair('earL', 'earR', place(innerEar, [0, 0, 0], rot), { color: inner, rim: 0.2, line: 0.5 });
  void headR;
}

function addTail(b: BlueprintBuilder, o: QuadOptions, bones: string[], s: number): void {
  const X = (v: number) => v * s;
  const t = o.tail;
  const color = t.color ?? o.coat;
  const tip = t.tip ?? color;
  const count = t.count ?? 1;
  const up = t.up ?? 1;
  const colorFn: ColorFn = (_p, k) => mix(color, tip, smooth(0.62, 0.8, k));
  for (let i = 0; i < count; i++) {
    const fan = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2;
    const sz = t.size;
    let pts: V3[];
    let radius: (k: number) => number;
    if (t.kind === 'fluffy') {
      pts = [
        [0, 0, 0],
        [fan * X(0.04), X(0.04) * sz, -X(0.08) * sz],
        [fan * X(0.1), X(0.13) * sz * up, -X(0.13) * sz],
        [fan * X(0.14), X(0.23) * sz * up, -X(0.11) * sz],
        [fan * X(0.15), X(0.29) * sz * up, -X(0.05) * sz],
      ];
      radius = puff(X(0.075) * sz * (count > 1 ? 0.8 : 1), 0.35, X(0.01), 0.42);
    } else if (t.kind === 'thin') {
      pts = [
        [0, 0, 0],
        [0, X(0.05) * sz, -X(0.09) * sz],
        [fan * X(0.05), X(0.16) * sz * up, -X(0.14) * sz],
        [fan * X(0.05), X(0.24) * sz * up, -X(0.1) * sz],
      ];
      radius = (k) => X(0.025) * sz * (1 - k * 0.5);
    } else if (t.kind === 'thick') {
      pts = [
        [0, 0, 0],
        [0, -X(0.02) * sz, -X(0.12) * sz],
        [fan * X(0.04), -X(0.05) * sz, -X(0.24) * sz],
        [fan * X(0.06), -X(0.05) * sz, -X(0.34) * sz],
      ];
      radius = (k) => X(0.06) * sz * (1 - k * 0.85) + X(0.004);
    } else if (t.kind === 'flat') {
      pts = [
        [0, 0, 0],
        [0, -X(0.02) * sz, -X(0.1) * sz],
        [0, -X(0.03) * sz, -X(0.2) * sz],
      ];
      radius = (k) => X(0.05) * sz * (1 - k * 0.4);
    } else {
      pts = [
        [0, 0, 0],
        [0, X(0.03) * sz, -X(0.04) * sz],
        [0, X(0.05) * sz, -X(0.05) * sz],
      ];
      radius = puff(X(0.05) * sz, 0.6, X(0.01), 0.5);
    }
    const g = tube(pts, {
      radius,
      radial: 14,
      segments: 30,
      flat: t.kind === 'flat' ? 2.2 : 1,
      up: [0, 1, 0],
    });
    b.chain(bones, g, { color: colorFn });
  }
}
