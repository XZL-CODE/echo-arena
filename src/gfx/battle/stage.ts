// 野外战场：没有擂台和围墙，一片开阔地形延伸到远处。中间是平坦的交战区，往外慢慢起伏成丘陵和远山；
// 按主题（草原、火山、海滩、雷暴高原、峡谷、云上遗迹）换地表花纹、草丛、布景、天空与环境粒子。
// 交战区边缘是一道平时看不见的结界，有人被撞上去时由特效显形。
import * as THREE from 'three';
import { tickSharedFlames } from '../kit/attachments.js';
import { faceted, noise3, rocky } from '../kit/geo.js';
import { applyPreset, createLights, type LightPreset, type LightRig } from '../lighting.js';
import { NOISE_GLSL, outlineMaterial, toonMaterial, type ToonUniforms } from '../toon.js';
import { FIELD_PX } from './types.js';

export type StageTheme = 'meadow' | 'volcano' | 'lagoon' | 'storm' | 'canyon' | 'temple';

/** 交战区在世界里的尺寸（米），跟着规则层的场地大小走。 */
export const FIELD = {
  get width(): number {
    return FIELD_PX.width / 100;
  },
  get depth(): number {
    return FIELD_PX.height / 100;
  },
};

/** 地表花纹。 */
const PATTERN = { grass: 0, lava: 1, sand: 2, highland: 3, sandstone: 4, slabs: 5 } as const;

interface ThemeDef {
  sky: [string, string, string];
  fog: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
  light: LightPreset;
  /** 地表：主色、杂色（花纹里的第二种颜色）、远处丘陵色。 */
  ground: [number, number, number];
  pattern: number;
  /** 地缝、石板缝的发光色（0 表示不发光）。 */
  glow: number;
  /** 草丛：颜色、密度（每平方米大约几丛）、高度。 */
  grass: { colors: number[]; density: number; height: number } | null;
  motes: { color: THREE.ColorRepresentation; rise: number; count: number; size: number };
}

const THEMES: Record<StageTheme, ThemeDef> = {
  meadow: {
    sky: ['#5a9cff', '#a8d4ff', '#fff0d8'],
    fog: 0xcfe4f0,
    fogNear: 30,
    fogFar: 95,
    light: {
      sky: 0xd4e6ff,
      ground: 0x5e6a56,
      hemi: 1.1,
      key: 0xfff0dc,
      keyIntensity: 3.1,
      dir: [-0.45, 0.8, 0.5],
    },
    ground: [0x62a048, 0x80b458, 0x4a8440],
    pattern: PATTERN.grass,
    glow: 0,
    grass: {
      colors: [0x4e9a38, 0x6ab044, 0x3e8a36, 0x7ab84e, 0x5a9a40],
      density: 14,
      height: 0.26,
    },
    motes: { color: 0xfff6b0, rise: 0.15, count: 90, size: 0.05 },
  },
  volcano: {
    sky: ['#1e0a14', '#5a1a18', '#ff7a2a'],
    fog: 0x3a1614,
    fogNear: 24,
    fogFar: 80,
    light: {
      sky: 0xffb08a,
      ground: 0x3a1a2a,
      hemi: 0.95,
      key: 0xffd0a0,
      keyIntensity: 3.0,
      dir: [-0.3, 0.8, 0.5],
    },
    ground: [0x3a2c2a, 0x4e3a34, 0x2a1c1c],
    pattern: PATTERN.lava,
    glow: 0xff5a14,
    grass: { colors: [0x5a3a28, 0x4a2e22, 0x6a4430], density: 1.2, height: 0.26 },
    motes: { color: 0xff8a3a, rise: 0.6, count: 140, size: 0.045 },
  },
  lagoon: {
    sky: ['#2a7ad8', '#8fd0ff', '#f0fcff'],
    fog: 0xc8ecff,
    fogNear: 30,
    fogFar: 100,
    light: {
      sky: 0xd0ecff,
      ground: 0x6a7a8a,
      hemi: 1.15,
      key: 0xfff4e4,
      keyIntensity: 3.0,
      dir: [-0.5, 0.8, 0.4],
    },
    ground: [0xe8d8b0, 0xf4e8c8, 0xd0bc90],
    pattern: PATTERN.sand,
    glow: 0,
    grass: { colors: [0x9ac06a, 0xb0c878, 0x88b060], density: 1.4, height: 0.4 },
    motes: { color: 0xbff4ff, rise: 0.3, count: 70, size: 0.05 },
  },
  storm: {
    sky: ['#120e2a', '#34285e', '#6a5aa0'],
    fog: 0x2a2648,
    fogNear: 22,
    fogFar: 80,
    light: {
      sky: 0xb8b0ff,
      ground: 0x2a2440,
      hemi: 1.0,
      key: 0xe8e0ff,
      keyIntensity: 2.9,
      dir: [-0.4, 0.8, 0.5],
    },
    ground: [0x4a6048, 0x5e6068, 0x3a4a3c],
    pattern: PATTERN.highland,
    glow: 0x9ad8ff,
    grass: { colors: [0x4a6a4a, 0x3a5a44, 0x5a7a54], density: 6, height: 0.36 },
    motes: { color: 0x9ad8ff, rise: 0.25, count: 70, size: 0.04 },
  },
  canyon: {
    sky: ['#ff8a5a', '#ffc896', '#fff0d8'],
    fog: 0xf0c8a0,
    fogNear: 28,
    fogFar: 90,
    light: {
      sky: 0xffe0c0,
      ground: 0x6a4a3a,
      hemi: 1.05,
      key: 0xfff0d8,
      keyIntensity: 3.1,
      dir: [-0.5, 0.75, 0.45],
    },
    ground: [0xc8845a, 0xa86a48, 0xb87450],
    pattern: PATTERN.sandstone,
    glow: 0xc88aff,
    grass: { colors: [0xa08a4a, 0x8a7a40, 0xb09a58], density: 1.6, height: 0.3 },
    motes: { color: 0xffe0b0, rise: 0.1, count: 60, size: 0.05 },
  },
  temple: {
    sky: ['#0c0a26', '#3a2270', '#e0a0c0'],
    fog: 0x2a1c50,
    fogNear: 30,
    fogFar: 100,
    light: {
      sky: 0xd8c8ff,
      ground: 0x3a2a4a,
      hemi: 1.05,
      key: 0xfff0d0,
      keyIntensity: 3.1,
      dir: [-0.4, 0.8, 0.5],
    },
    ground: [0xe0d8e8, 0xc8c0d8, 0xb0a8c8],
    pattern: PATTERN.slabs,
    glow: 0xffc84e,
    grass: { colors: [0x6a9a6a, 0x5a8a64], density: 1.2, height: 0.22 },
    motes: { color: 0xffe8a0, rise: 0.2, count: 110, size: 0.05 },
  },
};

export const THEME_OF_ELEMENT: Record<string, StageTheme> = {
  wood: 'meadow',
  fire: 'volcano',
  water: 'lagoon',
  thunder: 'storm',
  rock: 'canyon',
};

// ---------------------------------------------------------------------------

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function fbm2(x: number, z: number, seed = 0): number {
  return (
    noise3(x, seed, z) * 0.55 +
    noise3(x * 2.03 + 11.7, seed, z * 2.03) * 0.3 +
    noise3(x * 4.1 + 3.1, seed, z * 4.1) * 0.15
  );
}

/** 离交战区矩形边缘的距离（区内为 0）。 */
function outside(x: number, z: number, pad = 0): number {
  const dx = Math.max(0, Math.abs(x) - FIELD.width / 2 - pad);
  const dz = Math.max(0, Math.abs(z) - FIELD.depth / 2 - pad);
  return Math.hypot(dx, dz);
}

/** 天空：三段渐变的大球，内侧可见。 */
function skyDome(colors: [string, string, string]): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(0.55, colors[1]);
  grad.addColorStop(1, colors[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: t,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const geo = new THREE.SphereGeometry(150, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
  // 贴图纵向对应仰角：顶部颜色在天顶，底部颜色在地平线
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 150;
    uv.setXY(i, 0.5, Math.max(0, Math.min(1, y * 1.25)));
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  return mesh;
}

/** 环境粒子（花粉、火星、泡泡）：一张点精灵云，在顶点着色器里漂浮。 */
function motes(def: ThemeDef): THREE.Points {
  const n = def.motes.count;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const r = rand(n * 31);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (r() - 0.5) * (FIELD.width + 10);
    pos[i * 3 + 1] = r() * 5;
    pos[i * 3 + 2] = (r() - 0.5) * (FIELD.depth + 8);
    seed[i] = r() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(def.motes.color).multiplyScalar(2.2) },
      uSize: { value: def.motes.size },
      uRise: { value: def.motes.rise },
      uScale: { value: 800 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uSize;
      uniform float uRise;
      uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime + seed;
        p.y = mod(p.y + t * uRise, 5.0);
        p.x += sin(t * 0.7 + seed) * 0.4;
        p.z += cos(t * 0.5 + seed * 1.3) * 0.3;
        vA = smoothstep(0.0, 0.8, p.y) * (1.0 - smoothstep(3.5, 5.0, p.y)) * (0.55 + 0.45 * sin(t * 3.0 + seed));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(uColor * a * vA, a * vA);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** 水面、熔岩面、云海：带流动噪声的大平面。 */
function liquid(kind: 'water' | 'lava' | 'clouds', size: number): THREE.Mesh {
  const body =
    kind === 'water'
      ? `vec3 deep = vec3(0.02, 0.2, 0.44);
        vec3 shallow = vec3(0.14, 0.66, 0.86);
        vec3 col = mix(deep, shallow, smoothstep(0.3, 0.75, n));
        col += vec3(smoothstep(0.78, 0.82, n2) * 0.9);`
      : kind === 'lava'
        ? `vec3 crust = vec3(0.12, 0.03, 0.03);
        vec3 hot = vec3(3.2, 0.9, 0.18);
        float vein = smoothstep(0.52, 0.6, n) * (0.6 + 0.4 * n2);
        vec3 col = mix(crust, hot, vein);`
        : `vec3 low = vec3(0.42, 0.3, 0.62);
        vec3 high = vec3(1.0, 0.86, 0.92);
        vec3 col = mix(low, high, smoothstep(0.35, 0.8, n * 0.7 + n2 * 0.5));`;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec3 vW;
      ${NOISE_GLSL}
      void main() {
        vec2 p = vW.xz;
        float n = fbm3(vec3(p * 0.35, uTime * 0.15));
        float n2 = fbm3(vec3(p * 1.4 + 7.0, uTime * 0.35));
        ${body}
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** 沃罗诺伊（放在噪声函数后面）：x 是到最近两个格点的距离差（近似到格缝的距离），yz 是格子编号。 */
const VORONOI_GLSL = /* glsl */ `
  vec3 voro(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float md = 8.0;
    float md2 = 8.0;
    vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = vec2(hash13(vec3(n + g, 1.0)), hash13(vec3(n + g, 7.0)));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < md) {
          md2 = md;
          md = d;
          id = n + g;
        } else if (d < md2) {
          md2 = d;
        }
      }
    }
    return vec3(sqrt(md2) - sqrt(md), id);
  }
`;

/** 地表材质：卡通光照 + 世界坐标的程序花纹（草地斑驳、熔岩地缝、沙纹、石板……），近看远看都清楚。 */
function groundMaterial(def: ThemeDef, uniforms: ToonUniforms): THREE.MeshToonMaterial {
  const m = toonMaterial({ vertexColors: true, uniforms });
  const base = m.onBeforeCompile;
  const extra = {
    uPattern: { value: def.pattern },
    uAlt: { value: new THREE.Color(def.ground[1]) },
    uGlowColor: { value: new THREE.Color(def.glow || 0x000000) },
  };
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    Object.assign(shader.uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'varying vec3 vObjPos;',
        /* glsl */ `varying vec3 vObjPos;
        varying vec3 vGround;
        uniform int uPattern;
        uniform vec3 uAlt;
        uniform vec3 uGlowColor;`,
      )
      .replace(
        'float fbm3(vec3 p) {',
        /* glsl */ `${VORONOI_GLSL}
        float fbm3(vec3 p) {`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float groundGlow = 0.0;
        {
          vec2 p = vGround.xz;
          float n1 = fbm3(vec3(p * 0.3, 0.0));
          float n2 = vnoise(vec3(p * 2.4, 1.7));
          float n3 = vnoise(vec3(p * 9.0, 3.1));
          vec3 col = diffuseColor.rgb;
          if (uPattern == 0) {
            // 草地：大块深浅 + 细碎斑点 + 几片露土
            col = mix(col, uAlt, smoothstep(0.5, 0.72, fbm3(vec3(p * 0.55, 4.0))) * 0.6);
            col *= 0.84 + 0.2 * n1 + 0.08 * n2 + 0.08 * n3;
            float dirt = smoothstep(0.66, 0.74, fbm3(vec3(p * 0.42, 9.0)));
            col = mix(col, vec3(0.62, 0.5, 0.34) * (0.85 + 0.2 * n3), dirt * 0.75);
          } else if (uPattern == 1) {
            // 玄武岩：不规则的大块，一部分块缝里透出岩浆光，其余是暗缝
            vec3 v = voro(p * 0.5);
            float crack = 1.0 - smoothstep(0.0, 0.05, v.x);
            float fine = 1.0 - smoothstep(0.0, 0.03, voro(p * 1.7 + 5.0).x);
            col = mix(col, uAlt, hash13(vec3(v.yz, 2.0)) * 0.7);
            col *= 0.86 + 0.25 * n2 + 0.12 * n3;
            col *= 1.0 - crack * 0.5 - fine * 0.25;
            float pulse = 0.65 + 0.35 * sin(uTime * 1.3 + v.y * 1.7 + v.z * 2.3);
            groundGlow = crack * pulse * smoothstep(0.58, 0.72, fbm3(vec3(p * 0.2, 1.0))) * 0.6;
          } else if (uPattern == 2) {
            // 沙地：风吹出的波纹 + 湿沙斑
            float ripple = sin(p.x * 4.2 + p.y * 1.6 + fbm3(vec3(p * 0.6, 2.0)) * 7.0);
            col *= 0.94 + 0.06 * ripple + 0.08 * n2 + 0.05 * n3;
            col = mix(col, uAlt, smoothstep(0.55, 0.7, n1) * 0.5);
          } else if (uPattern == 3) {
            // 高原：草与裸岩交错，岩面上有裂缝
            float rock = smoothstep(0.58, 0.64, fbm3(vec3(p * 0.45, 6.0)));
            col *= 0.84 + 0.2 * n1 + 0.1 * n3;
            float seam = 1.0 - smoothstep(0.0, 0.05, voro(p * 1.1).x);
            col = mix(col, uAlt * (0.8 + 0.25 * n2 + 0.15 * n3) * (1.0 - seam * 0.45), rock);
          } else if (uPattern == 4) {
            // 红砂岩：一道道岩层 + 碎石斑点
            float band = sin(p.x * 0.9 + p.y * 0.35 + fbm3(vec3(p * 0.25, 3.0)) * 6.0);
            col = mix(col, uAlt, smoothstep(0.2, 0.9, band) * 0.45);
            col *= 0.86 + 0.14 * n2 + 0.1 * n3;
            col *= 1.0 - smoothstep(0.82, 0.9, n3) * 0.25;
          } else {
            // 石板：不规则的大石板、灰缝、零星青苔，个别石缝里透出金光
            vec3 v = voro(p * 0.7);
            float seam = 1.0 - smoothstep(0.02, 0.07, v.x);
            float tone = hash13(vec3(v.yz, 5.0));
            col = mix(col, uAlt, tone * 0.7);
            col *= 0.9 + 0.1 * n2 + 0.06 * n3;
            col *= 1.0 - seam * 0.45;
            float moss = smoothstep(0.62, 0.72, fbm3(vec3(p * 0.5, 8.0)));
            col = mix(col, vec3(0.42, 0.58, 0.4), moss * 0.35);
            groundGlow = seam * step(0.86, hash13(vec3(v.yz, 9.0))) * (0.6 + 0.4 * sin(uTime * 1.2 + v.y));
          }
          diffuseColor.rgb = col;
        }`,
      )
      .replace(
        'totalEmissiveRadiance += diffuseColor.rgb * vSurf.x * uGlow;',
        'totalEmissiveRadiance += diffuseColor.rgb * vSurf.x * uGlow + uGlowColor * groundGlow * 2.2;',
      );
  };
  m.customProgramCacheKey = () => 'echo-ground';
  return m;
}

/** 草丛材质：随风摆动（实例化），根部深、梢头亮。 */
function grassMaterial(uniforms: ToonUniforms): THREE.MeshToonMaterial {
  const m = toonMaterial({ vertexColors: true, uniforms, side: THREE.DoubleSide });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3]);
        float sway = sin(uTime * 1.7 + ip.x * 0.7 + ip.z * 0.5) + 0.5 * sin(uTime * 3.1 + ip.x * 1.3);
        float h = position.y * position.y * 5.0;
        transformed.x += sway * 0.05 * h;
        transformed.z += cos(uTime * 1.3 + ip.z * 0.9) * 0.03 * h;
      #endif`,
      );
  };
  m.customProgramCacheKey = () => 'echo-grass';
  return m;
}

/** 一丛草：几片弯曲的细叶。颜色属性从根部暗到梢头亮。 */
function tuftGeometry(height: number, blades = 6): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const r = rand(17);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + r() * 0.8;
    const lean = 0.25 + r() * 0.35;
    const h = height * (0.65 + r() * 0.5);
    const w = 0.03 + r() * 0.015;
    const ox = Math.cos(a) * 0.05;
    const oz = Math.sin(a) * 0.05;
    const sx = -Math.sin(a);
    const sz = Math.cos(a);
    const base = pos.length / 3;
    const segs = 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = t * h;
      const out = lean * t * t * h;
      const cx = ox + Math.cos(a) * out;
      const cz = oz + Math.sin(a) * out;
      const ww = w * (1 - t * 0.9);
      pos.push(cx + sx * ww, y, cz + sz * ww, cx - sx * ww, y, cz - sz * ww);
      const k = 0.55 + 0.6 * t;
      col.push(k, k, k, k, k, k);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 草叶法线往上偏，光照柔和（不会一面全黑）
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.set(n.getX(i), n.getY(i) + 1.6, n.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** 一朵小花：五片花瓣 + 花茎。颜色属性让花茎暗、花瓣亮（实例颜色再乘上去）。 */
function flowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.SphereGeometry(0.035, 6, 4);
    p.scale(1, 0.35, 0.6);
    p.translate(Math.cos(a) * 0.035, 0.16, Math.sin(a) * 0.035);
    parts.push(p);
  }
  const stem = new THREE.CylinderGeometry(0.006, 0.008, 0.16, 4);
  stem.translate(0, 0.08, 0);
  parts.push(stem);
  const merged = mergeSimple(parts);
  const col: number[] = [];
  const pos = merged.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getY(i) > 0.13 ? 1 : 0.35;
    col.push(k * (k < 1 ? 0.8 : 1), k, k * (k < 1 ? 0.6 : 1));
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return merged;
}

/** 合并几块只有位置、法线的几何体。 */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const base = pos.length / 3;
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    const pa = p.getAttribute('position') as THREE.BufferAttribute;
    const na = p.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      nrm.push(na.getX(i), na.getY(i), na.getZ(i));
    }
    if (p.index) for (let i = 0; i < p.index.count; i++) idx.push(base + p.index.getX(i));
    else for (let i = 0; i < pa.count; i++) idx.push(base + i);
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------

type Toon = (color: THREE.ColorRepresentation) => THREE.Material;
type Outline = (mesh: THREE.Mesh, width?: number) => THREE.Mesh;

export class Stage {
  readonly group = new THREE.Group();
  readonly lights: LightRig;
  readonly theme: StageTheme;
  readonly fog: THREE.Fog;
  /** 减少闪烁：雷暴主题的远处闪电不闪。 */
  gentle = false;
  private uniforms: ToonUniforms;
  private animated: Array<(time: number, dt: number) => void> = [];
  private disposables: Array<{ dispose(): void }> = [];
  private lastTime = 0;
  private heightAt: (x: number, z: number) => number;

  constructor(theme: StageTheme, quality = 2) {
    this.theme = theme;
    const def = THEMES[theme];
    this.lights = createLights(def.light, Math.max(FIELD.width, FIELD.depth) * 0.72);
    this.group.add(this.lights.group);
    this.group.add(skyDome(def.sky));
    const shared = toonMaterial();
    this.uniforms = shared.userData.uniforms;
    shared.dispose();
    this.uniforms.uRimStrength.value = 0;

    const mats = new Map<number, THREE.Material>();
    const toon: Toon = (color) => {
      const key = new THREE.Color(color).getHex();
      let m = mats.get(key);
      if (!m) {
        m = toonMaterial({ vertexColors: false, color, uniforms: this.uniforms });
        this.disposables.push(m);
        mats.set(key, m);
      }
      return m;
    };
    const outline = outlineMaterial(undefined, 0.22);
    outline.vertexColors = false;
    this.disposables.push(outline);
    const withOutline: Outline = (mesh, width = 1) => {
      const o = new THREE.Mesh(mesh.geometry, outline);
      o.userData.outlineWidth = width;
      mesh.add(o);
      return mesh;
    };

    this.heightAt = this.makeHeight(theme);
    this.group.add(this.terrain(def));
    this.scatterGround(def, quality);
    this.decorate(theme, toon, withOutline);

    const m = motes(def);
    this.group.add(m);
    const mm = m.material as THREE.ShaderMaterial;
    this.animated.push((t) => (mm.uniforms.uTime.value = t));
    this.fog = new THREE.Fog(def.fog, def.fogNear, def.fogFar);
  }

  /** 地形高度：交战区及外沿一圈是平地，往外慢慢起伏；身后和两侧起丘陵、远山，镜头这一侧保持低矮。 */
  private makeHeight(theme: StageTheme): (x: number, z: number) => number {
    return (x, z) => {
      const d = outside(x, z, 2.5);
      const r = Math.hypot(x, z);
      // 镜头在 +z 一侧：那边只允许很低的起伏，免得挡住战场
      const front = smooth(FIELD.depth / 2, FIELD.depth / 2 + 10, z);
      const lift = 1 - front * 0.85;
      let h = (fbm2(x * 0.07, z * 0.07, 3) - 0.35) * 3.6 * smooth(0, 9, d) * lift;
      h += smooth(34, 75, r) * (5 + 16 * fbm2(x * 0.025, z * 0.025, 9)) * (1 - front * 0.6);
      if (theme === 'lagoon') {
        // 沙洲：交战区一圈之外慢慢没入浅海，远处有岛
        h =
          Math.min(h, 0) * 0.3 -
          smooth(3, 12, d) * 0.9 +
          smooth(40, 80, r) * 6 * fbm2(x * 0.03, z * 0.03, 5);
      } else if (theme === 'volcano') {
        // 外围凹下去的地方积着熔岩
        h -= smooth(4, 12, d) * 0.9 * fbm2(x * 0.12, z * 0.12, 7);
      } else if (theme === 'temple') {
        // 云上高台：离中心远了就是断崖
        const edge = 22 + 4 * fbm2(x * 0.08, z * 0.08, 2);
        h = r < edge ? Math.min(h, 0.6) * 0.4 : -40;
      } else if (theme === 'canyon') {
        // 身后和两侧是陡起的岩壁
        h += smooth(10, 20, d) * 7 * (0.6 + 0.4 * fbm2(x * 0.1, z * 0.1, 4)) * lift;
      }
      return h;
    };
  }

  private terrain(def: ThemeDef): THREE.Mesh {
    const size = 170;
    const segs = 150;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const main = new THREE.Color(def.ground[0]);
    const hills = new THREE.Color(def.ground[2]);
    const sunk = new THREE.Color(0xa89a78);
    const cliff = new THREE.Color(0x5a4a78);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      c.copy(main).lerp(hills, smooth(4, 26, outside(x, z)) * 0.8);
      // 大尺度的明暗变化
      c.multiplyScalar(0.9 + 0.2 * fbm2(x * 0.05, z * 0.05, 1));
      if (this.theme === 'lagoon' && h < -0.25) c.lerp(sunk, smooth(-0.25, -0.8, h));
      if (this.theme === 'temple' && h < -1) c.copy(cliff);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = groundMaterial(def, this.uniforms);
    this.disposables.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** 地面上的小东西：随风摆的草丛、花、碎石子（实例化，数量随画质）。交战区里稀一些，像被踩过。 */
  private scatterGround(def: ThemeDef, quality: number): void {
    const r = rand(this.theme.length * 97 + 3);
    const qk = [0.35, 0.6, 1, 1.4][Math.max(0, Math.min(3, quality))] as number;
    const areaW = FIELD.width + 16;
    const areaD = FIELD.depth + 14;
    const place = (
      count: number,
      keepInside: number,
      cb: (x: number, z: number, i: number) => void,
    ) => {
      let n = 0;
      for (let tries = 0; tries < count * 3 && n < count; tries++) {
        const x = (r() - 0.5) * areaW;
        const z = (r() - 0.5) * areaD - 1;
        if (outside(x, z) === 0 && r() > keepInside) continue;
        if (this.heightAt(x, z) < -0.2) continue;
        cb(x, z, n++);
      }
      return n;
    };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const at = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    if (def.grass) {
      const g = def.grass;
      const count = Math.round(areaW * areaD * g.density * 0.16 * qk);
      const geo = tuftGeometry(g.height);
      const mat = grassMaterial(this.uniforms);
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      this.disposables.push(mat, geo);
      const n = place(count, 0.45, (x, z, i) => {
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        const s = 0.7 + r() * 0.7;
        sc.set(s, s * (0.8 + r() * 0.5), s);
        m4.compose(at.set(x, this.heightAt(x, z), z), q, sc);
        mesh.setMatrixAt(i, m4);
        tint.set(g.colors[i % g.colors.length] as number).multiplyScalar(0.9 + r() * 0.25);
        mesh.setColorAt(i, tint);
      });
      mesh.count = n;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (this.theme === 'meadow' || this.theme === 'storm' || this.theme === 'temple') {
      const count = Math.round((this.theme === 'meadow' ? 520 : 160) * qk);
      const geo = flowerGeometry();
      const mat = toonMaterial({ vertexColors: true, uniforms: this.uniforms });
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      this.disposables.push(mat, geo);
      const palette =
        this.theme === 'meadow'
          ? [0xffd0e0, 0xfff0a0, 0xffffff, 0xff9ab8, 0xb8c8ff]
          : this.theme === 'storm'
            ? [0xb8a8ff, 0x9ad8ff]
            : [0xffe8a0, 0xffffff];
      // 花一片一片地开
      const centers = Array.from(
        { length: 14 },
        () => [(r() - 0.5) * areaW, (r() - 0.5) * areaD] as const,
      );
      let n = 0;
      for (let i = 0; i < count; i++) {
        const c = centers[i % centers.length] as readonly [number, number];
        const x = c[0] + (r() - 0.5) * 3.2;
        const z = c[1] + (r() - 0.5) * 2.4;
        if (outside(x, z) === 0 && r() > 0.3) continue;
        if (this.heightAt(x, z) < -0.2) continue;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        const s = 0.8 + r() * 0.6;
        m4.compose(at.set(x, this.heightAt(x, z), z), q, sc.set(s, s, s));
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, tint.set(palette[i % palette.length] as number));
        n++;
      }
      mesh.count = n;
      this.group.add(mesh);
    }
    // 碎石子
    {
      const count = Math.round(260 * qk);
      const geo = faceted(rocky(new THREE.IcosahedronGeometry(0.1, 0), 0.04, 6, 2));
      const stone =
        this.theme === 'volcano'
          ? 0x2a2020
          : this.theme === 'lagoon'
            ? 0xd8c8a8
            : this.theme === 'canyon'
              ? 0x9a5a3a
              : 0x8a8a8a;
      const mat = toonMaterial({ vertexColors: false, color: stone, uniforms: this.uniforms });
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      this.disposables.push(mat, geo);
      const e = new THREE.Euler();
      const n = place(count, 0.5, (x, z, i) => {
        q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3));
        const s = 0.4 + r() * 1.3;
        m4.compose(at.set(x, this.heightAt(x, z) + 0.02, z), q, sc.set(s, s * 0.6, s));
        mesh.setMatrixAt(i, m4);
      });
      mesh.count = n;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** 布景：放在交战区外面，主要在身后和左右两侧（镜头前方只放矮的）。 */
  private decorate(theme: StageTheme, toon: Toon, withOutline: Outline): void {
    const r = rand(theme.length * 131 + 7);
    const hw = FIELD.width / 2;
    const hd = FIELD.depth / 2;
    /** 在交战区外随机取一个点：离交战区 minGap 到 maxGap 米；高的东西不放在镜头前方。 */
    const spot = (minGap: number, maxGap: number, tall: boolean): THREE.Vector3 => {
      for (let i = 0; i < 60; i++) {
        const x = (r() - 0.5) * (FIELD.width + maxGap * 2);
        const z = -hd - maxGap + r() * (FIELD.depth + maxGap * (tall ? 1.1 : 2));
        const d = outside(x, z);
        if (d < minGap || d > maxGap) continue;
        if (tall && z > hd - 1) continue;
        return new THREE.Vector3(x, this.heightAt(x, z), z);
      }
      return new THREE.Vector3(hw + minGap + 2, 0, -hd - minGap);
    };
    const put = (obj: THREE.Object3D, p: THREE.Vector3, s: number) => {
      obj.position.copy(p);
      obj.scale.setScalar(s);
      obj.rotation.y = r() * Math.PI * 2;
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      this.group.add(obj);
    };
    const rock = (color: number, seed: number, stretch = 1) => {
      const g = faceted(rocky(new THREE.IcosahedronGeometry(1, 1), 0.35, 1.3, seed));
      g.scale(1, 0.7 * stretch, 1);
      return withOutline(new THREE.Mesh(g, toon(color)));
    };
    const tree = (trunkColor: number, leafColors: number[], seed: number) => {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.26, 2.2, 7),
        toon(trunkColor),
      );
      trunk.position.y = 1.1;
      t.add(withOutline(trunk));
      for (let k = 0; k < 3; k++) {
        const g = faceted(
          rocky(new THREE.IcosahedronGeometry(1.15 - k * 0.22, 1), 0.25, 1.4, seed * 3 + k),
        );
        const c = new THREE.Mesh(g, toon(leafColors[k % leafColors.length] as number));
        c.position.set((r() - 0.5) * 0.6, 2.3 + k * 0.68, (r() - 0.5) * 0.6);
        t.add(withOutline(c));
      }
      return t;
    };

    if (theme === 'meadow') {
      // 树丛成片地长，远一点的更密
      for (let i = 0; i < 34; i++)
        put(tree(0x7a5238, [0x4aa84a, 0x5ac05a, 0x3a9a4a], i), spot(3, 18, true), 0.8 + r() * 0.8);
      for (let i = 0; i < 16; i++) {
        const g = faceted(rocky(new THREE.IcosahedronGeometry(0.7, 1), 0.2, 1.6, i + 40));
        const bush = withOutline(new THREE.Mesh(g, toon(i % 2 ? 0x5ab04a : 0x4a9a44)));
        put(bush, spot(1.2, 10, false).add(new THREE.Vector3(0, 0.2, 0)), 0.6 + r() * 0.6);
      }
      for (let i = 0; i < 12; i++)
        put(
          rock(0x9a9a92, i),
          spot(1.5, 14, false).add(new THREE.Vector3(0, 0.1, 0)),
          0.3 + r() * 0.6,
        );
    } else if (theme === 'volcano') {
      for (let i = 0; i < 26; i++) {
        const g = faceted(rocky(new THREE.ConeGeometry(1.1, 2.6 + r() * 3.4, 7, 3), 0.35, 1.1, i));
        put(
          withOutline(new THREE.Mesh(g, toon(0x2e2222))),
          spot(2.5, 20, true).add(new THREE.Vector3(0, 0.9, 0)),
          0.6 + r() * 1.1,
        );
      }
      for (let i = 0; i < 10; i++) {
        // 枯树：歪斜的树干和几根折枝
        const t = new THREE.Group();
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.14, 1.8, 6),
          toon(0x1e1614),
        );
        trunk.position.y = 0.9;
        trunk.rotation.z = (r() - 0.5) * 0.3;
        t.add(withOutline(trunk));
        for (let k = 0; k < 3; k++) {
          const br = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.8, 5), toon(0x1e1614));
          br.position.set(0, 1.2 + k * 0.25, 0);
          br.rotation.set(0, (k / 3) * Math.PI * 2, 0.9);
          t.add(br);
        }
        put(t, spot(1.5, 12, true), 0.8 + r() * 0.6);
      }
      const lava = liquid('lava', 170);
      lava.position.y = -0.35;
      this.group.add(lava);
      this.disposables.push(lava.material as THREE.Material);
      const lm = lava.material as THREE.ShaderMaterial;
      this.animated.push((t) => (lm.uniforms.uTime.value = t));
      // 远处的火山口
      for (const [x, z, s] of [
        [-30, -42, 1.4],
        [26, -48, 1.1],
      ] as const) {
        const g = faceted(rocky(new THREE.CylinderGeometry(2.5, 14, 14, 10, 4, true), 1.2, 0.3, 5));
        const cone = new THREE.Mesh(g, toon(0x2a1c1c));
        const base = this.heightAt(x, z);
        cone.position.set(x, base + 6 * s, z);
        cone.scale.setScalar(s);
        this.group.add(cone);
        const hot = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xff6a1a).multiplyScalar(3),
          fog: false,
        });
        const glow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16), hot);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x, base + 12.9 * s, z);
        glow.scale.setScalar(s);
        this.group.add(glow);
        this.disposables.push(hot);
      }
    } else if (theme === 'lagoon') {
      const water = liquid('water', 190);
      water.position.y = -0.22;
      this.group.add(water);
      this.disposables.push(water.material as THREE.Material);
      const wm = water.material as THREE.ShaderMaterial;
      this.animated.push((t) => (wm.uniforms.uTime.value = t));
      // 椰子树：一节节弯曲的树干 + 一圈下垂的叶子
      for (let i = 0; i < 14; i++) {
        const p = spot(1.5, 9, true);
        if (p.y < -0.15) continue;
        const t = new THREE.Group();
        const bend = (r() - 0.5) * 0.5;
        for (let k = 0; k < 6; k++) {
          const seg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.11 - k * 0.008, 0.13 - k * 0.008, 0.55, 7),
            toon(k % 2 ? 0x9a7048 : 0x8a6440),
          );
          seg.position.set(bend * k * k * 0.05, 0.28 + k * 0.52, 0);
          seg.rotation.z = -bend * k * 0.12;
          t.add(withOutline(seg));
        }
        const top = new THREE.Vector3(bend * 25 * 0.05, 3.3, 0);
        for (let k = 0; k < 7; k++) {
          const g = new THREE.ConeGeometry(0.16, 1.7, 4, 1);
          g.translate(0, 0.85, 0);
          const leaf = new THREE.Mesh(g, toon(k % 2 ? 0x4ab04a : 0x3a9a44));
          leaf.position.copy(top);
          leaf.rotation.order = 'YXZ';
          leaf.rotation.set(1.9, (k / 7) * Math.PI * 2, 0);
          leaf.scale.set(1, 1, 0.25);
          t.add(withOutline(leaf));
        }
        put(t, p, 0.8 + r() * 0.4);
      }
      for (let i = 0; i < 16; i++) {
        const g = faceted(rocky(new THREE.IcosahedronGeometry(0.6, 1), 0.3, 2, i));
        const coral = new THREE.Mesh(
          g,
          toon(i % 3 === 0 ? 0xff8a9a : i % 3 === 1 ? 0xffb07a : 0xd8c8b0),
        );
        put(withOutline(coral), spot(2, 16, false).setY(-0.1), 0.5 + r() * 0.8);
      }
    } else if (theme === 'storm') {
      // 古战场遗迹：断柱与倒下的石块
      for (let i = 0; i < 14; i++) {
        const h = 1.2 + r() * 3;
        const g = faceted(rocky(new THREE.CylinderGeometry(0.4, 0.46, h, 8, 3), 0.05, 1.8, i));
        g.translate(0, h / 2, 0);
        const col = withOutline(new THREE.Mesh(g, toon(0x5a5874)));
        put(col, spot(2, 16, true), 1);
        col.rotation.z = (r() - 0.5) * 0.25;
      }
      for (let i = 0; i < 12; i++)
        put(
          rock(0x4a4860, i + 20, 0.8),
          spot(1.5, 14, false).add(new THREE.Vector3(0, 0.2, 0)),
          0.4 + r() * 0.7,
        );
      // 悬浮的碎岩
      for (let i = 0; i < 10; i++) {
        const m = rock(0x4a4868, i + 60, 1.3);
        const y0 = 3 + r() * 5;
        put(m, spot(4, 18, true).setY(y0), 0.5 + r() * 0.8);
        const k = r() * 10;
        this.animated.push((t) => (m.position.y = y0 + Math.sin(t * 0.5 + k) * 0.3));
      }
      // 远处的闪电：隔十几秒天色微微一亮（太勤、太亮就成了整场一闪一闪）
      let next = 6;
      let flash = 0;
      const hemi = this.lights.hemi;
      const base = hemi.intensity;
      this.animated.push((t, dt) => {
        if (t > next) {
          next = t + 10 + r() * 8;
          if (!this.gentle) flash = 1;
        }
        flash = Math.max(0, flash - dt * 5);
        hemi.intensity = base + flash * flash * 0.7;
      });
    } else if (theme === 'canyon') {
      // 平顶岩柱与岩塔
      for (let i = 0; i < 16; i++) {
        const h = 4 + r() * 6;
        const g = faceted(
          rocky(new THREE.CylinderGeometry(1.6 + r(), 2.4 + r(), h, 8, 4), 0.45, 0.8, i),
        );
        g.translate(0, h / 2 - 0.5, 0);
        const color = [0xc8845a, 0xa86a48, 0xd89a6a][i % 3] as number;
        put(withOutline(new THREE.Mesh(g, toon(color))), spot(4, 22, true), 0.7 + r() * 0.8);
      }
      const crystal = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xc88aff).multiplyScalar(1.7),
      });
      this.disposables.push(crystal);
      for (let i = 0; i < 12; i++) {
        const cluster = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const g = new THREE.OctahedronGeometry(0.3, 0);
          g.scale(0.55, 1.9, 0.55);
          const m = new THREE.Mesh(g, crystal);
          m.position.set((r() - 0.5) * 0.5, 0.35, (r() - 0.5) * 0.5);
          m.rotation.set((r() - 0.5) * 0.8, r() * 3, (r() - 0.5) * 0.8);
          cluster.add(m);
        }
        put(cluster, spot(1.2, 12, false), 0.6 + r() * 0.8);
      }
      for (let i = 0; i < 10; i++)
        put(
          rock(0xa8704c, i + 30),
          spot(1.5, 12, false).add(new THREE.Vector3(0, 0.1, 0)),
          0.4 + r() * 0.7,
        );
    } else if (theme === 'temple') {
      // 云上遗迹：断柱、漂浮的金环，崖下是云海
      const clouds = liquid('clouds', 260);
      clouds.position.y = -9;
      this.group.add(clouds);
      this.disposables.push(clouds.material as THREE.Material);
      const cm = clouds.material as THREE.ShaderMaterial;
      this.animated.push((t) => (cm.uniforms.uTime.value = t * 0.6));
      for (let i = 0; i < 12; i++) {
        const p = spot(2.5, 12, true);
        if (p.y < -1) continue;
        const h = 1.5 + r() * 3.5;
        const g = new THREE.CylinderGeometry(0.42, 0.48, h, 12, 1);
        g.translate(0, h / 2, 0);
        const column = withOutline(new THREE.Mesh(g, toon(0xe8e0f0)));
        const cap = withOutline(
          new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.2), toon(0xffc84e)),
        );
        cap.position.y = h + 0.15;
        const grp = new THREE.Group();
        grp.add(column, cap);
        put(grp, p, 1);
      }
      const gold = toon(0xffc84e);
      for (let i = 0; i < 9; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 8, 40), gold);
        ring.position.copy(spot(5, 20, true).setY(5 + r() * 5));
        this.group.add(ring);
        const k = i;
        this.animated.push((t) => {
          ring.rotation.y = t * 0.3 + k;
          ring.rotation.x = Math.sin(t * 0.2 + k) * 0.4;
        });
      }
    }
  }

  applyTo(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.fog = this.fog;
    scene.background = new THREE.Color(THEMES[this.theme].fog);
  }

  update(time: number): void {
    const dt = Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    this.uniforms.uTime.value = time;
    for (const fn of this.animated) fn(time, dt);
    tickSharedFlames(time);
  }

  setLight(preset: Partial<LightPreset>): void {
    applyPreset(this.lights, { ...THEMES[this.theme].light, ...preset });
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
