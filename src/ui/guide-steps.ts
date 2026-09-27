// 新手指引的课程内容：每课几步，每步一句话，指着真实界面，手指演示要做的操作。
// 课程在对应情形第一次出现时教：第一次战前准备、第一次开战、第一次能放主动招式、
// 第一次打出回响、第一场结算、第一次挑奖励。
import { MODULE_DEFS } from '../core/content/modules.js';
import { ARENA } from '../core/content/tuning.js';
import { unitDef } from '../core/content/units.js';
import type { GuidePart } from '../core/run/save.js';
import {
  PLAYER_UNITS,
  type DamageSource,
  type ModuleId,
  type PlayerUnitKind,
} from '../core/types.js';
import type { ArenaController } from '../game/arena.js';
import type { ArenaPoint, ArenaRect, GuideStep } from './guide.js';

export const GUIDE_LABEL: Record<GuidePart, string> = {
  prep: '战前准备',
  battle: '开战',
  skill: '放招式',
  echo: '回响',
  result: '结算',
  reward: '挑奖励',
};

export const UNIT_KEYS: Record<PlayerUnitKind, string> = { guard: '1', slinger: '2', bell: '3' };

/** 课程需要读取的游戏状态。 */
export interface LessonContext {
  arena: ArenaController;
  /** 当前界面（prep / battle / result / reward / summary）。 */
  view: () => string;
  /** 第一次教（照做才往下走）还是重看。 */
  mode: 'teach' | 'review';
  /** 战前拖动或摆放队员的次数。 */
  formationMoves: () => number;
  /** 这一场放出的主动招式次数。 */
  casts: () => number;
  /** 奖励界面是否已经点了一张卡。 */
  rewardPicked: () => boolean;
}

/** 回响课需要的那一次回响：在哪里、第几级、由什么引起，以及接下来飞向哪里。 */
export interface EchoMoment {
  x: number;
  y: number;
  level: number;
  source: DamageSource;
  to?: ArenaPoint | null;
}

// ---- 战前准备 ----

export function prepLesson(ctx: LessonContext): GuideStep[] {
  let moves = 0;
  return [
    {
      title: '先看对手',
      text: '每场开始前看一眼：对手是谁、有什么特点；目标是把它们全部击倒。',
      spots: [{ el: ['[data-testid=match-header]'] }, { arena: () => enemyArea(ctx.arena) }],
    },
    {
      title: '选一个开局招式',
      text: '三种办法，点一下就换；拿不准就选反射盾，把飞来的箭弹回去。',
      spots: [{ el: ['.starter-list'] }],
      hand: { kind: 'tap', at: { el: ['.starter-on', '.starter'] } },
      tapDone: true,
      optional: true,
    },
    {
      title: '拖动队员，摆好站位',
      text: '按住队员拖到亮起区域里的任意位置；也可以先点队员，再点空地。',
      spots: [{ arena: () => ({ x: 0, y: 0, w: ARENA.playerZoneMaxX, h: ARENA.height }) }],
      hand: {
        kind: 'drag',
        from: { arena: () => unitPoint(ctx.arena, 'guard') },
        to: { arena: () => dragGoal(ctx.arena) },
      },
      enter: () => {
        moves = ctx.formationMoves();
      },
      done: () => ctx.formationMoves() > moves,
    },
    {
      title: '点“开战”',
      text: '开战后队员会自己走位、自己攻击；你来点集火、放招式。',
      spots: [{ el: ['[data-testid=fight]'] }],
      hand: { kind: 'tap', at: { el: ['[data-testid=fight]'] } },
      keys: ['Enter'],
      done: () => ctx.view() !== 'prep',
    },
  ];
}

// ---- 战斗 ----

/** 开战第一课：集火，然后按空格开打。 */
export function battleLesson(ctx: LessonContext): GuideStep[] {
  return [focusStep(ctx), pauseStep(ctx)];
}

function focusStep(ctx: LessonContext): GuideStep {
  let focus = 0;
  return {
    title: '点一个对手，集火它',
    text: '战斗停着等你。点一个对手，阿铁和小弹会优先打它；再点一次取消。',
    spots: [{ arena: () => enemyArea(ctx.arena) }],
    hand: { kind: 'tap', at: { arena: () => frontEnemy(ctx.arena) } },
    enter: () => {
      focus = ctx.arena.world?.focusId ?? 0;
    },
    done: () => {
      const now = ctx.arena.world?.focusId ?? 0;
      return now !== 0 && now !== focus;
    },
  };
}

function pauseStep(ctx: LessonContext): GuideStep {
  return {
    title: ctx.mode === 'teach' ? '按空格开打' : '按空格继续',
    text: '空格随时暂停、继续；停着的时候也能放招式、点集火，不用手忙脚乱。',
    spots: [{ el: ['[data-testid=pause]'] }],
    keep: [{ arena: () => enemyArea(ctx.arena) }],
    hand: { kind: 'tap', at: { el: ['[data-testid=pause]'] } },
    keys: [' '],
    done: () => !ctx.arena.paused,
  };
}

/** 第一次能放主动招式：先点招式按钮，再点场地。 */
export function skillLesson(ctx: LessonContext, kind: PlayerUnitKind): GuideStep[] {
  const module = ctx.arena.world?.playerUnit(kind)?.active;
  if (!module) return [];
  const name = MODULE_DEFS[module].name;
  const key = UNIT_KEYS[kind];
  const button = `[data-testid=skill-${kind}]`;
  let casts = 0;
  return [
    {
      title: `第一步：点「${name}」`,
      text: `${unitDef(kind).name}的主动招式准备好了：点这个按钮，或者按 ${key}。`,
      spots: [{ el: [button] }],
      hand: { kind: 'tap', at: { el: [button] } },
      keys: [key],
      done: () => ctx.arena.targeting === kind,
    },
    {
      title: '第二步：点场地放出去',
      text: AIM_TEXT[module] ?? '点场地上的位置发动；右键取消。',
      spots: [{ el: ['[data-testid=arena]'] }],
      hand: { kind: 'tap', at: { arena: () => castPoint(ctx.arena, module) } },
      enter: () => {
        casts = ctx.casts();
      },
      done: () => ctx.casts() > casts,
      back: () => ctx.mode === 'teach' && ctx.arena.targeting !== kind && ctx.casts() === casts,
    },
  ];
}

const AIM_TEXT: Partial<Record<ModuleId, string>> = {
  vortex: '点对手扎堆的地方：漩涡把附近的对手吸到一起，这时候它们打不了人。',
  charge: '点对手所在的位置：阿铁冲过去，把沿途的对手撞开。',
  pierce: '朝对手点一下：小弹射出贯穿大弹，推开一整条线上的对手。',
};

/** 第一次打出回响：定格在那一刻讲。 */
export function echoLesson(moment: EchoMoment): GuideStep[] {
  const to = moment.to;
  const area = to
    ? spanning(moment, to, 70)
    : { x: moment.x - 90, y: moment.y - 90, w: 180, h: 180 };
  return [
    {
      title: `回响 ×${moment.level}！`,
      text: `${ECHO_CAUSE[moment.source] ?? '一次攻击接着传了下去'}；每多传一次，回响 +1，伤害越来越高。`,
      spots: [{ arena: () => area }, { el: ['.echo-line'] }],
      hand: to
        ? { kind: 'path', from: { arena: () => moment }, to: { arena: () => to } }
        : undefined,
    },
  ];
}

const ECHO_CAUSE: Partial<Record<DamageSource, string>> = {
  reflect: '箭撞上阿铁的反射盾，原路弹回去射向射手',
  mirrorpost: '对手的弹丸被镜桩拐了个弯，飞向另一个对手',
  ricochet: '弹丸打中一个对手，又弹向下一个',
  rubber: '弹丸撞墙弹了回来，又飞向对手',
  impact: '被撞开的对手撞上了墙、柱子或同伴',
  spring: '对手撞上弹簧桩，被猛地弹开',
  charge: '阿铁冲过去撞开对手，对手又撞上别的东西',
  pierce: '贯穿大弹推着对手撞了出去',
  heavy: '重弹把对手打飞，撞上了别的东西',
  burst: '被击倒的对手炸开，波及周围的对手',
  detonate: '被击倒的对手炸开，波及周围的对手',
  vortex: '漩涡把对手挤在一起，伤害接着传了下去',
};

/** 重看时讲回响：指着底栏记录最长回响的地方。 */
export function echoReview(): GuideStep {
  return {
    title: '回响',
    text: '弹回、弹射、撞墙、撞飞、连爆，每传一次回响 +1，伤害越来越高；这里记着本场最长的回响。',
    spots: [{ el: ['.echo-line'] }],
  };
}

/** 战斗中点“？”重看：集火、放招式（装了的话）、回响，最后按空格继续。 */
export function battleReview(ctx: LessonContext): GuideStep[] {
  const kind = PLAYER_UNITS.find((k) => ctx.arena.world?.playerUnit(k)?.active);
  return [focusStep(ctx), ...(kind ? skillLesson(ctx, kind) : []), echoReview(), pauseStep(ctx)];
}

// ---- 结算与奖励 ----

export function resultLesson(ctx: LessonContext, win: boolean): GuideStep[] {
  if (win) {
    return [
      {
        title: '赢了！去挑奖励',
        text: '每赢一场，都能从三张招式卡里挑一张带进下一场，队伍越打越有花样。',
        spots: [{ el: ['[data-testid=result-next]'] }],
        keep: [{ el: ['[data-testid=result]'] }],
        hand: { kind: 'tap', at: { el: ['[data-testid=result-next]'] } },
        keys: ['Enter'],
        done: () => ctx.view() !== 'result',
      },
    ];
  }
  return [
    {
      title: '没赢也不亏',
      text: '“原样再来”的对手和随机条件完全一样；“调整配置再试”能换招式、换站位，拿到的招式都在。',
      spots: [{ el: ['.result-actions'] }],
      keep: [{ el: ['[data-testid=result]'] }],
    },
  ];
}

export function rewardLesson(ctx: LessonContext): GuideStep[] {
  const confirm = '[data-testid=reward-confirm]';
  return [
    {
      title: '挑一张，带进下一场',
      text: '点一张卡再点确认；每名队员 2 个槽位，装不下的新招式会放进招式库，战前可以换。',
      spots: [{ el: ['.offer-row'] }, { el: [confirm] }],
      hand: () =>
        ctx.rewardPicked()
          ? { kind: 'tap', at: { el: [confirm] } }
          : { kind: 'tap', at: { el: ['[data-testid^=offer-]'] } },
      keys: ['1', '2', '3', 'Enter'],
      done: () => ctx.view() !== 'reward',
    },
  ];
}

export function practiceDoneReview(): GuideStep[] {
  return [
    {
      title: '教学战打完了',
      text: '开始正式的一轮，或者回到标题；之后想再练，标题页的“新手指引”随时可以进来。',
      spots: [{ el: ['[data-testid=practice-done] .result-actions'] }],
    },
  ];
}

export function summaryReview(): GuideStep[] {
  return [
    {
      title: '这一轮打完了',
      text: '再来一轮换个思路，或者回到标题；标题页的“新手指引”会带你进教学战，从头练一遍。',
      spots: [{ el: ['[data-testid=summary] .result-actions'] }],
    },
  ];
}

// ---- 场上的位置 ----

/** 场上对手所在的区域。 */
export function enemyArea(arena: ArenaController): ArenaRect | null {
  const world = arena.world;
  const foes = world?.units.filter((u) => u.alive && u.team === 1) ?? [];
  if (!world || foes.length === 0) return null;
  const xs = foes.map((u) => u.x);
  const ys = foes.map((u) => u.y);
  const x0 = Math.max(0, Math.min(...xs) - 50);
  const x1 = Math.min(world.width, Math.max(...xs) + 50);
  const y0 = Math.max(0, Math.min(...ys) - 70);
  const y1 = Math.min(world.height, Math.max(...ys) + 45);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 离我方最近的对手（手指点它的身体中部，和点选判定一致）。 */
function frontEnemy(arena: ArenaController): ArenaPoint | null {
  const foes = arena.world?.units.filter((u) => u.alive && u.team === 1) ?? [];
  const front = foes.reduce<(typeof foes)[number] | null>(
    (best, u) => (!best || u.x < best.x ? u : best),
    null,
  );
  return front ? { x: front.x, y: front.y - front.radius * 0.4 } : null;
}

function unitPoint(arena: ArenaController, kind: PlayerUnitKind): ArenaPoint | null {
  const u = arena.world?.playerUnit(kind);
  return u ? { x: u.x, y: u.y - u.radius * 0.4 } : null;
}

/** 演示拖动的落点：竖着挪一大段（我方区域窄，横着挪不明显）。 */
function dragGoal(arena: ArenaController): ArenaPoint | null {
  const from = unitPoint(arena, 'guard');
  if (!from) return null;
  const x = Math.min(ARENA.playerZoneMaxX - 50, Math.max(60, from.x - 40));
  const y = from.y > ARENA.height / 2 - 40 ? from.y - 170 : from.y + 170;
  return { x, y };
}

/** 放招式的建议位置：漩涡放在对手中间，冲锋和贯穿射对准最近的对手。 */
function castPoint(arena: ArenaController, module: ModuleId): ArenaPoint | null {
  const foes = arena.world?.units.filter((u) => u.alive && u.team === 1) ?? [];
  if (foes.length === 0) return null;
  if (module === 'vortex') {
    return {
      x: foes.reduce((s, u) => s + u.x, 0) / foes.length,
      y: foes.reduce((s, u) => s + u.y, 0) / foes.length,
    };
  }
  return frontEnemy(arena);
}

/** 同时框住两点的区域（四周留出 pad）。 */
function spanning(a: ArenaPoint, b: ArenaPoint, pad: number): ArenaRect {
  const x0 = Math.max(0, Math.min(a.x, b.x) - pad);
  const y0 = Math.max(0, Math.min(a.y, b.y) - pad);
  const x1 = Math.min(ARENA.width, Math.max(a.x, b.x) + pad);
  const y1 = Math.min(ARENA.height, Math.max(a.y, b.y) + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
