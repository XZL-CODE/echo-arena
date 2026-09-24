// 特效：把模拟事件变成粒子、光环、轨迹与文字。只负责表现，不影响规则。
import type { SimEvent } from '../core/sim/events.js';
import type { UnitKind } from '../core/types.js';
import { echoColor, PALETTE } from './palette.js';
import { circlePath, starPath } from './shapes.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  shape: 'dot' | 'rect' | 'star' | 'plus';
  rot: number;
  vr: number;
  gravity: number;
  drag: number;
  additive: boolean;
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
  fill: number;
}

interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
  width: number;
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

const MAX_PARTICLES = 700;
const MAX_TEXTS = 40;

const DEBRIS: Partial<Record<UnitKind, string[]>> = {
  guard: ['#b9cee0', '#7f9ab2', '#e8b04a'],
  slinger: ['#ffe27a', '#f6b93b', '#ff8c42'],
  bell: ['#ffe89a', '#e2a42c', '#e76f51'],
  archer: ['#e9c08e', '#8c4d7c', '#b07a4c'],
  shell: ['#b183c9', '#6b3f86', '#ff8a7a'],
  mouse: ['#c9bddb', '#8d7fa8', '#ffb3c7'],
  bomber: ['#6d4077', '#ffae42', '#ff5e3a'],
  snail: ['#d9b8d1', '#f3e3c3', '#ff6f91'],
  brute: ['#a0705a', '#7b3f6e', '#d9b08c'],
  mirror: ['#eef3f7', '#9aa8b5', '#c77dff'],
  mortar: ['#a86fae', '#4a4458', '#ffae42'],
  jack: ['#d46a9f', '#ffffff', '#e8b04a'],
  king: ['#8a5cc2', '#f2c94c', '#7ee8fa'],
};

export interface FxOptions {
  damageNumbers: boolean;
  screenShake: boolean;
  reduceFlashes: boolean;
}

export class Fx {
  particles: Particle[] = [];
  rings: Ring[] = [];
  beams: Beam[] = [];
  texts: FloatText[] = [];
  /** 震屏强度 0..1。 */
  trauma = 0;
  /** 顿帧：剩余时间（秒），期间游戏放慢。 */
  hitstop = 0;
  options: FxOptions = { damageNumbers: true, screenShake: true, reduceFlashes: false };
  private echoShown = new Map<number, number>();
  private seed = 1;

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.beams = [];
    this.texts = [];
    this.trauma = 0;
    this.hitstop = 0;
    this.echoShown.clear();
  }

  private rand(): number {
    // 表现层的随机不需要可复现，但用自带序列避免与规则层共享随机源。
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  shake(amount: number): void {
    if (!this.options.screenShake) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  burst(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    options: Partial<Particle> = {},
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = this.rand() * Math.PI * 2;
      const s = speed * (0.4 + this.rand() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.35 + this.rand() * 0.35,
        size: 2 + this.rand() * 2.5,
        color,
        shape: 'dot',
        rot: this.rand() * 6,
        vr: (this.rand() - 0.5) * 12,
        gravity: 0,
        drag: 3,
        additive: true,
        ...options,
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
    fill = 0,
  ): void {
    if (this.rings.length > 90) this.rings.shift();
    this.rings.push({ x, y, r0, r1, life: 0, max, color, width, fill });
  }

  beam(x1: number, y1: number, x2: number, y2: number, color: string, width = 3, max = 0.3): void {
    if (this.beams.length > 70) this.beams.shift();
    this.beams.push({ x1, y1, x2, y2, life: 0, max, color, width });
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
        recent.size = Math.min(26, size + 1);
        recent.color = color;
      } else {
        recent.size = Math.min(26, recent.size + 0.5);
      }
      return;
    }
    const jx = x + (this.rand() - 0.5) * 14;
    const text = prefix + String(Math.round(amount));
    const t = this.text(jx, this.freeY(jx, y), text, color, size, 0.75, -44);
    t.target = key;
    t.amount = amount;
  }

  /** 新数字若压在附近刚出现的文字上，就依次往上错开，连环爆炸时数字不叠成一团。 */
  private freeY(x: number, y: number): number {
    let top = y;
    for (let pass = 0; pass < 4; pass++) {
      const hit = this.texts.find(
        (t) => t.life < 0.35 && Math.abs(t.x - x) < 30 && Math.abs(t.y - top) < 15,
      );
      if (!hit) break;
      top = hit.y - 17;
    }
    return top;
  }

  /** 把一批模拟事件转换成特效。 */
  handle(events: readonly SimEvent[], unitKindOf: (id: number) => UnitKind | undefined): void {
    for (const e of events) {
      switch (e.type) {
        case 'shoot':
          this.ring(
            e.x + Math.cos(e.angle) * 18,
            e.y + Math.sin(e.angle) * 18,
            2,
            e.big ? 22 : 9,
            '#fff6d8',
            0.18,
            2,
          );
          if (e.big) this.shake(0.12);
          break;
        case 'hit': {
          const color =
            e.team === 0 ? (e.echo > 0 ? echoColor(e.echo) : '#fff6d8') : PALETTE.enemyShot;
          this.burst(e.x, e.y - 8, 3 + Math.min(6, e.echo * 2), color, 120 + e.echo * 30);
          if (this.options.damageNumbers && e.amount >= 1) {
            const size = e.echo > 0 ? 15 + Math.min(8, e.echo * 2) : 13;
            const textColor =
              e.team === 0 ? (e.echo > 0 ? echoColor(e.echo) : '#fff8ea') : '#ff9a8a';
            this.floatNumber(e.targetId, e.x, e.y - 26, e.amount, textColor, size);
          }
          if (e.echo >= 4) {
            this.hitstop = Math.max(this.hitstop, 0.07);
            this.shake(0.12);
          }
          break;
        }
        case 'block':
          this.burst(e.x, e.y, 5, '#ffffff', 160, { max: 0.25, size: 2 });
          break;
        case 'reflect':
          this.ring(e.x, e.y, 4, 26, e.team === 0 ? echoColor(e.echo) : PALETTE.enemyShot, 0.3, 3);
          this.burst(e.x, e.y, 6, e.team === 0 ? echoColor(e.echo) : PALETTE.enemyShot, 180);
          break;
        case 'ricochet':
          this.beam(e.x1, e.y1 - 8, e.x2, e.y2 - 8, echoColor(e.echo), 3, 0.32);
          break;
        case 'bounce':
          this.ring(e.x, e.y, 2, 16, echoColor(e.echo), 0.25, 2.5);
          break;
        case 'redirect':
          this.ring(e.x, e.y, 6, 34, echoColor(e.echo), 0.35, 3);
          this.burst(e.x, e.y, 8, '#ffffff', 160);
          break;
        case 'impact':
          this.burst(
            e.x,
            e.y,
            e.damaging ? 8 : 4,
            e.damaging ? echoColor(e.echo) : '#e9dcc0',
            e.damaging ? 200 : 110,
            {
              additive: e.damaging,
              drag: 5,
            },
          );
          if (e.damaging) {
            this.ring(e.x, e.y, 6, 30, echoColor(e.echo), 0.3, 4);
            this.shake(Math.min(0.25, e.strength / 2400));
          }
          break;
        case 'spring':
          this.ring(e.x, e.y, 16, 40, '#ff8fb1', 0.3, 3);
          break;
        case 'explode': {
          const color = e.team === 0 ? echoColor(Math.max(1, e.echo)) : '#ff7b3a';
          this.ring(e.x, e.y, e.radius * 0.2, e.radius, color, 0.4, 5, 0.25);
          this.burst(e.x, e.y, 16, color, 260, { max: 0.55 });
          this.burst(e.x, e.y, 8, '#3a2a2a', 150, {
            additive: false,
            shape: 'rect',
            gravity: 300,
            max: 0.7,
          });
          this.shake(0.28);
          if (e.echo >= 3) this.hitstop = Math.max(this.hitstop, 0.06);
          break;
        }
        case 'echo':
          this.echoLabel(e.x, e.y, e.level, e.chain);
          break;
        case 'heal':
          if (Math.hypot(e.x - e.fromX, e.y - e.fromY) > 30) {
            this.beam(e.fromX, e.fromY - 12, e.x, e.y - 12, PALETTE.heal, 3, 0.4);
          }
          this.burst(e.x, e.y - 10, 4, PALETTE.heal, 60, {
            shape: 'plus',
            gravity: -80,
            additive: false,
            max: 0.7,
          });
          if (this.options.damageNumbers && e.amount >= 1) {
            this.floatNumber(-e.targetId, e.x, e.y - 30, e.amount, PALETTE.heal, 13, '+');
          }
          break;
        case 'pulse':
          if (e.kind === 'heal') this.ring(e.x, e.y, 10, e.radius, PALETTE.heal, 0.55, 3, 0.08);
          else if (e.kind === 'magnet')
            this.ring(e.x, e.y, e.radius, 20, PALETTE.magnet, 0.5, 4, 0.06);
          else {
            this.ring(e.x, e.y, 10, e.radius, PALETTE.taunt, 0.45, 4, 0.05);
            this.text(e.x, e.y - 50, '挑衅！', '#ffb4a8', 15, 0.9, -30);
          }
          break;
        case 'death': {
          const colors = DEBRIS[e.kind] ?? ['#ffffff'];
          for (let i = 0; i < 9; i++) {
            this.burst(e.x, e.y - 10, 1, colors[i % colors.length] as string, 240, {
              shape: i % 3 === 0 ? 'rect' : 'dot',
              size: 3 + this.rand() * 3,
              gravity: 520,
              drag: 1.2,
              additive: false,
              max: 0.9,
            });
          }
          this.burst(e.x, e.y, 6, 'rgba(240,230,210,0.8)', 70, {
            additive: false,
            size: 6,
            max: 0.5,
            drag: 4,
          });
          if (e.kind === 'king') {
            this.shake(0.6);
            this.ring(e.x, e.y, 20, 180, '#f2c94c', 0.8, 6, 0.15);
          }
          break;
        }
        case 'spawn':
          this.burst(e.x, e.y, 8, 'rgba(240,230,210,0.9)', 90, {
            additive: false,
            size: 5,
            max: 0.45,
          });
          break;
        case 'melee':
          this.burst(e.x, e.y - 8, e.heavy ? 10 : 4, '#fff6d8', e.heavy ? 220 : 140, {
            shape: 'star',
            size: 4,
          });
          if (e.heavy) this.shake(0.18);
          break;
        case 'cast': {
          const kind = unitKindOf(e.unitId);
          const label =
            e.module === 'charge' ? '冲锋！' : e.module === 'pierce' ? '贯穿！' : '漩涡！';
          this.ring(e.x, e.y, 8, 36, '#ffe066', 0.35, 3);
          if (kind) this.text(e.x, e.y - 40, label, '#ffe066', 18, 0.8, -26);
          break;
        }
        case 'dashEnd':
          if (e.quake) {
            this.ring(e.x, e.y, 10, 130, '#ffe066', 0.4, 5, 0.1);
            this.shake(0.3);
          }
          break;
        case 'vortexEnd':
          if (e.burst) {
            this.ring(e.x, e.y, 10, 140, '#9ad8ff', 0.4, 5, 0.12);
            this.shake(0.25);
          }
          break;
        case 'lobLand':
          this.ring(e.x, e.y, 10, e.radius, '#ff9f43', 0.35, 5, 0.2);
          this.burst(e.x, e.y, 12, '#ff9f43', 220);
          this.shake(0.2);
          break;
        case 'phase':
          this.text(
            600,
            170,
            e.phase === 2 ? '发条大王：援军！' : '发条大王：暴走！',
            '#f2c94c',
            26,
            1.6,
            -12,
          );
          this.shake(0.4);
          break;
        case 'stunned':
          this.text(e.x, e.y - 70, '撞晕了！受到伤害提高', '#ffe066', 16, 1.4, -20);
          this.shake(0.45);
          break;
        case 'focus':
          break;
        default:
          break;
      }
    }
  }

  /** 回响标注：1 级只画光圈；2 级起标出等级。同一条链只在等级提升时标一次，并与附近文字错开。 */
  private echoLabel(x: number, y: number, level: number, chain: number): void {
    const color = echoColor(level);
    this.ring(x, y, 4, 18 + level * 4, color, 0.3, 2.5);
    const shown = this.echoShown.get(chain) ?? 0;
    if (level <= shown || level < 2) return;
    this.echoShown.set(chain, level);
    if (this.echoShown.size > 400) this.echoShown.clear();
    // 附近已有较新的回响标注时合并：只保留等级最高的那个，避免同一波齐射刷出一串文字。
    const near = this.texts.find(
      (t) => t.echo > 0 && t.life < t.max * 0.6 && Math.hypot(t.x - x, t.y - (y - 40)) < 120,
    );
    const size = 15 + Math.min(12, level * 2);
    if (near) {
      if (level <= near.echo) return;
      near.echo = level;
      near.text = `回响 ×${level}`;
      near.color = color;
      near.size = size;
      near.life = Math.min(near.life, 0.12);
      return;
    }
    this.text(x, y - 40, `回响 ×${level}`, color, size, 1 + level * 0.06, -30, level);
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.vx *= Math.exp(-p.drag * dt);
      p.vy = p.vy * Math.exp(-p.drag * dt) + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const r of this.rings) r.life += dt;
    this.rings = this.rings.filter((r) => r.life < r.max);
    for (const b of this.beams) b.life += dt;
    this.beams = this.beams.filter((b) => b.life < b.max);
    for (const t of this.texts) {
      t.life += dt;
      t.age += dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.5 * dt);
    }
    this.texts = this.texts.filter((t) => t.life < t.max);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.hitstop = Math.max(0, this.hitstop - dt);
  }

  /** 当前震屏偏移（竞技场单位）。 */
  shakeOffset(time: number): { x: number; y: number } {
    if (this.trauma <= 0) return { x: 0, y: 0 };
    const k = this.trauma * this.trauma * 9;
    return { x: Math.sin(time * 71.3) * k, y: Math.cos(time * 57.1) * k };
  }

  drawWorld(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const k = r.life / r.max;
      const radius = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2));
      ctx.globalAlpha = (1 - k) * (this.options.reduceFlashes ? 0.6 : 1);
      if (r.fill > 0) {
        circlePath(ctx, r.x, r.y, radius);
        ctx.fillStyle = r.color;
        ctx.globalAlpha = (1 - k) * r.fill;
        ctx.fill();
        ctx.globalAlpha = 1 - k;
      }
      circlePath(ctx, r.x, r.y, radius);
      ctx.lineWidth = r.width * (1 - k * 0.5);
      ctx.strokeStyle = r.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    for (const b of this.beams) {
      const k = b.life / b.max;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.lineWidth = b.width * (1.6 - k);
      ctx.strokeStyle = b.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = 1 - k;
      ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      ctx.fillStyle = p.color;
      const s = p.size * (1 - k * 0.4);
      if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
        ctx.restore();
      } else if (p.shape === 'star') {
        starPath(ctx, p.x, p.y, 4, s * 1.6, s * 0.5, p.rot);
        ctx.fill();
      } else if (p.shape === 'plus') {
        ctx.fillRect(p.x - s, p.y - s * 0.3, s * 2, s * 0.6);
        ctx.fillRect(p.x - s * 0.3, p.y - s, s * 0.6, s * 2);
      } else {
        circlePath(ctx, p.x, p.y, s);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx: CanvasRenderingContext2D, font: string): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const pop = k < 0.15 ? 0.7 + (k / 0.15) * 0.45 : 1.15 - Math.min(0.15, (k - 0.15) * 0.4);
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `800 ${Math.round(t.size * pop)}px ${font}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(28, 18, 22, 0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
