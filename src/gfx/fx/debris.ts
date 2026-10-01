// 实体碎片：碎石、晶片、叶片、冰碴、火星——真正的三维小块，翻滚着飞出去、落地弹两下，受场景光照。
// 每种碎片一个实例化网格池，数量有上限，满了就顶掉最旧的。
import * as THREE from 'three';
import { faceted, leafShape, rocky } from '../kit/geo.js';
import { toonMaterial } from '../toon.js';

export type DebrisKind = 'rock' | 'crystal' | 'leaf' | 'ice' | 'ember' | 'petal';

export interface DebrisBurst {
  kind: DebrisKind;
  at: THREE.Vector3;
  count: number;
  /** 飞出速度（米/秒）。 */
  speed: [number, number];
  /** 额外向上的速度。 */
  up?: number;
  size: [number, number];
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  life?: [number, number];
  /** 只往某个方向喷（带一点散开）。 */
  dir?: THREE.Vector3;
  spread?: number;
  /** 从这个半径的圆盘里发出。 */
  radius?: number;
}

interface Physics {
  gravity: number;
  drag: number;
  bounce: number;
  spin: number;
}

const PHYSICS: Record<DebrisKind, Physics> = {
  rock: { gravity: 12, drag: 0.6, bounce: 0.35, spin: 9 },
  crystal: { gravity: 10, drag: 0.8, bounce: 0.4, spin: 12 },
  ice: { gravity: 10, drag: 0.8, bounce: 0.3, spin: 12 },
  leaf: { gravity: 1.6, drag: 2.6, bounce: 0.1, spin: 7 },
  petal: { gravity: 1.2, drag: 2.8, bounce: 0.1, spin: 6 },
  ember: { gravity: -0.6, drag: 1.6, bounce: 0.2, spin: 4 },
};

const CAP = 220;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

class Pool {
  readonly mesh: THREE.InstancedMesh;
  readonly phys: Physics;
  private n = 0;
  private next = 0;
  private px = new Float32Array(CAP);
  private py = new Float32Array(CAP);
  private pz = new Float32Array(CAP);
  private vx = new Float32Array(CAP);
  private vy = new Float32Array(CAP);
  private vz = new Float32Array(CAP);
  private rx = new Float32Array(CAP);
  private ry = new Float32Array(CAP);
  private rz = new Float32Array(CAP);
  private wx = new Float32Array(CAP);
  private wy = new Float32Array(CAP);
  private size = new Float32Array(CAP);
  private age = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private alive = new Uint8Array(CAP);

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, phys: Physics) {
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.phys = phys;
    // 预先建好实例颜色
    this.mesh.setColorAt(0, _c.set(0xffffff));
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, size: number, life: number, color: THREE.Color): void {
    let i = -1;
    for (let k = 0; k < CAP; k++) {
      const j = (this.next + k) % CAP;
      if (!this.alive[j]) {
        i = j;
        break;
      }
    }
    if (i < 0) i = this.next;
    this.next = (i + 1) % CAP;
    this.alive[i] = 1;
    this.px[i] = p.x;
    this.py[i] = p.y;
    this.pz[i] = p.z;
    this.vx[i] = v.x;
    this.vy[i] = v.y;
    this.vz[i] = v.z;
    this.rx[i] = Math.random() * 6;
    this.ry[i] = Math.random() * 6;
    this.rz[i] = Math.random() * 6;
    this.wx[i] = (Math.random() - 0.5) * this.phys.spin * 2;
    this.wy[i] = (Math.random() - 0.5) * this.phys.spin * 2;
    this.size[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.n = Math.max(this.n, i + 1);
  }

  update(dt: number): number {
    const ph = this.phys;
    const drag = Math.exp(-ph.drag * dt);
    let top = 0;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      this.age[i] = (this.age[i] as number) + dt;
      const k = (this.age[i] as number) / (this.life[i] as number);
      if (k >= 1) {
        this.alive[i] = 0;
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      live++;
      top = i + 1;
      this.vy[i] = (this.vy[i] as number) - ph.gravity * dt;
      this.vx[i] = (this.vx[i] as number) * drag;
      this.vy[i] = (this.vy[i] as number) * (ph.gravity < 0 ? drag : 1);
      this.vz[i] = (this.vz[i] as number) * drag;
      this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
      this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
      this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * dt;
      const s = this.size[i] as number;
      const floor = s * 0.35;
      if ((this.py[i] as number) < floor) {
        this.py[i] = floor;
        if ((this.vy[i] as number) < 0) {
          this.vy[i] = -(this.vy[i] as number) * ph.bounce;
          this.vx[i] = (this.vx[i] as number) * 0.55;
          this.vz[i] = (this.vz[i] as number) * 0.55;
          this.wx[i] = (this.wx[i] as number) * 0.5;
          this.wy[i] = (this.wy[i] as number) * 0.5;
        }
      }
      const grounded =
        (this.py[i] as number) <= floor + 1e-3 && Math.abs(this.vy[i] as number) < 0.3;
      if (!grounded) {
        this.rx[i] = (this.rx[i] as number) + (this.wx[i] as number) * dt;
        this.ry[i] = (this.ry[i] as number) + (this.wy[i] as number) * dt;
      }
      // 最后四分之一的寿命里缩小消失
      const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      const pop = Math.min(1, (this.age[i] as number) / 0.05);
      const sc = s * fade * pop;
      _e.set(this.rx[i] as number, this.ry[i] as number, this.rz[i] as number);
      _q.setFromEuler(_e);
      _m.compose(
        _p.set(this.px[i] as number, this.py[i] as number, this.pz[i] as number),
        _q,
        _s.set(sc, sc, sc),
      );
      this.mesh.setMatrixAt(i, _m);
    }
    this.n = top;
    this.mesh.count = top;
    this.mesh.instanceMatrix.needsUpdate = true;
    return live;
  }

  clear(): void {
    this.alive.fill(0);
    this.n = 0;
    this.mesh.count = 0;
  }
}

export class Debris {
  readonly group = new THREE.Group();
  private pools = new Map<DebrisKind, Pool>();
  private disposables: Array<{ dispose(): void }> = [];
  /** 数量倍率（画质低时减少）。 */
  quality = 1;
  private liveCount = 0;

  private pool(kind: DebrisKind): Pool {
    let p = this.pools.get(kind);
    if (p) return p;
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    if (kind === 'rock') {
      geo = faceted(rocky(new THREE.IcosahedronGeometry(0.5, 0), 0.18, 3, 7));
      mat = toonMaterial({ vertexColors: false, color: 0xffffff });
    } else if (kind === 'crystal' || kind === 'ice') {
      geo = faceted(new THREE.OctahedronGeometry(0.5, 0));
      geo.scale(0.45, 1.2, 0.45);
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.6, 1.6, 1.6),
        transparent: kind === 'ice',
        opacity: 0.85,
      });
    } else if (kind === 'leaf' || kind === 'petal') {
      const shape = leafShape(kind === 'leaf' ? 0.5 : 0.6, 1, kind === 'leaf' ? 0.55 : 0.8);
      geo = new THREE.ShapeGeometry(shape, 6);
      geo.translate(0, -0.5, 0);
      mat = toonMaterial({ vertexColors: false, color: 0xffffff, side: THREE.DoubleSide });
    } else {
      geo = new THREE.IcosahedronGeometry(0.5, 0);
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(3, 3, 3),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
    }
    this.disposables.push(geo, mat);
    p = new Pool(geo, mat, PHYSICS[kind]);
    this.pools.set(kind, p);
    this.group.add(p.mesh);
    return p;
  }

  burst(o: DebrisBurst): void {
    const pool = this.pool(o.kind);
    const n = Math.max(1, Math.round(o.count * this.quality));
    const c0 = new THREE.Color(o.color);
    const c1 = new THREE.Color(o.color2 ?? o.color);
    const life = o.life ?? [0.9, 1.6];
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      if (o.dir) {
        const spread = o.spread ?? 0.4;
        v.copy(o.dir)
          .normalize()
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 2 * spread,
              (Math.random() - 0.2) * spread,
              (Math.random() - 0.5) * 2 * spread,
            ),
          )
          .normalize()
          .multiplyScalar(sp);
      } else {
        const a = Math.random() * Math.PI * 2;
        const el = 0.25 + Math.random() * 0.9;
        v.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(
          sp,
        );
      }
      v.y += o.up ?? 0;
      const r = (o.radius ?? 0) * Math.sqrt(Math.random());
      const pa = Math.random() * Math.PI * 2;
      p.copy(o.at).add(new THREE.Vector3(Math.cos(pa) * r, 0, Math.sin(pa) * r));
      const size = o.size[0] + Math.random() * (o.size[1] - o.size[0]);
      _c.copy(c0).lerp(c1, Math.random());
      pool.spawn(p, v, size, life[0] + Math.random() * (life[1] - life[0]), _c);
    }
  }

  get alive(): number {
    return this.liveCount;
  }

  update(dt: number): void {
    let n = 0;
    for (const p of this.pools.values()) n += p.update(dt);
    this.liveCount = n;
  }

  clear(): void {
    for (const p of this.pools.values()) p.clear();
  }

  dispose(): void {
    this.clear();
    for (const d of this.disposables) d.dispose();
  }
}
