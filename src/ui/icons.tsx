// 招式与界面图标：简单的 SVG 线条图形，颜色按思路分组。
import { MODULE_DEFS, type ModuleFamily } from '../core/content/modules.js';
import type { ModuleId } from '../core/types.js';
import { h } from './dom.js';

export const FAMILY_COLORS: Record<ModuleFamily, string> = {
  reflect: '#7ee8fa',
  bounce: '#72f2c8',
  impact: '#ffae42',
  gather: '#ff8fc8',
  guard: '#ffe066',
};

const GLYPHS: Record<ModuleId, string> = {
  reflect:
    'M24 9 L37 14 V24 C37 32 31 37 24 40 C17 37 11 32 11 24 V14 Z M30 5 L22 18 M22 18 L16 8 M16 8 L14 14 M16 8 L21 9',
  charge: 'M9 24 H35 M27 15 L37 24 L27 33 M5 16 H14 M3 32 H12',
  bulwark: 'M24 7 L38 12 V24 C38 33 31 38 24 41 C17 38 10 33 10 24 V12 Z M24 17 V31 M17 24 H31',
  ricochet: 'M8 36 L22 14 L36 32 L42 20 M42 20 L41 27 M42 20 L36 23',
  rubber: 'M8 6 V42 M34 36 C26 36 14 30 9 20 C14 12 24 9 32 10',
  heavy: 'M24 12 A12 12 0 1 1 23.9 12 M12 38 H36 M16 43 H32',
  pierce: 'M4 24 H42 M35 17 L43 24 L35 31 M14 18 A6 6 0 1 1 13.9 18 M28 18 A6 6 0 1 1 27.9 18',
  vortex:
    'M24 24 C24 20 30 20 30 25 C30 31 20 32 18 25 C16 16 30 12 35 21 C40 31 30 40 22 38 C12 36 8 26 12 17',
  magnet:
    'M13 10 V26 C13 33 18 38 24 38 C30 38 35 33 35 26 V10 M13 10 H20 V26 C20 29 22 31 24 31 C26 31 28 29 28 26 V10 H35 M13 15 H20 M28 15 H35',
  mend: 'M24 39 C14 32 8 26 8 18 C8 12 13 8 18 9 C21 10 23 12 24 14 C25 12 27 10 30 9 C35 8 40 12 40 18 C40 26 34 32 24 39 Z M24 17 V29 M18 23 H30',
  impact:
    'M14 24 A8 8 0 1 1 13.9 24 M42 24 A8 8 0 1 1 41.9 24 M24 13 V9 M24 39 V35 M18 16 L15 13 M30 16 L33 13 M18 32 L15 35 M30 32 L33 35',
  burst:
    'M24 5 L28 17 L40 12 L32 22 L43 28 L30 29 L31 42 L24 33 L17 42 L18 29 L5 28 L16 22 L8 12 L20 17 Z',
  mirrorpost: 'M24 22 A11 11 0 1 1 23.9 22 M24 33 V43 M16 43 H32 M19 16 L27 8 M35 6 V12 M32 9 H38',
  spring: 'M14 8 H34 M14 40 H34 M16 12 L32 16 L16 20 L32 24 L16 28 L32 32 L16 36',
};

export function moduleIcon(id: ModuleId, size = 44): Node {
  const def = MODULE_DEFS[id];
  const color = FAMILY_COLORS[def.family];
  return h(
    'svg',
    {
      class: 'module-icon',
      viewBox: '0 0 48 48',
      width: size,
      height: size,
      'aria-hidden': 'true',
    },
    h('rect', {
      x: 1.5,
      y: 1.5,
      width: 45,
      height: 45,
      rx: 11,
      fill: '#2a1f26',
      stroke: color,
      'stroke-width': 2,
    }),
    h('path', {
      d: GLYPHS[id],
      fill: 'none',
      stroke: color,
      'stroke-width': 3.2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
}

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
