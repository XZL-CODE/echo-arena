// 特效：把模拟事件变成粒子、光圈、闪电、火球、冲击波、焦痕、地面光照与文字。只负责表现，不影响规则。
// 强度随回响等级逐级升级；“减少闪烁”时去掉闪白、闪电抖动与强光，保留轨迹与提示。
import type { Unit } from '../core/sim/entities.js';
import type { SimEvent } from '../core/sim/events.js';
import type { World } from '../core/sim/world.js';
import type { UnitKind } from '../core/types.js';
import { glowSprite, scorchSprite, smokeSprite, withAlpha } from './glow.js';
import { echoColor, PALETTE } from './palette.js';
import { circlePath, starPath } from './shapes.js';

/** 弹丸与火花离地的高度（与弹丸的画法一致）。 */
export const AIR = 10;

type Shape =
  | 'fire'
  | 'glow'
  | 'spark'
  | 'ember'
  | 'dot'
  | 'smoke'
  | 'debris'
  | 'shard'
  | 'star'
  | 'plus'
  | 'heart'
  | 'confetti';

interface Particle {
  shape: Shape;
  x: number;
  y: number;
  /** 离地高度：碎片、火花会抛起再落地弹跳。 */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  /** 结束时的尺寸倍数。 */
  grow: number;
  color: string;
  rot: number;
  vr: number;
  drag: number;
  /** 作用在高度上的重力；负数表示上升（烟、火星）。 */
  gravity: number;
  additive: boolean;
  bounce: boolean;
  /** 最大不透明度。 */
  opacity: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
  /** 地面上的冲击波画在单位下面，空中的光圈画在上面。 */
  floor: boolean;
  /** 柔和的环形冲击波（而不是一条线）。 */
  soft: boolean;
}

interface Bolt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
  width: number;
  seed: number;
  /** 弧形光带（治疗的连线）而不是折线闪电。 */
  arc: boolean;
}

interface Light {
  x: number;
  y: number;
  r: number;
  color: string;
  life: number;
  max: number;
  power: number;
}

interface Decal {
  x: number;
  y: number;
  r: number;
  kind: 'scorch' | 'crack';
  life: number;
  max: number;
  rot: number;
  seed: number;
  hot: string;
}

interface Swoosh {
  x: number;
  y: number;
  angle: number;
  r: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

interface Rays {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
  count: number;
  seed: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  max: number;
  vy: number;
  /** 回响标注的等级（普通文字为 0）。 */
  echo: number;
  /** 伤害数字所属的单位（其它文字为 0），用来合并短时间内的连续命中。 */
  target: number;
  amount: number;
  /** 出现至今的时间（合并时 life 会被重置，age 不会）。 */
  age: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
}

const MAX_PARTICLES = 900;
const MAX_TEXTS = 40;
const MAX_DECALS = 28;
const MAX_LIGHTS = 24;

const DEBRIS: Partial<Record<UnitKind, string[]>> = {
  guard: ['#dfe9f2', '#8ea3b6', '#e4ae47'],
  slinger: ['#ffe27a', '#f6b42a', '#ff5a9e'],
  bell: ['#ffe89a', '#e2a42c', '#ee6a4e'],
  archer: ['#e9c08e', '#8a3f7c', '#b8804a'],
  shell: ['#c99ae6', '#6b3f86', '#ff7c6a'],
  mouse: ['#d9d0ea', '#8d7fa8', '#ff9fbb'],
  bomber: ['#6d4077', '#e4ae47', '#ff5e3a'],
  snail: ['#e3a7d2', '#f5e0bd', '#ff6f91'],
  brute: ['#a8714f', '#7b3f6e', '#e9c69e'],
  mirror: ['#eef3f7', '#9aa8b5', '#c77dff'],
  mortar: ['#a86fae', '#4a4458', '#e4ae47'],
  jack: ['#dc5d9c', '#ffffff', '#4cc3e6'],
  king: ['#8a5cc2', '#f2c44f', '#5fe0f2'],
};

const FIRE = ['#ffcf6b', '#ffa94d', '#ff7b3a', '#e8452c'];

/** 估算文字宽度：汉字按一个字号，其余字符按 0.6 个字号。 */
function textWidth(t: { text: string; size: number }): number {
  let w = 0;
  for (const ch of t.text) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6;
  return w * t.size;
}

/** 火云在各个时刻的亮面与暗面颜色（rgb）。 */
const FIRE_STAGES: Array<[number, [number, number, number], [number, number, number]]> = [
  [0, [255, 250, 214], [255, 200, 90]],
  [0.2, [255, 214, 110], [255, 128, 52]],
  [0.45, [255, 150, 70], [206, 64, 40]],
  [0.7, [150, 120, 118], [78, 62, 68]],
  [1, [120, 108, 110], [60, 50, 56]],
];

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

function fireColors(k: number): [string, string] {
  for (let i = 1; i < FIRE_STAGES.length; i++) {
    const [t1, l1, d1] = FIRE_STAGES[i] as (typeof FIRE_STAGES)[number];
    const [t0, l0, d0] = FIRE_STAGES[i - 1] as (typeof FIRE_STAGES)[number];
    if (k <= t1) {
      const t = (k - t0) / (t1 - t0);
      return [mix(l0, l1, t), mix(d0, d1, t)];
    }
  }
  return ['rgb(120, 108, 110)', 'rgb(60, 50, 56)'];
}
const CONFETTI = ['#ffd166', '#5ad1e6', '#ff6fb5', '#72f2c8', '#c77dff', '#fff1b8'];

export interface FxOptions {
  damageNumbers: boolean;
  screenShake: boolean;
  reduceFlashes: boolean;
}

export class Fx {
  particles: Particle[] = [];
  rings: Ring[] = [];
  bolts: Bolt[] = [];
  lights: Light[] = [];
  decals: Decal[] = [];
  swooshes: Swoosh[] = [];
  rays: Rays[] = [];
  texts: FloatText[] = [];
  motes: Mote[] = [];
  /** 震屏强度 0..1。 */
  trauma = 0;
  /** 顿帧：剩余时间（秒），期间游戏放慢。 */
  hitstop = 0;
  /** 首领换阶段时画面压暗的程度 0..1。 */
  dim = 0;
  /** 画质系数（0.4..1）：帧率不够时自动降低，粒子按比例减少。 */
  quality = 1;
  options: FxOptions = { damageNumbers: true, screenShake: true, reduceFlashes: false };
  private echoShown = new Map<number, number>();
  private seed = 1;
  private cursor = 0;
  private clock = 0;
  /** 最近的闪光位置：同一处一瞬间只闪一次，大乱斗时不会叠成一片白。 */
  private flashes: Array<{ x: number; y: number; t: number }> = [];

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.bolts = [];
    this.lights = [];
    this.decals = [];
    this.swooshes = [];
    this.rays = [];
    this.texts = [];
    this.trauma = 0;
    this.hitstop = 0;
    this.dim = 0;
    this.flashes = [];
    this.echoShown.clear();
  }

  /** 各类特效的当前数量（测试用）。 */
  stats(): Record<string, number> {
    return {
      particles: this.particles.length,
      rings: this.rings.length,
      bolts: this.bolts.length,
      lights: this.lights.length,
      decals: this.decals.length,
      texts: this.texts.length,
      quality: this.quality,
    };
  }

  private rand(): number {
    // 表现层的随机不需要可复现，但用自带序列避免与规则层共享随机源。
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private range(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length) % list.length] as T;
  }

  /** 按画质缩放数量（至少 1）。 */
  private n(count: number): number {
    return Math.max(1, Math.round(count * this.quality));
  }

  /** 附近 0.08 秒内已经闪过就返回 false；否则记下这次闪光。 */
  private canFlash(x: number, y: number, radius = 36): boolean {
    for (const f of this.flashes) {
      if (this.clock - f.t < 0.08 && Math.abs(f.x - x) < radius && Math.abs(f.y - y) < radius) {
        return false;
      }
    }
    if (this.flashes.length >= 24) this.flashes.shift();
    this.flashes.push({ x, y, t: this.clock });
    return true;
  }

  shake(amount: number): void {
    if (!this.options.screenShake) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  // ---- 基本元素 ----

  private add(init: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'color'>): void {
    const p: Particle = {
      shape: 'glow',
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      max: 0.5,
      size: 4,
      grow: 1,
      rot: this.rand() * 6.28,
      vr: 0,
      drag: 3,
      gravity: 0,
      additive: true,
      bounce: false,
      opacity: 1,
      ...init,
    };
    if (this.particles.length < MAX_PARTICLES) this.particles.push(p);
    else {
      this.particles[this.cursor % MAX_PARTICLES] = p;
      this.cursor++;
    }
  }

  /** 向四周（或沿 angle 方向的扇形）喷出一把粒子。 */
  burst(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    init: Partial<Particle> = {},
    angle?: number,
    spread = Math.PI * 2,
  ): void {
    const total = this.n(count);
    for (let i = 0; i < total; i++) {
      const a =
        angle === undefined ? this.rand() * Math.PI * 2 : angle + (this.rand() - 0.5) * spread;
      const s = speed * (0.4 + this.rand() * 0.8);
      this.add({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        max: 0.3 + this.rand() * 0.35,
        size: 2 + this.rand() * 2.5,
        vr: (this.rand() - 0.5) * 12,
        color,
        ...init,
      });
    }
  }

  ring(
    x: number,
    y: number,
    r0: number,
    r1: number,
    color: string,
    max = 0.4,
    width = 3,
    floor = false,
    soft = false,
  ): void {
    if (this.rings.length > 90) this.rings.shift();
    this.rings.push({ x, y, r0, r1, life: 0, max, color, width, floor, soft });
  }

  bolt(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width = 3,
    max = 0.3,
    arc = false,
  ) {
    if (this.bolts.length > 60) this.bolts.shift();
    this.bolts.push({ x1, y1, x2, y2, life: 0, max, color, width, seed: this.rand() * 1000, arc });
  }

  light(x: number, y: number, r: number, color: string, power = 0.6, max = 0.45): void {
    const p = this.options.reduceFlashes ? power * 0.45 : power;
    // 同一处刚亮过的灯合并，连环爆炸时地面不会一闪一闪。
    const near = this.lights.find((l) => l.life < 0.1 && Math.hypot(l.x - x, l.y - y) < r * 0.6);
    if (near) {
      near.power = Math.min(1, Math.max(near.power, p) + p * 0.2);
      near.r = Math.max(near.r, r);
      near.max = Math.max(near.max, max);
      return;
    }
    if (this.lights.length >= MAX_LIGHTS) this.lights.shift();
    this.lights.push({ x, y, r, color, life: 0, max, power: p });
  }

  private decal(x: number, y: number, r: number, kind: Decal['kind'], hot: string): void {
    if (this.decals.length >= MAX_DECALS) this.decals.shift();
    this.decals.push({
      x,
      y,
      r,
      kind,
      life: 0,
      max: 7,
      rot: this.rand() * 6.28,
      seed: Math.floor(this.rand() * 1e6),
      hot,
    });
  }

  private swoosh(x: number, y: number, angle: number, r: number, color: string, width: number) {
    if (this.swooshes.length > 30) this.swooshes.shift();
    this.swooshes.push({ x, y, angle, r, life: 0, max: 0.2, color, width });
  }

  private burstRays(x: number, y: number, r: number, color: string, count: number, max = 0.3) {
    if (this.options.reduceFlashes) return;
    if (this.rays.length > 20) this.rays.shift();
    this.rays.push({ x, y, r, life: 0, max, color, count, seed: this.rand() * 1000 });
  }

  text(
    x: number,
    y: number,
    text: string,
    color: string,
    size = 16,
    max = 0.9,
    vy = -40,
    echo = 0,
  ): FloatText {
    if (this.texts.length >= MAX_TEXTS) this.texts.shift();
    const t: FloatText = {
      x,
      y,
      text,
      color,
      size,
      life: 0,
      max,
      vy,
      echo,
      target: 0,
      amount: 0,
      age: 0,
    };
    this.texts.push(t);
    return t;
  }

  /**
   * 飘字数值：同一单位 0.3 秒内的连续数值累加到同一个数字上，大乱斗时不刷屏。
   * key 用单位编号区分（伤害为正、治疗为负）。
   */
  private floatNumber(
    key: number,
    x: number,
    y: number,
    amount: number,
    color: string,
    size: number,
    prefix = '',
  ): void {
    const recent = this.texts.find((t) => t.target === key && t.life < 0.3 && t.age < 0.6);
    if (recent) {
      recent.amount += amount;
      recent.text = prefix + String(Math.round(recent.amount));
      recent.life = Math.min(recent.life, 0.08);
      recent.vy = Math.min(recent.vy, -30);
      if (size >= recent.size) {
        recent.size = Math.min(28, size + 1);
        recent.color = color;
      } else {
        recent.size = Math.min(28, recent.size + 0.5);
      }
      return;
    }
    const jx = x + (this.rand() - 0.5) * 14;
    const text = prefix + String(Math.round(amount));
    const t = this.text(
      jx,
      this.freeY(jx, y, text.length * size * 0.6, size),
      text,
      color,
      size,
      0.8,
      -46,
    );
    t.target = key;
    t.amount = amount;
  }

  /** 新文字若压在附近刚出现的文字上，就依次往上错开，连环爆炸时数字不叠成一团。 */
  private freeY(x: number, y: number, width = 24, height = 15): number {
    let top = y;
    for (let pass = 0; pass < 5; pass++) {
      const hit = this.texts.find(
        (t) =>
          t.life < 0.5 &&
          Math.abs(t.x - x) < (textWidth(t) + width) / 2 &&
          Math.abs(t.y - top) < (t.size + height) / 2,
      );
      if (!hit) break;
      top = hit.y - (hit.size + height) / 2 - 2;
    }
    return top;
  }

  // ---- 组合特效 ----

  /** 火花：带拖影的亮线，抛起后落地。 */
  private sparks(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    angle?: number,
    spread?: number,
  ) {
    this.burst(
      x,
      y,
      count,
      color,
      speed,
      {
        shape: 'spark',
        z: AIR,
        vz: 60 + this.rand() * 90,
        gravity: 420,
        drag: 2.2,
        size: 1.6 + this.rand(),
        max: 0.28 + this.rand() * 0.25,
      },
      angle,
      spread,
    );
  }

  /** 一团扬起的尘土。 */
  private dust(x: number, y: number, count: number, color = 'rgba(236, 222, 196, 1)', speed = 70) {
    this.burst(x, y, count, color, speed, {
      shape: 'smoke',
      additive: false,
      size: 7 + this.rand() * 5,
      grow: 1.9,
      drag: 4,
      max: 0.45 + this.rand() * 0.3,
      vz: 18,
      gravity: -10,
    });
  }

  /** 火球：闪光核心、翻滚的火团、冲击波、火花、碎屑、烟、火星和焦痕。 */
  private fireball(x: number, y: number, radius: number, accent: string, big = 1) {
    const reduce = this.options.reduceFlashes;
    this.light(x, y, radius * 1.9, '#ffb45a', 0.7 * Math.min(1.2, big), 0.55);
    if (!reduce && this.canFlash(x, y, radius * 0.6)) {
      this.add({
        x,
        y,
        z: AIR,
        color: '#ffe0a0',
        shape: 'glow',
        size: radius * 0.55,
        grow: 1.4,
        max: 0.12,
        drag: 0,
      });
    }
    // 翻滚的火团：一团团实心的卡通火云，从黄到橙到红，最后变成烟
    const puffs = this.n(7 * big);
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + this.rand() * 0.6;
      const s = this.range(40, 110) * (radius / 90);
      const d = i === 0 ? 0 : radius * this.range(0.08, 0.22);
      this.add({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d * 0.8,
        z: AIR + this.range(0, 10),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.8,
        vz: this.range(20, 60),
        gravity: -25,
        color: '#ffd166',
        shape: 'fire',
        additive: false,
        size: radius * (i === 0 ? 0.36 : this.range(0.2, 0.3)),
        grow: 1.75,
        drag: 3.2,
        max: this.range(0.5, 0.75),
      });
    }
    // 火团外面一层暖光
    for (let i = 0; i < this.n(3 * big); i++) {
      const a = this.rand() * Math.PI * 2;
      this.add({
        x: x + Math.cos(a) * radius * 0.2,
        y: y + Math.sin(a) * radius * 0.2,
        z: AIR,
        color: FIRE[i % FIRE.length] as string,
        shape: 'glow',
        size: radius * 0.5,
        grow: 1.5,
        drag: 3,
        max: 0.35,
      });
    }
    this.ring(x, y, radius * 0.25, radius * 1.15, accent, 0.4, radius * 0.35, true, true);
    this.ring(x, y, radius * 0.2, radius, accent, 0.35, 4);
    this.sparks(x, y, 14 * big, '#ffd27a', 300 * (radius / 90));
    this.debris(x, y, 6 * big, ['#3a2a2a', '#5a4038', '#2a1d1d'], 180);
    // 烟往上飘，淡一些，不把附近的单位盖住
    const smoke = this.n(4 * big);
    for (let i = 0; i < smoke; i++) {
      const a = this.rand() * Math.PI * 2;
      this.add({
        x: x + Math.cos(a) * radius * 0.3,
        y: y + Math.sin(a) * radius * 0.3,
        z: AIR + 10,
        vx: Math.cos(a) * 30,
        vy: Math.sin(a) * 30,
        vz: this.range(50, 80),
        gravity: -20,
        color: 'rgba(96, 86, 92, 1)',
        shape: 'smoke',
        additive: false,
        opacity: 0.6,
        size: radius * this.range(0.2, 0.28),
        grow: 2.2,
        drag: 1.5,
        max: this.range(0.8, 1.2),
      });
    }
    this.embers(x, y, 8 * big, radius * 0.6);
    this.decal(x, y, radius * 0.85, 'scorch', '#ff8a3a');
  }

  /** 碎屑：带棱角的小块，抛起、落地弹两下。 */
  private debris(x: number, y: number, count: number, colors: readonly string[], speed: number) {
    const total = this.n(count);
    for (let i = 0; i < total; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = speed * (0.4 + this.rand() * 0.8);
      this.add({
        x,
        y,
        z: AIR,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.7,
        vz: this.range(120, 260),
        gravity: 700,
        drag: 1.2,
        shape: i % 3 === 0 ? 'shard' : 'debris',
        additive: false,
        bounce: true,
        color: colors[i % colors.length] as string,
        size: this.range(2.5, 5),
        vr: (this.rand() - 0.5) * 16,
        max: this.range(0.8, 1.2),
      });
    }
  }

  /** 往上飘的火星。 */
  private embers(x: number, y: number, count: number, spread: number) {
    const total = this.n(count);
    for (let i = 0; i < total; i++) {
      this.add({
        x: x + (this.rand() - 0.5) * spread,
        y: y + (this.rand() - 0.5) * spread * 0.6,
        z: AIR + this.range(0, 20),
        vx: (this.rand() - 0.5) * 40,
        vy: (this.rand() - 0.5) * 20,
        vz: this.range(40, 90),
        gravity: -20,
        drag: 1,
        shape: 'ember',
        color: this.pick(['#ffd166', '#ff9f43', '#ffb347']),
        size: this.range(1.5, 2.6),
        max: this.range(0.9, 1.6),
      });
    }
  }

  /** 闪亮的小星星（治疗、回响、出场）。 */
  private twinkles(x: number, y: number, count: number, color: string, spread: number, rise = 50) {
    const total = this.n(count);
    for (let i = 0; i < total; i++) {
      this.add({
        x: x + (this.rand() - 0.5) * spread,
        y: y + (this.rand() - 0.5) * spread * 0.6,
        z: AIR + this.range(0, 26),
        vz: this.range(rise * 0.5, rise),
        gravity: -10,
        drag: 2,
        shape: 'star',
        color,
        size: this.range(2.5, 4.5),
        vr: (this.rand() - 0.5) * 6,
        max: this.range(0.5, 0.9),
      });
    }
  }

  // ---- 事件 ----

  /** 把一批模拟事件转换成特效。 */
  handle(events: readonly SimEvent[], unitOf: (id: number) => Unit | undefined): void {
    for (const e of events) {
      switch (e.type) {
        case 'shoot': {
          const u = unitOf(e.unitId);
          const ally = u?.team === 0;
          const mx = e.x + Math.cos(e.angle) * 20;
          const my = e.y + Math.sin(e.angle) * 20;
          const color = ally ? '#fff1b8' : u?.kind === 'king' ? '#f2c94c' : '#ffb08a';
          this.add({
            x: mx,
            y: my,
            z: AIR,
            color,
            shape: 'glow',
            size: e.big ? 20 : 11,
            max: 0.12,
            drag: 0,
          });
          this.sparks(mx, my, e.big ? 7 : 3, color, e.big ? 260 : 180, e.angle, 0.8);
          this.ring(mx, my - AIR, 2, e.big ? 24 : 10, color, 0.18, 2);
          if (e.big) {
            this.dust(mx, my, 4, 'rgba(236, 222, 196, 1)', 60);
            this.light(mx, my, 110, color, 0.5, 0.3);
            this.shake(0.12);
          }
          break;
        }
        case 'hit': {
          const target = unitOf(e.targetId);
          const color =
            e.team === 0 ? (e.echo > 0 ? echoColor(e.echo) : '#fff6d8') : PALETTE.enemyShot;
          // 火花顺着击退方向溅出去
          let angle: number | undefined;
          if (target && Math.hypot(target.vx, target.vy) > 30)
            angle = Math.atan2(target.vy, target.vx);
          const hy = e.y - 8;
          const flash = this.canFlash(e.x, hy);
          this.sparks(
            e.x,
            hy,
            flash ? 4 + Math.min(8, e.echo * 2) : 2,
            color,
            170 + e.echo * 35,
            angle,
            angle === undefined ? undefined : 1.6,
          );
          if (flash) {
            this.add({
              x: e.x,
              y: hy,
              z: AIR,
              color,
              shape: 'glow',
              size: 12 + Math.min(14, e.echo * 3),
              max: 0.16,
              drag: 0,
            });
            if (e.echo >= 2) {
              this.add({
                x: e.x,
                y: hy,
                z: AIR + 4,
                color: '#ffffff',
                shape: 'star',
                size: 7 + e.echo,
                max: 0.2,
                additive: true,
                vr: 4,
              });
            }
          }
          if (e.echo >= 3 && flash) {
            this.ring(e.x, hy, 6, 20 + e.echo * 5, color, 0.28, 3);
            this.light(e.x, e.y, 70 + e.echo * 12, color, 0.35 + e.echo * 0.04, 0.3);
          }
          if (this.options.damageNumbers && e.amount >= 1) {
            const size = e.echo > 0 ? 15 + Math.min(9, e.echo * 2) : 13;
            const textColor =
              e.team === 0 ? (e.echo > 0 ? echoColor(e.echo) : '#fff8ea') : '#ff9a8a';
            this.floatNumber(e.targetId, e.x, e.y - 28, e.amount, textColor, size);
          }
          if (e.echo >= 4) {
            this.hitstop = Math.max(this.hitstop, 0.07);
            this.shake(0.12);
          }
          if (e.killed) this.sparks(e.x, hy, 6, '#ffffff', 220);
          break;
        }
        case 'block':
          this.sparks(e.x, e.y - AIR, 7, e.team === 0 ? '#c9f6ff' : '#f0dcff', 200);
          if (this.canFlash(e.x, e.y - AIR)) {
            this.add({
              x: e.x,
              y: e.y - AIR,
              z: AIR,
              color: e.team === 0 ? '#9fe8ff' : '#e0c4ff',
              shape: 'glow',
              size: 16,
              max: 0.16,
              drag: 0,
            });
          }
          this.ring(e.x, e.y - AIR, 3, 16, '#ffffff', 0.18, 2);
          break;
        case 'reflect': {
          const color = e.team === 0 ? echoColor(e.echo) : PALETTE.enemyShot;
          const y = e.y - AIR;
          this.ring(e.x, y, 4, 30, color, 0.3, 3);
          if (this.canFlash(e.x, y))
            this.add({ x: e.x, y, z: AIR, color, shape: 'glow', size: 24, max: 0.2, drag: 0 });
          this.sparks(e.x, y, 9, color, 240);
          this.burstRays(e.x, y, 34 + e.echo * 4, color, 6, 0.24);
          this.light(e.x, e.y, 110, color, 0.55, 0.35);
          break;
        }
        case 'ricochet': {
          const color = echoColor(e.echo);
          this.bolt(
            e.x1,
            e.y1 - AIR,
            e.x2,
            e.y2 - AIR,
            color,
            2.6 + Math.min(3, e.echo * 0.4),
            0.32,
          );
          if (this.canFlash(e.x1, e.y1 - AIR)) {
            this.add({
              x: e.x1,
              y: e.y1 - AIR,
              z: AIR,
              color,
              shape: 'glow',
              size: 16,
              max: 0.18,
              drag: 0,
            });
          }
          this.sparks(e.x1, e.y1 - AIR, 5, color, 180);
          this.light(e.x1, e.y1, 80, color, 0.35, 0.25);
          break;
        }
        case 'bounce': {
          const color = echoColor(e.echo);
          this.ring(e.x, e.y - AIR, 2, 18, color, 0.25, 2.5);
          this.sparks(e.x, e.y - AIR, 6, color, 190);
          if (this.canFlash(e.x, e.y - AIR)) {
            this.add({
              x: e.x,
              y: e.y - AIR,
              z: AIR,
              color,
              shape: 'glow',
              size: 14,
              max: 0.14,
              drag: 0,
            });
          }
          break;
        }
        case 'fizzle':
          this.burst(e.x, e.y - AIR, 3, 'rgba(210, 200, 190, 1)', 40, {
            shape: 'smoke',
            additive: false,
            size: 5,
            grow: 1.8,
            max: 0.4,
          });
          break;
        case 'redirect': {
          const color = echoColor(e.echo);
          this.ring(e.x, e.y - AIR, 6, 36, color, 0.35, 3);
          this.burstRays(e.x, e.y - AIR, 44, '#ffffff', 8, 0.28);
          this.sparks(e.x, e.y - AIR, 8, '#ffffff', 200);
          this.light(e.x, e.y, 120, '#bff4ff', 0.6, 0.35);
          break;
        }
        case 'impact': {
          this.dust(e.x, e.y + 6, e.damaging ? 6 : 3);
          if (e.damaging) {
            const color = echoColor(e.echo);
            this.ring(e.x, e.y, 6, 34, color, 0.3, 4);
            this.ring(e.x, e.y, 8, 46, color, 0.35, 16, true, true);
            this.sparks(e.x, e.y - 6, 9, color, 240);
            this.add({
              x: e.x,
              y: e.y - 6,
              z: AIR,
              color: '#ffffff',
              shape: 'star',
              size: 10,
              max: 0.2,
              vr: 5,
            });
            this.light(e.x, e.y, 100, color, 0.45, 0.3);
            this.shake(Math.min(0.25, e.strength / 2400));
          } else {
            this.burst(e.x, e.y, 4, '#e9dcc0', 110, { drag: 5, size: 2.5 });
          }
          break;
        }
        case 'spring':
          this.ring(e.x, e.y, 14, 44, '#ff8fb1', 0.32, 3);
          this.ring(e.x, e.y, 10, 30, '#ffd6e3', 0.24, 2);
          this.twinkles(e.x, e.y - 10, 4, '#ffd6e3', 30, 70);
          break;
        case 'explode': {
          const ally = e.team === 0;
          const accent = ally ? echoColor(Math.max(1, e.echo)) : '#ff7b3a';
          this.fireball(e.x, e.y, e.radius, accent, ally ? 1 : 0.9);
          this.shake(0.28);
          if (e.echo >= 3) this.hitstop = Math.max(this.hitstop, 0.06);
          break;
        }
        case 'echo':
          this.echoBurst(e.x, e.y, e.level, e.chain);
          break;
        case 'heal':
          if (Math.hypot(e.x - e.fromX, e.y - e.fromY) > 30) {
            this.bolt(e.fromX, e.fromY - 14, e.x, e.y - 14, PALETTE.heal, 3, 0.45, true);
          }
          this.add({
            x: e.x,
            y: e.y - 16,
            z: AIR,
            color: PALETTE.heal,
            shape: 'glow',
            size: 20,
            max: 0.35,
            drag: 0,
          });
          this.burst(e.x, e.y - 10, 4, PALETTE.heal, 50, {
            shape: this.rand() > 0.5 ? 'plus' : 'heart',
            z: AIR,
            vz: 70,
            gravity: -30,
            additive: false,
            size: 4,
            max: 0.8,
          });
          if (this.options.damageNumbers && e.amount >= 1) {
            this.floatNumber(-e.targetId, e.x, e.y - 32, e.amount, PALETTE.heal, 13, '+');
          }
          break;
        case 'pulse':
          if (e.kind === 'heal') {
            this.ring(e.x, e.y, 10, e.radius, PALETTE.heal, 0.55, e.radius * 0.18, true, true);
            this.ring(e.x, e.y, 10, e.radius, PALETTE.heal, 0.5, 3);
            this.twinkles(e.x, e.y, 10, '#ffe0ea', e.radius * 1.2, 60);
            this.light(e.x, e.y, e.radius * 1.2, PALETTE.heal, 0.45, 0.6);
          } else if (e.kind === 'magnet') {
            this.ring(e.x, e.y, e.radius, 20, PALETTE.magnet, 0.5, 4);
            this.ring(
              e.x,
              e.y,
              e.radius * 0.9,
              30,
              PALETTE.magnet,
              0.45,
              e.radius * 0.2,
              true,
              true,
            );
            const total = this.n(14);
            for (let i = 0; i < total; i++) {
              const a = (i / total) * Math.PI * 2;
              this.add({
                x: e.x + Math.cos(a) * e.radius,
                y: e.y + Math.sin(a) * e.radius,
                z: AIR,
                vx: -Math.cos(a) * e.radius * 2.2,
                vy: -Math.sin(a) * e.radius * 2.2,
                drag: 2.5,
                color: PALETTE.magnet,
                shape: 'glow',
                size: 6,
                max: 0.4,
              });
            }
            this.light(e.x, e.y, e.radius, PALETTE.magnet, 0.4, 0.5);
          } else {
            this.ring(e.x, e.y, 10, e.radius, PALETTE.taunt, 0.45, 4);
            this.ring(e.x, e.y, 10, e.radius * 0.7, PALETTE.taunt, 0.35, 3);
            this.ring(e.x, e.y, 10, e.radius, PALETTE.taunt, 0.5, e.radius * 0.15, true, true);
            this.text(e.x, e.y - 54, '挑衅！', '#ffb4a8', 16, 0.9, -30);
          }
          break;
        case 'death': {
          const colors = DEBRIS[e.kind] ?? ['#ffffff'];
          this.debris(e.x, e.y - 10, 10, colors, 220);
          this.dust(e.x, e.y, 6, 'rgba(244, 236, 220, 1)', 80);
          this.twinkles(e.x, e.y - 14, 5, '#fff1b8', 34, 70);
          this.light(e.x, e.y, 90, '#fff1d6', 0.3, 0.35);
          if (e.kind === 'king') {
            this.fireball(e.x, e.y - 20, 150, '#f2c94c', 1.6);
            this.fireball(e.x - 50, e.y + 10, 90, '#c77dff', 0.8);
            this.fireball(e.x + 55, e.y - 5, 90, '#5fe0f2', 0.8);
            this.debris(e.x, e.y - 20, 14, ['#f2c44f', '#e4ae47', '#8a5cc2'], 320);
            this.ring(e.x, e.y, 20, 220, '#f2c94c', 0.8, 6);
            this.shake(0.6);
          }
          break;
        }
        case 'spawn': {
          const ally = unitOf(e.unitId)?.team === 0;
          const color = ally ? '#9fe8ff' : '#ff9a8a';
          this.ring(e.x, e.y + 8, 30, 8, color, 0.4, 3, true);
          this.ring(e.x, e.y + 8, 6, 40, color, 0.4, 10, true, true);
          this.dust(e.x, e.y + 8, 6);
          this.twinkles(e.x, e.y - 10, 4, color, 30, 60);
          break;
        }
        case 'melee': {
          const u = unitOf(e.unitId);
          const color = e.heavy ? '#ffb4a8' : '#fff6d8';
          if (u) {
            const angle = Math.atan2(e.y - u.y, e.x - u.x);
            this.swoosh(
              u.x,
              u.y - u.radius * 0.5,
              angle,
              u.radius * (e.heavy ? 2.2 : 1.7),
              color,
              e.heavy ? 12 : 8,
            );
          }
          this.sparks(e.x, e.y - 8, e.heavy ? 10 : 5, color, e.heavy ? 240 : 170);
          this.add({
            x: e.x,
            y: e.y - 8,
            z: AIR,
            color: '#ffffff',
            shape: 'star',
            size: e.heavy ? 11 : 7,
            max: 0.18,
            vr: 5,
          });
          if (e.heavy) {
            this.dust(e.x, e.y + 4, 5);
            this.ring(e.x, e.y, 8, 40, '#ffb4a8', 0.3, 12, true, true);
            this.light(e.x, e.y, 90, '#ffb4a8', 0.35, 0.3);
            this.shake(0.18);
          }
          break;
        }
        case 'cast': {
          const u = unitOf(e.unitId);
          const label =
            e.module === 'charge' ? '冲锋！' : e.module === 'pierce' ? '贯穿！' : '漩涡！';
          this.ring(e.x, e.y, 8, 40, '#ffe066', 0.35, 3);
          if (u) {
            this.text(u.x, u.y - 58, label, '#ffe066', 19, 0.9, -26);
            this.add({
              x: u.x,
              y: u.y - 14,
              z: AIR,
              color: '#ffe066',
              shape: 'glow',
              size: 30,
              max: 0.25,
              drag: 0,
            });
            this.light(u.x, u.y, 130, '#ffe066', 0.5, 0.4);
            if (e.module === 'charge') this.dust(u.x, u.y + 8, 8, 'rgba(236, 222, 196, 1)', 120);
            if (e.module === 'pierce') {
              this.burstRays(u.x, u.y - 14, 60, '#fff1b8', 10, 0.3);
              this.shake(0.12);
            }
          }
          if (e.module === 'vortex') {
            this.ring(e.x, e.y, 170, 20, '#9ad8ff', 0.45, 20, true, true);
            this.twinkles(e.x, e.y, 8, '#d6f0ff', 140, 40);
            this.light(e.x, e.y, 200, '#9ad8ff', 0.5, 0.6);
          }
          break;
        }
        case 'dashEnd':
          if (e.quake) {
            this.ring(e.x, e.y, 10, 135, '#ffe066', 0.45, 34, true, true);
            this.ring(e.x, e.y, 10, 130, '#ffe066', 0.4, 5);
            this.decal(e.x, e.y, 110, 'crack', '#ffd166');
            this.dust(e.x, e.y, 12, 'rgba(236, 222, 196, 1)', 200);
            this.debris(e.x, e.y, 8, ['#2f6d58', '#1f4c3e', '#3d8069'], 260);
            this.light(e.x, e.y, 220, '#ffe066', 0.7, 0.5);
            this.shake(0.3);
          }
          break;
        case 'vortexEnd':
          if (e.burst) {
            this.ring(e.x, e.y, 10, 150, '#9ad8ff', 0.45, 30, true, true);
            this.ring(e.x, e.y, 10, 140, '#d6f0ff', 0.4, 5);
            this.burst(e.x, e.y - AIR, 18, '#9ad8ff', 420, {
              shape: 'spark',
              drag: 3,
              size: 2.4,
              max: 0.4,
            });
            this.light(e.x, e.y, 240, '#9ad8ff', 0.5, 0.5);
            this.shake(0.25);
          }
          break;
        case 'lob':
          this.burst(e.x, e.y - 34, 4, 'rgba(120, 110, 120, 1)', 40, {
            shape: 'smoke',
            additive: false,
            size: 8,
            grow: 2,
            vz: 30,
            gravity: -20,
            max: 0.7,
          });
          this.add({
            x: e.x,
            y: e.y - 34,
            z: AIR,
            color: '#ffb347',
            shape: 'glow',
            size: 14,
            max: 0.12,
            drag: 0,
          });
          break;
        case 'lobLand':
          this.fireball(e.x, e.y, e.radius, '#ff9f43', 0.8);
          this.shake(0.2);
          break;
        case 'fuse': {
          const u = unitOf(e.unitId);
          if (u) this.sparks(u.x + 4, u.y - u.radius * 2.6, 6, '#ffd166', 160);
          break;
        }
        case 'phase': {
          const u = unitOf(e.unitId);
          this.text(
            600,
            170,
            e.phase === 2 ? '发条大王：援军！' : '发条大王：暴走！',
            '#f2c94c',
            28,
            1.6,
            -12,
          );
          this.shake(0.4);
          this.dim = 1;
          if (u) {
            this.ring(u.x, u.y, 20, 200, '#c77dff', 0.6, 40, true, true);
            this.debris(u.x, u.y - 30, 10, ['#f2c44f', '#e4ae47', '#fff1b8'], 280);
            this.light(u.x, u.y, 260, e.phase === 3 ? '#ff6b6b' : '#c77dff', 0.7, 0.8);
          }
          break;
        }
        case 'stunned':
          this.text(e.x, e.y - 76, '撞晕了！受到伤害提高', '#ffe066', 16, 1.4, -20);
          this.twinkles(e.x, e.y - 40, 8, '#ffe066', 80, 90);
          this.ring(e.x, e.y, 20, 120, '#ffe066', 0.4, 24, true, true);
          this.shake(0.45);
          break;
        case 'focus': {
          const u = e.unitId ? unitOf(e.unitId) : undefined;
          if (u)
            this.ring(
              u.x,
              u.y - u.radius * 0.5,
              u.radius * 3.2,
              u.radius * 1.6,
              PALETTE.focus,
              0.3,
              3,
            );
          break;
        }
        case 'end':
          if (e.result === 'win') this.confetti();
          break;
        default:
          break;
      }
    }
  }

  /** 回响：光圈随等级变大；3 级起地面亮起、电光噼啪；5 级起放射光芒。标注规则见 echoLabel。 */
  private echoBurst(x: number, y: number, level: number, chain: number): void {
    const color = echoColor(level);
    const cy = y - AIR;
    this.ring(x, cy, 4, 18 + level * 5, color, 0.32, 2.5 + level * 0.25);
    if (level >= 2) this.twinkles(x, y, 2 + level, color, 30 + level * 6, 60);
    if (level >= 3) {
      this.light(x, y, 80 + level * 16, color, 0.3 + level * 0.05, 0.35);
      const arcs = Math.min(4, level - 1);
      for (let i = 0; i < arcs; i++) {
        const a = this.rand() * Math.PI * 2;
        const len = 22 + level * 5;
        this.bolt(x, cy, x + Math.cos(a) * len, cy + Math.sin(a) * len * 0.8, color, 1.6, 0.18);
      }
    }
    if (level >= 4) this.ring(x, y, 10, 40 + level * 8, color, 0.35, 12 + level * 2, true, true);
    if (level >= 5) {
      this.burstRays(x, cy, 50 + level * 8, color, 8 + level, 0.34);
      this.shake(0.08);
    }
    this.echoLabel(x, y, level, chain);
  }

  /** 回响标注：1 级只画光圈；2 级起标出等级。同一条链只在等级提升时标一次，并与附近文字错开。 */
  private echoLabel(x: number, y: number, level: number, chain: number): void {
    const color = echoColor(level);
    const shown = this.echoShown.get(chain) ?? 0;
    if (level <= shown || level < 2) return;
    this.echoShown.set(chain, level);
    if (this.echoShown.size > 400) this.echoShown.clear();
    // 附近已有较新的回响标注时合并：只保留等级最高的那个，避免同一波齐射刷出一串文字。
    const near = this.texts.find(
      (t) => t.echo > 0 && t.life < t.max * 0.6 && Math.hypot(t.x - x, t.y - (y - 44)) < 120,
    );
    const size = 16 + Math.min(14, level * 2.2);
    if (near) {
      if (level <= near.echo) return;
      near.echo = level;
      near.text = `回响 ×${level}`;
      near.color = color;
      near.size = size;
      near.life = Math.min(near.life, 0.12);
      return;
    }
    const label = `回响 ×${level}`;
    const top = this.freeY(x, y - 44, size * 3.6, size);
    this.text(x, top, label, color, size, 1 + level * 0.06, -30, level);
  }

  /** 开战的一瞬间：每个单位脚下荡开一圈队伍色的光。 */
  battleStart(world: World): void {
    for (const u of world.units) {
      if (!u.alive) continue;
      const color = u.team === 0 ? '#8fe6ff' : '#ff9a8a';
      this.ring(
        u.x,
        u.y + u.radius * 0.8,
        u.radius,
        u.radius * 3,
        color,
        0.6,
        u.radius * 0.8,
        true,
        true,
      );
      this.dust(u.x, u.y + u.radius * 0.8, 2);
    }
  }

  /** 胜利时从场地上方撒下彩纸。 */
  private confetti(): void {
    const total = this.n(70);
    for (let i = 0; i < total; i++) {
      this.add({
        x: this.range(80, 1120),
        y: this.range(40, 560),
        z: this.range(200, 380),
        vx: (this.rand() - 0.5) * 60,
        vy: (this.rand() - 0.5) * 20,
        vz: this.range(-30, 40),
        gravity: 120,
        drag: 0.8,
        shape: 'confetti',
        additive: false,
        color: this.pick(CONFETTI),
        size: this.range(3, 5),
        vr: (this.rand() - 0.5) * 14,
        max: this.range(2.2, 3.2),
      });
    }
  }

  // ---- 持续的特效（每帧按场上状态补充） ----

  /** dt 是模拟时间（暂停时为 0，不会补充）。 */
  emit(world: World, dt: number): void {
    if (dt <= 0) return;
    const q = this.quality;
    const chance = (rate: number) => this.rand() < rate * dt * q;
    for (const v of world.vortexes) {
      // 漩涡把光点从外圈卷向中心
      const count = Math.floor(60 * dt * q + this.rand());
      for (let i = 0; i < count; i++) {
        const a = this.rand() * Math.PI * 2;
        const r = v.r * this.range(0.7, 1.05);
        const inward = 2.2;
        this.add({
          x: v.x + Math.cos(a) * r,
          y: v.y + Math.sin(a) * r,
          z: AIR,
          vx: -Math.cos(a) * r * inward + -Math.sin(a) * r * 2.4,
          vy: -Math.sin(a) * r * inward + Math.cos(a) * r * 2.4,
          drag: 2.4,
          color: this.rand() > 0.3 ? '#9ad8ff' : '#ffffff',
          shape: 'glow',
          size: this.range(3, 6),
          max: 0.45,
        });
      }
    }
    for (const u of world.units) {
      if (!u.alive) continue;
      if (u.state === 'dash' || u.state === 'charge') {
        if (chance(40))
          this.dust(
            u.x - u.dashX * u.radius,
            u.y + u.radius * 0.7,
            1,
            'rgba(236, 222, 196, 1)',
            40,
          );
        if (chance(50)) {
          const side = (this.rand() - 0.5) * u.radius * 2.4;
          this.add({
            x: u.x - u.dashY * side,
            y: u.y - u.radius * 0.5 + u.dashX * side * 0.6,
            z: 0,
            vx: -u.dashX * 520,
            vy: -u.dashY * 520,
            drag: 5,
            shape: 'spark',
            color: u.team === 0 ? '#fff1b8' : '#ffb4a8',
            size: 1.4,
            max: 0.22,
          });
        }
      } else if (u.slide && chance(18)) {
        this.dust(u.x, u.y + u.radius * 0.7, 1, 'rgba(236, 222, 196, 1)', 25);
      }
      if (u.kind === 'bomber' && u.state === 'fuse' && chance(26)) {
        this.add({
          x: u.x + 4,
          y: u.y - u.radius * 2.4,
          z: AIR,
          vx: (this.rand() - 0.5) * 140,
          vy: -this.range(40, 120),
          vz: 80,
          gravity: 300,
          drag: 2,
          shape: 'spark',
          color: '#ffd166',
          size: 1.3,
          max: 0.3,
        });
      }
    }
    for (const p of world.projectiles) {
      if (!p.alive) continue;
      const hot = p.team === 0 ? p.echo : p.echo > 0 ? p.echo : 0;
      if (hot >= 2 && chance(10 + hot * 6)) {
        this.add({
          x: p.x + (this.rand() - 0.5) * 6,
          y: p.y - AIR + (this.rand() - 0.5) * 6,
          vx: (this.rand() - 0.5) * 40,
          vy: (this.rand() - 0.5) * 40,
          drag: 3,
          color: p.team === 0 ? echoColor(p.echo) : '#ff9f6b',
          shape: hot >= 4 ? 'star' : 'glow',
          size: this.range(2, 3.5),
          max: 0.35,
        });
      }
      if (p.kind === 'bigshot' && chance(70)) {
        const a = this.clock * 30;
        this.add({
          x: p.x + Math.cos(a) * 10,
          y: p.y - AIR + Math.sin(a) * 10,
          vx: -p.vx * 0.15,
          vy: -p.vy * 0.15,
          drag: 3,
          color: '#fff1b8',
          shape: 'glow',
          size: 5,
          max: 0.3,
        });
      }
    }
  }

  update(dt: number): void {
    this.clock += dt;
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i] as Particle;
      p.life += dt;
      if (p.life >= p.max) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity !== 0 || p.vz !== 0) {
        p.vz -= p.gravity * dt;
        p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          if (p.bounce && p.vz < -60) {
            p.vz = -p.vz * 0.4;
            p.vx *= 0.6;
            p.vy *= 0.6;
            p.vr *= 0.6;
          } else {
            p.vz = 0;
            if (p.bounce) {
              p.vx *= 0.9;
              p.vy *= 0.9;
              p.vr *= 0.9;
            }
          }
        }
      }
      p.rot += p.vr * dt;
      ps[w++] = p;
    }
    ps.length = w;
    const age = <T extends { life: number; max: number }>(list: T[]) => {
      for (const item of list) item.life += dt;
      return list.filter((item) => item.life < item.max);
    };
    this.rings = age(this.rings);
    this.bolts = age(this.bolts);
    this.lights = age(this.lights);
    this.decals = age(this.decals);
    this.swooshes = age(this.swooshes);
    this.rays = age(this.rays);
    for (const t of this.texts) {
      t.life += dt;
      t.age += dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.5 * dt);
    }
    this.texts = this.texts.filter((t) => t.life < t.max);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.dim = Math.max(0, this.dim - dt * 1.2);
    this.updateMotes(dt);
  }

  /** 台灯光里慢慢飘的浮尘。 */
  private updateMotes(dt: number): void {
    if (this.motes.length === 0) {
      for (let i = 0; i < 26; i++) {
        this.motes.push({
          x: this.range(0, 1200),
          y: this.range(0, 660),
          vx: this.range(-6, 6),
          vy: this.range(-5, 2),
          size: this.range(0.8, 2),
          phase: this.rand() * 6.28,
        });
      }
    }
    for (const m of this.motes) {
      m.phase += dt;
      m.x += (m.vx + Math.sin(m.phase * 0.7) * 4) * dt;
      m.y += (m.vy + Math.cos(m.phase * 0.5) * 3) * dt;
      if (m.x < -10) m.x = 1210;
      if (m.x > 1210) m.x = -10;
      if (m.y < -10) m.y = 670;
      if (m.y > 670) m.y = -10;
    }
  }

  /** 当前震屏偏移（竞技场单位）。 */
  shakeOffset(time: number): { x: number; y: number } {
    if (this.trauma <= 0) return { x: 0, y: 0 };
    const k = this.trauma * this.trauma * 9;
    return { x: Math.sin(time * 71.3) * k, y: Math.cos(time * 57.1) * k };
  }

  // ---- 绘制 ----

  /** 地面层：焦痕、裂纹、地面光照、地面冲击波（画在单位下面）。 */
  drawFloor(ctx: CanvasRenderingContext2D): void {
    for (const d of this.decals) {
      const k = d.life / d.max;
      const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.globalAlpha = fade * 0.7;
      if (d.kind === 'scorch') {
        const img = scorchSprite();
        ctx.drawImage(img, -d.r, -d.r * 0.8, d.r * 2, d.r * 1.6);
      } else {
        this.drawCracks(ctx, d);
      }
      // 刚炸完的一两秒还在发烫
      const hot = Math.max(0, 1 - d.life / 1.4);
      if (hot > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = hot * 0.6;
        const g = glowSprite(d.hot);
        ctx.drawImage(g, -d.r * 0.7, -d.r * 0.55, d.r * 1.4, d.r * 1.1);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
    // 地面光照：爆炸、回响把毛毡照亮
    if (this.lights.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const l of this.lights) {
        const k = l.life / l.max;
        const a = l.power * (k < 0.08 ? k / 0.08 : Math.pow(1 - k, 1.6)) * 0.4;
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(glowSprite(l.color), l.x - l.r, l.y - l.r * 0.8, l.r * 2, l.r * 1.6);
      }
      ctx.restore();
    }
    for (const r of this.rings) if (r.floor) this.drawRing(ctx, r);
  }

  private drawCracks(ctx: CanvasRenderingContext2D, d: Decal): void {
    let s = d.seed;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    ctx.strokeStyle = 'rgba(14, 24, 18, 0.75)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 9; i++) {
      let a = (i / 9) * Math.PI * 2 + rand() * 0.5;
      let x = 0;
      let y = 0;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const len = d.r * (0.5 + rand() * 0.5);
      for (let j = 0; j < 4; j++) {
        a += (rand() - 0.5) * 0.7;
        x += Math.cos(a) * len * 0.25;
        y += Math.sin(a) * len * 0.25 * 0.8;
        ctx.lineTo(x, y);
      }
      ctx.lineWidth = 2.6 - i * 0.12;
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, d.r * 0.4);
    g.addColorStop(0, 'rgba(14, 24, 18, 0.5)');
    g.addColorStop(1, 'rgba(14, 24, 18, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, d.r * 0.4, d.r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 画面最底下的浮尘（在单位下、地面光之上）。 */
  drawMotes(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const img = glowSprite('rgba(255, 236, 190, 1)');
    for (const m of this.motes) {
      const tw = 0.5 + 0.5 * Math.sin(time * 1.3 + m.phase * 3);
      ctx.globalAlpha = 0.06 + tw * 0.1;
      const s = m.size * 2.6;
      ctx.drawImage(img, m.x - s, m.y - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  private drawRing(ctx: CanvasRenderingContext2D, r: Ring, glow?: CanvasRenderingContext2D): void {
    const k = r.life / r.max;
    const radius = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2.2));
    if (radius <= 0.5) return;
    const fade = (1 - k) * (this.options.reduceFlashes ? 0.7 : 1);
    if (r.soft) {
      // 柔和的冲击波：外沿亮、向内渐隐的一圈
      // 普通叠加：几道冲击波叠在一起也只是半透明的颜色，不会越叠越白。
      const inner = Math.max(0, radius - r.width * (1 - k * 0.5));
      const g = ctx.createRadialGradient(r.x, r.y, inner, r.x, r.y, radius);
      g.addColorStop(0, withAlpha(r.color, 0));
      g.addColorStop(0.75, withAlpha(r.color, 0.3 * fade));
      g.addColorStop(1, withAlpha(r.color, 0));
      ctx.save();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.globalAlpha = fade;
    circlePath(ctx, r.x, r.y, radius);
    ctx.lineWidth = r.width * (1 - k * 0.5);
    ctx.strokeStyle = r.color;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (glow) {
      glow.globalAlpha = fade;
      circlePath(glow, r.x, r.y, radius);
      glow.lineWidth = r.width * 2;
      glow.strokeStyle = r.color;
      glow.stroke();
      glow.globalAlpha = 1;
    }
  }

  private boltPoints(b: Bolt, time: number): Array<[number, number]> {
    const reduce = this.options.reduceFlashes;
    // 每 45 毫秒换一次折线，看起来噼啪作响；减少闪烁时保持不变。
    let s = Math.floor(b.seed + (reduce ? 0 : time / 0.045) * 7919) % 2147483647;
    if (s <= 0) s += 2147483646;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    const dx = b.x2 - b.x1;
    const dy = b.y2 - b.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const points: Array<[number, number]> = [];
    if (b.arc) {
      const lift = Math.min(60, len * 0.3);
      for (let i = 0; i <= 16; i++) {
        const k = i / 16;
        const h = Math.sin(k * Math.PI) * lift;
        points.push([b.x1 + dx * k, b.y1 + dy * k - h]);
      }
      return points;
    }
    const segs = Math.max(4, Math.min(14, Math.round(len / 18)));
    const jag = Math.min(16, len * 0.12);
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const off = i === 0 || i === segs ? 0 : (rand() - 0.5) * 2 * jag;
      points.push([b.x1 + dx * k + nx * off, b.y1 + dy * k + ny * off]);
    }
    return points;
  }

  private strokePoints(ctx: CanvasRenderingContext2D, points: Array<[number, number]>): void {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }

  /** 空中层：光圈、闪电、刀光、放射光芒、粒子（画在单位上面），同时往泛光层画一份。 */
  drawAir(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, time: number): boolean {
    let used = false;
    for (const r of this.rings) {
      if (r.floor) continue;
      this.drawRing(ctx, r, glow);
      used = true;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    glow.lineCap = 'round';
    glow.lineJoin = 'round';
    for (const b of this.bolts) {
      const k = b.life / b.max;
      const fade = 1 - k;
      const points = this.boltPoints(b, time);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fade * 0.35;
      ctx.lineWidth = b.width * 3.2;
      ctx.strokeStyle = b.color;
      this.strokePoints(ctx, points);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fade;
      ctx.lineWidth = b.width;
      ctx.strokeStyle = b.color;
      this.strokePoints(ctx, points);
      ctx.globalAlpha = fade * 0.9;
      ctx.lineWidth = Math.max(0.8, b.width * 0.35);
      ctx.strokeStyle = '#ffffff';
      this.strokePoints(ctx, points);
      glow.globalAlpha = fade;
      glow.lineWidth = b.width * 2.5;
      glow.strokeStyle = b.color;
      this.strokePoints(glow, points);
      used = true;
    }
    ctx.globalAlpha = 1;
    glow.globalAlpha = 1;
    for (const s of this.swooshes) {
      const k = s.life / s.max;
      const sweep = 1.9;
      const a0 = s.angle - sweep / 2;
      const a1 = a0 + sweep * Math.min(1, k * 2.2 + 0.25);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(1, 0.75);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, s.r, a0, a1);
      ctx.arc(
        -Math.cos(s.angle) * s.width * 0.6,
        -Math.sin(s.angle) * s.width * 0.6,
        s.r - s.width,
        a1,
        a0,
        true,
      );
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.restore();
      used = true;
    }
    for (const r of this.rays) {
      const k = r.life / r.max;
      let seed = r.seed;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.fillStyle = r.color;
      for (let i = 0; i < r.count; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        const a = (i / r.count) * Math.PI * 2 + (seed / 233280) * 0.6;
        const len = r.r * (0.6 + ((seed % 97) / 97) * 0.6) * (0.5 + k * 0.7);
        const wdt = 2.2 * (1 - k);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a + 1.57) * wdt, Math.sin(a + 1.57) * wdt);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.lineTo(Math.cos(a - 1.57) * wdt, Math.sin(a - 1.57) * wdt);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      glow.globalAlpha = (1 - k) * 0.6;
      glow.drawImage(glowSprite(r.color), r.x - r.r * 0.6, r.y - r.r * 0.6, r.r * 1.2, r.r * 1.2);
      glow.globalAlpha = 1;
      used = true;
    }
    if (this.drawParticles(ctx, glow)) used = true;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return used;
  }

  private drawParticles(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D): boolean {
    let used = false;
    for (const p of this.particles) {
      const k = p.life / p.max;
      const s = p.size * (1 + (p.grow - 1) * k);
      const x = p.x;
      const y = p.y - p.z;
      let a = 1 - k;
      switch (p.shape) {
        case 'smoke':
          a = Math.sin(Math.min(1, k) * Math.PI) * 0.6;
          break;
        case 'glow':
          a = Math.pow(1 - k, 1.4) * 0.75;
          break;
        case 'fire':
          a = k > 0.6 ? (1 - k) / 0.4 : 0.92;
          break;
        case 'ember':
          a = (1 - k) * (0.65 + 0.35 * Math.sin(p.life * 17 + p.rot * 5));
          break;
        case 'debris':
        case 'shard':
          a = k > 0.7 ? (1 - k) / 0.3 : 1;
          break;
        case 'confetti':
          a = k > 0.8 ? (1 - k) / 0.2 : 1;
          break;
        default:
          break;
      }
      a *= p.opacity;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      switch (p.shape) {
        case 'fire': {
          const grow = 1 + (p.grow - 1) * (1 - Math.pow(1 - k, 2));
          this.drawFire(ctx, x, y, p.size * grow, k);
          break;
        }
        case 'glow':
        case 'ember': {
          const img = glowSprite(p.color);
          const r = p.shape === 'ember' ? s * 3 : s;
          ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
          glow.globalAlpha = a * 0.5;
          glow.drawImage(img, x - r, y - r, r * 2, r * 2);
          used = true;
          break;
        }
        case 'spark': {
          const len = Math.min(26, Math.hypot(p.vx, p.vy - p.vz) * 0.035 + 2);
          const sp = Math.hypot(p.vx, p.vy - p.vz) || 1;
          const ux = p.vx / sp;
          const uy = (p.vy - p.vz) / sp;
          ctx.lineCap = 'round';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = s;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - ux * len, y - uy * len);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = s * 0.45;
          ctx.stroke();
          glow.globalAlpha = a;
          glow.strokeStyle = p.color;
          glow.lineWidth = s * 2.2;
          glow.beginPath();
          glow.moveTo(x, y);
          glow.lineTo(x - ux * len, y - uy * len);
          glow.stroke();
          used = true;
          break;
        }
        case 'smoke': {
          const img = smokeSprite(p.color);
          ctx.drawImage(img, x - s, y - s, s * 2, s * 2);
          break;
        }
        case 'debris': {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(36, 26, 31, 0.8)';
          ctx.strokeRect(-s, -s * 0.6, s * 2, s * 1.2);
          ctx.restore();
          break;
        }
        case 'shard': {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(-s, s * 0.7);
          ctx.lineTo(s * 1.1, s * 0.4);
          ctx.lineTo(-s * 0.2, -s);
          ctx.closePath();
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(36, 26, 31, 0.8)';
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'star':
          starPath(ctx, x, y, 4, s * 1.6, s * 0.45, p.rot);
          ctx.fillStyle = p.color;
          ctx.fill();
          if (p.additive) {
            glow.globalAlpha = a;
            glow.drawImage(glowSprite(p.color), x - s * 2, y - s * 2, s * 4, s * 4);
            used = true;
          }
          break;
        case 'plus':
          ctx.fillStyle = p.color;
          ctx.fillRect(x - s, y - s * 0.32, s * 2, s * 0.64);
          ctx.fillRect(x - s * 0.32, y - s, s * 0.64, s * 2);
          break;
        case 'heart':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(x, y + s * 0.8);
          ctx.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.3, x, y - s * 0.5);
          ctx.bezierCurveTo(x + s * 0.6, y - s * 1.3, x + s * 1.4, y - s * 0.2, x, y + s * 0.8);
          ctx.fill();
          break;
        case 'confetti': {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot * 0.5);
          ctx.scale(Math.cos(p.rot * 1.7), 1);
          ctx.fillStyle = p.color;
          ctx.fillRect(-s, -s * 0.5, s * 2, s);
          ctx.restore();
          break;
        }
        default:
          circlePath(ctx, x, y, s);
          ctx.fillStyle = p.color;
          ctx.fill();
          break;
      }
    }
    glow.globalAlpha = 1;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return used;
  }

  private textSize(t: FloatText): { size: number; alpha: number } {
    const k = t.life / t.max;
    const pop = k < 0.15 ? 0.7 + (k / 0.15) * 0.45 : 1.15 - Math.min(0.15, (k - 0.15) * 0.4);
    return { size: Math.round(t.size * pop), alpha: k > 0.7 ? (1 - k) / 0.3 : 1 };
  }

  /** 回响标注在泛光层的光晕。 */
  drawTextGlow(glow: CanvasRenderingContext2D, font: string): void {
    glow.textAlign = 'center';
    glow.textBaseline = 'middle';
    for (const t of this.texts) {
      if (t.echo <= 0) continue;
      const { size, alpha } = this.textSize(t);
      glow.globalAlpha = alpha * 0.45;
      glow.font = `900 ${size}px ${font}`;
      glow.fillStyle = t.color;
      glow.fillText(t.text, t.x, t.y);
    }
    glow.globalAlpha = 1;
  }

  /** 卡通火云：受光的一侧亮、背光的一侧暗，颜色随时间从黄变红再变成烟。 */
  private drawFire(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number) {
    const [light, dark] = fireColors(k);
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, light);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 文字：伤害数字与回响标注。回响标注是白到回响色的渐变，等级越高越大。 */
  drawTexts(ctx: CanvasRenderingContext2D, font: string): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const { size, alpha } = this.textSize(t);
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${size}px ${font}`;
      ctx.lineWidth = t.echo > 0 ? 5.5 : 4;
      ctx.strokeStyle = 'rgba(28, 18, 22, 0.9)';
      ctx.strokeText(t.text, t.x, t.y);
      if (t.echo > 0) {
        const g = ctx.createLinearGradient(0, t.y - size / 2, 0, t.y + size / 2);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.55, t.color);
        g.addColorStop(1, t.color);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = t.color;
      }
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
