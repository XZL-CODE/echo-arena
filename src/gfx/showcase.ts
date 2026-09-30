// 展示台：星云背景、发光圆台与聚光。用于进化演出、图鉴里的 3D 查看与标题画面。
// 进化演出：粒子汇聚 → 全身发白、旋转升空、光柱冲天 → 旧形态收缩、新形态在白光里长出 → 冲击波 → 落地亮相。
import * as THREE from 'three';
import { Animator, type AnimState } from './anim/animator.js';
import type { Engine } from './engine.js';
import { Effects } from './fx/effects.js';
import { Particles } from './fx/particles.js';
import { attachExtras } from './kit/attachments.js';
import { ModelInstance } from './kit/rig.js';
import { blueprint, profileOf } from './models/index.js';
import { NOISE_GLSL, outlineShared } from './toon.js';

/** 星云天幕：缓慢旋转的彩色星云 + 星点。 */
function nebula(
  colors: [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation],
): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uA: { value: new THREE.Color(colors[0]) },
      uB: { value: new THREE.Color(colors[1]) },
      uC: { value: new THREE.Color(colors[2]) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uC;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float swirl = atan(d.x, d.z) + d.y * 2.0 + uTime * 0.03;
        vec3 p = vec3(cos(swirl), d.y * 2.0, sin(swirl)) * 2.0;
        float n = fbm3(p + vec3(0.0, uTime * 0.02, 0.0));
        float n2 = fbm3(p * 2.3 + 5.0);
        vec3 col = mix(uA, uB, smoothstep(0.3, 0.7, n));
        col = mix(col, uC, smoothstep(0.55, 0.85, n2) * 0.7);
        col *= 0.55 + 0.6 * smoothstep(-0.4, 0.6, d.y);
        float star = step(0.995, hash13(floor(d * 380.0)));
        col += vec3(star) * (0.6 + 0.4 * sin(uTime * 3.0 + hash13(floor(d * 380.0)) * 40.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), mat);
  mesh.renderOrder = -10;
  return mesh;
}

/** 发光圆台：石质台面 + 边缘金环 + 地面符文。 */
function pedestal(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.7, 0.3, 64),
    new THREE.MeshToonMaterial({ color: 0x2a2440 }),
  );
  top.position.y = -0.15;
  top.receiveShadow = true;
  g.add(top);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.52, 0.035, 8, 96),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc84e).multiplyScalar(2) }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  g.add(ring);
  return g;
}

export interface EvolveCallbacks {
  /** 形态切换的那一刻（界面可以同时换名字）。 */
  onSwap?(): void;
  onDone?(): void;
}

export class Showcase {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1.6, 0.05, 200);
  readonly particles = new Particles(1600);
  readonly effects = new Effects(3);
  private sky: THREE.Mesh;
  private stand: THREE.Group;
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private next: { model: ModelInstance; animator: Animator } | null = null;
  private time = 0;
  private evolve: { t: number; cb: EvolveCallbacks; swapped: boolean; color: THREE.Color } | null =
    null;
  private pose: AnimState = 'idle';
  private poseT = 0;
  /** 模型慢慢转动（图鉴查看）。 */
  spin = 0;
  private yaw = 0.35;
  private focusHeight = 1;
  private key: THREE.DirectionalLight;

  constructor() {
    this.sky = nebula([0x140c30, 0x3a1a6a, 0xd05aa0]);
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight(0xd8d0ff, 0x3a2a5a, 1.2));
    this.key = new THREE.DirectionalLight(0xfff0dc, 3.2);
    this.key.position.set(-2, 5, 4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    const cam = this.key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -3;
    cam.right = 3;
    cam.top = 3;
    cam.bottom = -3;
    this.scene.add(this.key);
    const rim = new THREE.DirectionalLight(0x9ad8ff, 1.2);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);
    this.stand = pedestal();
    this.scene.add(this.stand, this.particles.group, this.effects.group);
  }

  setColors(
    colors: [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation],
  ): void {
    const m = this.sky.material as THREE.ShaderMaterial;
    m.uniforms.uA.value.set(colors[0]);
    m.uniforms.uB.value.set(colors[1]);
    m.uniforms.uC.value.set(colors[2]);
  }

  private spawn(formId: string): { model: ModelInstance; animator: Animator } {
    const model = new ModelInstance(blueprint(formId, 'hi'));
    attachExtras(model);
    model.setRim(0xbfe8ff, 0.5);
    model.group.rotation.y = this.yaw;
    const animator = new Animator(model, profileOf(formId), 3);
    this.scene.add(model.group);
    return { model, animator };
  }

  private drop(m: ModelInstance | null): void {
    if (!m) return;
    this.scene.remove(m.group);
    m.dispose();
  }

  /** 展示一只宠物（替换当前的）。 */
  show(formId: string, pose: AnimState = 'idle'): void {
    this.drop(this.model);
    if (this.next) this.drop(this.next.model);
    this.next = null;
    this.evolve = null;
    const s = this.spawn(formId);
    this.model = s.model;
    this.animator = s.animator;
    this.pose = pose;
    this.poseT = 0;
    this.frame(s.model.blueprint.height);
  }

  setPose(pose: AnimState): void {
    this.pose = pose;
    this.poseT = 0;
  }

  private frame(height: number): void {
    this.focusHeight = height;
    const h = Math.max(0.7, height);
    this.camera.position.set(0, h * 0.62 + 0.2, h * 2.7 + 1.2);
    this.camera.lookAt(0, h * 0.48, 0);
  }

  /** 进化演出：from 当前在台上的形态，变成 toId。 */
  startEvolution(toId: string, color: THREE.ColorRepresentation, cb: EvolveCallbacks = {}): void {
    if (!this.model) this.show(toId);
    this.next = this.spawn(toId);
    this.next.model.group.scale.setScalar(0.001);
    this.evolve = { t: 0, cb, swapped: false, color: new THREE.Color(color) };
    this.pose = 'idle';
  }

  get evolving(): boolean {
    return this.evolve !== null;
  }

  /** 跳过演出直接看结果。 */
  skip(): void {
    if (!this.evolve) return;
    this.evolve.t = Math.max(this.evolve.t, 3.6);
  }

  update(dt: number): void {
    this.time += dt;
    this.poseT += dt;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    this.yaw += this.spin * dt;
    const drive = (m: ModelInstance, a: Animator, state: AnimState, t: number) => {
      m.group.rotation.y = this.yaw;
      a.update(
        { state, t, dur: state === 'ult' ? 1.4 : 0.8, speed: 0, time: this.time },
        dt,
        m.group.position,
        this.yaw,
      );
      for (const f of m.faces) f.set(a.expression);
      m.update(this.time, dt);
    };
    const ev = this.evolve;
    if (ev && this.model && this.animator && this.next) {
      ev.t += dt;
      const t = ev.t;
      const c = ev.color;
      const old = this.model;
      // 1 汇聚
      if (t < 1.6 && Math.random() < dt * 60) {
        this.particles.burst({
          count: 3,
          at: new THREE.Vector3(0, this.focusHeight * 0.5, 0),
          shape: 'sphere',
          radius: 2.2,
          speed: [0.1, 0.2],
          radial: -3,
          life: [0.5, 0.8],
          size: [0.05, 0.1],
          color: c,
          intensity: 3,
          cell: 'spark',
          fadeIn: 0.3,
        });
      }
      // 2 发白、旋转、升起
      const white = Math.min(1, Math.max(0, (t - 0.5) / 0.9));
      old.setFlash(white, 0xffffff);
      old.group.position.y = Math.max(0, (t - 0.6) * 0.25);
      this.yaw += dt * (1 + white * 10);
      if (t > 0.9 && t - dt <= 0.9) {
        this.effects.pillar(new THREE.Vector3(), 0.9, 9, c, 2.4, 2.6);
        this.effects.circle(new THREE.Vector3(), 1.6, c, 3, 'hexa', 1.5);
      }
      // 3 交换形态
      if (t >= 1.6 && !ev.swapped) {
        ev.swapped = true;
        this.effects.ring(new THREE.Vector3(0, 0.02, 0), 0.4, 4.5, c, 0.9, {
          intensity: 2.8,
          width: 0.25,
        });
        this.effects.flash(new THREE.Vector3(0, this.focusHeight * 0.5, 0), 2.2, 0xffffff, 0.5, 3);
        this.particles.burst({
          count: 90,
          at: new THREE.Vector3(0, this.focusHeight * 0.5, 0),
          shape: 'sphere',
          radius: 0.4,
          speed: [2, 5],
          life: [0.6, 1.2],
          size: [0.06, 0.12],
          color: c,
          color2: 0xffffff,
          intensity: 3,
          cell: 'star',
          spin: 6,
          drag: 1.5,
        });
        ev.cb.onSwap?.();
      }
      const swapK = Math.min(1, Math.max(0, (t - 1.45) / 0.3));
      old.group.scale.setScalar(Math.max(0.001, 1 - swapK));
      const nm = this.next.model;
      const grow = Math.min(1, Math.max(0, (t - 1.55) / 0.35));
      nm.group.scale.setScalar(Math.max(0.001, grow < 1 ? grow * 1.08 : 1));
      nm.setFlash(Math.max(0, 1 - Math.max(0, t - 1.9) / 0.8), 0xffffff);
      nm.group.position.y = Math.max(0, 0.35 - Math.max(0, t - 1.9) * 0.9);
      this.frame(Math.max(old.blueprint.height * (1 - swapK), nm.blueprint.height * grow, 0.6));
      drive(old, this.animator, 'idle', t);
      drive(nm, this.next.animator, t > 2.1 ? 'victory' : 'idle', Math.max(0, t - 2.1));
      if (t >= 4.2) {
        this.drop(old);
        this.model = nm;
        this.animator = this.next.animator;
        this.next = null;
        this.evolve = null;
        this.pose = 'idle';
        this.frame(nm.blueprint.height);
        ev.cb.onDone?.();
      }
    } else if (this.model && this.animator) {
      drive(this.model, this.animator, this.pose, this.poseT);
    }
    this.particles.update(dt);
    this.effects.update(dt);
  }

  render(engine: Engine, dt: number): void {
    this.camera.aspect = engine.width / Math.max(1, engine.height);
    this.camera.updateProjectionMatrix();
    outlineShared.resolution.set(
      engine.width * engine.pixelRatio,
      engine.height * engine.pixelRatio,
    );
    outlineShared.width = 1.8 * engine.pixelRatio;
    engine.render(this.scene, this.camera, dt);
  }

  dispose(): void {
    this.drop(this.model);
    if (this.next) this.drop(this.next.model);
    this.particles.clear();
    this.effects.clear();
  }
}
