// 鸟形宠物（火团雀、炎翎鸟）：圆身子、小翅膀、尖嘴、羽冠与长尾羽。
import * as THREE from 'three';
import type { Expression } from './face.js';
import { bladeShape, ellipsoid, extrude, lathe, limb, place, tube, type V3 } from './geo.js';
import { mix, smooth } from './palette.js';
import { BlueprintBuilder } from './rig.js';

export interface BirdOptions {
  id: string;
  scale?: number;
  /** 身体半径与长度（幼年圆滚滚，进化后修长）。 */
  body: { radius: number; length: number };
  neck: number;
  head: number;
  legs: number;
  plumage: THREE.ColorRepresentation;
  belly: THREE.ColorRepresentation;
  wing: {
    color: THREE.ColorRepresentation;
    tip: THREE.ColorRepresentation;
    span: number;
    feathers: number;
  };
  tail: {
    color: THREE.ColorRepresentation;
    tip: THREE.ColorRepresentation;
    length: number;
    plumes: number;
  };
  crest: {
    color: THREE.ColorRepresentation;
    tip: THREE.ColorRepresentation;
    length: number;
    count: number;
  };
  beak: THREE.ColorRepresentation;
  eyes: {
    iris: THREE.ColorRepresentation;
    glow?: THREE.ColorRepresentation;
    style?: 'mascot' | 'fierce';
  };
  resting?: Expression;
}

export interface BirdFrame {
  b: BlueprintBuilder;
  s: number;
}

export function bird(o: BirdOptions): BirdFrame {
  const s = o.scale ?? 1;
  const X = (v: number) => v * s;
  const b = new BlueprintBuilder(o.id);
  const R = X(o.body.radius);
  const L = X(o.body.length);
  const legH = X(o.legs);
  const bodyY = legH + R * 0.8;
  const headR = X(o.head);
  b.bone('root', null, [0, 0, 0])
    .bone('body', 'root', [0, bodyY, 0])
    .bone('neck', 'body', [0, R * 0.6, L * 0.3])
    .bone('head', 'neck', [0, X(o.neck), headR * 0.2])
    .bone('wingL', 'body', [R * 0.82, R * 0.25, 0])
    .bone('wingR', 'body', [-R * 0.82, R * 0.25, 0])
    .bone('legL', 'body', [R * 0.35, -R * 0.6, 0])
    .bone('footL', 'legL', [0, -(bodyY - R * 0.6 - X(0.01)), 0])
    .bone('legR', 'body', [-R * 0.35, -R * 0.6, 0])
    .bone('footR', 'legR', [0, -(bodyY - R * 0.6 - X(0.01)), 0])
    .bone('tail1', 'body', [0, R * 0.1, -L * 0.45])
    .bone('tail2', 'tail1', [0, -X(0.02), -X(o.tail.length * 0.5)]);

  // 身体：上深下浅
  b.part('body', ellipsoid(R, R * 0.95, L * 0.55 + R * 0.45, 40, 28), {
    color: (p) =>
      mix(
        o.plumage,
        o.belly,
        (1 - smooth(-R * 0.3, R * 0.2, p.y)) * smooth(-L * 0.2, R * 0.3, p.z),
      ),
  });
  b.part('neck', limb([0, -R * 0.3, -R * 0.1], [0, X(o.neck) * 0.9, 0], R * 0.55, headR * 0.6), {
    color: (p) => mix(o.plumage, o.belly, smooth(R * 0.1, R * 0.4, p.z)),
  });
  // 头与嘴
  b.part('head', ellipsoid(headR, headR * 0.95, headR * 0.95, 48, 32), { color: o.plumage });
  const beak = lathe(
    [
      [headR * 0.26, 0],
      [headR * 0.2, headR * 0.2],
      [headR * 0.08, headR * 0.45],
      [0.0005, headR * 0.6],
    ],
    { segments: 16, smooth: 2 },
  );
  beak.rotateX(Math.PI / 2);
  b.part('head', place(beak, [0, -headR * 0.18, headR * 0.8], [0, 0, 0], [1, 0.7, 1]), {
    color: o.beak,
    gloss: 0.6,
  });
  // 羽冠：几根向后上方弯的羽毛
  for (let i = 0; i < o.crest.count; i++) {
    const k = o.crest.count === 1 ? 0 : i / (o.crest.count - 1) - 0.5;
    const len = X(o.crest.length) * (1 - Math.abs(k) * 0.5);
    const pts: V3[] = [
      [k * headR * 0.5, headR * 0.8, headR * 0.1],
      [k * headR * 0.7, headR * 0.8 + len * 0.55, -len * 0.1],
      [k * headR * 0.9, headR * 0.8 + len * 0.85, -len * 0.55],
    ];
    b.part(
      'head',
      tube(pts, {
        radius: (t) => X(0.02) * (1 - t) * (1 + 0.6 * Math.sin(t * Math.PI)) + 0.001,
        flat: 2.2,
        radial: 8,
        segments: 14,
        up: [0, 0, 1],
      }),
      {
        color: (_p, t) => mix(o.crest.color, o.crest.tip, smooth(0.3, 0.9, t)),
        glow: 0.6,
      },
    );
  }
  // 翅膀：一排渐长的羽片，向外、向后扇形排开，平放（扇动时绕 z 轴抬起）
  const span = X(o.wing.span);
  for (const [bone, side] of [
    ['wingL', 1],
    ['wingR', -1],
  ] as const) {
    for (let i = 0; i < o.wing.feathers; i++) {
      const k = i / Math.max(1, o.wing.feathers - 1);
      const len = span * (0.55 + 0.45 * Math.sin(k * Math.PI * 0.9 + 0.15));
      const f = extrude(bladeShape(len * 0.3, len, 0.08), X(0.008), X(0.003));
      f.rotateZ((-side * Math.PI) / 2);
      f.rotateX(Math.PI / 2);
      // 越靠后的羽片越往后偏、越往下垂
      f.rotateY(side * (0.25 + k * 0.95));
      f.rotateZ(side * (-0.12 - k * 0.2));
      f.translate(side * X(0.005), -k * R * 0.12, -k * R * 0.35);
      b.part(bone, f, {
        color: (p) =>
          mix(o.wing.color, o.wing.tip, smooth(len * 0.45, len * 0.95, Math.hypot(p.x, p.z))),
        line: 0.8,
      });
    }
  }
  // 尾羽
  const tl = X(o.tail.length);
  for (let i = 0; i < o.tail.plumes; i++) {
    const k = o.tail.plumes === 1 ? 0 : i / (o.tail.plumes - 1) - 0.5;
    const pts: V3[] = [
      [0, 0, 0],
      [k * tl * 0.2, -tl * 0.05, -tl * 0.4],
      [k * tl * 0.45, -tl * 0.18 + Math.abs(k) * tl * 0.1, -tl * 0.8],
      [k * tl * 0.6, -tl * 0.1 + Math.abs(k) * tl * 0.2, -tl * (1 - Math.abs(k) * 0.2)],
    ];
    b.chain(
      ['tail1', 'tail2'],
      tube(pts, {
        radius: (t) => X(0.028) * (0.5 + Math.sin(t * Math.PI) * 0.8) * (1 - t * 0.6) + 0.001,
        flat: 2.6,
        radial: 8,
        segments: 20,
        up: [0, 1, 0],
      }),
      {
        color: (_p, t) => mix(o.tail.color, o.tail.tip, smooth(0.35, 0.95, t)),
        glow: 0.5,
      },
    );
  }
  // 腿与爪
  for (const n of ['L', 'R'] as const) {
    const len = b.bonePosition(`leg${n}`).y - b.bonePosition(`foot${n}`).y;
    b.part(`leg${n}`, limb([0, 0, 0], [0, -len, 0], X(0.012), X(0.01), 8), { color: o.beak });
    for (const a of [-0.5, 0, 0.5]) {
      b.part(
        `foot${n}`,
        limb(
          [0, 0, 0],
          [Math.sin(a) * X(0.04), -X(0.005), Math.cos(a) * X(0.045)],
          X(0.008),
          X(0.005),
          6,
        ),
        { color: o.beak },
      );
    }
  }
  b.face({
    bone: 'head',
    center: [0, 0, 0],
    radii: [headR, headR * 0.95, headR * 0.95],
    eyes: {
      yaw: 0.55,
      pitch: 0.12,
      width: 0.5,
      height: 0.62,
      style: o.eyes.style ?? 'mascot',
      iris: o.eyes.iris,
      glow: o.eyes.glow,
    },
    blush: { yaw: 0.9, pitch: -0.15, width: 0.35, height: 0.24 },
    resting: o.resting,
  });
  b.height = bodyY + R * 0.6 + X(o.neck) + headR * 2;
  b.headCenter = b.bonePosition('head');
  return { b, s };
}

void THREE;
