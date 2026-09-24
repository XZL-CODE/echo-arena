// 招式数据：文案与数值。每个招式有 1 级和进阶（2 级）；进阶优先改变行为而不只是加数值。
import type { ModuleId, ModuleLevel, PlayerUnitKind } from '../types.js';

export type ModuleType = 'passive' | 'active' | 'gadget';

/** 思路分组：用于奖励搭配与界面配色。 */
export type ModuleFamily = 'reflect' | 'bounce' | 'impact' | 'gather' | 'guard';

export interface ModuleLevelDef {
  /** 进阶名，例如「折射」。1 级为空。 */
  title: string;
  /** 它会做什么。 */
  does: string;
}

export interface ModuleDef {
  id: ModuleId;
  name: string;
  /** 只能装在某名队员身上，或 any = 任意队员的槽位。 */
  owner: PlayerUnitKind | 'any';
  type: ModuleType;
  family: ModuleFamily;
  /** 它改变了什么：给玩家的思路提示。 */
  changes: string;
  levels: [ModuleLevelDef, ModuleLevelDef];
  /** 主动招式的冷却（秒）。 */
  cooldown?: number;
}

export const MODULE_DEFS: Record<ModuleId, ModuleDef> = {
  reflect: {
    id: 'reflect',
    name: '反射盾',
    owner: 'guard',
    type: 'passive',
    family: 'reflect',
    changes: '对手射得越凶，伤到自己越多。',
    levels: [
      { title: '', does: '阿铁举起一面反射盾：正面飞来的敌方弹丸会原路弹回射手。' },
      { title: '折射', does: '弹回的弹丸命中后，再弹向附近 2 个敌人。' },
    ],
  },
  charge: {
    id: 'charge',
    name: '冲锋',
    owner: 'guard',
    type: 'active',
    family: 'impact',
    cooldown: 9,
    changes: '由你决定前排何时切入、从哪里打开缺口。',
    levels: [
      { title: '', does: '指定地点，阿铁冲过去，把沿途敌人撞开。' },
      { title: '震地', does: '冲锋落地时再震开周围的敌人。' },
    ],
  },
  bulwark: {
    id: 'bulwark',
    name: '厚甲',
    owner: 'guard',
    type: 'passive',
    family: 'guard',
    changes: '最直接的办法：顶住压力，给队友争取输出时间。',
    levels: [
      { title: '', does: '阿铁生命 +70%，并且不会被击退。' },
      { title: '挑衅', does: '每 6 秒让附近敌人转而攻击阿铁，持续 2.5 秒。' },
    ],
  },
  ricochet: {
    id: 'ricochet',
    name: '弹射弹',
    owner: 'slinger',
    type: 'passive',
    family: 'bounce',
    changes: '敌人站得越挤，一发弹丸打到的越多。',
    levels: [
      { title: '', does: '小弹的弹丸命中后，弹向最近的另一个敌人。' },
      { title: '连弹', does: '最多连续弹射 3 次。' },
    ],
  },
  rubber: {
    id: 'rubber',
    name: '橡皮弹',
    owner: 'slinger',
    type: 'passive',
    family: 'bounce',
    changes: '可以借墙绕到盾牌背后。',
    levels: [
      { title: '', does: '弹丸撞到墙或柱子会反弹（最多 2 次），打空了也还有机会。' },
      { title: '寻的', does: '反弹后会自动转向最近的敌人。' },
    ],
  },
  heavy: {
    id: 'heavy',
    name: '重弹',
    owner: 'slinger',
    type: 'passive',
    family: 'impact',
    changes: '把靠近的敌人推开，或者推向墙和它的同伴。',
    levels: [
      { title: '', does: '弹丸伤害 +40%、射速变慢，命中会把敌人击退一段。' },
      { title: '巨弹', does: '每第 3 发变成巨弹：击退更远，还能穿透 1 个敌人。' },
    ],
  },
  pierce: {
    id: 'pierce',
    name: '贯穿射',
    owner: 'slinger',
    type: 'active',
    family: 'impact',
    cooldown: 10,
    changes: '一条直线上的敌人一次打穿，适合够到后排。',
    levels: [
      { title: '', does: '指定方向射出一发贯穿大弹，推开沿线所有敌人。' },
      { title: '回旋', does: '大弹碰到墙会反弹一次再飞回来。' },
    ],
  },
  vortex: {
    id: 'vortex',
    name: '漩涡',
    owner: 'bell',
    type: 'active',
    family: 'gather',
    cooldown: 12,
    changes: '把分散的敌人挤到一起，给弹射和爆炸创造机会。',
    levels: [
      { title: '', does: '指定地点生成漩涡，1.6 秒内把附近敌人吸向中心，被吸住的敌人无法攻击。' },
      { title: '爆散', does: '漩涡结束时炸开，伤害并弹飞中心的敌人。' },
    ],
  },
  magnet: {
    id: 'magnet',
    name: '磁铃',
    owner: 'bell',
    type: 'passive',
    family: 'gather',
    changes: '把敌人聚到阿铁面前：远处的被拖近，躲着的被拉出来。',
    levels: [
      { title: '', does: '叮当每次摇铃，都把阿铁周围的敌人拉到阿铁身边。' },
      { title: '共鸣', does: '被拉动的敌人 3 秒内受到的回响伤害 +40%。' },
    ],
  },
  mend: {
    id: 'mend',
    name: '治愈铃',
    owner: 'bell',
    type: 'passive',
    family: 'guard',
    changes: '让持续输出的打法站得住。',
    levels: [
      { title: '', does: '摇铃的治疗量翻倍，范围更大。' },
      { title: '护铃', does: '被治疗的队友获得 3 秒护盾，吸收 20 点伤害。' },
    ],
  },
  impact: {
    id: 'impact',
    name: '撞击',
    owner: 'any',
    type: 'passive',
    family: 'impact',
    changes: '每一次击退都可能变成一串台球式的连撞。',
    levels: [
      {
        title: '',
        does: '被我方击退的敌人撞到墙、柱子或其他敌人时，双方都受伤，被撞的敌人也会被撞开。',
      },
      { title: '重撞', does: '撞击伤害 +60%，被撞到的敌人眩晕 1 秒。' },
    ],
  },
  burst: {
    id: 'burst',
    name: '连爆',
    owner: 'any',
    type: 'passive',
    family: 'gather',
    changes: '连锁能自己延续：一个倒下，引爆下一个。',
    levels: [
      { title: '', does: '被回响伤害击倒的敌人会爆炸，伤害并推开周围的敌人。' },
      { title: '殉爆', does: '任何方式击倒的敌人都会爆炸，范围更大。' },
    ],
  },
  mirrorpost: {
    id: 'mirrorpost',
    name: '镜桩',
    owner: 'any',
    type: 'gadget',
    family: 'reflect',
    changes: '由你决定对手的火力被引到哪里。',
    levels: [
      { title: '', does: '战前在场上放一根镜桩：敌方弹丸碰到它，会转向飞向最近的敌人。' },
      { title: '双镜', does: '可以放 2 根镜桩。' },
    ],
  },
  spring: {
    id: 'spring',
    name: '弹簧桩',
    owner: 'any',
    type: 'gadget',
    family: 'impact',
    changes: '给击退和冲锋找一个“台球库边”。',
    levels: [
      { title: '', does: '战前在场上放一个弹簧桩：撞上它的敌人会被猛力弹开并受伤。' },
      { title: '双簧', does: '可以放 2 个弹簧桩。' },
    ],
  },
};

export const ALL_MODULES = Object.keys(MODULE_DEFS) as ModuleId[];

/** 第一场的开局三选一（对应 Brief 示例：提高承受、快速切入、盾牌反射）。 */
export const STARTING_CHOICES: readonly ModuleId[] = ['reflect', 'charge', 'bulwark'];
export const DEFAULT_STARTING_CHOICE: ModuleId = 'reflect';

export const SLOTS_PER_UNIT = 2;

export function moduleDef(id: ModuleId): ModuleDef {
  return MODULE_DEFS[id];
}

export function moduleTypeLabel(def: ModuleDef): string {
  if (def.type === 'active') return `主动 · 冷却 ${def.cooldown} 秒`;
  if (def.type === 'gadget') return '机关 · 战前放置';
  return '被动';
}

export function moduleOwnerLabel(def: ModuleDef): string {
  if (def.owner === 'any') return '任意队员';
  return { guard: '阿铁', slinger: '小弹', bell: '叮当' }[def.owner];
}

export function moduleFullName(id: ModuleId, level: ModuleLevel): string {
  const def = MODULE_DEFS[id];
  const title = def.levels[1].title;
  return level === 2 && title ? `${def.name}·${title}` : def.name;
}

/** 机关数量：1 级一个，进阶两个。 */
export function gadgetCount(level: ModuleLevel): number {
  return level === 2 ? 2 : 1;
}
