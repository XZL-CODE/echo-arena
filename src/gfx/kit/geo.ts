// 造型用的几何工具：椭球、胶囊、车削、弯管（毛束、尾巴、发束）、挤出形状，以及弯曲、扭转、噪声等变形。
// 单位是米；每个函数返回带法线的 BufferGeometry，由 rig.ts 合并进蒙皮模型。
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];

const tmp = new THREE.Vector3();

/** 细分程度：1 = 展示用（特写、图鉴）；战斗里十几只同屏时用更低的值。 */
let detail = 1;

/** 在给定细分程度下执行 fn（生成战斗用的低面数蓝图）。 */
export function withDetail<T>(value: number, fn: () => T): T {
  const prev = detail;
  detail = value;
  try {
    return fn();
  } finally {
    detail = prev;
  }
}

/** 按细分程度缩放的分段数。 */
export function seg(n: number, min = 3): number {
  return Math.max(min, Math.round(n * detail));
}

export function v3(p: V3 | THREE.Vector3): THREE.Vector3 {
  return Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone();
}

/** 椭球。 */
export function ellipsoid(
  rx: number,
  ry: number,
  rz: number,
  ws = 28,
  hs = 18,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg(ws, 8), seg(hs, 6));
  g.scale(rx, ry, rz);
  return g;
}

/** 球体的一部分（按纬度截取），用于头发的发帽、帽子、贝壳等。 */
export function sphereCap(
  r: number,
  thetaLength: number,
  ws = 28,
  hs = 14,
  thetaStart = 0,
): THREE.BufferGeometry {
  return new THREE.SphereGeometry(
    r,
    seg(ws, 8),
    seg(hs, 4),
    0,
    Math.PI * 2,
    thetaStart,
    thetaLength,
  );
}

/**
 * 两端半径不同的胶囊，沿 +Y：底部球心在 y=0，顶部球心在 y=len。
 */
export function capsule(
  len: number,
  r0: number,
  r1: number,
  radial = 16,
  capSeg = 6,
): THREE.BufferGeometry {
  // 两个球之间用外公切线连接。
  const d = Math.max(len, 1e-4);
  const s = Math.max(-0.99, Math.min(0.99, (r0 - r1) / d));
  const a = Math.asin(s);
  const pts: THREE.Vector2[] = [];
  // 底部半球：从最底点走到切点。
  for (let i = 0; i <= capSeg; i++) {
    const t = -Math.PI / 2 + ((Math.PI / 2 + a) * i) / capSeg;
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(t) * r0), Math.sin(t) * r0));
  }
  for (let i = 0; i <= capSeg; i++) {
    const t = a + ((Math.PI / 2 - a) * i) / capSeg;
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(t) * r1), d + Math.sin(t) * r1));
  }
  pts[0] = new THREE.Vector2(1e-4, -r0);
  pts[pts.length - 1] = new THREE.Vector2(1e-4, d + r1);
  const g = new THREE.LatheGeometry(pts, seg(radial, 6));
  return g;
}

/** 把沿 +Y 的几何体摆到 a → b 之间（用于四肢）。 */
export function alignY(g: THREE.BufferGeometry, a: V3, b: V3): THREE.BufferGeometry {
  const pa = v3(a);
  const pb = v3(b);
  const dir = pb.clone().sub(pa);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(pa.x, pa.y, pa.z);
  return g;
}

/** 从 a 到 b 的胶囊（四肢、手指、角）。 */
export function limb(a: V3, b: V3, r0: number, r1 = r0, radial = 14): THREE.BufferGeometry {
  const len = v3(a).distanceTo(v3(b));
  return alignY(capsule(len, r0, r1, radial), a, b);
}

/**
 * 车削：profile 是 [半径, 高度] 列表（从下到上），可选平滑。
 * squash 把横截面压成椭圆（z 方向缩放）。
 */
export function lathe(
  profile: Array<[number, number]>,
  options: {
    segments?: number;
    smooth?: number;
    squash?: number;
    phiStart?: number;
    phiLength?: number;
  } = {},
): THREE.BufferGeometry {
  let pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  if (options.smooth && options.smooth > 1 && pts.length > 2) {
    const curve = new THREE.SplineCurve(pts);
    pts = curve.getPoints((pts.length - 1) * options.smooth);
    pts = pts.map((p) => new THREE.Vector2(Math.max(p.x, 1e-4), p.y));
  }
  const g = new THREE.LatheGeometry(
    pts,
    seg(options.segments ?? 28, 6),
    options.phiStart ?? 0,
    options.phiLength ?? Math.PI * 2,
  );
  if (options.squash && options.squash !== 1) g.scale(1, 1, options.squash);
  g.computeVertexNormals();
  return g;
}

export interface TubeOptions {
  /** 半径：常数，或沿长度 t∈[0,1] 的函数。 */
  radius: number | ((t: number) => number);
  /** 截面宽高比（>1 扁平，用于发束、叶片）。 */
  flat?: number;
  radial?: number;
  segments?: number;
  /** 截面绕切线的扭转（弧度，沿全长线性变化）。 */
  twist?: number;
  /** 截面“上”方向的参考（决定扁平方向）。 */
  up?: V3;
  /** 两端封口（半径为 0 的尖端不需要）。 */
  caps?: boolean;
}

/**
 * 沿曲线的管子（尾巴、毛束、发束、藤蔓、触角）。额外写入 't' 属性（0 → 1 沿长度），便于做渐变色。
 */
export function tube(points: V3[], options: TubeOptions): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => v3(p)),
    false,
    'centripetal',
  );
  const segs = seg(options.segments ?? Math.max(8, points.length * 6), 4);
  const radial = seg(options.radial ?? 10, 4);
  const flat = options.flat ?? 1;
  const twist = options.twist ?? 0;
  const radiusAt =
    typeof options.radius === 'number' ? () => options.radius as number : options.radius;
  const upRef = v3(options.up ?? [0, 1, 0]).normalize();

  // 平行移动标架，避免 Frenet 标架在直线段上乱转。
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) tangents.push(curve.getTangentAt(i / segs).normalize());
  let n = upRef
    .clone()
    .sub(
      tmp
        .copy(tangents[0] as THREE.Vector3)
        .multiplyScalar(upRef.dot(tangents[0] as THREE.Vector3)),
    );
  if (n.lengthSq() < 1e-6) n = new THREE.Vector3(1, 0, 0).cross(tangents[0] as THREE.Vector3);
  n.normalize();
  for (let i = 0; i <= segs; i++) {
    const t = tangents[i] as THREE.Vector3;
    if (i > 0) {
      const prev = tangents[i - 1] as THREE.Vector3;
      const axis = new THREE.Vector3().crossVectors(prev, t);
      const len = axis.length();
      if (len > 1e-6) {
        axis.divideScalar(len);
        const ang = Math.acos(Math.max(-1, Math.min(1, prev.dot(t))));
        n.applyAxisAngle(axis, ang);
      }
    }
    normals.push(n.clone());
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
  }

  const positions: number[] = [];
  const params: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const center = curve.getPointAt(t);
    const r = Math.max(0, radiusAt(t));
    const rot = twist * t;
    const N = normals[i] as THREE.Vector3;
    const B = binormals[i] as THREE.Vector3;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2 + rot;
      const cx = Math.cos(a) * r * flat;
      const cy = Math.sin(a) * r;
      positions.push(
        center.x + B.x * cx + N.x * cy,
        center.y + B.y * cx + N.y * cy,
        center.z + B.z * cx + N.z * cy,
      );
      params.push(t);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (options.caps) {
    for (const end of [0, segs]) {
      const center = curve.getPointAt(end / segs);
      const ci = positions.length / 3;
      positions.push(center.x, center.y, center.z);
      params.push(end / segs);
      for (let j = 0; j < radial; j++) {
        const a = end * (radial + 1) + j;
        if (end === 0) indices.push(ci, a + 1, a);
        else indices.push(ci, a, a + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('t', new THREE.Float32BufferAttribute(params, 1));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** 常用的锥形半径：根部 r0 到尖端 r1，形状由 power 控制（>1 更早变细）。 */
export function taper(r0: number, r1 = 0, power = 1): (t: number) => number {
  return (t) => r1 + (r0 - r1) * Math.pow(1 - t, power);
}

/** 毛茸茸的尾巴 / 发束半径：根部细、中段鼓、尖端收成尖。 */
export function puff(r: number, root = 0.45, tip = 0.02, peak = 0.45): (t: number) => number {
  return (t) => {
    if (t < peak) {
      const k = t / peak;
      return r * (root + (1 - root) * Math.sin((k * Math.PI) / 2));
    }
    const k = (t - peak) / (1 - peak);
    return tip + (r - tip) * Math.cos((k * Math.PI) / 2);
  };
}

/**
 * 有厚度的车削壳（大衣下摆、披风、裙子、铠甲片）：外层、内层（法线朝里）和两侧切口的边条合成一个封闭体，
 * 从哪边看都不会露出背面。phi 从 +Z（正前方）起算；写入 't'（0 顶部 → 1 底部）便于按高度蒙皮与渐变。
 */
export function shell(
  profile: Array<[number, number]>,
  options: {
    phiStart?: number;
    phiLength?: number;
    segments?: number;
    thickness?: number;
    smooth?: number;
    squash?: number;
    wave?: (phi: number, t: number) => number;
  } = {},
): THREE.BufferGeometry {
  let pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  if (options.smooth && options.smooth > 1 && pts.length > 2)
    pts = new THREE.SplineCurve(pts).getPoints((pts.length - 1) * options.smooth);
  const segN = seg(options.segments ?? 32, 6);
  const phi0 = options.phiStart ?? 0;
  const phiLen = options.phiLength ?? Math.PI * 2;
  const thick = options.thickness ?? 0.008;
  const squash = options.squash ?? 1;
  const closed = phiLen >= Math.PI * 2 - 1e-6;
  const rows = pts.length;
  const top = pts[0] as THREE.Vector2;
  const bottom = pts[rows - 1] as THREE.Vector2;
  const span = Math.abs(bottom.y - top.y) || 1;
  const positions: number[] = [];
  const params: number[] = [];
  const index: number[] = [];
  const cols = segN + 1;
  // 两层：0 外层，1 内层
  for (let layer = 0; layer < 2; layer++) {
    for (let j = 0; j < rows; j++) {
      const p = pts[j] as THREE.Vector2;
      const t = Math.abs(p.y - top.y) / span;
      for (let i = 0; i <= segN; i++) {
        const phi = phi0 + (i / segN) * phiLen;
        const wave = options.wave ? options.wave(phi, t) : 0;
        const r = Math.max(1e-4, p.x + wave - (layer === 1 ? thick : 0));
        positions.push(Math.sin(phi) * r, p.y, Math.cos(phi) * r * squash);
        params.push(t);
      }
    }
  }
  const off = rows * cols;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segN; i++) {
      const a = j * cols + i;
      const b = a + cols;
      index.push(a, b, a + 1, b, b + 1, a + 1);
      index.push(off + a, off + a + 1, off + b, off + b, off + a + 1, off + b + 1);
    }
  }
  // 上下沿与两侧切口的边条
  const edge = (a: number, b: number, c: number, d: number) => index.push(a, b, c, b, d, c);
  for (let i = 0; i < segN; i++) {
    edge(i, off + i, i + 1, off + i + 1);
    const last = (rows - 1) * cols;
    edge(last + i + 1, off + last + i + 1, last + i, off + last + i);
  }
  if (!closed) {
    for (let j = 0; j < rows - 1; j++) {
      const a = j * cols;
      const b = (j + 1) * cols;
      edge(b, off + b, a, off + a);
      edge(a + segN, off + a + segN, b + segN, off + b + segN);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('t', new THREE.Float32BufferAttribute(params, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  // 轮廓方向（从上往下还是从下往上）会影响绕向：检查外层中间一点的法线，朝里就整体翻转。
  const mid = Math.floor(rows / 2) * cols + Math.floor(segN / 2);
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (nrm.getX(mid) * pos.getX(mid) + nrm.getZ(mid) * pos.getZ(mid) < 0) {
    flipWinding(g);
    g.computeVertexNormals();
  }
  return g;
}

/** 挤出二维形状（耳朵、叶片、翅膀、护甲片、刀刃），厚度方向是 z，居中。 */
export function extrude(
  shape: THREE.Shape,
  depth: number,
  bevel = depth * 0.45,
  curveSegments = 10,
): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: detail < 0.8 ? 1 : 3,
    curveSegments: seg(curveSegments, 3),
  });
  g.translate(0, 0, -depth / 2);
  return smoothNormals(g, 0.9);
}

/** 圆润的叶片 / 耳朵轮廓：底宽 w、长 h，尖端在 +Y。bulge 控制侧边鼓起。 */
export function leafShape(w: number, h: number, bulge = 0.6, tipCurl = 0): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.bezierCurveTo(-w * bulge, h * 0.45, -w * 0.18 + tipCurl, h * 0.9, tipCurl, h);
  s.bezierCurveTo(w * 0.18 + tipCurl, h * 0.9, w * bulge, h * 0.45, w / 2, 0);
  s.bezierCurveTo(w * 0.25, -h * 0.06, -w * 0.25, -h * 0.06, -w / 2, 0);
  return s;
}

/** 火苗轮廓（S 形尖端）。 */
export function flameShape(w: number, h: number, lean = 0.15): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(-w * 0.62, h * 0.05, -w * 0.62, h * 0.52, -w * 0.12 + lean * w, h * 0.72);
  s.bezierCurveTo(-w * 0.02 + lean * w, h * 0.82, lean * w * 1.6, h * 0.9, lean * w * 1.2, h);
  s.bezierCurveTo(w * 0.45 + lean * w, h * 0.72, w * 0.62, h * 0.4, w * 0.5, h * 0.2);
  s.bezierCurveTo(w * 0.4, h * 0.02, w * 0.2, -h * 0.02, 0, 0);
  return s;
}

/** 羽毛 / 刀刃一类的细长尖形。 */
export function bladeShape(w: number, h: number, curve = 0): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.quadraticCurveTo(-w / 2 + curve * w, h * 0.7, curve * w * 1.4, h);
  s.quadraticCurveTo(w / 2 + curve * w * 0.4, h * 0.55, w / 2, 0);
  s.lineTo(-w / 2, 0);
  return s;
}

/** 平移、旋转（欧拉角，弧度）、缩放。返回同一个几何体。 */
export function place(
  g: THREE.BufferGeometry,
  pos: V3 = [0, 0, 0],
  rot: V3 = [0, 0, 0],
  scale: V3 | number = 1,
): THREE.BufferGeometry {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')),
    new THREE.Vector3(s[0], s[1], s[2]),
  );
  g.applyMatrix4(m);
  if (s[0] * s[1] * s[2] < 0) flipWinding(g);
  return g;
}

/** x 取反得到对称件（左右耳、左右手）。 */
export function mirrored(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  flipWinding(m);
  return m;
}

export function flipWinding(g: THREE.BufferGeometry): void {
  const index = g.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1] as number;
      arr[i + 1] = arr[i + 2] as number;
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
  } else {
    const pos = g.getAttribute('position');
    const count = pos.count;
    const attrs = Object.values(g.attributes);
    for (let i = 0; i < count; i += 3) {
      for (const attr of attrs) {
        const a = attr as THREE.BufferAttribute;
        for (let k = 0; k < a.itemSize; k++) {
          const x = a.getComponent(i + 1, k);
          a.setComponent(i + 1, k, a.getComponent(i + 2, k));
          a.setComponent(i + 2, k, x);
        }
        a.needsUpdate = true;
      }
    }
  }
}

/** 用函数移动每个顶点（local 坐标），之后重算平滑法线。 */
export function deform(
  g: THREE.BufferGeometry,
  fn: (p: THREE.Vector3, i: number) => void,
  recomputeNormals = true,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p, i);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  if (recomputeNormals) g.computeVertexNormals();
  return g;
}

/** 沿 y 方向把几何体向 z 弯曲（弧度 / 米）。 */
export function bendZ(g: THREE.BufferGeometry, perMeter: number): THREE.BufferGeometry {
  return deform(g, (p) => {
    const ang = p.y * perMeter;
    const r = 1 / (perMeter || 1e-6);
    if (Math.abs(perMeter) < 1e-6) return;
    const z = p.z;
    const y = p.y;
    p.y = Math.sin(ang) * (r - z);
    p.z = r - Math.cos(ang) * (r - z);
    void y;
  });
}

/** 平滑法线：合并位置相同的顶点后重算（挤出体的接缝不再发硬）。 */
export function smoothNormals(g: THREE.BufferGeometry, keepSharp = 0): THREE.BufferGeometry {
  let geo = g;
  geo.deleteAttribute('uv');
  if (keepSharp > 0) {
    geo = mergeVertices(geo, 1e-5);
    geo.computeVertexNormals();
    return geo;
  }
  geo = mergeVertices(geo, 1e-5);
  geo.computeVertexNormals();
  return geo;
}

/** 简单的确定性伪随机（造型里的随机摆放都用它，保证每次生成一样）。 */
export function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** 三维值噪声（造型用的起伏）。 */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number, c: number) => {
    let n = a * 374761393 + b * 668265263 + c * 1274126177;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(
      lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u),
      lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u),
      v,
    ),
    lerp(
      lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u),
      lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}

/** 岩石感：沿法线方向按噪声推拉顶点（低多边形棱角可用 flat 着色）。 */
export function rocky(
  g: THREE.BufferGeometry,
  amp: number,
  freq: number,
  seed = 1,
): THREE.BufferGeometry {
  const merged = mergeVertices(g.deleteAttribute('uv') ?? g, 1e-5);
  merged.computeVertexNormals();
  const nrm = merged.getAttribute('normal') as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  deform(
    merged,
    (p, i) => {
      n.fromBufferAttribute(nrm, i);
      const k = noise3(p.x * freq + seed, p.y * freq, p.z * freq) - 0.5;
      p.addScaledVector(n, k * amp);
    },
    true,
  );
  return merged;
}

/** 转成非索引几何并按面计算法线（棱角分明的水晶、岩块）。 */
export function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  f.deleteAttribute('normal');
  f.computeVertexNormals();
  return f;
}
