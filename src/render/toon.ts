// 玩具质感的绘制工具。主光来自左上方的台灯：受光面亮、背光面暗；
// 背光一侧的边缘带队伍色的反光（我方天青、对手珊瑚），亮面材质有高光，金属多两道环境反射。
// 每个部件用同一条路径叠几层填充，填充自然限定在路径内，不需要裁剪。

export const OUTLINE = '#241a1f';

export interface Mat {
  /** 受光面、固有色、背光面。 */
  light: string;
  base: string;
  dark: string;
  /** 高光强度：0 是哑光（布、木头、绒毛），1 是亮面塑料或金属。 */
  gloss: number;
  /** 金属：加环境反射条纹。 */
  metal?: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Rgb = readonly [number, number, number];

const ALLY_RIM: Rgb = [140, 228, 255];
const ENEMY_RIM: Rgb = [255, 132, 118];
let rim: Rgb = ALLY_RIM;
let rimStrength = 0.8;

/** 设定接下来绘制的单位的边缘反光（按队伍）。 */
export function setRim(team: 0 | 1, strength = 0.8): void {
  rim = team === 0 ? ALLY_RIM : ENEMY_RIM;
  rimStrength = strength;
}

function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

/** 某个时间戳之后 window 秒内从 1 线性降到 0（动作动画用）。 */
export function recent(t: number, stamp: number, window: number): number {
  const dt = t - stamp;
  return dt >= 0 && dt < window ? 1 - dt / window : 0;
}

// ---- 路径 ----

export function circleP(x: number, y: number, r: number): Path2D {
  const p = new Path2D();
  p.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  return p;
}

export function ellipseP(x: number, y: number, rx: number, ry: number, rotation = 0): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rotation, 0, Math.PI * 2);
  return p;
}

export function roundRectP(x: number, y: number, w: number, h: number, r: number): Path2D {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const p = new Path2D();
  p.moveTo(x + radius, y);
  p.lineTo(x + w - radius, y);
  p.arcTo(x + w, y, x + w, y + radius, radius);
  p.lineTo(x + w, y + h - radius);
  p.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  p.lineTo(x + radius, y + h);
  p.arcTo(x, y + h, x, y + h - radius, radius);
  p.lineTo(x, y + radius);
  p.arcTo(x, y, x + radius, y, radius);
  p.closePath();
  return p;
}

/** 折线围成的多边形。 */
export function polyP(points: ReadonlyArray<readonly [number, number]>): Path2D {
  const p = new Path2D();
  points.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
  p.closePath();
  return p;
}

// ---- 上色 ----

/**
 * 画一个有体积的部件：体积渐变 → 金属反射 → 背光边缘反光 → 描边 → 高光。
 * box 是部件的外接框，用来摆放渐变与高光。
 */
export function shade(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  b: Box,
  m: Mat,
  outline = 2.4,
): void {
  const size = Math.max(b.w, b.h);
  const hx = b.x + b.w * 0.34;
  const hy = b.y + b.h * 0.26;
  const body = ctx.createRadialGradient(
    hx,
    hy,
    size * 0.04,
    b.x + b.w * 0.5,
    b.y + b.h * 0.5,
    size * 0.72,
  );
  body.addColorStop(0, m.light);
  body.addColorStop(0.48, m.base);
  body.addColorStop(1, m.dark);
  ctx.fillStyle = body;
  ctx.fill(path);

  if (m.metal) metalBands(ctx, path, b, 0);

  if (rimStrength > 0) {
    const edge = ctx.createRadialGradient(hx, hy, size * 0.5, hx, hy, size * 0.82);
    edge.addColorStop(0, rgba(rim, 0));
    edge.addColorStop(0.45, rgba(rim, 0));
    edge.addColorStop(1, rgba(rim, rimStrength));
    ctx.fillStyle = edge;
    ctx.fill(path);
  }

  if (outline > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(path);
  }
  if (m.gloss > 0) {
    spec(ctx, b.x + b.w * 0.3, b.y + b.h * 0.2, b.w * 0.17, b.h * 0.09, m.gloss);
  }
}

/** 只画体积渐变与描边（小零件用，省掉反光与高光）。 */
export function flat(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  b: Box,
  m: Mat,
  outline = 1.8,
): void {
  const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.4, b.y + b.h);
  g.addColorStop(0, m.light);
  g.addColorStop(0.55, m.base);
  g.addColorStop(1, m.dark);
  ctx.fillStyle = g;
  ctx.fill(path);
  if (outline > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(path);
  }
}

/** 金属表面的环境反射：两道斜向亮带；offset 让亮带随时间滑动（镜甲的流光）。 */
export function metalBands(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  b: Box,
  offset: number,
  strength = 1,
): void {
  const shift = b.w * offset;
  const g = ctx.createLinearGradient(b.x + shift, b.y, b.x + b.w * 0.7 + shift, b.y + b.h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.16, 'rgba(255,255,255,0)');
  g.addColorStop(0.24, `rgba(255,255,255,${0.55 * strength})`);
  g.addColorStop(0.32, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.addColorStop(0.66, `rgba(255,255,255,${0.28 * strength})`);
  g.addColorStop(0.74, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fill(path);
}

/** 镜面高光：一块柔和的大光斑加一个亮点。 */
export function spec(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  strength = 1,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.55);
  ctx.globalAlpha *= 0.4 * strength;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha /= 0.4;
  ctx.globalAlpha *= 0.95;
  ctx.beginPath();
  ctx.ellipse(-rx * 0.25, -ry * 0.1, Math.max(0.4, rx * 0.36), Math.max(0.4, ry * 0.5), 0, 0, 7);
  ctx.fill();
  ctx.restore();
}

/** 一条带描边的线（引信、弓弦、触角）。 */
export function line(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  width: number,
  edge = 1.6,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (edge > 0) {
    ctx.lineWidth = width + edge * 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(path);
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke(path);
}

/** 以 lighter 叠加的一团柔光（发光的眼睛、火星、能量核心）。 */
export function glowDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void {
  if (r <= 0 || alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha /= alpha;
  ctx.globalCompositeOperation = op;
}

// ---- 表情 ----

export type Expr = 'normal' | 'angry' | 'hurt' | 'dizzy' | 'focus' | 'happy';

export interface EyeStyle {
  /** 眼白与瞳孔。 */
  white?: string;
  iris?: string;
  /** 眼皮的颜色（与脸同色），眯眼、生气时用来切掉眼睛上半。 */
  lid: string;
}

/**
 * 一对大眼睛。look 是视线偏移（-1..1），blink 为真时闭眼；
 * 生气时眉毛压低、眼皮斜切，受击时挤成 >_<，被撞晕时转圈圈。
 */
export function eyes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  gap: number,
  size: number,
  look: { x: number; y: number },
  expr: Expr,
  blink: boolean,
  t: number,
  style: EyeStyle,
): void {
  for (const side of [-1, 1] as const) {
    const ex = cx + side * gap;
    if (expr === 'hurt') {
      ctx.beginPath();
      ctx.moveTo(ex - side * size * 0.8, cy - size * 0.7);
      ctx.lineTo(ex + side * size * 0.55, cy);
      ctx.lineTo(ex - side * size * 0.8, cy + size * 0.7);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.6, size * 0.38);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      continue;
    }
    if (expr === 'dizzy') {
      ctx.beginPath();
      for (let i = 0; i <= 18; i++) {
        const a = t * 9 * side + i * 0.62;
        const rr = size * 0.9 * (i / 18);
        const px = ex + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = Math.max(1.2, size * 0.24);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      continue;
    }
    if (blink || expr === 'happy') {
      ctx.beginPath();
      if (expr === 'happy')
        ctx.arc(ex, cy + size * 0.35, size * 0.75, Math.PI * 1.15, Math.PI * 1.85);
      else {
        ctx.moveTo(ex - size * 0.8, cy + size * 0.1);
        ctx.quadraticCurveTo(ex, cy + size * 0.55, ex + size * 0.8, cy + size * 0.1);
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.4, size * 0.3);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      continue;
    }
    const rx = size * 0.8;
    const ry = size;
    // 眼白
    ctx.beginPath();
    ctx.ellipse(ex, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = style.white ?? '#fffdf6';
    ctx.fill();
    // 瞳孔跟着视线
    const px = ex + look.x * rx * 0.38;
    const py = cy + look.y * ry * 0.3 + size * 0.06;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(px, py, rx * 0.62, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = style.iris ?? '#3b2a4a';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px, py + ry * 0.05, rx * 0.36, ry * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    // 上眼皮：生气时向鼻梁一侧斜压下来，专注时压得浅一些
    const lidDrop = expr === 'angry' ? 0.34 : expr === 'focus' ? 0.22 : 0;
    if (lidDrop > 0) {
      ctx.beginPath();
      const tilt = -side * ry * (expr === 'angry' ? 0.5 : 0.3);
      ctx.moveTo(ex - rx * 1.3, cy - ry * 1.2);
      ctx.lineTo(ex + rx * 1.3, cy - ry * 1.2);
      ctx.lineTo(ex + rx * 1.3, cy - ry + ry * 2 * lidDrop + tilt);
      ctx.lineTo(ex - rx * 1.3, cy - ry + ry * 2 * lidDrop - tilt);
      ctx.closePath();
      ctx.fillStyle = style.lid;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ex - rx * 1.3, cy - ry + ry * 2 * lidDrop - tilt);
      ctx.lineTo(ex + rx * 1.3, cy - ry + ry * 2 * lidDrop + tilt);
      ctx.lineWidth = Math.max(1.2, size * 0.26);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    } else {
      // 眼眶上沿的一点阴影
      const g = ctx.createLinearGradient(0, cy - ry, 0, cy - ry * 0.2);
      g.addColorStop(0, 'rgba(40, 24, 50, 0.35)');
      g.addColorStop(1, 'rgba(40, 24, 50, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(ex - rx, cy - ry, rx * 2, ry);
    }
    ctx.restore();
    // 眼眶描边与两个反光点
    ctx.beginPath();
    ctx.ellipse(ex, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.1, size * 0.2);
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    if (lidDrop < 0.5) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px - rx * 0.22, py - ry * 0.28, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px + rx * 0.2, py + ry * 0.2, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    if (expr === 'angry') {
      // 眉毛外高内低
      ctx.beginPath();
      ctx.moveTo(ex + side * rx * 1.15, cy - ry * 1.5);
      ctx.lineTo(ex - side * rx * 0.95, cy - ry * 0.95);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.6, size * 0.34);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
  }
}

/** 腮红。 */
export function blush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255, 120, 140, 0.55)');
  g.addColorStop(1, 'rgba(255, 120, 140, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}
