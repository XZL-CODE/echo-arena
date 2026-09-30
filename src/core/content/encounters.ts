// 对手训练家：每场一支主题军团。一轮 7 场按档位抽取，军团规模 5、6、7、8、9、10，最后是首领烛龙。
import type { Element, Form, Point, SpeciesId } from '../types.js';

export interface EncounterPet {
  species: SpeciesId;
  form: Form;
  x: number;
  y: number;
}

export type EncounterTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface EncounterDef {
  id: string;
  /** 档位：1–6 普通对手（军团 5–10 只），7 为首领战。 */
  tier: EncounterTier;
  /** 训练家名字。 */
  trainer: string;
  /** 队名。 */
  name: string;
  /** 一句话：对面是什么、难在哪里。 */
  intro: string;
  /** 主题属性（mixed 为混编）。 */
  theme: Element | 'mixed';
  legion: EncounterPet[];
  /** 首领战：烛龙的出场位置。 */
  boss?: Point;
}

/** 一只宠物：物种加形态，如 'fox2'。 */
type Slot = `${SpeciesId}${Form}`;

/** 列的横坐标：前排、中排、后排、最后排。 */
const FRONT = 1220;
const MID = 1340;
const BACK = 1470;
const REAR = 1600;
/** 场地竖直方向的中线。 */
const CENTER_Y = 550;

/** 按列摆放：每列一个横坐标，列内的宠物上下均匀排开。 */
function lineup(...cols: Array<[number, Slot[]]>): EncounterPet[] {
  return cols.flatMap(([x, slots]) => {
    const n = slots.length;
    const gap = n > 1 ? Math.min(140, 700 / (n - 1)) : 0;
    return slots.map((slot, i) => ({
      species: slot.slice(0, -1) as SpeciesId,
      form: Number(slot.slice(-1)) as Form,
      x,
      y: Math.round(CENTER_Y + (i - (n - 1) / 2) * gap),
    }));
  });
}

export const ENCOUNTERS: EncounterDef[] = [
  // ---- 第 1 档：5 只，全是幼年 ----
  {
    id: 'sprouts',
    tier: 1,
    trainer: '小禾',
    name: '森林新芽队',
    intro: '刚出村的新手训练家。石头熊守在前面，后排的叶耳兔和芽芽鹿负责远程。',
    theme: 'wood',
    legion: lineup([FRONT, ['bear1']], [MID, ['wolf1']], [BACK, ['bunny1', 'deer1', 'bunny1']]),
  },
  {
    id: 'embers',
    tier: 1,
    trainer: '阿焰',
    name: '火苗队',
    intro: '爱玩火的小男孩。小焰狐会直扑你生命最低的宠物，火团雀的大火球专挑扎堆的地方。',
    theme: 'fire',
    legion: lineup([FRONT, ['turtle1']], [MID, ['fox1']], [BACK, ['bird1', 'deer1', 'bunny1']]),
  },

  // ---- 第 2 档：6 只，1 只进化 ----
  {
    id: 'blaze',
    tier: 2,
    trainer: '炎哥',
    name: '火焰营',
    intro: '火焰营的新兵队。潮甲龟在前面架盾，小焰狐专挑生命最低的宠物，火团雀往扎堆的地方扔火球。',
    theme: 'fire',
    legion: lineup(
      [FRONT, ['bear1', 'turtle2']],
      [MID, ['fox1']],
      [BACK, ['bird1', 'deer1', 'bunny1']],
    ),
  },
  {
    id: 'tide',
    tier: 2,
    trainer: '小澜',
    name: '潮汐团',
    intro: '潮甲龟架起盾来会把正面的弹丸弹回去，泡泡獭还会给队友套泡泡。近战和抛射更好打。',
    theme: 'water',
    legion: lineup(
      [FRONT, ['turtle2', 'turtle1']],
      [MID, ['wolf1']],
      [BACK, ['bunny1', 'otter1', 'deer1']],
    ),
  },
  {
    id: 'storm',
    tier: 2,
    trainer: '雷鸣',
    name: '雷霆队',
    intro: '迅雷狼会直线冲进你的阵型，把宠物撞得东倒西歪；电团猫的闪电专找挤在一起的。',
    theme: 'thunder',
    legion: lineup(
      [FRONT, ['bear1']],
      [MID, ['wolf2', 'wolf1']],
      [BACK, ['cat1', 'deer1', 'cat1']],
    ),
  },

  // ---- 第 3 档：7 只，2 只进化 ----
  {
    id: 'grove',
    tier: 3,
    trainer: '青禾',
    name: '森之守',
    intro: '花角鹿用藤蔓把你的宠物拉成一团，青叶兔的箭再一支支弹过去。火系克木。',
    theme: 'wood',
    legion: lineup(
      [FRONT, ['bear1', 'turtle1']],
      [MID, ['fox1']],
      [BACK, ['bunny2', 'deer2', 'bunny1', 'deer1']],
    ),
  },
  {
    id: 'rocks',
    tier: 3,
    trainer: '石头哥',
    name: '岩石帮',
    intro: '两只熊顶在前面砸地掀人，晶甲蜥在后面抛晶簇，碎片满天飞。木系克岩。',
    theme: 'rock',
    legion: lineup(
      [FRONT, ['bear2', 'turtle1', 'bear1']],
      [MID, ['wolf1']],
      [BACK, ['lizard2', 'otter1', 'lizard1']],
    ),
  },
  {
    id: 'drifters',
    tier: 3,
    trainer: '阿杂',
    name: '流浪混编队',
    intro: '什么都有一点：前排、刺客、法师、治疗。没有明显的克制，拼的是整支军团。',
    theme: 'mixed',
    legion: lineup(
      [FRONT, ['turtle2']],
      [MID, ['fox1', 'wolf1']],
      [BACK, ['bird1', 'cat2', 'otter1', 'bunny1']],
    ),
  },

  // ---- 第 4 档：8 只，3–4 只进化 ----
  {
    id: 'blaze-elite',
    tier: 4,
    trainer: '炎哥',
    name: '火焰营·精锐',
    intro: '火焰营的精锐。大火球落地会留下燃烧地面，别让宠物挤在火里。',
    theme: 'fire',
    legion: lineup(
      [FRONT, ['bear2', 'turtle1']],
      [MID, ['fox2', 'fox1']],
      [BACK, ['bird2', 'otter1', 'bird1', 'cat1']],
    ),
  },
  {
    id: 'tide-elite',
    tier: 4,
    trainer: '小澜',
    name: '潮汐团·精锐',
    intro: '两层盾：潮甲龟弹回正面的弹丸，浪花獭的泡泡把弹丸反射回来。雷系克水。',
    theme: 'water',
    legion: lineup(
      [FRONT, ['turtle2', 'turtle1']],
      [MID, ['wolf1']],
      [BACK, ['otter2', 'bunny2', 'lizard1', 'cat1', 'deer1']],
    ),
  },
  {
    id: 'storm-elite',
    tier: 4,
    trainer: '雷鸣',
    name: '雷霆队·精锐',
    intro: '迅雷狼冲锋的终点会落雷击晕，雷纹猫的闪电能跳 6 次。岩系克雷。',
    theme: 'thunder',
    legion: lineup(
      [FRONT, ['bear1', 'turtle1']],
      [MID, ['wolf2', 'fox1', 'wolf1']],
      [BACK, ['cat2', 'deer2', 'cat1']],
    ),
  },

  // ---- 第 5 档：9 只，进化为主，1 只人形态 ----
  {
    id: 'grove-elder',
    tier: 5,
    trainer: '青禾长老',
    name: '森之守·长老',
    intro: '花神能放大招万花缚：大范围缠住你的宠物再一起绽放。分散站位能少吃一点。',
    theme: 'wood',
    legion: lineup(
      [FRONT, ['bear2', 'turtle1']],
      [MID, ['fox1']],
      [BACK, ['bunny1', 'deer3', 'otter1']],
      [REAR, ['bunny1', 'lizard1', 'deer1']],
    ),
  },
  {
    id: 'rocks-boss',
    tier: 5,
    trainer: '石头哥',
    name: '岩石帮·老大',
    intro: '岩王亲自上阵：大招岩王崩山把身边的宠物全掀上天。别让近战全挤在它脚下。',
    theme: 'rock',
    legion: lineup(
      [FRONT, ['bear1', 'bear3', 'turtle1']],
      [MID, ['wolf2']],
      [BACK, ['lizard2', 'otter2', 'lizard1']],
      [REAR, ['cat1', 'bird1']],
    ),
  },
  {
    id: 'prodigy',
    tier: 5,
    trainer: '小铃',
    name: '天才少女',
    intro: '她的九焰会放狐火·千本斩，瞬身连斩你的后排。坦克和泡泡能护住后面。',
    theme: 'mixed',
    legion: lineup(
      [FRONT, ['turtle1']],
      [MID, ['fox3', 'wolf1']],
      [BACK, ['cat1', 'bird1', 'otter1']],
      [REAR, ['bunny1', 'deer1', 'lizard1']],
    ),
  },

  // ---- 第 6 档：10 只，2 只人形态 ----
  {
    id: 'blaze-chief',
    tier: 6,
    trainer: '炎哥',
    name: '火焰营·营长',
    intro: '九焰和朱雀同时上场，一个瞬身连斩，一个火凤横扫。水系和坦克是关键。',
    theme: 'fire',
    legion: lineup(
      [FRONT, ['bear1', 'turtle2']],
      [MID, ['fox3', 'wolf1', 'deer1']],
      [BACK, ['bird3', 'otter1', 'bird1']],
      [REAR, ['cat1', 'bunny1']],
    ),
  },
  {
    id: 'tide-chief',
    tier: 6,
    trainer: '小澜',
    name: '潮汐团·团长',
    intro: '潮音一曲潮汐颂把全队治好还套上泡泡，潮甲龟架盾弹回弹丸。持续输出比爆发更可靠。',
    theme: 'water',
    legion: lineup(
      [FRONT, ['turtle2', 'turtle1']],
      [MID, ['wolf2', 'fox1']],
      [BACK, ['otter3', 'bunny1', 'cat1']],
      [REAR, ['bird1', 'lizard1', 'deer1']],
    ),
  },
  {
    id: 'storm-chief',
    tier: 6,
    trainer: '雷鸣',
    name: '雷霆队·队长',
    intro: '雷狼来回冲锋三次，雷音的九霄雷落一口气劈遍全场。站位别太密。',
    theme: 'thunder',
    legion: lineup(
      [FRONT, ['bear1', 'turtle1']],
      [MID, ['wolf3', 'wolf1']],
      [BACK, ['cat3', 'deer1', 'otter1']],
      [REAR, ['cat1', 'bunny1', 'lizard1']],
    ),
  },

  // ---- 第 7 档：首领 ----
  {
    id: 'dragon',
    tier: 7,
    trainer: '烛龙',
    name: '烛龙之巢',
    intro:
      '联赛的尽头。烛龙喷吐龙息、甩尾扫人，还会召来幼年宠物；生命过半会化为人形，放出全场火雨。',
    theme: 'fire',
    boss: { x: 1470, y: CENTER_Y },
    legion: lineup(
      [FRONT, ['turtle2', 'bear2']],
      [MID, ['fox2', 'wolf2']],
      [REAR, ['otter2', 'bird2']],
    ),
  },
];

export function encounterById(id: string): EncounterDef {
  const found = ENCOUNTERS.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown encounter: ${id}`);
  return found;
}

/** 一轮 7 场：每一场对应的档位。 */
export const RUN_TIERS: readonly EncounterTier[] = [1, 2, 3, 4, 5, 6, 7];

/** 每一场可上场的宠物数上限（军团规模）。 */
export const ARMY_CAPS: readonly number[] = [5, 6, 7, 8, 9, 10, 10];
