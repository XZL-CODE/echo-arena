// 主渲染器：按层绘制竞技场。只读取模拟状态，不修改它。
import { ARENA, MODULE_TUNING } from '../core/content/tuning.js';
import { lerp } from '../core/math.js';
import type { Obstacle, Projectile, Unit } from '../core/sim/entities.js';
import type { World } from '../core/sim/world.js';
import { renderBoard } from './board.js';
import { Fx } from './fx.js';
import { echoColor, PALETTE } from './palette.js';
import { circlePath, ellipsePath, gearPath, roundRectPath } from './shapes.js';
import { drawUnit, UNIT_DRAW_SCALE, type UnitVisual } from './units.js';
import { type View } from './view.js';

export const FONT =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif';

export interface TargetPreview {
  module: 'charge' | 'pierce' | 'vortex';
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  level: number;
}

export interface Looks {
  shield: boolean;
  armor: boolean;
  booster: boolean;
  bellCharm: UnitVisual['bellCharm'];
}

export interface DrawOptions {
  mode: 'title' | 'prep' | 'battle';
  /** 画面时间（秒），用于待机动画；战斗中与模拟时间一致。 */
  time: number;
  /** 两个模拟步之间的插值系数。 */
  alpha: number;
  looks: Looks;
  showZones: boolean;
  gadgetZone: boolean;
  selectedId: number;
  hoverId: number;
  targeting: TargetPreview | null;
  reduceFlashes: boolean;
  showBars: boolean;
}

export class Renderer {
  readonly view: View;
  readonly fx = new Fx();
  private board: HTMLCanvasElement | null = null;
  private appearAt = new Map<number, number>();

  constructor(view: View) {
    this.view = view;
  }

  /** 画布尺寸变化后重建底图。 */
  invalidate(): void {
    this.board = null;
  }

  /** 记录单位出场时间（用于弹出动画）。 */
  markSpawn(unitId: number, time: number): void {
    this.appearAt.set(unitId, time);
  }

  resetScene(): void {
    this.fx.clear();
    this.appearAt.clear();
  }

  draw(world: World | null, o: DrawOptions): void {
    const { ctx } = this.view;
    if (!this.board) this.board = renderBoard(this.view);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.board, 0, 0);
    if (!world) return;

    const shake = this.fx.shakeOffset(o.time);
    this.view.arenaTransform(shake.x, shake.y);

    if (o.showZones) this.drawZones(ctx, o);
    for (const ob of world.obstacles) this.drawObstacle(ctx, ob, o.time);
    this.drawTelegraphs(ctx, world, o);

    const units = world.units
      .filter((u) => u.alive)
      .map((u) => ({ u, x: lerp(u.px, u.x, o.alpha), y: lerp(u.py, u.y, o.alpha) }))
      .sort((a, b) => a.y - b.y);
    for (const { u, x, y } of units) {
      if (u.id === world.focusId) this.drawFocus(ctx, x, y, u.radius * UNIT_DRAW_SCALE, o.time);
      drawUnit(ctx, u, {
        x,
        y,
        t: o.time,
        shield: o.looks.shield,
        armor: o.looks.armor,
        booster: o.looks.booster,
        bellCharm: o.looks.bellCharm,
        appear: this.appearProgress(u.id, o.time),
        selected: u.id === o.selectedId || u.id === o.hoverId,
        reduceFlashes: o.reduceFlashes,
      });
    }

    for (const p of world.projectiles) this.drawProjectile(ctx, p, o);
    this.fx.drawWorld(ctx);
    if (o.showBars) {
      for (const { u, x, y } of units) this.drawBars(ctx, u, x, y);
      const king = world.units.find((u) => u.kind === 'king' && u.alive);
      if (king) this.drawBossBar(ctx, world, king);
    }
    this.fx.drawTexts(ctx, FONT);
    if (o.targeting) this.drawTargeting(ctx, world, o.targeting, o.time);
  }

  private appearProgress(id: number, time: number): number {
    const at = this.appearAt.get(id);
    if (at === undefined) return 1;
    const k = (time - at) / 0.35;
    if (k >= 1) {
      this.appearAt.delete(id);
      return 1;
    }
    return Math.max(0, k);
  }

  private drawZones(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
    const w = ARENA.width;
    const h = ARENA.height;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 244, 214, 0.07)';
    ctx.fillRect(0, 0, ARENA.playerZoneMaxX, h);
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -o.time * 12;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.45)';
    roundRectPath(ctx, 6, 6, ARENA.playerZoneMaxX - 6, h - 12, 10);
    ctx.stroke();
    if (o.gadgetZone) {
      ctx.strokeStyle = 'rgba(154, 216, 255, 0.35)';
      ctx.setLineDash([3, 9]);
      ctx.beginPath();
      ctx.moveTo(ARENA.gadgetZoneMaxX, 10);
      ctx.lineTo(ARENA.gadgetZoneMaxX, h - 10);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 244, 214, 0.6)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('我方布阵区 · 拖动队员调整站位', 18, 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 190, 180, 0.55)';
    ctx.fillText('对手', w - 18, 16);
    ctx.restore();
  }

  private drawObstacle(ctx: CanvasRenderingContext2D, ob: Obstacle, time: number): void {
    const boing = Math.max(0, 1 - (time - ob.hitAt) / 0.35);
    ctx.save();
    ctx.translate(ob.x, ob.y);
    ellipsePath(ctx, 4, ob.r * 0.35 + 4, ob.r * 1.05, ob.r * 0.5);
    ctx.fillStyle = PALETTE.shadow;
    ctx.fill();
    if (ob.kind === 'pillar') {
      // 木桩：俯视的年轮
      circlePath(ctx, 0, 0, ob.r);
      const g = ctx.createRadialGradient(-ob.r * 0.3, -ob.r * 0.3, 2, 0, 0, ob.r);
      g.addColorStop(0, '#d9a877');
      g.addColorStop(1, '#8a5a35');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(90, 54, 32, 0.6)';
      for (const k of [0.3, 0.55, 0.78]) {
        circlePath(ctx, 1, 1, ob.r * k);
        ctx.stroke();
      }
    } else if (ob.kind === 'mirrorpost') {
      circlePath(ctx, 0, 0, ob.r + 3);
      ctx.fillStyle = '#6d7f8f';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
      circlePath(ctx, 0, 0, ob.r - 1);
      const g = ctx.createLinearGradient(-ob.r, -ob.r, ob.r, ob.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#bfe9ff');
      g.addColorStop(1, '#7fb6d6');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(-ob.r * 0.5, -ob.r * 0.1);
      ctx.lineTo(-ob.r * 0.1, -ob.r * 0.5);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      if (boing > 0) {
        ctx.globalAlpha = boing;
        circlePath(ctx, 0, 0, ob.r + 6 + (1 - boing) * 10);
        ctx.strokeStyle = '#bff4ff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    } else {
      const s = 1 + Math.sin(boing * Math.PI * 3) * 0.18 * boing;
      ctx.scale(s, s);
      circlePath(ctx, 0, 0, ob.r);
      ctx.fillStyle = '#cfd6dc';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= 36; i++) {
        const a = i * 0.55;
        const rr = ob.r * 0.85 * (1 - i / 42);
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#6d7f8f';
      ctx.stroke();
      circlePath(ctx, 0, 0, ob.r * 0.32);
      ctx.fillStyle = '#ff6f91';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTelegraphs(ctx: CanvasRenderingContext2D, world: World, o: DrawOptions): void {
    ctx.save();
    // 漩涡
    for (const v of world.vortexes) {
      const k = v.time / v.duration;
      circlePath(ctx, v.x, v.y, v.r);
      ctx.fillStyle = `rgba(154, 216, 255, ${0.08 + 0.06 * Math.sin(o.time * 8)})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(154, 216, 255, 0.55)';
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = o.time * 6 + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.arc(v.x, v.y, v.r * (0.35 + 0.15 * i) * (1 - k * 0.3), a, a + 1.6);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(214, 240, 255, 0.75)';
        ctx.stroke();
      }
    }
    // 木箭手瞄准线
    for (const u of world.units) {
      if (!u.alive || u.state !== 'windup') continue;
      if (u.kind === 'archer') {
        const k = 1 - Math.max(0, u.stateTime) / u.def.windup;
        ctx.globalAlpha = 0.15 + k * 0.45;
        ctx.setLineDash([8, 7]);
        ctx.beginPath();
        ctx.moveTo(u.x, u.y - 10);
        ctx.lineTo(u.aimX, u.aimY - 10);
        ctx.lineWidth = 2;
        ctx.strokeStyle = PALETTE.enemyShot;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (u.kind === 'king' && u.pending === 'charge') {
        const k = 1 - Math.max(0, u.stateTime) / 1.1;
        ctx.globalAlpha = 0.2 + k * 0.4;
        ctx.save();
        ctx.translate(u.x, u.y);
        ctx.rotate(Math.atan2(u.dashY, u.dashX));
        const len = 900;
        ctx.fillStyle = 'rgba(255, 107, 90, 0.35)';
        ctx.fillRect(0, -u.radius, len * Math.min(1, k * 1.5), u.radius * 2);
        ctx.beginPath();
        ctx.moveTo(len * Math.min(1, k * 1.5), -u.radius - 12);
        ctx.lineTo(len * Math.min(1, k * 1.5) + 30, 0);
        ctx.lineTo(len * Math.min(1, k * 1.5), u.radius + 12);
        ctx.fill();
        ctx.restore();
      } else if (u.kind === 'king' && u.pending === 'fan') {
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([6, 8]);
        const base = Math.atan2(u.aimY - u.y, u.aimX - u.x);
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(u.x, u.y);
          ctx.lineTo(u.x + Math.cos(base + i * 0.17) * 160, u.y + Math.sin(base + i * 0.17) * 160);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#f2c94c';
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
    // 爆爆虫引信的爆炸范围
    for (const u of world.units) {
      if (!u.alive || u.kind !== 'bomber' || u.state !== 'fuse') continue;
      const k = 1 - Math.max(0, u.stateTime) / u.def.windup;
      circlePath(ctx, u.x, u.y, 75 * (0.6 + 0.4 * k));
      ctx.fillStyle = `rgba(255, 110, 70, ${0.08 + k * 0.12})`;
      ctx.fill();
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 140, 90, 0.7)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 炮台蛙的落点与飞行中的炸弹
    for (const lob of world.lobs) {
      const k = lob.time / lob.duration;
      circlePath(ctx, lob.x, lob.y, lob.r);
      ctx.fillStyle = `rgba(255, 159, 67, ${0.06 + k * 0.16})`;
      ctx.fill();
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 159, 67, 0.8)';
      ctx.stroke();
      ctx.setLineDash([]);
      circlePath(ctx, lob.x, lob.y, lob.r * k);
      ctx.lineWidth = 2;
      ctx.stroke();
      const x = lerp(lob.fromX, lob.x, k);
      const y = lerp(lob.fromY, lob.y, k);
      const lift = Math.sin(k * Math.PI) * 170;
      ellipsePath(ctx, x, y, 7, 3.5);
      ctx.fillStyle = PALETTE.shadow;
      ctx.fill();
      circlePath(ctx, x, y - lift, 8);
      ctx.fillStyle = '#3b3346';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFocus(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    time: number,
  ): void {
    ctx.save();
    ctx.translate(x, y - r * 0.3);
    ctx.rotate(time * 1.5);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.focus;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 12, (i * Math.PI) / 2 + 0.25, (i * Math.PI) / 2 + 1.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile, o: DrawOptions): void {
    const x = lerp(p.px, p.x, o.alpha);
    const y = lerp(p.py, p.y, o.alpha) - 10;
    const speed = Math.hypot(p.vx, p.vy) || 1;
    const dx = p.vx / speed;
    const dy = p.vy / speed;
    const color = p.team === 0 ? echoColor(p.echo) : p.echo > 0 ? '#ff9f6b' : PALETTE.enemyShot;
    ctx.save();
    // 拖尾
    const trail = p.kind === 'bigshot' ? 60 : 16 + Math.min(30, p.echo * 6);
    const g = ctx.createLinearGradient(x, y, x - dx * trail, y - dy * trail);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.lineWidth = p.radius * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dx * trail, y - dy * trail);
    ctx.stroke();
    if (p.echo > 0 || p.kind === 'bigshot') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      circlePath(ctx, x, y, p.radius * (2.2 + Math.min(2, p.echo * 0.3)));
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (p.kind === 'arrow') {
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(-12, -1.3, 14, 2.6);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-1, -4.5);
      ctx.lineTo(-1, 4.5);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
    } else if (p.kind === 'cog') {
      gearPath(ctx, x, y, p.radius + 2, 6, o.time * 10);
      ctx.fillStyle = p.team === 0 ? color : '#e8c547';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
    } else {
      circlePath(ctx, x, y, p.radius);
      ctx.fillStyle = p.team === 0 ? (p.echo > 0 ? color : '#fff1b8') : color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PALETTE.outline;
      ctx.stroke();
      circlePath(ctx, x - p.radius * 0.3, y - p.radius * 0.3, p.radius * 0.35);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBars(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number): void {
    if (u.kind === 'king') return;
    const r = u.radius * UNIT_DRAW_SCALE;
    const w = Math.max(32, r * 2);
    const h = 5;
    const top = y - r * (u.kind === 'jack' ? 1.75 : 1.95) - 10;
    const left = x - w / 2;
    roundRectPath(ctx, left - 1.5, top - 1.5, w + 3, h + 3, 3);
    ctx.fillStyle = PALETTE.hpBack;
    ctx.fill();
    const k = Math.max(0, u.hp / u.maxHp);
    if (k > 0) {
      roundRectPath(ctx, left, top, w * k, h, 2);
      ctx.fillStyle = u.team === 0 ? PALETTE.allyHp : PALETTE.enemyHp;
      ctx.fill();
    }
    if (u.shieldHp > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(left, top - 3, w * Math.min(1, u.shieldHp / 20), 2);
    }
    if (u.team === 1) {
      // 对手血条带刻度，与我方的连续血条形状不同。
      ctx.fillStyle = 'rgba(20,14,16,0.55)';
      for (let i = 1; i < 4; i++) ctx.fillRect(left + (w * i) / 4 - 0.5, top, 1, h);
    }
    if (u.tauntTime > 0) {
      ctx.font = `900 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.taunt;
      ctx.fillText('!', x + w / 2 + 6, top + 5);
    }
    if (u.resonance > 0) {
      circlePath(ctx, x - w / 2 - 7, top + 2.5, 4);
      ctx.lineWidth = 2;
      ctx.strokeStyle = PALETTE.magnet;
      ctx.stroke();
    }
  }

  private drawBossBar(ctx: CanvasRenderingContext2D, world: World, king: Unit): void {
    const w = 520;
    const x = (world.width - w) / 2;
    const y = 16;
    roundRectPath(ctx, x - 4, y - 4, w + 8, 22, 8);
    ctx.fillStyle = 'rgba(20, 14, 16, 0.78)';
    ctx.fill();
    const k = Math.max(0, king.hp / king.maxHp);
    roundRectPath(ctx, x, y, w * k, 14, 5);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#c77dff');
    g.addColorStop(1, '#ff7a68');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (const mark of [0.33, 0.66]) ctx.fillRect(x + w * mark - 1, y - 2, 2, 18);
    ctx.font = `800 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff4dc';
    const phase = ['', '齿轮弹幕', '召唤援军', '横冲直撞'][king.phase] ?? '';
    ctx.fillText(`发条大王 · ${phase}`, world.width / 2, y + 20);
  }

  private drawTargeting(
    ctx: CanvasRenderingContext2D,
    world: World,
    t: TargetPreview,
    time: number,
  ): void {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffe066';
    ctx.fillStyle = 'rgba(255, 224, 102, 0.14)';
    if (t.module === 'vortex') {
      const r = MODULE_TUNING.vortex.radius;
      circlePath(ctx, t.x, t.y, r);
      ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -time * 30;
      ctx.stroke();
    } else {
      const angle = Math.atan2(t.y - t.fromY, t.x - t.fromX);
      let length = Math.hypot(t.x - t.fromX, t.y - t.fromY);
      let width = 40;
      if (t.module === 'charge') length = Math.min(length, MODULE_TUNING.charge.maxDistance);
      else {
        length = 1400;
        width = MODULE_TUNING.pierce.radius * 2 + 20;
      }
      ctx.translate(t.fromX, t.fromY);
      ctx.rotate(angle);
      roundRectPath(ctx, 0, -width / 2, length, width, width / 2);
      ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -time * 30;
      ctx.stroke();
      ctx.setLineDash([]);
      if (t.module === 'charge') {
        circlePath(ctx, length, 0, 26);
        ctx.stroke();
        if (t.level >= 2) {
          circlePath(ctx, length, 0, MODULE_TUNING.charge.quakeRadius);
          ctx.globalAlpha = 0.5;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    void world;
  }
}
