// 单位数据：数值与文案。行为逻辑在 sim/ai.ts 中按种类实现。
import type { EnemyUnitKind, PlayerUnitKind, Team, UnitKind } from '../types.js';

export interface UnitDef {
  kind: UnitKind;
  team: Team;
  name: string;
  title: string;
  /** 一句话说明它会做什么。 */
  role: string;
  /** 对手特点，准备阶段展示；只写能在战斗中观察到的事实。 */
  traits: string[];
  hp: number;
  radius: number;
  /** 质量影响被击退的距离和碰撞时的动量交换。 */
  mass: number;
  speed: number;
  /** 转身角速度（弧度/秒），决定正面盾牌多久能转过来。 */
  turnRate: number;
  /** 正面盾牌：半角（弧度）与是否反射。 */
  shield?: { arc: number; reflect: boolean };
  /** 近战为边缘间距，远程为中心距离。 */
  range: number;
  damage: number;
  cooldown: number;
  windup: number;
  /** 基础攻击的击退力度。 */
  knock: number;
  projectileSpeed?: number;
  projectileRadius?: number;
  /** 不会被击退、推动。 */
  immovable?: boolean;
  boss?: boolean;
}

const DEG = Math.PI / 180;

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  guard: {
    kind: 'guard',
    team: 0,
    name: '阿铁',
    title: '铁皮卫士',
    role: '前排：生命厚实，向前推进，用铁拳把对手打退。',
    traits: [],
    hp: 340,
    radius: 24,
    mass: 4,
    speed: 62,
    turnRate: 7,
    range: 10,
    damage: 15,
    cooldown: 1.0,
    windup: 0.22,
    knock: 460,
  },
  slinger: {
    kind: 'slinger',
    team: 0,
    name: '小弹',
    title: '弹弓雀',
    role: '输出：在后方用弹弓射击最近的对手，被贴身时会后撤。',
    traits: [],
    hp: 130,
    radius: 17,
    mass: 1,
    speed: 92,
    turnRate: 12,
    range: 340,
    damage: 12,
    cooldown: 0.72,
    windup: 0.12,
    knock: 0,
    projectileSpeed: 560,
    projectileRadius: 5,
  },
  bell: {
    kind: 'bell',
    team: 0,
    name: '叮当',
    title: '铃铛精',
    role: '辅助：跟在阿铁身后，每隔几秒摇铃为身边队友治疗。',
    traits: [],
    hp: 160,
    radius: 19,
    mass: 1.5,
    speed: 84,
    turnRate: 10,
    range: 170,
    damage: 16,
    cooldown: 4,
    windup: 0.3,
    knock: 0,
  },
  archer: {
    kind: 'archer',
    team: 1,
    name: '木箭手',
    title: '齐射队员',
    role: '所有木箭手一起拉弓，每 3 秒齐射一轮。',
    traits: ['远程齐射，拉弓时有瞄准线', '身板薄，站定不动'],
    hp: 55,
    radius: 16,
    mass: 1,
    speed: 70,
    turnRate: 8,
    range: 420,
    damage: 11,
    cooldown: 3,
    windup: 0.65,
    knock: 0,
    projectileSpeed: 430,
    projectileRadius: 4,
  },
  shell: {
    kind: 'shell',
    team: 1,
    name: '壳壳',
    title: '盾阵前排',
    role: '顶着大壳慢慢推进，正面能挡住弹丸。',
    traits: ['正面大壳挡住弹丸', '转身很慢，背后没有壳'],
    hp: 120,
    radius: 22,
    mass: 3,
    speed: 52,
    turnRate: 2,
    shield: { arc: 55 * DEG, reflect: false },
    range: 10,
    damage: 9,
    cooldown: 1.4,
    windup: 0.3,
    knock: 200,
  },
  mouse: {
    kind: 'mouse',
    team: 1,
    name: '发条鼠',
    title: '突袭手',
    role: '跑得飞快，绕开前排专咬后排。',
    traits: ['速度很快，专咬后排', '很脆，一碰就飞'],
    hp: 36,
    radius: 13,
    mass: 0.7,
    speed: 165,
    turnRate: 14,
    range: 6,
    damage: 6,
    cooldown: 0.55,
    windup: 0.1,
    knock: 0,
  },
  bomber: {
    kind: 'bomber',
    team: 1,
    name: '爆爆虫',
    title: '自爆虫',
    role: '冲到身边点燃引信自爆；被打倒时也会原地爆炸，敌我不分。',
    traits: ['贴身自爆', '被打倒也会爆炸，炸到自己人'],
    hp: 26,
    radius: 14,
    mass: 0.8,
    speed: 108,
    turnRate: 10,
    range: 24,
    damage: 26,
    cooldown: 0,
    windup: 0.7,
    knock: 520,
  },
  snail: {
    kind: 'snail',
    team: 1,
    name: '蜗医',
    title: '后援治疗',
    role: '躲在同伴身后，每隔一会儿治疗受伤最重的同伴。',
    traits: ['远距离治疗同伴', '移动很慢'],
    hp: 90,
    radius: 18,
    mass: 2,
    speed: 44,
    turnRate: 5,
    range: 240,
    damage: 18,
    cooldown: 3,
    windup: 0.4,
    knock: 0,
  },
  brute: {
    kind: 'brute',
    team: 1,
    name: '木桩熊',
    title: '重拳手',
    role: '蓄力一拳能把人打飞。',
    traits: ['重拳会把人打飞', '出拳前要蓄力'],
    hp: 220,
    radius: 26,
    mass: 4,
    speed: 58,
    turnRate: 5,
    range: 12,
    damage: 20,
    cooldown: 1.7,
    windup: 0.5,
    knock: 620,
  },
  mirror: {
    kind: 'mirror',
    team: 1,
    name: '镜甲骑士',
    title: '反射前排',
    role: '正面的镜盾会把弹丸原样反射回去。',
    traits: ['镜盾把弹丸反射回来', '侧面和背后没有镜子'],
    hp: 100,
    radius: 21,
    mass: 2.5,
    speed: 58,
    turnRate: 3,
    shield: { arc: 60 * DEG, reflect: true },
    range: 10,
    damage: 9,
    cooldown: 1.2,
    windup: 0.3,
    knock: 160,
  },
  mortar: {
    kind: 'mortar',
    team: 1,
    name: '炮台蛙',
    title: '抛射炮手',
    role: '越过障碍抛射炸弹，落点会先出现提示圈。',
    traits: ['抛射炸弹，落点有提示圈', '近身后很脆弱'],
    hp: 80,
    radius: 19,
    mass: 2,
    speed: 40,
    turnRate: 6,
    range: 760,
    damage: 16,
    cooldown: 3.4,
    windup: 0.5,
    knock: 380,
  },
  jack: {
    kind: 'jack',
    team: 1,
    name: '惊喜盒',
    title: '发条鼠工厂',
    role: '原地不动，每隔几秒弹出一只发条鼠。',
    traits: ['不断弹出发条鼠', '自己不会动'],
    hp: 180,
    radius: 26,
    mass: 99,
    speed: 0,
    turnRate: 0,
    range: 0,
    damage: 0,
    cooldown: 6,
    windup: 0.6,
    knock: 0,
    immovable: true,
  },
  king: {
    kind: 'king',
    team: 1,
    name: '发条大王',
    title: '联赛冠军',
    role: '三个阶段：齿轮弹幕、召唤援军、横冲直撞。',
    traits: ['齿轮弹幕可以被挡下', '血量降低后召唤援军', '最后会冲撞，撞墙后晕眩'],
    hp: 1300,
    radius: 44,
    mass: 12,
    speed: 44,
    turnRate: 2.5,
    range: 14,
    damage: 20,
    cooldown: 1.6,
    windup: 0.4,
    knock: 700,
    projectileSpeed: 330,
    projectileRadius: 7,
    boss: true,
  },
};

export function unitDef(kind: UnitKind): UnitDef {
  return UNIT_DEFS[kind];
}

export function isPlayerKind(kind: UnitKind): kind is PlayerUnitKind {
  return kind === 'guard' || kind === 'slinger' || kind === 'bell';
}

export function isEnemyKind(kind: UnitKind): kind is EnemyUnitKind {
  return !isPlayerKind(kind);
}
