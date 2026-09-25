// Canvas 路径小工具。自己实现圆角矩形等形状，避免依赖部分浏览器才有的 API。

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

export function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

export function ellipsePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
}

/** 星形（命中火花、晕眩星星）。 */
export function starPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number,
  outer: number,
  inner: number,
  rotation = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i * Math.PI) / points - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 齿轮（发条大王的弹幕、装饰）。 */
export function gearPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  teeth: number,
  rotation = 0,
): void {
  ctx.beginPath();
  const inner = r * 0.74;
  for (let i = 0; i < teeth * 4; i++) {
    const a = rotation + (i / (teeth * 4)) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
