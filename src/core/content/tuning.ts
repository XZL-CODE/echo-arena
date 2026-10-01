// 场地与规则层的通用数值，集中在这里便于平衡调整。物种与技能数值在 species.ts。

/** 模拟单位：1 像素 = 1 厘米（18 × 11 米的开阔场地，边缘是看不见的屏障）。 */
export const ARENA = {
  width: 1800,
  height: 1100,
  /** 玩家布阵区的右边界。 */
  playerZoneMaxX: 640,
  /** 对手出场区的左边界。 */
  enemyZoneMinX: 1160,
  /** 布阵时离场地边缘的最小距离。 */
  margin: 40,
} as const;

export const SIM = {
  /** 固定步长（秒）。 */
  dt: 1 / 60,
  /** 被击飞后的滑行减速度（像素/秒²）。 */
  friction: 1400,
  /** 速度高于此值视为被击飞：不能行动，撞到东西会产生撞击。 */
  slideSpeed: 90,
  /** 撞击生效的最低相对速度。 */
  impactMinSpeed: 150,
  /** 每级回响的伤害加成。 */
  echoBonus: 0.25,
  /** 回响等级上限。 */
  echoCap: 8,
  /** 一颗弹丸最多被反射的次数，防止两边来回弹个不停。 */
  maxReflects: 4,
  maxProjectiles: 320,
  maxUnits: 48,
  maxZones: 48,
  /** 超过此时间进入加时：伤害逐步提高，保证对局结束。 */
  overtimeStart: 60,
  overtimeStep: 10,
  overtimeBonus: 0.3,
  /** 硬上限：超过后判负（时间耗尽）。 */
  timeLimit: 180,
  /** 灼烧与燃烧地面的结算间隔（秒）。 */
  dotTick: 0.5,
} as const;

/** 能量：只有人形态（3 阶）和首领人形才有，满 100 自动放大招。 */
export const ENERGY = {
  start: 30,
  full: 100,
  perBasicHit: 12,
  perSkill: 8,
  /** 受到伤害时按“伤害 / 生命上限 × 此值”获得能量。 */
  perDamageTaken: 60,
} as const;

/** 难度只调整对手；每往后一场，对手再轻微变强。 */
export const DIFFICULTY_MULT = {
  easy: { enemyHp: 0.75, enemyDamage: 0.75 },
  normal: { enemyHp: 1, enemyDamage: 1 },
  hard: { enemyHp: 1.3, enemyDamage: 1.25 },
} as const;

export const MATCH_HP_SCALING = 0.02;
export const MATCH_DAMAGE_SCALING = 0.01;

/** 首领受到控制时的时长倍率（体型太大，只会短暂失衡）。 */
export const BOSS_CC_MULT = 0.5;
