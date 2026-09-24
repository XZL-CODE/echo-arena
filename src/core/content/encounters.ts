// 对手阵容。每一场提出一个不同的问题；同一层的场次在每轮中随机抽取。
import type { EnemyUnitKind, ModuleId, Point } from '../types.js';

export interface EncounterUnit {
  kind: EnemyUnitKind;
  x: number;
  y: number;
}

export interface Obstacle {
  x: number;
  y: number;
  r: number;
}

export interface Wave {
  /** 开战后第几秒出现。 */
  at: number;
  units: EncounterUnit[];
}

export interface EncounterDef {
  id: string;
  /** 0 = 开场，1–3 = 中段，4 = 决赛。 */
  tier: 0 | 1 | 2 | 3 | 4;
  name: string;
  /** 一两句话：对面是什么、难在哪里。 */
  intro: string;
  enemies: EncounterUnit[];
  waves?: Wave[];
  obstacles?: Obstacle[];
  /** 对这一场有帮助的招式。只用于让奖励里至少出现一个可用思路，不向玩家展示。 */
  relevant: ModuleId[];
}

const column = (kind: EnemyUnitKind, x: number, ys: number[]): EncounterUnit[] =>
  ys.map((y) => ({ kind, x, y }));

export const ENCOUNTERS: EncounterDef[] = [
  {
    id: 'volley',
    tier: 0,
    name: '木箭齐射队',
    intro: '五名木箭手排成一线，每 3 秒齐射一轮。正面硬冲会挨不少箭。',
    enemies: column('archer', 1000, [150, 240, 330, 420, 510]),
    relevant: ['reflect', 'charge', 'bulwark'],
  },
  {
    id: 'shellwall',
    tier: 1,
    name: '壳壳盾阵',
    intro: '三只壳壳顶着大壳在前，两名木箭手躲在后面放箭。正面打壳，弹丸全被挡下。',
    enemies: [...column('shell', 820, [230, 330, 430]), ...column('archer', 1030, [270, 390])],
    relevant: ['rubber', 'heavy', 'impact', 'charge', 'pierce', 'spring'],
  },
  {
    id: 'raid',
    tier: 1,
    name: '发条鼠突袭队',
    intro: '发条鼠一开场就绕过前排，直扑后排的小弹和叮当；两名木箭手在远处掩护。',
    enemies: [
      ...column('mouse', 1080, [150, 250, 330, 410, 510]),
      ...column('archer', 1010, [230, 430]),
    ],
    relevant: ['bulwark', 'heavy', 'mend', 'impact', 'magnet', 'ricochet'],
  },
  {
    id: 'swarm',
    tier: 2,
    name: '爆爆虫潮',
    intro: '三波爆爆虫轮番冲来。它们倒下时也会爆炸——挤在一起时，炸得最响。',
    enemies: [
      ...column('bomber', 900, [210, 290, 370, 450]),
      ...column('archer', 1090, [250, 410]),
    ],
    waves: [
      { at: 7, units: column('bomber', 1150, [180, 260, 400, 480]) },
      { at: 14, units: column('bomber', 1150, [220, 300, 360, 440]) },
    ],
    relevant: ['ricochet', 'burst', 'heavy', 'vortex', 'impact', 'bulwark'],
  },
  {
    id: 'medics',
    tier: 2,
    name: '蜗医后援团',
    intro: '两只木桩熊冲在前面，蜗医在后面不停治疗。拖得越久越难打。',
    enemies: [...column('brute', 840, [250, 410]), ...column('snail', 1070, [220, 440])],
    relevant: ['charge', 'pierce', 'ricochet', 'magnet', 'vortex', 'rubber'],
  },
  {
    id: 'mirrors',
    tier: 2,
    name: '镜甲骑士团',
    intro: '镜甲骑士的正面镜盾会把弹丸原样反射回来，后面还有木箭手。',
    enemies: [...column('mirror', 830, [220, 330, 440]), ...column('archer', 1040, [280, 380])],
    relevant: ['reflect', 'rubber', 'charge', 'impact', 'heavy', 'magnet'],
  },
  {
    id: 'mortars',
    tier: 3,
    name: '炮台蛙阵地',
    intro: '炮台蛙躲在后方抛射炸弹，两根柱子挡住了直线射击，壳壳守在柱子后。',
    enemies: [...column('shell', 870, [270, 390]), ...column('mortar', 1070, [190, 330, 470])],
    obstacles: [
      { x: 640, y: 215, r: 34 },
      { x: 640, y: 445, r: 34 },
    ],
    relevant: ['rubber', 'charge', 'magnet', 'pierce', 'mend', 'spring'],
  },
  {
    id: 'factory',
    tier: 3,
    name: '惊喜盒工厂',
    intro: '两个惊喜盒不停弹出发条鼠，壳壳守在它们前面。',
    enemies: [...column('jack', 1090, [200, 460]), ...column('shell', 890, [250, 410])],
    relevant: ['pierce', 'burst', 'ricochet', 'charge', 'impact', 'rubber'],
  },
  {
    id: 'elite',
    tier: 3,
    name: '混编精英队',
    intro: '前排、远程、治疗、突袭一应俱全，考验整套配置是否周全。',
    enemies: [
      ...column('shell', 850, [280, 400]),
      ...column('archer', 1010, [190, 470]),
      { kind: 'snail', x: 1100, y: 330 },
      { kind: 'mouse', x: 1070, y: 530 },
      { kind: 'brute', x: 900, y: 150 },
    ],
    relevant: ['ricochet', 'impact', 'burst', 'mend', 'vortex', 'reflect'],
  },
  {
    id: 'king',
    tier: 4,
    name: '发条大王',
    intro: '联赛冠军。它会轮换三种打法：齿轮弹幕、召唤援军、横冲直撞——冲撞撞到墙或柱子会晕一会儿。',
    enemies: [{ kind: 'king', x: 1010, y: 330 }, ...column('shell', 860, [230, 430])],
    obstacles: [
      { x: 600, y: 180, r: 30 },
      { x: 600, y: 480, r: 30 },
    ],
    relevant: ['reflect', 'ricochet', 'spring', 'impact', 'burst', 'charge'],
  },
];

export function encounterById(id: string): EncounterDef {
  const found = ENCOUNTERS.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown encounter: ${id}`);
  return found;
}

/** 一轮 7 场：每个位置对应的层级。 */
export const RUN_TIERS: ReadonlyArray<EncounterDef['tier']> = [0, 1, 2, 2, 3, 3, 4];

export const DEFAULT_FORMATION: Record<'guard' | 'slinger' | 'bell', Point> = {
  guard: { x: 330, y: 330 },
  slinger: { x: 170, y: 270 },
  bell: { x: 220, y: 400 },
};
