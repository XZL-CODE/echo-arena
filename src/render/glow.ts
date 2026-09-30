// 发光与贴图缓存。
// 泛光层：发光的东西（弹丸、拖尾、闪电、光圈、火花）另画一份到低分辨率画布，
// 模糊后用 lighter 叠回主画面，看起来会“溢光”。贴图（柔光点、烟团、焦痕）预先画好，每帧直接贴。
import { RAIL, type View } from './view.js';

/** 泛光层相对主画布的分辨率。 */
const FACTOR = 0.25;

export class GlowLayer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly soft: HTMLCanvasElement;
  private readonly softCtx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.soft = document.createElement('canvas');
    this.softCtx = this.soft.getContext('2d') as CanvasRenderingContext2D;
  }

  /** 按主画布尺寸准备，并切到竞技场坐标系。 */
  begin(view: View, shakeX: number, shakeY: number): CanvasRenderingContext2D {
    const w = Math.max(1, Math.round(view.canvas.width * FACTOR));
    const h = Math.max(1, Math.round(view.canvas.height * FACTOR));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.soft.width = Math.max(1, Math.round(w / 2));
      this.soft.height = Math.max(1, Math.round(h / 2));
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    const s = view.scale * FACTOR;
    ctx.setTransform(s, 0, 0, s, (RAIL + shakeX) * s, (RAIL + shakeY) * s);
    // 泛光层里用普通叠加：同一处叠得再多也只是那种颜色，不会糊成一片白。
    ctx.globalCompositeOperation = 'source-over';
    return ctx;
  }

  /** 模糊后叠回主画面。strength 0..1。 */
  composite(target: CanvasRenderingContext2D, strength: number): void {
    if (strength <= 0) return;
    // 再缩小一半（相当于一次盒式模糊），放大贴回去时的双线性插值把光晕抹开；不用 filter，软件渲染时也不慢。
    const sw = this.soft.width;
    const sh = this.soft.height;
    const s = this.softCtx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, sw, sh);
    s.imageSmoothingEnabled = true;
    s.drawImage(this.canvas, 0, 0, sw, sh);
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = 'lighter';
    target.imageSmoothingEnabled = true;
    target.globalAlpha = strength;
    target.drawImage(this.soft, 0, 0, sw, sh, 0, 0, target.canvas.width, target.canvas.height);
    target.restore();
  }
}

// ---- 贴图 ----

const glowCache = new Map<string, HTMLCanvasElement>();
const smokeCache = new Map<string, HTMLCanvasElement>();
let scorch: HTMLCanvasElement | null = null;

function sprite(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  paint(c.getContext('2d') as CanvasRenderingContext2D, size);
  return c;
}

/** 某种颜色的柔光点：中心接近白色，向外渐隐（以 lighter 叠加）。 */
export function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (!c) {
    c = sprite(64, (ctx, size) => {
      // 中心只是颜色本身，不是纯白：好几团叠在一起也不会糊成一片白。
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, withAlpha(color, 0.85));
      g.addColorStop(0.3, withAlpha(color, 0.45));
      g.addColorStop(0.65, withAlpha(color, 0.12));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
    glowCache.set(color, c);
  }
  return c;
}

/** 烟团：边缘不规则的一团柔和颜色（正常叠加）。 */
export function smokeSprite(color: string): HTMLCanvasElement {
  let c = smokeCache.get(color);
  if (!c) {
    c = sprite(64, (ctx, size) => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const x = size / 2 + Math.cos(a) * size * 0.14;
        const y = size / 2 + Math.sin(a) * size * 0.14;
        const r = size * (0.24 + (i % 3) * 0.04);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, withAlpha(color, 0.5));
        g.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
    });
    smokeCache.set(color, c);
  }
  return c;
}

/** 爆炸留在毛毡上的焦痕。 */
export function scorchSprite(): HTMLCanvasElement {
  if (scorch) return scorch;
  scorch = sprite(128, (ctx, size) => {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(18, 12, 8, 0.55)');
    g.addColorStop(0.4, 'rgba(22, 16, 10, 0.38)');
    g.addColorStop(0.75, 'rgba(22, 16, 10, 0.1)');
    g.addColorStop(1, 'rgba(22, 16, 10, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // 几道短短的放射烧痕，边缘不规则
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.5;
      const r0 = c * 0.3;
      const r1 = c * (0.55 + rand() * 0.25);
      const lg = ctx.createLinearGradient(
        c + Math.cos(a) * r0,
        c + Math.sin(a) * r0,
        c + Math.cos(a) * r1,
        c + Math.sin(a) * r1,
      );
      lg.addColorStop(0, 'rgba(16, 10, 6, 0.16)');
      lg.addColorStop(1, 'rgba(16, 10, 6, 0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 4 + rand() * 5;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      ctx.stroke();
    }
  });
  return scorch;
}

/** '#rrggbb' 或 'rgb(...)'/'rgba(...)' 换成指定透明度。 */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.length === 4 ? color.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : color;
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const m = color.match(/rgba?\(([^,]+),([^,]+),([^,)]+)/);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  return color;
}
