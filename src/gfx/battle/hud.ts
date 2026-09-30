// 战场上的 2D 叠加层：血条（护盾、能量）、五系小徽记、形态星级、伤害 / 治疗 / 克制 / 回响数字、集火准星。
// 画在 WebGL 画布之上，文字清晰，不受泛光和景深影响。
import * as THREE from 'three';
import type { ViewUnit } from './types.js';

export interface HudUnit {
  u: ViewUnit;
  top: THREE.Vector3;
  radius: number;
}

interface Floater {
  pos: THREE.Vector3;
  text: string;
  kind: 'damage' | 'heal' | 'crit' | 'echo' | 'counter' | 'shield';
  team: number;
  age: number;
  life: number;
  dx: number;
}

const ELEMENT_GLYPH: Record<string, string> = {
  fire: '火',
  water: '水',
  wood: '木',
  rock: '岩',
  thunder: '雷',
};
const ELEMENT_CSS: Record<string, string> = {
  fire: '#ff6a3a',
  water: '#3aa8ff',
  wood: '#4ac05a',
  rock: '#c8904a',
  thunder: '#e8c02a',
};

const _p = new THREE.Vector3();

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private floaters: Floater[] = [];
  private ratio = 1;
  private w = 1;
  private h = 1;
  showNumbers = true;
  showBars = true;
  /** 淡出程度（0 正常，1 全隐藏）：镜头特写时让血条和数字退到后面。 */
  fade = 0;
  private shownFade = -1;
  /** 缓动的血量（受伤后白色残影慢慢退）。 */
  private lag = new Map<number, number>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'battle-hud-canvas';
    this.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  resize(w: number, h: number, ratio: number): void {
    this.w = w;
    this.h = h;
    this.ratio = ratio;
    this.canvas.width = Math.round(w * ratio);
    this.canvas.height = Math.round(h * ratio);
  }

  number(pos: THREE.Vector3, text: string, kind: Floater['kind'], team: number): void {
    if (!this.showNumbers && kind !== 'echo' && kind !== 'counter') return;
    // 同一处 0.25 秒内的伤害数字合并成一个
    if (kind === 'damage' || kind === 'heal') {
      const hit = this.floaters.find(
        (f) => f.kind === kind && f.age < 0.25 && f.pos.distanceTo(pos) < 0.35,
      );
      if (hit) {
        const sum = Number(hit.text.replace('+', '')) + Number(text.replace('+', ''));
        hit.text = kind === 'heal' ? `+${sum}` : String(sum);
        hit.age = Math.min(hit.age, 0.1);
        return;
      }
    }
    if (this.floaters.length > 48) this.floaters.shift();
    this.floaters.push({
      pos: pos.clone(),
      text,
      kind,
      team,
      age: 0,
      life: kind === 'echo' ? 1.1 : kind === 'counter' ? 0.8 : 0.9,
      dx: (Math.random() - 0.5) * 14,
    });
  }

  clear(): void {
    this.floaters = [];
    this.lag.clear();
  }

  private project(p: THREE.Vector3, camera: THREE.Camera): { x: number; y: number } | null {
    _p.copy(p).project(camera);
    if (_p.z > 1) return null;
    return { x: (_p.x * 0.5 + 0.5) * this.w, y: (-_p.y * 0.5 + 0.5) * this.h };
  }

  draw(
    units: HudUnit[],
    camera: THREE.Camera,
    focusId: number,
    hoverId: number,
    time: number,
    dt: number,
  ): void {
    const g = this.ctx;
    g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const f = Math.round(this.fade * 20) / 20;
    if (f !== this.shownFade) {
      this.shownFade = f;
      this.canvas.style.opacity = String(1 - f);
    }
    const scale = Math.max(0.8, Math.min(1.25, this.h / 800));

    // 集火准星：旋转的四角框
    for (const it of units) {
      if (it.u.id !== focusId || !it.u.alive) continue;
      const base = this.project(_p.copy(it.top).setY(it.top.y * 0.5), camera);
      if (!base) continue;
      const r = 26 * scale + 4 * Math.sin(time * 6);
      g.save();
      g.translate(base.x, base.y);
      g.rotate(time * 1.4);
      g.strokeStyle = '#ff4a4a';
      g.lineWidth = 3;
      g.shadowColor = 'rgba(255,60,60,0.8)';
      g.shadowBlur = 8;
      for (let i = 0; i < 4; i++) {
        g.rotate(Math.PI / 2);
        g.beginPath();
        g.moveTo(r, -r * 0.45);
        g.lineTo(r, -r);
        g.lineTo(r * 0.45, -r);
        g.stroke();
      }
      g.restore();
    }

    if (this.showBars) {
      for (const it of units) {
        const u = it.u;
        if (!u.alive) {
          this.lag.delete(u.id);
          continue;
        }
        const p = this.project(it.top, camera);
        if (!p) continue;
        const w = (u.role === 'boss' ? 110 : u.form >= 3 ? 62 : 50) * scale;
        const h = (u.role === 'boss' ? 9 : 6) * scale;
        const x = p.x - w / 2;
        const y = p.y - h - 6 * scale;
        const ratio = Math.max(0, u.hp / u.maxHp);
        const lag = Math.max(ratio, this.lag.get(u.id) ?? ratio);
        this.lag.set(u.id, Math.max(ratio, lag - dt * 0.35));
        g.fillStyle = 'rgba(20,14,30,0.78)';
        roundRect(g, x - 2, y - 2, w + 4, h + 4, 4);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillRect(x, y, w * lag, h);
        const grad = g.createLinearGradient(0, y, 0, y + h);
        if (u.team === 0) {
          grad.addColorStop(0, ratio < 0.3 ? '#ff9a7a' : '#8af0ff');
          grad.addColorStop(1, ratio < 0.3 ? '#e04a3a' : '#2a9ae0');
        } else {
          grad.addColorStop(0, '#ffa08a');
          grad.addColorStop(1, '#d8323a');
        }
        g.fillStyle = grad;
        g.fillRect(x, y, w * ratio, h);
        if (u.shield > 0.5) {
          g.fillStyle = 'rgba(200,245,255,0.85)';
          g.fillRect(x, y, Math.min(w, (w * u.shield) / u.maxHp), h * 0.45);
        }
        // 能量条（人形态与首领）
        if (u.energy >= 0) {
          const ey = y + h + 2 * scale;
          g.fillStyle = 'rgba(20,14,30,0.78)';
          g.fillRect(x - 1, ey - 1, w + 2, 4 * scale + 2);
          const full = u.energy >= 99.5;
          g.fillStyle = full
            ? `hsl(${45 + 10 * Math.sin(time * 10)},100%,${60 + 10 * Math.sin(time * 10)}%)`
            : '#ffc84e';
          g.fillRect(x, ey, (w * Math.min(100, u.energy)) / 100, 4 * scale);
        }
        // 元素徽记 + 形态星级
        const bx = x - 11 * scale;
        const by = y + h / 2;
        g.beginPath();
        g.arc(bx, by, 8.5 * scale, 0, Math.PI * 2);
        g.fillStyle = ELEMENT_CSS[u.element] ?? '#888';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = u.team === 0 ? '#e8faff' : '#ffe0d8';
        g.stroke();
        g.fillStyle = '#fff';
        g.font = `bold ${Math.round(10 * scale)}px "PingFang SC","Microsoft YaHei",sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(ELEMENT_GLYPH[u.element] ?? '', bx, by + 0.5);
        if (u.role !== 'boss') {
          g.fillStyle = '#ffd84a';
          g.font = `${Math.round(8 * scale)}px sans-serif`;
          g.textAlign = 'left';
          g.fillText('★'.repeat(Math.min(3, u.form)), x + w + 3 * scale, by);
        }
        if (u.id === hoverId && u.team === 1) {
          g.strokeStyle = '#fff';
          g.lineWidth = 1.5;
          roundRect(g, x - 3, y - 3, w + 6, h + 6, 5);
          g.stroke();
        }
      }
    }

    // 飘字
    for (let i = 0; i < this.floaters.length;) {
      const f = this.floaters[i] as Floater;
      f.age += dt;
      if (f.age >= f.life) {
        this.floaters.splice(i, 1);
        continue;
      }
      i++;
      const p = this.project(f.pos, camera);
      if (!p) continue;
      const k = f.age / f.life;
      const rise = (f.kind === 'echo' ? 34 : 26) * scale * (1 - Math.pow(1 - k, 2));
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.6 : 1.2 - Math.min(0.2, (k - 0.12) * 0.6);
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      let size = 17;
      let fill = '#ffffff';
      let stroke = '#3a1a2a';
      if (f.kind === 'damage') {
        fill = f.team === 0 ? '#ffffff' : '#ffd0c8';
      } else if (f.kind === 'crit') {
        size = 23;
        fill = '#ffd84a';
        stroke = '#6a1a1a';
      } else if (f.kind === 'heal') {
        fill = '#8affb8';
        stroke = '#0a3a2a';
      } else if (f.kind === 'counter') {
        size = 14;
        fill = '#ff6a4a';
        stroke = '#ffffff';
      } else if (f.kind === 'echo') {
        size = 19;
        fill = '#c8a0ff';
        stroke = '#2a1050';
      }
      g.save();
      g.globalAlpha = alpha;
      g.translate(p.x + f.dx * k, p.y - rise);
      g.scale(pop * scale, pop * scale);
      g.font = `900 ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 4;
      g.strokeStyle = stroke;
      g.strokeText(f.text, 0, 0);
      g.fillStyle = fill;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
  }
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
