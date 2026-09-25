// 极简 JSX 工厂：直接创建真实 DOM 节点，不做虚拟 DOM 对比。
// 界面按区域整块重建；每帧变化的数值（血量、冷却）直接更新节点。

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = Record<string, unknown> | null;

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg',
  'path',
  'circle',
  'rect',
  'g',
  'line',
  'polyline',
  'polygon',
  'ellipse',
]);

export function h(
  tag: string | ((props: Record<string, unknown>) => Node),
  props: Props,
  ...children: Child[]
): Node {
  if (typeof tag === 'function') return tag({ ...(props ?? {}), children });
  const svg = SVG_TAGS.has(tag);
  const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'ref' && typeof value === 'function') {
        (value as (node: Element) => void)(el);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign((el as HTMLElement).style, value);
      } else if (key === 'className' || key === 'class') {
        el.setAttribute('class', String(value));
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function Fragment(props: { children?: Child[] }): Node {
  const frag = document.createDocumentFragment();
  append(frag, props.children ?? []);
  return frag;
}

function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/** 用新内容替换容器里的全部子节点。 */
export function mount(container: Element, ...children: Child[]): void {
  container.replaceChildren();
  append(container, children);
}

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = Node;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown>;
    }
  }
}
