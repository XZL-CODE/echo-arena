// 场上的一只宠物：模型 + 动画 + 队伍色脚环 + 状态表现（受击闪白、灼烧、定身、眩晕、护盾、石肤、倒下溶解）。
import * as THREE from 'three';
import { Animator, type AnimState } from '../anim/animator.js';
import { attachExtras } from '../kit/attachments.js';
import { ModelInstance } from '../kit/rig.js';
import { blueprint, profileOf, type Lod } from '../models/index.js';
import { TEAM_COLOR, TEAM_RIM, toWorld, type ViewUnit } from './types.js';

const _v = new THREE.Vector3();
const _local = new THREE.Vector3();
const _box = new THREE.Box3();
const UP = new THREE.Vector3(0, 1, 0);
/** 模型在战场上的放大倍数：场地很开阔，按真实比例看单位太小。 */
export const VISUAL_SCALE = 1.28;

/** 各形态模型在自身坐标里的包围盒（绑定姿势，含放大倍数），同一形态只算一次。 */
const boundsCache = new Map<string, THREE.Box3>();

function localBounds(group: THREE.Object3D): THREE.Box3 {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(_box.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld));
  });
  return box;
}

/** 模型朝向（绕 y 轴）：模拟里的 facing 是 atan2(dy, dx)，模型正面朝 +z。 */
export function yawOf(facing: number): number {
  return Math.atan2(Math.cos(facing), Math.sin(facing));
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

let ringGeo: THREE.RingGeometry | null = null;

export class UnitView {
  readonly id: number;
  readonly team: 0 | 1;
  readonly formId: string;
  readonly model: ModelInstance;
  readonly animator: Animator;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly height: number;
  /** 模型在自身坐标里的包围盒：烛龙伸开的翅膀比身体宽得多，按高度估不出它会不会贴着镜头。 */
  readonly bounds: THREE.Box3;
  private yaw: number;
  private flash = 0;
  private flashCooldown = 0;
  private deadSince = -1;
  private removed = false;
  /** 头顶在世界里的位置（血条、伤害数字用）。 */
  readonly top = new THREE.Vector3();
  readonly world = new THREE.Vector3();
  /** 画面额外的抬升（击飞、大招腾空）。 */
  lift = 0;
  private lastAct = '';
  private actStartLocal = 0;

  constructor(u: ViewUnit, lod: Lod) {
    this.id = u.id;
    this.team = u.team;
    this.formId = `${u.species}-${u.form}`;
    const bp = blueprint(this.formId, lod);
    this.model = new ModelInstance(bp);
    attachExtras(this.model);
    this.model.setRim(TEAM_RIM[u.team], 0.6);
    this.animator = new Animator(this.model, profileOf(this.formId), u.id);
    this.model.group.scale.setScalar(VISUAL_SCALE);
    this.height = bp.height * VISUAL_SCALE;
    let bounds = boundsCache.get(this.formId);
    if (!bounds) {
      bounds = localBounds(this.model.group);
      boundsCache.set(this.formId, bounds);
    }
    this.bounds = bounds;
    this.yaw = yawOf(u.facing);
    if (!ringGeo) ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(TEAM_COLOR[u.team]).multiplyScalar(1.4),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    const r = Math.max(0.2, u.radius / 100) * 1.25;
    this.ring.scale.setScalar(r);
    this.model.group.add(this.ring);
  }

  get object(): THREE.Group {
    return this.model.group;
  }

  get gone(): boolean {
    return this.removed;
  }

  /**
   * 按模拟状态更新。alpha 是两个模拟步之间的插值，now 是战斗时间（秒），dt 是画面帧间隔。
   */
  update(u: ViewUnit, alpha: number, now: number, dt: number, time: number): void {
    const x = u.px + (u.x - u.px) * alpha;
    const y = u.py + (u.y - u.py) * alpha;
    toWorld(x, y, this.world);
    const air = u.airborne > 0 ? Math.sin(Math.min(1, u.airborne / 0.9) * Math.PI) * 0.55 : 0;
    this.lift += (air - this.lift) * Math.min(1, dt * 18);
    this.model.group.position.set(this.world.x, this.lift, this.world.z);

    // 朝向：转向有速度上限；左右侧身时向镜头偏一点，看得到脸
    let target = yawOf(u.facing);
    const lateral = Math.abs(Math.sin(target));
    target = lerpAngle(target, 0, 0.28 * lateral);
    this.yaw = lerpAngle(this.yaw, target, Math.min(1, dt * 10));
    this.model.group.rotation.y = this.yaw;

    // 动作
    const moving = Math.hypot(u.x - u.px, u.y - u.py) > 0.25;
    let state: AnimState = 'idle';
    let dur = Math.max(0.2, u.actDur || 0.6);
    const since = Math.max(0, now - u.actAt);
    if (!u.alive) state = 'dead';
    else if (u.stun > 0 || u.airborne > 0) state = 'stun';
    else if (u.act === 'attack') state = 'attack';
    else if (u.act === 'skill') state = 'cast';
    else if (u.act === 'ult') state = 'ult';
    else if (u.act === 'guard' || u.guard > 0) state = 'guard';
    else if (u.act === 'dash' || u.act === 'move' || moving) state = 'run';
    if (u.alive && now - u.spawnAt < 0.45 && u.spawnAt > 0.01) state = 'spawn';
    if (u.alive && now - u.hitAt < 0.18 && (state === 'idle' || state === 'run')) {
      state = 'hit';
      dur = 0.22;
    }
    const actKey = `${state}:${state === 'hit' ? u.hitAt : u.actAt}`;
    if (actKey !== this.lastAct) {
      this.lastAct = actKey;
      this.actStartLocal = time;
    }
    let tIn =
      state === 'attack' || state === 'cast' || state === 'ult' ? since : time - this.actStartLocal;
    if (state === 'dead') tIn = Math.max(0, now - u.diedAt);
    const speed = moving ? Math.hypot(u.x - u.px, u.y - u.py) * 0.6 : 0;
    // 移动方向换到模型自己的坐标里（侧移、后撤步用）
    let moveAngle = 0;
    if (moving) {
      const dx = u.x - u.px;
      const dz = u.y - u.py;
      const c = Math.cos(this.yaw);
      const sn = Math.sin(this.yaw);
      moveAngle = Math.atan2(dx * c - dz * sn, dx * sn + dz * c);
    }
    this.animator.update(
      { state, t: tIn, dur, speed, time, moveAngle },
      dt,
      this.model.group.position,
      this.yaw,
    );
    for (const face of this.model.faces) face.set(this.animator.expression);

    // 受击闪白（约 0.1 秒，见 hit）
    this.flashCooldown = Math.max(0, this.flashCooldown - dt);
    this.flash = Math.max(0, this.flash - dt * 9);
    this.model.setFlash(this.flash * 0.6, 0xffffff);

    // 持续状态的染色：灼烧橙红脉动、石肤灰、定身绿、眩晕黄
    if (u.burn > 0) this.model.setTint(0.35 + 0.15 * Math.sin(time * 14), 0xff7a3a);
    else if (u.stoneSkin > 0) this.model.setTint(0.45, 0xb8b0a8);
    else if (u.root > 0) this.model.setTint(0.3, 0x8aff8a);
    else this.model.setTint(0);

    // 倒下：动作放完后溶解，脚环淡出
    if (!u.alive) {
      if (this.deadSince < 0) this.deadSince = time;
      const k = Math.max(0, (time - this.deadSince - 0.45) / 0.9);
      this.model.setDissolve(Math.min(1, k), u.team === 0 ? 0x9fe8ff : 0xffb070);
      this.ring.material.opacity = 0.55 * (1 - Math.min(1, (time - this.deadSince) * 2));
      if (k >= 1) {
        this.removed = true;
        this.model.group.visible = false;
      }
    }

    this.model.update(time, dt);
    // 头顶位置：模型高度加一点余量
    this.top.set(this.world.x, this.lift + this.height + 0.12, this.world.z);
  }

  /** 屏幕上的点击半径（米）。 */
  hitRadius(): number {
    return Math.max(0.3, this.height * 0.35);
  }

  center(out = _v): THREE.Vector3 {
    return out.set(this.world.x, this.lift + this.height * 0.5, this.world.z);
  }

  /** 镜头离模型有多近（米，到包围盒表面；在盒子里是 0）。 */
  clearance(eye: THREE.Vector3): number {
    // 换到模型自己的坐标里：模型只绕竖直轴转，包围盒已含放大倍数
    _local.copy(eye).sub(this.model.group.position).applyAxisAngle(UP, -this.yaw);
    return this.bounds.distanceToPoint(_local);
  }

  /**
   * 挨打闪白一下。同一只 0.5 秒内最多闪一次：混战里一只宠物每秒要挨好几下，下下都闪就成了频闪。
   * 持续伤害不闪（导演只在直接命中时调用）；strong 是克制、高等级回响或击倒，闪得亮一些。
   */
  hit(strong: boolean): void {
    if (this.flashCooldown > 0) return;
    this.flash = strong ? 1 : 0.7;
    this.flashCooldown = 0.5;
  }

  dispose(): void {
    this.model.dispose();
    this.ring.material.dispose();
  }
}
