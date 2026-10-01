// 界面公用部件：属性徽章、定位标签、形态星级、宠物头像（按帧排队渲染）与宠物卡片。
import { ELEMENT_NAME } from '../core/content/elements.js';
import { DRAGON, ROLE_NAME, SPECIES, formName } from '../core/content/species.js';
import type { BossId, Element, Role, SpeciesId } from '../core/types.js';
import { portrait, type Framing } from '../gfx/portrait.js';
import { cx, h, type Child } from './dom.js';

export const ELEMENT_CSS: Record<Element, string> = {
  fire: '#ff6a3a',
  water: '#3ab0ff',
  wood: '#4cc85a',
  rock: '#d0964a',
  thunder: '#f0c830',
};

export function elementOf(species: SpeciesId | BossId): Element {
  return species === 'dragon' ? DRAGON.element : SPECIES[species].element;
}

export function roleOf(species: SpeciesId | BossId): Role | 'boss' {
  return species === 'dragon' ? 'boss' : SPECIES[species].role;
}

export function elementBadge(e: Element, small = false): Node {
  return h(
    'span',
    { class: cx('elem', `elem-${e}`, small && 'elem-small'), title: `${ELEMENT_NAME[e]}系` },
    ELEMENT_NAME[e],
  );
}

export function roleTag(r: Role | 'boss'): Node {
  return h('span', { class: 'role-tag' }, r === 'boss' ? '首领' : ROLE_NAME[r]);
}

/** 形态星级：幼年 1 颗、进化 2 颗、人形态 3 颗。 */
export function formStars(form: number, max = 3): Node {
  return h(
    'span',
    { class: 'stars', 'aria-label': `第 ${form} 阶` },
    ...Array.from({ length: max }, (_, i) => h('i', { class: cx('star', i < form && 'on') }, '★')),
  );
}

// ---- 头像：3D 模型渲染成图片。第一次渲染要花一点时间，所以排队、每帧只渲染两张 ----

interface PortraitJob {
  img: HTMLImageElement;
  id: string;
  framing: Framing;
  size: number;
}

const queue: PortraitJob[] = [];
let pumping = false;

function pump(): void {
  pumping = true;
  let n = 0;
  while (queue.length > 0 && n < 2) {
    const job = queue.shift() as PortraitJob;
    if (!job.img.isConnected) continue;
    const url = portrait(job.id, { framing: job.framing, size: [job.size, job.size] });
    if (url) job.img.src = url;
    job.img.classList.remove('loading');
    n++;
  }
  if (queue.length > 0) requestAnimationFrame(pump);
  else pumping = false;
}

/** 宠物头像（形态标识如 fox-3）。silhouette 为真时只显示剪影（图鉴里还没见过的）。 */
export function petImage(
  id: string,
  size = 96,
  framing?: Framing,
  silhouette = false,
): HTMLImageElement {
  // 人形态（和烛龙君）拍半身；动物形态拍全身，四足和长尾巴才放得下
  const humanoid = id.endsWith('-3') || id === 'dragon-2';
  const frame: Framing = framing ?? (humanoid ? 'bust' : 'full');
  const img = h('img', {
    class: cx('pet-img', 'loading', silhouette && 'silhouette'),
    width: size,
    height: size,
    alt: '',
    draggable: 'false',
  }) as HTMLImageElement;
  queue.push({
    img,
    id,
    framing: frame,
    size: Math.round(size * Math.min(2, window.devicePixelRatio || 1)),
  });
  if (!pumping) requestAnimationFrame(pump);
  return img;
}

export interface PetCardOptions {
  species: SpeciesId | BossId;
  form: number;
  selected?: boolean;
  onClick?: () => void;
  onHover?: () => void;
  /** 卡片右上角的小标（“新”“→人形态”）。 */
  badge?: Child;
  extra?: Child;
  testId?: string;
  dim?: boolean;
  size?: number;
}

/** 宠物卡片：头像、名字、属性、定位、形态。 */
export function petCard(o: PetCardOptions): HTMLElement {
  const e = elementOf(o.species);
  const name = formName(o.species, o.form);
  return h(
    o.onClick ? 'button' : 'div',
    {
      type: o.onClick ? 'button' : undefined,
      class: cx('pet-card', `edge-${e}`, o.selected && 'selected', o.dim && 'dim'),
      'data-testid': o.testId,
      'aria-pressed': o.onClick ? (o.selected ? 'true' : 'false') : undefined,
      onClick: o.onClick
        ? (ev: Event) => {
            ev.stopPropagation();
            o.onClick?.();
          }
        : undefined,
      onMouseEnter: o.onHover,
    },
    o.badge ? h('span', { class: 'pet-card-badge' }, o.badge) : null,
    h('div', { class: 'pet-card-img' }, petImage(`${o.species}-${o.form}`, o.size ?? 96)),
    h('div', { class: 'pet-card-name' }, name),
    h(
      'div',
      { class: 'pet-card-meta' },
      elementBadge(e, true),
      roleTag(roleOf(o.species)),
      formStars(o.species === 'dragon' ? 3 : o.form),
    ),
    o.extra ?? null,
  ) as HTMLElement;
}
