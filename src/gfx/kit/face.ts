// 脸：眼睛、嘴巴、腮红是贴在头部椭球表面的小曲面片，贴图是程序绘制的表情图集。
// 眼睛有两种画法：动漫眼（人形态，虹膜渐变、双高光、睫毛、眉毛）和萌宠眼（幼年与进化形态，大而亮的豆豆眼）。
import * as THREE from 'three';
import type { ToonUniforms } from '../toon.js';
import type { V3 } from './geo.js';

/** anime 圆润的动漫眼；sharp 细长上挑的帅气眼；mascot 萌宠豆豆眼；fierce 带点凶的兽眼。 */
export type EyeStyle = 'anime' | 'sharp' | 'mascot' | 'fierce';
export type Expression =
  'normal' | 'angry' | 'happy' | 'hurt' | 'ko' | 'focus' | 'closed' | 'shout';
export type MouthStyle = 'smile' | 'cat' | 'beak' | 'none';

export interface FaceSpec {
  bone: string;
  /** 头部椭球中心（骨头局部坐标）与半径。 */
  center: V3;
  radii: V3;
  eyes: {
    /** 左眼的水平角（从正前方 +Z 往 +X，弧度）与俯仰角。右眼镜像。 */
    yaw: number;
    pitch: number;
    width: number;
    height: number;
    style: EyeStyle;
    iris: THREE.ColorRepresentation;
    /** 虹膜下半部的亮色。 */
    glow?: THREE.ColorRepresentation;
    lash?: THREE.ColorRepresentation;
    /** 两眼略微朝内或朝外倾斜（弧度）。 */
    tilt?: number;
  };
  /** 嘴巴可以贴在另一个椭球上（口鼻部）。 */
  mouth?: {
    pitch: number;
    width: number;
    height: number;
    style: MouthStyle;
    yaw?: number;
    center?: V3;
    radii?: V3;
  };
  blush?: {
    yaw: number;
    pitch: number;
    width: number;
    height: number;
    color?: THREE.ColorRepresentation;
  };
  /** 眼睛表情的默认值。 */
  resting?: Expression;
}

const EYE_CELL: Record<string, number> = {
  open: 0,
  half: 1,
  closed: 2,
  happy: 3,
  angry: 4,
  hurt: 5,
  ko: 6,
  focus: 7,
};
const MOUTH_CELL = {
  smile: 0,
  cat: 1,
  open: 2,
  o: 3,
  grin: 4,
  wavy: 5,
  flat: 6,
  shout: 7,
} as const;
type MouthCell = keyof typeof MOUTH_CELL;

const atlasCache = new Map<string, THREE.CanvasTexture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  return [c, ctx];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

/** 颜色 → CSS 字符串（在 sRGB 空间里乘亮度、加白）。 */
function css(color: THREE.ColorRepresentation, mul = 1, add = 0): string {
  const srgb = new THREE.Color(color).convertLinearToSRGB();
  const f = (v: number) => Math.max(0, Math.min(255, Math.round((v * mul + add) * 255)));
  return `rgb(${f(srgb.r)},${f(srgb.g)},${f(srgb.b)})`;
}

// ---------------------------------------------------------------------------
// 眼睛图集：4 × 2 格，每格 256 像素。画的是观众左手边那只眼（外眼角在左）。

const S = 256;

/** 当前绘制的眼型（画图集前设置）：h 眼眶高度、iris 虹膜宽度、lash 睫毛粗细与眼尾上挑。 */
interface EyeShape {
  h: number;
  iris: number;
  lash: number;
}
const ROUND: EyeShape = { h: 1, iris: 1, lash: 1 };
const SHARP: EyeShape = { h: 0.72, iris: 0.86, lash: 1.35 };
let shape: EyeShape = ROUND;

interface EyeInk {
  iris: THREE.ColorRepresentation;
  glow: THREE.ColorRepresentation;
  lash: THREE.ColorRepresentation;
}

/** 眼眶轮廓：lid ∈ [0,1] 表示上眼皮往下合的程度。 */
function eyeOpening(ctx: CanvasRenderingContext2D, lid: number, slant = 0): void {
  const cx = S * 0.5;
  const cy = S * 0.58;
  const w = S * 0.3;
  const h = S * 0.36 * shape.h;
  const outer = { x: cx - w, y: cy - h * 0.05 };
  const inner = { x: cx + w * 0.98, y: cy - h * 0.12 };
  const bottom = cy + h * 0.78;
  const top = cy - h * (1 - lid * 1.72);
  ctx.beginPath();
  ctx.moveTo(outer.x, outer.y + lid * h * 0.35 + slant * -h * 0.25);
  ctx.bezierCurveTo(
    cx - w * 0.8,
    top - h * 0.1 + slant * -h * 0.4,
    cx + w * 0.55,
    top - h * 0.12 + slant * h * 0.35,
    inner.x,
    inner.y + lid * h * 0.4 + slant * h * 0.45,
  );
  ctx.bezierCurveTo(
    cx + w * 0.9,
    bottom - h * 0.1,
    cx - w * 0.75,
    bottom + h * 0.05,
    outer.x,
    outer.y + lid * h * 0.35 + slant * -h * 0.25,
  );
  ctx.closePath();
}

function upperLidPath(ctx: CanvasRenderingContext2D, lid: number, slant = 0): void {
  const cx = S * 0.5;
  const cy = S * 0.58;
  const w = S * 0.3;
  const h = S * 0.36 * shape.h;
  const top = cy - h * (1 - lid * 1.72);
  ctx.beginPath();
  ctx.moveTo(cx - w * 1.12, cy - h * 0.02 + lid * h * 0.35 + slant * -h * 0.25);
  ctx.bezierCurveTo(
    cx - w * 0.8,
    top - h * 0.1 + slant * -h * 0.4,
    cx + w * 0.55,
    top - h * 0.12 + slant * h * 0.35,
    cx + w * 0.98,
    cy - h * 0.12 + lid * h * 0.4 + slant * h * 0.45,
  );
}

function drawAnimeEye(
  ctx: CanvasRenderingContext2D,
  ink: EyeInk,
  lid: number,
  slant: number,
  brow: number,
): void {
  const cx = S * 0.5;
  const cy = S * 0.58;
  const w = S * 0.3;
  const h = S * 0.36 * shape.h;
  ctx.save();
  eyeOpening(ctx, lid, slant);
  ctx.clip();
  // 眼白：上缘带一点眼皮投下的冷色阴影。
  const sclera = ctx.createLinearGradient(0, cy - h, 0, cy + h);
  sclera.addColorStop(0, '#c9cfe6');
  sclera.addColorStop(0.35, '#f4f6ff');
  sclera.addColorStop(1, '#ffffff');
  ctx.fillStyle = sclera;
  ctx.fillRect(0, 0, S, S);
  // 虹膜：上深下亮的竖椭圆。
  const ix = cx + w * 0.06;
  const iy = cy + h * 0.14;
  const irx = w * 0.66 * shape.iris;
  const iry = h * (shape.h < 1 ? 1.05 : 0.86);
  const grad = ctx.createLinearGradient(0, iy - iry, 0, iy + iry);
  grad.addColorStop(0, css(ink.iris, 0.28));
  grad.addColorStop(0.45, css(ink.iris, 0.85));
  grad.addColorStop(0.8, css(ink.glow, 1.1, 0.04));
  grad.addColorStop(1, css(ink.glow, 1.25, 0.12));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2);
  ctx.fill();
  // 虹膜外圈与内圈光环
  ctx.lineWidth = S * 0.018;
  ctx.strokeStyle = css(ink.iris, 0.22);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = css(ink.glow, 1.3, 0.2);
  ctx.lineWidth = S * 0.012;
  ctx.beginPath();
  ctx.ellipse(ix, iy + iry * 0.05, irx * 0.72, iry * 0.72, 0, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 瞳孔
  ctx.fillStyle = css(ink.iris, 0.12);
  ctx.beginPath();
  ctx.ellipse(ix, iy - iry * 0.08, irx * 0.36, iry * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  // 高光：左上一大块、右下一小点、再加一粒星光
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(ix - irx * 0.36, iy - iry * 0.42, irx * 0.3, iry * 0.26, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(ix + irx * 0.38, iy + iry * 0.36, irx * 0.14, iry * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(ix - irx * 0.05, iy + iry * 0.2, irx * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // 上眼皮投在眼球上的阴影
  const shade = ctx.createLinearGradient(
    0,
    cy - h * (1 - lid * 1.72) - h * 0.1,
    0,
    cy - h * 0.2 + lid * h,
  );
  shade.addColorStop(0, 'rgba(40,20,50,0.45)');
  shade.addColorStop(1, 'rgba(40,20,50,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  // 上睫毛：外侧更粗，末端上挑
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(ink.lash);
  ctx.lineWidth = S * 0.05 * shape.lash;
  upperLidPath(ctx, lid, slant);
  ctx.stroke();
  ctx.fillStyle = css(ink.lash);
  const ox = cx - w * 1.12;
  const oy = cy - h * 0.02 + lid * h * 0.35 + slant * -h * 0.25;
  const fl = shape.lash;
  ctx.beginPath();
  ctx.moveTo(ox + S * 0.05, oy - S * 0.03);
  ctx.quadraticCurveTo(
    ox - S * 0.06 * fl,
    oy - S * 0.05 * fl,
    ox - S * 0.09 * fl,
    oy - S * 0.1 * fl,
  );
  ctx.quadraticCurveTo(ox - S * 0.02, oy + S * 0.0, ox + S * 0.04, oy + S * 0.03);
  ctx.closePath();
  ctx.fill();
  // 下眼睑：外侧一小段细线
  ctx.lineWidth = S * 0.016;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.9, cy + h * 0.35);
  ctx.quadraticCurveTo(cx - w * 0.5, cy + h * 0.86, cx + w * 0.1, cy + h * 0.84);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 眉毛：brow 为倾斜量（正数 = 生气，内侧压低）
  ctx.lineWidth = S * 0.028;
  ctx.beginPath();
  const by = cy - h * 1.3;
  ctx.moveTo(cx - w * 0.95, by + S * 0.02 - brow * S * 0.03);
  ctx.quadraticCurveTo(
    cx - w * 0.1,
    by - S * 0.04 - brow * S * 0.01,
    cx + w * 0.85,
    by + brow * S * 0.07,
  );
  ctx.stroke();
  ctx.restore();
}

function drawMascotEye(
  ctx: CanvasRenderingContext2D,
  ink: EyeInk,
  lid: number,
  slant: number,
): void {
  const cx = S * 0.5;
  const cy = S * 0.55;
  const rx = S * 0.25;
  const ry = S * 0.34;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  if (lid > 0 || slant !== 0) {
    // 上眼皮：用裁剪去掉上面一截（露出头部本身的颜色）
    ctx.beginPath();
    const top = cy - ry + lid * ry * 1.7;
    ctx.moveTo(0, top - slant * S * 0.12);
    ctx.lineTo(S, top + slant * S * 0.12);
    ctx.lineTo(S, S);
    ctx.lineTo(0, S);
    ctx.closePath();
    ctx.clip();
  }
  const grad = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
  grad.addColorStop(0, css(ink.iris, 0.18));
  grad.addColorStop(0.55, css(ink.iris, 0.4));
  grad.addColorStop(0.85, css(ink.glow, 0.95));
  grad.addColorStop(1, css(ink.glow, 1.2, 0.1));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // 瞳孔
  ctx.fillStyle = 'rgba(8,6,16,0.9)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.08, rx * 0.62, ry * 0.66, 0, 0, Math.PI * 2);
  ctx.fill();
  // 下半圈亮色反光
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = css(ink.glow, 1.3, 0.15);
  ctx.lineWidth = S * 0.035;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.05, rx * 0.72, ry * 0.76, 0, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 大高光 + 小高光
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.32, cy - ry * 0.4, rx * 0.36, ry * 0.26, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + rx * 0.38, cy + ry * 0.32, rx * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 轮廓
  ctx.save();
  ctx.strokeStyle = css(ink.lash);
  ctx.lineWidth = S * 0.03;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (lid > 0 || slant !== 0) {
    ctx.save();
    ctx.clip();
    ctx.lineWidth = S * 0.06;
    ctx.beginPath();
    const top = cy - ry + lid * ry * 1.7;
    ctx.moveTo(0, top - slant * S * 0.12);
    ctx.lineTo(S, top + slant * S * 0.12);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** 闭眼、笑眼等只画线的表情。 */
function drawLineEye(
  ctx: CanvasRenderingContext2D,
  ink: EyeInk,
  kind: 'closed' | 'happy' | 'hurt' | 'ko',
  anime: boolean,
): void {
  const cx = S * 0.5;
  const cy = S * 0.6;
  const w = S * (anime ? 0.3 : 0.24);
  ctx.save();
  ctx.strokeStyle = css(ink.lash);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = S * (anime ? 0.05 : 0.06);
  ctx.beginPath();
  if (kind === 'closed') {
    ctx.moveTo(cx - w, cy - S * 0.02);
    ctx.quadraticCurveTo(cx, cy + S * 0.12, cx + w, cy - S * 0.02);
    if (anime) {
      ctx.moveTo(cx - w, cy - S * 0.02);
      ctx.lineTo(cx - w - S * 0.06, cy - S * 0.07);
    }
  } else if (kind === 'happy') {
    ctx.moveTo(cx - w, cy + S * 0.06);
    ctx.quadraticCurveTo(cx, cy - S * 0.16, cx + w, cy + S * 0.06);
  } else if (kind === 'hurt') {
    ctx.moveTo(cx - w * 0.9, cy - S * 0.14);
    ctx.lineTo(cx + w * 0.8, cy);
    ctx.lineTo(cx - w * 0.9, cy + S * 0.14);
  } else {
    // 晕眩：螺旋
    for (let i = 0; i <= 60; i++) {
      const a = i * 0.32;
      const r = (i / 60) * w * 0.95;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function eyeAtlas(style: EyeStyle, ink: EyeInk): THREE.CanvasTexture {
  shape = style === 'sharp' ? SHARP : ROUND;
  const key = `${style}|${new THREE.Color(ink.iris).getHexString()}|${new THREE.Color(ink.glow).getHexString()}|${new THREE.Color(ink.lash).getHexString()}`;
  const cached = atlasCache.get(key);
  if (cached) return cached;
  const [c, ctx] = canvas(S * 4, S * 2);
  const anime = style === 'anime' || style === 'sharp';
  const fierce = style === 'fierce';
  const cells: Array<[string, (ctx: CanvasRenderingContext2D) => void]> = [
    [
      'open',
      (g) =>
        anime
          ? drawAnimeEye(g, ink, 0, 0, 0)
          : drawMascotEye(g, ink, fierce ? 0.14 : 0, fierce ? 0.45 : 0),
    ],
    [
      'half',
      (g) =>
        anime ? drawAnimeEye(g, ink, 0.5, 0, 0) : drawMascotEye(g, ink, 0.5, fierce ? 0.3 : 0),
    ],
    ['closed', (g) => drawLineEye(g, ink, 'closed', anime)],
    ['happy', (g) => drawLineEye(g, ink, 'happy', anime)],
    [
      'angry',
      (g) => (anime ? drawAnimeEye(g, ink, 0.18, 0.55, 1) : drawMascotEye(g, ink, 0.2, 0.9)),
    ],
    ['hurt', (g) => drawLineEye(g, ink, 'hurt', anime)],
    ['ko', (g) => drawLineEye(g, ink, 'ko', anime)],
    [
      'focus',
      (g) => (anime ? drawAnimeEye(g, ink, 0.24, 0.15, 0.6) : drawMascotEye(g, ink, 0.26, 0.45)),
    ],
  ];
  for (const [name, draw] of cells) {
    const i = EYE_CELL[name] as number;
    ctx.save();
    ctx.translate((i % 4) * S, Math.floor(i / 4) * S);
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    draw(ctx);
    ctx.restore();
  }
  shape = ROUND;
  const t = texture(c);
  atlasCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// 嘴巴图集：4 × 2 格，每格 128 像素。

const M = 128;

function mouthAtlas(): THREE.CanvasTexture {
  const cached = atlasCache.get('mouth');
  if (cached) return cached;
  const [c, ctx] = canvas(M * 4, M * 2);
  const line = '#4a1f2e';
  const inside = '#7d2436';
  const tongue = '#f07c8a';
  const draw: Record<MouthCell, () => void> = {
    smile: () => {
      ctx.beginPath();
      ctx.moveTo(M * 0.3, M * 0.45);
      ctx.quadraticCurveTo(M * 0.5, M * 0.62, M * 0.7, M * 0.45);
      ctx.stroke();
    },
    cat: () => {
      ctx.beginPath();
      ctx.moveTo(M * 0.2, M * 0.42);
      ctx.quadraticCurveTo(M * 0.33, M * 0.62, M * 0.5, M * 0.44);
      ctx.quadraticCurveTo(M * 0.67, M * 0.62, M * 0.8, M * 0.42);
      ctx.stroke();
    },
    open: () => {
      ctx.beginPath();
      ctx.moveTo(M * 0.3, M * 0.4);
      ctx.quadraticCurveTo(M * 0.5, M * 0.46, M * 0.7, M * 0.4);
      ctx.quadraticCurveTo(M * 0.66, M * 0.78, M * 0.5, M * 0.8);
      ctx.quadraticCurveTo(M * 0.34, M * 0.78, M * 0.3, M * 0.4);
      ctx.closePath();
      ctx.fillStyle = inside;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = tongue;
      ctx.beginPath();
      ctx.ellipse(M * 0.5, M * 0.8, M * 0.16, M * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.stroke();
    },
    o: () => {
      ctx.beginPath();
      ctx.ellipse(M * 0.5, M * 0.52, M * 0.09, M * 0.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = inside;
      ctx.fill();
      ctx.stroke();
    },
    grin: () => {
      ctx.beginPath();
      ctx.moveTo(M * 0.24, M * 0.4);
      ctx.quadraticCurveTo(M * 0.5, M * 0.5, M * 0.76, M * 0.4);
      ctx.quadraticCurveTo(M * 0.6, M * 0.7, M * 0.5, M * 0.7);
      ctx.quadraticCurveTo(M * 0.4, M * 0.7, M * 0.24, M * 0.4);
      ctx.closePath();
      ctx.fillStyle = inside;
      ctx.fill();
      ctx.stroke();
      // 小虎牙
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(M * 0.34, M * 0.44);
      ctx.lineTo(M * 0.4, M * 0.45);
      ctx.lineTo(M * 0.37, M * 0.54);
      ctx.closePath();
      ctx.fill();
    },
    wavy: () => {
      ctx.beginPath();
      ctx.moveTo(M * 0.26, M * 0.5);
      for (let i = 1; i <= 4; i++) {
        ctx.quadraticCurveTo(
          M * (0.26 + (i - 0.5) * 0.12),
          M * (i % 2 ? 0.4 : 0.6),
          M * (0.26 + i * 0.12),
          M * 0.5,
        );
      }
      ctx.stroke();
    },
    flat: () => {
      ctx.beginPath();
      ctx.moveTo(M * 0.36, M * 0.5);
      ctx.lineTo(M * 0.64, M * 0.49);
      ctx.stroke();
    },
    shout: () => {
      ctx.beginPath();
      ctx.moveTo(M * 0.26, M * 0.32);
      ctx.quadraticCurveTo(M * 0.5, M * 0.28, M * 0.74, M * 0.32);
      ctx.quadraticCurveTo(M * 0.7, M * 0.9, M * 0.5, M * 0.9);
      ctx.quadraticCurveTo(M * 0.3, M * 0.9, M * 0.26, M * 0.32);
      ctx.closePath();
      ctx.fillStyle = inside;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = tongue;
      ctx.beginPath();
      ctx.ellipse(M * 0.5, M * 0.92, M * 0.2, M * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(M * 0.3, M * 0.3, M * 0.4, M * 0.06);
      ctx.restore();
      ctx.stroke();
    },
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const name of Object.keys(MOUTH_CELL) as MouthCell[]) {
    const i = MOUTH_CELL[name];
    ctx.save();
    ctx.translate((i % 4) * M, Math.floor(i / 4) * M);
    ctx.strokeStyle = line;
    ctx.lineWidth = M * 0.055;
    draw[name]();
    ctx.restore();
  }
  const t = texture(c);
  atlasCache.set('mouth', t);
  return t;
}

function blushTexture(): THREE.CanvasTexture {
  const cached = atlasCache.get('blush');
  if (cached) return cached;
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // 三道斜线：动漫里的害羞腮红
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 3;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(26 + i * 10, 38);
    ctx.lineTo(32 + i * 10, 26);
    ctx.stroke();
  }
  const t = texture(c);
  atlasCache.set('blush', t);
  return t;
}

// ---------------------------------------------------------------------------

/** 贴在椭球表面的曲面片：u 朝 +X，v 朝上。 */
function surfacePatch(
  center: V3,
  radii: V3,
  yaw: number,
  pitch: number,
  width: number,
  height: number,
  lift = 0.012,
  seg = 8,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const u = i / seg - 0.5;
      const v = j / seg - 0.5;
      const a = yaw + u * width;
      const b = pitch + v * height;
      const dx = Math.sin(a) * Math.cos(b);
      const dy = Math.sin(b);
      const dz = Math.cos(a) * Math.cos(b);
      const k = 1 + lift;
      positions.push(
        center[0] + dx * radii[0] * k,
        center[1] + dy * radii[1] * k,
        center[2] + dz * radii[2] * k,
      );
      const n = new THREE.Vector3(dx / radii[0], dy / radii[1], dz / radii[2]).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(u + 0.5, v + 0.5);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

function decalMaterial(
  map: THREE.Texture,
  toon: ToonUniforms,
  cols: number,
  rows: number,
  flip: boolean,
  tint: THREE.ColorRepresentation = 0xffffff,
  opacity = 1,
): THREE.ShaderMaterial & { uniforms: { uCell: { value: THREE.Vector2 } } } {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uCell: { value: new THREE.Vector2(0, 0) },
      uGrid: { value: new THREE.Vector2(cols, rows) },
      uFlip: { value: flip ? 1 : 0 },
      uTint: { value: new THREE.Color(tint) },
      uOpacity: { value: opacity },
      uFlash: toon.uFlash,
      uDissolve: toon.uDissolve,
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uCell;
      uniform vec2 uGrid;
      uniform float uFlip;
      uniform vec3 uTint;
      uniform float uOpacity;
      uniform vec4 uFlash;
      uniform float uDissolve;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        if (uFlip > 0.5) uv.x = 1.0 - uv.x;
        vec2 cell = vec2(uCell.x, uGrid.y - 1.0 - uCell.y);
        vec4 c = texture2D(map, (cell + uv) / uGrid);
        c.rgb *= uTint;
        c.rgb = mix(c.rgb, uFlash.rgb, uFlash.a);
        c.a *= uOpacity * (1.0 - smoothstep(0.05, 0.3, uDissolve));
        if (c.a < 0.01) discard;
        gl_FragColor = c;
        #include <colorspace_fragment>
      }
    `,
  });
  return m as THREE.ShaderMaterial & { uniforms: { uCell: { value: THREE.Vector2 } } };
}

const _rng = { seed: 1 };
function nextRandom(): number {
  _rng.seed = (_rng.seed * 16807) % 2147483647;
  return _rng.seed / 2147483647;
}

/** 一张脸的实例：表情切换与自动眨眼。 */
export class FaceRig {
  readonly group = new THREE.Group();
  readonly spec: FaceSpec;
  expression: Expression;
  /** 嘴型覆盖（攻击时喊叫等），null 用表情默认。 */
  mouthOverride: MouthCell | null = null;
  private eyes: Array<THREE.Mesh<THREE.BufferGeometry, ReturnType<typeof decalMaterial>>> = [];
  private mouth: THREE.Mesh<THREE.BufferGeometry, ReturnType<typeof decalMaterial>> | null = null;
  private blinkTimer: number;
  private blinkLeft = 0;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  constructor(spec: FaceSpec, toon: ToonUniforms) {
    this.spec = spec;
    this.expression = spec.resting ?? 'normal';
    this.blinkTimer = 1 + nextRandom() * 3;
    const e = spec.eyes;
    const ink: EyeInk = {
      iris: e.iris,
      glow: e.glow ?? new THREE.Color(e.iris).lerp(new THREE.Color(0xffffff), 0.35),
      lash: e.lash ?? 0x2a1a2e,
    };
    const atlas = eyeAtlas(e.style, ink);
    for (const side of [1, -1]) {
      const g = surfacePatch(spec.center, spec.radii, e.yaw * side, e.pitch, e.width, e.height);
      if (e.tilt) {
        // 以眼睛中心为轴轻微倾斜
        const c = new THREE.Vector3(
          spec.center[0] + Math.sin(e.yaw * side) * Math.cos(e.pitch) * spec.radii[0],
          spec.center[1] + Math.sin(e.pitch) * spec.radii[1],
          spec.center[2] + Math.cos(e.yaw * side) * Math.cos(e.pitch) * spec.radii[2],
        );
        const n = c
          .clone()
          .sub(new THREE.Vector3(...spec.center))
          .normalize();
        g.translate(-c.x, -c.y, -c.z);
        g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(n, -e.tilt * side));
        g.translate(c.x, c.y, c.z);
      }
      // 观众左手边的眼睛（-X）用原图，另一只左右翻转。
      const m = decalMaterial(atlas, toon, 4, 2, side > 0);
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 3;
      this.eyes.push(mesh);
      this.group.add(mesh);
      this.geometries.push(g);
      this.materials.push(m);
    }
    if (spec.mouth && spec.mouth.style !== 'none') {
      const mo = spec.mouth;
      const g = surfacePatch(
        mo.center ?? spec.center,
        mo.radii ?? spec.radii,
        mo.yaw ?? 0,
        mo.pitch,
        mo.width,
        mo.height,
        0.01,
        6,
      );
      const m = decalMaterial(mouthAtlas(), toon, 4, 2, false);
      this.mouth = new THREE.Mesh(g, m);
      this.mouth.renderOrder = 3;
      this.group.add(this.mouth);
      this.geometries.push(g);
      this.materials.push(m);
    }
    if (spec.blush) {
      const b = spec.blush;
      for (const side of [1, -1]) {
        const g = surfacePatch(
          spec.center,
          spec.radii,
          b.yaw * side,
          b.pitch,
          b.width,
          b.height,
          0.008,
          4,
        );
        const m = decalMaterial(blushTexture(), toon, 1, 1, false, b.color ?? 0xff8fa8, 0.55);
        const mesh = new THREE.Mesh(g, m);
        mesh.renderOrder = 2;
        this.group.add(mesh);
        this.geometries.push(g);
        this.materials.push(m);
      }
    }
    this.apply();
  }

  set(expression: Expression): void {
    if (this.expression === expression) return;
    this.expression = expression;
    this.apply();
  }

  update(_time: number, dt: number): void {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkLeft <= 0) {
      this.blinkLeft = 0.13;
      this.blinkTimer = 2 + nextRandom() * 3.5;
      if (nextRandom() < 0.18) this.blinkTimer = 0.25;
    }
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
      this.apply();
    } else if (this.blinkLeft > -1) {
      this.blinkLeft = -2;
      this.apply();
    }
  }

  private apply(): void {
    let eye = 'open';
    const expr = this.expression;
    if (expr === 'angry' || expr === 'shout') eye = 'angry';
    else if (expr === 'happy') eye = 'happy';
    else if (expr === 'hurt') eye = 'hurt';
    else if (expr === 'ko') eye = 'ko';
    else if (expr === 'focus') eye = 'focus';
    else if (expr === 'closed') eye = 'closed';
    const blinking = this.blinkLeft > 0 && (eye === 'open' || eye === 'focus' || eye === 'angry');
    if (blinking) eye = this.blinkLeft > 0.09 || this.blinkLeft < 0.03 ? 'half' : 'closed';
    const cell = EYE_CELL[eye] as number;
    for (const mesh of this.eyes)
      mesh.material.uniforms.uCell.value.set(cell % 4, Math.floor(cell / 4));
    if (this.mouth) {
      const base: MouthCell = this.spec.mouth?.style === 'cat' ? 'cat' : 'smile';
      let m: MouthCell = base;
      if (expr === 'angry' || expr === 'focus') m = 'grin';
      else if (expr === 'happy') m = 'open';
      else if (expr === 'hurt') m = 'wavy';
      else if (expr === 'ko') m = 'o';
      else if (expr === 'shout') m = 'shout';
      if (this.mouthOverride) m = this.mouthOverride;
      const i = MOUTH_CELL[m];
      this.mouth.material.uniforms.uCell.value.set(i % 4, Math.floor(i / 4));
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
