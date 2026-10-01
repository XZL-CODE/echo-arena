// 物种常用的装饰件：鹿角、小花、水晶簇、龟壳、岩甲、羽翼、闪电形尾巴、电火花簇。
import * as THREE from 'three';
import {
  bladeShape,
  ellipsoid,
  extrude,
  faceted,
  lathe,
  leafShape,
  place,
  rocky,
  tube,
  type V3,
} from './geo.js';
import { mix, smooth } from './palette.js';
import type { BlueprintBuilder, PartStyle } from './rig.js';

/** 分叉的鹿角：主干 + 几根侧枝，可在枝头开花。返回枝头位置（开花用）。 */
export function antlers(
  b: BlueprintBuilder,
  bone: string,
  root: V3,
  size: number,
  color: THREE.ColorRepresentation,
  tip: THREE.ColorRepresentation,
  branches = 3,
  side = 1,
): V3[] {
  const tips: V3[] = [];
  const style: PartStyle = { color: (_p, t) => mix(color, tip, smooth(0.5, 1, t)), gloss: 0.2 };
  const main: V3[] = [
    root,
    [root[0] + side * size * 0.25, root[1] + size * 0.45, root[2] - size * 0.05],
    [root[0] + side * size * 0.45, root[1] + size * 0.85, root[2] - size * 0.2],
    [root[0] + side * size * 0.5, root[1] + size * 1.15, root[2] - size * 0.35],
  ];
  b.part(
    bone,
    tube(main, { radius: (t) => size * 0.075 * (1 - t * 0.75) + 0.002, radial: 8, segments: 18 }),
    style,
  );
  tips.push(main[3] as V3);
  for (let i = 0; i < branches; i++) {
    const k = (i + 1) / (branches + 1);
    const a = main[Math.min(2, Math.floor(k * 3))] as V3;
    const from: V3 = [
      root[0] + (a[0] - root[0]) * (0.6 + k * 0.3),
      root[1] + (a[1] - root[1]) * (0.6 + k * 0.3),
      root[2] + (a[2] - root[2]) * (0.6 + k * 0.3),
    ];
    const dir = i % 2 === 0 ? 1 : -0.4;
    const end: V3 = [
      from[0] + side * size * 0.3 * dir,
      from[1] + size * 0.35,
      from[2] + size * (i % 2 === 0 ? 0.15 : -0.25),
    ];
    const mid: V3 = [
      (from[0] + end[0]) / 2 + side * size * 0.05,
      (from[1] + end[1]) / 2 - size * 0.02,
      (from[2] + end[2]) / 2,
    ];
    b.part(
      bone,
      tube([from, mid, end], {
        radius: (t) => size * 0.045 * (1 - t * 0.7) + 0.0015,
        radial: 7,
        segments: 10,
      }),
      style,
    );
    tips.push(end);
  }
  return tips;
}

/** 五瓣小花（花蕊发一点光）。 */
export function flower(
  b: BlueprintBuilder,
  bone: string,
  pos: V3,
  size: number,
  petal: THREE.ColorRepresentation,
  center: THREE.ColorRepresentation = 0xffe27a,
  facing: V3 = [0, 0.4, 0],
  petals = 5,
): void {
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const g = extrude(leafShape(size * 0.7, size, 0.7), size * 0.12, size * 0.05);
    g.rotateX(-Math.PI / 2 + 0.35);
    g.rotateY(a);
    g.rotateX(facing[0]);
    g.rotateZ(facing[2]);
    g.translate(...pos);
    b.part(bone, g, {
      color: (p) =>
        mix(
          petal,
          0xffffff,
          0.35 * (1 - smooth(0, size * 0.8, Math.hypot(p.x - pos[0], p.z - pos[2]))),
        ),
      line: 0.6,
    });
  }
  b.part(bone, place(ellipsoid(size * 0.28, size * 0.2, size * 0.28, 12, 8), pos), {
    color: center,
    glow: 0.8,
    line: 0.5,
  });
}

/** 水晶簇：几颗长短不一、棱角分明的晶柱，发光。 */
export function crystals(
  b: BlueprintBuilder,
  bone: string,
  base: V3,
  size: number,
  color: THREE.ColorRepresentation,
  count = 3,
  spread = 0.5,
  seed = 1,
  glow = 0.9,
): void {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < count; i++) {
    const h = size * (0.6 + rnd() * 0.7);
    const g = faceted(new THREE.OctahedronGeometry(1, 0));
    g.scale(h * 0.28, h, h * 0.28);
    g.translate(0, h * 0.7, 0);
    const tilt: V3 = [(rnd() - 0.5) * spread * 1.6, rnd() * Math.PI, (rnd() - 0.5) * spread * 1.6];
    const off: V3 = [
      base[0] + (rnd() - 0.5) * size * spread,
      base[1],
      base[2] + (rnd() - 0.5) * size * spread,
    ];
    b.part(bone, place(g, off, tilt), {
      color: (p) => mix(color, 0xffffff, smooth(h * 0.9, h * 1.6, p.y) * 0.6),
      glow,
      gloss: 1,
      line: 0.7,
    });
  }
}

/** 龟壳：半球形的甲，按六边形分块上色，边缘一圈浅色。 */
export function turtleShell(
  b: BlueprintBuilder,
  bone: string,
  center: V3,
  rx: number,
  ry: number,
  rz: number,
  plate: THREE.ColorRepresentation,
  seam: THREE.ColorRepresentation,
  rim: THREE.ColorRepresentation,
): void {
  const g = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
  g.scale(rx, ry, rz);
  b.part(bone, place(g, center), {
    color: (p) => {
      const nx = p.x / rx;
      const ny = p.y / ry;
      const nz = p.z / rz;
      if (ny < 0.12) return new THREE.Color(rim);
      // 在球面方向上做一个简单的六边形网格：离最近格心越远越接近缝线
      const a = Math.atan2(nx, nz);
      const e = Math.acos(Math.max(-1, Math.min(1, ny)));
      const u = a * 1.6;
      const v = e * 3.2;
      const fu = u - Math.round(u);
      const fv =
        v +
        (Math.round(u) % 2 === 0 ? 0 : 0.5) -
        Math.round(v + (Math.round(u) % 2 === 0 ? 0 : 0.5));
      const d = Math.max(Math.abs(fu), Math.abs(fv) * 1.15);
      return mix(plate, seam, smooth(0.36, 0.44, d));
    },
    gloss: 0.5,
  });
}

/** 岩石护甲：几块不规则的石板，缝隙里透出发光的岩浆色。 */
export function rockPlates(
  b: BlueprintBuilder,
  bone: string,
  center: V3,
  size: number,
  stone: THREE.ColorRepresentation,
  count: number,
  seed = 2,
): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 1.6 - Math.PI * 0.8;
    const g = rocky(
      new THREE.IcosahedronGeometry(size * (0.55 + (i % 3) * 0.12), 1),
      size * 0.25,
      6,
      seed + i,
    );
    g.scale(1.1, 0.55, 1);
    b.part(
      bone,
      place(
        faceted(g),
        [
          center[0] + Math.sin(a) * size * 0.9,
          center[1] + Math.cos(a) * size * 0.35,
          center[2] + Math.cos(a * 1.3) * size * 0.6,
        ],
        [0.3 * Math.sin(a), a, 0.2],
      ),
      {
        color: (p) => mix(stone, 0xffffff, smooth(size * 0.2, size * 0.5, p.y) * 0.15),
        gloss: 0.2,
      },
    );
  }
}

/** 一对羽翼（火翼、光翼）：一排羽片，从翼根往外渐长，翼尖发光。 */
export function featherWings(
  b: BlueprintBuilder,
  span: number,
  color: THREE.ColorRepresentation,
  tip: THREE.ColorRepresentation,
  feathers = 9,
  glow = 0.8,
  lift = 0.3,
): void {
  for (const [bone, side] of [
    ['wingL', 1],
    ['wingR', -1],
  ] as const) {
    for (let i = 0; i < feathers; i++) {
      const k = i / Math.max(1, feathers - 1);
      const len = span * (0.45 + 0.55 * Math.sin(k * Math.PI * 0.85 + 0.2));
      const f = extrude(bladeShape(len * 0.2, len, 0.12 * side), span * 0.02, span * 0.008);
      // 羽片从翼根向外上方扇形展开
      const ang = side * (0.35 + k * 1.25);
      const g = place(
        f,
        [side * span * 0.08 * k, span * 0.1 * k * lift, -span * 0.04 * k],
        [0.15 + k * 0.1, 0, -ang],
      );
      b.part(bone, g, {
        color: (p) => mix(color, tip, smooth(len * 0.35, len * 0.95, Math.hypot(p.x, p.y))),
        glow: glow * (0.4 + 0.6 * k),
        line: 0.7,
      });
    }
  }
}

/** 闪电形的尾巴（锯齿折线的扁管）。 */
export function boltTail(
  b: BlueprintBuilder,
  bones: string[],
  length: number,
  color: THREE.ColorRepresentation,
  tip: THREE.ColorRepresentation,
  width: number,
): void {
  const pts: V3[] = [
    [0, 0, 0],
    [0, length * 0.18, -length * 0.3],
    [length * 0.12, length * 0.38, -length * 0.35],
    [-length * 0.05, length * 0.58, -length * 0.62],
    [length * 0.1, length * 0.8, -length * 0.68],
    [0, length, -length * 0.95],
  ];
  const g = tube(pts, {
    radius: (t) => width * (0.6 + t * 0.9) * (t > 0.9 ? (1 - t) * 10 : 1),
    flat: 2.4,
    radial: 6,
    segments: 40,
    up: [1, 0, 0],
  });
  b.chain(bones, g, { color: (_p, t) => mix(color, tip, smooth(0.6, 0.85, t)), glow: 0.35 });
}

/** 发光的电火花簇（锯齿小三角）。 */
export function sparks(
  b: BlueprintBuilder,
  bone: string,
  base: V3,
  size: number,
  color: THREE.ColorRepresentation,
  count = 3,
): void {
  for (let i = 0; i < count; i++) {
    const a = ((i - (count - 1) / 2) / count) * 1.6;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(size * 0.25, size * 0.45);
    shape.lineTo(size * 0.05, size * 0.5);
    shape.lineTo(size * 0.3, size);
    shape.lineTo(-size * 0.12, size * 0.42);
    shape.lineTo(size * 0.08, size * 0.38);
    shape.lineTo(0, 0);
    const g = extrude(shape, size * 0.12, size * 0.03);
    b.part(bone, place(g, base, [-0.3, 0, a]), { color, glow: 1.4, line: 0.5 });
  }
}

/** 一圈车削的领子或护腕（金边）。 */
export function ring(
  b: BlueprintBuilder,
  bone: string,
  pos: V3,
  radius: number,
  tube: number,
  color: THREE.ColorRepresentation,
  rot: V3 = [Math.PI / 2, 0, 0],
): void {
  b.part(bone, place(new THREE.TorusGeometry(radius, tube, 8, 28), pos, rot), {
    color,
    gloss: 0.8,
  });
}

void lathe;
