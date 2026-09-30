// GPU 粒子：一个四边形实例化绘制成千上万个面向镜头的精灵（或沿速度方向拉长的火花）。
// 叠加与普通混合各一套；CPU 端按结构数组推进，每帧把存活的粒子打包进实例属性。
import * as THREE from 'three';
import { ATLAS_GRID, CELL, particleAtlas, type CellName } from './textures.js';

export interface BurstOptions {
  count: number;
  /** 发射中心（世界坐标）。 */
  at: THREE.Vector3;
  /** 发射区域：点、球、地面圆环、圆盘。 */
  shape?: 'point' | 'sphere' | 'ring' | 'disc';
  radius?: number;
  /** 基础速度方向（会被 spread 打散）。 */
  dir?: THREE.Vector3;
  speed?: [number, number];
  /** 速度方向的随机度（0 沿 dir，1 完全随机）。 */
  spread?: number;
  /** 从中心向外的径向速度（环形冲击用）。 */
  radial?: number;
  up?: number;
  life: [number, number];
  size: [number, number];
  /** 结束时的尺寸倍数。 */
  grow?: number;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  /** 颜色亮度倍数（大于 1 会进入泛光）。 */
  intensity?: number;
  alpha?: number;
  cell: CellName;
  gravity?: number;
  drag?: number;
  spin?: number;
  /** 沿速度拉长（火花、雨丝）。 */
  stretch?: number;
  additive?: boolean;
  /** 落地反弹（碎石）。 */
  bounce?: boolean;
  fadeIn?: number;
}

const _v = new THREE.Vector3();
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

class Pool {
  readonly cap: number;
  count = 0;
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  // 结构数组
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  age: Float32Array;
  life: Float32Array;
  s0: Float32Array;
  s1: Float32Array;
  rot: Float32Array;
  spin: Float32Array;
  col: Float32Array;
  col2: Float32Array;
  alpha: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  cell: Float32Array;
  stretch: Float32Array;
  bounce: Uint8Array;
  fadeIn: Float32Array;
  // 实例属性
  private iPos: THREE.InstancedBufferAttribute;
  private iSize: THREE.InstancedBufferAttribute;
  private iRot: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private iCell: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    const f = () => new Float32Array(cap);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.s0 = f();
    this.s1 = f();
    this.rot = f();
    this.spin = f();
    this.col = new Float32Array(cap * 3);
    this.col2 = new Float32Array(cap * 3);
    this.alpha = f();
    this.grav = f();
    this.drag = f();
    this.cell = f();
    this.stretch = f();
    this.bounce = new Uint8Array(cap);
    this.fadeIn = f();

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iCell = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (const a of [this.iPos, this.iSize, this.iRot, this.iColor, this.iCell, this.iVel])
      a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iSize', this.iSize);
    geo.setAttribute('iRot', this.iRot);
    geo.setAttribute('iColor', this.iColor);
    geo.setAttribute('iCell', this.iCell);
    geo.setAttribute('iVel', this.iVel);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: particleAtlas() }, uGrid: { value: ATLAS_GRID } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 iPos;
        attribute vec2 iSize;
        attribute float iRot;
        attribute vec4 iColor;
        attribute float iCell;
        attribute vec3 iVel;
        uniform float uGrid;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          vec2 q = position.xy;
          if (iSize.y > 0.0) {
            vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
            vec2 dir = normalize(vv.xy + vec2(1e-5, 0.0));
            vec2 perp = vec2(-dir.y, dir.x);
            mv.xy += dir * q.y * iSize.y + perp * q.x * iSize.x;
          } else {
            float c = cos(iRot);
            float s = sin(iRot);
            mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iSize.x;
          }
          gl_Position = projectionMatrix * mv;
          vec2 cell = vec2(mod(iCell, uGrid), floor(iCell / uGrid));
          vUv = vec2((cell.x + q.x + 0.5) / uGrid, 1.0 - (cell.y + 0.5 - q.y) / uGrid);
          vColor = iColor;
          // 贴着镜头的粒子淡掉（特写时不会糊成一大块）
          vColor.a *= smoothstep(0.8, 2.6, -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          float a = vColor.a * t.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor.rgb * t.rgb, a);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 19;
  }

  /** 取一个空位；满了就覆盖最老的一个。 */
  alloc(): number {
    if (this.count < this.cap) return this.count++;
    let oldest = 0;
    let best = -1;
    for (let i = 0; i < this.count; i++) {
      const k = (this.age[i] as number) / (this.life[i] as number);
      if (k > best) {
        best = k;
        oldest = i;
      }
    }
    return oldest;
  }

  kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const copy = (arr: Float32Array | Uint8Array, stride = 1) => {
      for (let k = 0; k < stride; k++) arr[i * stride + k] = arr[last * stride + k] as number;
    };
    for (const a of [
      this.px,
      this.py,
      this.pz,
      this.vx,
      this.vy,
      this.vz,
      this.age,
      this.life,
      this.s0,
      this.s1,
      this.rot,
      this.spin,
      this.alpha,
      this.grav,
      this.drag,
      this.cell,
      this.stretch,
      this.fadeIn,
    ])
      copy(a);
    copy(this.bounce);
    copy(this.col, 3);
    copy(this.col2, 3);
  }

  update(dt: number): void {
    for (let i = 0; i < this.count;) {
      const age = (this.age[i] as number) + dt;
      this.age[i] = age;
      if (age >= (this.life[i] as number)) {
        this.kill(i);
        continue;
      }
      const drag = Math.exp(-(this.drag[i] as number) * dt);
      this.vx[i] = (this.vx[i] as number) * drag;
      this.vz[i] = (this.vz[i] as number) * drag;
      this.vy[i] = (this.vy[i] as number) * drag - (this.grav[i] as number) * dt;
      this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
      this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
      this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * dt;
      if (this.bounce[i] && (this.py[i] as number) < 0.02) {
        this.py[i] = 0.02;
        this.vy[i] = Math.abs(this.vy[i] as number) * 0.35;
        this.vx[i] = (this.vx[i] as number) * 0.6;
        this.vz[i] = (this.vz[i] as number) * 0.6;
      }
      this.rot[i] = (this.rot[i] as number) + (this.spin[i] as number) * dt;
      i++;
    }
    const n = this.count;
    const pos = this.iPos.array as Float32Array;
    const size = this.iSize.array as Float32Array;
    const rot = this.iRot.array as Float32Array;
    const col = this.iColor.array as Float32Array;
    const cell = this.iCell.array as Float32Array;
    const vel = this.iVel.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const k = (this.age[i] as number) / (this.life[i] as number);
      pos[i * 3] = this.px[i] as number;
      pos[i * 3 + 1] = this.py[i] as number;
      pos[i * 3 + 2] = this.pz[i] as number;
      const s = (this.s0[i] as number) + ((this.s1[i] as number) - (this.s0[i] as number)) * k;
      const st = this.stretch[i] as number;
      if (st > 0) {
        const sp = Math.hypot(this.vx[i] as number, this.vy[i] as number, this.vz[i] as number);
        size[i * 2] = s;
        size[i * 2 + 1] = s + sp * st;
      } else {
        size[i * 2] = s;
        size[i * 2 + 1] = 0;
      }
      rot[i] = this.rot[i] as number;
      const fin = this.fadeIn[i] as number;
      const a =
        (fin > 0 ? Math.min(1, k / fin) : 1) *
        (1 - Math.max(0, (k - 0.55) / 0.45)) *
        (this.alpha[i] as number);
      const c = i * 3;
      col[i * 4] =
        (this.col[c] as number) + ((this.col2[c] as number) - (this.col[c] as number)) * k;
      col[i * 4 + 1] =
        (this.col[c + 1] as number) +
        ((this.col2[c + 1] as number) - (this.col[c + 1] as number)) * k;
      col[i * 4 + 2] =
        (this.col[c + 2] as number) +
        ((this.col2[c + 2] as number) - (this.col[c + 2] as number)) * k;
      col[i * 4 + 3] = a;
      cell[i] = this.cell[i] as number;
      vel[i * 3] = this.vx[i] as number;
      vel[i * 3 + 1] = this.vy[i] as number;
      vel[i * 3 + 2] = this.vz[i] as number;
    }
    this.geo.instanceCount = n;
    for (const a of [this.iPos, this.iSize, this.iRot, this.iColor, this.iCell, this.iVel]) {
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
    }
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private add: Pool;
  private norm: Pool;
  /** 画质系数（0.4–1），低画质时按比例少发粒子。 */
  quality = 1;
  private seed = 1;

  constructor(cap = 3200) {
    this.add = new Pool(cap, true);
    this.norm = new Pool(Math.round(cap * 0.6), false);
    this.group.add(this.norm.mesh, this.add.mesh);
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  get alive(): number {
    return this.add.count + this.norm.count;
  }

  burst(o: BurstOptions): void {
    const pool = o.additive === false ? this.norm : this.add;
    const n = Math.max(1, Math.round(o.count * this.quality));
    _c0.set(o.color).multiplyScalar(o.intensity ?? 1);
    _c1.set(o.color2 ?? o.color).multiplyScalar(o.intensity ?? 1);
    const dir = o.dir ?? new THREE.Vector3(0, 1, 0);
    const spread = o.spread ?? 1;
    const [sMin, sMax] = o.speed ?? [0.5, 1.5];
    const r = o.radius ?? 0;
    const cell = CELL[o.cell];
    for (let k = 0; k < n; k++) {
      const i = pool.alloc();
      // 位置
      let ox = 0;
      let oy = 0;
      let oz = 0;
      if (o.shape === 'sphere') {
        const u = this.rnd() * 2 - 1;
        const a = this.rnd() * Math.PI * 2;
        const rr = r * Math.cbrt(this.rnd());
        const sq = Math.sqrt(1 - u * u);
        ox = Math.cos(a) * sq * rr;
        oy = u * rr;
        oz = Math.sin(a) * sq * rr;
      } else if (o.shape === 'ring' || o.shape === 'disc') {
        const a = this.rnd() * Math.PI * 2;
        const rr = o.shape === 'ring' ? r : r * Math.sqrt(this.rnd());
        ox = Math.cos(a) * rr;
        oz = Math.sin(a) * rr;
      }
      pool.px[i] = o.at.x + ox;
      pool.py[i] = o.at.y + oy;
      pool.pz[i] = o.at.z + oz;
      // 速度：沿 dir 加随机，再加径向
      const sp = sMin + (sMax - sMin) * this.rnd();
      _v.set(this.rnd() * 2 - 1, this.rnd() * 2 - 1, this.rnd() * 2 - 1).normalize();
      _v.lerp(dir, 1 - spread)
        .normalize()
        .multiplyScalar(sp);
      if (o.radial) {
        const len = Math.hypot(ox, oz) || 1;
        _v.x += (ox / len) * o.radial * (0.6 + 0.4 * this.rnd());
        _v.z += (oz / len) * o.radial * (0.6 + 0.4 * this.rnd());
      }
      if (o.up) _v.y += o.up * (0.5 + 0.5 * this.rnd());
      pool.vx[i] = _v.x;
      pool.vy[i] = _v.y;
      pool.vz[i] = _v.z;
      pool.age[i] = 0;
      pool.life[i] = o.life[0] + (o.life[1] - o.life[0]) * this.rnd();
      const s = o.size[0] + (o.size[1] - o.size[0]) * this.rnd();
      pool.s0[i] = s;
      pool.s1[i] = s * (o.grow ?? 0.4);
      pool.rot[i] = this.rnd() * Math.PI * 2;
      pool.spin[i] = (this.rnd() * 2 - 1) * (o.spin ?? 0);
      const t = this.rnd() * 0.3;
      pool.col[i * 3] = _c0.r + (_c1.r - _c0.r) * t;
      pool.col[i * 3 + 1] = _c0.g + (_c1.g - _c0.g) * t;
      pool.col[i * 3 + 2] = _c0.b + (_c1.b - _c0.b) * t;
      pool.col2[i * 3] = _c1.r;
      pool.col2[i * 3 + 1] = _c1.g;
      pool.col2[i * 3 + 2] = _c1.b;
      pool.alpha[i] = o.alpha ?? 1;
      pool.grav[i] = o.gravity ?? 0;
      pool.drag[i] = o.drag ?? 0;
      pool.cell[i] = cell;
      pool.stretch[i] = o.stretch ?? 0;
      pool.bounce[i] = o.bounce ? 1 : 0;
      pool.fadeIn[i] = o.fadeIn ?? 0;
    }
  }

  update(dt: number): void {
    this.add.update(dt);
    this.norm.update(dt);
  }

  clear(): void {
    this.add.clear();
    this.norm.clear();
  }
}
