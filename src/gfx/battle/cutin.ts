// 大招特写横幅：斜切的彩色长条从一侧滑入，速度线、元素光、立绘（大招姿势）和金字技能名，停一瞬后滑出。
// 我方从左边进，对手从右边进（红框）。
import { portrait } from '../portrait.js';

const STYLE_ID = 'cutin-style';
const CSS = `
.cutin { position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:5; }
.cutin-band { position:absolute; left:-10%; right:-10%; top:34%; height:30%; transform:skewY(-6deg) translateX(-110%);
  background: linear-gradient(90deg, var(--c1), var(--c2) 55%, rgba(0,0,0,0.0));
  box-shadow: 0 0 40px var(--glow), inset 0 4px 0 rgba(255,255,255,0.55), inset 0 -4px 0 rgba(255,255,255,0.35);
  animation: cutin-in 1.15s cubic-bezier(.2,.9,.2,1) forwards; }
.cutin.enemy .cutin-band { background: linear-gradient(270deg, var(--c1), var(--c2) 55%, rgba(0,0,0,0.0)); transform:skewY(6deg) translateX(110%); animation-name: cutin-in-r; }
.cutin-lines { position:absolute; inset:0; opacity:0.55; mix-blend-mode:screen;
  background: repeating-linear-gradient(90deg, rgba(255,255,255,0.0) 0 38px, rgba(255,255,255,0.5) 38px 41px, rgba(255,255,255,0) 41px 90px);
  animation: cutin-lines 0.35s linear infinite; }
.cutin-art { position:absolute; bottom:-8%; height:150%; left:8%; filter: drop-shadow(0 0 18px var(--glow)) drop-shadow(6px 6px 0 rgba(0,0,0,0.35)); transform: skewY(6deg); }
.cutin.enemy .cutin-art { left:auto; right:8%; transform: skewY(-6deg) scaleX(-1); }
.cutin-text { position:absolute; left:38%; top:22%; transform: skewY(6deg); text-align:left; }
.cutin.enemy .cutin-text { left:auto; right:38%; text-align:right; transform: skewY(-6deg); }
.cutin-skill { font: 900 clamp(34px, 6.2vh, 64px)/1.05 "STKaiti","KaiTi","Kaiti SC","PingFang SC","Microsoft YaHei",serif; letter-spacing: 0.08em;
  background: linear-gradient(180deg, #fffbe8 0%, #ffe07a 45%, #ff9a2a 100%); -webkit-background-clip:text; background-clip:text; color:transparent;
  -webkit-text-stroke: 1.5px rgba(80,20,10,0.55); filter: drop-shadow(0 0 10px var(--glow)) drop-shadow(0 3px 0 rgba(40,10,20,0.6)); }
.cutin-name { margin-top: 0.4em; font: 700 clamp(14px, 2.2vh, 20px)/1 "PingFang SC","Microsoft YaHei",sans-serif; color:#fff; letter-spacing:0.3em;
  text-shadow: 0 0 8px var(--glow), 0 2px 0 rgba(0,0,0,0.5); }
.cutin-flash { position:absolute; inset:0; background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.5), rgba(255,255,255,0) 60%); opacity:0; animation: cutin-flash 1.15s ease-out forwards; }
.cutin.gentle .cutin-flash { display:none; }
@keyframes cutin-in { 0% { transform: skewY(-6deg) translateX(-110%); } 16% { transform: skewY(-6deg) translateX(0); } 80% { transform: skewY(-6deg) translateX(3%); opacity:1; } 100% { transform: skewY(-6deg) translateX(110%); opacity:0; } }
@keyframes cutin-in-r { 0% { transform: skewY(6deg) translateX(110%); } 16% { transform: skewY(6deg) translateX(0); } 80% { transform: skewY(6deg) translateX(-3%); opacity:1; } 100% { transform: skewY(6deg) translateX(-110%); opacity:0; } }
@keyframes cutin-lines { from { background-position: 0 0; } to { background-position: -90px 0; } }
@keyframes cutin-flash { 0% { opacity:0; } 14% { opacity:0.55; } 40% { opacity:0; } 100% { opacity:0; } }
`;

const PALETTE: Record<string, [string, string, string]> = {
  fire: ['#ff5a1f', '#b8141e', 'rgba(255,120,40,0.9)'],
  water: ['#2ab8ff', '#1a3aa8', 'rgba(80,200,255,0.9)'],
  wood: ['#5ad06a', '#1a6a3a', 'rgba(140,255,120,0.9)'],
  rock: ['#d89a4a', '#5a2a4a', 'rgba(255,190,110,0.9)'],
  thunder: ['#ffd23a', '#5a2ab8', 'rgba(255,230,90,0.9)'],
};

export class CutIn {
  readonly root: HTMLDivElement;
  gentle = false;
  enabled = true;
  private timer = 0;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = document.createElement('div');
    this.root.className = 'cutin';
    this.root.style.display = 'none';
  }

  get active(): boolean {
    return this.root.style.display !== 'none';
  }

  show(formId: string, element: string, skill: string, name: string, team: 0 | 1): void {
    if (!this.enabled) return;
    const [c1, c2, glow] = PALETTE[element] ?? (PALETTE.fire as [string, string, string]);
    this.root.className = `cutin${team === 1 ? ' enemy' : ''}${this.gentle ? ' gentle' : ''}`;
    this.root.style.setProperty('--c1', c1);
    this.root.style.setProperty('--c2', c2);
    this.root.style.setProperty('--glow', glow);
    this.root.replaceChildren();
    const band = document.createElement('div');
    band.className = 'cutin-band';
    const lines = document.createElement('div');
    lines.className = 'cutin-lines';
    band.appendChild(lines);
    const url = portrait(formId, {
      framing: 'bust',
      pose: 'ult',
      t: 0.62,
      size: [420, 420],
      yaw: team === 0 ? 0.55 : 0.55,
    });
    if (url) {
      const img = document.createElement('img');
      img.className = 'cutin-art';
      img.src = url;
      img.alt = '';
      band.appendChild(img);
    }
    const text = document.createElement('div');
    text.className = 'cutin-text';
    const s = document.createElement('div');
    s.className = 'cutin-skill';
    s.textContent = skill;
    const n = document.createElement('div');
    n.className = 'cutin-name';
    n.textContent = name;
    text.append(s, n);
    band.appendChild(text);
    const flash = document.createElement('div');
    flash.className = 'cutin-flash';
    this.root.append(band, flash);
    this.root.style.display = '';
    this.timer = 1.2;
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.root.style.display = 'none';
      this.root.replaceChildren();
    }
  }

  hide(): void {
    this.timer = 0;
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }
}
