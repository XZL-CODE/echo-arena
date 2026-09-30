// 战斗镜头：斜 38° 俯视战场。开打后慢慢推近到装下交战区域（最远看全场），平时带一点缓慢的漂移；
// 放技能时推到施放者身边的特写，大招分两段：先绕到正面仰拍蓄力，再切到侧面看出手命中。
// 另外有震屏与冲击推近。
import * as THREE from 'three';
import { FIELD } from './stage.js';

const PITCH = THREE.MathUtils.degToRad(38);
const FOV = 32;
/** 看全场时镜头对准的点。 */
const FULL_TARGET = new THREE.Vector3(0, 0, 0.35);
const UP = new THREE.Vector3(0, 1, 0);

/** 交战区域：世界坐标 XZ 上的包围盒。 */
export interface FrameBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 一段机位：先用 move 秒移过去，再停 hold 秒（停的时候可以绕目标慢转、慢慢推拉）。 */
interface ShotPose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  move: number;
  hold: number;
  /** 停留时绕目标转的角速度（弧度/秒）。 */
  orbit?: number;
  /** 停留时朝目标推近的速度（米/秒，负数是拉远）。 */
  dolly?: number;
}

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

interface Shot {
  kind: 'skill' | 'ult';
  poses: ShotPose[];
  start: Pose;
  t: number;
  out: number;
}

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.1, 400);
  private probe = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.1, 400);
  private dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
  private fullDist = 20;
  private dist = 20;
  private goalDist = 20;
  private center = FULL_TARGET.clone();
  private goalCenter = FULL_TARGET.clone();
  private trauma = 0;
  private shakeTime = 0;
  private punch = 0;
  private punchVel = 0;
  private shot: Shot | null = null;
  private clock = 0;
  /** 关掉震屏（设置里的选项）。 */
  shakeEnabled = true;
  /** 平时的缓慢漂移（关掉就是完全静止的俯视）。 */
  drift = true;
  aspect = 1.6;
  /**
   * 特写机位被别的单位挡住的程度（越小越好），由战场按单位位置算。
   * 特写从几个候选机位里挑挡得最少的；没有时用默认机位。
   */
  occlusion: ((eye: THREE.Vector3, target: THREE.Vector3) => number) | null = null;

  constructor() {
    this.fit(1.6);
    this.goalDist = this.fullDist;
    this.snap();
  }

  /** 按窗口比例求看全场的镜头距离，让交战区（含边距）完整落在画面里。 */
  fit(aspect: number): void {
    this.aspect = aspect;
    for (const cam of [this.camera, this.probe]) {
      cam.aspect = aspect;
      cam.fov = FOV;
      cam.updateProjectionMatrix();
    }
    // 取景范围：单位实际活动的区域（场地边缘各收一点），远处一排的头顶也要进画面；
    // 上方留出顶栏、下方留出底栏的位置
    const hw = FIELD.width / 2 - 0.5;
    const hd = FIELD.depth / 2 - 0.25;
    const ratio = this.dist / this.fullDist;
    this.fullDist = this.search([-hw, hw, -hd, hd], 6, 80, () => FULL_TARGET, 0.98, 0.8, -0.78);
    this.dist = Math.min(this.fullDist, ratio * this.fullDist);
    this.goalDist = Math.min(this.goalDist, this.fullDist);
  }

  /** 二分求最近的镜头距离，使盒子四角（含 1.8 米高的远处一排）都落在画面的给定范围里。 */
  private search(
    box: [number, number, number, number],
    near: number,
    far: number,
    centerAt: (d: number) => THREE.Vector3,
    sx: number,
    top: number,
    bottom: number,
  ): number {
    const [x0, x1, z0, z1] = box;
    const corners = [
      new THREE.Vector3(x0, 0, z0),
      new THREE.Vector3(x1, 0, z0),
      new THREE.Vector3(x0, 0, z1),
      new THREE.Vector3(x1, 0, z1),
      new THREE.Vector3(x0, 1.8, z0),
      new THREE.Vector3(x1, 1.8, z0),
    ];
    const p = new THREE.Vector3();
    let lo = near;
    let hi = far;
    for (let i = 0; i < 24; i++) {
      const d = (lo + hi) / 2;
      const c = centerAt(d);
      this.probe.position.copy(c).addScaledVector(this.dir, d);
      this.probe.lookAt(c);
      this.probe.updateMatrixWorld(true);
      const fits = corners.every((k) => {
        p.copy(k).project(this.probe);
        return Math.abs(p.x) < sx && p.y < top && p.y > bottom;
      });
      if (fits) hi = d;
      else lo = d;
    }
    return hi;
  }

  /**
   * 交战区域（null 表示看全场）：镜头慢慢推近到正好装下它，最远看全场。
   * 推得越近，画面中心越往交战区域移；拉远时回到场地中央。
   */
  frame(box: FrameBox | null): void {
    if (!box) {
      this.goalDist = this.fullDist;
      this.goalCenter.copy(FULL_TARGET);
      return;
    }
    // 四周留出特效和血条的余地，并限制最小取景，免得贴得太近
    let x0 = box.minX - 1.1;
    let x1 = box.maxX + 1.1;
    let z0 = box.minZ - 1;
    let z1 = box.maxZ + 0.8;
    const minW = 6.4;
    const minD = 3.6;
    if (x1 - x0 < minW) {
      const c = (x0 + x1) / 2;
      x0 = c - minW / 2;
      x1 = c + minW / 2;
    }
    if (z1 - z0 < minD) {
      const c = (z0 + z1) / 2;
      z0 = c - minD / 2;
      z1 = c + minD / 2;
    }
    const target = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2 + 0.2);
    const centerAt = (d: number) => {
      const k = Math.max(0, Math.min(1, (this.fullDist - d) / (this.fullDist * 0.35)));
      return FULL_TARGET.clone().lerp(target, k);
    };
    const d = this.search(
      [x0, x1, z0, z1],
      this.fullDist * 0.5,
      this.fullDist,
      centerAt,
      0.95,
      0.76,
      -0.74,
    );
    this.goalDist = d;
    this.goalCenter.copy(centerAt(d));
  }

  /** 立刻跳到目标取景（换场、重开时用）。 */
  snap(): void {
    this.dist = this.goalDist;
    this.center.copy(this.goalCenter);
  }

  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** 冲击时镜头往前推一下再弹回。 */
  kick(amount: number): void {
    if (!this.shakeEnabled) return;
    this.punchVel += amount;
  }

  get inShot(): boolean {
    return this.shot !== null;
  }

  /** 正在播大招镜头（期间不再切别的镜头）。 */
  get inUltShot(): boolean {
    return this.shot?.kind === 'ult';
  }

  /** 兼容旧接口：推到 focus 身前的特写。 */
  get inCloseUp(): boolean {
    return this.inShot;
  }

  /** 当前镜头朝向（从目标指向镜头的水平方向）。 */
  private viewSide(): THREE.Vector3 {
    const v = this.camera.position.clone().sub(this.currentTarget());
    v.y = 0;
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1);
    return v.normalize();
  }

  private currentTarget(): THREE.Vector3 {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    const t = -this.camera.position.y / (d.y || -1);
    return this.camera.position.clone().addScaledVector(d, Math.max(0, t));
  }

  private begin(kind: 'skill' | 'ult', poses: ShotPose[], out: number): void {
    this.shot = {
      kind,
      poses,
      start: {
        pos: this.camera.position.clone(),
        target: this.currentTarget(),
        fov: this.camera.fov,
      },
      t: 0,
      out,
    };
  }

  /**
   * 技能特写：从当前视角的方向偏一点，压低到二十几度，推到施放者身边停一会儿再拉回。
   * focus 是脚下位置，facing 是模拟坐标里的朝向。
   */
  skillShot(focus: THREE.Vector3, height: number, facing: number): void {
    if (this.shot) return;
    const view = this.viewSide();
    // 往施放者面朝的那一侧偏，拍到脸而不是后脑勺；被别的单位挡住时换个角度或退远一点
    const fwd = new THREE.Vector3(Math.cos(facing), 0, Math.sin(facing));
    const turn = Math.sign(view.x * fwd.z - view.z * fwd.x) || 1;
    const elev = THREE.MathUtils.degToRad(22);
    const target = focus.clone().addScaledVector(UP, height * 0.6);
    const candidates: THREE.Vector3[] = [];
    for (const angle of [0.38, 0.95, -0.2]) {
      for (const far of [1, 1.35]) {
        const side = view.clone().applyAxisAngle(UP, -turn * angle);
        const dist = (2.4 + height * 2.1) * far;
        candidates.push(
          target
            .clone()
            .addScaledVector(side, Math.cos(elev) * dist)
            .addScaledVector(UP, Math.sin(elev) * dist),
        );
      }
    }
    const pos = this.clearest(candidates, (c) => c, target);
    this.begin(
      'skill',
      [{ pos, target, fov: 30, move: 0.22, hold: 0.55, orbit: 0.22 * turn, dolly: 0.35 }],
      0.5,
    );
  }

  /** 从候选里挑视线挡得最少的（同样清楚时取靠前的，也就是默认机位）。 */
  private clearest<T>(candidates: T[], eyeOf: (c: T) => THREE.Vector3, target: THREE.Vector3): T {
    const first = candidates[0] as T;
    const score = this.occlusion;
    if (!score) return first;
    let best = first;
    let bestScore = Infinity;
    candidates.forEach((c, i) => {
      const s = score(eyeOf(c), target) + i * 0.04;
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    });
    return best;
  }

  /**
   * 大招镜头：① 绕到施放者正面偏下仰拍，慢慢推近（蓄力）；② 切到侧面，把施放者和目标一起框进来看出手；③ 拉回战场。
   */
  ultShot(
    focus: THREE.Vector3,
    height: number,
    facing: number,
    target: THREE.Vector3 | null,
  ): void {
    const face = new THREE.Vector3(Math.cos(facing), 0, Math.sin(facing));
    const h = Math.max(0.8, height);
    const heroTarget = focus.clone().addScaledVector(UP, h * 0.68);
    // 正面偏侧仰拍：默认在朝镜头这一边（+z），被挡住时换到另一边、转个角度或退远一点
    const heroCandidates: THREE.Vector3[] = [];
    for (const flip of [1, -1]) {
      for (const angle of [0, 0.5, -0.5]) {
        for (const far of [1, 1.3]) {
          const fwd = face.clone().applyAxisAngle(UP, angle);
          const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
          if (side.z * flip < 0) side.negate();
          heroCandidates.push(
            focus
              .clone()
              .addScaledVector(fwd, (1.5 + h * 1.35) * far)
              .addScaledVector(side, (0.9 + h * 0.55) * far)
              .addScaledVector(UP, h * 0.42 * far),
          );
        }
      }
    }
    const heroPos = this.clearest(heroCandidates, (c) => c, heroTarget);
    const side = new THREE.Vector3(-face.z, 0, face.x);
    if (side.z < 0) side.negate();
    const poses: ShotPose[] = [
      {
        pos: heroPos,
        target: heroTarget,
        fov: 34,
        move: 0.32,
        hold: 0.8,
        orbit: 0.28,
        dolly: 0.35,
      },
    ];
    if (target) {
      const mid = focus.clone().lerp(target, 0.55);
      const span = focus.distanceTo(target);
      const line = target.clone().sub(focus).setY(0);
      const perp = new THREE.Vector3(-line.z, 0, line.x).normalize();
      if (perp.lengthSq() < 1e-6) perp.copy(side);
      if (perp.z < 0) perp.negate();
      const aim = mid.clone().addScaledVector(UP, 0.7);
      // 侧面看出手：默认从镜头这一边，挡住时换另一边或退远
      const sideCandidates: THREE.Vector3[] = [];
      for (const flip of [1, -1]) {
        for (const far of [1, 1.3]) {
          const dist = Math.max(4.5, span * 0.95 + 3) * far;
          sideCandidates.push(
            mid
              .clone()
              .addScaledVector(perp, dist * flip)
              .addScaledVector(UP, 1.8 + dist * 0.28),
          );
        }
      }
      poses.push({
        pos: this.clearest(sideCandidates, (c) => c, aim),
        target: aim,
        fov: 34,
        move: 0.3,
        hold: 0.85,
        dolly: -0.6,
      });
    }
    this.begin('ult', poses, 0.65);
  }

  /** 兼容旧接口：大招特写（没有目标信息时只拍施放者）。 */
  closeUp(focus: THREE.Vector3, facing: number, height: number): void {
    this.ultShot(focus, height, facing, null);
  }

  /** 平时的机位：交战区取景 + 缓慢漂移。 */
  private basePose(out: Pose): void {
    const yaw = this.drift
      ? 0.06 * Math.sin(this.clock * 0.17) + 0.025 * Math.sin(this.clock * 0.41 + 1.3)
      : 0;
    const d = this.dist * (this.drift ? 1 + 0.015 * Math.sin(this.clock * 0.23) : 1);
    const dir = this.dir.clone().applyAxisAngle(UP, yaw);
    out.target.copy(this.center);
    out.pos.copy(this.center).addScaledVector(dir, d);
    out.fov = FOV;
  }

  private posed(p: ShotPose, t: number, out: Pose): void {
    out.target.copy(p.target);
    out.pos.copy(p.pos);
    if (p.orbit)
      out.pos
        .sub(p.target)
        .applyAxisAngle(UP, p.orbit * t)
        .add(p.target);
    if (p.dolly) {
      const toward = p.target.clone().sub(out.pos);
      const len = toward.length();
      out.pos.addScaledVector(toward.normalize(), Math.min(len * 0.5, p.dolly * t));
    }
    out.fov = p.fov;
  }

  update(dt: number): void {
    this.clock += dt;
    // 取景慢慢跟过去：拉远比推近快一点，免得有人跑出画面
    const rate = this.goalDist > this.dist ? 1.6 : 0.8;
    this.dist += (this.goalDist - this.dist) * (1 - Math.exp(-dt * rate));
    this.center.lerp(this.goalCenter, 1 - Math.exp(-dt * 1.1));
    const pose: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: FOV };
    this.basePose(pose);

    if (this.shot) {
      const s = this.shot;
      s.t += dt;
      let t = s.t;
      let prev: Pose = s.start;
      let done = true;
      const tmp: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: FOV };
      for (const p of s.poses) {
        if (t < p.move) {
          this.posed(p, 0, tmp);
          const k = easeInOut(t / p.move);
          blend(prev, tmp, k, pose);
          done = false;
          break;
        }
        t -= p.move;
        if (t < p.hold) {
          this.posed(p, t, pose);
          done = false;
          break;
        }
        t -= p.hold;
        const end: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: FOV };
        this.posed(p, p.hold, end);
        prev = end;
      }
      if (done) {
        if (t < s.out) blend(prev, pose, easeInOut(t / s.out), pose);
        else this.shot = null;
      }
    }

    // 冲击推近：弹簧
    this.punchVel += (-this.punch * 60 - this.punchVel * 10) * dt;
    this.punch += this.punchVel * dt;
    const toward = pose.target.clone().sub(pose.pos).normalize();
    pose.pos.addScaledVector(toward, this.punch);

    // 震屏：平滑噪声，幅度按 trauma² 衰减
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeTime += dt;
    const amp = this.trauma * this.trauma;
    if (amp > 0) {
      const t = this.shakeTime * 26;
      pose.pos.x += (Math.sin(t * 1.3) + Math.sin(t * 2.9 + 1.7) * 0.5) * 0.14 * amp;
      pose.pos.y += (Math.sin(t * 1.7 + 0.5) + Math.sin(t * 3.3) * 0.5) * 0.1 * amp;
      pose.target.x += Math.sin(t * 2.1 + 2) * 0.05 * amp;
    }
    if (Math.abs(this.camera.fov - pose.fov) > 1e-3) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(pose.pos);
    this.camera.lookAt(pose.target);
  }
}

function blend(a: Pose, b: Pose, k: number, out: Pose): void {
  const pos = a.pos.clone().lerp(b.pos, k);
  const target = a.target.clone().lerp(b.target, k);
  out.pos.copy(pos);
  out.target.copy(target);
  out.fov = a.fov + (b.fov - a.fov) * k;
}

function easeInOut(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
