// 规则层共享的标识与数据类型。

/** 0 = 玩家队伍，1 = 对手。 */
export type Team = 0 | 1;

export type PlayerUnitKind = 'guard' | 'slinger' | 'bell';

export type EnemyUnitKind =
  | 'archer'
  | 'shell'
  | 'mouse'
  | 'bomber'
  | 'snail'
  | 'brute'
  | 'mirror'
  | 'mortar'
  | 'jack'
  | 'king';

export type UnitKind = PlayerUnitKind | EnemyUnitKind;

export const PLAYER_UNITS: readonly PlayerUnitKind[] = ['guard', 'slinger', 'bell'];

export type ModuleId =
  | 'reflect'
  | 'charge'
  | 'bulwark'
  | 'ricochet'
  | 'rubber'
  | 'heavy'
  | 'pierce'
  | 'vortex'
  | 'magnet'
  | 'mend'
  | 'impact'
  | 'burst'
  | 'mirrorpost'
  | 'spring';

export type ModuleLevel = 1 | 2;

export interface OwnedModule {
  id: ModuleId;
  level: ModuleLevel;
}

/** 伤害归属：玩家单位的基础攻击、某个招式，或对手。用于结算统计。 */
export type DamageSource = PlayerUnitKind | ModuleId | 'detonate' | 'enemy';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Point {
  x: number;
  y: number;
}

/** 战前站位：三名队员的位置，以及机关的位置。 */
export interface Formation {
  units: Record<PlayerUnitKind, Point>;
  gadgets: GadgetPlacement[];
}

export interface GadgetPlacement {
  module: 'mirrorpost' | 'spring';
  index: number;
  x: number;
  y: number;
}

/** 每名队员的槽位（null 表示空槽）。 */
export type Loadout = Record<PlayerUnitKind, Array<ModuleId | null>>;
