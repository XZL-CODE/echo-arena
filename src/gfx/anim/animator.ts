// 程序动画：按状态（待机、奔跑、攻击、施法、大招、受击、眩晕、倒下、胜利、出场）算出每根骨头相对绑定姿势的偏移，
// 状态切换时交叉淡入；尾巴、头发、披风、衣摆、耳朵用阻尼弹簧做跟随摆动。
import * as THREE from 'three';
import type { Expression } from '../kit/face.js';
import type { ModelInstance, RestPose } from '../kit/rig.js';

export type RigKind = 'biped' | 'quad' | 'bird';
export type AnimState =
  | 'idle'
  | 'run'
  | 'attack'
  | 'cast'
  | 'ult'
  | 'hit'
  | 'stun'
  | 'dead'
  | 'victory'
  | 'spawn'
  | 'guard';
/** 攻击动作的样式。 */
export type AttackStyle =
  'slash' | 'thrust' | 'bow' | 'cast' | 'smash' | 'punch' | 'bite' | 'pounce' | 'spit' | 'peck';

export interface AnimInput {
  state: AnimState;
  /** 进入当前状态后的时间（秒）。 */
  t: number;
  /** 计时状态的总时长（攻击、施法、大招、受击）。 */
  dur: number;
  /** 移动速度（米/秒），用于步频。 */
  speed: number;
  /** 全局时间（秒）。 */
  time: number;
}

interface BoneOffset {
  rx: number;
  ry: number;
  rz: number;
  px: number;
  py: number;
  pz: number;
  s: number;
}

type Pose = Map<string, BoneOffset>;

function zero(): BoneOffset {
  return { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1 };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 带回弹的缓出（出手时的冲劲）。 */
const backOut = (x: number) => {
  const c = 1.9;
  const t = clamp01(x) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x: number) => Math.pow(clamp01(x), 2.2);

/** 弹簧：一根骨头的额外转角，被身体的加速度带动。 */
interface Spring {
  bone: string;
  /** 在链上的位置（越靠后摆得越大）。 */
  weight: number;
  ax: number;
  az: number;
  vx: number;
  vz: number;
  stiff: number;
  damp: number;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export interface AnimProfile {
  rig: RigKind;
  attack: AttackStyle;
  /** 武器在哪只手（双手武器也算右手）。 */
  armed?: boolean;
  /** 体型带来的动作幅度（大个子动作更慢更沉）。 */
  heft?: number;
}

export class Animator {
  readonly model: ModelInstance;
  readonly profile: AnimProfile;
  private current: Pose = new Map();
  private previous: Pose = new Map();
  private blend = 1;
  private lastState: AnimState | null = null;
  private springs: Spring[] = [];
  private lastRoot = new THREE.Vector3();
  private lastVel = new THREE.Vector3();
  private initialized = false;
  private phase: number;
  /** 当前帧的表情（由动作决定，渲染层也可以覆盖）。 */
  expression: Expression = 'normal';

  constructor(model: ModelInstance, profile: AnimProfile, seed = 0) {
    this.model = model;
    this.profile = profile;
    this.phase = seed * 1.618;
    const chain = (prefix: string, stiff: number, damp: number) => {
      const names = model.bones.map((b) => b.name).filter((n) => n.startsWith(prefix));
      names.forEach((bone, i) =>
        this.springs.push({
          bone,
          weight: (i + 1) / names.length,
          ax: 0,
          az: 0,
          vx: 0,
          vz: 0,
          stiff,
          damp,
        }),
      );
    };
    chain('tail', 38, 6);
    chain('hair', 30, 5.5);
    chain('cape', 24, 4.5);
    chain('coat', 34, 6);
    chain('twin', 30, 5);
    for (const ear of ['earL', 'earR']) {
      if (model.bone(ear))
        this.springs.push({
          bone: ear,
          weight: 0.5,
          ax: 0,
          az: 0,
          vx: 0,
          vz: 0,
          stiff: 90,
          damp: 9,
        });
    }
  }

  /** 推进并写入骨骼。rootWorld 是模型在世界里的位置（用于跟随摆动）。 */
  update(input: AnimInput, dt: number, rootWorld?: THREE.Vector3, facing = 0): void {
    if (input.state !== this.lastState) {
      this.previous = this.current;
      this.blend = this.lastState === null ? 1 : 0;
      this.lastState = input.state;
    }
    this.blend = Math.min(1, this.blend + dt / (input.state === 'hit' ? 0.05 : 0.14));
    const next: Pose = new Map();
    const get = (name: string) => {
      let o = next.get(name);
      if (!o) {
        o = zero();
        next.set(name, o);
      }
      return o;
    };
    if (this.profile.rig === 'biped') this.biped(input, get);
    else if (this.profile.rig === 'quad') this.quad(input, get);
    else this.bird(input, get);
    this.current = next;
    this.secondary(dt, input, get, rootWorld, facing);
    this.apply();
  }

  private apply(): void {
    const m = this.model;
    const w = this.blend;
    m.bones.forEach((bone, i) => {
      const rest = m.rest[i] as RestPose;
      const a = this.current.get(bone.name);
      const b = this.previous.get(bone.name);
      const mixv = (k: keyof BoneOffset, def: number) => {
        const av = a ? a[k] : def;
        const bv = b ? b[k] : def;
        return bv + (av - bv) * w;
      };
      const rx = mixv('rx', 0);
      const ry = mixv('ry', 0);
      const rz = mixv('rz', 0);
      _e.set(rx, ry, rz, 'XYZ');
      _q.setFromEuler(_e);
      bone.quaternion.copy(rest.quat).multiply(_q);
      bone.position.set(
        rest.pos.x + mixv('px', 0),
        rest.pos.y + mixv('py', 0),
        rest.pos.z + mixv('pz', 0),
      );
      const sc = mixv('s', 1);
      bone.scale.set(sc, sc, sc);
    });
  }

  // ---------------------------------------------------------------- 人形

  private biped(input: AnimInput, get: (n: string) => BoneOffset): void {
    const { t, time } = input;
    const ph = time + this.phase;
    const heft = this.profile.heft ?? 1;
    const armed = this.profile.armed ?? true;
    const hips = get('hips');
    const spine = get('spine');
    const chest = get('chest');
    const head = get('head');
    const neck = get('neck');
    const aL = get('armL');
    const aR = get('armR');
    const fL = get('foreL');
    const fR = get('foreR');
    const hR = get('handR');
    const tL = get('thighL');
    const tR = get('thighR');
    const sL = get('shinL');
    const sR = get('shinR');
    const ftL = get('footL');
    const ftR = get('footR');
    this.expression = 'normal';

    // 基础站姿：双臂自然外展、肘部微屈，重心略偏一侧，持武器的手在身前
    const breath = Math.sin(ph * 2.1);
    chest.rx = 0.02 * breath - 0.02;
    spine.rx = 0.01 * breath;
    aL.rz = 0.2 + 0.02 * breath;
    aR.rz = -0.2 - 0.02 * breath;
    aL.rx = 0.04;
    fL.rx = -0.28;
    fR.rx = -0.28;
    if (armed) {
      aR.rx = -0.25;
      aR.rz = -0.26;
      fR.rx = -0.75;
      hR.rz = 0.15;
    }
    hips.px = 0.012 * Math.sin(ph * 0.9);
    hips.rz = 0.03 * Math.sin(ph * 0.9);
    tL.rz = 0.05;
    tR.rz = -0.07;
    tL.rx = -0.02;
    tR.rx = 0.05;
    sR.rx = 0.08;
    head.rx = -0.03 + 0.02 * Math.sin(ph * 0.7);
    head.ry = 0.12 * Math.sin(ph * 0.31);
    head.rz = 0.03 * Math.sin(ph * 0.45);

    switch (input.state) {
      case 'run': {
        const f = (Math.min(1.4, 0.8 + input.speed * 0.35) * 2.2) / heft;
        const p = (time + this.phase) * f * Math.PI * 2;
        const s = Math.sin(p);
        const c = Math.cos(p);
        spine.rx = 0.2;
        chest.rx = 0.05;
        chest.ry = -0.18 * s;
        hips.ry = 0.14 * s;
        hips.py = -0.03 + 0.035 * Math.abs(c);
        tL.rx = -0.75 * s;
        tR.rx = 0.75 * s;
        sL.rx = 0.25 + 0.9 * Math.max(0, -Math.sin(p - 0.6)) + 0.3 * Math.max(0, s);
        sR.rx = 0.25 + 0.9 * Math.max(0, Math.sin(p - 0.6)) + 0.3 * Math.max(0, -s);
        ftL.rx = -0.2 * s;
        ftR.rx = 0.2 * s;
        aL.rx = 0.65 * s;
        aL.rz = 0.22;
        fL.rx = -0.9;
        if (armed) {
          // 持刀奔跑：刀往身后拖
          aR.rx = 0.35 - 0.2 * s;
          aR.rz = -0.35;
          fR.rx = -0.35;
        } else {
          aR.rx = -0.65 * s;
          aR.rz = -0.22;
          fR.rx = -0.9;
        }
        head.rx = -0.12;
        head.ry = 0;
        this.expression = 'focus';
        break;
      }
      case 'attack':
        this.bipedAttack(input, get, armed);
        break;
      case 'cast': {
        const k = t / Math.max(0.2, input.dur);
        const rise = smooth(0, 0.35, k) * (1 - smooth(0.8, 1, k));
        aL.rx = -1.4 * rise;
        aL.rz = 0.2 + 0.7 * rise;
        aR.rx = -1.6 * rise;
        aR.rz = -0.2 - 0.6 * rise;
        fL.rx = -0.3;
        fR.rx = -0.3;
        chest.rx = -0.12 * rise;
        head.rx = -0.18 * rise;
        hips.py = 0.04 * rise;
        this.expression = 'focus';
        break;
      }
      case 'ult':
        this.bipedUlt(input, get, armed);
        break;
      case 'hit': {
        const k = 1 - easeOut(t / Math.max(0.1, input.dur));
        spine.rx -= 0.25 * k;
        chest.rx -= 0.2 * k;
        head.rx -= 0.3 * k;
        aL.rz += 0.4 * k;
        aR.rz -= 0.4 * k;
        hips.pz = -0.05 * k;
        this.expression = 'hurt';
        break;
      }
      case 'stun': {
        spine.rx = 0.15;
        head.rx = 0.25;
        head.rz = 0.25 * Math.sin(time * 5);
        chest.rz = 0.08 * Math.sin(time * 5 + 1);
        aL.rz = 0.1;
        aR.rz = -0.1;
        fL.rx = -0.1;
        fR.rx = -0.1;
        this.expression = 'ko';
        break;
      }
      case 'dead': {
        const k = easeIn(t / 0.55);
        const land = smooth(0.4, 0.6, t / 0.55);
        sL.rx = 1.2 * smooth(0, 0.5, k);
        sR.rx = 1.4 * smooth(0, 0.5, k);
        tL.rx = -0.9 * smooth(0, 0.5, k);
        tR.rx = -1.1 * smooth(0, 0.5, k);
        hips.py = -0.38 * k;
        spine.rx = 0.5 * k - 1.0 * land;
        chest.rx = 0.2 * k;
        head.rx = 0.4 * k;
        aL.rz = 0.2 + 0.9 * k;
        aR.rz = -0.2 - 0.9 * k;
        this.expression = 'ko';
        break;
      }
      case 'victory': {
        const k = easeOut(t / 0.4);
        const hop = Math.max(0, Math.sin(Math.min(t, 0.5) * Math.PI * 2)) * 0.08;
        hips.py = hop;
        if (armed) {
          aR.rx = -2.7 * k;
          aR.rz = -0.3;
          fR.rx = -0.2;
        } else {
          aR.rx = -2.5 * k;
          fR.rx = -0.4;
        }
        aL.rz = 0.6 * k;
        fL.rx = -1.6 * k;
        aL.rx = 0.3 * k;
        head.rx = -0.15 * k;
        head.ry = 0.2 * k;
        this.expression = 'happy';
        break;
      }
      case 'spawn': {
        const k = easeOut(t / 0.5);
        hips.py = 0.4 * (1 - k);
        sL.rx = 0.6 * (1 - smooth(0.5, 1, t / 0.5));
        sR.rx = 0.6 * (1 - smooth(0.5, 1, t / 0.5));
        break;
      }
      case 'guard': {
        aL.rx = -1.2;
        aL.rz = 0.1;
        fL.rx = -1.2;
        chest.rx = 0.1;
        tL.rx = -0.3;
        sL.rx = 0.35;
        tR.rx = 0.25;
        this.expression = 'focus';
        break;
      }
      default:
        break;
    }
    void neck;
  }

  private bipedAttack(input: AnimInput, get: (n: string) => BoneOffset, armed: boolean): void {
    const k = input.t / Math.max(0.15, input.dur);
    const style = this.profile.attack;
    const aL = get('armL');
    const aR = get('armR');
    const fL = get('foreL');
    const fR = get('foreR');
    const hR = get('handR');
    const chest = get('chest');
    const spine = get('spine');
    const hips = get('hips');
    const head = get('head');
    const tL = get('thighL');
    const tR = get('thighR');
    const sL = get('shinL');
    const wind = smooth(0, 0.38, k);
    const strike = backOut((k - 0.38) / 0.17);
    const recover = smooth(0.6, 1, k);
    const act = k < 0.38 ? 0 : strike * (1 - recover);
    this.expression = k < 0.6 ? 'shout' : 'focus';
    if (style === 'slash' && armed) {
      // 右上蓄势 → 斜劈到左下，身体扭转、前脚踏出
      aR.rx = -2.3 * wind * (1 - act) + -0.5 * act;
      aR.rz = -0.4 * wind * (1 - act) + 0.55 * act;
      fR.rx = -1.3 * wind * (1 - act) - 0.15 * act;
      hR.rz = 0.3 * wind - 0.5 * act;
      chest.ry = 0.55 * wind * (1 - act) - 0.6 * act;
      spine.ry = 0.2 * wind * (1 - act) - 0.25 * act;
      chest.rx = -0.1 * wind + 0.2 * act;
      hips.pz = 0.12 * act;
      tL.rx = -0.55 * act;
      sL.rx = 0.4 * act;
      tR.rx = 0.3 * act;
      aL.rz = 0.2 + 0.5 * act;
      aL.rx = 0.3 * act;
    } else if (style === 'thrust' && armed) {
      aR.rx = 0.4 * wind * (1 - act) - 1.5 * act;
      aR.rz = -0.3;
      fR.rx = -1.4 * wind * (1 - act) - 0.05 * act;
      chest.ry = 0.35 * wind - 0.35 * act;
      hips.pz = -0.05 * wind + 0.18 * act;
      tL.rx = -0.6 * act;
      sL.rx = 0.5 * act;
      tR.rx = 0.35 * act;
    } else if (style === 'smash' && armed) {
      aR.rx = -2.8 * wind * (1 - act) - 0.7 * act;
      aL.rx = -2.6 * wind * (1 - act) - 0.7 * act;
      aL.rz = 0.1;
      aR.rz = -0.1;
      fR.rx = -0.6 * wind;
      fL.rx = -0.6 * wind;
      chest.rx = -0.25 * wind * (1 - act) + 0.45 * act;
      spine.rx = 0.3 * act;
      hips.py = -0.08 * act;
      tL.rx = -0.5 * act;
      sL.rx = 0.6 * act;
      tR.rx = 0.4 * act;
      get('shinR').rx = 0.5 * act;
    } else if (style === 'bow') {
      // 左手举弓，右手拉弦到耳边，松手时右手甩开
      aL.rx = -1.5 * smooth(0, 0.25, k) * (1 - recover);
      aL.rz = 0.1;
      fL.rx = 0;
      chest.ry = 0.5 * smooth(0, 0.25, k) * (1 - recover);
      aR.rx = -1.45 * wind * (1 - recover);
      aR.rz = -0.2 - 0.25 * act;
      fR.rx = -2.2 * wind * (1 - act) - 0.3 * act;
      head.ry = 0.35 * smooth(0, 0.25, k) * (1 - recover);
    } else if (style === 'punch') {
      const side = Math.floor(input.time * 2 + this.phase) % 2 === 0;
      const a = side ? aR : aL;
      const f = side ? fR : fL;
      a.rx = 0.4 * wind * (1 - act) - 1.55 * act;
      f.rx = -1.8 * wind * (1 - act) - 0.05 * act;
      chest.ry = (side ? 1 : -1) * (0.3 * wind - 0.5 * act);
      hips.pz = 0.14 * act;
      tL.rx = -0.45 * act;
      sL.rx = 0.4 * act;
    } else {
      // 施法式攻击：双手前推
      aL.rx = -1.1 * wind * (1 - recover) - 0.35 * act;
      aR.rx = -1.2 * wind * (1 - recover) - 0.35 * act;
      aL.rz = 0.1;
      aR.rz = -0.1;
      fL.rx = -0.8 * wind * (1 - act);
      fR.rx = -0.8 * wind * (1 - act);
      chest.rx = -0.1 * wind + 0.12 * act;
      hips.pz = 0.06 * act;
    }
  }

  private bipedUlt(input: AnimInput, get: (n: string) => BoneOffset, armed: boolean): void {
    const k = input.t / Math.max(0.3, input.dur);
    const aL = get('armL');
    const aR = get('armR');
    const fL = get('foreL');
    const fR = get('foreR');
    const chest = get('chest');
    const spine = get('spine');
    const hips = get('hips');
    const head = get('head');
    const tL = get('thighL');
    const tR = get('thighR');
    const sL = get('shinL');
    const sR = get('shinR');
    // 蓄力下蹲 → 爆发：腾空、双臂展开或举刀过顶 → 落下出招
    const gather = smooth(0, 0.3, k) * (1 - smooth(0.3, 0.42, k));
    const burst = smooth(0.32, 0.45, k) * (1 - smooth(0.78, 1, k));
    const strike = smooth(0.62, 0.72, k) * (1 - smooth(0.85, 1, k));
    hips.py = -0.12 * gather + 0.28 * burst - 0.1 * strike;
    tL.rx = -0.6 * gather - 0.3 * burst;
    tR.rx = -0.4 * gather + 0.25 * burst;
    sL.rx = 1.0 * gather + 0.6 * burst;
    sR.rx = 0.9 * gather + 0.3 * burst;
    spine.rx = 0.3 * gather - 0.25 * burst + 0.35 * strike;
    chest.rx = 0.2 * gather - 0.2 * burst;
    head.rx = 0.2 * gather - 0.35 * burst + 0.1 * strike;
    if (armed) {
      aR.rx = -0.3 * gather - 2.9 * burst * (1 - strike) - 0.6 * strike;
      aR.rz = -0.2;
      fR.rx = -0.8 * gather - 0.1 * burst;
      aL.rx = -0.4 * gather;
      aL.rz = 0.2 + 1.2 * burst;
      fL.rx = -0.5;
    } else {
      aL.rx = -0.8 * gather - 0.4 * burst;
      aR.rx = -0.8 * gather - 0.4 * burst;
      aL.rz = 0.2 + 1.3 * burst;
      aR.rz = -0.2 - 1.3 * burst;
      fL.rx = -1.2 * gather;
      fR.rx = -1.2 * gather;
    }
    this.expression = burst > 0.2 ? 'shout' : 'focus';
  }

  // ---------------------------------------------------------------- 四足

  private quad(input: AnimInput, get: (n: string) => BoneOffset): void {
    const { t, time } = input;
    const ph = time + this.phase;
    const body = get('body');
    const chest = get('chest');
    const neck = get('neck');
    const head = get('head');
    const hipsB = get('hips');
    const legs = ['FL', 'FR', 'BL', 'BR'] as const;
    this.expression = 'normal';
    const breath = Math.sin(ph * 2.4);
    body.py = 0.004 * breath;
    body.s = 1 + 0.012 * breath;
    head.rx = 0.03 * Math.sin(ph * 0.8);
    head.rz = 0.06 * Math.sin(ph * 0.5);
    head.ry = 0.2 * Math.sin(ph * 0.33);
    neck.rx = -0.05;
    // 龙：长颈分三段、下颌、一对翅膀（别的四足没有这些骨头，写了也不生效）
    const neckBase = get('neckBase');
    const neckMid = get('neckMid');
    const jaw = get('jaw');
    const wingL = get('wingL');
    const wingR = get('wingR');
    /** lift 往上扬，sweep 往后收。 */
    const wings = (lift: number, sweep: number) => {
      wingL.rz = lift;
      wingR.rz = -lift;
      wingL.ry = sweep;
      wingR.ry = -sweep;
    };
    neckBase.ry = 0.06 * Math.sin(ph * 0.4);
    neckMid.ry = 0.05 * Math.sin(ph * 0.4 - 0.6);
    jaw.rx = 0.04 + 0.03 * Math.sin(ph * 1.1);
    wings(0.08 + 0.05 * Math.sin(ph * 1.2), 0.3);

    switch (input.state) {
      case 'run': {
        const f = (1.9 + input.speed * 0.5) / (this.profile.heft ?? 1);
        const p = (time + this.phase) * f * Math.PI * 2;
        body.py = 0.025 * Math.abs(Math.sin(p));
        body.rx = 0.08 * Math.sin(p * 2);
        head.rx = -0.12 * Math.sin(p * 2);
        head.ry = 0;
        const phase: Record<(typeof legs)[number], number> = {
          FL: 0,
          BR: 0.15,
          FR: Math.PI,
          BL: Math.PI + 0.15,
        };
        for (const n of legs) {
          const s = Math.sin(p + phase[n]);
          const leg = get(`leg${n}`);
          leg.rx = (n.startsWith('F') ? -0.7 : -0.6) * s;
          const lower = get(`shin${n}`);
          lower.rx = (n.startsWith('F') ? 0.6 : -0.6) * Math.max(0, Math.cos(p + phase[n]));
          const paw = get(`paw${n}`);
          paw.rx = 0.4 * Math.max(0, -s);
        }
        wings(0.25 + 0.45 * Math.sin(p * 0.5), 0.15);
        jaw.rx = 0.12;
        this.expression = 'focus';
        break;
      }
      case 'attack': {
        const k = t / Math.max(0.15, input.dur);
        const crouch = smooth(0, 0.4, k) * (1 - smooth(0.4, 0.5, k));
        const lunge = backOut((k - 0.4) / 0.16) * (1 - smooth(0.62, 1, k));
        const lk = k < 0.4 ? 0 : lunge;
        body.py = -0.05 * crouch + 0.02 * lk;
        body.pz = -0.04 * crouch + 0.16 * lk;
        body.rx = 0.12 * crouch - 0.12 * lk;
        for (const n of ['BL', 'BR'] as const) {
          get(`leg${n}`).rx = 0.35 * crouch - 0.5 * lk;
          get(`shin${n}`).rx = -0.4 * crouch;
        }
        for (const n of ['FL', 'FR'] as const) {
          get(`leg${n}`).rx = 0.2 * crouch - 0.9 * lk;
        }
        head.rx = -0.25 * crouch + 0.35 * lk;
        neck.rx = -0.2 * crouch + 0.2 * lk;
        neckBase.rx = -0.15 * crouch + 0.1 * lk;
        neckMid.rx = -0.1 * crouch + 0.15 * lk;
        jaw.rx = 0.05 + 0.6 * crouch + 0.3 * lk;
        wings(0.1 + 0.55 * crouch - 0.2 * lk, 0.3 - 0.3 * crouch);
        this.expression = 'shout';
        break;
      }
      case 'cast':
      case 'ult': {
        // 后腿站稳、前身抬起、仰头长啸
        const k = t / Math.max(0.2, input.dur);
        const up = smooth(0, 0.3, k) * (1 - smooth(0.75, 1, k));
        body.rx = -0.35 * up;
        body.py = 0.06 * up;
        neck.rx = -0.4 * up;
        head.rx = -0.35 * up;
        for (const n of ['FL', 'FR'] as const) get(`leg${n}`).rx = -0.7 * up;
        for (const n of ['BL', 'BR'] as const) get(`leg${n}`).rx = 0.3 * up;
        if (this.model.bone('neckBase')) {
          // 长颈的龙：身子立起来时脖子往前压，头朝前上方咆哮，而不是整根脖子竖直
          neck.rx = -0.05 * up;
          neckBase.rx = 0.3 * up;
          neckMid.rx = 0.05 * up;
          head.rx = -0.05 * up;
        }
        jaw.rx = 0.05 + 0.75 * up;
        wings(0.1 + 0.7 * up + 0.2 * Math.sin(t * 12) * up, 0.3 - 0.45 * up);
        this.expression = up > 0.3 ? 'shout' : 'focus';
        break;
      }
      case 'hit': {
        const k = 1 - easeOut(t / Math.max(0.1, input.dur));
        body.pz = -0.06 * k;
        body.rx = 0.15 * k;
        head.rx = -0.3 * k;
        body.s = 1 - 0.06 * k;
        jaw.rx = 0.3 * k;
        wings(0.08 - 0.25 * k, 0.3 + 0.2 * k);
        this.expression = 'hurt';
        break;
      }
      case 'stun': {
        head.rz = 0.3 * Math.sin(time * 5);
        body.rz = 0.08 * Math.sin(time * 5 + 1);
        head.rx = 0.2;
        jaw.rx = 0.2;
        this.expression = 'ko';
        break;
      }
      case 'dead': {
        const k = easeIn(t / 0.5);
        get('root').rz = 1.45 * k;
        get('root').py = 0.02 * k;
        for (const n of legs) get(`leg${n}`).rx = 0.3 * k;
        head.rx = 0.3 * k;
        jaw.rx = 0.4 * k;
        wings(0.08 - 0.6 * k, 0.3 + 0.3 * k);
        this.expression = 'ko';
        break;
      }
      case 'victory': {
        const hop = Math.max(0, Math.sin(t * Math.PI * 3)) * 0.07 * (1 - smooth(0.6, 1.2, t));
        body.py = hop;
        head.rx = -0.25;
        jaw.rx = 0.5 * (1 - smooth(0.8, 1.4, t));
        wings(0.65, 0.05);
        this.expression = 'happy';
        break;
      }
      case 'spawn': {
        const k = easeOut(t / 0.45);
        body.py = 0.3 * (1 - k);
        wings(0.08 + 0.5 * (1 - k), 0.3);
        break;
      }
      default:
        break;
    }
    void chest;
    void hipsB;
  }

  // ---------------------------------------------------------------- 鸟

  private bird(input: AnimInput, get: (n: string) => BoneOffset): void {
    const { t, time } = input;
    const ph = time + this.phase;
    const body = get('body');
    const head = get('head');
    const wL = get('wingL');
    const wR = get('wingR');
    this.expression = 'normal';
    body.py = 0.01 * Math.sin(ph * 2.5);
    head.rx = 0.05 * Math.sin(ph * 1.3);
    head.ry = 0.25 * Math.sin(ph * 0.4);
    wL.rz = 0.1 + 0.08 * Math.sin(ph * 3);
    wR.rz = -0.1 - 0.08 * Math.sin(ph * 3);
    switch (input.state) {
      case 'run': {
        const p = time * 9;
        body.py = 0.05 + 0.03 * Math.sin(p);
        wL.rz = 0.3 + 0.9 * Math.sin(p);
        wR.rz = -0.3 - 0.9 * Math.sin(p);
        body.rx = 0.2;
        this.expression = 'focus';
        break;
      }
      case 'attack':
      case 'cast':
      case 'ult': {
        const k = t / Math.max(0.15, input.dur);
        const open = smooth(0, 0.35, k) * (1 - smooth(0.7, 1, k));
        const flap = backOut((k - 0.4) / 0.2) * (1 - smooth(0.6, 1, k));
        wL.rz = 0.1 + 1.3 * open - 0.6 * flap;
        wR.rz = -0.1 - 1.3 * open + 0.6 * flap;
        wL.rx = -0.4 * flap;
        wR.rx = -0.4 * flap;
        body.rx = -0.25 * open + 0.2 * flap;
        head.rx = -0.3 * open + 0.4 * flap;
        body.py = 0.05 * open;
        this.expression = 'shout';
        break;
      }
      case 'hit': {
        const k = 1 - easeOut(t / Math.max(0.1, input.dur));
        body.rx = -0.3 * k;
        body.s = 1 - 0.08 * k;
        this.expression = 'hurt';
        break;
      }
      case 'stun':
        head.rz = 0.3 * Math.sin(time * 5);
        this.expression = 'ko';
        break;
      case 'dead': {
        const k = easeIn(t / 0.5);
        get('root').rz = 1.5 * k;
        wL.rz = 0.8 * k;
        this.expression = 'ko';
        break;
      }
      case 'victory': {
        body.py = Math.max(0, Math.sin(t * Math.PI * 3)) * 0.06;
        wL.rz = 1.2;
        wR.rz = -1.2;
        this.expression = 'happy';
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- 跟随摆动

  private secondary(
    dt: number,
    input: AnimInput,
    get: (n: string) => BoneOffset,
    rootWorld: THREE.Vector3 | undefined,
    facing: number,
  ): void {
    if (this.springs.length === 0 || dt <= 0) return;
    // 身体在自身坐标里的加速度（往前跑时尾巴、披风向后飘）
    let ax = 0;
    let az = 0;
    if (rootWorld) {
      if (!this.initialized) {
        this.lastRoot.copy(rootWorld);
        this.initialized = true;
      }
      const vel = rootWorld.clone().sub(this.lastRoot).divideScalar(dt);
      const acc = vel.clone().sub(this.lastVel).divideScalar(dt);
      this.lastRoot.copy(rootWorld);
      this.lastVel.copy(vel);
      const c = Math.cos(facing);
      const s = Math.sin(facing);
      // 世界 → 模型坐标（模型朝 +Z）
      const fwdV = vel.x * s + vel.z * c;
      const sideV = vel.x * c - vel.z * s;
      ax = Math.max(-6, Math.min(6, fwdV * 1.2 + (acc.x * s + acc.z * c) * 0.04));
      az = Math.max(-4, Math.min(4, sideV * 0.8));
    }
    const running = input.state === 'run' ? 1 : 0;
    const time = input.time + this.phase;
    for (const sp of this.springs) {
      // 目标角：速度越快越往后扬；加一点“风”的起伏
      const wind =
        0.05 * Math.sin(time * 1.7 + sp.weight * 2.3) + 0.03 * Math.sin(time * 3.1 + sp.weight * 5);
      const targetX =
        ax * 0.09 * sp.weight +
        wind +
        running * 0.08 * Math.sin(time * 9 + sp.weight * 3) * sp.weight;
      const targetZ = az * 0.08 * sp.weight + wind * 0.6;
      const fx = (targetX - sp.ax) * sp.stiff - sp.vx * sp.damp;
      const fz = (targetZ - sp.az) * sp.stiff - sp.vz * sp.damp;
      const h = Math.min(dt, 1 / 30);
      sp.vx += fx * h;
      sp.vz += fz * h;
      sp.ax += sp.vx * h;
      sp.az += sp.vz * h;
      const o = get(sp.bone);
      // 尾巴往上翘（-X 是向后上方），头发、披风往后飘（+X 向后）
      if (sp.bone.startsWith('tail')) {
        o.rx -= sp.ax * 0.8;
        o.rz += sp.az + 0.12 * Math.sin(time * 2 + sp.weight * 2) * sp.weight;
      } else if (sp.bone.startsWith('ear')) {
        o.rx += sp.ax * 0.3;
      } else {
        o.rx += sp.ax;
        o.rz += sp.az * 0.5;
      }
    }
  }
}
