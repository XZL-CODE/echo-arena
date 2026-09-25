// 战斗中的实体。全部是普通对象，由 World 统一推进。
import type { UnitDef } from '../content/units.js';
import type { Rng } from '../rng.js';
import type { DamageSource, ModuleId, Team, UnitKind } from '../types.js';

export type UnitState =
  'idle' | 'move' | 'windup' | 'recover' | 'dash' | 'fuse' | 'charge' | 'stunned';

/** 被击飞时携带的回响信息：它撞到别人时，回响从这里继续。 */
export interface SlideInfo {
  team: Team;
  echo: number;
  chain: number;
  source: DamageSource;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  def: UnitDef;
  team: Team;
  x: number;
  y: number;
  /** 上一步位置，用于渲染插值。 */
  px: number;
  py: number;
  /** 物理速度（击退、吸引）。 */
  vx: number;
  vy: number;
  /** 本步的行走速度，由行为逻辑设定。 */
  mvx: number;
  mvy: number;
  facing: number;
  hp: number;
  maxHp: number;
  radius: number;
  mass: number;
  speed: number;
  alive: boolean;
  diedAt: number;
  state: UnitState;
  /** 当前计时状态剩余时间。 */
  stateTime: number;
  cooldown: number;
  targetId: number;
  aimX: number;
  aimY: number;
  stun: number;
  slide: SlideInfo | null;
  impactCooldown: number;
  tauntBy: number;
  tauntTime: number;
  /** 磁铃·共鸣：剩余时间内受到的回响伤害提高。 */
  resonance: number;
  shieldHp: number;
  shieldTime: number;
  /** 被漩涡吸住（本步）。 */
  held: boolean;
  rng: Rng;
  /** 发射计数（重弹·巨弹）。 */
  shots: number;
  timerA: number;
  timerB: number;
  timerC: number;
  phase: number;
  /** 蓄力结束后要执行的动作（首领等多动作单位使用）。 */
  pending: string;
  spawnedBy: number;
  /** 主动招式与冷却（仅玩家队员）。 */
  active: ModuleId | null;
  activeCd: number;
  /** 冲锋 / 冲撞的方向与剩余距离、已撞过的单位。 */
  dashX: number;
  dashY: number;
  dashLeft: number;
  dashHits: number[];
  dashChain: number;
  /** 动画时间戳（战斗时间，秒）。 */
  hitAt: number;
  attackAt: number;
  blockAt: number;
  healAt: number;
  castAt: number;
}

export type ProjectileKind = 'pellet' | 'bigpellet' | 'arrow' | 'cog' | 'bigshot';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  team: Team;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  knock: number;
  echo: number;
  chain: number;
  /** 最初（或最近一次反射）的发射者，用于反射回射手。 */
  ownerId: number;
  source: DamageSource;
  hitIds: number[];
  ricochet: number;
  ricochetRange: number;
  wallBounce: number;
  /** 反弹后是否自动寻找最近的敌人（橡皮弹·寻的）。 */
  homing: boolean;
  /** 正在追踪的目标：反射、弹射、镜桩转向后，保证弹丸飞到它指向的单位。 */
  seekId: number;
  seekTurn: number;
  pierce: number;
  reflects: number;
  life: number;
  alive: boolean;
}

export type ObstacleKind = 'pillar' | 'mirrorpost' | 'spring';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  r: number;
  /** 最近一次被触发的时间，用于动画。 */
  hitAt: number;
}

export interface Vortex {
  id: number;
  x: number;
  y: number;
  r: number;
  time: number;
  duration: number;
  level: number;
  chain: number;
}

/** 炮台蛙的抛射炸弹：飞行中不可阻挡，落点提前显示。 */
export interface Lob {
  id: number;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  r: number;
  time: number;
  duration: number;
  damage: number;
  knock: number;
}

/** 延迟触发的爆炸，让连爆一个接一个地发生，而不是同一帧全部结算。 */
export interface PendingBlast {
  x: number;
  y: number;
  radius: number;
  damage: number;
  knock: number;
  delay: number;
  team: Team;
  echo: number;
  chain: number;
  source: DamageSource;
  /** 爆炸是否伤害双方（爆爆虫）。 */
  hitsAll: boolean;
  ignoreId: number;
}
