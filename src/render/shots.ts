// 弹丸：发光的弹核，加一条沿真实飞行路线的拖尾，反射、弹射之后的折线也看得见。
import { lerp } from '../core/math.js';
import type { Projectile } from '../core/sim/entities.js';
import type { World } from '../core/sim/world.js';
import { AIR } from './fx.js';
import { glowSprite } from './glow.js';
import { echoColor, PALETTE } from './palette.js';
import { gear, GOLD } from './parts.js';
import { OUTLINE } from './toon.js';

interface Trail {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
  /** 弹丸消失后拖尾还要淡出一会儿（秒，0 表示弹丸还在）。 */
  fading: number;
  seen: boolean;
}

const FADE = 0.18;

function colorOf(p: Projectile): string {
  if (p.team === 0) return p.echo > 0 ? echoColor(p.echo) : '#fff1b8';
  if (p.echo > 0) return '#ff9f6b';
  return p.kind === 'cog' ? '#f2c94c' : PALETTE.enemyShot;
}

function trailLength(p: Projectile): number {
  if (p.kind === 'bigshot') return 220;
  if (p.kind === 'bigpellet') return 90;
  if (p.kind === 'arrow' || p.kind === 'cog') return p.echo > 0 ? 70 : 42;
  return 50 + Math.min(70, p.echo * 12);
}

export class Shots {
  private trails = new Map<number, Trail>();

  clear(): void {
    this.trails.clear();
  }

  /** 记录这一帧每颗弹丸的位置；dt 是画面时间，用来让消失的拖尾淡出。 */
  sample(world: World, alpha: number, dt: number): void {
    for (const t of this.trails.values()) t.seen = false;
    for (const p of world.projectiles) {
      if (!p.alive) continue;
      const x = lerp(p.px, p.x, alpha);
      const y = lerp(p.py, p.y, alpha) - AIR;
      let trail = this.trails.get(p.id);
      if (!trail) {
        trail = {
          points: [{ x: p.px, y: p.py - AIR }],
          color: '',
          width: 0,
          fading: 0,
          seen: true,
        };
        this.trails.set(p.id, trail);
      }
      trail.seen = true;
      trail.color = colorOf(p);
      trail.width = p.kind === 'bigshot' ? 14 : p.kind === 'arrow' ? 2.4 : p.radius * 1.5;
      const head = trail.points[0];
      if (!head || Math.hypot(head.x - x, head.y - y) > 2.5) trail.points.unshift({ x, y });
      else {
        head.x = x;
        head.y = y;
      }
      // 按长度截断
      const max = trailLength(p);
      let total = 0;
      for (let i = 1; i < trail.points.length; i++) {
        const a = trail.points[i - 1] as { x: number; y: number };
        const b = trail.points[i] as { x: number; y: number };
        total += Math.hypot(a.x - b.x, a.y - b.y);
        if (total > max) {
          trail.points.length = i + 1;
          break;
        }
      }
      if (trail.points.length > 24) trail.points.length = 24;
    }
    for (const [id, t] of this.trails) {
      if (t.seen) continue;
      t.fading += dt;
      if (t.fading >= FADE) this.trails.delete(id);
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    glow: CanvasRenderingContext2D,
    world: World,
    alpha: number,
    time: number,
  ): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    glow.lineCap = 'round';
    glow.lineJoin = 'round';
    for (const t of this.trails.values()) this.drawTrail(ctx, glow, t);
    for (const p of world.projectiles) {
      if (p.alive) this.drawHead(ctx, glow, p, alpha, time);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    glow.globalAlpha = 1;
  }

  private drawTrail(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, t: Trail) {
    const pts = t.points;
    if (pts.length < 2) return;
    const fade = t.fading > 0 ? 1 - t.fading / FADE : 1;
    const head = pts[0] as { x: number; y: number };
    const tail = pts[pts.length - 1] as { x: number; y: number };
    const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    g.addColorStop(0, t.color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    const path = new Path2D();
    pts.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade * 0.8;
    ctx.strokeStyle = g;
    ctx.lineWidth = t.width;
    ctx.stroke(path);
    ctx.globalAlpha = fade * 0.9;
    const core = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    core.addColorStop(0, 'rgba(255,255,255,0.95)');
    core.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(1, t.width * 0.35);
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
    glow.globalAlpha = fade;
    glow.strokeStyle = g;
    glow.lineWidth = t.width * 2.2;
    glow.stroke(path);
  }

  private drawHead(
    ctx: CanvasRenderingContext2D,
    glow: CanvasRenderingContext2D,
    p: Projectile,
    alpha: number,
    time: number,
  ): void {
    const x = lerp(p.px, p.x, alpha);
    const y = lerp(p.py, p.y, alpha) - AIR;
    const speed = Math.hypot(p.vx, p.vy) || 1;
    const angle = Math.atan2(p.vy / speed, p.vx / speed);
    const color = colorOf(p);
    const hot = p.echo > 0 || p.kind === 'bigshot';

    // 光晕：弹丸越“热”（回响越高）越大
    const halo =
      p.kind === 'bigshot' ? 30 : p.radius * (2.4 + Math.min(2.4, p.echo * 0.4)) + (hot ? 4 : 0);
    const img = glowSprite(color);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = hot ? 0.8 : p.team === 0 ? 0.55 : 0.4;
    ctx.drawImage(img, x - halo, y - halo, halo * 2, halo * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    glow.globalAlpha = hot ? 0.8 : 0.45;
    glow.drawImage(img, x - halo * 1.2, y - halo * 1.2, halo * 2.4, halo * 2.4);

    ctx.save();
    ctx.translate(x, y);
    if (p.kind === 'arrow') {
      ctx.rotate(angle);
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(-13, -1.3, 15, 2.6);
      // 尾羽
      ctx.fillStyle = p.echo > 0 ? color : '#f6ead3';
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(-17, -3.6);
      ctx.lineTo(-10, 0);
      ctx.lineTo(-17, 3.6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-1, -4.6);
      ctx.lineTo(-1, 4.6);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    } else if (p.kind === 'cog') {
      const m = p.team === 0 ? { ...GOLD, base: color, light: '#ffffff' } : GOLD;
      gear(ctx, 0, 0, p.radius + 2.5, 6, time * 10, m, 1.4);
    } else if (p.kind === 'bigshot') {
      // 贯穿射：一道拉长的光矛
      ctx.rotate(angle);
      const len = 30;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-len, 0, 14, 0);
      g.addColorStop(0, 'rgba(255, 241, 184, 0)');
      g.addColorStop(0.7, color);
      g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(-len * 0.3, 0, len, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(2, 0, 12, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 螺旋光带
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const k = i / 12;
        const px = 10 - k * len * 1.3;
        const py = Math.sin(k * 9 - time * 30) * 7 * (1 - k * 0.5);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // 弹子：白亮的核心，外圈是回响色
      const r = p.radius;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      const core = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.5, p.team === 0 ? (p.echo > 0 ? '#ffffff' : '#fff8dc') : '#ffd2b8');
      core.addColorStop(1, color);
      ctx.fillStyle = core;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
    ctx.restore();
  }
}
