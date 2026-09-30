// 网格特效：冲击环、光柱、立体刀刃、爆闪球、光束、闪电、法阵、岩刺、藤蔓、陨石、地面印记、动态点光源，
// 以及 volume.ts 里的立体特效（冲击波球壳、龙卷、体积火球、水花冠、雷电球、剑气）和实体碎片。
// 每个特效有寿命，Effects 统一推进和回收；数量有上限，激烈场面也不会越积越多。
import * as THREE from 'three';
import { faceted, rocky } from '../kit/geo.js';
import { outlineMaterial, toonMaterial } from '../toon.js';
import { Debris, type DebrisBurst } from './debris.js';
import { decalTexture, magicCircle, streakNoise } from './textures.js';
import {
  barrierFlash,
  bladeArc,
  crescent,
  electricOrb,
  fireball,
  shockBand,
  shockShell,
  spiral,
  splashCrown,
  vortex,
  type BladeOptions,
  type Live,
} from './volume.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function additive(
  color: THREE.ColorRepresentation,
  intensity: number,
  map?: THREE.Texture,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    map: map ?? null,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** 柔边圆环：内外缘淡出。 */
function ringMaterial(
  color: THREE.ColorRepresentation,
  intensity: number,
  softness = 0.5,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
      uAlpha: { value: 1 },
      uSoft: { value: softness },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uSoft;
      varying vec2 vUv;
      void main() {
        float r = vUv.y;
        float a = smoothstep(0.0, uSoft, r) * (1.0 - smoothstep(1.0 - uSoft * 0.35, 1.0, r));
        gl_FragColor = vec4(uColor * a * uAlpha, a * uAlpha);
      }
    `,
  });
}

/** 按半径方向写 uv.y（0 内缘 → 1 外缘）的圆环几何。 */
function ringGeometry(
  inner: number,
  outer: number,
  segs = 64,
  theta = Math.PI * 2,
  start = 0,
): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, segs, 1, start, theta);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    let u = (a - start) / theta;
    if (u < 0) u += (Math.PI * 2) / theta;
    uv.setXY(i, u, (r - inner) / (outer - inner));
  }
  return g;
}

let spikeGeo: THREE.BufferGeometry | null = null;
let spikeMat: THREE.Material | null = null;
let spikeLine: THREE.Material | null = null;

export class Effects {
  readonly group = new THREE.Group();
  /** 实体碎片（碎石、晶片、叶片……）。 */
  readonly debris = new Debris();
  private live: Live[] = [];
  private pending: Array<{ t: number; fn: () => void }> = [];
  private lights: THREE.PointLight[] = [];
  private lightLife: number[] = [];
  private lightMax: number[] = [];
  private lightDur: number[] = [];
  /** 同时存在的特效上限。 */
  maxLive = 160;
  /** 减少闪烁：光效强度打折，不做闪白。 */
  gentle = false;

  constructor(lightCount = 6) {
    this.group.add(this.debris.group);
    for (let i = 0; i < lightCount; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 1.6);
      l.visible = false;
      this.lights.push(l);
      this.lightLife.push(0);
      this.lightMax.push(0);
      this.lightDur.push(1);
      this.group.add(l);
    }
  }

  get count(): number {
    return this.live.length;
  }

  /** 交给特效池管理寿命。 */
  add(e: Live): void {
    this.push(e);
  }

  /** 过 delay 秒（特效时间）再执行（分段演出：先蓄力、再爆发）。清场时取消。 */
  after(delay: number, fn: () => void): void {
    this.pending.push({ t: delay, fn });
  }

  private push(e: Live): void {
    if (this.live.length >= this.maxLive) {
      const old = this.live.shift();
      if (old) {
        this.group.remove(old.obj);
        old.dispose();
      }
    }
    this.group.add(e.obj);
    this.live.push(e);
  }

  update(dt: number): void {
    this.debris.update(dt);
    for (let i = 0; i < this.live.length;) {
      const e = this.live[i] as Live;
      e.age += dt;
      const k = Math.min(1, e.age / e.life);
      e.tick(k, dt, e.age);
      if (e.age >= e.life) {
        this.group.remove(e.obj);
        e.dispose();
        this.live.splice(i, 1);
      } else i++;
    }
    if (this.pending.length) {
      const due = this.pending.filter((p) => (p.t -= dt) <= 0);
      if (due.length) {
        this.pending = this.pending.filter((p) => p.t > 0);
        for (const p of due) p.fn();
      }
    }
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i] as THREE.PointLight;
      if (!l.visible) continue;
      this.lightLife[i] = (this.lightLife[i] as number) - dt;
      const k = Math.max(0, (this.lightLife[i] as number) / (this.lightDur[i] as number));
      l.intensity = (this.lightMax[i] as number) * k * k;
      if (k <= 0) l.visible = false;
    }
  }

  clear(): void {
    this.pending = [];
    this.debris.clear();
    for (const e of this.live) {
      this.group.remove(e.obj);
      e.dispose();
    }
    this.live = [];
    for (const l of this.lights) l.visible = false;
  }

  /** 一闪而过的点光源（从光源池里取最旧的一个）。 */
  light(
    at: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
    dur: number,
  ): void {
    let idx = 0;
    let least = Infinity;
    for (let i = 0; i < this.lights.length; i++) {
      const left = (this.lights[i] as THREE.PointLight).visible
        ? (this.lightLife[i] as number)
        : -1;
      if (left < least) {
        least = left;
        idx = i;
      }
    }
    const l = this.lights[idx] as THREE.PointLight;
    l.visible = true;
    l.position.copy(at);
    l.color.set(color);
    l.distance = distance;
    const k = this.gentle ? 0.45 : 1;
    this.lightMax[idx] = intensity * k;
    l.intensity = intensity * k;
    this.lightLife[idx] = dur;
    this.lightDur[idx] = dur;
  }

  /** 冲击环：地面（水平）或竖直，从 r0 扩到 r1。 */
  ring(
    at: THREE.Vector3,
    r0: number,
    r1: number,
    color: THREE.ColorRepresentation,
    dur: number,
    opts: { width?: number; vertical?: THREE.Vector3; intensity?: number; y?: number } = {},
  ): void {
    const width = opts.width ?? 0.35;
    const mat = ringMaterial(color, (opts.intensity ?? 2.2) * (this.gentle ? 0.6 : 1));
    const mesh = new THREE.Mesh(ringGeometry(1 - width, 1, 64), mat);
    mesh.position.copy(at);
    mesh.position.y += opts.y ?? 0.04;
    if (opts.vertical) {
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        opts.vertical.clone().normalize(),
      );
    } else {
      mesh.rotation.x = -Math.PI / 2;
    }
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k) => {
        const e = 1 - Math.pow(1 - k, 3);
        const r = r0 + (r1 - r0) * e;
        mesh.scale.setScalar(Math.max(0.001, r));
        mat.uniforms.uAlpha.value = 1 - k * k;
      },
      dispose: () => {
        mesh.geometry.dispose();
        mat.dispose();
      },
    });
  }

  /** 光柱：从地面升起的圆柱光，贴图条纹向上流动。 */
  pillar(
    at: THREE.Vector3,
    radius: number,
    height: number,
    color: THREE.ColorRepresentation,
    dur: number,
    intensity = 2.4,
  ): void {
    const tex = streakNoise().clone();
    tex.needsUpdate = true;
    tex.repeat.set(3, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: {
          value: new THREE.Color(color).multiplyScalar(intensity * (this.gentle ? 0.6 : 1)),
        },
        uMap: { value: streakNoise() },
        uTime: { value: 0 },
        uAlpha: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          float n = texture2D(uMap, vec2(vUv.x * 3.0, vUv.y * 0.6 - uTime * 1.4)).r;
          float fade = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
          float a = (0.35 + n * 0.9) * fade * uAlpha;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    tex.dispose();
    const geo = new THREE.CylinderGeometry(radius, radius * 1.05, height, 32, 1, true);
    geo.translate(0, height / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at);
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k, _dt, age) => {
        mat.uniforms.uTime.value = age;
        mesh.scale.set(1 + k * 0.3, Math.min(1, k * 5), 1 + k * 0.3);
        mat.uniforms.uAlpha.value = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      },
      dispose: () => {
        geo.dispose();
        mat.dispose();
      },
    });
  }

  /**
   * 刀光：一段有厚度的月牙形能量刃，沿水平面上的弧从一端扫到另一端（yaw 是弧中心的朝向），
   * 可以倾斜（tilt）成斜劈。
   */
  slash(
    at: THREE.Vector3,
    yaw: number,
    radius: number,
    color: THREE.ColorRepresentation,
    dur: number,
    opts: BladeOptions = {},
  ): void {
    this.push(bladeArc(at, yaw, radius, color, dur, { ...opts, gentle: this.gentle }));
  }

  /** 飞行剑气：竖起的月牙刃从 from 飞到 to，带残影。 */
  crescent(
    from: THREE.Vector3,
    to: THREE.Vector3,
    size: number,
    color: THREE.ColorRepresentation,
    dur: number,
  ): void {
    this.push(crescent(from, to, size, color, dur, this.gentle));
  }

  /** 冲击波球壳（默认半球贴地）。 */
  shock(
    at: THREE.Vector3,
    r0: number,
    r1: number,
    color: THREE.ColorRepresentation,
    dur: number,
    opts: { hemisphere?: boolean; intensity?: number } = {},
  ): void {
    this.push(shockShell(at, r0, r1, color, dur, { ...opts, gentle: this.gentle }));
  }

  /** 竖起的冲击环带（震地）。 */
  band(
    at: THREE.Vector3,
    r0: number,
    r1: number,
    height: number,
    color: THREE.ColorRepresentation,
    dur: number,
  ): void {
    this.push(shockBand(at, r0, r1, height, color, dur, this.gentle));
  }

  /** 龙卷：螺旋光带 + 旋转气锥。 */
  vortex(
    at: THREE.Vector3,
    radius: number,
    height: number,
    color: THREE.ColorRepresentation,
    dur: number,
    opts: { ribbons?: number; turns?: number; spin?: number; intensity?: number } = {},
  ): void {
    this.push(vortex(at, radius, height, color, dur, { ...opts, gentle: this.gentle }));
  }

  /** 绕身上升的螺旋光带。 */
  spiral(
    at: THREE.Vector3,
    radius: number,
    height: number,
    color: THREE.ColorRepresentation,
    dur: number,
  ): void {
    this.push(spiral(at, radius, height, color, dur, this.gentle));
  }

  /** 体积火球（爆炸）；换配色可以做毒雾、冰爆。 */
  fireball(
    at: THREE.Vector3,
    radius: number,
    dur: number,
    colors: {
      hot?: THREE.ColorRepresentation;
      mid?: THREE.ColorRepresentation;
      smoke?: THREE.ColorRepresentation;
    } = {},
  ): void {
    this.push(fireball(at, radius, dur, { ...colors, gentle: this.gentle }));
  }

  /** 水花冠。 */
  splash(at: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, dur: number): void {
    this.push(splashCrown(at, radius, color, dur));
  }

  /** 雷电球。 */
  orb(at: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, dur: number): void {
    this.push(electricOrb(at, radius, color, dur, this.gentle));
  }

  /** 实体碎片。 */
  chunks(o: DebrisBurst): void {
    this.debris.burst(o);
  }

  /** 结界显形（场地边缘被撞到时）。normal 指向场内。 */
  barrierAt(at: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.push(barrierFlash(at, normal, color, 0.7, this.gentle));
  }

  /** 爆闪球：一个很亮的球迅速胀大再淡出（爆炸核心、大招命中）。 */
  flash(
    at: THREE.Vector3,
    radius: number,
    color: THREE.ColorRepresentation,
    dur: number,
    intensity = 3,
  ): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: {
          value: new THREE.Color(color).multiplyScalar(intensity * (this.gentle ? 0.5 : 1)),
        },
        uAlpha: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float f = pow(max(dot(vN, vV), 0.0), 1.5);
          float a = f * uAlpha;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    mesh.position.copy(at);
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k) => {
        mesh.scale.setScalar(radius * (0.3 + 0.9 * (1 - Math.pow(1 - k, 3))));
        mat.uniforms.uAlpha.value = 1 - k;
      },
      dispose: () => {
        mesh.geometry.dispose();
        mat.dispose();
      },
    });
  }

  /** 光束：从 a 到 b 的发光圆柱，条纹沿光束流动。 */
  beam(
    a: THREE.Vector3,
    b: THREE.Vector3,
    width: number,
    color: THREE.ColorRepresentation,
    dur: number,
    intensity = 2.6,
  ): void {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(width, width, len, 16, 1, true);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: {
          value: new THREE.Color(color).multiplyScalar(intensity * (this.gentle ? 0.6 : 1)),
        },
        uMap: { value: streakNoise() },
        uTime: { value: 0 },
        uAlpha: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          float n = texture2D(uMap, vec2(vUv.x * 2.0, vUv.y * 2.0 - uTime * 4.0)).r;
          float a = (0.5 + n) * uAlpha;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.lookAt(b);
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k, _dt, age) => {
        mat.uniforms.uTime.value = age;
        mat.uniforms.uAlpha.value = 1 - k * k;
        mesh.scale.set(1 - k * 0.6, 1 - k * 0.6, 1);
      },
      dispose: () => {
        geo.dispose();
        mat.dispose();
      },
    });
  }

  /** 闪电：锯齿折线，外面一层柔光，每 50 毫秒重新抖动一次（减少闪烁时不抖）。 */
  bolt(
    a: THREE.Vector3,
    b: THREE.Vector3,
    color: THREE.ColorRepresentation,
    dur: number,
    width = 0.035,
    jitter = 0.35,
    branches = 2,
  ): void {
    const group = new THREE.Group();
    const core = additive(0xffffff, 2.8 * (this.gentle ? 0.6 : 1));
    const glow = additive(color, 1.6 * (this.gentle ? 0.6 : 1));
    glow.opacity = 0.45;
    let seed = Math.random() * 1000;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const build = () => {
      for (const c of [...group.children]) {
        group.remove(c);
        (c as THREE.Mesh).geometry.dispose();
      }
      const paths: THREE.Vector3[][] = [];
      const main = zigzag(a, b, jitter, rand);
      paths.push(main);
      for (let i = 0; i < branches; i++) {
        const from = main[Math.floor(2 + rand() * (main.length - 4))] as THREE.Vector3;
        const to = from
          .clone()
          .add(new THREE.Vector3((rand() - 0.5) * 1.2, (rand() - 0.3) * 0.6, (rand() - 0.5) * 1.2));
        paths.push(zigzag(from, to, jitter * 0.6, rand, 5));
      }
      paths.forEach((p, i) => {
        const curve = new THREE.CatmullRomCurve3(p, false, 'chordal', 0);
        const w = i === 0 ? width : width * 0.55;
        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, p.length * 2, w, 4, false), core));
        group.add(
          new THREE.Mesh(new THREE.TubeGeometry(curve, p.length * 2, w * 3.2, 5, false), glow),
        );
      });
    };
    build();
    let next = 0.05;
    this.push({
      obj: group,
      age: 0,
      life: dur,
      tick: (k, _dt, age) => {
        if (!this.gentle && age > next) {
          next += 0.05;
          build();
        }
        core.opacity = 1 - k * k;
        glow.opacity = 0.45 * (1 - k);
      },
      dispose: () => {
        for (const c of group.children) (c as THREE.Mesh).geometry.dispose();
        core.dispose();
        glow.dispose();
      },
    });
  }

  /** 地面法阵：缓缓旋转，淡入淡出。 */
  circle(
    at: THREE.Vector3,
    radius: number,
    color: THREE.ColorRepresentation,
    dur: number,
    kind: 'penta' | 'hexa' | 'runes' = 'penta',
    spin = 0.8,
  ): void {
    const mat = additive(color, 1.8 * (this.gentle ? 0.6 : 1), magicCircle(kind));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.position.y = 0.03;
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k, _dt, age) => {
        mesh.rotation.z = age * spin;
        const inK = Math.min(1, k * 6);
        const s = 0.6 + 0.4 * (1 - Math.pow(1 - inK, 3));
        mesh.scale.setScalar(s);
        mat.opacity = k < 0.75 ? inK : 1 - (k - 0.75) / 0.25;
      },
      dispose: () => {
        mesh.geometry.dispose();
        mat.dispose();
      },
    });
  }

  /** 岩刺：一圈或一排尖石从地里顶出来再缩回去。 */
  spikes(
    points: THREE.Vector3[],
    height: number,
    color: THREE.ColorRepresentation,
    dur: number,
    stagger = 0.03,
  ): void {
    if (!spikeGeo) {
      spikeGeo = faceted(rocky(new THREE.ConeGeometry(0.35, 1, 6, 3), 0.08, 3, 5));
      spikeGeo.translate(0, 0.5, 0);
      spikeMat = toonMaterial({ vertexColors: false, color: 0xffffff });
      spikeLine = outlineMaterial(undefined, 0.2);
      (spikeLine as THREE.ShaderMaterial).vertexColors = false;
    }
    const group = new THREE.Group();
    const mat = (spikeMat as THREE.MeshToonMaterial).clone();
    mat.color.set(color);
    const pieces = points.map((p, i) => {
      const m = new THREE.Mesh(spikeGeo as THREE.BufferGeometry, mat);
      m.add(new THREE.Mesh(spikeGeo as THREE.BufferGeometry, spikeLine as THREE.Material));
      m.position.copy(p);
      m.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 3, (Math.random() - 0.5) * 0.5);
      m.castShadow = true;
      m.scale.set(0.001, 0.001, 0.001);
      group.add(m);
      return { m, delay: i * stagger, h: height * (0.7 + Math.random() * 0.5) };
    });
    this.push({
      obj: group,
      age: 0,
      life: dur,
      tick: (_k, _dt, age) => {
        for (const p of pieces) {
          const t = age - p.delay;
          if (t < 0) continue;
          const up = Math.min(1, t / 0.12);
          const over = up < 1 ? up : 1 + 0.15 * Math.sin(Math.min(1, (t - 0.12) / 0.2) * Math.PI);
          const down = Math.max(0, (age - dur * 0.7) / (dur * 0.3));
          const s = over * (1 - down);
          p.m.scale.set(0.9 * s + 0.001, p.h * s + 0.001, 0.9 * s + 0.001);
        }
      },
      dispose: () => mat.dispose(),
    });
  }

  /** 藤蔓：从中心朝四周长出的弯曲藤条，末端开花。 */
  vines(center: THREE.Vector3, radius: number, count: number, dur: number, color = 0x3aa04a): void {
    const group = new THREE.Group();
    const mat = toonMaterial({ vertexColors: false, color });
    const meshes: Array<{ m: THREE.Mesh; total: number }> = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const r = radius * (0.15 + 0.85 * t);
        const w = Math.sin(t * Math.PI * 2 + i) * 0.25;
        pts.push(
          new THREE.Vector3(
            Math.cos(a + w) * r,
            0.05 + Math.sin(t * Math.PI) * 0.35 * (1 - t * 0.5),
            Math.sin(a + w) * r,
          ),
        );
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.045, 6, false);
      const m = new THREE.Mesh(g, mat);
      m.position.copy(center);
      group.add(m);
      meshes.push({ m, total: g.index ? g.index.count : 0 });
    }
    this.push({
      obj: group,
      age: 0,
      life: dur,
      tick: (k) => {
        const grow = Math.min(1, k * 4);
        for (const { m, total } of meshes) {
          m.geometry.setDrawRange(0, Math.floor((total * grow) / 6) * 6);
          m.scale.setScalar(k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1);
        }
      },
      dispose: () => {
        for (const { m } of meshes) m.geometry.dispose();
        mat.dispose();
      },
    });
  }

  /** 地面印记（焦痕、裂纹、水渍、花瓣），慢慢褪去。 */
  decal(
    at: THREE.Vector3,
    radius: number,
    kind: 'scorch' | 'crack' | 'splash' | 'petals' | 'frost',
    dur = 6,
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      map: decalTexture(kind),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(at.x, 0.015 + Math.random() * 0.004, at.z);
    mesh.renderOrder = 1;
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k) => {
        mat.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      },
      dispose: () => {
        mesh.geometry.dispose();
        mat.dispose();
      },
    });
  }

  /** 从 a 飞向 b 的发光物（陨石、大火球），到达时回调。 */
  meteor(
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    color: THREE.ColorRepresentation,
    dur: number,
    onTick: (p: THREE.Vector3) => void,
    onLand: () => void,
    crystal = false,
  ): void {
    const group = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(3),
    });
    const geo = crystal
      ? faceted(new THREE.OctahedronGeometry(radius, 0))
      : new THREE.IcosahedronGeometry(radius, 1);
    const core = new THREE.Mesh(geo, coreMat);
    const haloMat = additive(color, 1.4);
    haloMat.opacity = 0.6;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.8, 16, 12), haloMat);
    group.add(core, halo);
    let landed = false;
    this.push({
      obj: group,
      age: 0,
      life: dur,
      tick: (k) => {
        const e = k * k;
        _v.copy(from).lerp(to, e);
        group.position.copy(_v);
        core.rotation.x += 0.2;
        core.rotation.y += 0.13;
        onTick(group.position);
        if (k >= 0.999 && !landed) {
          landed = true;
          onLand();
        }
      },
      dispose: () => {
        if (!landed) {
          landed = true;
          onLand();
        }
        geo.dispose();
        halo.geometry.dispose();
        coreMat.dispose();
        haloMat.dispose();
      },
    });
  }

  /** 跟着目标走的护盾泡（六角格纹 + 菲涅耳边缘）。 */
  dome(
    getPos: () => THREE.Vector3 | null,
    radius: number,
    color: THREE.ColorRepresentation,
    dur: number,
  ): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color).multiplyScalar(1.6) },
        uAlpha: { value: 1 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          vP = position;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
          vec2 h = vP.xy * 7.0 + vec2(0.0, uTime);
          vec2 g = abs(fract(h) - 0.5);
          float grid = smoothstep(0.42, 0.48, max(g.x, g.y));
          float a = (f * 0.9 + grid * 0.2 + 0.06) * uAlpha;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 18), mat);
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k, _dt, age) => {
        const p = getPos();
        if (p) mesh.position.copy(p);
        mat.uniforms.uTime.value = age;
        const inK = Math.min(1, k * 8);
        mesh.scale.setScalar(0.7 + 0.3 * inK);
        mat.uniforms.uAlpha.value = k < 0.85 ? inK : 1 - (k - 0.85) / 0.15;
      },
      dispose: () => {
        mesh.geometry.dispose();
        mat.dispose();
      },
    });
  }

  /** 竖着立起的水墙 / 光墙：沿 dir 方向的一段半透明墙，条纹流动。 */
  wall(
    center: THREE.Vector3,
    yaw: number,
    width: number,
    height: number,
    color: THREE.ColorRepresentation,
    dur: number,
  ): void {
    const geo = new THREE.PlaneGeometry(width, height, 24, 1);
    geo.translate(0, height / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color).multiplyScalar(1.8) },
        uMap: { value: streakNoise() },
        uTime: { value: 0 },
        uAlpha: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(uTime * 3.0 + p.x * 3.0) * 0.08 * uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          float n = texture2D(uMap, vec2(vUv.x * 4.0, vUv.y - uTime * 0.8)).r;
          float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
          float top = 1.0 - smoothstep(0.75, 1.0, vUv.y);
          float a = (0.25 + n * 0.6 + smoothstep(0.9, 1.0, 1.0 - abs(vUv.y - 0.02) * 20.0)) * edge * top * uAlpha;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    mesh.rotation.y = yaw;
    this.push({
      obj: mesh,
      age: 0,
      life: dur,
      tick: (k, _dt, age) => {
        mat.uniforms.uTime.value = age;
        mesh.scale.y = Math.min(1, k * 8);
        mat.uniforms.uAlpha.value = k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
      },
      dispose: () => {
        geo.dispose();
        mat.dispose();
      },
    });
  }
}

function zigzag(
  a: THREE.Vector3,
  b: THREE.Vector3,
  jitter: number,
  rand: () => number,
  segs = 9,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [a.clone()];
  const dir = b.clone().sub(a);
  const len = dir.length();
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const p = a.clone().addScaledVector(dir, t);
    const amp = jitter * len * 0.18 * Math.sin(t * Math.PI);
    p.addScaledVector(side, (rand() - 0.5) * 2 * amp);
    p.y += (rand() - 0.5) * amp;
    pts.push(p);
  }
  pts.push(b.clone());
  return pts;
}

void _q;
