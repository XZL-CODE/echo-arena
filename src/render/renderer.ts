// 主渲染器：按层绘制竞技场。只读取模拟状态，不修改它。
// 层次：底图 → 地面（焦痕、光照、冲击波、浮尘）→ 机关与预警 → 单位（含冲锋残影）→ 弹丸与拖尾
// → 空中特效 → 泛光 → 血条 → 文字 → 瞄准预览。
import { ARENA, MODULE_TUNING } from '../core/content/tuning.js';
import { clamp, lerp } from '../core/math.js';
import type { Obstacle, Unit } from '../core/sim/entities.js';
import type { World } from '../core/sim/world.js';
import { renderBoard } from './board.js';
import { AIR, Fx } from './fx.js';
import { GlowLayer, glowSprite } from './glow.js';
import { PALETTE } from './palette.js';
import { circlePath, ellipsePath, roundRectPath } from './shapes.js';
import { Shots } from './shots.js';
import { circleP, ellipseP, OUTLINE, setRim, shade, type Mat } from './toon.js';
import { DEATH_TIME, drawUnit, UNIT_DRAW_SCALE, type UnitVisual } from './units.js';
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

/** 台灯在竞技场上方的位置：单位的影子朝远离它的方向投。 */
const LAMP = { x: ARENA.width / 2, y: 150 };

interface Ghost {
  x: number;
  y: number;
  t: number;
}

/** 按实际帧间隔自动调画质：连续掉帧时减少粒子、关掉泛光，恢复后再加回来。 */
class Governor {
  private last = 0;
  private avg = 16;
  private slow = 0;
  private fast = 0;
  quality = 1;
  /** 固定画质（截图、测试用），不再自动调整。 */
  pinned: number | null = null;

  tick(now: number): void {
    if (this.pinned !== null) {
      this.quality = this.pinned;
      return;
    }
    if (this.last > 0) {
      const dt = Math.min(100, now - this.last);
      this.avg += (dt - this.avg) * 0.08;
      if (this.avg > 26) {
        this.slow += dt;
        this.fast = 0;
      } else if (this.avg < 18.5) {
        this.fast += dt;
        this.slow = 0;
      } else {
        this.slow = 0;
        this.fast = 0;
      }
      if (this.slow > 1500) {
        this.quality = Math.max(0.4, this.quality - 0.2);
        this.slow = 0;
      } else if (this.fast > 4000 && this.quality < 1) {
        this.quality = Math.min(1, this.quality + 0.1);
        this.fast = 0;
      }
    }
    this.last = now;
  }
}

export class Renderer {
  readonly view: View;
  readonly fx = new Fx();
  private readonly glow = new GlowLayer();
  private readonly shots = new Shots();
  private readonly governor = new Governor();
  private board: HTMLCanvasElement | null = null;
  private appearAt = new Map<number, number>();
  private ghosts = new Map<number, Ghost[]>();
  private lagHp = new Map<number, number>();
  private lastTime = 0;
  private started = false;
  /** 最近一段时间画一帧的平均耗时（毫秒，只算主线程）。 */
  drawMs = 0;

  constructor(view: View) {
    this.view = view;
  }

  /** 画布尺寸变化后重建底图。 */
  invalidate(): void {
    this.board = null;
  }

  /** 记录单位出场时间（用于落地动画）。 */
  markSpawn(unitId: number, time: number): void {
    this.appearAt.set(unitId, time);
  }

  resetScene(): void {
    this.fx.clear();
    this.shots.clear();
    this.appearAt.clear();
    this.ghosts.clear();
    this.lagHp.clear();
    this.lastTime = 0;
    this.started = false;
  }

  /** 各类特效的数量与画一帧的耗时（测试用）。 */
  stats(): Record<string, number> {
    return { ...this.fx.stats(), drawMs: Math.round(this.drawMs * 100) / 100 };
  }

  /** 固定画质（0.4..1）；传 null 恢复自动调整。截图脚本用它保证画面完整。 */
  pinQuality(quality: number | null): void {
    this.governor.pinned = quality === null ? null : Math.max(0.4, Math.min(1, quality));
  }

  draw(world: World | null, o: DrawOptions): void {
    const start = performance.now();
    this.paint(world, o);
    const spent = performance.now() - start;
    this.drawMs += (spent - this.drawMs) * 0.05;
  }

  private paint(world: World | null, o: DrawOptions): void {
    const { ctx } = this.view;
    if (!this.board) this.board = renderBoard(this.view);
    this.governor.tick(performance.now());
    this.fx.quality = this.governor.quality;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.board, 0, 0);
    if (!world) return;

    // 画面时间差：战斗中是模拟时间，暂停时为 0（持续特效不再补充）。
    const dt = clamp(o.time - this.lastTime, 0, 0.1);
    this.lastTime = o.time;
    if (o.mode === 'battle' && !this.started && world.t > 0) {
      this.started = true;
      // 快进（测试、截图）时第一次画面已经在战斗中途，不再补开场光圈。
      if (world.t < 0.5) this.fx.battleStart(world);
    }
    if (o.mode !== 'prep') this.fx.emit(world, dt);
    this.shots.sample(world, o.alpha, dt);

    const shake = this.fx.shakeOffset(o.time);
    this.view.arenaTransform(shake.x, shake.y);
    const glow = this.glow.begin(this.view, shake.x, shake.y);

    this.fx.drawFloor(ctx);
    this.fx.drawMotes(ctx, o.time);
    if (o.showZones) this.drawZones(ctx, o);
    this.drawVortexes(ctx, glow, world, o.time);
    for (const ob of world.obstacles) this.drawObstacle(ctx, ob, o.time);
    this.drawTelegraphs(ctx, glow, world, o);
    if (this.fx.dim > 0) {
      ctx.fillStyle = `rgba(12, 6, 24, ${0.32 * this.fx.dim})`;
      ctx.fillRect(-40, -40, ARENA.width + 80, ARENA.height + 80);
    }

    const units = world.units
      .filter((u) => u.alive || o.time - u.diedAt < DEATH_TIME)
      .map((u) => ({ u, x: lerp(u.px, u.x, o.alpha), y: lerp(u.py, u.y, o.alpha) }))
      .sort((a, b) => a.y - b.y);
    for (const { u, x, y } of units) {
      if (!u.alive) {
        this.drawUnitAt(ctx, u, x, y, o);
        continue;
      }
      if (u.id === world.focusId)
        this.drawFocus(ctx, glow, x, y, u.radius * UNIT_DRAW_SCALE, o.time);
      this.drawGhosts(ctx, u, x, y, o);
      this.drawUnitAt(ctx, u, x, y, o);
    }

    this.shots.draw(ctx, glow, world, o.alpha, o.time);
    const air = this.fx.drawAir(ctx, glow, o.time);
    this.fx.drawTextGlow(glow, FONT);
    if (this.fx.quality >= 0.55 && (air || o.mode !== 'prep')) {
      this.glow.composite(ctx, o.reduceFlashes ? 0.35 : 0.6);
    }

    this.view.arenaTransform(shake.x, shake.y);
    if (world.overtimeLevel > 0) this.drawOvertime(ctx, world.overtimeLevel, o);
    if (o.showBars) {
      for (const { u, x, y } of units) if (u.alive) this.drawBars(ctx, u, x, y, dt);
      const king = world.units.find((u) => u.kind === 'king' && u.alive);
      if (king) this.drawBossBar(ctx, world, king);
    }
    this.fx.drawTexts(ctx, FONT);
    if (o.targeting) this.drawTargeting(ctx, o.targeting, o.time);
  }

  private drawUnitAt(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, o: DrawOptions) {
    const dx = x - LAMP.x;
    const dy = y - LAMP.y;
    const len = Math.hypot(dx, dy) || 1;
    const reach = Math.min(9, len * 0.014);
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
      shadowX: (dx / len) * reach + 1,
      shadowY: (dy / len) * reach * 0.6 + 3,
    });
  }

  /** 冲锋中留下几道残影。 */
  private drawGhosts(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, o: DrawOptions) {
    const dashing = u.state === 'dash' || u.state === 'charge';
    let list = this.ghosts.get(u.id);
    if (dashing) {
      if (!list) {
        list = [];
        this.ghosts.set(u.id, list);
      }
      const last = list[0];
      if (!last || o.time - last.t > 0.035) list.unshift({ x, y, t: o.time });
      if (list.length > 5) list.length = 5;
    }
    if (!list) return;
    const alive = list.filter((g) => o.time - g.t < 0.2);
    if (alive.length === 0) {
      this.ghosts.delete(u.id);
      return;
    }
    this.ghosts.set(u.id, alive);
    const color = u.team === 0 ? '#8fe6ff' : '#ff9a8a';
    for (let i = alive.length - 1; i >= 0; i--) {
      const g = alive[i] as Ghost;
      const k = (o.time - g.t) / 0.2;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.45;
      drawUnit(ctx, u, {
        x: g.x,
        y: g.y,
        t: g.t,
        shield: o.looks.shield,
        armor: o.looks.armor,
        booster: o.looks.booster,
        bellCharm: o.looks.bellCharm,
        appear: 1,
        selected: false,
        reduceFlashes: true,
        tint: { color, amount: 0.75 },
      });
      ctx.restore();
    }
  }

  private appearProgress(id: number, time: number): number {
    const at = this.appearAt.get(id);
    if (at === undefined) return 1;
    const k = (time - at) / 0.4;
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

  // ---- 机关 ----

  private drawObstacle(ctx: CanvasRenderingContext2D, ob: Obstacle, time: number): void {
    const boing = Math.max(0, 1 - (time - ob.hitAt) / 0.35);
    setRim(0, 0.35);
    ctx.save();
    ctx.translate(ob.x, ob.y);
    // 影子
    ctx.drawImage(glowSprite('rgba(0,0,0,1)'), -ob.r * 1.5 + 4, ob.r * 0.1, ob.r * 3, ob.r * 1.3);
    if (ob.kind === 'pillar') this.drawPillar(ctx, ob.r);
    else if (ob.kind === 'mirrorpost') this.drawMirrorPost(ctx, ob.r, boing, time);
    else this.drawSpringPad(ctx, ob.r, boing);
    ctx.restore();
  }

  /** 木桩：有年轮顶面的矮圆柱。 */
  private drawPillar(ctx: CanvasRenderingContext2D, r: number): void {
    const ry = r * 0.46;
    const top = -r * 0.5;
    const bottom = r * 0.35;
    const side = new Path2D();
    side.moveTo(-r, top);
    side.lineTo(-r, bottom);
    side.ellipse(0, bottom, r, ry, 0, Math.PI, 0, true);
    side.lineTo(r, top);
    side.ellipse(0, top, r, ry, 0, 0, Math.PI, false);
    side.closePath();
    const g = ctx.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, '#c98b55');
    g.addColorStop(0.35, '#a86a3c');
    g.addColorStop(1, '#5a3218');
    ctx.fillStyle = g;
    ctx.fill(side);
    ctx.save();
    ctx.clip(side);
    ctx.strokeStyle = 'rgba(60, 30, 12, 0.35)';
    ctx.lineWidth = 1.2;
    for (const k of [-0.6, -0.25, 0.15, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(k * r, top);
      ctx.bezierCurveTo(k * r + 3, 0, k * r - 3, bottom * 0.6, k * r + 1, bottom + ry);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(side);
    const cap = ellipseP(0, top, r, ry);
    const tg = ctx.createRadialGradient(-r * 0.3, top - ry * 0.3, 2, 0, top, r);
    tg.addColorStop(0, '#f2cf9c');
    tg.addColorStop(1, '#c08650');
    ctx.fillStyle = tg;
    ctx.fill(cap);
    ctx.stroke(cap);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(110, 64, 30, 0.6)';
    for (const k of [0.28, 0.52, 0.76]) {
      ctx.beginPath();
      ctx.ellipse(1, top + 0.5, r * k, ry * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 镜桩：一根水晶柱，弹丸撞上时一闪。 */
  private drawMirrorPost(ctx: CanvasRenderingContext2D, r: number, boing: number, time: number) {
    const base = ellipseP(0, r * 0.35, r * 1.05, r * 0.45);
    shade(
      ctx,
      base,
      { x: -r, y: 0, w: r * 2, h: r * 0.8 },
      { light: '#8b98a8', base: '#4d5868', dark: '#1d232c', gloss: 0.5 },
      2,
    );
    const h = r * 2.1;
    const w = r * 0.78;
    const crystal = new Path2D();
    crystal.moveTo(0, -h);
    crystal.lineTo(w, -h * 0.62);
    crystal.lineTo(w, r * 0.05);
    crystal.lineTo(0, r * 0.4);
    crystal.lineTo(-w, r * 0.05);
    crystal.lineTo(-w, -h * 0.62);
    crystal.closePath();
    const g = ctx.createLinearGradient(-w, -h, w, r * 0.4);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#c4f1ff');
    g.addColorStop(0.7, '#6fc3e6');
    g.addColorStop(1, '#2d6f96');
    ctx.fillStyle = g;
    ctx.fill(crystal);
    // 棱面
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(0, r * 0.4);
    ctx.moveTo(-w, -h * 0.62);
    ctx.lineTo(0, -h * 0.35);
    ctx.lineTo(w, -h * 0.62);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.stroke();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(crystal);
    // 沿柱身上下扫的亮光
    const sy = -h * 0.6 + ((Math.sin(time * 1.6) + 1) / 2) * h * 0.7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + boing * 0.5;
    ctx.drawImage(glowSprite('#bff4ff'), -w * 1.2, sy - w * 1.2, w * 2.4, w * 2.4);
    if (boing > 0) {
      ctx.globalAlpha = boing;
      ctx.drawImage(glowSprite('#ffffff'), -r * 2.2, -h * 0.6 - r * 1.6, r * 4.4, r * 4.4);
      ctx.globalAlpha = 1;
      circlePath(ctx, 0, -h * 0.35, r + 8 + (1 - boing) * 14);
      ctx.strokeStyle = '#bff4ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 弹簧桩：底板、弹簧、粉色顶垫，被撞时压下去再弹起来。 */
  private drawSpringPad(ctx: CanvasRenderingContext2D, r: number, boing: number) {
    const base = ellipseP(0, r * 0.35, r * 1.05, r * 0.46);
    shade(
      ctx,
      base,
      { x: -r, y: 0, w: r * 2, h: r * 0.8 },
      { light: '#9aa6b5', base: '#5a6474', dark: '#232933', gloss: 0.5 },
      2,
    );
    const squash = 1 - Math.sin(boing * Math.PI) * 0.45;
    const top = r * 0.3 - r * 1.1 * squash - Math.sin(boing * Math.PI * 2) * r * 0.1 * boing;
    const coil = new Path2D();
    const turns = 4;
    for (let i = 0; i <= turns * 2; i++) {
      const y = r * 0.3 + ((top - r * 0.3) * i) / (turns * 2);
      const x = (i % 2 === 0 ? -1 : 1) * r * 0.55;
      if (i === 0) coil.moveTo(x, y);
      else coil.lineTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(coil);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#cfd6dc';
    ctx.stroke(coil);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(coil);
    const pad = ellipseP(0, top, r * 0.95, r * 0.42);
    const m: Mat = { light: '#ffd0e0', base: '#ff6f91', dark: '#a8254e', gloss: 0.9 };
    shade(ctx, pad, { x: -r * 0.95, y: top - r * 0.42, w: r * 1.9, h: r * 0.84 }, m, 2.2);
  }

  // ---- 场上的预警 ----

  /** 漩涡：深色的中心，几道旋转的光臂，外圈一道光环。 */
  private drawVortexes(
    ctx: CanvasRenderingContext2D,
    glow: CanvasRenderingContext2D,
    world: World,
    time: number,
  ) {
    for (const v of world.vortexes) {
      const k = v.time / v.duration;
      const fadeIn = Math.min(1, v.time / 0.2);
      ctx.save();
      const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r);
      g.addColorStop(0, `rgba(8, 20, 40, ${0.55 * fadeIn})`);
      g.addColorStop(0.55, `rgba(40, 90, 140, ${0.22 * fadeIn})`);
      g.addColorStop(1, 'rgba(154, 216, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineCap = 'round';
      for (let arm = 0; arm < 4; arm++) {
        const path = new Path2D();
        for (let i = 0; i <= 24; i++) {
          const s = i / 24;
          const a = time * 5 + (arm * Math.PI) / 2 + s * 3.2;
          const rr = v.r * (1 - s * 0.92) * (1 - k * 0.25);
          const px = v.x + Math.cos(a) * rr;
          const py = v.y + Math.sin(a) * rr;
          if (i === 0) path.moveTo(px, py);
          else path.lineTo(px, py);
        }
        ctx.globalAlpha = 0.7 * fadeIn;
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = '#bfe8ff';
        ctx.stroke(path);
        glow.globalAlpha = 0.8 * fadeIn;
        glow.lineWidth = 6;
        glow.strokeStyle = '#9ad8ff';
        glow.stroke(path);
      }
      ctx.globalAlpha = fadeIn;
      ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -time * 60;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(154, 216, 255, 0.75)';
      circlePath(ctx, v.x, v.y, v.r);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      glow.globalAlpha = 1;
    }
  }

  private drawTelegraphs(
    ctx: CanvasRenderingContext2D,
    glow: CanvasRenderingContext2D,
    world: World,
    o: DrawOptions,
  ): void {
    ctx.save();
    for (const u of world.units) {
      if (!u.alive || u.state !== 'windup') continue;
      if (u.kind === 'archer') {
        // 木箭手瞄准线：越接近放箭越亮，终点有一个准星
        const k = 1 - Math.max(0, u.stateTime) / u.def.windup;
        const a = 0.2 + k * 0.6;
        ctx.globalAlpha = a;
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -o.time * 40;
        ctx.beginPath();
        ctx.moveTo(u.x, u.y - AIR);
        ctx.lineTo(u.aimX, u.aimY - AIR);
        ctx.lineWidth = 2;
        ctx.strokeStyle = PALETTE.enemyShot;
        ctx.stroke();
        ctx.setLineDash([]);
        glow.globalAlpha = a * 0.6;
        glow.beginPath();
        glow.moveTo(u.x, u.y - AIR);
        glow.lineTo(u.aimX, u.aimY - AIR);
        glow.lineWidth = 4;
        glow.strokeStyle = PALETTE.enemyShot;
        glow.stroke();
        const rr = 10 - k * 4;
        circlePath(ctx, u.aimX, u.aimY - AIR, rr);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else if (u.kind === 'king' && u.pending === 'charge') {
        const k = 1 - Math.max(0, u.stateTime) / 1.1;
        const reach = 900 * Math.min(1, k * 1.5);
        ctx.globalAlpha = 0.25 + k * 0.45;
        ctx.save();
        ctx.translate(u.x, u.y);
        ctx.rotate(Math.atan2(u.dashY, u.dashX));
        const g = ctx.createLinearGradient(0, 0, reach, 0);
        g.addColorStop(0, 'rgba(255, 90, 80, 0.5)');
        g.addColorStop(1, 'rgba(255, 90, 80, 0.15)');
        ctx.fillStyle = g;
        ctx.fillRect(0, -u.radius, reach, u.radius * 2);
        // 往前滚动的箭头
        ctx.fillStyle = 'rgba(255, 200, 190, 0.85)';
        for (let x = ((o.time * 260) % 70) + 40; x < reach - 20; x += 70) {
          ctx.beginPath();
          ctx.moveTo(x, -u.radius * 0.6);
          ctx.lineTo(x + 22, 0);
          ctx.lineTo(x, u.radius * 0.6);
          ctx.lineTo(x + 8, 0);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        glow.globalAlpha = 0.5 * k;
        glow.save();
        glow.translate(u.x, u.y);
        glow.rotate(Math.atan2(u.dashY, u.dashX));
        glow.fillStyle = '#ff5a50';
        glow.fillRect(0, -u.radius * 0.8, reach, u.radius * 1.6);
        glow.restore();
      } else if (u.kind === 'king' && u.pending === 'fan') {
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -o.time * 40;
        const base = Math.atan2(u.aimY - u.y, u.aimX - u.x);
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(u.x, u.y);
          ctx.lineTo(u.x + Math.cos(base + i * 0.17) * 170, u.y + Math.sin(base + i * 0.17) * 170);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#f2c94c';
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
    glow.globalAlpha = 1;
    // 爆爆虫引信的爆炸范围
    for (const u of world.units) {
      if (!u.alive || u.kind !== 'bomber' || u.state !== 'fuse') continue;
      const k = 1 - Math.max(0, u.stateTime) / u.def.windup;
      const pulse = o.reduceFlashes ? 0.5 : 0.5 + 0.5 * Math.sin(o.time * (8 + k * 10));
      const radius = 75 * (0.6 + 0.4 * k);
      circlePath(ctx, u.x, u.y, radius);
      ctx.fillStyle = `rgba(255, 90, 60, ${0.08 + k * 0.1 + pulse * 0.05})`;
      ctx.fill();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = o.time * 30;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = `rgba(255, 150, 100, ${0.6 + k * 0.4})`;
      ctx.stroke();
      ctx.setLineDash([]);
      glow.globalAlpha = 0.25 + k * 0.3;
      circlePath(glow, u.x, u.y, radius);
      glow.lineWidth = 4;
      glow.strokeStyle = '#ff6a40';
      glow.stroke();
      glow.globalAlpha = 1;
    }
    // 炮台蛙的落点与飞行中的炸弹
    for (const lob of world.lobs) {
      const k = lob.time / lob.duration;
      circlePath(ctx, lob.x, lob.y, lob.r);
      ctx.fillStyle = `rgba(255, 159, 67, ${0.06 + k * 0.16})`;
      ctx.fill();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -o.time * 30;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 159, 67, 0.85)';
      ctx.stroke();
      ctx.setLineDash([]);
      circlePath(ctx, lob.x, lob.y, lob.r * (1 - k));
      ctx.lineWidth = 2;
      ctx.stroke();
      const x = lerp(lob.fromX, lob.x, k);
      const y = lerp(lob.fromY, lob.y, k);
      const lift = Math.sin(k * Math.PI) * 170;
      const shadowScale = 0.5 + k * 0.5;
      ellipsePath(ctx, x, y, 9 * shadowScale, 4.5 * shadowScale);
      ctx.fillStyle = PALETTE.shadow;
      ctx.fill();
      const bomb = circleP(x, y - lift, 8.5);
      setRim(1, 0.6);
      shade(
        ctx,
        bomb,
        { x: x - 8.5, y: y - lift - 8.5, w: 17, h: 17 },
        { light: '#8a7a9a', base: '#3b3346', dark: '#120e18', gloss: 1 },
        2,
      );
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite('#ffb347'), x + 2, y - lift - 20, 14, 14);
      ctx.restore();
      glow.drawImage(glowSprite('#ffb347'), x - 6, y - lift - 24, 22, 22);
    }
    ctx.restore();
  }

  /** 集火目标：四个转动的角框加一个向下的小箭头。 */
  private drawFocus(
    ctx: CanvasRenderingContext2D,
    glow: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    time: number,
  ): void {
    const cy = y - r * 0.35;
    const size = r + 12 + Math.sin(time * 5) * 2;
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(time * 1.2);
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(size, -size * 0.45);
      ctx.lineTo(size, -size);
      ctx.lineTo(size * 0.55, -size);
      ctx.lineWidth = 5.5;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.focus;
      ctx.stroke();
    }
    ctx.restore();
    const ay = cy - r * 1.35 - 10 + Math.sin(time * 6) * 3;
    ctx.beginPath();
    ctx.moveTo(x - 7, ay - 8);
    ctx.lineTo(x + 7, ay - 8);
    ctx.lineTo(x, ay);
    ctx.closePath();
    ctx.fillStyle = PALETTE.focus;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    glow.globalAlpha = 0.5;
    glow.drawImage(
      glowSprite(PALETTE.focus),
      x - size * 1.4,
      cy - size * 1.4,
      size * 2.8,
      size * 2.8,
    );
    glow.globalAlpha = 1;
  }

  private drawBars(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, dt: number): void {
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
    // 刚掉的血先留一段浅色，再慢慢缩回去
    const lag = Math.max(k, (this.lagHp.get(u.id) ?? k) - dt * 0.7);
    this.lagHp.set(u.id, lag);
    if (lag > k) {
      roundRectPath(ctx, left, top, w * lag, h, 2);
      ctx.fillStyle = 'rgba(255, 244, 220, 0.75)';
      ctx.fill();
    }
    if (k > 0) {
      roundRectPath(ctx, left, top, w * k, h, 2);
      ctx.fillStyle = u.team === 0 ? PALETTE.allyHp : PALETTE.enemyHp;
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(left + 1, top + 0.8, Math.max(0, w * k - 2), 1.4);
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
    ctx.fillStyle = 'rgba(20, 14, 16, 0.8)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(242, 201, 76, 0.6)';
    ctx.stroke();
    const k = Math.max(0, king.hp / king.maxHp);
    const lag = Math.max(k, (this.lagHp.get(king.id) ?? k) - 0.004);
    this.lagHp.set(king.id, lag);
    if (lag > k) {
      roundRectPath(ctx, x, y, w * lag, 14, 5);
      ctx.fillStyle = 'rgba(255, 244, 220, 0.7)';
      ctx.fill();
    }
    roundRectPath(ctx, x, y, w * k, 14, 5);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#c77dff');
    g.addColorStop(1, '#ff7a68');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x + 2, y + 2, Math.max(0, w * k - 4), 3);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (const mark of [0.33, 0.66]) ctx.fillRect(x + w * mark - 1, y - 2, 2, 18);
    ctx.font = `800 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff4dc';
    const phase = ['', '齿轮弹幕', '召唤援军', '横冲直撞'][king.phase] ?? '';
    ctx.fillText(`发条大王 · ${phase}`, world.width / 2, y + 20);
  }

  /** 加时：场地四周亮起一圈缓慢起伏的红光。 */
  private drawOvertime(ctx: CanvasRenderingContext2D, level: number, o: DrawOptions): void {
    const pulse = o.reduceFlashes ? 0.5 : 0.5 + 0.5 * Math.sin(o.time * 3);
    const a = Math.min(0.3, 0.1 + level * 0.03) * (0.7 + pulse * 0.3);
    const edge = 60;
    const w = ARENA.width;
    const h = ARENA.height;
    const sides: Array<[number, number, number, number, number, number, number, number]> = [
      [0, 0, w, edge, 0, 0, 0, edge],
      [0, h - edge, w, edge, 0, h, 0, h - edge],
      [0, 0, edge, h, 0, 0, edge, 0],
      [w - edge, 0, edge, h, w, 0, w - edge, 0],
    ];
    for (const [x, y, sw, sh, x0, y0, x1, y1] of sides) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(255, 80, 60, ${a})`);
      g.addColorStop(1, 'rgba(255, 80, 60, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, sw, sh);
    }
  }

  private drawTargeting(ctx: CanvasRenderingContext2D, t: TargetPreview, time: number): void {
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
  }
}
