// 动漫头发：发帽（盖住头顶与后脑）+ 一束束扁平尖头的发束（刘海、鬓发、后发、马尾、双马尾、呆毛）。
// 发束贴着头部椭球表面生长，发色可以从发根渐变到发梢，并在上部带一圈“天使环”高光。
import * as THREE from 'three';
import { puff, seg, taper, tube, type V3 } from './geo.js';
import { smooth } from './palette.js';
import type { BlueprintBuilder, ColorFn, PartStyle } from './rig.js';

export type HairStyle = 'short' | 'spiky' | 'bob' | 'long' | 'ponytail' | 'twintails' | 'wild';

export interface HairOptions {
  style: HairStyle;
  color: THREE.ColorRepresentation;
  /** 发梢颜色（不填则与发色相同）。 */
  tip?: THREE.ColorRepresentation;
  /** 发梢渐变从哪里开始（0–1）。 */
  tipFrom?: number;
  /** 刘海的束数与长度（相对头半径）。 */
  bangs?: number;
  bangLength?: number;
  /** 后发长度（米，从后脑中部往下）。 */
  length?: number;
  /** 呆毛。 */
  ahoge?: boolean;
  /** 头发骨头（长发、马尾摆动用），按顺序由上到下。 */
  bones?: string[];
  /** 双马尾时左右两串骨头。 */
  tailBonesL?: string[];
  tailBonesR?: string[];
  /** 发饰颜色（发圈）。 */
  tie?: THREE.ColorRepresentation;
  seed?: number;
}

export interface HeadFrame {
  bone: string;
  /** 头部椭球中心与半径（骨头局部坐标）。 */
  center: V3;
  radii: V3;
}

/** 椭球表面（方向 → 坐标），可再往外推一点。 */
function onHead(h: HeadFrame, yaw: number, pitch: number, lift: number): THREE.Vector3 {
  const dx = Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = Math.cos(yaw) * Math.cos(pitch);
  return new THREE.Vector3(
    h.center[0] + dx * h.radii[0] * lift,
    h.center[1] + dy * h.radii[1] * lift,
    h.center[2] + dz * h.radii[2] * lift,
  );
}

function outward(h: HeadFrame, p: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    (p.x - h.center[0]) / (h.radii[0] * h.radii[0]),
    (p.y - h.center[1]) / (h.radii[1] * h.radii[1]),
    (p.z - h.center[2]) / (h.radii[2] * h.radii[2]),
  ).normalize();
}

function hairColor(o: HairOptions, highlight: boolean): ColorFn {
  const base = new THREE.Color(o.color);
  const tip = new THREE.Color(o.tip ?? o.color);
  const shine = base.clone().lerp(new THREE.Color(0xffffff), 0.32);
  const from = o.tipFrom ?? 0.62;
  return (_p, t) => {
    const c = base.clone().lerp(tip, smooth(from, Math.min(1, from + 0.3), t));
    if (highlight) {
      const band = smooth(0.1, 0.18, t) * (1 - smooth(0.24, 0.32, t));
      c.lerp(shine, band * 0.85);
    }
    return c;
  };
}

/** 发帽：稍大的椭球，挖掉脸部区域。 */
function cap(h: HeadFrame, o: HairOptions): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg(48, 12), seg(32, 8));
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const keep: number[] = [];
  const index = g.getIndex() as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const faceCut = (x: number, y: number, z: number) => {
    // 脸：前方、眉毛以下的区域；两侧留到耳前。
    if (z > 0.2 && y < 0.42 - Math.abs(x) * 0.25) return true;
    if (y < -0.55) return true;
    return false;
  };
  for (let i = 0; i < index.count; i += 3) {
    let cut = false;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, index.getX(i + k));
      cx += v.x / 3;
      cy += v.y / 3;
      cz += v.z / 3;
    }
    cut = faceCut(cx, cy, cz);
    if (!cut) keep.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  g.setIndex(keep);
  // 后脑稍微鼓一点，头顶略平
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const back = Math.max(0, -v.z) * 0.08;
    v.set(v.x * (1 + back), v.y * (v.y > 0 ? 0.98 : 1), v.z * (1 + back * 0.5));
    pos.setXYZ(
      i,
      v.x * h.radii[0] * 1.05 + h.center[0],
      v.y * h.radii[1] * 1.05 + h.center[1],
      v.z * h.radii[2] * 1.05 + h.center[2],
    );
  }
  g.computeVertexNormals();
  // 't' 属性：从头顶（0）到下缘（1），用于高光带
  const t = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) - h.center[1]) / (h.radii[1] * 1.05);
    t[i] = (1 - y) / 2;
  }
  g.setAttribute('t', new THREE.BufferAttribute(t, 1));
  void o;
  return g;
}

/**
 * 一束贴着头皮长出来的发束：从 (yaw, pitch) 出发，沿头部表面往下（dir 方向）延伸 len（米），
 * 末端离头皮更远一些。width 是发束宽度。
 */
function clump(
  h: HeadFrame,
  yaw: number,
  pitch: number,
  len: number,
  width: number,
  sway: number,
  lift = 1.1,
  curlOut = 0.35,
): THREE.BufferGeometry {
  const pts: V3[] = [];
  const steps = 5;
  // 在椭球表面上沿俯仰角往下走，同时带一点横向偏移
  const radiusY = h.radii[1];
  const arc = len / radiusY;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const p = onHead(h, yaw + sway * k, pitch - arc * k, lift + curlOut * k * k);
    pts.push([p.x, p.y, p.z]);
  }
  const root = new THREE.Vector3(...(pts[0] as V3));
  const n = outward(h, root);
  return tube(pts, {
    // 发根略窄、中段最宽，然后收成尖（动漫发束的“叶片”形）
    radius: (t) =>
      width *
        0.5 *
        (t < 0.18 ? 0.7 + 0.3 * (t / 0.18) : Math.pow(Math.max(0, 1 - (t - 0.18) / 0.82), 1.25)) +
      0.0015,
    flat: 2.6,
    radial: 8,
    segments: 18,
    up: [n.x, n.y, n.z],
  });
}

/** 在空中自由延伸的发束（马尾、长发末端、呆毛）。 */
function strand(points: V3[], width: number, flat = 1.6, up: V3 = [0, 0, 1]): THREE.BufferGeometry {
  return tube(points, {
    radius: puff(width * 0.5, 0.6, 0.004, 0.3),
    flat,
    radial: 8,
    segments: 22,
    up,
  });
}

/** 生成整套头发并挂到骨头上。 */
export function addHair(b: BlueprintBuilder, h: HeadFrame, o: HairOptions): void {
  // 短发束（刘海、鬓发、后脑）不带发梢渐变，长发与马尾才有。
  const short = { ...o, tip: o.color };
  const style: PartStyle = { color: hairColor(short, true), gloss: 0.15, line: 0.9 };
  const plain: PartStyle = { color: hairColor(short, false), gloss: 0.1, line: 0.85 };
  const longStyle: PartStyle = { color: hairColor(o, true), gloss: 0.15, line: 0.9 };
  const longPlain: PartStyle = { color: hairColor(o, false), gloss: 0.1, line: 0.85 };
  const R = h.radii[1];
  b.part(h.bone, cap(h, o), {
    color: hairColor({ ...short, tipFrom: 2 }, true),
    gloss: 0.15,
    line: 1,
  });

  // 刘海：从发际线往下盖住额头，中间几束长到眼睛上沿，两侧渐短，末端稍微翘离额头
  const bangs = o.bangs ?? 9;
  const bangLen = (o.bangLength ?? 1) * R;
  const rnd = mulberry(o.seed ?? 7);
  for (let i = 0; i < bangs; i++) {
    const k = bangs === 1 ? 0 : i / (bangs - 1) - 0.5;
    const yaw = k * 1.7 + (rnd() - 0.5) * 0.06;
    const center = 1 - Math.abs(k) * 0.55;
    const len = bangLen * (0.62 + 0.42 * center) * (i % 2 === 0 ? 1 : 0.84) * (0.95 + rnd() * 0.1);
    const width = R * (0.4 - Math.abs(k) * 0.1);
    b.part(
      h.bone,
      clump(h, yaw, 1.02, len, width, -k * 0.42, 1.06, 0.14 + 0.1 * center),
      i % 3 === 1 ? plain : style,
    );
  }
  // 眉心的一束细发，让刘海不那么整齐
  b.part(h.bone, clump(h, 0.1, 0.95, bangLen * 1.05, R * 0.2, -0.12, 1.07, 0.2), style);
  // 鬓发：两侧耳前垂到下巴
  for (const side of [1, -1]) {
    b.part(h.bone, clump(h, side * 1.12, 0.62, R * 1.45, R * 0.34, side * 0.08, 1.05, 0.2), style);
    b.part(h.bone, clump(h, side * 1.38, 0.5, R * 1.2, R * 0.32, side * 0.04, 1.06, 0.22), plain);
  }

  const style2 = o.style;
  // 后发：一圈往下的发束
  const backLen =
    style2 === 'short' || style2 === 'spiky' || style2 === 'wild'
      ? R * 1.0
      : style2 === 'bob'
        ? R * 1.35
        : R * 1.3;
  const backCount = 9;
  for (let i = 0; i < backCount; i++) {
    const k = i / (backCount - 1);
    const yaw = Math.PI * 0.55 + k * Math.PI * 0.9;
    b.part(
      h.bone,
      clump(h, yaw, 0.35, backLen, R * 0.46, 0, 1.06, style2 === 'bob' ? 0.3 : 0.2),
      i % 2 ? plain : style,
    );
  }

  if (style2 === 'spiky' || style2 === 'wild') {
    // 往后上方翘起的尖发
    const spikes = style2 === 'wild' ? 9 : 7;
    for (let i = 0; i < spikes; i++) {
      const k = i / (spikes - 1) - 0.5;
      const root = onHead(h, Math.PI + k * 2.2, 0.55 + Math.abs(k) * -0.3, 1.02);
      const n = outward(h, root);
      const back = new THREE.Vector3(Math.sin(k * 2.2) * 0.4, 0.35, -1).normalize();
      const len = R * (style2 === 'wild' ? 0.95 : 0.75) * (1 - Math.abs(k) * 0.3);
      const mid = root
        .clone()
        .addScaledVector(n, len * 0.4)
        .addScaledVector(back, len * 0.4);
      const tip = root
        .clone()
        .addScaledVector(n, len * 0.55)
        .addScaledVector(back, len);
      b.part(
        h.bone,
        tube(
          [
            [root.x, root.y, root.z],
            [mid.x, mid.y, mid.z],
            [tip.x, tip.y, tip.z],
          ],
          {
            radius: taper(R * 0.2, 0.002, 0.8),
            flat: 1.7,
            radial: 8,
            segments: 12,
            up: [n.x, n.y, n.z],
          },
        ),
        style,
      );
    }
  }

  const hairBones = o.bones ?? [];
  if ((style2 === 'long' || style2 === 'bob') && hairBones.length > 0) {
    // 长发：后脑垂下的一大片，沿头发骨头摆动
    const len = o.length ?? 0.45;
    const top = h.center[1] + R * 0.1;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1) - 0.5;
      const x = k * h.radii[0] * 1.75;
      const z = h.center[2] - h.radii[2] * (1.02 - Math.abs(k) * 0.4);
      const l = len * (i % 2 ? 0.88 : 1) * (1 - Math.abs(k) * 0.25);
      const pts: V3[] = [
        [x * 0.9, top, z + 0.02],
        [x * 1.12, top - l * 0.35, z - 0.035],
        [x * 1.16, top - l * 0.7, z - 0.04],
        [x * (1.08 + Math.abs(k) * 0.25), top - l, z - 0.015 + Math.abs(k) * 0.03],
      ];
      b.chain(
        [h.bone, ...hairBones],
        strand(pts, R * 0.44, 1.7, [0, 0, 1]),
        i % 2 ? longPlain : longStyle,
      );
    }
  }

  if (style2 === 'ponytail') {
    const tieAt = onHead(h, Math.PI, 0.55, 1.05);
    const len = o.length ?? 0.42;
    const pts: V3[] = [
      [tieAt.x, tieAt.y, tieAt.z],
      [tieAt.x, tieAt.y + 0.02, tieAt.z - 0.1],
      [tieAt.x, tieAt.y - len * 0.35, tieAt.z - 0.16],
      [tieAt.x, tieAt.y - len * 0.75, tieAt.z - 0.12],
      [tieAt.x, tieAt.y - len, tieAt.z - 0.06],
    ];
    const tail = tube(pts, {
      radius: puff(R * 0.36, 0.5, 0.01, 0.3),
      flat: 1.25,
      radial: 12,
      segments: 28,
      up: [0, 0, -1],
    });
    if (hairBones.length > 0) b.chain([h.bone, ...hairBones], tail, longStyle);
    else b.part(h.bone, tail, longStyle);
    b.part(
      h.bone,
      new THREE.TorusGeometry(R * 0.16, R * 0.06, 8, 16).translate(
        tieAt.x,
        tieAt.y,
        tieAt.z - 0.02,
      ),
      {
        color: o.tie ?? 0xff4d6d,
        gloss: 0.4,
      },
    );
  }

  if (style2 === 'twintails') {
    for (const side of [1, -1]) {
      const bones = side > 0 ? (o.tailBonesL ?? []) : (o.tailBonesR ?? []);
      const at = onHead(h, side * 1.75, 0.5, 1.03);
      const len = o.length ?? 0.45;
      const pts: V3[] = [
        [at.x, at.y, at.z],
        [at.x + side * 0.08, at.y + 0.02, at.z - 0.03],
        [at.x + side * 0.12, at.y - len * 0.4, at.z - 0.06],
        [at.x + side * 0.1, at.y - len * 0.8, at.z - 0.04],
        [at.x + side * 0.06, at.y - len, at.z],
      ];
      const g = tube(pts, {
        radius: puff(R * 0.3, 0.5, 0.01, 0.3),
        flat: 1.2,
        radial: 12,
        segments: 26,
        up: [0, 0, 1],
      });
      if (bones.length > 0) b.chain([h.bone, ...bones], g, longStyle);
      else b.part(h.bone, g, longStyle);
      b.part(
        h.bone,
        new THREE.SphereGeometry(R * 0.11, 12, 8).translate(at.x + side * 0.02, at.y, at.z),
        {
          color: o.tie ?? 0xff4d6d,
          gloss: 0.5,
        },
      );
    }
  }

  if (o.ahoge) {
    const root = onHead(h, 0.15, 1.35, 1.0);
    b.part(
      h.bone,
      strand(
        [
          [root.x, root.y, root.z],
          [root.x + 0.02, root.y + R * 0.35, root.z + 0.03],
          [root.x - 0.03, root.y + R * 0.55, root.z + 0.09],
          [root.x - 0.06, root.y + R * 0.45, root.z + 0.14],
        ],
        R * 0.14,
        1.8,
        [1, 0, 0],
      ),
      style,
    );
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { onHead, outward };
