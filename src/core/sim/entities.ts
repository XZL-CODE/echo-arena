// 战斗中的实体。全部是普通对象，由 World 统一推进；画面按这里的字段名读取。
import type { Rng } from '../rng.js';
import type {
  BossId,
  DamageSource,
  Element,
  Form,
  Point,
  Role,
  SkillId,
  SpeciesId,
  Team,
} from '../types.js';

/** 单位此刻在做什么（动画用）。 */
export type UnitAct =
  'idle' | 'move' | 'attack' | 'skill' | 'ult' | 'stunned' | 'dash' | 'guard' | 'dead';

/** 被击飞时携带的信息：撞到别人或墙时，回响从这里继续，伤害记到击飞者名下。 */
export interface SlideInfo {
  /** 击飞者一方。 */
  team: Team;
  ownerId: number;
  echo: number;
  chain: number;
  source: DamageSource;
  /** 击飞者的攻击力，决定撞击伤害。 */
  power: number;
  element: Element;
}

export type ActionKind = SkillId | 'basic' | 'heal' | 'transform';

/**
 * 正在进行的动作：前摇（phase 0）→ 生效后收招（phase 1），
 * 或进入冲刺、瞬身之类的多段过程（phase 2）。
 */
export interface Action {
  kind: ActionKind;
  act: UnitAct;
  /** 动作开始后经过的时间。 */
  t: number;
  /** 前摇结束、效果生效的时刻。 */
  fireAt: number;
  /** 动作总时长（多段过程结束时另行收尾）。 */
  dur: number;
  phase: 0 | 1 | 2;
  /** 大招与首领变身不会被眩晕、击退打断。 */
  unstoppable: boolean;
  targetId: number;
  tx: number;
  ty: number;
  /** 多段过程：已经命中的单位、待处理的目标、路径、计时。 */
  hits: number[];
  queue: number[];
  path: Point[];
  step: number;
  timer: number;
  chain: number;
  echo: number;
  fromX: number;
  fromY: number;
}

export interface Unit {
  id: number;
  /** 玩家宠物的 uid；对手与召唤物为 0。 */
  uid: number;
  team: Team;
  species: SpeciesId | BossId;
  /** 形态：宠物 1–3；首领 1 巨龙、2 人形。 */
  form: Form;
  element: Element;
  role: Role | 'boss';
  /** 当前形态的名字。 */
  name: string;
  x: number;
  y: number;
  /** 上一步位置，用于渲染插值。 */
  px: number;
  py: number;
  /** 物理速度（击退、滑行）。 */
  vx: number;
  vy: number;
  /** 本步的行走速度，由行为逻辑设定。 */
  mvx: number;
  mvy: number;
  /** 朝向（弧度，atan2(dy, dx)）。 */
  facing: number;
  radius: number;
  mass: number;
  hp: number;
  maxHp: number;
  /** 泡泡护盾剩余量；护盾存在时会弹回敌方弹丸。 */
  shield: number;
  shieldTime: number;
  /** 0–100；没有大招的单位为 -1。 */
  energy: number;
  alive: boolean;
  diedAt: number;
  act: UnitAct;
  /** 当前动画开始的战斗时间。 */
  actAt: number;
  /** 计时动作的预计时长（前摇 + 收招、冲刺、架盾、眩晕）。 */
  actDur: number;
  targetId: number;
  /** 以下状态均为剩余秒数。stun 包含击飞到空中（airborne 供画面把模型抬起）。 */
  stun: number;
  airborne: number;
  root: number;
  burn: number;
  burnDps: number;
  burnBy: number;
  burnSource: DamageSource;
  burnTick: number;
  taunt: number;
  tauntBy: number;
  guard: number;
  stoneSkin: number;
  hitAt: number;
  spawnAt: number;
  /** 战斗数值（对手已计入难度与场次加成）。 */
  atk: number;
  interval: number;
  range: number;
  speed: number;
  attackCd: number;
  skillCd: number;
  skillCdMax: number;
  /** 首领的几招各自的冷却。 */
  breathCd: number;
  tailCd: number;
  summonCd: number;
  action: Action | null;
  slide: SlideInfo | null;
  impactCooldown: number;
  summonedBy: number;
  energyAnnounced: boolean;
  /** 下一次重新挑选目标的时间（目标不会每一帧来回跳）。 */
  retargetAt: number;
  /** 远程单位连续后撤的时间，超过上限就站定射击。 */
  kiteTime: number;
  /** 近战包围目标时的站位偏角（0–1，出场时随机定下），偏向 flank 一侧。 */
  spread: number;
  /** 近战在当前目标身边的站位方向（弧度），换目标时重新定。 */
  slot: number;
  /** 当前的步法（画面据此挑步态）；配合 mvx/mvy 使用。 */
  footwork: Footwork;
  /** 正在走的步法动作（后撤、侧移、交叉换位、横移）。 */
  foot: FootMove | null;
  /** 偏好的包抄一侧：1 或 -1，出场时定下，军团因此散开而不是排成一队。 */
  flank: 1 | -1;
  /** 接近时左右迂回的相位与频率。 */
  weavePhase: number;
  weaveFreq: number;
  /** 敏捷近战下一次可以交叉换位的时间。 */
  crossAt: number;
  /** 远程横移的方向与下一次换向的时间。 */
  strafeDir: 1 | -1;
  strafeSwitchAt: number;
  /** 远程保持的距离占最大射程的比例（0.7–0.9）。 */
  holdFactor: number;
  rng: Rng;
}

/**
 * 步法：approach 接近（远距离时走弧线、左右迂回），step 后撤，circle 绕着目标侧移，
 * cross 从目标身边绕到另一侧（交叉换位），strafe 远程在两次射击之间横移，none 站定。
 */
export type Footwork = 'approach' | 'step' | 'circle' | 'cross' | 'strafe' | 'none';

export interface FootMove {
  kind: 'step' | 'circle' | 'cross' | 'strafe';
  t: number;
  dur: number;
  targetId: number;
  /** 绕目标移动：起始方向角、要扫过的角度（带正负）、半径。 */
  angle: number;
  sweep: number;
  radius: number;
  /** 直线移动的终点（后撤、横移）。 */
  tx: number;
  ty: number;
  speedMul: number;
}

export type ProjectileKind =
  | 'fireball'
  | 'bigfireball'
  | 'bubble'
  | 'arrow'
  | 'spark'
  | 'crystal'
  | 'bigcrystal'
  | 'shard'
  | 'meteor'
  | 'phoenix'
  | 'breath';

/** 被击倒时连环爆炸（凤凰陨）：半径与伤害，爆炸本身也会继续触发。 */
export interface BurstSpec {
  radius: number;
  damage: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  team: Team;
  x: number;
  y: number;
  px: number;
  py: number;
  /** 抛射物的高度（渲染用）；平飞的弹丸为 0。 */
  z: number;
  vx: number;
  vy: number;
  element: Element;
  echo: number;
  alive: boolean;
  radius: number;
  damage: number;
  /** 发射者（被反射后是反射者）。 */
  ownerId: number;
  /** 最初的发射者：被反射时飞回它。 */
  shooterId: number;
  source: DamageSource;
  chain: number;
  hitIds: number[];
  /** 命中后还能弹射的次数（每次回响 +1）。 */
  ricochet: number;
  ricochetRange: number;
  /** 还能穿透的次数（凤凰、龙息、贯穿箭）。 */
  pierce: number;
  reflects: number;
  /** 剩余飞行时间（秒）。 */
  life: number;
  /** 飞到尽头时是否爆炸（大火球飞到落点也会炸开）。 */
  blastAtEnd: boolean;
  seekId: number;
  seekTurn: number;
  /** 命中或落地后的爆炸半径（0 = 单体）。 */
  splash: number;
  knock: number;
  burnDps: number;
  burnTime: number;
  /** 爆炸后留下燃烧地面：每秒伤害与持续时间（0 = 不留）。 */
  groundDps: number;
  groundTime: number;
  /** 落地后向外飞出的晶片。 */
  shards: number;
  shardDamage: number;
  shardSpeed: number;
  shardRange: number;
  /** 命中时的眩晕（秒）。 */
  stun: number;
  /** 抛射：起点、落点、飞行时间、已飞行时间、最高点。落点在出手时就确定。 */
  lob: boolean;
  fromX: number;
  fromY: number;
  tx: number;
  ty: number;
  flight: number;
  t: number;
  peak: number;
  /** 能否被泡泡、玄甲、水墙弹回（抛射物与大招弹丸不能）。 */
  reflectable: boolean;
  burst: BurstSpec | null;
  /** 沿路留下的燃烧带（凤凰陨）。 */
  trailZoneId: number;
}

export type ZoneKind =
  'burn' | 'vines' | 'arrowRain' | 'waterWall' | 'spikes' | 'spikeRing' | 'blossom';

/**
 * 场地上的区域。圆形区域以 (x, y) 为中心、r 为半径；
 * 线形区域（燃烧带、岩刺、水墙）从 (x, y) 出发沿 angle 延伸 length，r 为半宽。
 */
export interface Zone {
  id: number;
  kind: ZoneKind;
  team: Team;
  x: number;
  y: number;
  r: number;
  angle?: number;
  length?: number;
  /** 已存在的时间。 */
  t: number;
  duration: number;
  ownerId: number;
  source: DamageSource;
  element: Element;
  chain: number;
  /** 燃烧：每秒伤害；箭雨：每一波的伤害；万花缚：绽放伤害。 */
  damage: number;
  /** 距下一次结算的时间。 */
  tick: number;
  /** 箭雨剩余波数。 */
  waves: number;
  /** 藤蔓：定身时长与拉拢速度。 */
  root: number;
  pull: number;
  /** 结束时治疗全体队友的比例（万花缚）。 */
  heal: number;
  /** 水墙：我方受到的伤害减少比例。 */
  reduction: number;
}
