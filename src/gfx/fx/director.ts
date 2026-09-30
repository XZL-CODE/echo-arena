// 特效导演：把规则层的事件翻译成画面——命中火花、元素爆炸、闪电链、冲刺拖影、岩刺、藤蔓、护盾、
// 每个物种的技能与大招演出，并驱动震屏、闪光、慢动作。回响等级越高，效果逐级加码。
import * as THREE from 'three';
import {
  ELEMENT_COLOR,
  FIELD_PX,
  toWorld,
  type ElementId,
  type ViewUnit,
  type ViewWorld,
  type ViewZone,
} from '../battle/types.js';
import type { Effects } from './effects.js';
import type { Particles } from './particles.js';

/** 规则层事件（与 src/core/sim/events.ts 对应，只列画面用到的字段）。 */
export type FxEvent =
  | {
      type: 'attack';
      unitId: number;
      targetId: number;
      style: string;
      x: number;
      y: number;
      tx: number;
      ty: number;
    }
  | {
      type: 'hit';
      targetId: number;
      sourceId?: number;
      x: number;
      y: number;
      amount: number;
      echo: number;
      team: number;
      element?: string;
      counter?: number;
      killed: boolean;
      source?: string;
    }
  | { type: 'heal'; targetId: number; amount: number; x: number; y: number }
  | { type: 'shield'; targetId: number; amount: number }
  | {
      type: 'skill';
      unitId: number;
      skill: string;
      form?: number;
      x: number;
      y: number;
      tx: number;
      ty: number;
    }
  | { type: 'ult'; unitId: number; skill: string; x: number; y: number; tx: number; ty: number }
  | { type: 'dash'; unitId: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'blink'; unitId: number; fromX: number; fromY: number; toX: number; toY: number }
  | {
      type: 'chain';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      echo: number;
      element?: string;
    }
  | { type: 'reflect'; unitId: number; x: number; y: number; echo: number }
  | {
      type: 'explode';
      x: number;
      y: number;
      radius: number;
      element?: string;
      echo: number;
      team: number;
    }
  | { type: 'impact'; x: number; y: number; strength: number; echo: number }
  | { type: 'status'; unitId: number; status: string; duration: number }
  | {
      type: 'zone';
      zoneId: number;
      kind: string;
      x: number;
      y: number;
      r: number;
      angle?: number;
      length?: number;
    }
  | { type: 'echo'; x: number; y: number; level: number }
  | { type: 'death'; unitId: number; team: number; x: number; y: number }
  | { type: 'spawn'; unitId: number }
  | { type: 'transform'; unitId: number }
  | { type: 'end'; result: 'win' | 'lose' }
  | { type: string; [key: string]: unknown };

/** 导演需要的画面接口（由 BattleView 提供）。 */
export interface Stagehand {
  unit(id: number): { u: ViewUnit; pos: THREE.Vector3; height: number; facing: number } | null;
  particles: Particles;
  effects: Effects;
  shake(amount: number): void;
  kick(amount: number): void;
  flash(color: THREE.ColorRepresentation, amount: number): void;
  aberration(amount: number): void;
  radial(at: THREE.Vector3, amount: number): void;
  slowmo(scale: number, seconds: number): void;
  hitstop(seconds: number): void;
  number(
    at: THREE.Vector3,
    text: string,
    kind: 'damage' | 'heal' | 'crit' | 'echo' | 'counter' | 'shield',
    team: number,
  ): void;
  /** 大招特写（横幅、慢动作、两段镜头）；target 是出手方向上的目标点。 */
  ult(unitId: number, target?: THREE.Vector3): void;
  /** 技能特写（镜头推近一下，有节流）；big 表示进化后的大技能。 */
  skillCam(unitId: number, big: boolean): void;
  gentle: boolean;
}

/** 回响等级对应的颜色：白 → 金 → 橙 → 品红 → 紫 → 青。 */
const ECHO_COLORS = [
  0xffffff, 0xfff0a0, 0xffc84e, 0xff8a3a, 0xff4a8a, 0xc85aff, 0x7a8aff, 0x5ae8ff, 0xffffff,
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function el(e: string | undefined): ElementId {
  return (e && e in ELEMENT_COLOR ? e : 'fire') as ElementId;
}

export class FxDirector {
  private s: Stagehand;
  /** 同一处 0.08 秒内只闪一次（避免叠成一片白）。 */
  private flashes: Array<{ x: number; z: number; t: number }> = [];
  private clock = 0;
  private stunTimer = 0;

  constructor(stagehand: Stagehand) {
    this.s = stagehand;
  }

  private canFlash(p: THREE.Vector3): boolean {
    this.flashes = this.flashes.filter((f) => this.clock - f.t < 0.08);
    if (this.flashes.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < 0.6)) return false;
    this.flashes.push({ x: p.x, z: p.z, t: this.clock });
    return true;
  }

  handle(events: readonly FxEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'attack':
          this.attack(e as Extract<FxEvent, { type: 'attack' }>);
          break;
        case 'hit':
          this.hit(e as Extract<FxEvent, { type: 'hit' }>);
          break;
        case 'heal':
          this.heal(e as Extract<FxEvent, { type: 'heal' }>);
          break;
        case 'shield':
          this.shield(e as Extract<FxEvent, { type: 'shield' }>);
          break;
        case 'skill':
          this.skill(e as Extract<FxEvent, { type: 'skill' }>);
          break;
        case 'ult':
          this.ult(e as Extract<FxEvent, { type: 'ult' }>);
          break;
        case 'dash':
          this.dash(e as Extract<FxEvent, { type: 'dash' }>);
          break;
        case 'blink':
          this.blink(e as Extract<FxEvent, { type: 'blink' }>);
          break;
        case 'chain':
          this.chain(e as Extract<FxEvent, { type: 'chain' }>);
          break;
        case 'reflect':
          this.reflect(e as Extract<FxEvent, { type: 'reflect' }>);
          break;
        case 'explode':
          this.explode(e as Extract<FxEvent, { type: 'explode' }>);
          break;
        case 'impact':
          this.impact(e as Extract<FxEvent, { type: 'impact' }>);
          break;
        case 'status':
          this.status(e as Extract<FxEvent, { type: 'status' }>);
          break;
        case 'zone':
          this.zone(e as Extract<FxEvent, { type: 'zone' }>);
          break;
        case 'echo':
          this.echo(e as Extract<FxEvent, { type: 'echo' }>);
          break;
        case 'death':
          this.death(e as Extract<FxEvent, { type: 'death' }>);
          break;
        case 'spawn':
          this.spawn(e as Extract<FxEvent, { type: 'spawn' }>);
          break;
        case 'transform':
          this.transform(e as Extract<FxEvent, { type: 'transform' }>);
          break;
        case 'end':
          this.end(e as Extract<FxEvent, { type: 'end' }>);
          break;
        default:
          break;
      }
    }
  }

  /** 每帧：持续状态（灼烧、眩晕、定身）与持续区域的粒子。 */
  tick(world: ViewWorld, dt: number): void {
    this.clock += dt;
    this.stunTimer += dt;
    const p = this.s.particles;
    for (const u of world.units) {
      if (!u.alive) continue;
      const info = this.s.unit(u.id);
      if (!info) continue;
      if (u.burn > 0 && Math.random() < dt * 14) {
        p.burst({
          count: 1,
          at: _a.copy(info.pos).setY(info.pos.y + info.height * (0.2 + Math.random() * 0.6)),
          shape: 'sphere',
          radius: 0.15,
          speed: [0.2, 0.5],
          life: [0.35, 0.6],
          size: [0.14, 0.22],
          grow: 0.2,
          color: 0xffd060,
          color2: 0xff3a10,
          intensity: 2.2,
          cell: 'flame',
          up: 0.8,
        });
      }
      if ((u.stun > 0 || u.airborne > 0) && this.stunTimer > 0.12) {
        const a = this.clock * 6 + u.id;
        p.burst({
          count: 1,
          at: _a
            .copy(info.pos)
            .add(new THREE.Vector3(Math.cos(a) * 0.25, info.height + 0.12, Math.sin(a) * 0.25)),
          speed: [0, 0.05],
          life: [0.3, 0.4],
          size: [0.1, 0.12],
          color: 0xfff080,
          intensity: 2,
          cell: 'star',
          spin: 3,
        });
      }
      if (u.root > 0 && Math.random() < dt * 8) {
        p.burst({
          count: 1,
          at: _a.copy(info.pos).setY(0.1),
          shape: 'ring',
          radius: 0.3,
          speed: [0.05, 0.2],
          life: [0.5, 0.8],
          size: [0.1, 0.14],
          color: 0x7aff6a,
          intensity: 1.4,
          cell: 'leaf',
          spin: 4,
          up: 0.3,
        });
      }
    }
    if (this.stunTimer > 0.12) this.stunTimer = 0;
    for (const z of world.zones) this.zoneTick(z, dt);
  }

  // ------------------------------------------------------------------ 基础命中

  private attack(e: Extract<FxEvent, { type: 'attack' }>): void {
    const a = this.s.unit(e.unitId);
    if (!a) return;
    const c = ELEMENT_COLOR[a.u.element];
    const species = a.u.species;
    const toward = Math.atan2(e.tx - e.x, e.ty - e.y);
    if (e.style === 'melee') {
      const r = Math.max(0.5, a.height * 0.45);
      const tilt =
        species === 'bear' || species === 'turtle'
          ? 0.9
          : species === 'wolf'
            ? -0.5
            : 0.4 * (Math.random() < 0.5 ? 1 : -1);
      this.s.effects.slash(a.pos, toward, r, c.light, 0.24, {
        y: a.height * 0.5,
        tilt,
        arc: 2.2,
        intensity: 2.2,
      });
      if (species === 'bear' || species === 'turtle') {
        this.s.effects.ring(toWorld(e.tx, e.ty, _b), 0.2, 0.9, 0xffe0b0, 0.35, { intensity: 1.2 });
        this.s.particles.burst({
          count: 6,
          at: _b.clone(),
          shape: 'disc',
          radius: 0.2,
          speed: [0.3, 0.8],
          radial: 0.8,
          life: [0.4, 0.7],
          size: [0.18, 0.3],
          grow: 1.6,
          color: 0xd8c8a8,
          alpha: 0.6,
          cell: 'smoke',
          additive: false,
        });
      }
    } else if (e.style === 'shoot' || e.style === 'cast' || e.style === 'lob') {
      const at = _a.copy(a.pos).setY(a.height * 0.6);
      at.x += Math.sin(toward) * 0.25;
      at.z += Math.cos(toward) * 0.25;
      this.s.particles.burst({
        count: 5,
        at,
        speed: [0.3, 1],
        life: [0.15, 0.3],
        size: [0.06, 0.1],
        color: c.light,
        intensity: 2.5,
        cell: 'spark',
        stretch: 0.05,
      });
      this.s.particles.burst({
        count: 1,
        at,
        speed: [0, 0],
        life: [0.12, 0.12],
        size: [0.35, 0.35],
        grow: 1.4,
        color: c.main,
        intensity: 1.6,
        cell: 'glow',
      });
    } else if (e.style === 'heal') {
      this.s.particles.burst({
        count: 6,
        at: _a.copy(a.pos).setY(a.height * 0.6),
        shape: 'sphere',
        radius: 0.2,
        speed: [0.2, 0.6],
        life: [0.4, 0.7],
        size: [0.08, 0.12],
        color: 0xbfffe0,
        intensity: 2,
        cell: 'plus',
        up: 0.6,
      });
    }
  }

  private hit(e: Extract<FxEvent, { type: 'hit' }>): void {
    const t = this.s.unit(e.targetId);
    const at = t ? _a.copy(t.pos).setY(t.height * 0.55) : toWorld(e.x, e.y, _a).setY(0.6);
    const elem = el(e.element);
    const c = ELEMENT_COLOR[elem];
    const echo = e.echo ?? 0;
    const counter = (e.counter ?? 0) > 0;
    const big = counter || echo >= 2 || e.killed;
    const n = big ? 12 : 6;
    const p = this.s.particles;
    switch (elem) {
      case 'fire':
        p.burst({
          count: n,
          at,
          shape: 'sphere',
          radius: 0.08,
          speed: [1, 2.6],
          life: [0.2, 0.45],
          size: [0.04, 0.07],
          color: 0xffe08a,
          color2: 0xff5010,
          intensity: 3,
          cell: 'ember',
          gravity: 3,
          stretch: 0.04,
        });
        p.burst({
          count: big ? 3 : 1,
          at,
          speed: [0.2, 0.5],
          life: [0.25, 0.4],
          size: [0.25, 0.4],
          grow: 1.4,
          color: 0xffb040,
          color2: 0xff3a10,
          intensity: 2,
          cell: 'flame',
          up: 0.5,
        });
        break;
      case 'water':
        p.burst({
          count: n,
          at,
          shape: 'sphere',
          radius: 0.1,
          speed: [1, 2.2],
          life: [0.3, 0.5],
          size: [0.05, 0.09],
          color: 0xbff4ff,
          intensity: 1.8,
          cell: 'drop',
          gravity: 6,
          stretch: 0.03,
          additive: false,
        });
        p.burst({
          count: 2,
          at,
          speed: [0.1, 0.3],
          life: [0.3, 0.5],
          size: [0.08, 0.14],
          color: 0xbff4ff,
          intensity: 1.2,
          cell: 'bubble',
          up: 0.4,
        });
        break;
      case 'wood':
        this.s.effects.chunks({
          kind: 'leaf',
          at,
          count: big ? 7 : 4,
          speed: [1, 2.4],
          up: 0.8,
          size: [0.07, 0.11],
          color: 0x6ad04a,
          color2: 0xb8f07a,
          life: [1, 1.6],
        });
        break;
      case 'rock':
        this.s.effects.chunks({
          kind: 'rock',
          at,
          count: big ? 6 : 3,
          speed: [1.5, 3.2],
          up: 1.2,
          size: [0.06, 0.12],
          color: 0xb8a088,
          color2: 0x8a7058,
          life: [0.9, 1.4],
        });
        p.burst({
          count: 2,
          at,
          speed: [0.2, 0.5],
          life: [0.4, 0.6],
          size: [0.25, 0.35],
          grow: 1.5,
          color: 0xe0d0b0,
          alpha: 0.5,
          cell: 'smoke',
          additive: false,
        });
        break;
      case 'thunder':
        p.burst({
          count: n,
          at,
          shape: 'sphere',
          radius: 0.08,
          speed: [1.5, 3.2],
          life: [0.1, 0.25],
          size: [0.03, 0.05],
          color: 0xfff6a0,
          intensity: 3.2,
          cell: 'spark',
          stretch: 0.06,
        });
        if (big) {
          this.s.effects.bolt(
            at.clone().add(new THREE.Vector3(0, 1.2, 0)),
            at.clone(),
            0xfff27a,
            0.15,
            0.02,
            0.4,
            1,
          );
          this.s.effects.orb(at.clone(), 0.28, 0xfff27a, 0.22);
        }
        break;
    }
    if (big && elem === 'fire')
      this.s.effects.chunks({
        kind: 'ember',
        at,
        count: 5,
        speed: [1.5, 3],
        up: 1,
        size: [0.03, 0.05],
        color: 0xffc860,
        color2: 0xff5a1a,
        life: [0.5, 0.9],
      });
    p.burst({
      count: 1,
      at,
      speed: [0, 0],
      life: [0.1, 0.1],
      size: [big ? 0.7 : 0.4, big ? 0.7 : 0.4],
      grow: 1.3,
      color: c.light,
      intensity: big ? 2.4 : 1.6,
      cell: 'spark',
    });
    if (counter) {
      this.s.effects.ring(at.clone().setY(at.y), 0.1, 0.8, c.main, 0.3, {
        vertical: new THREE.Vector3(0, 0, 1),
        intensity: 2,
      });
      this.s.number(at.clone().setY(at.y + 0.35), '克制', 'counter', e.team);
    }
    if (e.amount > 0.5) {
      const kind = echo >= 3 ? 'crit' : 'damage';
      this.s.number(
        at.clone().setY(t ? t.height + 0.3 : 1),
        String(Math.round(e.amount)),
        kind,
        e.team,
      );
    }
    if (big && this.canFlash(at)) this.s.effects.light(at, c.main, 6 + echo * 2, 3.5, 0.18);
    if (e.killed) {
      this.s.shake(0.12);
      this.s.hitstop(0.035);
    }
  }

  private heal(e: Extract<FxEvent, { type: 'heal' }>): void {
    const t = this.s.unit(e.targetId);
    const at = t ? _a.copy(t.pos).setY(t.height * 0.4) : toWorld(e.x, e.y, _a).setY(0.4);
    this.s.particles.burst({
      count: 8,
      at,
      shape: 'ring',
      radius: 0.3,
      speed: [0.3, 0.7],
      life: [0.6, 0.9],
      size: [0.08, 0.13],
      color: 0x9affc8,
      intensity: 2,
      cell: 'plus',
      up: 1.2,
    });
    this.s.particles.burst({
      count: 1,
      at: at.clone().setY(0.05),
      speed: [0, 0],
      life: [0.4, 0.4],
      size: [1.2, 1.2],
      grow: 1.2,
      color: 0x6affb0,
      intensity: 1,
      cell: 'ring',
    });
    if (e.amount > 0.5)
      this.s.number(at.clone().setY(t ? t.height + 0.3 : 1), `+${Math.round(e.amount)}`, 'heal', 0);
  }

  private shield(e: Extract<FxEvent, { type: 'shield' }>): void {
    const id = e.targetId;
    const t = this.s.unit(id);
    if (!t) return;
    this.s.effects.dome(
      () => {
        const info = this.s.unit(id);
        return info && info.u.alive && info.u.shield > 0.5
          ? info.pos.clone().setY(info.height * 0.5)
          : null;
      },
      Math.max(0.45, t.height * 0.62),
      0x7fe6ff,
      5,
    );
    this.s.particles.burst({
      count: 10,
      at: _a.copy(t.pos).setY(t.height * 0.5),
      shape: 'sphere',
      radius: t.height * 0.5,
      speed: [0.1, 0.3],
      life: [0.4, 0.7],
      size: [0.06, 0.1],
      color: 0xbff4ff,
      intensity: 1.8,
      cell: 'bubble',
      up: 0.4,
    });
  }

  // ------------------------------------------------------------------ 技能与大招

  private skill(e: Extract<FxEvent, { type: 'skill' }>): void {
    const a = this.s.unit(e.unitId);
    if (!a) return;
    const c = ELEMENT_COLOR[a.u.element];
    const target = toWorld(e.tx, e.ty, new THREE.Vector3());
    const feet = a.pos.clone().setY(0.02);
    const form = e.form ?? a.u.form;
    const p = this.s.particles;
    // 所有技能：脚下亮起法阵，身上一圈元素光
    this.s.effects.circle(feet, 0.7 + 0.1 * form, c.main, 0.8, form >= 3 ? 'hexa' : 'penta', 2);
    p.burst({
      count: 10,
      at: a.pos.clone().setY(0.1),
      shape: 'ring',
      radius: 0.5,
      speed: [0.2, 0.5],
      life: [0.4, 0.7],
      size: [0.06, 0.1],
      color: c.light,
      intensity: 2.4,
      cell: 'spark',
      up: 1.8,
    });
    const fx = this.s.effects;
    const toward = Math.atan2(target.x - a.pos.x, target.z - a.pos.z);
    const chest = a.pos.clone().setY(a.height * 0.6);
    switch (a.u.species) {
      case 'fox':
        // 狐火：脚下卷起火焰龙卷，进化后对目标连斩
        fx.vortex(feet.clone(), 0.55 + form * 0.12, a.height * 1.4, 0xff7a2a, 0.9, {
          turns: 1.4,
          spin: 7,
        });
        p.burst({
          count: 14,
          at: feet.clone(),
          shape: 'disc',
          radius: 0.3,
          speed: [0.3, 0.9],
          life: [0.35, 0.6],
          size: [0.18, 0.3],
          grow: 0.3,
          color: 0xffd060,
          color2: 0xff3a10,
          intensity: 2.4,
          cell: 'flame',
          up: 1.2,
        });
        if (form >= 2) {
          for (let i = 0; i < form; i++) {
            fx.slash(
              target.clone(),
              toward + (i - 1) * 0.6,
              0.75 + i * 0.1,
              i % 2 ? 0xffe27a : 0xff7a2a,
              0.3 + i * 0.06,
              { y: 0.7, tilt: (i - 1) * 0.7, arc: 2.6, intensity: 2.6, sweep: 0.8 },
            );
          }
        }
        break;
      case 'bird':
        fx.flash(a.pos.clone().setY(a.height * 0.8), 0.5, 0xffb040, 0.35, 2.4);
        fx.spiral(feet.clone(), 0.45, a.height * 1.2, 0xffa040, 0.8);
        break;
      case 'otter':
        fx.splash(target.clone(), 0.9 + form * 0.2, 0x8fe6ff, 0.7);
        fx.ring(target.clone(), 0.2, 1.4, 0x7fe6ff, 0.5, { intensity: 1.6 });
        p.burst({
          count: 12,
          at: target.clone().setY(0.4),
          shape: 'sphere',
          radius: 0.4,
          speed: [0.2, 0.6],
          life: [0.5, 0.9],
          size: [0.07, 0.13],
          color: 0xbff4ff,
          intensity: 1.6,
          cell: 'bubble',
          up: 0.8,
        });
        break;
      case 'turtle':
        fx.shock(feet.clone(), 0.4, 1.6 + form * 0.2, 0x5affd8, 0.55);
        fx.ring(feet.clone(), 0.3, 1.8, 0x5affd8, 0.45, { intensity: 1.8 });
        break;
      case 'bunny':
        fx.vortex(feet.clone(), 0.5, a.height * 1.2, 0x9aff6a, 0.8, {
          turns: 1.2,
          spin: 5,
          ribbons: 2,
        });
        fx.chunks({
          kind: 'leaf',
          at: chest,
          count: 10,
          speed: [1, 2.4],
          up: 1.4,
          size: [0.07, 0.12],
          color: 0x7ad04a,
          color2: 0xc8ff8a,
          life: [1.2, 1.8],
        });
        break;
      case 'deer':
        fx.circle(target.clone(), 1.3 + form * 0.2, 0x8aff8a, 2.2, 'runes', 0.6);
        fx.spiral(target.clone(), 0.9 + form * 0.15, 2.2, 0x9aff9a, 1.6);
        fx.chunks({
          kind: 'petal',
          at: target.clone().setY(0.4),
          count: 12,
          speed: [0.8, 1.8],
          up: 1.6,
          size: [0.06, 0.1],
          color: 0xffb0d8,
          color2: 0xffffff,
          life: [1.4, 2.2],
          radius: 0.8,
        });
        break;
      case 'cat': {
        // 天雷：从天上劈到目标，落点炸开一个电球
        const sky = target.clone().add(new THREE.Vector3(0.3, 5, -0.4));
        fx.bolt(sky, target.clone().setY(0.4), 0xfff27a, 0.28, 0.045, 0.35, 3);
        fx.orb(target.clone().setY(0.6), 0.45 + form * 0.1, 0xfff27a, 0.35);
        fx.shock(target.clone(), 0.3, 1.2, 0xfff27a, 0.4, { intensity: 1.6 });
        break;
      }
      case 'wolf':
        fx.crescent(
          chest.clone(),
          target.clone().setY(a.height * 0.6),
          0.55 + form * 0.1,
          0xfff27a,
          0.32,
        );
        p.burst({
          count: 16,
          at: feet.clone().setY(0.2),
          shape: 'disc',
          radius: 0.35,
          speed: [0.5, 1.5],
          life: [0.15, 0.3],
          size: [0.04, 0.06],
          color: 0xfff6a0,
          intensity: 3,
          cell: 'spark',
          stretch: 0.05,
          up: 1,
        });
        break;
      case 'bear':
        this.groundSlam(target.clone(), 1 + form * 0.2, form);
        break;
      case 'lizard':
        fx.flash(a.pos.clone().setY(a.height * 0.9), 0.4, 0xd8a0ff, 0.3, 2.4);
        fx.chunks({
          kind: 'crystal',
          at: target.clone().setY(0.2),
          count: 8 + form * 2,
          speed: [1.5, 3.2],
          up: 2,
          size: [0.08, 0.16],
          color: 0xd8a0ff,
          color2: 0xfff0ff,
          life: [0.9, 1.4],
        });
        break;
      default:
        break;
    }
    this.s.kick(0.08);
    this.s.skillCam(e.unitId, form >= 2);
  }

  private ult(e: Extract<FxEvent, { type: 'ult' }>): void {
    const a = this.s.unit(e.unitId);
    if (!a) return;
    const c = ELEMENT_COLOR[a.u.element];
    const feet = a.pos.clone().setY(0.02);
    // 大招起手：特写横幅 + 两段镜头 + 慢动作 + 脚下大法阵 + 冲天光柱与螺旋光带 + 龙卷 + 粒子向身体汇聚
    this.s.ult(e.unitId, toWorld(e.tx, e.ty, new THREE.Vector3()));
    this.s.effects.circle(feet, 2.2, c.main, 2.2, 'hexa', 1.6);
    this.s.effects.circle(feet, 1.4, c.light, 2.2, 'runes', -2.4);
    // 仰拍蓄力时只有法阵、螺旋光带和汇聚的光点；切到侧面出手时再冲起光柱和龙卷
    this.s.effects.spiral(feet, 0.8, a.height * 1.8, c.light, 1.4);
    const fx = this.s.effects;
    const h = a.height;
    fx.after(1.05, () => {
      fx.pillar(feet, 0.45, 7, c.main, 1.1, 1.6);
      fx.vortex(feet, 1.4, h * 1.6, c.main, 1, { turns: 1.6, spin: 6, ribbons: 3, intensity: 1.1 });
      fx.shock(feet, 0.4, 2.6, c.light, 0.7, { intensity: 1.4 });
    });
    this.s.effects.ring(feet.clone(), 0.3, 3.2, c.light, 0.7, { intensity: 2.4, width: 0.25 });
    fx.after(1.05, () => fx.light(feet.clone().setY(1.4), c.main, 10, 7, 0.9));
    this.s.particles.burst({
      count: 40,
      at: a.pos.clone().setY(a.height * 0.5),
      shape: 'sphere',
      radius: 1.6,
      speed: [0.1, 0.2],
      radial: -2.5,
      life: [0.5, 0.8],
      size: [0.06, 0.12],
      color: c.light,
      intensity: 3,
      cell: 'spark',
      fadeIn: 0.3,
    });
    this.s.shake(0.3);
    this.s.aberration(0.012);
  }

  private dash(e: Extract<FxEvent, { type: 'dash' }>): void {
    const a = this.s.unit(e.unitId);
    const elem = a?.u.element ?? 'fire';
    const c = ELEMENT_COLOR[elem];
    const from = toWorld(e.fromX, e.fromY, new THREE.Vector3()).setY(0.5);
    const to = toWorld(e.toX, e.toY, new THREE.Vector3()).setY(0.5);
    const len = from.distanceTo(to);
    const steps = Math.min(24, Math.ceil(len * 6));
    for (let i = 0; i <= steps; i++) {
      const at = from.clone().lerp(to, i / steps);
      this.s.particles.burst({
        count: 1,
        at,
        speed: [0, 0.1],
        life: [0.25, 0.45],
        size: [0.35, 0.5],
        grow: 0.2,
        color: c.main,
        intensity: 1.6,
        cell: elem === 'fire' ? 'flame' : 'glow',
      });
      if (i % 3 === 0)
        this.s.particles.burst({
          count: 2,
          at,
          speed: [0.3, 0.9],
          life: [0.2, 0.35],
          size: [0.04, 0.06],
          color: c.light,
          intensity: 3,
          cell: 'spark',
          stretch: 0.05,
        });
    }
    this.s.effects.beam(from, to, 0.06, c.light, 0.22, 2.8);
    this.s.particles.burst({
      count: 6,
      at: from.clone().setY(0.05),
      shape: 'disc',
      radius: 0.2,
      speed: [0.3, 0.8],
      radial: 1,
      life: [0.4, 0.6],
      size: [0.2, 0.3],
      grow: 1.5,
      color: 0xd8d0c0,
      alpha: 0.5,
      cell: 'smoke',
      additive: false,
    });
    if (elem === 'thunder') this.s.effects.bolt(from, to, 0xfff27a, 0.25, 0.03, 0.25, 2);
    if (elem === 'fire')
      for (let i = 0; i < 3; i++)
        this.s.effects.decal(from.clone().lerp(to, (i + 0.5) / 3), 0.5, 'scorch', 3);
  }

  private blink(e: Extract<FxEvent, { type: 'blink' }>): void {
    const a = this.s.unit(e.unitId);
    const c = ELEMENT_COLOR[a?.u.element ?? 'fire'];
    const from = toWorld(e.fromX, e.fromY, new THREE.Vector3()).setY(0.7);
    const to = toWorld(e.toX, e.toY, new THREE.Vector3()).setY(0.7);
    this.s.effects.beam(from, to, 0.05, c.light, 0.3, 3.2);
    const yaw = Math.atan2(to.x - from.x, to.z - from.z);
    this.s.effects.slash(to.clone().setY(0), yaw, 0.9, c.light, 0.3, {
      y: 0.7,
      tilt: 0.6,
      arc: 2.6,
      intensity: 3,
    });
    this.s.particles.burst({
      count: 12,
      at: from,
      shape: 'sphere',
      radius: 0.2,
      speed: [0.5, 1.4],
      life: [0.3, 0.5],
      size: [0.16, 0.26],
      grow: 0.2,
      color: 0xffd060,
      color2: 0xff3a10,
      intensity: 2.4,
      cell: 'flame',
    });
    this.s.particles.burst({
      count: 8,
      at: to,
      speed: [1, 2.5],
      life: [0.15, 0.3],
      size: [0.04, 0.06],
      color: 0xffffff,
      intensity: 3,
      cell: 'spark',
      stretch: 0.05,
    });
    this.s.kick(0.1);
  }

  private chain(e: Extract<FxEvent, { type: 'chain' }>): void {
    const elem = el(e.element);
    const a = toWorld(e.x1, e.y1, new THREE.Vector3()).setY(0.7);
    const b = toWorld(e.x2, e.y2, new THREE.Vector3()).setY(0.7);
    const col = ECHO_COLORS[Math.min(8, e.echo)] ?? 0xffffff;
    if (elem === 'thunder') {
      this.s.effects.bolt(a, b, 0xfff27a, 0.22, 0.03 + Math.min(4, e.echo) * 0.006, 0.35, 2);
      this.s.particles.burst({
        count: 8,
        at: b,
        speed: [1, 2.5],
        life: [0.1, 0.25],
        size: [0.03, 0.05],
        color: 0xfff6a0,
        intensity: 3,
        cell: 'spark',
        stretch: 0.05,
      });
    } else if (elem === 'wood') {
      this.s.effects.beam(a, b, 0.025, 0xb8ff7a, 0.18, 2.6);
    } else if (elem === 'water') {
      this.s.effects.beam(a, b, 0.04, 0x9fe8ff, 0.2, 2.2);
    } else {
      this.s.effects.beam(a, b, 0.03, col, 0.18, 2.4);
    }
  }

  private reflect(e: Extract<FxEvent, { type: 'reflect' }>): void {
    const at = toWorld(e.x, e.y, new THREE.Vector3()).setY(0.7);
    this.s.effects.ring(at, 0.1, 0.7, 0x9fffe8, 0.28, {
      vertical: new THREE.Vector3(0, 0, 1),
      intensity: 2.4,
    });
    this.s.particles.burst({
      count: 8,
      at,
      speed: [1, 2],
      life: [0.15, 0.3],
      size: [0.05, 0.08],
      color: 0xffffff,
      intensity: 3,
      cell: 'hex',
      spin: 6,
    });
    if (this.canFlash(at)) this.s.effects.light(at, 0x9fffe8, 5, 3, 0.15);
  }

  private explode(e: Extract<FxEvent, { type: 'explode' }>): void {
    const elem = el(e.element);
    const c = ELEMENT_COLOR[elem];
    const at = toWorld(e.x, e.y, new THREE.Vector3());
    const r = Math.max(0.3, e.radius / 100);
    const p = this.s.particles;
    const echo = e.echo ?? 0;
    const k = 1 + Math.min(4, echo) * 0.25;
    const fx = this.s.effects;
    fx.ring(at.clone(), r * 0.3, r * 1.25, c.main, 0.45, { intensity: 2.2 });
    fx.shock(at.clone(), r * 0.3, r * 1.3, c.light, 0.5, { intensity: 1.4 });
    if (this.canFlash(at)) {
      fx.flash(at.clone().setY(r * 0.4), r * 1.1, c.light, 0.3, 2.6);
      fx.light(at.clone().setY(0.8), c.main, 10 * k, 4 + r * 2, 0.35);
    }
    switch (elem) {
      case 'fire':
        fx.fireball(at.clone().setY(r * 0.45), r * 0.85, 0.75 + r * 0.2);
        fx.chunks({
          kind: 'ember',
          at: at.clone().setY(0.4),
          count: Math.round(8 * k),
          speed: [2, 4.5],
          up: 1.5,
          size: [0.03, 0.06],
          color: 0xffd080,
          color2: 0xff5a1a,
          life: [0.6, 1.1],
        });
        p.burst({
          count: Math.round(22 * k),
          at: at.clone().setY(0.3),
          shape: 'sphere',
          radius: r * 0.4,
          speed: [0.5, 2 * r + 0.6],
          life: [0.35, 0.7],
          size: [0.3 * r + 0.15, 0.5 * r + 0.2],
          grow: 0.3,
          color: 0xffe080,
          color2: 0xff3010,
          intensity: 2.6,
          cell: 'flame',
          up: 1,
        });
        p.burst({
          count: Math.round(10 * k),
          at: at.clone().setY(0.4),
          shape: 'sphere',
          radius: r * 0.5,
          speed: [0.3, 0.8],
          life: [0.8, 1.4],
          size: [0.4 * r + 0.2, 0.6 * r + 0.3],
          grow: 1.8,
          color: 0x3a2a2a,
          alpha: 0.55,
          cell: 'smoke',
          additive: false,
          up: 0.7,
        });
        p.burst({
          count: Math.round(16 * k),
          at: at.clone().setY(0.3),
          speed: [2, 4.5],
          life: [0.4, 0.9],
          size: [0.04, 0.07],
          color: 0xffd080,
          intensity: 3,
          cell: 'ember',
          gravity: 5,
          stretch: 0.04,
        });
        this.s.effects.decal(at, r * 1.1, 'scorch', 7);
        break;
      case 'water':
        fx.splash(at.clone(), r * 1.1, 0x8fe6ff, 0.8);
        p.burst({
          count: Math.round(26 * k),
          at: at.clone().setY(0.2),
          shape: 'disc',
          radius: r * 0.4,
          speed: [1.5, 3.2],
          life: [0.5, 0.8],
          size: [0.08, 0.14],
          color: 0xbff4ff,
          intensity: 1.6,
          cell: 'drop',
          gravity: 8,
          stretch: 0.03,
          up: 2.5,
          additive: false,
        });
        p.burst({
          count: Math.round(10 * k),
          at: at.clone().setY(0.3),
          shape: 'sphere',
          radius: r * 0.6,
          speed: [0.2, 0.5],
          life: [0.6, 1],
          size: [0.08, 0.16],
          color: 0xbff4ff,
          intensity: 1.2,
          cell: 'bubble',
          up: 0.6,
        });
        this.s.effects.decal(at, r, 'splash', 4);
        break;
      case 'wood':
        fx.chunks({
          kind: 'petal',
          at: at.clone().setY(0.4),
          count: Math.round(12 * k),
          speed: [1.2, 2.6],
          up: 1.4,
          size: [0.06, 0.1],
          color: 0xffb0d8,
          color2: 0xffffff,
          life: [1.2, 2],
        });
        fx.chunks({
          kind: 'leaf',
          at: at.clone().setY(0.4),
          count: Math.round(8 * k),
          speed: [1.2, 2.6],
          up: 1.2,
          size: [0.07, 0.11],
          color: 0x6ad04a,
          color2: 0xb8f07a,
          life: [1.2, 2],
        });
        p.burst({
          count: Math.round(10 * k),
          at: at.clone().setY(0.4),
          shape: 'sphere',
          radius: r * 0.5,
          speed: [1, 2.4],
          life: [0.7, 1.1],
          size: [0.1, 0.16],
          color: 0xffb0d8,
          color2: 0x8aff6a,
          intensity: 1.6,
          cell: 'petal',
          spin: 6,
          gravity: 1.5,
        });
        this.s.effects.decal(at, r, 'petals', 5);
        break;
      case 'rock':
        fx.band(at.clone(), r * 0.3, r * 1.4, 0.5, 0xffe0b0, 0.5);
        fx.chunks({
          kind: 'rock',
          at: at.clone().setY(0.2),
          count: Math.round(10 * k),
          speed: [2, 4.2],
          up: 2,
          size: [0.08, 0.18],
          color: 0xb8a088,
          color2: 0x7a6048,
          life: [1, 1.6],
          radius: r * 0.4,
        });
        fx.chunks({
          kind: 'crystal',
          at: at.clone().setY(0.3),
          count: Math.round(5 * k),
          speed: [2, 4],
          up: 2,
          size: [0.06, 0.12],
          color: 0xd8a0ff,
          color2: 0xfff0ff,
          life: [0.8, 1.2],
        });
        p.burst({
          count: Math.round(8 * k),
          at: at.clone().setY(0.2),
          shape: 'disc',
          radius: r * 0.5,
          speed: [0.3, 0.8],
          radial: 1,
          life: [0.7, 1.1],
          size: [0.35, 0.5],
          grow: 1.6,
          color: 0xe0d0b8,
          alpha: 0.5,
          cell: 'smoke',
          additive: false,
        });
        this.s.effects.decal(at, r, 'crack', 6);
        break;
      case 'thunder':
        fx.orb(at.clone().setY(r * 0.5), r * 0.7, 0xfff27a, 0.4);
        for (let i = 0; i < 3 + Math.min(3, echo); i++) {
          const ang = Math.random() * Math.PI * 2;
          this.s.effects.bolt(
            at.clone().setY(0.3),
            at
              .clone()
              .add(new THREE.Vector3(Math.cos(ang) * r * 1.3, 0.1, Math.sin(ang) * r * 1.3)),
            0xfff27a,
            0.2,
            0.025,
            0.4,
            0,
          );
        }
        p.burst({
          count: Math.round(22 * k),
          at: at.clone().setY(0.4),
          shape: 'sphere',
          radius: r * 0.3,
          speed: [2, 4],
          life: [0.1, 0.3],
          size: [0.03, 0.06],
          color: 0xfff6a0,
          intensity: 3.2,
          cell: 'spark',
          stretch: 0.06,
        });
        break;
    }
    this.s.shake(0.08 + r * 0.06 + echo * 0.03);
    if (r > 0.9) this.s.kick(0.25);
  }

  private impact(e: Extract<FxEvent, { type: 'impact' }>): void {
    const at = toWorld(e.x, e.y, new THREE.Vector3()).setY(0.35);
    const s = Math.min(1.5, e.strength / 400);
    this.s.effects.ring(at.clone().setY(0.03), 0.1, 0.5 + s * 0.6, 0xfff0c0, 0.3, {
      intensity: 1.8,
    });
    this.s.effects.shock(at.clone().setY(0), 0.2, 0.7 + s * 0.6, 0xfff0c0, 0.35, {
      intensity: 1.4,
    });
    this.s.effects.chunks({
      kind: 'rock',
      at: at.clone(),
      count: 3 + Math.round(s * 3),
      speed: [1.5, 3],
      up: 1.5,
      size: [0.05, 0.1],
      color: 0xb8a890,
      color2: 0x8a7a68,
      life: [0.8, 1.2],
    });
    // 撞在场地边缘：结界显形
    const hw = FIELD_PX.width / 200;
    const hd = FIELD_PX.height / 200;
    if (hw - Math.abs(at.x) < 0.6)
      this.s.effects.barrierAt(
        at.clone().setX(Math.sign(at.x) * hw),
        new THREE.Vector3(-Math.sign(at.x), 0, 0),
        0x9fe8ff,
      );
    else if (hd - Math.abs(at.z) < 0.6)
      this.s.effects.barrierAt(
        at.clone().setZ(Math.sign(at.z) * hd),
        new THREE.Vector3(0, 0, -Math.sign(at.z)),
        0x9fe8ff,
      );
    this.s.particles.burst({
      count: 10,
      at,
      speed: [1, 2.5],
      life: [0.15, 0.3],
      size: [0.04, 0.07],
      color: 0xfff0c0,
      intensity: 2.5,
      cell: 'spark',
      stretch: 0.05,
    });
    this.s.particles.burst({
      count: 4,
      at: at.clone().setY(0.1),
      shape: 'disc',
      radius: 0.2,
      speed: [0.3, 0.8],
      radial: 0.8,
      life: [0.4, 0.6],
      size: [0.25, 0.35],
      grow: 1.5,
      color: 0xd8d0c0,
      alpha: 0.5,
      cell: 'smoke',
      additive: false,
    });
    this.s.shake(0.06 + s * 0.08);
    this.s.hitstop(0.03);
  }

  private status(e: Extract<FxEvent, { type: 'status' }>): void {
    const t = this.s.unit(e.unitId);
    if (!t) return;
    if (e.status === 'guard') {
      const id = e.unitId;
      this.s.effects.dome(
        () => {
          const info = this.s.unit(id);
          return info && info.u.alive && info.u.guard > 0
            ? info.pos.clone().setY(info.height * 0.5)
            : null;
        },
        Math.max(0.55, t.height * 0.68),
        0x5affd8,
        Math.max(0.5, e.duration),
      );
    } else if (e.status === 'stoneSkin') {
      this.s.particles.burst({
        count: 10,
        at: _a.copy(t.pos).setY(t.height * 0.5),
        shape: 'sphere',
        radius: t.height * 0.4,
        speed: [0.2, 0.5],
        life: [0.4, 0.7],
        size: [0.08, 0.12],
        color: 0xe0c8a0,
        intensity: 1.6,
        cell: 'hex',
        spin: 3,
      });
    } else if (e.status === 'taunt') {
      this.s.effects.ring(t.pos.clone(), 0.3, 1.6, 0xff6a5a, 0.5, { intensity: 1.6 });
    } else if (e.status === 'root') {
      this.s.effects.vines(t.pos.clone(), 0.45, 5, Math.max(0.6, e.duration), 0x3aa04a);
    }
  }

  private zone(e: Extract<FxEvent, { type: 'zone' }>): void {
    const at = toWorld(e.x, e.y, new THREE.Vector3());
    const r = e.r / 100;
    // 线形区域：从 (x, y) 沿 angle 延伸 length（燃烧带、岩刺带、水墙）
    const len = typeof e.length === 'number' ? e.length / 100 : 0;
    if (len > 0 && typeof e.angle === 'number') {
      const dir = new THREE.Vector3(Math.cos(e.angle), 0, Math.sin(e.angle));
      if (e.kind === 'spikes' || e.kind === 'spikeRing') {
        // 一排岩刺顺着方向依次破土
        const pts: THREE.Vector3[] = [];
        const n = Math.max(4, Math.round(len * 3.2));
        for (let i = 0; i < n; i++) {
          const side = (Math.random() - 0.5) * r * 1.4;
          pts.push(
            at
              .clone()
              .addScaledVector(dir, (i + 0.5) * (len / n))
              .add(new THREE.Vector3(-dir.z * side, 0, dir.x * side)),
          );
        }
        this.s.effects.spikes(pts, 0.9 + r * 0.4, 0x9a8a7a, 1.4, 0.035);
        this.s.effects.chunks({
          kind: 'rock',
          at: at
            .clone()
            .addScaledVector(dir, len * 0.5)
            .setY(0.2),
          count: 8,
          speed: [1.5, 3.5],
          up: 2,
          size: [0.06, 0.14],
          color: 0xb8a088,
          color2: 0x7a6048,
          radius: len * 0.4,
        });
        return;
      }
      if (e.kind === 'waterWall') {
        const center = at.clone().addScaledVector(dir, len / 2);
        this.s.effects.wall(center, -e.angle, len, 2.2, 0x7fe0ff, 4);
        this.s.effects.splash(center, Math.min(1.4, len * 0.3), 0x8fe6ff, 0.7);
        return;
      }
      if (e.kind === 'burn') return;
    }
    switch (e.kind) {
      case 'vines':
        this.s.effects.vines(at, r, 10, 2.5, 0x3aa04a);
        this.s.effects.circle(at, r * 1.05, 0x8aff8a, 2.5, 'runes', 0.4);
        break;
      case 'spikes':
      case 'spikeRing': {
        const pts: THREE.Vector3[] = [];
        const n = Math.round(8 + r * 6);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr =
            e.kind === 'spikeRing'
              ? r * (0.85 + Math.random() * 0.2)
              : r * Math.sqrt(Math.random());
          pts.push(new THREE.Vector3(at.x + Math.cos(a) * rr, 0, at.z + Math.sin(a) * rr));
        }
        this.s.effects.spikes(pts, 0.9 + r * 0.3, 0x9a8a7a, 1.4, 0.015);
        this.s.effects.decal(at, r * 1.1, 'crack', 6);
        break;
      }
      case 'waterWall':
        this.s.effects.wall(at, Math.PI / 2, r * 2, 2.2, 0x7fe0ff, 4);
        break;
      case 'blossom':
        this.s.effects.circle(at, r, 0xffb0d8, 1.6, 'penta', 1);
        break;
      default:
        break;
    }
  }

  private zoneTick(z: ViewZone, dt: number): void {
    const at = toWorld(z.x, z.y, _b);
    const r = z.r / 100;
    const p = this.s.particles;
    const len = typeof z.length === 'number' ? z.length / 100 : 0;
    if (z.kind === 'burn' && len > 0 && typeof z.angle === 'number') {
      // 燃烧带：沿线随机冒火
      if (Math.random() < dt * 14 * (1 + len)) {
        const k = Math.random() * len;
        const side = (Math.random() - 0.5) * r * 2;
        const cx = Math.cos(z.angle);
        const cz = Math.sin(z.angle);
        p.burst({
          count: 1,
          at: at.clone().add(new THREE.Vector3(cx * k - cz * side, 0, cz * k + cx * side)),
          speed: [0.1, 0.3],
          life: [0.4, 0.7],
          size: [0.2, 0.34],
          grow: 0.3,
          color: 0xffc050,
          color2: 0xff3010,
          intensity: 1.8,
          cell: 'flame',
          up: 0.9,
        });
      }
      return;
    }
    if (z.kind === 'burn' && Math.random() < dt * 20 * r) {
      p.burst({
        count: 1,
        at: at.clone(),
        shape: 'disc',
        radius: r,
        speed: [0.1, 0.3],
        life: [0.4, 0.7],
        size: [0.2, 0.34],
        grow: 0.3,
        color: 0xffc050,
        color2: 0xff3010,
        intensity: 2.2,
        cell: 'flame',
        up: 0.9,
      });
    } else if (z.kind === 'arrowRain' && Math.random() < dt * 40) {
      const top = at
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * r * 2, 3.5, (Math.random() - 0.5) * r * 2));
      p.burst({
        count: 1,
        at: top,
        dir: new THREE.Vector3(0.15, -1, 0),
        spread: 0.02,
        speed: [9, 11],
        life: [0.32, 0.36],
        size: [0.04, 0.04],
        grow: 1,
        color: 0xd8ff9a,
        intensity: 2.4,
        cell: 'streak',
        stretch: 0.05,
      });
    } else if (z.kind === 'vines' && Math.random() < dt * 10) {
      p.burst({
        count: 1,
        at: at.clone().setY(0.2),
        shape: 'disc',
        radius: r,
        speed: [0.05, 0.2],
        life: [0.6, 1],
        size: [0.08, 0.12],
        color: 0xffb0d8,
        intensity: 1.4,
        cell: 'petal',
        spin: 3,
        up: 0.4,
      });
    } else if (z.kind === 'waterWall' && Math.random() < dt * 20) {
      p.burst({
        count: 1,
        at: at.clone().add(new THREE.Vector3(0, 1.8, (Math.random() - 0.5) * r * 2)),
        speed: [0.2, 0.5],
        life: [0.4, 0.7],
        size: [0.06, 0.1],
        color: 0xbff4ff,
        intensity: 1.4,
        cell: 'drop',
        gravity: 5,
        additive: false,
      });
    }
  }

  private echo(e: Extract<FxEvent, { type: 'echo' }>): void {
    const at = toWorld(e.x, e.y, new THREE.Vector3()).setY(0.6);
    const lv = Math.min(8, e.level);
    const col = ECHO_COLORS[lv] ?? 0xffffff;
    this.s.effects.ring(at.clone().setY(0.04), 0.2, 0.8 + lv * 0.18, col, 0.4, {
      intensity: 1.6 + lv * 0.2,
    });
    if (lv >= 2) this.s.number(at.clone().setY(1.4), `回响 ×${lv}`, 'echo', 0);
    if (lv >= 3 && this.canFlash(at)) this.s.effects.light(at, col, 8 + lv * 2, 4, 0.3);
    if (lv >= 4) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        this.s.effects.bolt(
          at,
          at.clone().add(new THREE.Vector3(Math.cos(a) * 1.2, 0.3, Math.sin(a) * 1.2)),
          col,
          0.18,
          0.02,
          0.4,
          0,
        );
      }
    }
    if (lv >= 5) {
      this.s.effects.pillar(at.clone().setY(0), 0.35, 4, col, 0.6, 2.2);
      this.s.shake(0.12);
    }
  }

  private death(e: Extract<FxEvent, { type: 'death' }>): void {
    const t = this.s.unit(e.unitId);
    const at = t ? t.pos.clone() : toWorld(e.x, e.y, new THREE.Vector3());
    const col = e.team === 0 ? 0x9fe8ff : 0xffc080;
    this.s.particles.burst({
      count: 18,
      at: at.clone().setY(0.4),
      shape: 'sphere',
      radius: 0.35,
      speed: [0.3, 1],
      life: [0.8, 1.3],
      size: [0.05, 0.1],
      color: col,
      intensity: 2.2,
      cell: 'spark',
      up: 1.4,
      gravity: -0.5,
      fadeIn: 0.1,
    });
    this.s.effects.ring(at.clone(), 0.2, 1.2, col, 0.5, { intensity: 1.4 });
  }

  private spawn(e: Extract<FxEvent, { type: 'spawn' }>): void {
    const t = this.s.unit(e.unitId);
    if (!t) return;
    const c = ELEMENT_COLOR[t.u.element];
    this.s.effects.circle(t.pos.clone(), 0.9, c.main, 1, 'penta', 3);
    this.s.effects.pillar(t.pos.clone(), 0.4, 3, c.light, 0.7, 2);
  }

  private transform(e: Extract<FxEvent, { type: 'transform' }>): void {
    const t = this.s.unit(e.unitId);
    if (!t) return;
    const at = t.pos.clone();
    this.s.ult(e.unitId);
    this.s.effects.pillar(at, 1.1, 12, 0xffc84e, 2, 3);
    this.s.effects.vortex(at, 2.2, 5, 0xff6a2a, 2, { turns: 2, spin: 6, ribbons: 4 });
    this.s.effects.fireball(at.clone().setY(1.2), 2.2, 1.4);
    this.s.effects.band(at.clone(), 0.5, 6, 1.2, 0xffc84e, 1);
    this.s.effects.circle(at, 3.2, 0xff6a2a, 2.4, 'hexa', 1.2);
    this.s.effects.ring(at.clone(), 0.5, 6, 0xffe27a, 1, { intensity: 2.6, width: 0.2 });
    this.s.effects.flash(at.clone().setY(1.5), 3, 0xffe8b0, 0.6, 2.4);
    this.s.effects.light(at.clone().setY(2), 0xffb04a, 30, 12, 1.4);
    this.s.particles.burst({
      count: 80,
      at: at.clone().setY(1.2),
      shape: 'sphere',
      radius: 0.8,
      speed: [2, 6],
      life: [0.6, 1.2],
      size: [0.2, 0.4],
      grow: 0.3,
      color: 0xffe080,
      color2: 0xff3010,
      intensity: 2.6,
      cell: 'flame',
    });
    this.s.shake(0.8);
    if (!this.s.gentle) this.s.flash(0xfff0d0, 0.5);
  }

  private end(e: Extract<FxEvent, { type: 'end' }>): void {
    if (e.result !== 'win') return;
    this.s.slowmo(0.35, 1.2);
  }

  /** 熊的砸地：裂纹、尘土环，进化后加一排岩刺。 */
  private groundSlam(at: THREE.Vector3, r: number, form: number): void {
    this.s.effects.ring(at.clone(), 0.2, r * 1.3, 0xffe0b0, 0.45, { intensity: 1.6 });
    this.s.effects.band(at.clone(), 0.3, r * 1.5, 0.6, 0xffe0b0, 0.55);
    this.s.effects.chunks({
      kind: 'rock',
      at: at.clone().setY(0.2),
      count: 8 + form * 3,
      speed: [2, 4],
      up: 2.4,
      size: [0.08, 0.18],
      color: 0xb8a088,
      color2: 0x7a6048,
      life: [1, 1.6],
      radius: 0.3,
    });
    this.s.effects.decal(at, r * 0.9, 'crack', 6);
    this.s.particles.burst({
      count: 14,
      at: at.clone().setY(0.1),
      shape: 'disc',
      radius: 0.3,
      speed: [0.5, 1.4],
      radial: 1.4,
      life: [0.5, 0.9],
      size: [0.3, 0.5],
      grow: 1.6,
      color: 0xd8c8a8,
      alpha: 0.55,
      cell: 'smoke',
      additive: false,
    });
    this.s.particles.burst({
      count: 12,
      at: at.clone().setY(0.2),
      speed: [2, 4],
      life: [0.5, 0.9],
      size: [0.06, 0.12],
      color: 0xb8a088,
      cell: 'shard',
      gravity: 9,
      spin: 10,
      bounce: true,
      additive: false,
      up: 2,
    });
    if (form >= 2) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(new THREE.Vector3(at.x + Math.cos(a) * r * 0.8, 0, at.z + Math.sin(a) * r * 0.8));
      }
      this.s.effects.spikes(pts, 0.8, 0x9a8a7a, 1, 0.02);
    }
    this.s.shake(0.25);
    this.s.kick(0.2);
  }
}
