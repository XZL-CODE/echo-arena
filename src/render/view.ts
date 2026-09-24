// 画布尺寸与坐标换算：规则层使用固定的竞技场坐标（1200×660），画面按窗口等比缩放。
import { ARENA } from '../core/content/tuning.js';

/** 竞技场四周木框的厚度（竞技场坐标）。 */
export const RAIL = 34;
export const VIEW_W = ARENA.width + RAIL * 2;
export const VIEW_H = ARENA.height + RAIL * 2;

export class View {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  cssW = VIEW_W;
  cssH = VIEW_H;
  dpr = 1;
  /** 每个竞技场单位对应的画布像素数（含 dpr）。 */
  scale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  /** 在给定区域内按比例放下画布，返回是否发生变化。 */
  fit(width: number, height: number): boolean {
    const ratio = VIEW_W / VIEW_H;
    let w = Math.max(200, width);
    let h = w / ratio;
    if (h > height) {
      h = Math.max(120, height);
      w = h * ratio;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.floor(w);
    const cssH = Math.floor(h);
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr) return false;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.scale = this.canvas.width / VIEW_W;
    return true;
  }

  /** 把鼠标位置换算成竞技场坐标。 */
  toArena(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) / rect.width;
    const sy = (clientY - rect.top) / rect.height;
    return { x: sx * VIEW_W - RAIL, y: sy * VIEW_H - RAIL };
  }

  /** 竞技场坐标 → 相对画布左上角的 CSS 像素（用于放置界面提示）。 */
  toCss(x: number, y: number): { x: number; y: number } {
    return { x: ((x + RAIL) / VIEW_W) * this.cssW, y: ((y + RAIL) / VIEW_H) * this.cssH };
  }

  /** 设置为竞技场坐标系（原点在场地左上角）。 */
  arenaTransform(offsetX = 0, offsetY = 0): void {
    const s = this.scale;
    this.ctx.setTransform(s, 0, 0, s, (RAIL + offsetX) * s, (RAIL + offsetY) * s);
  }
}
