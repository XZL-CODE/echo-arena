// 规则与招式的可调数值集中在这里，便于平衡调整。

export const ARENA = {
  width: 1200,
  height: 660,
  /** 玩家布阵区的右边界。 */
  playerZoneMaxX: 400,
  /** 机关可放置区的右边界（我方半场 + 中场）。 */
  gadgetZoneMaxX: 720,
  /** 对手出场区的左边界。 */
  enemyZoneMinX: 760,
  margin: 30,
} as const;

export const SIM = {
  /** 固定步长（秒）。 */
  dt: 1 / 60,
  /** 滑行减速度（像素/秒²）。 */
  friction: 1400,
  /** 速度高于此值视为被击飞，不能行动。 */
  slideSpeed: 90,
  /** 撞击生效的最低相对速度。 */
  impactMinSpeed: 150,
  /** 每级回响的伤害加成。 */
  echoBonus: 0.3,
  /** 回响等级上限。 */
  echoCap: 8,
  /** 一颗弹丸最多被反射的次数，防止无限乒乓。 */
  maxReflects: 6,
  maxProjectiles: 320,
  maxUnits: 48,
  /** 超过此时间进入加时：伤害逐步提高，保证对局结束。 */
  overtimeStart: 60,
  overtimeStep: 10,
  overtimeBonus: 0.3,
  /** 硬上限：超过后判负（时间耗尽）。 */
  timeLimit: 180,
} as const;

export const DIFFICULTY_MULT = {
  easy: { enemyHp: 0.75, enemyDamage: 0.75 },
  normal: { enemyHp: 1, enemyDamage: 1 },
  hard: { enemyHp: 1.3, enemyDamage: 1.25 },
} as const;

export const MODULE_TUNING = {
  reflect: { ricochetsLv2: 2, ricochetRange: 280 },
  charge: {
    speed: 900,
    maxDistance: 380,
    damage: 16,
    knock: 640,
    quakeRadius: 125,
    quakeDamage: 14,
    quakeKnock: 520,
  },
  bulwark: { hpBonus: 0.7, tauntInterval: 6, tauntDuration: 2.5, tauntRadius: 220 },
  ricochet: { countLv1: 1, countLv2: 3, range: 260 },
  rubber: { bounces: 2, homingTurn: 9 },
  heavy: { damageMult: 1.4, cooldownMult: 1.3, knock: 330, bigKnock: 620, bigRadius: 9 },
  pierce: { speed: 720, radius: 13, damage: 26, knock: 560 },
  vortex: { radius: 170, duration: 1.6, pullSpeed: 330, burstDamage: 20, burstKnock: 600 },
  magnet: { radius: 260, pull: 620, resonance: 0.4, resonanceTime: 3 },
  mend: { healMult: 2, radiusBonus: 50, shield: 20, shieldTime: 3 },
  impact: { base: 4, perSpeed: 0.04, lv2Mult: 1.6, lv2Stun: 1 },
  burst: { radiusLv1: 80, radiusLv2: 110, damage: 18, knock: 460 },
  mirrorpost: { radius: 16 },
  spring: { radius: 18, bounceSpeed: 520, damage: 8 },
} as const;
