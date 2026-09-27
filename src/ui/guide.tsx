// 新手指引的遮罩与卡片：遮住界面其余部分，只露出当前要讲的元素（它仍然可以点），
// 旁边放一句话的说明卡片。目标元素每帧重新定位，界面重建或窗口缩放时跟着走。
import { RAIL, VIEW_H, VIEW_W } from '../render/view.js';
import { cx, h, mount } from './dom.js';
import { button } from './widgets.js';

/** 竞技场坐标里的一块区域。 */
export interface ArenaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideStep {
  title: string;
  text: string;
  /** 要圈出的界面元素，按顺序取第一个存在且可见的。 */
  target?: string[];
  /** 或者圈出竞技场里的一块区域（画在画布上的东西没有 DOM 元素）。 */
  arena?: () => ArenaRect | null;
  /** 目标不存在时跳过这一步（例如开局招式只在第一场开战前出现）。 */
  optional?: boolean;
}

export interface GuideOptions {
  /** 卡片顶部显示的段落名，例如“战前准备”。 */
  label: string;
  steps: GuideStep[];
  /** 左下角按钮的文字：自动出现时是“跳过指引”，重看时是“关闭”。 */
  skipLabel: string;
  /** 看完最后一步。 */
  onDone?: () => void;
  /** 点了跳过（或按 Esc）。 */
  onSkip?: () => void;
  /** 无论以哪种方式关闭都会调用。 */
  onClose?: () => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 14;
const MARGIN = 12;

export class Guide {
  private readonly layer: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly blocks: HTMLElement[];
  private readonly ring: HTMLElement;
  private readonly card: HTMLElement;
  private options: GuideOptions | null = null;
  private steps: GuideStep[] = [];
  private index = 0;
  private frame = 0;
  private placed = '';

  constructor(layer: HTMLElement, canvas: HTMLCanvasElement) {
    this.layer = layer;
    this.canvas = canvas;
    this.blocks = [0, 1, 2, 3].map(() => h('div', { class: 'guide-block' }) as HTMLElement);
    this.ring = h('div', { class: 'guide-ring', 'aria-hidden': 'true' }) as HTMLElement;
    this.card = h('div', {
      class: 'guide-card',
      role: 'dialog',
      'aria-label': '新手指引',
      'data-testid': 'guide',
    }) as HTMLElement;
    mount(this.layer, ...this.blocks, this.ring, this.card);
    this.layer.hidden = true;
  }

  get open(): boolean {
    return this.options !== null;
  }

  show(options: GuideOptions): void {
    if (this.options) this.finish();
    const steps = options.steps.filter((s) => !s.optional || this.targetBox(s) !== null);
    if (steps.length === 0) return;
    this.options = options;
    this.steps = steps;
    this.index = 0;
    this.layer.hidden = false;
    this.renderCard();
    this.placed = '';
    this.tick();
  }

  /** 关闭但不算看完也不算跳过（例如界面切走了）。 */
  close(): void {
    if (this.options) this.finish();
  }

  next(): void {
    if (!this.options) return;
    if (this.index < this.steps.length - 1) {
      this.index++;
      this.renderCard();
      return;
    }
    const done = this.options.onDone;
    this.finish();
    done?.();
  }

  prev(): void {
    if (!this.options || this.index === 0) return;
    this.index--;
    this.renderCard();
  }

  skip(): void {
    if (!this.options) return;
    const onSkip = this.options.onSkip;
    this.finish();
    onSkip?.();
  }

  /** 指引打开时接管按键；返回 true 表示已处理。 */
  onKey(e: KeyboardEvent): boolean {
    if (!this.options) return false;
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
    else if (e.key === 'Escape') this.skip();
    return true;
  }

  private finish(): void {
    const onClose = this.options?.onClose;
    this.options = null;
    this.steps = [];
    cancelAnimationFrame(this.frame);
    this.layer.hidden = true;
    onClose?.();
  }

  private renderCard(): void {
    const options = this.options;
    const step = this.steps[this.index];
    if (!options || !step) return;
    const last = this.index === this.steps.length - 1;
    const total = this.steps.length;
    mount(
      this.card,
      h(
        'div',
        { class: 'guide-kicker' },
        `新手指引 · ${options.label}${total > 1 ? `　${this.index + 1} / ${total}` : ''}`,
      ),
      h('h3', { 'data-testid': 'guide-title' }, step.title),
      h('p', null, step.text),
      h(
        'div',
        { class: 'guide-foot' },
        h(
          'button',
          {
            type: 'button',
            class: 'guide-skip',
            'data-testid': 'guide-skip',
            onClick: () => this.skip(),
          },
          options.skipLabel,
        ),
        total > 1
          ? h(
              'span',
              { class: 'guide-dots', 'aria-hidden': 'true' },
              ...this.steps.map((_, i) => h('i', { class: cx(i === this.index && 'on') })),
            )
          : null,
        this.index > 0
          ? button({
              label: '上一步',
              size: 'small',
              kind: 'ghost',
              onClick: () => this.prev(),
              testId: 'guide-prev',
            })
          : null,
        button({
          label: last ? '知道了' : '下一步',
          size: 'small',
          kind: 'primary',
          onClick: () => this.next(),
          testId: 'guide-next',
        }),
      ),
    );
    this.card.classList.remove('guide-card-in');
    void this.card.offsetWidth;
    this.card.classList.add('guide-card-in');
    this.placed = '';
    // 侧栏可能滚动过：先把要讲的元素滚进视野。
    if (!step.arena?.()) this.targetElement(step)?.scrollIntoView({ block: 'nearest' });
    this.card
      .querySelector<HTMLElement>('[data-testid=guide-next]')
      ?.focus({ preventScroll: true });
  }

  private tick = (): void => {
    if (!this.options) return;
    this.place();
    this.frame = requestAnimationFrame(this.tick);
  };

  /** 当前这一步要露出的区域（屏幕坐标）；找不到时返回 null，卡片居中。 */
  private targetBox(step: GuideStep): Box | null {
    const r = step.arena?.();
    const c = this.canvas.getBoundingClientRect();
    if (r && c.width > 0 && c.height > 0) {
      const sx = c.width / VIEW_W;
      const sy = c.height / VIEW_H;
      return {
        left: c.left + (r.x + RAIL) * sx,
        top: c.top + (r.y + RAIL) * sy,
        width: r.w * sx,
        height: r.h * sy,
      };
    }
    const el = this.targetElement(step);
    return el ? visibleBox(el) : null;
  }

  private targetElement(step: GuideStep): Element | null {
    for (const selector of step.target ?? []) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }

  private place(): void {
    const step = this.steps[this.index];
    if (!step) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const raw = this.targetBox(step);
    const box = raw
      ? {
          left: Math.max(0, raw.left - PAD),
          top: Math.max(0, raw.top - PAD),
          width: Math.min(vw, raw.width + PAD * 2),
          height: Math.min(vh, raw.height + PAD * 2),
        }
      : null;
    const cw = this.card.offsetWidth;
    const ch = this.card.offsetHeight;
    const key = box
      ? `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)},${cw},${ch},${vw},${vh}`
      : `center,${cw},${ch},${vw},${vh}`;
    if (key === this.placed) return;
    this.placed = key;

    const [top, bottom, left, right] = this.blocks as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    if (!box) {
      setBox(top, { left: 0, top: 0, width: vw, height: vh });
      for (const b of [bottom, left, right]) setBox(b, { left: 0, top: 0, width: 0, height: 0 });
      this.ring.hidden = true;
      setBox(this.card, {
        left: (vw - cw) / 2,
        top: (vh - ch) / 2,
        width: NaN,
        height: NaN,
      });
      return;
    }

    // 四块遮罩共用取整后的边，拼接处不会重叠或漏缝。
    const bLeft = Math.round(box.left);
    const bTop = Math.round(box.top);
    const bRight = Math.round(box.left + box.width);
    const bBottom = Math.round(box.top + box.height);
    setBox(top, { left: 0, top: 0, width: vw, height: bTop });
    setBox(bottom, { left: 0, top: bBottom, width: vw, height: Math.max(0, vh - bBottom) });
    setBox(left, { left: 0, top: bTop, width: bLeft, height: bBottom - bTop });
    setBox(right, {
      left: bRight,
      top: bTop,
      width: Math.max(0, vw - bRight),
      height: bBottom - bTop,
    });
    this.ring.hidden = false;
    setBox(this.ring, { left: bLeft, top: bTop, width: bRight - bLeft, height: bBottom - bTop });

    // 卡片放在目标旁边、不压住目标：依次试下、上、右、左，都放不下时贴着窗口底部。
    const clampX = (x: number) => Math.min(Math.max(MARGIN, x), vw - cw - MARGIN);
    const clampY = (y: number) => Math.min(Math.max(MARGIN, y), vh - ch - MARGIN);
    const midX = box.left + box.width / 2 - cw / 2;
    const midY = box.top + box.height / 2 - ch / 2;
    const candidates: Array<[number, number, boolean]> = [
      [clampX(midX), bBottom + GAP, bBottom + GAP + ch <= vh - MARGIN],
      [clampX(midX), box.top - GAP - ch, box.top - GAP - ch >= MARGIN],
      [bRight + GAP, clampY(midY), bRight + GAP + cw <= vw - MARGIN],
      [box.left - GAP - cw, clampY(midY), box.left - GAP - cw >= MARGIN],
    ];
    const spot = candidates.find(([, , fits]) => fits) ?? [clampX(midX), vh - ch - MARGIN, true];
    setBox(this.card, { left: spot[0], top: spot[1], width: NaN, height: NaN });
  }
}

/** 元素实际露在外面的部分：裁掉被滚动区域等祖先遮住的部分。 */
function visibleBox(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  let left = r.left;
  let top = r.top;
  let right = r.right;
  let bottom = r.bottom;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const pr = p.getBoundingClientRect();
    left = Math.max(left, pr.left);
    top = Math.max(top, pr.top);
    right = Math.min(right, pr.right);
    bottom = Math.min(bottom, pr.bottom);
  }
  if (right - left < 4 || bottom - top < 4) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function setBox(el: HTMLElement, box: Box): void {
  el.style.left = `${Math.round(box.left)}px`;
  el.style.top = `${Math.round(box.top)}px`;
  if (!Number.isNaN(box.width)) el.style.width = `${Math.round(box.width)}px`;
  if (!Number.isNaN(box.height)) el.style.height = `${Math.round(box.height)}px`;
}
