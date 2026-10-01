// 3D 战场的总调度：场景、镜头、单位、飞行物、特效导演、2D 叠加层与大招特写；
// 把模拟状态画出来，并提供点选（集火）与地面拾取（战前摆站位）。
import * as THREE from 'three';
import { Engine, type QualityLevel } from '../engine.js';
import { FxDirector, type FxEvent, type Stagehand } from '../fx/director.js';
import { Effects } from '../fx/effects.js';
import { Particles } from '../fx/particles.js';
import { Shots } from '../fx/shots.js';
import type { Lod } from '../models/index.js';
import { outlineShared } from '../toon.js';
import { CameraRig, type FrameBox } from './camera.js';
import { CutIn } from './cutin.js';
import { Hud, type HudUnit } from './hud.js';
import { Stage, type StageTheme } from './stage.js';
import { setFieldSize, toSim, toWorld, type ViewUnit, type ViewWorld } from './types.js';
import { UnitView } from './unitview.js';

export interface BattleViewSettings {
  shake: boolean;
  /** 减少闪烁：不闪白、光效减弱、闪电不抖。 */
  gentle: boolean;
  numbers: boolean;
  /** 大招特写（横幅 + 镜头推近 + 慢动作）。 */
  cinematics: boolean;
}

/** 大招特写横幅上显示的文字。 */
export type UltNamer = (unit: ViewUnit) => { skill: string; name: string };

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class BattleView implements Stagehand {
  readonly engine: Engine;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly particles = new Particles();
  readonly effects = new Effects();
  readonly shots = new Shots();
  readonly hud = new Hud();
  readonly cutin = new CutIn();
  readonly director: FxDirector;
  readonly overlay: HTMLElement;
  private stage: Stage | null = null;
  private views = new Map<number, UnitView>();
  private world: ViewWorld | null = null;
  private byId = new Map<number, ViewUnit>();
  lod: Lod = 'lo';
  settings: BattleViewSettings = { shake: true, gentle: false, numbers: true, cinematics: true };
  namer: UltNamer = (u) => ({ skill: '奥义', name: `${u.species}` });
  hoverId = 0;
  private lastSkillCam = -99;
  private lastUltCam = -99;
  /** 当前特写拍的是谁。 */
  private shotUnit = 0;
  /** 特写时挡在镜头前、先藏起来的单位（镜头拉回后再出现）。 */
  private readonly hidden = new Set<number>();
  /**
   * 镜头自动推近交战区域并缓慢漂移。战前摆站位时关掉：看全场、镜头不动，
   * 拖动宠物落到的位置只取决于指针。
   */
  get autoFrame(): boolean {
    return this.autoFrameOn;
  }

  set autoFrame(on: boolean) {
    this.autoFrameOn = on;
    this.rig.drift = on;
  }

  private autoFrameOn = true;
  private frameClock = 0;
  private time = 0;
  private slow = { scale: 1, left: 0 };
  private stop = 0;
  private screen = {
    flash: 0,
    flashColor: new THREE.Color(1, 1, 1),
    aberration: 0,
    radial: 0,
    center: new THREE.Vector2(0.5, 0.5),
    dim: 0,
    dimLevel: 0,
  };
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, quality?: QualityLevel) {
    this.engine = new Engine(canvas, quality === undefined ? {} : { pinned: quality });
    this.overlay = overlay;
    overlay.appendChild(this.hud.canvas);
    overlay.appendChild(this.cutin.root);
    this.scene.add(this.particles.group, this.effects.group, this.shots.group);
    this.director = new FxDirector(this);
    this.setStage('meadow');
    this.rig.occlusion = (eye, target) => this.occlusion(eye, target);
  }

  get gentle(): boolean {
    return this.settings.gentle;
  }

  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera;
  }

  setStage(theme: StageTheme, rebuild = false): void {
    if (this.stage?.theme === theme && !rebuild) return;
    if (this.stage) {
      this.scene.remove(this.stage.group);
      this.stage.dispose();
    }
    this.stage = new Stage(theme, this.engine.quality);
    this.stage.gentle = this.settings.gentle;
    this.stage.applyTo(this.scene);
  }

  applySettings(s: Partial<BattleViewSettings>): void {
    this.settings = { ...this.settings, ...s };
    this.rig.shakeEnabled = this.settings.shake;
    this.effects.gentle = this.settings.gentle;
    this.cutin.gentle = this.settings.gentle;
    if (this.stage) this.stage.gentle = this.settings.gentle;
    this.cutin.enabled = this.settings.cinematics;
    this.hud.showNumbers = this.settings.numbers;
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.engine.resize(w, h);
    this.rig.fit(w / Math.max(1, h));
    this.hud.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
  }

  /** 清空场上单位与特效（换一场战斗、回到战前）。 */
  reset(): void {
    for (const v of this.views.values()) {
      this.scene.remove(v.object);
      v.dispose();
    }
    this.views.clear();
    this.hidden.clear();
    this.byId.clear();
    this.particles.clear();
    this.effects.clear();
    this.shots.clear();
    this.hud.clear();
    this.cutin.hide();
    this.slow = { scale: 1, left: 0 };
    this.stop = 0;
    this.world = null;
    this.lastSkillCam = -99;
    this.lastUltCam = -99;
    this.rig.frame(null);
    this.rig.snap();
  }

  /** 战前预热特效与粒子的着色器（开打后第一次放招不卡）。 */
  warmup(): void {
    const at = new THREE.Vector3(0, 0, 0);
    this.effects.warmup(at);
    for (const additive of [true, false]) {
      this.particles.burst({
        count: 1,
        at: at.clone().setY(-0.5),
        speed: [0, 0],
        life: [0.2, 0.2],
        size: [0.001, 0.001],
        color: 0xffffff,
        cell: 'glow',
        additive,
      });
    }
  }

  /** 模拟时间应当放慢的倍数（慢动作、命中停顿、大招特写）。 */
  get timeScale(): number {
    if (this.stop > 0) return 0.08;
    return this.slow.left > 0 ? this.slow.scale : 1;
  }

  // ---------------------------------------------------------------- Stagehand

  unit(id: number) {
    const u = this.byId.get(id);
    const v = this.views.get(id);
    if (!u || !v) return null;
    return { u, pos: v.world.clone().setY(v.lift), height: v.height, facing: u.facing };
  }

  shake(amount: number): void {
    this.rig.shake(amount);
  }

  kick(amount: number): void {
    this.rig.kick(amount);
  }

  flash(color: THREE.ColorRepresentation, amount: number): void {
    if (this.settings.gentle) return;
    this.screen.flashColor.set(color);
    this.screen.flash = Math.max(this.screen.flash, amount);
  }

  aberration(amount: number): void {
    if (this.settings.gentle) return;
    this.screen.aberration = Math.max(this.screen.aberration, amount);
  }

  radial(at: THREE.Vector3, amount: number): void {
    const p = at.clone().project(this.rig.camera);
    this.screen.center.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.screen.radial = Math.max(this.screen.radial, amount);
  }

  slowmo(scale: number, seconds: number): void {
    this.slow = {
      scale: Math.min(this.slow.left > 0 ? this.slow.scale : 1, scale),
      left: Math.max(this.slow.left, seconds),
    };
  }

  hitstop(seconds: number): void {
    this.stop = Math.max(this.stop, seconds);
  }

  number(
    at: THREE.Vector3,
    text: string,
    kind: 'damage' | 'heal' | 'crit' | 'echo' | 'counter' | 'shield',
    team: number,
  ): void {
    this.hud.number(at, text, kind, team);
  }

  ult(unitId: number, target?: THREE.Vector3): void {
    const u = this.byId.get(unitId);
    const v = this.views.get(unitId);
    if (!u || !v) return;
    // 完整的大招特写有间隔：人形态一多，大招一个接一个，每个都停下来拍会把战斗拖得很慢。
    // 我方的大招间隔短一些，对手的长一些；没轮上的只给一点慢动作和径向模糊。
    const gap = this.time - this.lastUltCam;
    const full = this.settings.cinematics && !this.rig.inUltShot && gap > (u.team === 0 ? 6 : 11);
    if (full) {
      const names = this.namer(u);
      this.cutin.show(v.formId, u.element, names.skill, names.name, u.team);
      this.shotUnit = unitId;
      this.rig.ultShot(v.world.clone(), v.height, u.facing, target ?? null);
      // 仰拍蓄力这一段几乎停住，切到侧面出手时恢复一些速度
      this.slowmo(0.1, 1.1);
      this.screen.dim = 1;
      this.lastUltCam = this.time;
      this.lastSkillCam = this.time + 1.5;
    } else {
      this.slowmo(0.55, 0.3);
    }
    this.radial(v.center(), 0.035);
  }

  hitFlash(unitId: number, strong: boolean): void {
    this.views.get(unitId)?.hit(strong);
  }

  skillCam(unitId: number, big: boolean): void {
    if (!this.settings.cinematics || this.rig.inShot) return;
    if (this.time - this.lastSkillCam < (big ? 2.6 : 3.6)) return;
    const u = this.byId.get(unitId);
    const v = this.views.get(unitId);
    if (!u || !v || !u.alive) return;
    // 自己一方、进化后的技能优先给镜头
    if (u.team !== 0 && !big && Math.random() < 0.5) return;
    this.lastSkillCam = this.time;
    this.shotUnit = unitId;
    this.rig.skillShot(v.world.clone(), v.height, u.facing);
    this.slowmo(0.5, 0.35);
  }

  // ---------------------------------------------------------------- 每帧

  /** 按模拟状态同步单位与飞行物。alpha 是步间插值，now 是战斗时间。 */
  sync(world: ViewWorld, alpha: number, dt: number): void {
    // 场地尺寸变了：地形和取景都按新尺寸重来
    if (world.width && world.height && setFieldSize(world.width, world.height)) {
      if (this.stage) this.setStage(this.stage.theme, true);
      this.rig.fit(this.width / Math.max(1, this.height));
      this.rig.frame(null);
      this.rig.snap();
    }
    this.world = world;
    this.time += dt;
    this.byId.clear();
    for (const u of world.units) this.byId.set(u.id, u);
    for (const u of world.units) {
      let v = this.views.get(u.id);
      if (!v) {
        v = new UnitView(u, this.lod);
        this.views.set(u.id, v);
        this.scene.add(v.object);
      }
      v.update(u, alpha, world.t, dt, this.time);
    }
    for (const [id, v] of this.views) {
      if (!this.byId.has(id) || v.gone) {
        this.scene.remove(v.object);
        v.dispose();
        this.views.delete(id);
        this.hidden.delete(id);
      }
    }
    this.shots.sync(world.projectiles, alpha, dt, this.particles);
    this.director.tick(world, dt);
    // 镜头取景：每隔一小会儿按还活着的单位重新算一次交战区域
    this.frameClock -= dt;
    if (this.frameClock <= 0) {
      this.frameClock = 0.25;
      this.rig.frame(this.autoFrame ? this.actionBox() : null);
    }
  }

  /**
   * 交战区域：还活着的单位在地面上的包围盒。人多时去掉两头各一成的离群者（落在画外的由血条层标出方向），
   * 免得一两个远程站在边上就把镜头拉到最远。
   */
  private actionBox(): FrameBox | null {
    const xs: number[] = [];
    const zs: number[] = [];
    for (const v of this.views.values()) {
      const u = this.byId.get(v.id);
      if (!u || !u.alive) continue;
      xs.push(v.world.x);
      zs.push(v.world.z);
    }
    if (xs.length === 0) return null;
    xs.sort((a, b) => a - b);
    zs.sort((a, b) => a - b);
    const cut = xs.length >= 6 ? Math.floor(xs.length * 0.15) : 0;
    const lo = cut;
    const hi = xs.length - 1 - cut;
    return {
      minX: (xs[lo] as number) - 0.4,
      maxX: (xs[hi] as number) + 0.4,
      minZ: (zs[lo] as number) - 0.4,
      maxZ: (zs[hi] as number) + 0.4,
    };
  }

  /**
   * 一条视线被单位挡住的程度（特写挑机位用）：挡在镜头和主角之间的单位按离视线多近、
   * 离镜头多近计分；镜头贴着或钻进单位里最严重。主角自己不算。
   */
  private occlusion(eye: THREE.Vector3, target: THREE.Vector3): number {
    let score = 0;
    for (const v of this.views.values()) {
      if (v.id === this.shotUnit || v.gone) continue;
      score += this.blocking(v, eye, target);
    }
    return score;
  }

  private blocking(v: UnitView, eye: THREE.Vector3, target: THREE.Vector3): number {
    // 单位按一个球算：大个子（首领）的身体比模拟里的碰撞半径长得多，按高度放大
    const r = Math.max(0.4, v.height * (v.height > 2 ? 0.5 : 0.36));
    const c = v.center(_c);
    // 贴着镜头的单位（按模型实际伸展范围，烛龙的翅膀也算）会在画面里挡住一大块，近处又背光，看着像一团黑
    if (c.distanceTo(eye) < r + 0.7 || v.clearance(eye) < 1.4) return 6;
    _seg.copy(target).sub(eye);
    const t = _rel.copy(c).sub(eye).dot(_seg) / Math.max(1e-6, _seg.lengthSq());
    if (t <= 0.02 || t >= 0.92) return 0;
    const d = _rel.copy(eye).addScaledVector(_seg, t).distanceTo(c);
    return d < r ? (1 - d / r) * (1.6 - t) : 0;
  }

  /**
   * 大招特写里比主角离镜头近、又在画面里的单位。大招镜头压得低、推得近，旁边的宠物
   * 在画面边上是一大团背光的暗影；这一段只留主角和后面的战场。技能特写不这样做，
   * 免得单位隔几秒就消失又出现。
   */
  private foreground(v: UnitView, eye: THREE.Vector3, aim: THREE.Vector3): boolean {
    _seg.copy(aim).sub(eye);
    const far = _seg.length();
    _seg.divideScalar(Math.max(1e-6, far));
    const depth = _rel.copy(v.center(_c)).sub(eye).dot(_seg);
    if (depth <= 0 || depth > far - 0.4) return false;
    // 偏离视线的角度不超过半个视角（按宽的那一边）加上它自己的张角，就在画面里
    const cam = this.rig.camera;
    const half = Math.atan(
      Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * Math.max(1, cam.aspect),
    );
    const off = Math.acos(Math.min(1, depth / Math.max(1e-6, _rel.length())));
    return off < half + Math.atan(v.height / depth);
  }

  /** 特写时把挡在镜头和主角之间、或者贴着镜头的单位藏起来；镜头拉回后全部恢复。 */
  private cullForShot(): void {
    const subject = this.rig.inShot ? this.views.get(this.shotUnit) : undefined;
    if (!subject) {
      if (this.hidden.size === 0) return;
      for (const id of this.hidden) {
        const v = this.views.get(id);
        if (v) v.object.visible = !v.gone;
      }
      this.hidden.clear();
      return;
    }
    const eye = this.rig.camera.position;
    const aim = subject.center(_aim);
    const ult = this.rig.inUltShot;
    for (const v of this.views.values()) {
      if (v === subject || v.gone) continue;
      const hide = this.blocking(v, eye, aim) > 0 || (ult && this.foreground(v, eye, aim));
      if (hide === this.hidden.has(v.id)) continue;
      v.object.visible = !hide;
      if (hide) this.hidden.add(v.id);
      else this.hidden.delete(v.id);
    }
  }

  handle(events: readonly FxEvent[]): void {
    this.director.handle(events);
  }

  /** 推进并渲染一帧。 */
  render(dt: number): void {
    this.tick(dt);
    this.draw(dt);
  }

  /** 只推进镜头、粒子、特效与屏幕效果，不提交 GPU 渲染（快进时用）。 */
  tick(dt: number): void {
    this.slow.left = Math.max(0, this.slow.left - dt);
    this.stop = Math.max(0, this.stop - dt);
    this.rig.update(dt);
    this.cullForShot();
    this.stage?.update(this.time);
    this.particles.quality = this.engine.preset.particles;
    this.particles.update(dt * (this.stop > 0 ? 0.2 : 1));
    this.effects.update(dt * (this.stop > 0 ? 0.2 : 1));
    this.cutin.update(dt);
    // 屏幕效果衰减
    const s = this.screen;
    s.flash = Math.max(0, s.flash - dt * 3);
    s.aberration = Math.max(0, s.aberration - dt * 0.03);
    s.radial = Math.max(0, s.radial - dt * 0.05);
    // 大招特写开头压暗一点、突出出手的宠物：约 0.15 秒渐暗再慢慢恢复（一下子变暗像黑屏闪了一下）
    s.dim = Math.max(0, s.dim - dt * 1.1);
    s.dimLevel += (s.dim - s.dimLevel) * (1 - Math.exp(-dt * (s.dim > s.dimLevel ? 16 : 8)));
    const g = this.engine.grade.uniforms;
    g.uFlash.value.set(s.flashColor.r, s.flashColor.g, s.flashColor.b, s.flash);
    g.uAberration.value = s.aberration;
    g.uRadial.value = s.radial;
    g.uCenter.value.copy(s.center);
    g.uTint.value.set(0.42, 0.4, 0.55, s.dimLevel * 0.3);
    // 特写时血条、数字退到后面（只是变淡，敌我和血量仍然看得见）；近景里发光物占的画面大，泛光收一些
    const fadeGoal = this.rig.inUltShot ? 0.6 : this.rig.inShot ? 0.35 : 0;
    this.hud.fade += (fadeGoal - this.hud.fade) * (1 - Math.exp(-dt * 10));
    const bloomGoal = this.rig.inShot ? 0.38 : 0.6;
    this.engine.bloomStrength += (bloomGoal - this.engine.bloomStrength) * (1 - Math.exp(-dt * 6));
  }

  /** 提交渲染（3D 画面 + 2D 叠加层）。 */
  draw(dt: number): void {
    this.engine.prepare();
    outlineShared.resolution.set(
      this.width * this.engine.pixelRatio,
      this.height * this.engine.pixelRatio,
    );
    outlineShared.width = 1.5 * this.engine.pixelRatio;
    this.engine.render(this.scene, this.rig.camera, dt);
    const list: HudUnit[] = [];
    for (const v of this.views.values()) {
      const u = this.byId.get(v.id);
      if (u && !this.hidden.has(v.id)) list.push({ u, top: v.top, radius: u.radius });
    }
    this.hud.draw(list, this.rig.camera, this.world?.focusId ?? 0, this.hoverId, this.time, dt);
  }

  // ---------------------------------------------------------------- 拾取

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.engine.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /** 点到的单位（按屏幕上离模型中心最近、在点击半径内的算）。 */
  pick(clientX: number, clientY: number, team?: 0 | 1): number {
    const rect = this.engine.canvas.getBoundingClientRect();
    let best = 0;
    let bestD = Infinity;
    for (const v of this.views.values()) {
      const u = this.byId.get(v.id);
      if (!u || !u.alive || (team !== undefined && u.team !== team)) continue;
      const c = v.center(_v).project(this.rig.camera);
      const sx = (c.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-c.y * 0.5 + 0.5) * rect.height + rect.top;
      const top = v.top.clone().project(this.rig.camera);
      const pxHeight = Math.abs((top.y - c.y) * 0.5 * rect.height) * 2;
      const r = Math.max(22, pxHeight * 0.55);
      const d = Math.hypot(clientX - sx, clientY - sy);
      if (d < r && d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best;
  }

  /** 屏幕点 → 模拟坐标（地面）。 */
  groundAt(clientX: number, clientY: number): { x: number; y: number } | null {
    _ray.setFromCamera(this.ndc(clientX, clientY), this.rig.camera);
    const hit = _ray.ray.intersectPlane(_plane, new THREE.Vector3());
    return hit ? toSim(hit) : null;
  }

  /** 模拟坐标（加高度，米）→ 屏幕坐标（相对画布，CSS 像素）。 */
  screenOf(x: number, y: number, height = 0): { x: number; y: number } {
    const p = toWorld(x, y, new THREE.Vector3()).setY(height).project(this.rig.camera);
    return { x: (p.x * 0.5 + 0.5) * this.width, y: (-p.y * 0.5 + 0.5) * this.height };
  }

  /** 单位头顶的屏幕坐标（指引、提示用）。 */
  unitScreen(id: number): { x: number; y: number; top: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    const c = v.center(_v).project(this.rig.camera);
    const t = v.top.clone().project(this.rig.camera);
    return {
      x: (c.x * 0.5 + 0.5) * this.width,
      y: (-c.y * 0.5 + 0.5) * this.height,
      top: (-t.y * 0.5 + 0.5) * this.height,
    };
  }

  stats(): {
    units: number;
    particles: number;
    effects: number;
    quality: number;
    drawMs: number;
    fps: number;
    /** 累计画了多少帧。 */
    frames: number;
    /** 正在拍的特写：0 没有，1 技能特写，2 大招特写。 */
    shot: number;
    shotUnit: number;
  } {
    return {
      shot: this.rig.inUltShot ? 2 : this.rig.inShot ? 1 : 0,
      shotUnit: this.rig.inShot ? this.shotUnit : 0,
      units: this.views.size,
      particles: this.particles.alive,
      effects: this.effects.count,
      quality: this.engine.quality,
      drawMs: this.engine.drawMs,
      fps: 1000 / Math.max(1, this.engine.frameEma),
      frames: this.engine.frames,
    };
  }

  dispose(): void {
    this.reset();
    this.stage?.dispose();
    this.engine.dispose();
  }
}
