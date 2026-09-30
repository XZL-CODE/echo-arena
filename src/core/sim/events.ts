// 模拟向表现层（画面、声音、界面）发出的事件。都带单位 id 与位置，方便摆放特效。
import type { BossId, DamageSource, Element, SkillId, SpeciesId, Team } from '../types.js';
import type { ZoneKind } from './entities.js';

/** 基础攻击的出手方式；heal 是泡泡獭用普通攻击给队友治疗。 */
export type AttackStyleEvent = 'melee' | 'shoot' | 'lob' | 'cast' | 'heal';

/** 状态：knockup 同时带眩晕与腾空；shield 是泡泡护盾。 */
export type StatusKind =
  'burn' | 'root' | 'stun' | 'knockup' | 'taunt' | 'guard' | 'stoneSkin' | 'shield';

export type SimEvent =
  | {
      type: 'attack';
      unitId: number;
      targetId: number;
      style: AttackStyleEvent;
      x: number;
      y: number;
      tx: number;
      ty: number;
    }
  | {
      type: 'hit';
      targetId: number;
      sourceId: number;
      x: number;
      y: number;
      amount: number;
      echo: number;
      /** 攻击方。 */
      team: Team;
      /** 这次伤害的属性。 */
      element: Element;
      /** 1 克制、-1 被克制、0 无关。 */
      counter: 1 | 0 | -1;
      killed: boolean;
      /** 技能 id、'basic'、'impact'（撞击）或 'reflect'（反射）。 */
      source: DamageSource;
      /** 灼烧、燃烧地面等持续伤害。 */
      dot: boolean;
    }
  | { type: 'heal'; targetId: number; sourceId: number; amount: number; x: number; y: number }
  | { type: 'shield'; targetId: number; amount: number }
  | {
      type: 'skill';
      unitId: number;
      skill: SkillId;
      form: number;
      x: number;
      y: number;
      tx: number;
      ty: number;
    }
  | { type: 'ult'; unitId: number; skill: SkillId; x: number; y: number; tx: number; ty: number }
  | { type: 'dash'; unitId: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'blink'; unitId: number; fromX: number; fromY: number; toX: number; toY: number }
  | {
      type: 'chain';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      echo: number;
      element: Element;
    }
  | { type: 'reflect'; unitId: number; x: number; y: number; echo: number }
  | {
      type: 'explode';
      x: number;
      y: number;
      radius: number;
      element: Element;
      echo: number;
      team: Team;
      source: DamageSource;
    }
  | { type: 'impact'; x: number; y: number; strength: number; echo: number }
  | { type: 'status'; unitId: number; status: StatusKind; duration: number }
  | {
      type: 'zone';
      zoneId: number;
      kind: ZoneKind;
      x: number;
      y: number;
      r: number;
      angle?: number;
      length?: number;
    }
  | { type: 'echo'; x: number; y: number; level: number; chain: number; source: DamageSource }
  | {
      type: 'death';
      unitId: number;
      species: SpeciesId | BossId;
      form: number;
      team: Team;
      x: number;
      y: number;
    }
  | { type: 'spawn'; unitId: number }
  | { type: 'transform'; unitId: number }
  | { type: 'focus'; unitId: number }
  | { type: 'overtime'; level: number }
  | { type: 'energyFull'; unitId: number }
  | { type: 'end'; result: 'win' | 'lose' };
