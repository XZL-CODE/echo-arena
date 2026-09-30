// 五系与克制：水克火，火克木，木克岩，岩克雷，雷克水。
import type { Element } from '../types.js';

export const ELEMENTS: readonly Element[] = ['fire', 'water', 'wood', 'rock', 'thunder'];

export const ELEMENT_NAME: Record<Element, string> = {
  fire: '火',
  water: '水',
  wood: '木',
  rock: '岩',
  thunder: '雷',
};

/** 每一系克制的那一系。 */
const BEATS: Record<Element, Element> = {
  water: 'fire',
  fire: 'wood',
  wood: 'rock',
  rock: 'thunder',
  thunder: 'water',
};

/** 克制时的伤害倍率。 */
export const COUNTER_BONUS = 1.3;
/** 被克制时的伤害倍率。 */
export const COUNTERED_MULT = 0.85;

/** a 是否克制 b。 */
export function counters(a: Element, b: Element): boolean {
  return BEATS[a] === b;
}

/** 攻击方打防守方的属性倍率。 */
export function counterMult(attacker: Element, defender: Element): number {
  if (counters(attacker, defender)) return COUNTER_BONUS;
  if (counters(defender, attacker)) return COUNTERED_MULT;
  return 1;
}

/** 伤害事件里的克制标记：1 克制、-1 被克制、0 无关。 */
export function counterSign(attacker: Element, defender: Element): 1 | 0 | -1 {
  if (counters(attacker, defender)) return 1;
  if (counters(defender, attacker)) return -1;
  return 0;
}

/** 克制 e 的那一系（界面提示“用什么打它”）。 */
export function counteredBy(e: Element): Element {
  return ELEMENTS.find((x) => BEATS[x] === e) as Element;
}
