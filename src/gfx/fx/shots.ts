// 飞行物的画面：火球、泡泡、叶箭、电球、晶石（抛物线）、晶片、陨石、凤凰。每个都有发光核心和拖尾粒子。
import * as THREE from 'three';
import { faceted } from '../kit/geo.js';
import { ELEMENT_COLOR, toWorld, type ViewProjectile } from '../battle/types.js';
import type { Particles } from './particles.js';

interface ShotView {
  obj: THREE.Object3D;
  kind: string;
  last: THREE.Vector3;
  seen: number;
  spin: number;
}

const _p = new THREE.Vector3();

function glowMat(color: THREE.ColorRepresentation, k: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
}

function haloMat(
  color: THREE.ColorRepresentation,
  k: number,
  opacity: number,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(k),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class Shots {
  readonly group = new THREE.Group();
  private views = new Map<number, ShotView>();
  private geos: Record<string, THREE.BufferGeometry> = {};
  private mats: Record<string, THREE.Material> = {};
  private frame = 0;

  private geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    return (this.geos[key] ??= make());
  }

  private mat(key: string, make: () => THREE.Material): THREE.Material {
    return (this.mats[key] ??= make());
  }

  private make(p: ViewProjectile): THREE.Object3D {
    const c = ELEMENT_COLOR[p.element] ?? ELEMENT_COLOR.fire;
    const g = new THREE.Group();
    const sgeo = this.geo('s', () => new THREE.SphereGeometry(1, 16, 12));
    const sphere = (r: number, color: number, k: number, halo = 2) => {
      const core = new THREE.Mesh(
        sgeo,
        this.mat(`c${color}${k}`, () => glowMat(color, k)),
      );
      core.scale.setScalar(r);
      g.add(core);
      const h = new THREE.Mesh(
        sgeo,
        this.mat(`h${color}`, () => haloMat(color, 1.2, 0.35)),
      );
      h.scale.setScalar(r * halo);
      g.add(h);
    };
    switch (p.kind) {
      case 'fireball':
        sphere(0.09, 0xffc84a, 3);
        break;
      case 'bigfireball':
        sphere(0.2, 0xffb03a, 3.4, 2.2);
        break;
      case 'breath':
        // 龙息：一团团翻滚的火，靠拖尾的大火焰粒子连成一道火流
        sphere(0.16, 0xffa030, 2.6, 2.6);
        break;
      case 'bubble': {
        const m = new THREE.Mesh(
          this.geo('s', () => new THREE.SphereGeometry(1, 16, 12)),
          this.mat('bubble', () => haloMat(0x9fe8ff, 1.3, 0.5)),
        );
        m.scale.setScalar(0.1);
        g.add(m);
        const hi = new THREE.Mesh(
          this.geo('s', () => new THREE.SphereGeometry(1, 16, 12)),
          this.mat('bubbleHi', () => glowMat(0xffffff, 2)),
        );
        hi.scale.setScalar(0.025);
        hi.position.set(-0.035, 0.04, 0.04);
        g.add(hi);
        break;
      }
      case 'arrow': {
        const shaft = new THREE.Mesh(
          this.geo('arrow', () =>
            new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6).rotateX(Math.PI / 2),
          ),
          this.mat('shaft', () => glowMat(0xb8ff8a, 1.4)),
        );
        const tip = new THREE.Mesh(
          this.geo('tip', () =>
            new THREE.ConeGeometry(0.04, 0.14, 6).rotateX(Math.PI / 2).translate(0, 0, 0.3),
          ),
          this.mat('tipm', () => glowMat(0xe8ffb0, 2.6)),
        );
        g.add(shaft, tip);
        break;
      }
      case 'spark':
        sphere(0.08, 0xfff0a0, 3.2, 2.6);
        break;
      case 'crystal':
      case 'bigcrystal': {
        const r = p.kind === 'crystal' ? 0.09 : 0.2;
        const m = new THREE.Mesh(
          this.geo('oct', () => faceted(new THREE.OctahedronGeometry(1, 0)).scale(0.7, 1.3, 0.7)),
          this.mat('crys', () => glowMat(0xd8a0ff, 2.2)),
        );
        m.scale.setScalar(r);
        g.add(m);
        const h = new THREE.Mesh(
          this.geo('s', () => new THREE.SphereGeometry(1, 16, 12)),
          this.mat('hcrys', () => haloMat(0xc88aff, 1.2, 0.3)),
        );
        h.scale.setScalar(r * 2);
        g.add(h);
        break;
      }
      case 'shard': {
        const m = new THREE.Mesh(
          this.geo('oct', () => faceted(new THREE.OctahedronGeometry(1, 0)).scale(0.7, 1.3, 0.7)),
          this.mat('shardm', () => glowMat(0xf0c0ff, 2.6)),
        );
        m.scale.set(0.035, 0.08, 0.035);
        g.add(m);
        break;
      }
      case 'meteor':
        sphere(0.35, 0xffb03a, 3.6, 2.2);
        break;
      case 'phoenix':
        sphere(0.3, 0xffe27a, 3.8, 3);
        break;
      default:
        sphere(0.08, c.light, 2.5);
    }
    return g;
  }

  /** 同步场上的飞行物，并沿路径撒拖尾粒子。 */
  sync(list: readonly ViewProjectile[], alpha: number, dt: number, particles: Particles): void {
    this.frame++;
    for (const p of list) {
      if (!p.alive) continue;
      let v = this.views.get(p.id);
      if (!v) {
        const obj = this.make(p);
        this.group.add(obj);
        v = {
          obj,
          kind: p.kind,
          last: new THREE.Vector3(),
          seen: this.frame,
          spin: Math.random() * 6,
        };
        toWorld(p.px, p.py, v.last);
        this.views.set(p.id, v);
      }
      v.seen = this.frame;
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      toWorld(x, y, _p);
      const height = (p.kind === 'crystal' || p.kind === 'bigcrystal' ? 0 : 0.7) + p.z / 100;
      _p.y = height;
      v.obj.position.copy(_p);
      const dx = _p.x - v.last.x;
      const dz = _p.z - v.last.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) v.obj.rotation.y = Math.atan2(dx, dz);
      v.spin += dt * 8;
      if (p.kind === 'crystal' || p.kind === 'bigcrystal' || p.kind === 'shard')
        v.obj.rotation.x = v.spin;
      this.trail(p, v.last, _p, particles);
      v.last.copy(_p);
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) {
        this.group.remove(v.obj);
        this.views.delete(id);
      }
    }
  }

  private trail(
    p: ViewProjectile,
    from: THREE.Vector3,
    to: THREE.Vector3,
    particles: Particles,
  ): void {
    const c = ELEMENT_COLOR[p.element] ?? ELEMENT_COLOR.fire;
    const dist = from.distanceTo(to);
    if (dist < 0.005) return;
    const mid = from.clone().lerp(to, 0.5);
    const echo = Math.min(4, p.echo);
    switch (p.kind) {
      case 'fireball':
      case 'bigfireball':
      case 'breath':
      case 'meteor':
      case 'phoenix': {
        const big =
          p.kind === 'fireball'
            ? 1
            : p.kind === 'bigfireball'
              ? 1.8
              : p.kind === 'breath'
                ? 2.4
                : 3;
        particles.burst({
          count: Math.ceil(2 * big),
          at: mid,
          shape: 'sphere',
          radius: 0.05 * big,
          speed: [0.1, 0.4],
          life: [0.25, 0.45],
          size: [0.16 * big, 0.26 * big],
          grow: 0.2,
          color: 0xffd060,
          color2: 0xff3a10,
          intensity: 2.4,
          cell: 'flame',
          up: 0.4,
        });
        if (big > 1)
          particles.burst({
            count: 1,
            at: mid,
            speed: [0.1, 0.3],
            life: [0.5, 0.9],
            size: [0.2 * big, 0.35 * big],
            grow: 1.6,
            color: 0x3a2a2a,
            alpha: 0.5,
            cell: 'smoke',
            additive: false,
            up: 0.5,
          });
        break;
      }
      case 'arrow':
        particles.burst({
          count: 1,
          at: mid,
          speed: [0, 0.05],
          life: [0.2, 0.3],
          size: [0.06, 0.08],
          color: 0xb8ff8a,
          intensity: 2,
          cell: 'glow',
        });
        if (echo > 0)
          particles.burst({
            count: 1,
            at: mid,
            speed: [0.2, 0.5],
            life: [0.3, 0.5],
            size: [0.08, 0.1],
            color: 0x7aff6a,
            intensity: 1.5,
            cell: 'leaf',
            spin: 6,
            gravity: 1,
          });
        break;
      case 'spark':
        particles.burst({
          count: 2,
          at: mid,
          shape: 'sphere',
          radius: 0.05,
          speed: [0.3, 1.2],
          life: [0.08, 0.18],
          size: [0.03, 0.05],
          color: 0xfff6a0,
          intensity: 3,
          cell: 'spark',
          stretch: 0.06,
        });
        break;
      case 'bubble':
        particles.burst({
          count: 1,
          at: mid,
          shape: 'sphere',
          radius: 0.06,
          speed: [0.05, 0.2],
          life: [0.3, 0.5],
          size: [0.04, 0.07],
          color: 0xbff4ff,
          intensity: 1.4,
          cell: 'bubble',
          up: 0.3,
        });
        break;
      case 'crystal':
      case 'bigcrystal':
      case 'shard':
        particles.burst({
          count: 1,
          at: mid,
          speed: [0, 0.1],
          life: [0.25, 0.4],
          size: [0.05, 0.09],
          color: 0xd8a0ff,
          intensity: 2.2,
          cell: 'star',
          spin: 4,
        });
        break;
      default:
        particles.burst({
          count: 1,
          at: mid,
          speed: [0, 0.1],
          life: [0.2, 0.3],
          size: [0.06, 0.08],
          color: c.light,
          intensity: 2,
          cell: 'glow',
        });
    }
  }

  clear(): void {
    for (const v of this.views.values()) this.group.remove(v.obj);
    this.views.clear();
  }
}
