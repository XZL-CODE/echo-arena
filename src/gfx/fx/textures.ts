// 特效贴图：全部用 Canvas 程序绘制。粒子图集（8×8 格）、法阵、刀光、噪声条纹、冲击环。
import * as THREE from 'three';

export const CELL = {
  glow: 0,
  spark: 1,
  ring: 2,
  smoke: 3,
  flame: 4,
  leaf: 5,
  petal: 6,
  bubble: 7,
  feather: 8,
  shard: 9,
  bolt: 10,
  star: 11,
  dust: 12,
  streak: 13,
  hex: 14,
  rune: 15,
  swirl: 16,
  plus: 17,
  drop: 18,
  ember: 19,
} as const;
export type CellName = keyof typeof CELL;

const N = 8;
const C = 128;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let atlas: THREE.CanvasTexture | null = null;

/** 粒子图集：白色 / 灰度图案，颜色由粒子自己着色。 */
export function particleAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const [c, g] = canvas(N * C, N * C);
  const r = rng(7);
  const draw: Record<CellName, () => void> = {
    glow: () => {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 62);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, C, C);
    },
    spark: () => {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 60);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.2, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, C, C);
      g.fillStyle = 'white';
      for (const [w, h] of [
        [6, 120],
        [120, 6],
      ]) {
        g.beginPath();
        g.ellipse(64, 64, (w as number) / 2, (h as number) / 2, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 0.6;
      g.save();
      g.translate(64, 64);
      g.rotate(Math.PI / 4);
      g.beginPath();
      g.ellipse(0, 0, 2.5, 40, 0, 0, Math.PI * 2);
      g.ellipse(0, 0, 40, 2.5, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.globalAlpha = 1;
    },
    ring: () => {
      g.strokeStyle = 'white';
      g.lineWidth = 10;
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.4;
      g.lineWidth = 22;
      g.stroke();
      g.globalAlpha = 1;
    },
    smoke: () => {
      for (let i = 0; i < 14; i++) {
        const x = 64 + (r() - 0.5) * 50;
        const y = 64 + (r() - 0.5) * 50;
        const rad = 20 + r() * 26;
        const grad = g.createRadialGradient(x, y, 0, x, y, rad);
        grad.addColorStop(0, 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, C, C);
      }
    },
    flame: () => {
      // 边缘模糊的火舌：外层柔光 + 里面更亮的芯，放大（特写）时也不会像剪纸
      g.save();
      g.filter = 'blur(7px)';
      const grad = g.createRadialGradient(64, 84, 0, 64, 74, 56);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(64, 10);
      g.bezierCurveTo(88, 42, 106, 70, 96, 94);
      g.bezierCurveTo(86, 118, 42, 118, 32, 94);
      g.bezierCurveTo(22, 70, 40, 42, 64, 10);
      g.fill();
      g.filter = 'blur(4px)';
      const core = g.createRadialGradient(64, 88, 0, 64, 84, 26);
      core.addColorStop(0, 'rgba(255,255,255,0.9)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = core;
      g.fillRect(0, 0, C, C);
      g.restore();
    },
    leaf: () => {
      g.fillStyle = 'white';
      g.beginPath();
      g.moveTo(64, 8);
      g.bezierCurveTo(110, 40, 100, 100, 64, 120);
      g.bezierCurveTo(28, 100, 18, 40, 64, 8);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(64, 14);
      g.lineTo(64, 116);
      g.stroke();
    },
    petal: () => {
      g.fillStyle = 'white';
      g.beginPath();
      g.moveTo(64, 120);
      g.bezierCurveTo(10, 80, 30, 14, 56, 20);
      g.lineTo(64, 34);
      g.lineTo(72, 20);
      g.bezierCurveTo(98, 14, 118, 80, 64, 120);
      g.fill();
    },
    bubble: () => {
      const grad = g.createRadialGradient(64, 64, 30, 64, 64, 58);
      grad.addColorStop(0, 'rgba(255,255,255,0.08)');
      grad.addColorStop(0.85, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, C, C);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath();
      g.ellipse(44, 42, 12, 8, -0.6, 0, Math.PI * 2);
      g.fill();
    },
    feather: () => {
      g.fillStyle = 'white';
      g.beginPath();
      g.moveTo(64, 4);
      g.quadraticCurveTo(100, 50, 70, 124);
      g.lineTo(58, 124);
      g.quadraticCurveTo(28, 50, 64, 4);
      g.fill();
    },
    shard: () => {
      g.fillStyle = 'white';
      g.beginPath();
      g.moveTo(64, 4);
      g.lineTo(96, 64);
      g.lineTo(64, 124);
      g.lineTo(36, 64);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.moveTo(64, 4);
      g.lineTo(96, 64);
      g.lineTo(64, 124);
      g.closePath();
      g.fill();
    },
    bolt: () => {
      g.strokeStyle = 'white';
      g.lineWidth = 8;
      g.lineJoin = 'miter';
      g.beginPath();
      g.moveTo(70, 4);
      g.lineTo(44, 60);
      g.lineTo(76, 58);
      g.lineTo(52, 124);
      g.stroke();
    },
    star: () => {
      g.fillStyle = 'white';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? 58 : 24;
        g.lineTo(64 + Math.cos(a) * rad, 64 + Math.sin(a) * rad);
      }
      g.closePath();
      g.fill();
    },
    dust: () => {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 60);
      grad.addColorStop(0, 'rgba(255,255,255,0.7)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, C, C);
    },
    streak: () => {
      const grad = g.createLinearGradient(0, 0, C, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 56, C, 16);
    },
    hex: () => {
      g.strokeStyle = 'white';
      g.lineWidth = 8;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.lineTo(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54);
      }
      g.closePath();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fill();
    },
    rune: () => {
      g.strokeStyle = 'white';
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(40, 20);
      g.lineTo(88, 20);
      g.moveTo(64, 20);
      g.lineTo(64, 108);
      g.moveTo(36, 60);
      g.quadraticCurveTo(64, 90, 92, 60);
      g.moveTo(44, 108);
      g.lineTo(84, 108);
      g.stroke();
    },
    swirl: () => {
      g.strokeStyle = 'white';
      g.lineWidth = 8;
      g.beginPath();
      for (let i = 0; i <= 80; i++) {
        const a = i * 0.16;
        const rad = 4 + i * 0.7;
        g.lineTo(64 + Math.cos(a) * rad, 64 + Math.sin(a) * rad);
      }
      g.stroke();
    },
    plus: () => {
      g.fillStyle = 'white';
      g.fillRect(52, 18, 24, 92);
      g.fillRect(18, 52, 92, 24);
    },
    drop: () => {
      g.fillStyle = 'white';
      g.beginPath();
      g.moveTo(64, 8);
      g.bezierCurveTo(90, 50, 108, 80, 90, 104);
      g.bezierCurveTo(76, 124, 52, 124, 38, 104);
      g.bezierCurveTo(20, 80, 38, 50, 64, 8);
      g.fill();
    },
    ember: () => {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 30);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, C, C);
    },
  };
  for (const name of Object.keys(CELL) as CellName[]) {
    const i = CELL[name];
    g.save();
    g.translate((i % N) * C, Math.floor(i / N) * C);
    g.beginPath();
    g.rect(0, 0, C, C);
    g.clip();
    draw[name]();
    g.restore();
  }
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}

export const ATLAS_GRID = N;

const circleCache = new Map<string, THREE.CanvasTexture>();

/** 法阵：双环 + 符文 + 五角星 / 六角星，白色，按元素着色。 */
export function magicCircle(kind: 'penta' | 'hexa' | 'runes' = 'penta'): THREE.CanvasTexture {
  const hit = circleCache.get(kind);
  if (hit) return hit;
  const S = 512;
  const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2);
  g.strokeStyle = 'white';
  g.fillStyle = 'white';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, 240, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 222, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 150, 0, Math.PI * 2);
  g.stroke();
  // 两环之间的符文
  g.font = 'bold 28px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const glyphs = '火水木岩雷光暗风天地日月星辰';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.translate(0, -186);
    g.fillText(glyphs[i % glyphs.length] as string, 0, 0);
    g.restore();
  }
  const pts = kind === 'hexa' ? 6 : 5;
  const step = kind === 'hexa' ? 2 : 2;
  g.lineWidth = 5;
  g.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = -Math.PI / 2 + ((i * step) / pts) * Math.PI * 2;
    const x = Math.cos(a) * 150;
    const y = Math.sin(a) * 150;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  if (kind === 'hexa') {
    g.moveTo(
      Math.cos(-Math.PI / 2 + Math.PI / 3) * 150,
      Math.sin(-Math.PI / 2 + Math.PI / 3) * 150,
    );
    for (let i = 0; i <= 3; i++) {
      const a = -Math.PI / 2 + Math.PI / 3 + (i * 2 * Math.PI) / 3;
      g.lineTo(Math.cos(a) * 150, Math.sin(a) * 150);
    }
  }
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.arc(Math.cos(a) * 240, Math.sin(a) * 240, 9, 0, Math.PI * 2);
    g.fill();
  }
  if (kind === 'runes') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * 80, Math.sin(a) * 80, 40, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  circleCache.set(kind, t);
  return t;
}

let slashTex: THREE.CanvasTexture | null = null;

/** 刀光：一道新月形的亮弧，外缘最亮、内缘淡出。 */
export function slashTexture(): THREE.CanvasTexture {
  if (slashTex) return slashTex;
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.62, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 两端收尖
  const fade = g.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.2, 'rgba(0,0,0,0)');
  fade.addColorStop(0.75, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  slashTex = new THREE.CanvasTexture(c);
  slashTex.colorSpace = THREE.SRGBColorSpace;
  return slashTex;
}

let noiseTex: THREE.CanvasTexture | null = null;

/** 可平铺的噪声条纹（光束、龙卷、水墙的流动感）。 */
export function streakNoise(): THREE.CanvasTexture {
  if (noiseTex) return noiseTex;
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(99);
  g.fillStyle = 'black';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) {
    const x = r() * S;
    const w = 2 + r() * 14;
    const a = 0.1 + r() * 0.5;
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, `rgba(255,255,255,0)`);
    grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, `rgba(255,255,255,0)`);
    g.fillStyle = grad;
    const y = r() * S;
    g.save();
    g.translate(x, y);
    g.fillRect(-w / 2, -S / 2, w, S);
    g.translate(0, S);
    g.fillRect(-w / 2, -S / 2, w, S);
    g.translate(0, -2 * S);
    g.fillRect(-w / 2, -S / 2, w, S);
    g.restore();
  }
  noiseTex = new THREE.CanvasTexture(c);
  noiseTex.wrapS = THREE.RepeatWrapping;
  noiseTex.wrapT = THREE.RepeatWrapping;
  return noiseTex;
}

let decalTex: Record<string, THREE.CanvasTexture> = {};

/** 地面印记：焦痕、裂纹、水渍、花瓣、晶屑。 */
export function decalTexture(
  kind: 'scorch' | 'crack' | 'splash' | 'petals' | 'frost',
): THREE.CanvasTexture {
  const hit = decalTex[kind];
  if (hit) return hit;
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(kind.length * 17);
  g.translate(S / 2, S / 2);
  if (kind === 'scorch') {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 120);
    grad.addColorStop(0, 'rgba(20,10,10,0.85)');
    grad.addColorStop(0.6, 'rgba(30,15,10,0.5)');
    grad.addColorStop(1, 'rgba(30,15,10,0)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rad = 90 + r() * 30;
      g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.fill();
  } else if (kind === 'crack') {
    g.strokeStyle = 'rgba(30,20,20,0.9)';
    g.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      let a = (k / 7) * Math.PI * 2 + r() * 0.4;
      let x = 0;
      let y = 0;
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, 0);
      for (let i = 0; i < 6; i++) {
        a += (r() - 0.5) * 0.8;
        const len = 14 + r() * 12;
        x += Math.cos(a) * len;
        y += Math.sin(a) * len;
        g.lineTo(x, y);
        g.lineWidth = Math.max(1.5, 7 - i);
      }
      g.stroke();
    }
  } else if (kind === 'splash') {
    g.fillStyle = 'rgba(160,220,255,0.55)';
    for (let i = 0; i < 18; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 90;
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, 8 + r() * 22, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'petals') {
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 100;
      g.save();
      g.translate(Math.cos(a) * d, Math.sin(a) * d);
      g.rotate(r() * 6);
      g.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,160,200,0.9)';
      g.beginPath();
      g.ellipse(0, 0, 6, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  } else {
    g.strokeStyle = 'rgba(220,200,255,0.7)';
    for (let i = 0; i < 20; i++) {
      const a = r() * Math.PI * 2;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * (50 + r() * 70), Math.sin(a) * (50 + r() * 70));
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  decalTex = { ...decalTex, [kind]: t };
  return t;
}
