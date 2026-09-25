// 通用界面部件：按钮、按键提示、弹窗、开关与滑条。
import { cx, h, type Child } from './dom.js';
import { uiIcon, type UiIcon } from './icons.js';

export interface ButtonProps {
  label: Child;
  onClick: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'normal' | 'big';
  icon?: UiIcon;
  hotkey?: string;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

export function button(p: ButtonProps): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: cx('btn', `btn-${p.kind ?? 'secondary'}`, p.size && `btn-${p.size}`),
      disabled: p.disabled,
      title: p.title,
      'data-testid': p.testId,
      onClick: (e: Event) => {
        e.stopPropagation();
        if (!p.disabled) p.onClick();
      },
    },
    p.icon ? uiIcon(p.icon, p.size === 'big' ? 22 : 18) : null,
    h('span', { class: 'btn-label' }, p.label),
    p.hotkey ? kbd(p.hotkey) : null,
  ) as HTMLButtonElement;
}

export function iconButton(
  icon: UiIcon,
  title: string,
  onClick: () => void,
  testId?: string,
): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'icon-btn',
      title,
      'aria-label': title,
      'data-testid': testId,
      onClick: (e: Event) => {
        e.stopPropagation();
        onClick();
      },
    },
    uiIcon(icon, 20),
  ) as HTMLButtonElement;
}

export function kbd(text: string): Node {
  return h('kbd', { class: 'kbd' }, text);
}

export interface DialogOptions {
  title: string;
  body: Child;
  actions: HTMLButtonElement[];
  onClose?: () => void;
  wide?: boolean;
  testId?: string;
}

/** 居中的弹窗卡片；点击遮罩或按 Esc 关闭（由调用方处理 onClose）。 */
export function dialog(o: DialogOptions): HTMLElement {
  return h(
    'div',
    {
      class: 'modal-backdrop',
      'data-testid': o.testId,
      onClick: (e: Event) => {
        if (e.target === e.currentTarget) o.onClose?.();
      },
    },
    h(
      'div',
      {
        class: cx('modal', o.wide && 'modal-wide'),
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': o.title,
      },
      h(
        'div',
        { class: 'modal-head' },
        h('h2', null, o.title),
        o.onClose ? iconButton('close', '关闭', o.onClose) : null,
      ),
      h('div', { class: 'modal-body' }, o.body),
      h('div', { class: 'modal-actions' }, ...o.actions),
    ),
  ) as HTMLElement;
}

export function toggle(
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
  hint?: string,
): Node {
  const input = h('input', {
    type: 'checkbox',
    checked: value,
    onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
  });
  return h(
    'label',
    { class: 'field toggle' },
    input,
    h('span', { class: 'toggle-track', 'aria-hidden': 'true' }),
    h('span', { class: 'field-label' }, label, hint ? h('small', null, hint) : null),
  );
}

export function slider(label: string, value: number, onChange: (v: number) => void): Node {
  const out = h('output', { class: 'slider-value' }, `${Math.round(value * 100)}%`);
  const input = h('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 5,
    value: Math.round(value * 100),
    'aria-label': label,
    onInput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      out.textContent = `${Math.round(v * 100)}%`;
      onChange(v);
    },
  });
  return h(
    'label',
    { class: 'field slider' },
    h('span', { class: 'field-label' }, label),
    input,
    out,
  );
}

export function segmented<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
  onChange: (v: T) => void,
  ariaLabel: string,
): Node {
  return h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': ariaLabel },
    ...options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': o.value === value ? 'true' : 'false',
          class: cx('seg', o.value === value && 'seg-on'),
          onClick: (e: Event) => {
            e.stopPropagation();
            onChange(o.value);
          },
        },
        o.label,
      ),
    ),
  );
}
