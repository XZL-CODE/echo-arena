// 新手指引的课程内容：每课几步，每步一句话，指着真实界面或 3D 战场里的单位，手指演示要做的操作。
// 课程在对应情形第一次出现时教：第一次战前准备、第一次开战、第一次打出回响、我方第一次放大招、
// 第一场结算、第一次挑奖励。
import { ARENA } from '../core/content/tuning.js';
import type { GuidePart } from '../core/run/save.js';
import type { World } from '../core/sim/world.js';
import type { BattleView } from '../gfx/battle/view.js';
import type { GuideStep, ScreenPoint, ScreenRect } from './guide.js';

export const GUIDE_LABEL: Record<GuidePart, string> = {
  prep: '战前准备',
  battle: '开战',
  echo: '回响',
  ult: '大招',
  result: '结算',
  reward: '收服与进化',
};

/** 课程需要读取的游戏状态。 */
export interface LessonContext {
  view: BattleView;
  world: () => World | null;
  /** 当前界面（prep / battle / result / reward …）。 */
  screen: () => string;
  /** 第一次教（照做才往下走）还是重看。 */
  mode: 'teach' | 'review';
  /** 战前拖动站位的次数。 */
  formationMoves: () => number;
  /** 奖励界面已经选中的收服与进化。 */
  rewardPick: () => { capture?: number; evolve?: number };
}

/** 回响课要圈出来的那一次回响（模拟坐标）。 */
export interface EchoMoment {
  x: number;
  y: number;
  level: number;
}

// ---- 屏幕位置 ----

/** 拖动演示的终点留在我方布阵区里（与规则核心的布阵区一致）。 */
const ZONE = { minX: ARENA.margin + 40, maxX: ARENA.playerZoneMaxX - 20, minY: ARENA.margin + 60 };

/** 单位在屏幕上的框（按头顶到脚下的高度估个宽度）。 */
function unitBox(view: BattleView, id: number): ScreenRect | null {
  const s = view.unitScreen(id);
  if (!s) return null;
  const tall = Math.max(30, (s.y - s.top) * 2.1);
  const w = Math.max(44, tall * 0.8);
  return { x: s.x - w / 2, y: s.top - 8, w, h: tall + 12 };
}

/** 一方全部还活着的单位在屏幕上的包围框。 */
function teamBox(view: BattleView, world: World | null, team: 0 | 1): ScreenRect | null {
  if (!world) return null;
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const u of world.units) {
    if (u.team !== team || !u.alive) continue;
    const b = unitBox(view, u.id);
    if (!b) continue;
    if (!box) box = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
    else {
      box.x0 = Math.min(box.x0, b.x);
      box.y0 = Math.min(box.y0, b.y);
      box.x1 = Math.max(box.x1, b.x + b.w);
      box.y1 = Math.max(box.y1, b.y + b.h);
    }
  }
  return box ? { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 } : null;
}

function unitPoint(view: BattleView, id: number): ScreenPoint | null {
  const s = view.unitScreen(id);
  return s ? { x: s.x, y: (s.y + s.top) / 2 } : null;
}

/** 离我方最近的敌人（集火演示点它）。 */
function frontEnemy(world: World | null): number {
  if (!world) return 0;
  let best = 0;
  let bestX = Infinity;
  for (const u of world.units) {
    if (u.team !== 1 || !u.alive) continue;
    if (u.x < bestX) {
      bestX = u.x;
      best = u.id;
    }
  }
  return best;
}

/** 我方站在最前面的一只（拖动演示拿它）。 */
function frontAlly(world: World | null): number {
  if (!world) return 0;
  let best = 0;
  let bestX = -Infinity;
  for (const u of world.units) {
    if (u.team !== 0 || !u.alive || !u.uid) continue;
    if (u.x > bestX) {
      bestX = u.x;
      best = u.id;
    }
  }
  return best;
}

// ---- 战前准备 ----

export function prepLesson(ctx: LessonContext): GuideStep[] {
  let moves = 0;
  /** 拖动演示：拿最前面的一只，往场地中线方向挪一大步（模拟坐标，进入这一步时定下）。 */
  let drag: { id: number; x: number; y: number } | null = null;
  return [
    {
      title: '先看对手',
      text: '看一眼对手有哪些宠物、是什么属性。五系相克：水克火、火克木、木克岩、岩克雷、雷克水，克制时伤害多三成。',
      spots: [{ el: ['[data-guide=foe]'] }, { screen: () => teamBox(ctx.view, ctx.world(), 1) }],
    },
    {
      title: '这是你的军团',
      text: '每只宠物会自己走位、自己出招。赢了可以收服新宠物、让宠物进化，军团越打越强。',
      spots: [{ el: ['[data-guide=legion]'] }],
    },
    {
      title: '拖动宠物，摆好站位',
      text: '按住我方的一只宠物拖到别处，放开就定好了：坦克放前面挡着，射手和辅助放后面。',
      spots: [{ screen: () => teamBox(ctx.view, ctx.world(), 0) }],
      hand: () => {
        const target = drag;
        if (!target) return null;
        return {
          kind: 'drag',
          from: { screen: () => unitPoint(ctx.view, target.id) },
          to: { screen: () => ctx.view.screenOf(target.x, target.y, 0.3) },
        };
      },
      enter: () => {
        moves = ctx.formationMoves();
        const w = ctx.world();
        const id = frontAlly(w);
        const u = id ? w?.unitById(id) : undefined;
        drag = null;
        if (!w || !u) return;
        const y = u.y < w.height / 2 ? u.y + 220 : u.y - 220;
        drag = {
          id,
          x: Math.max(ZONE.minX, Math.min(ZONE.maxX, u.x - 30)),
          y: Math.max(ZONE.minY, Math.min(w.height - ZONE.minY, y)),
        };
      },
      done: () => ctx.formationMoves() > moves,
    },
    {
      title: '点“开战”',
      text: '开战后全自动：你只需要在关键时刻点敌人集火，或者暂停、加速。',
      spots: [{ el: ['[data-testid=start-battle]'] }],
      hand: { kind: 'tap', at: { el: ['[data-testid=start-battle]'] } },
      keys: ['Enter'],
      done: () => ctx.screen() !== 'prep',
    },
  ];
}

// ---- 战斗 ----

export function battleLesson(ctx: LessonContext): GuideStep[] {
  let focus = 0;
  return [
    {
      title: '点一个敌人，集火它',
      text: '战斗停着等你。点一个敌人，全军会优先打它；再点一次取消。先打掉对面的治疗和法师，往往能扭转局面。',
      spots: [{ screen: () => teamBox(ctx.view, ctx.world(), 1) }],
      hand: { kind: 'tap', at: { screen: () => unitPoint(ctx.view, frontEnemy(ctx.world())) } },
      enter: () => {
        focus = ctx.world()?.focusId ?? 0;
      },
      done: () => {
        const now = ctx.world()?.focusId ?? 0;
        return now !== 0 && now !== focus;
      },
    },
    {
      title: '暂停与加速',
      text: '右上角可以加速到 2 倍、3 倍，或者打开暂停菜单；战斗中按空格键暂停 / 继续，按 1、2、3 切换倍速。',
      spots: [{ el: ['[data-guide=speed]'] }, { el: ['[data-testid=pause]'] }],
    },
  ];
}

// ---- 回响 ----

export function echoLesson(ctx: LessonContext, moment: EchoMoment | null): GuideStep[] {
  return [
    {
      title: `回响 ×${moment?.level ?? 2}`,
      text: '被击飞的单位撞上别的单位，或者撞到场地边缘的结界，就会产生回响：同一串连锁每多一环，伤害 +25%，最多 8 级。',
      spots: [
        {
          screen: () => {
            if (!moment) return null;
            const p = ctx.view.screenOf(moment.x, moment.y, 0.4);
            return { x: p.x - 70, y: p.y - 70, w: 140, h: 140 };
          },
        },
      ],
    },
  ];
}

// ---- 大招 ----

export function ultLesson(ctx: LessonContext, unitId: number): GuideStep[] {
  return [
    {
      title: '大招',
      text: '进化到第三阶的人形态宠物会攒能量（头像下面的金色条），满了自动放大招，镜头会给它一个特写。',
      spots: [
        { el: ['[data-guide=strip]'] },
        { screen: () => (unitId ? unitBox(ctx.view, unitId) : null) },
      ],
    },
  ];
}

// ---- 结算 ----

export function resultLesson(): GuideStep[] {
  return [
    {
      title: '看看这一场',
      text: '这里列出这一场的关键数据：谁打得最多、克制打了多少、回响连到几级。输了可以回到战前调整站位再来。',
      spots: [{ el: ['[data-guide=result]'] }],
    },
  ];
}

// ---- 收服与进化 ----

export function rewardLesson(ctx: LessonContext): GuideStep[] {
  return [
    {
      title: '收服一只新宠物',
      text: '点一张卡，把它收进军团（军团有上限，满了这一行就没有）。',
      spots: [{ el: ['[data-guide=capture]'] }],
      hand: { kind: 'tap', at: { el: ['[data-testid=capture-0]'] } },
      done: () => ctx.rewardPick().capture !== undefined,
      optional: true,
    },
    {
      title: '让一只宠物进化',
      text: '再点一张，让它进化。进化到第三阶就变成人形态，还会获得大招。',
      spots: [{ el: ['[data-guide=evolve]'] }],
      hand: { kind: 'tap', at: { el: ['[data-testid=evolve-0]'] } },
      done: () => ctx.rewardPick().evolve !== undefined,
      optional: true,
    },
    {
      title: '点“确认”',
      text: '两项同时生效，然后进入下一场的战前准备。',
      spots: [{ el: ['[data-testid=claim]'] }],
      hand: { kind: 'tap', at: { el: ['[data-testid=claim]'] } },
      keys: ['Enter'],
      tapDone: true,
    },
  ];
}
