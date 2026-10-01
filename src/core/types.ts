// 规则层共享的标识与数据类型。

/** 0 = 玩家军团（左侧，面朝 +x），1 = 对手（右侧）。 */
export type Team = 0 | 1;

/** 五系：火、水、木、岩、雷。 */
export type Element = 'fire' | 'water' | 'wood' | 'rock' | 'thunder';

/** 定位：坦克、战士、刺客、射手、法师、辅助。 */
export type Role = 'tank' | 'fighter' | 'assassin' | 'ranged' | 'mage' | 'support';

/** 十种精灵宠物（玩家可以拥有的全部物种）。 */
export type SpeciesId =
  'fox' | 'bird' | 'otter' | 'turtle' | 'bunny' | 'deer' | 'cat' | 'wolf' | 'bear' | 'lizard';

/** 首领：烛龙。只出现在最后一场，不会给玩家。 */
export type BossId = 'dragon';

/** 进化形态：1 幼年、2 进化、3 人形态。 */
export type Form = 1 | 2 | 3;

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Point {
  x: number;
  y: number;
}

/** 技能标识：每个物种一个自动技能、一个大招（只有人形态有）；首领另有几招。 */
export type SkillId =
  | `${SpeciesId}Skill`
  | `${SpeciesId}Ult`
  | 'dragonBreath'
  | 'dragonTail'
  | 'dragonSummon'
  | 'dragonUlt';

/**
 * 伤害来源：技能、基础攻击、撞击（被击飞后撞到单位或墙）、反射（弹丸被弹回）。
 * 灼烧等持续伤害记在施加它的技能上。
 */
export type DamageSource = SkillId | 'basic' | 'impact' | 'reflect';

/** 玩家军团里的一只宠物及其开战位置。uid 在一轮内唯一。 */
export interface LegionPet {
  uid: number;
  species: SpeciesId;
  form: Form;
  x: number;
  y: number;
}
