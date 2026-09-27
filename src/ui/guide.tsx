// 新手指引：压暗界面、只亮出这一步要操作的地方，用手指动画演示“点哪里、往哪拖”，
// 玩家照着做了才进入下一步（战斗在等你）。亮出来的地方仍然可以直接点，其余地方点不到。
// 目标每帧重新定位，界面重建、侧栏滚动或窗口缩放时都跟着走。
import { portrait } from '../render/portrait.js';
import { RAIL, VIEW_H, VIEW_W } from '../render/view.js';
import { cx, h, mount } from './dom.js';
import { button, kbd } from './widgets.js';

/** 竞技场坐标里的一块区域。 */
export interface ArenaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 竞技场坐标里的一点。 */
export interface ArenaPoint {
  x: number;
  y: number;
}

/** 要亮出来的地方：界面元素（按顺序取第一个看得见的），或竞技场里的一块区域。 */
export type Spot = { el: string[] } | { arena: () => ArenaRect | null };

/** 手指瞄准的地方：界面元素的中心，或竞技场里的一点。 */
export type Aim = { el: string[] } | { arena: () => ArenaPoint | null };

/** 手指演示：点一下、从一处拖到另一处；path 不画手指，只让一个亮点沿虚线飞过去（示意去向）。 */
export type HandMotion =
  | { kind: 'tap'; at: Aim }
  | { kind: 'drag'; from: Aim; to: Aim }
  | { kind: 'path'; from: Aim; to: Aim };

export interface GuideStep {
  /** 这一步要做什么（一句短话）。 */
  title: string;
  /** 补充说明（一句话）。 */
  text: string;
  /** 亮出来的地方；第一个是主目标，说明卡片放在它旁边。 */
  spots: Spot[];
  /** 不亮出来、但说明卡片不要挡住的地方（例如结算里的战报）。 */
  keep?: Spot[];
  /** 手指演示；可以随状态变化（例如先点卡片、再点确认）。 */
  hand?: HandMotion | (() => HandMotion | null);
  /** 卡片上提示的按键；这些键照常交给游戏处理。 */
  keys?: string[];
  /** 照做完成的条件，满足后自动进入下一步。没有这一项的步骤看完点“下一步”。 */
  done?: () => boolean;
  /** 满足时退回上一步（例如瞄准到一半取消了）。 */
  back?: () => boolean;
  /** 点一下亮出来的地方就算完成。 */
  tapDone?: boolean;
  /** 主目标不存在时跳过这一步。 */
  optional?: boolean;
  /** 进入这一步时调用，用来记下当时的状态。 */
  enter?: () => void;
}

export interface GuideOptions {
  /** 卡片顶部显示的课名，例如“战前准备”。 */
  label: string;
  steps: GuideStep[];
  /** teach：第一次教，要照做才往下走；review：重看，每一步都能直接点“下一步”。 */
  mode: 'teach' | 'review';
  /** 走完最后一步。 */
  onDone?: () => void;
  /** 点了“跳过指引”或“关闭”（或按 Esc）。 */
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

interface Point {
  x: number;
  y: number;
}

/** 手指经过的点；flip 表示贴近窗口底边时手指倒过来，从上方往下指。 */
interface HandPoint extends Point {
  flip: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 8;
const GAP = 16;
const MARGIN = 12;
/** 手指图形的缩放，以及它相对指尖的范围（未缩放的图形坐标），摆卡片时避开。 */
const HAND_SCALE = 1.25;
const HAND_BOX = { left: -24, top: -6, right: 58, bottom: 76 };
const TAP_PERIOD = 1.8;
const DRAG_PERIOD = 2.8;
const PATH_PERIOD = 1.9;
/** 这些事件在亮出来的地方以外一律拦下。 */
const BLOCKED = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu'] as const;

export class Guide {
  private readonly layer: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly svg: SVGSVGElement;
  private readonly maskKeeps: SVGGElement;
  private readonly maskHoles: SVGGElement;
  private readonly rings: SVGGElement;
  private readonly trail: SVGPathElement;
  private readonly goal: SVGCircleElement;
  private readonly ripple: SVGCircleElement;
  private readonly comet: SVGCircleElement;
  private readonly hand: SVGGElement;
  private readonly handBody: SVGGElement;
  private readonly card: HTMLElement;
  private options: GuideOptions | null = null;
  private steps: GuideStep[] = [];
  private index = 0;
  private frame = 0;
  private stepStart = 0;
  private placed = '';
  private holes: Box[] = [];
  private tapped = false;
  private shownTitle = '';

  constructor(layer: HTMLElement, canvas: HTMLCanvasElement) {
    this.layer = layer;
    this.canvas = canvas;
    this.maskKeeps = h('g', null) as SVGGElement;
    this.maskHoles = h('g', null) as SVGGElement;
    this.rings = h('g', { class: 'guide-rings' }) as SVGGElement;
    this.trail = h('path', { class: 'guide-trail' }) as SVGPathElement;
    this.goal = h('circle', { class: 'guide-goal', r: '24' }) as SVGCircleElement;
    this.ripple = h('circle', { class: 'guide-ripple', r: '0' }) as SVGCircleElement;
    this.comet = h('circle', { class: 'guide-comet', r: '8' }) as SVGCircleElement;
    this.handBody = handGraphic();
    this.hand = h(
      'g',
      { class: 'guide-hand', 'data-testid': 'guide-hand' },
      this.handBody,
    ) as SVGGElement;
    this.svg = h(
      'svg',
      { class: 'guide-svg', 'aria-hidden': 'true' },
      h(
        'defs',
        null,
        h(
          'mask',
          { id: 'guide-cut', maskUnits: 'userSpaceOnUse' },
          h('rect', { x: '0', y: '0', width: '100%', height: '100%', fill: 'white' }),
          this.maskKeeps,
          this.maskHoles,
        ),
      ),
      h('rect', {
        class: 'guide-dim',
        x: '0',
        y: '0',
        width: '100%',
        height: '100%',
        mask: 'url(#guide-cut)',
      }),
      this.rings,
      this.trail,
      this.goal,
      this.ripple,
      this.comet,
      this.hand,
    ) as SVGSVGElement;
    this.card = h('div', {
      class: 'guide-card',
      role: 'dialog',
      'aria-label': '新手指引',
      'data-testid': 'guide',
    }) as HTMLElement;
    mount(this.layer, this.svg, this.card);
    this.layer.hidden = true;
    for (const type of BLOCKED) window.addEventListener(type, this.guard, { capture: true });
    // 画布尺寸一变（例如开战时侧栏收起、画布放大）就在当帧重新摆放，
    // 不留下按旧尺寸算出的手指位置。
    new ResizeObserver(() => {
      if (this.options) this.layout(performance.now());
    }).observe(canvas);
  }

  get open(): boolean {
    return this.options !== null;
  }

  show(options: GuideOptions): void {
    if (this.options) this.finish();
    const steps = options.steps.filter((s) => !s.optional || this.spotBox(s.spots[0]) !== null);
    if (steps.length === 0) return;
    this.options = options;
    this.steps = steps;
    this.layer.hidden = false;
    this.enterStep(0);
    this.frame = requestAnimationFrame(this.tick);
  }

  /** 收起但不算走完也不算跳过（例如界面切走了）。 */
  close(): void {
    if (this.options) this.finish();
  }

  next(): void {
    if (!this.options) return;
    if (this.index < this.steps.length - 1) {
      this.enterStep(this.index + 1);
      return;
    }
    const done = this.options.onDone;
    this.finish();
    done?.();
  }

  prev(): void {
    if (!this.options || this.index === 0) return;
    this.enterStep(this.index - 1);
  }

  skip(): void {
    if (!this.options) return;
    const onSkip = this.options.onSkip;
    this.finish();
    onSkip?.();
  }

  /** 指引打开时先由它处理按键；返回 true 表示已处理，false 表示交给游戏（这一步提示的按键）。 */
  onKey(e: KeyboardEvent): boolean {
    const options = this.options;
    const step = this.steps[this.index];
    if (!options || !step) return false;
    if (step.keys?.includes(e.key)) return false;
    const forward = e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ';
    if (e.key === 'Escape') this.skip();
    else if (forward && this.canNext(step)) this.next();
    else if (e.key === 'ArrowLeft' && options.mode === 'review') this.prev();
    return true;
  }

  /** 重看时每一步都能直接往下翻；第一次教时，要照做的步骤得做了才往下走。 */
  private canNext(step: GuideStep): boolean {
    return this.options?.mode === 'review' || !isAction(step);
  }

  private enterStep(index: number): void {
    const step = this.steps[index];
    if (!step) return;
    this.index = index;
    this.tapped = false;
    this.stepStart = performance.now();
    // 手指的位置下一帧按这一步重新算；先清掉上一步留下的（测试照着它点）。
    for (const key of ['x', 'y', 'toX', 'toY']) delete this.hand.dataset[key];
    step.enter?.();
    this.renderCard();
    this.placed = '';
    // 侧栏可能滚动过：先把要讲的元素滚进视野。
    const first = step.spots[0];
    if (first && 'el' in first) findElement(first.el)?.scrollIntoView({ block: 'nearest' });
  }

  private finish(): void {
    const onClose = this.options?.onClose;
    this.options = null;
    this.steps = [];
    this.holes = [];
    cancelAnimationFrame(this.frame);
    this.layer.hidden = true;
    onClose?.();
  }

  /** 亮出来的地方以外，指针操作一律拦下；卡片本身照常可点。 */
  private guard = (e: Event): void => {
    if (!this.options) return;
    const target = e.target as Node | null;
    if (target && this.card.contains(target)) return;
    const { clientX, clientY } = e as MouseEvent;
    if (this.holes.some((b) => inside(b, clientX, clientY))) {
      if (e.type === 'click' && this.steps[this.index]?.tapDone) this.tapped = true;
      return;
    }
    e.stopPropagation();
    e.preventDefault();
  };

  private tick = (now: number): void => {
    if (!this.options) return;
    const step = this.steps[this.index];
    if (step?.back?.()) this.prev();
    else if (step && (this.tapped || step.done?.())) this.next();
    if (!this.options) return;
    this.layout(now);
    this.frame = requestAnimationFrame(this.tick);
  };

  private renderCard(): void {
    const options = this.options;
    const step = this.steps[this.index];
    if (!options || !step) return;
    const total = this.steps.length;
    const last = this.index === total - 1;
    const teachAction = options.mode === 'teach' && isAction(step);
    this.shownTitle = step.title;
    mount(
      this.card,
      h('img', { class: 'guide-avatar', src: portrait('bell'), alt: '' }),
      h(
        'div',
        { class: 'guide-body' },
        h(
          'div',
          { class: 'guide-kicker' },
          `新手指引 · ${options.label}${total > 1 ? `　${this.index + 1} / ${total}` : ''}`,
        ),
        h('h3', { 'data-testid': 'guide-title' }, step.title),
        h('p', null, step.text),
        step.keys?.length
          ? h(
              'div',
              { class: 'guide-keys' },
              '键盘：',
              ...step.keys.map((k) => kbd(k === ' ' ? '空格' : k)),
            )
          : null,
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
            options.mode === 'teach' ? '跳过指引' : '关闭',
          ),
          total > 1
            ? h(
                'span',
                { class: 'guide-dots', 'aria-hidden': 'true' },
                ...this.steps.map((_, i) =>
                  h('i', { class: cx(i === this.index && 'on', i < this.index && 'past') }),
                ),
              )
            : null,
          options.mode === 'review' && this.index > 0
            ? button({
                label: '上一步',
                size: 'small',
                kind: 'ghost',
                onClick: () => this.prev(),
                testId: 'guide-prev',
              })
            : null,
          teachAction
            ? h('span', { class: 'guide-wait', 'data-testid': 'guide-wait' }, '照着做就继续')
            : button({
                label: last ? '知道了' : '下一步',
                size: 'small',
                kind: 'primary',
                onClick: () => this.next(),
                testId: 'guide-next',
              }),
        ),
      ),
      h('i', { class: 'guide-tail', 'aria-hidden': 'true' }),
    );
    this.card.classList.remove('guide-card-in');
    void this.card.offsetWidth;
    this.card.classList.add('guide-card-in');
    this.card
      .querySelector<HTMLElement>('[data-testid=guide-next]')
      ?.focus({ preventScroll: true });
  }

  // ---- 位置换算 ----

  private arenaToScreen(x: number, y: number): Point | null {
    const c = this.canvas.getBoundingClientRect();
    if (c.width <= 0 || c.height <= 0) return null;
    return {
      x: c.left + ((x + RAIL) / VIEW_W) * c.width,
      y: c.top + ((y + RAIL) / VIEW_H) * c.height,
    };
  }

  private spotBox(spot: Spot | undefined): Box | null {
    if (!spot) return null;
    if ('el' in spot) {
      const el = findElement(spot.el);
      return el ? visibleBox(el) : null;
    }
    const r = spot.arena();
    if (!r) return null;
    const a = this.arenaToScreen(r.x, r.y);
    const b = this.arenaToScreen(r.x + r.w, r.y + r.h);
    if (!a || !b) return null;
    // 画在画布上的区域不会超出画布。
    const c = this.canvas.getBoundingClientRect();
    const left = Math.max(a.x, c.left);
    const top = Math.max(a.y, c.top);
    return {
      left,
      top,
      width: Math.min(b.x, c.right) - left,
      height: Math.min(b.y, c.bottom) - top,
    };
  }

  private aimPoint(aim: Aim): Point | null {
    if ('el' in aim) {
      const el = findElement(aim.el);
      const box = el ? visibleBox(el) : null;
      return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
    }
    const p = aim.arena();
    return p ? this.arenaToScreen(p.x, p.y) : null;
  }

  // ---- 每帧摆放 ----

  private layout(now: number): void {
    const step = this.steps[this.index];
    if (!step) return;
    if (step.title !== this.shownTitle) this.renderCard();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.svg.setAttribute('width', String(vw));
    this.svg.setAttribute('height', String(vh));

    const holes: Box[] = [];
    for (const spot of step.spots) {
      const raw = this.spotBox(spot);
      if (!raw || raw.width < 2 || raw.height < 2) continue;
      holes.push({
        left: Math.round(Math.max(0, raw.left - PAD)),
        top: Math.round(Math.max(0, raw.top - PAD)),
        width: Math.round(Math.min(vw, raw.width + PAD * 2)),
        height: Math.round(Math.min(vh, raw.height + PAD * 2)),
      });
    }
    this.holes = holes;
    syncRects(this.maskHoles, holes, 'black');
    syncRects(this.rings, holes, null);

    const keeps = (step.keep ?? []).flatMap((spot) => {
      const box = this.spotBox(spot);
      return box ? [box] : [];
    });
    // 要留着看的地方只轻轻压暗，读得清。
    syncRects(this.maskKeeps, keeps, '#5a5a5a');
    const motion = typeof step.hand === 'function' ? step.hand() : step.hand;
    const handPoints = this.animateHand(motion ?? null, now);
    this.placeCard(holes, keeps, handPoints, vw, vh);
  }

  /** 指尖离窗口底边太近时，手指倒过来从上方指，免得手掌出了窗口。 */
  private flipAt(y: number): boolean {
    return y + HAND_BOX.bottom * HAND_SCALE > window.innerHeight - 4;
  }

  /** 画手指动画，返回手指经过的点（摆卡片时避开）。 */
  private animateHand(motion: HandMotion | null, now: number): HandPoint[] {
    const t = (now - this.stepStart) / 1000;
    const hide = () => {
      this.hand.style.display = 'none';
      this.ripple.style.display = 'none';
      this.trail.style.display = 'none';
      this.goal.style.display = 'none';
      this.comet.style.display = 'none';
    };
    if (!motion) {
      hide();
      return [];
    }
    if (motion.kind !== 'path') this.comet.style.display = 'none';
    if (motion.kind === 'tap') {
      const at = this.aimPoint(motion.at);
      if (!at) {
        hide();
        return [];
      }
      this.trail.style.display = 'none';
      this.goal.style.display = 'none';
      const flip = this.flipAt(at.y);
      const p = (t % TAP_PERIOD) / TAP_PERIOD;
      // 从手掌那一侧移过来 → 按下 → 松开 → 停一会儿 → 淡出。
      const approach = ease(clamp01(p / 0.25));
      const press =
        p < 0.25 ? 0 : p < 0.33 ? (p - 0.25) / 0.08 : p < 0.42 ? 1 - (p - 0.33) / 0.09 : 0;
      const fade = p > 0.82 ? 1 - (p - 0.82) / 0.18 : 1;
      const off = (1 - approach) * 36;
      this.setHand(
        at.x + off * 0.7,
        at.y + (flip ? -off : off),
        1 - press * 0.14,
        Math.min(approach * 1.4, fade),
        flip,
      );
      this.setRipple(at, p - 0.3, 0.45);
      this.hand.dataset.x = String(Math.round(at.x));
      this.hand.dataset.y = String(Math.round(at.y));
      return [{ ...at, flip }];
    }
    const from = this.aimPoint(motion.from);
    const to = this.aimPoint(motion.to);
    if (!from || !to) {
      hide();
      return [];
    }
    this.trail.style.display = '';
    this.trail.setAttribute('d', arrowPath(from, to));
    this.goal.style.display = '';
    this.goal.setAttribute('cx', String(Math.round(to.x)));
    this.goal.setAttribute('cy', String(Math.round(to.y)));
    if (motion.kind === 'path') {
      // 亮点沿虚线飞过去，到了闪一下，停一会儿再来。
      this.hand.style.display = 'none';
      const p = (t % PATH_PERIOD) / PATH_PERIOD;
      const move = clamp01(p / 0.6);
      this.comet.style.display = p < 0.6 ? '' : 'none';
      this.comet.setAttribute('cx', (from.x + (to.x - from.x) * move).toFixed(1));
      this.comet.setAttribute('cy', (from.y + (to.y - from.y) * move).toFixed(1));
      this.setRipple(to, p - 0.6, 0.3);
      return [];
    }
    const p = (t % DRAG_PERIOD) / DRAG_PERIOD;
    // 出现 → 按住 → 拖过去 → 松开 → 淡出。
    const appear = clamp01(p / 0.12);
    const press =
      p < 0.12
        ? 0
        : p < 0.18
          ? (p - 0.12) / 0.06
          : p < 0.62
            ? 1
            : p < 0.68
              ? 1 - (p - 0.62) / 0.06
              : 0;
    const move = ease(clamp01((p - 0.2) / 0.4));
    const fade = p > 0.84 ? 1 - (p - 0.84) / 0.16 : 1;
    const x = from.x + (to.x - from.x) * move;
    const y = from.y + (to.y - from.y) * move;
    const flip = this.flipAt(Math.max(from.y, to.y));
    this.setHand(x, y, 1 - press * 0.14, Math.min(appear, fade), flip);
    this.setRipple(p < 0.5 ? from : to, p < 0.5 ? p - 0.14 : p - 0.64, 0.3);
    this.hand.dataset.x = String(Math.round(from.x));
    this.hand.dataset.y = String(Math.round(from.y));
    this.hand.dataset.toX = String(Math.round(to.x));
    this.hand.dataset.toY = String(Math.round(to.y));
    return [
      { ...from, flip },
      { ...to, flip },
    ];
  }

  private setHand(x: number, y: number, scale: number, opacity: number, flip: boolean): void {
    const k = scale * HAND_SCALE;
    this.hand.style.display = '';
    this.hand.setAttribute(
      'transform',
      `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)} ${(flip ? -k : k).toFixed(3)})`,
    );
    this.hand.style.opacity = opacity.toFixed(3);
  }

  /** 按下时从指尖荡开的一圈。k 是按下后经过的周期比例，span 是持续的比例。 */
  private setRipple(at: Point, k: number, span: number): void {
    if (k < 0 || k > span) {
      this.ripple.style.display = 'none';
      return;
    }
    const q = k / span;
    this.ripple.style.display = '';
    this.ripple.setAttribute('cx', String(Math.round(at.x)));
    this.ripple.setAttribute('cy', String(Math.round(at.y)));
    this.ripple.setAttribute('r', (6 + q * 34).toFixed(1));
    this.ripple.style.opacity = (0.9 * (1 - q)).toFixed(3);
  }

  /** 卡片放在主目标旁边，尽量不压住亮出来的地方、要留着看的地方和手指。 */
  private placeCard(
    holes: Box[],
    keeps: Box[],
    handPoints: HandPoint[],
    vw: number,
    vh: number,
  ): void {
    const cw = this.card.offsetWidth;
    const ch = this.card.offsetHeight;
    const main = holes[0] ?? null;
    const key = [
      [...holes, ...keeps].map((b) => `${b.left},${b.top},${b.width},${b.height}`).join(';'),
      handPoints.map((p) => `${Math.round(p.x / 8)},${Math.round(p.y / 8)},${p.flip}`).join(';'),
      `${cw},${ch},${vw},${vh}`,
    ].join('|');
    if (key === this.placed) return;
    this.placed = key;
    if (!main) {
      this.card.dataset.side = 'none';
      setPosition(this.card, (vw - cw) / 2, (vh - ch) / 2);
      return;
    }
    const hands = handPoints.map((p) => ({
      left: p.x + HAND_BOX.left * HAND_SCALE,
      top: p.flip ? p.y - HAND_BOX.bottom * HAND_SCALE : p.y + HAND_BOX.top * HAND_SCALE,
      width: (HAND_BOX.right - HAND_BOX.left) * HAND_SCALE,
      height: (HAND_BOX.bottom - HAND_BOX.top) * HAND_SCALE,
    }));
    // 压住亮出来的地方最糟（挡住要点的东西），其次是手指，再次是要留着看的地方。
    const weighted: Array<[Box, number]> = [
      ...holes.map((b): [Box, number] => [b, 100]),
      ...hands.map((b): [Box, number] => [b, 4]),
      ...keeps.map((b): [Box, number] => [b, 1]),
    ];
    const clampX = (x: number) => Math.min(Math.max(MARGIN, x), vw - cw - MARGIN);
    const clampY = (y: number) => Math.min(Math.max(MARGIN, y), vh - ch - MARGIN);
    const midX = clampX(main.left + main.width / 2 - cw / 2);
    const midY = clampY(main.top + main.height / 2 - ch / 2);
    // 先试贴着主目标（连同手指）的四边，再试让开要留着看的地方；
    // 窗口小放不下时，再试把这些位置推回窗口里。
    const zones = [union([main, ...hands]), union([main, ...hands, ...keeps])];
    const sides = zones.flatMap((zone) => [
      { side: 'top', x: midX, y: zone.top + zone.height + GAP },
      { side: 'bottom', x: midX, y: zone.top - GAP - ch },
      { side: 'left', x: zone.left + zone.width + GAP, y: midY },
      { side: 'right', x: zone.left - GAP - cw, y: midY },
    ]);
    const candidates = [...sides, ...sides.map((c) => ({ ...c, x: clampX(c.x), y: clampY(c.y) }))];
    let best = { side: 'none', x: midX, y: vh - ch - MARGIN };
    let bestCost = Infinity;
    for (const c of candidates) {
      const inView =
        c.x >= MARGIN - 0.5 &&
        c.y >= MARGIN - 0.5 &&
        c.x + cw <= vw - MARGIN + 0.5 &&
        c.y + ch <= vh - MARGIN + 0.5;
      if (!inView) continue;
      const box = { left: c.x, top: c.y, width: cw, height: ch };
      const cost = weighted.reduce((sum, [k, w]) => sum + overlap(box, k) * w, 0);
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
        if (cost === 0) break;
      }
    }
    this.card.dataset.side = best.side;
    setPosition(this.card, best.x, best.y);
    // 卡片上的小三角对准主目标。
    const tail =
      best.side === 'top' || best.side === 'bottom'
        ? Math.min(Math.max(22, main.left + main.width / 2 - best.x), cw - 22)
        : Math.min(Math.max(22, main.top + main.height / 2 - best.y), ch - 22);
    this.card.style.setProperty('--tail', `${Math.round(tail)}px`);
  }
}

// ---- 小工具 ----

function isAction(step: GuideStep): boolean {
  return !!step.done || !!step.tapDone;
}

function findElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
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

function inside(b: Box, x: number, y: number): boolean {
  return x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function union(boxes: Box[]): Box {
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

function setPosition(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

/** 让一组圆角矩形与给定区域一一对应（数量变化时增删）。 */
function syncRects(group: SVGGElement, boxes: Box[], fill: string | null): void {
  while (group.childNodes.length > boxes.length) group.lastChild?.remove();
  while (group.childNodes.length < boxes.length) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('rx', '14');
    if (fill) rect.setAttribute('fill', fill);
    else rect.setAttribute('class', 'guide-ring');
    group.appendChild(rect);
  }
  boxes.forEach((b, i) => {
    const rect = group.childNodes[i] as SVGRectElement;
    rect.setAttribute('x', String(b.left));
    rect.setAttribute('y', String(b.top));
    rect.setAttribute('width', String(b.width));
    rect.setAttribute('height', String(b.height));
  });
}

/** 拖动示意的虚线箭头：起点稍微让开队员，终点画箭头。 */
function arrowPath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = from.x + ux * 18;
  const sy = from.y + uy * 18;
  const ex = to.x - ux * 26;
  const ey = to.y - uy * 26;
  const head = 10;
  const lx = ex - ux * head - uy * head * 0.7;
  const ly = ey - uy * head + ux * head * 0.7;
  const rx = ex - ux * head + uy * head * 0.7;
  const ry = ey - uy * head - ux * head * 0.7;
  const f = (n: number) => n.toFixed(1);
  return `M${f(sx)} ${f(sy)} L${f(ex)} ${f(ey)} M${f(lx)} ${f(ly)} L${f(ex)} ${f(ey)} L${f(rx)} ${f(ry)}`;
}

/** 卡通白手套，食指指尖在原点，手掌朝右下方。 */
function handGraphic(): SVGGElement {
  const outline =
    'M-6.5 31 L-6.5 6.5 A6.5 6.5 0 0 1 6.5 6.5 L6.5 23 C7 18 16.5 18 17 23.5 ' +
    'C17.5 19.5 26 19.5 26.5 25 C27 22 33 22.5 33 28 L32.5 45 C32 54 26 60 16 60 ' +
    'L5 60 C-1 60 -5 57 -7 51 L-9 45.5 C-13.5 43.5 -19.5 40 -19.5 35.5 ' +
    'C-19.5 31 -14 29.5 -10 32.5 Z';
  return h(
    'g',
    { class: 'guide-hand-body', transform: 'rotate(-16)' },
    h('path', { class: 'hand-shadow', d: outline, transform: 'translate(4 5)' }),
    h('rect', { class: 'hand-cuff', x: '1', y: '56', width: '30', height: '12', rx: '4' }),
    h('path', { class: 'hand-skin', d: outline }),
    h('path', {
      class: 'hand-crease',
      d: 'M6.5 30 C9 33 14 33 16.5 30 M17 31 C19.5 34 24 34 26.5 31.5 M-6 40 C-8 42 -10 43 -12 43',
    }),
  ) as SVGGElement;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function ease(v: number): number {
  return v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2;
}
