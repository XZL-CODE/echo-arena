// 界面图标：简单的 SVG 线条图形。
import { h } from './dom.js';

const UI_GLYPHS = {
  pause: 'M17 12 V36 M31 12 V36',
  play: 'M16 11 L37 24 L16 37 Z',
  sound: 'M8 19 H15 L25 11 V37 L15 29 H8 Z M31 17 C35 20 35 28 31 31 M35 12 C42 18 42 30 35 36',
  mute: 'M8 19 H15 L25 11 V37 L15 29 H8 Z M31 18 L41 30 M41 18 L31 30',
  gear: 'M24 16 A8 8 0 1 1 23.9 16 M24 5 V10 M24 38 V43 M5 24 H10 M38 24 H43 M10.5 10.5 L14 14 M34 34 L37.5 37.5 M10.5 37.5 L14 34 M34 14 L37.5 10.5',
  menu: 'M9 14 H39 M9 24 H39 M9 34 H39',
  close: 'M13 13 L35 35 M35 13 L13 35',
  echo: 'M24 24 A3 3 0 1 1 23.9 24 M24 14 A10 10 0 0 1 34 24 M24 34 A10 10 0 0 1 14 24 M24 6 A18 18 0 0 1 42 24 M24 42 A18 18 0 0 1 6 24',
  target: 'M24 12 A12 12 0 1 1 23.9 12 M24 4 V14 M24 34 V44 M4 24 H14 M34 24 H44',
  warn: 'M24 7 L42 39 H6 Z M24 18 V28 M24 33 V34',
  info: 'M24 8 A16 16 0 1 1 23.9 8 M24 21 V33 M24 15 V16',
  time: 'M24 8 A16 16 0 1 1 23.9 8 M24 14 V24 L31 29',
  unit: 'M24 8 A7 7 0 1 1 23.9 8 M11 40 C11 30 17 25 24 25 C31 25 37 30 37 40',
  source: 'M24 6 L28 18 L41 18 L30 26 L34 39 L24 31 L14 39 L18 26 L7 18 L20 18 Z',
  speed: 'M8 12 L22 24 L8 36 Z M24 12 L38 24 L24 36 Z',
  folder: 'M6 14 H19 L23 18 H42 V38 H6 Z',
  help: 'M24 6 A18 18 0 1 1 23.9 6 M18.5 19 C18.5 12.5 29.5 12.5 29.5 19 C29.5 24 24 24.5 24 29.5 M24 35 V35.5',
  check: 'M10 25 L20 35 L38 14',
} as const;

export type UiIcon = keyof typeof UI_GLYPHS;

export function uiIcon(name: UiIcon, size = 20): Node {
  const filled = name === 'play' || name === 'speed' || name === 'source';
  return h(
    'svg',
    { class: 'ui-icon', viewBox: '0 0 48 48', width: size, height: size, 'aria-hidden': 'true' },
    h('path', {
      d: UI_GLYPHS[name],
      fill: filled ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': 4,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
}
