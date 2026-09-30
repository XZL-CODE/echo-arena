// 物种数据：属性、定位、三个形态的名字与说明、各形态的基础数值、技能与大招的数值。
// 行为逻辑在 sim/skills.ts；这里只放可调的数据，便于平衡。
import type { ProjectileKind } from '../sim/entities.js';
import type { BossId, Element, Form, Role, SkillId, SpeciesId } from '../types.js';

export const SPECIES_IDS: readonly SpeciesId[] = [
  'fox',
  'bird',
  'otter',
  'turtle',
  'bunny',
  'deer',
  'cat',
  'wolf',
  'bear',
  'lizard',
];

export const FORMS: readonly Form[] = [1, 2, 3];

export const ROLE_NAME: Record<Role, string> = {
  tank: '坦克',
  fighter: '战士',
  assassin: '刺客',
  ranged: '射手',
  mage: '法师',
  support: '辅助',
};

export const FORM_NAME: Record<Form, string> = { 1: '幼年', 2: '进化', 3: '人形态' };

export interface FormStats {
  hp: number;
  atk: number;
  /** 两次基础攻击的间隔（秒）。 */
  interval: number;
  /** 攻击距离：双方边缘之间的距离。近战约 18。 */
  range: number;
  speed: number;
  radius: number;
  /** 质量：影响被击退的距离与碰撞时的动量交换。 */
  mass: number;
}

export type AttackStyle = 'melee' | 'shoot' | 'lob' | 'cast';

export interface AttackDef {
  style: AttackStyle;
  /** 出手前摇（秒），动画据此蓄力。 */
  windup: number;
  projectile?: ProjectileKind;
  /** 射击的弹丸速度。 */
  speed?: number;
  /** 抛射的飞行时间（秒）。 */
  flight?: number;
  /** 命中或落地后的溅射半径。 */
  splash?: number;
  /** 命中时的击退力度。 */
  knock?: number;
  /** 队友受伤时改为治疗：回复量 = 攻击力 × 此值（泡泡獭）。 */
  heal?: number;
}

export interface SkillDef {
  id: SkillId;
  name: string;
  /** 冷却（秒）；大招靠能量，为 0。 */
  cooldown: number;
  /** 施放前摇（秒）；大招的前摇不能被打断。 */
  cast: number;
}

export interface SpeciesDef {
  id: SpeciesId;
  element: Element;
  role: Role;
  /** 三个形态的名字。 */
  names: readonly [string, string, string];
  /** 每个形态一句话：技能做什么（界面展示）。 */
  blurbs: readonly [string, string, string];
  stats: readonly [FormStats, FormStats, FormStats];
  attack: AttackDef;
  skill: SkillDef;
  ult: SkillDef;
}

/** 形态成长：2 阶约 ×1.7 生命、×1.55 攻击；3 阶再 ×1.6 生命、×1.5 攻击。 */
export const FORM_GROWTH = {
  hp: [1, 1.7, 2.72],
  atk: [1, 1.55, 2.325],
  speed: [1, 1.05, 1.1],
} as const;

type BaseStats = Omit<FormStats, 'radius' | 'mass'>;

function grow(
  base: BaseStats,
  radius: readonly [number, number, number],
  mass: readonly [number, number, number],
): readonly [FormStats, FormStats, FormStats] {
  const at = (i: 0 | 1 | 2): FormStats => ({
    hp: Math.round(base.hp * FORM_GROWTH.hp[i]),
    atk: Math.round(base.atk * FORM_GROWTH.atk[i] * 10) / 10,
    interval: base.interval,
    range: base.range,
    speed: Math.round(base.speed * FORM_GROWTH.speed[i]),
    radius: radius[i],
    mass: mass[i],
  });
  return [at(0), at(1), at(2)];
}

/** 近战攻击距离（边缘间距）。 */
export const MELEE_RANGE = 18;

/**
 * 技能与大招的数值。字段含义：mult 为攻击力倍率；radius 为作用半径；
 * 按形态给出的数组依次对应 1、2、3 阶。
 */
export const SKILLS = {
  fox: {
    skill: {
      id: 'foxSkill',
      name: '焰爪突袭',
      cooldown: 6,
      cast: 0.2,
      /** 第一段冲刺能找的目标距离。 */
      reach: 380,
      /** 后续每一段从当前位置出发能找的距离。 */
      hopReach: 260,
      hops: [1, 2, 3],
      speed: 1100,
      mult: 1.8,
      burnTime: 3,
      /** 灼烧每秒伤害 = 攻击力 × 此值。 */
      burnRatio: 0.2,
    },
    ult: {
      id: 'foxUlt',
      name: '狐火·千本斩',
      cooldown: 0,
      cast: 1.0,
      hops: 6,
      interval: 0.12,
      mult: 1.6,
      blastMult: 0.6,
      blastRadius: 60,
    },
  },
  bird: {
    skill: {
      id: 'birdSkill',
      name: '烈焰弹',
      cooldown: 7,
      cast: 0.4,
      speed: 480,
      radius: 90,
      mult: 2.0,
      /** 2 阶起：燃烧地面持续时间与每秒伤害倍率。 */
      groundTime: 3,
      groundRatio: 0.4,
    },
    ult: {
      id: 'birdUlt',
      name: '凤凰陨',
      cooldown: 0,
      cast: 1.2,
      speed: 900,
      width: 70,
      mult: 3.0,
      groundTime: 3,
      groundRatio: 0.4,
      /** 被凤凰陨击倒的敌人爆炸：半径与倍率（每次连爆回响 +1）。 */
      burstRadius: 55,
      burstMult: 0.8,
    },
  },
  otter: {
    skill: {
      id: 'otterSkill',
      name: '泡泡护盾',
      cooldown: 7,
      cast: 0.3,
      reach: 320,
      targets: [1, 2, 2],
      /** 护盾量 = 攻击力 × 此值。 */
      shieldMult: 8,
      duration: 5,
    },
    ult: {
      id: 'otterUlt',
      name: '潮汐颂',
      cooldown: 0,
      cast: 1.0,
      heal: 0.25,
      /** 护盾量 = 目标生命上限 × 此值。 */
      shield: 0.15,
      duration: 5,
      range: 640,
      waveSpeed: 800,
      knock: 720,
      mult: 0.8,
    },
  },
  turtle: {
    skill: {
      id: 'turtleSkill',
      name: '玄甲壁',
      cooldown: 8,
      cast: 0.15,
      duration: 3,
      tauntRadius: 160,
      tauntTime: 2.5,
      reduction: 0.5,
      /** 正面反射的半角（弧度）。 */
      arc: 1.3,
      /** 2 阶起：弹回的弹丸命中后再弹射的次数。 */
      ricochet: [0, 1, 1],
    },
    ult: {
      id: 'turtleUlt',
      name: '玄武壁垒',
      cooldown: 0,
      cast: 1.0,
      duration: 4,
      length: 720,
      /** 水墙离我方最前排的距离。 */
      offset: 80,
      reduction: 0.4,
    },
  },
  bunny: {
    skill: {
      id: 'bunnySkill',
      name: '万叶连射',
      cooldown: 6,
      cast: 0.3,
      arrows: 3,
      mult: 1.0,
    },
    ult: {
      id: 'bunnyUlt',
      name: '森罗箭雨',
      cooldown: 0,
      cast: 1.0,
      radius: 140,
      waves: 10,
      duration: 1.5,
      mult: 0.6,
      pierceArrows: 3,
      pierceMult: 1.2,
    },
  },
  deer: {
    skill: {
      id: 'deerSkill',
      name: '藤缚',
      cooldown: 8,
      cast: 0.4,
      radius: [90, 120, 120],
      root: 1.8,
      pullSpeed: 170,
      /** 2 阶起：治疗藤蔓附近队友的比例（生命上限）。 */
      heal: 0.08,
    },
    ult: {
      id: 'deerUlt',
      name: '万花缚',
      cooldown: 0,
      cast: 1.2,
      radius: 200,
      root: 2.5,
      pullSpeed: 190,
      mult: 1.5,
      heal: 0.2,
    },
  },
  cat: {
    skill: {
      id: 'catSkill',
      name: '连环雷',
      cooldown: 6.5,
      cast: 0.35,
      targets: [4, 6, 6],
      mult: 0.75,
      jumpRange: 230,
      delay: 0.1,
    },
    ult: {
      id: 'catUlt',
      name: '九霄雷落',
      cooldown: 0,
      cast: 1.2,
      strikes: 10,
      interval: 0.1,
      mult: 1.4,
      radius: 150,
      finalMult: 1.0,
      stun: 1,
    },
  },
  wolf: {
    skill: {
      id: 'wolfSkill',
      name: '奔雷突',
      cooldown: 7,
      cast: 0.3,
      distance: 300,
      speed: 900,
      mult: 1.2,
      knock: 760,
      /** 2 阶起：终点雷击。 */
      slamRadius: 80,
      slamMult: 1.0,
      slamStun: 0.6,
    },
    ult: {
      id: 'wolfUlt',
      name: '雷狼噬',
      cooldown: 0,
      cast: 1.0,
      passes: 3,
      speed: 1100,
      overshoot: 170,
      mult: 1.5,
      knock: 620,
      stun: 0.8,
      blastRadius: 130,
      blastMult: 2.0,
    },
  },
  bear: {
    skill: {
      id: 'bearSkill',
      name: '裂地击',
      cooldown: 7,
      cast: 0.35,
      radius: 100,
      mult: 1.6,
      knockUp: 0.8,
      /** 2 阶起：向前的一排岩刺。 */
      spikeLength: 260,
      spikeWidth: 32,
      spikeMult: 1.0,
    },
    ult: {
      id: 'bearUlt',
      name: '岩王崩山',
      cooldown: 0,
      cast: 1.2,
      radius: 180,
      mult: 3.0,
      knockUp: 1.2,
      skinRadius: 240,
      skinTime: 4,
      /** 石肤：受到的伤害减少比例。 */
      skin: 0.3,
    },
  },
  lizard: {
    skill: {
      id: 'lizardSkill',
      name: '晶簇爆',
      cooldown: 8,
      cast: 0.4,
      flight: 1.0,
      radius: 70,
      mult: 1.5,
      shards: [6, 10, 10],
      shardMult: 0.45,
      shardSpeed: 520,
      shardRange: 280,
    },
    ult: {
      id: 'lizardUlt',
      name: '晶陨',
      cooldown: 0,
      cast: 1.3,
      flight: 1.1,
      radius: 150,
      mult: 3.5,
      shards: 12,
      shardMult: 0.6,
      shardSpeed: 560,
      shardRange: 320,
    },
  },
} as const;

const s = SKILLS;

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  fox: {
    id: 'fox',
    element: 'fire',
    role: 'assassin',
    names: ['小焰狐', '焰尾狐', '九焰'],
    blurbs: [
      '焰爪突袭：冲向附近生命最低的敌人，重击并点燃它。',
      '焰爪突袭连冲两个目标，第二击回响 +1。',
      '焰爪突袭连冲三个目标。大招狐火·千本斩：瞬身斩过至多 6 个敌人，随后全部引爆。',
    ],
    stats: grow(
      { hp: 300, atk: 15, interval: 0.8, range: MELEE_RANGE, speed: 95 },
      [19, 25, 23],
      [1.2, 1.6, 1.5],
    ),
    attack: { style: 'melee', windup: 0.15 },
    skill: s.fox.skill,
    ult: s.fox.ult,
  },
  bird: {
    id: 'bird',
    element: 'fire',
    role: 'mage',
    names: ['火团雀', '炎翎鸟', '朱雀'],
    blurbs: [
      '烈焰弹：向敌人最密集处投下大火球，大范围爆炸。',
      '烈焰弹落地后留下燃烧地面，持续灼烧站在上面的敌人。',
      '大招凤凰陨：火凤横扫一条直线并沿路燃烧，被它击倒的敌人会连环爆炸。',
    ],
    stats: grow(
      { hp: 240, atk: 14, interval: 1.6, range: 290, speed: 65 },
      [18, 24, 22],
      [1, 1.3, 1.3],
    ),
    attack: { style: 'shoot', windup: 0.3, projectile: 'fireball', speed: 420, splash: 45 },
    skill: s.bird.skill,
    ult: s.bird.ult,
  },
  otter: {
    id: 'otter',
    element: 'water',
    role: 'support',
    names: ['泡泡獭', '浪花獭', '潮音'],
    blurbs: [
      '泡泡护盾：给生命最低的队友套上泡泡，吸收伤害，还会把敌方弹丸弹回去。队友受伤时优先治疗。',
      '泡泡护盾一次套给两个队友。',
      '大招潮汐颂：向前推出浪潮，治疗并护住全体队友，把敌人冲开撞在一起。',
    ],
    stats: grow(
      { hp: 300, atk: 8, interval: 1.15, range: 230, speed: 70 },
      [19, 25, 23],
      [1.3, 1.7, 1.6],
    ),
    attack: { style: 'shoot', windup: 0.25, projectile: 'bubble', speed: 380, heal: 1.4 },
    skill: s.otter.skill,
    ult: s.otter.ult,
  },
  turtle: {
    id: 'turtle',
    element: 'water',
    role: 'tank',
    names: ['盾盾龟', '潮甲龟', '玄武'],
    blurbs: [
      '玄甲壁：原地架盾 3 秒，挑衅附近敌人，把正面飞来的弹丸弹回去，自身受伤减半。',
      '玄甲壁弹回的弹丸命中后，还会再弹向另一个敌人。',
      '大招玄武壁垒：在我方阵前立起水墙，弹回所有敌方弹丸，全体队友受伤减少 40%。',
    ],
    stats: grow(
      { hp: 600, atk: 10, interval: 1.2, range: MELEE_RANGE, speed: 55 },
      [22, 28, 26],
      [3, 4, 3.8],
    ),
    attack: { style: 'melee', windup: 0.25, knock: 220 },
    skill: s.turtle.skill,
    ult: s.turtle.ult,
  },
  bunny: {
    id: 'bunny',
    element: 'wood',
    role: 'ranged',
    names: ['叶耳兔', '青叶兔', '森语'],
    blurbs: [
      '万叶连射：同时向最多 3 个敌人各射一箭。',
      '箭命中后会弹向下一个敌人（回响 +1），普通攻击也一样。',
      '大招森罗箭雨：在敌人密集处降下箭雨，再射出三支贯穿箭。',
    ],
    stats: grow(
      { hp: 250, atk: 9, interval: 1.1, range: 300, speed: 70 },
      [18, 24, 22],
      [1, 1.3, 1.3],
    ),
    attack: { style: 'shoot', windup: 0.2, projectile: 'arrow', speed: 620 },
    skill: s.bunny.skill,
    ult: s.bunny.ult,
  },
  deer: {
    id: 'deer',
    element: 'wood',
    role: 'support',
    names: ['芽芽鹿', '花角鹿', '花神'],
    blurbs: [
      '藤缚：在敌人密集处长出藤蔓，缠住敌人并拉向中心，方便队友一起打。',
      '藤蔓范围更大，并治疗藤蔓附近的队友。',
      '大招万花缚：大范围缠绕拉拢，随后花朵绽放爆炸，并治疗全体队友。',
    ],
    stats: grow(
      { hp: 280, atk: 8, interval: 1.2, range: 240, speed: 70 },
      [20, 26, 24],
      [1.4, 1.8, 1.7],
    ),
    attack: { style: 'cast', windup: 0.3 },
    skill: s.deer.skill,
    ult: s.deer.ult,
  },
  cat: {
    id: 'cat',
    element: 'thunder',
    role: 'mage',
    names: ['电团猫', '雷纹猫', '雷音'],
    blurbs: [
      '连环雷：闪电在最多 4 个敌人之间跳跃，每跳一次回响 +1。',
      '连环雷最多跳 6 个敌人。',
      '大招九霄雷落：依次雷击每个敌人（回响逐次 +1），最后在敌阵中心落下惊雷击晕敌人。',
    ],
    stats: grow(
      { hp: 240, atk: 11, interval: 1.4, range: 270, speed: 68 },
      [18, 24, 22],
      [1, 1.3, 1.3],
    ),
    attack: { style: 'shoot', windup: 0.2, projectile: 'spark', speed: 700 },
    skill: s.cat.skill,
    ult: s.cat.ult,
  },
  wolf: {
    id: 'wolf',
    element: 'thunder',
    role: 'fighter',
    names: ['雷牙狼崽', '迅雷狼', '雷狼'],
    blurbs: [
      '奔雷突：直线冲锋穿过敌阵，撞飞沿途敌人；被撞飞的敌人撞到别人或墙会再受伤（回响 +1）。',
      '奔雷突的终点落下雷击，击晕附近敌人。',
      '大招雷狼噬：在敌阵中来回冲锋三次，每次都击退并击晕，最后引发雷爆。',
    ],
    stats: grow(
      { hp: 400, atk: 14, interval: 0.95, range: MELEE_RANGE, speed: 85 },
      [20, 26, 24],
      [1.8, 2.3, 2.2],
    ),
    attack: { style: 'melee', windup: 0.18 },
    skill: s.wolf.skill,
    ult: s.wolf.ult,
  },
  bear: {
    id: 'bear',
    element: 'rock',
    role: 'tank',
    names: ['石头熊', '岩甲熊', '岩王'],
    blurbs: [
      '裂地击：猛砸地面，把周围的敌人掀到空中。',
      '裂地击同时向前掀起一排岩刺，直线上的敌人也被掀飞。',
      '大招岩王崩山：一圈岩刺掀飞周围敌人，并给附近队友披上石肤（受伤减少 30%）。',
    ],
    stats: grow(
      { hp: 540, atk: 12, interval: 1.3, range: MELEE_RANGE, speed: 55 },
      [22, 28, 26],
      [3.2, 4.2, 4],
    ),
    attack: { style: 'melee', windup: 0.3, splash: 40, knock: 300 },
    skill: s.bear.skill,
    ult: s.bear.ult,
  },
  lizard: {
    id: 'lizard',
    element: 'rock',
    role: 'mage',
    names: ['晶晶蜥', '晶甲蜥', '晶龙'],
    blurbs: [
      '晶簇爆：把大晶簇抛进敌阵，落地碎成 6 片向外飞射，每片命中回响 +1。',
      '晶簇碎成 10 片。',
      '大招晶陨：巨型晶石砸向敌人最密集处，再向四周炸出 12 片晶片。',
    ],
    stats: grow(
      { hp: 260, atk: 13, interval: 2.0, range: 340, speed: 60 },
      [19, 25, 23],
      [1.2, 1.6, 1.5],
    ),
    attack: { style: 'lob', windup: 0.35, projectile: 'crystal', flight: 0.9, splash: 48 },
    skill: s.lizard.skill,
    ult: s.lizard.ult,
  },
};

/** 首领烛龙：巨龙形态（1）与人形态（2）。 */
export const DRAGON = {
  id: 'dragon',
  element: 'fire',
  names: ['烛龙', '烛龙君'],
  blurbs: [
    '巨龙形态：喷吐龙息、甩尾击退，不时召唤幼年宠物助战；生命降到一半时化为人形。',
    '人形态：更小更快；能量满时放出大招烛照九幽：全场火雨，再向我方最密集处砸下陨石。',
  ],
  stats: [
    { hp: 7800, atk: 30, interval: 1.6, range: 22, speed: 45, radius: 64, mass: 25 },
    { hp: 7800, atk: 33, interval: 1.1, range: MELEE_RANGE, speed: 90, radius: 34, mass: 6 },
  ],
  attack: { style: 'melee', windup: 0.35, splash: 50, knock: 380 } as AttackDef,
  /** 生命降到这一比例时化为人形。 */
  transformAt: 0.5,
  transformTime: 1.2,
  breath: {
    id: 'dragonBreath',
    name: '龙息',
    cooldown: 6,
    cast: 0.6,
    range: 340,
    width: 120,
    mult: 1.4,
    burnTime: 3,
    burnRatio: 0.25,
  },
  tail: {
    id: 'dragonTail',
    name: '甩尾',
    cooldown: 8,
    cast: 0.5,
    reach: 110,
    mult: 1.2,
    knock: 900,
  },
  summon: {
    id: 'dragonSummon',
    name: '召唤',
    cooldown: 18,
    cast: 0.8,
    count: 2,
    /** 场上同时存在的召唤物上限。 */
    maxAlive: 6,
  },
  ult: {
    id: 'dragonUlt',
    name: '烛照九幽',
    cooldown: 0,
    cast: 1.4,
    rainMult: 1.0,
    rainInterval: 0.08,
    meteorRadius: 150,
    meteorMult: 3.0,
    flight: 1.0,
  },
} as const;

export function speciesDef(id: SpeciesId): SpeciesDef {
  return SPECIES[id];
}

export function formStats(id: SpeciesId, form: Form): FormStats {
  return SPECIES[id].stats[form - 1] as FormStats;
}

export function formName(id: SpeciesId | BossId, form: number): string {
  if (id === 'dragon') return DRAGON.names[form >= 2 ? 1 : 0];
  return SPECIES[id].names[Math.min(3, Math.max(1, form)) - 1] as string;
}

/** 渲染层使用的形态标识，如 fox-3、dragon-2。 */
export function formId(id: SpeciesId | BossId, form: number): string {
  return `${id}-${form}`;
}

/** 全部形态标识（图鉴用），按物种、形态排列，首领在最后。 */
export const ALL_FORM_IDS: readonly string[] = [
  ...SPECIES_IDS.flatMap((id) => FORMS.map((form) => formId(id, form))),
  formId('dragon', 1),
  formId('dragon', 2),
];

/** 按技能 id 查技能（名字、冷却、前摇）。 */
export const SKILL_DEFS = Object.fromEntries(
  [
    ...SPECIES_IDS.flatMap((id) => [SPECIES[id].skill, SPECIES[id].ult]),
    DRAGON.breath,
    DRAGON.tail,
    DRAGON.summon,
    DRAGON.ult,
  ].map((def) => [def.id, def]),
) as Record<SkillId, SkillDef>;

/** 技能名（结算、提示用）。 */
export function skillName(id: SkillId): string {
  return SKILL_DEFS[id]?.name ?? id;
}
