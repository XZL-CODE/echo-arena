// 立体特效：有厚度的弧形刀刃、冲击波球壳、龙卷、体积火球、水花冠、雷电球、飞行剑气、螺旋光带。
// 都是真正的三维网格，换个机位（特写、绕拍）看也成立；亮部超过 1 会进入泛光。
// 每个函数返回一个交给 Effects 管理寿命的对象。
import * as THREE from 'three';
import { NOISE_GLSL } from '../toon.js';

export interface Live {
  obj: THREE.Object3D;
  age: number;
  life: number;
  tick(k: number, dt: number, age: number): void;
  dispose(): void;
}

const FRESNEL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vUv = uv;
    vP = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

function glowMaterial(
  uniforms: Record<string, THREE.IUniform>,
  fragment: string,
  vertex = FRESNEL_VERT,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function hdr(color: THREE.ColorRepresentation, k: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(k);
}

// ---------------------------------------------------------------- 弧形刀刃

/**
 * 刀刃的几何：沿弧 u（0→1）、横向 v（内缘 0 → 刃口 1）。中段宽而厚、两头尖、刃口薄，
 * 上下两层合成一个透镜状的实体。弧在局部 XY 平面里，从 -arc/2 扫到 +arc/2。
 */
export function bladeGeometry(
  radius: number,
  arc: number,
  width: number,
  thickness: number,
): THREE.BufferGeometry {
  const NU = 40;
  const NV = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const th = -arc / 2 + u * arc;
      const su = Math.sin(Math.PI * u);
      const w = width * Math.pow(su, 0.6);
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const r = radius - w * (1 - v);
        const t = thickness * Math.pow(su, 0.8) * Math.pow(Math.sin(Math.PI * v), 0.6) * side;
        pos.push(Math.cos(th) * r, Math.sin(th) * r, t);
        uv.push(u, v);
      }
    }
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const a = base + i * (NV + 1) + j;
        const b = a + NV + 1;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const BLADE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uHead;
  uniform float uAlpha;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    // 刀光从弧的一端扫到另一端：前沿最亮，后面拖着渐隐的尾巴
    float d = uHead - vUv.x;
    float trail = smoothstep(-0.03, 0.0, d) * (1.0 - smoothstep(0.0, 0.85, d));
    float edge = smoothstep(0.45, 1.0, vUv.y);
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
    float head = 1.0 - smoothstep(0.0, 0.22, d);
    vec3 col = mix(uColor, uCore, clamp(edge * 0.75 + head * 0.35, 0.0, 1.0));
    float a = trail * (0.28 + 0.72 * edge + 0.45 * fres) * uAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;

export interface BladeOptions {
  arc?: number;
  tilt?: number;
  y?: number;
  /** 刀刃宽度（占半径的比例）。 */
  width?: number;
  /** 刀刃厚度（米）。 */
  thickness?: number;
  intensity?: number;
  /** 扫过时绕自身再转多少（弧度），显得有挥动感。 */
  sweep?: number;
  gentle?: boolean;
}

/** 弧形刀刃：一段有厚度的月牙形能量刃，从一端扫到另一端再散去。 */
export function bladeArc(
  at: THREE.Vector3,
  yaw: number,
  radius: number,
  color: THREE.ColorRepresentation,
  dur: number,
  o: BladeOptions = {},
): Live {
  const arc = o.arc ?? 2.4;
  const geo = bladeGeometry(radius, arc, radius * (o.width ?? 0.34), o.thickness ?? radius * 0.07);
  const k = (o.intensity ?? 2.6) * (o.gentle ? 0.6 : 1);
  const mat = glowMaterial(
    {
      uColor: { value: hdr(color, k) },
      uCore: { value: hdr(0xffffff, k * 1.1) },
      uHead: { value: 0 },
      uAlpha: { value: 1 },
    },
    BLADE_FRAG,
  );
  const mesh = new THREE.Mesh(geo, mat);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.position.copy(at);
  pivot.position.y += o.y ?? 0.6;
  pivot.rotation.order = 'YXZ';
  pivot.rotation.set(-Math.PI / 2 + (o.tilt ?? 0), yaw, 0);
  const sweep = o.sweep ?? 0.35;
  return {
    obj: pivot,
    age: 0,
    life: dur,
    tick: (t) => {
      mat.uniforms.uHead.value = Math.min(1.9, t * 2.4);
      mat.uniforms.uAlpha.value = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      mesh.rotation.z = -sweep * 0.5 + sweep * Math.min(1, t * 1.6);
      pivot.scale.setScalar(1 + t * 0.18);
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** 飞行剑气：竖起的月牙刃从 from 飞到 to，身后跟着几道残影。 */
export function crescent(
  from: THREE.Vector3,
  to: THREE.Vector3,
  size: number,
  color: THREE.ColorRepresentation,
  dur: number,
  gentle = false,
): Live {
  const geo = bladeGeometry(size, 2.2, size * 0.4, size * 0.09);
  const group = new THREE.Group();
  const yaw = Math.atan2(to.x - from.x, to.z - from.z);
  const ghosts: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial; lag: number }> = [];
  const k = 2.8 * (gentle ? 0.6 : 1);
  for (let i = 0; i < 4; i++) {
    const mat = glowMaterial(
      {
        uColor: { value: hdr(color, k * (1 - i * 0.22)) },
        uCore: { value: hdr(0xffffff, k * (1 - i * 0.22)) },
        uHead: { value: 1.2 },
        uAlpha: { value: 1 - i * 0.24 },
      },
      BLADE_FRAG,
    );
    const mesh = new THREE.Mesh(geo, mat);
    // 月牙竖着、凸面朝前
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(0, yaw - Math.PI / 2, Math.PI / 2);
    group.add(mesh);
    ghosts.push({ mesh, mat, lag: i * 0.045 });
  }
  const p = new THREE.Vector3();
  return {
    obj: group,
    age: 0,
    life: dur,
    tick: (t, _dt, age) => {
      for (const g of ghosts) {
        const e = Math.max(0, Math.min(1, (age - g.lag) / (dur * 0.85)));
        p.copy(from).lerp(to, e);
        g.mesh.position.copy(p);
        g.mesh.scale.setScalar(0.8 + e * 0.5);
        g.mat.uniforms.uAlpha.value =
          (1 - ghosts.indexOf(g) * 0.24) * (t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2);
      }
    },
    dispose: () => {
      geo.dispose();
      for (const g of ghosts) g.mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- 冲击波球壳

/** 冲击波：一层透明的气浪球壳（半球贴地），边缘亮，从 r0 胀到 r1。 */
export function shockShell(
  at: THREE.Vector3,
  r0: number,
  r1: number,
  color: THREE.ColorRepresentation,
  dur: number,
  o: { hemisphere?: boolean; intensity?: number; gentle?: boolean } = {},
): Live {
  const geo = new THREE.SphereGeometry(
    1,
    40,
    20,
    0,
    Math.PI * 2,
    0,
    o.hemisphere === false ? Math.PI : Math.PI / 2,
  );
  const mat = glowMaterial(
    {
      uColor: { value: hdr(color, (o.intensity ?? 1.2) * (o.gentle ? 0.6 : 1)) },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
    },
    /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      ${NOISE_GLSL}
      void main() {
        // 只有边缘一圈亮（气浪的轮廓），中间几乎透明
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        float n = vnoise(vP * 5.0 + vec3(0.0, uTime * 3.0, 0.0));
        float ground = smoothstep(0.0, 0.25, vP.y + 0.02);
        float a = fres * (0.6 + 0.6 * n) * uAlpha * (0.5 + 0.5 * ground);
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(at);
  return {
    obj: mesh,
    age: 0,
    life: dur,
    tick: (t, _dt, age) => {
      const e = 1 - Math.pow(1 - t, 3);
      const r = r0 + (r1 - r0) * e;
      mesh.scale.set(r, r * 0.8, r);
      mat.uniforms.uTime.value = age;
      mat.uniforms.uAlpha.value = Math.pow(1 - t, 2);
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** 竖起的冲击环带：一圈矮墙似的光带向外扩散（落地重击、震地）。 */
export function shockBand(
  at: THREE.Vector3,
  r0: number,
  r1: number,
  height: number,
  color: THREE.ColorRepresentation,
  dur: number,
  gentle = false,
): Live {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true);
  geo.translate(0, 0.5, 0);
  const mat = glowMaterial(
    {
      uColor: { value: hdr(color, 2.2 * (gentle ? 0.6 : 1)) },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
    },
    /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uTime;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        float n = vnoise(vec3(vUv.x * 40.0, vUv.y * 3.0 - uTime * 4.0, 0.0));
        float a = (1.0 - vUv.y) * (1.0 - vUv.y) * (0.5 + 0.7 * n) * uAlpha;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(at);
  return {
    obj: mesh,
    age: 0,
    life: dur,
    tick: (t, _dt, age) => {
      const e = 1 - Math.pow(1 - t, 2.5);
      const r = r0 + (r1 - r0) * e;
      mesh.scale.set(r, height * (1 - t * 0.6), r);
      mat.uniforms.uTime.value = age;
      mat.uniforms.uAlpha.value = 1 - t;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- 龙卷与螺旋光带

/** 沿螺旋线的一条光带：s 从下到上，半径从 r0 到 r1。 */
function helixRibbon(
  r0: number,
  r1: number,
  height: number,
  turns: number,
  width: number,
  phase: number,
): THREE.BufferGeometry {
  const N = 80;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const a = phase + s * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * s;
    const y = s * height;
    const w = width * (0.4 + 0.6 * Math.sin(Math.PI * s));
    pos.push(
      Math.cos(a) * r,
      y - w / 2,
      Math.sin(a) * r,
      Math.cos(a) * (r + w * 0.3),
      y + w / 2,
      Math.sin(a) * (r + w * 0.3),
    );
    uv.push(s, 0, s, 1);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uSpeed;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float s = vUv.x;
    float flow = fract(s * 2.5 - uTime * uSpeed);
    float streak = smoothstep(0.0, 0.25, flow) * (1.0 - smoothstep(0.55, 1.0, flow));
    float across = sin(vUv.y * 3.14159);
    float ends = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.85, 1.0, s));
    float n = vnoise(vec3(s * 18.0, vUv.y * 2.0, uTime * 2.0));
    float a = (0.25 + 0.9 * streak) * across * ends * (0.6 + 0.6 * n) * uAlpha;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** 龙卷：几条螺旋光带绕着上升 + 一层半透明的旋转气锥。 */
export function vortex(
  at: THREE.Vector3,
  radius: number,
  height: number,
  color: THREE.ColorRepresentation,
  dur: number,
  o: { ribbons?: number; turns?: number; spin?: number; intensity?: number; gentle?: boolean } = {},
): Live {
  const group = new THREE.Group();
  group.position.copy(at);
  const k = (o.intensity ?? 1.5) * (o.gentle ? 0.6 : 1);
  const n = o.ribbons ?? 3;
  const mats: THREE.ShaderMaterial[] = [];
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = helixRibbon(
      radius * 0.35,
      radius,
      height,
      o.turns ?? 1.6,
      height * 0.11,
      (i / n) * Math.PI * 2,
    );
    const m = glowMaterial(
      {
        uColor: { value: hdr(color, k) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uSpeed: { value: 1.6 },
      },
      RIBBON_FRAG,
    );
    group.add(new THREE.Mesh(g, m));
    mats.push(m);
    geos.push(g);
  }
  // 气锥
  const cone = new THREE.CylinderGeometry(radius * 0.95, radius * 0.3, height, 36, 1, true);
  cone.translate(0, height / 2, 0);
  const coneMat = glowMaterial(
    { uColor: { value: hdr(color, k * 0.35) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      ${NOISE_GLSL}
      void main() {
        float n = fbm3(vec3(vUv.x * 8.0 - uTime * 2.5, vUv.y * 3.0 - uTime * 1.5, 0.0));
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
        float a = smoothstep(0.35, 0.8, n) * (0.4 + fres) * sin(vUv.y * 3.14159) * uAlpha;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  );
  group.add(new THREE.Mesh(cone, coneMat));
  mats.push(coneMat);
  geos.push(cone);
  const spin = o.spin ?? 5;
  return {
    obj: group,
    age: 0,
    life: dur,
    tick: (t, dt, age) => {
      group.rotation.y += spin * dt;
      const inK = Math.min(1, t * 6);
      const out = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      group.scale.set(0.6 + 0.4 * inK, inK, 0.6 + 0.4 * inK);
      for (const m of mats) {
        m.uniforms.uTime.value = age;
        m.uniforms.uAlpha.value = inK * out;
      }
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

/** 螺旋光带绕身上升（蓄力、光柱外圈）。 */
export function spiral(
  at: THREE.Vector3,
  radius: number,
  height: number,
  color: THREE.ColorRepresentation,
  dur: number,
  gentle = false,
): Live {
  const group = new THREE.Group();
  group.position.copy(at);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < 2; i++) {
    const g = helixRibbon(radius, radius * 0.75, height, 2.2, 0.12, i * Math.PI);
    const m = glowMaterial(
      {
        uColor: { value: hdr(color, 2.4 * (gentle ? 0.6 : 1)) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uSpeed: { value: 2.4 },
      },
      RIBBON_FRAG,
    );
    group.add(new THREE.Mesh(g, m));
    geos.push(g);
    mats.push(m);
  }
  return {
    obj: group,
    age: 0,
    life: dur,
    tick: (t, dt, age) => {
      group.rotation.y += dt * 4;
      const inK = Math.min(1, t * 5);
      const out = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      group.scale.set(1, inK, 1);
      for (const m of mats) {
        m.uniforms.uTime.value = age;
        m.uniforms.uAlpha.value = inK * out;
      }
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

// ---------------------------------------------------------------- 体积火球

/**
 * 爆炸火球：翻滚的噪声球体，颜色从白热核心到橙红再到黑烟，边缘按噪声烧蚀消散。
 * hot / mid / smoke 可以换成别的元素配色（毒雾、冰爆）。
 */
export function fireball(
  at: THREE.Vector3,
  radius: number,
  dur: number,
  o: {
    hot?: THREE.ColorRepresentation;
    mid?: THREE.ColorRepresentation;
    smoke?: THREE.ColorRepresentation;
    gentle?: boolean;
  } = {},
): Live {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uK: { value: 0 },
      uHot: { value: hdr(o.hot ?? 0xfff0b0, o.gentle ? 1.6 : 3.2) },
      uMid: { value: hdr(o.mid ?? 0xff6a1a, o.gentle ? 1.2 : 2.2) },
      uSmoke: { value: new THREE.Color(o.smoke ?? 0x2a1c1c) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uK;
      varying vec3 vP;
      varying float vN;
      ${NOISE_GLSL}
      void main() {
        vec3 p = position;
        float n = fbm3(p * 2.2 + vec3(0.0, -uTime * 1.6, uTime * 0.4));
        vN = n;
        vP = p;
        p *= 1.0 + (n - 0.5) * (0.55 + uK * 0.4);
        p.y *= 1.0 + uK * 0.25;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uK;
      uniform vec3 uHot;
      uniform vec3 uMid;
      uniform vec3 uSmoke;
      varying vec3 vP;
      varying float vN;
      ${NOISE_GLSL}
      void main() {
        float n = vN * 0.7 + vnoise(vP * 6.0) * 0.3;
        // 随时间从中心烧穿：噪声低的地方先消失
        if (n < uK * 1.05 - 0.12) discard;
        float heat = clamp(1.25 - uK * 1.5 + (n - 0.5) * 1.2, 0.0, 1.0);
        vec3 col = mix(uSmoke, uMid, smoothstep(0.1, 0.5, heat));
        col = mix(col, uHot, smoothstep(0.55, 0.95, heat));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(at);
  const y0 = at.y;
  return {
    obj: mesh,
    age: 0,
    life: dur,
    tick: (t, _dt, age) => {
      const grow = 1 - Math.pow(1 - Math.min(1, t * 2.2), 3);
      mesh.scale.setScalar(radius * (0.35 + 0.75 * grow + t * 0.25));
      mesh.position.y = y0 + t * radius * 0.6;
      mesh.rotation.y = age * 0.6;
      mat.uniforms.uTime.value = age;
      mat.uniforms.uK.value = t;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- 水花冠

/** 水花冠：一圈往外翻、顶上碎成水指的水墙。 */
export function splashCrown(
  at: THREE.Vector3,
  radius: number,
  color: THREE.ColorRepresentation,
  dur: number,
): Live {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 6, true);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: hdr(color, 1.4) }, uK: { value: 0 }, uR: { value: radius } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uK;
      uniform float uR;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float e = 1.0 - pow(1.0 - uK, 2.0);
        float r = uR * (0.35 + 0.8 * e) * (1.0 + uv.y * 0.45 * e);
        float h = uR * 0.9 * sin(min(1.0, uK * 1.6) * 3.14159 * 0.5) * (1.0 - uK * 0.5);
        p.xz *= r;
        p.y *= h;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uK;
      varying vec2 vUv;
      float h1(float x) { return fract(sin(x * 91.7) * 43758.5); }
      void main() {
        // 顶边碎成一根根水指
        float cell = floor(vUv.x * 36.0);
        float finger = 0.55 + 0.45 * h1(cell);
        float fx = abs(fract(vUv.x * 36.0) - 0.5) * 2.0;
        float top = finger * (1.0 - fx * fx * 0.6);
        if (vUv.y > top) discard;
        float a = (0.35 + 0.5 * vUv.y) * (1.0 - uK);
        vec3 c = mix(uColor * 0.7, uColor * 1.5, vUv.y);
        gl_FragColor = vec4(c, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(at);
  return {
    obj: mesh,
    age: 0,
    life: dur,
    tick: (t) => {
      mat.uniforms.uK.value = t;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- 雷电球

/** 雷电球：球面上游走的电弧纹，闪烁着胀大再收缩。 */
export function electricOrb(
  at: THREE.Vector3,
  radius: number,
  color: THREE.ColorRepresentation,
  dur: number,
  gentle = false,
): Live {
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const mat = glowMaterial(
    { uColor: { value: hdr(color, gentle ? 1.6 : 3) }, uAlpha: { value: 1 }, uTime: { value: 0 } },
    /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      ${NOISE_GLSL}
      void main() {
        float t = floor(uTime * 20.0);
        float n = vnoise(vP * 4.0 + vec3(t * 1.7, t * 0.9, 0.0));
        float arc = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float a = (arc * 1.2 + fres * 0.5 + 0.06) * uAlpha;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(at);
  return {
    obj: mesh,
    age: 0,
    life: dur,
    tick: (t, _dt, age) => {
      const s = radius * (t < 0.2 ? 0.4 + 3 * t : 1 + 0.08 * Math.sin(age * 30));
      mesh.scale.setScalar(s * (t > 0.8 ? 1 - (t - 0.8) * 3 : 1));
      mat.uniforms.uTime.value = gentle ? 0 : age;
      mat.uniforms.uAlpha.value = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- 结界

/** 结界显形：场地边缘被撞到的地方亮起一片六角格纹的光墙，波纹从撞击点扩散开再淡去。 */
export function barrierFlash(
  at: THREE.Vector3,
  normal: THREE.Vector3,
  color: THREE.ColorRepresentation,
  dur: number,
  gentle = false,
): Live {
  const w = 3.2;
  const h = 2.2;
  const geo = new THREE.PlaneGeometry(w, h, 1, 1);
  geo.translate(0, h / 2, 0);
  const mat = glowMaterial(
    {
      uColor: { value: hdr(color, gentle ? 1.2 : 2.2) },
      uK: { value: 0 },
      uHit: { value: new THREE.Vector2(0.5, Math.min(0.9, at.y / h)) },
    },
    /* glsl */ `
      uniform vec3 uColor;
      uniform float uK;
      uniform vec2 uHit;
      varying vec2 vUv;
      // 六角格：到最近格心的距离
      vec2 hexCell(vec2 p) {
        vec2 r = vec2(1.0, 1.732);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        return dot(a, a) < dot(b, b) ? a : b;
      }
      void main() {
        vec2 p = vec2(vUv.x * 3.2, vUv.y * 2.2) * 3.2;
        vec2 c = hexCell(p);
        float edge = smoothstep(0.36, 0.46, max(abs(c.x) * 0.866 + abs(c.y) * 0.5, abs(c.y)));
        vec2 d = (vUv - uHit) * vec2(3.2, 2.2);
        float dist = length(d);
        float wave = 1.0 - smoothstep(0.0, 0.25, abs(dist - uK * 2.2));
        float fall = 1.0 - smoothstep(0.2, 1.6, dist);
        float a = (edge * (0.35 + wave) * fall + wave * 0.3 * fall) * (1.0 - uK);
        a *= smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x) * smoothstep(1.0, 0.8, vUv.y);
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(at.x, 0, at.z);
  mesh.lookAt(at.x + normal.x, 0, at.z + normal.z);
  return {
    obj: mesh,
    age: 0,
    life: dur,
    tick: (t) => {
      mat.uniforms.uK.value = t;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
