// 新手指引的内容：战前准备 5 步、战斗 4 步、第一场结算 1 步；每步一句话，指着真实界面。
import { ARENA } from '../core/content/tuning.js';
import type { GuidePart } from '../core/run/save.js';
import type { ArenaRect, GuideStep } from './guide.js';

export type GuideTopic = GuidePart | 'reward';

export const GUIDE_LABEL: Record<GuideTopic, string> = {
  prep: '战前准备',
  battle: '战斗',
  result: '结算',
  reward: '挑奖励',
};

export interface GuideContext {
  /** 场上对手所在的区域（竞技场坐标）。 */
  enemyArea?: () => ArenaRect | null;
}

export function guideSteps(topic: GuideTopic, ctx: GuideContext = {}): GuideStep[] {
  switch (topic) {
    case 'prep':
      return [
        {
          title: '本场目标',
          text: '每场开始前先看这里：对手是谁、有什么特点、要做到什么。',
          target: ['[data-testid=match-header]'],
        },
        {
          title: '开局招式',
          text: '三种不同的办法，点一下就换。拿不准就用默认的反射盾，把飞来的箭弹回去。',
          target: ['.starter-card'],
          optional: true,
        },
        {
          title: '队伍配置',
          text: '每名队员 2 个槽位。赢了会拿到新招式，点槽位就能装上、卸下或替换。',
          target: ['.squad-card'],
        },
        {
          title: '站位',
          text: '在亮起的区域里拖动队员，调整开场位置；也可以先点队员，再点空地。',
          arena: () => ({ x: 0, y: 0, w: ARENA.playerZoneMaxX, h: ARENA.height }),
        },
        {
          title: '开战',
          text: '准备好了就点开战（或按 Enter）。开战后接着讲战斗里怎么操作。',
          target: ['[data-testid=fight]'],
        },
      ];
    case 'battle':
      return [
        {
          title: '暂停',
          text: '空格随时暂停，再按一次继续。暂停时也能放招式、点选集火，不用手忙脚乱。',
          target: ['[data-testid=pause]'],
        },
        {
          title: '主动招式',
          text: '装了主动招式的队员，卡片上会有技能按钮：按 1 / 2 / 3 或点按钮，再点场地选位置发动。',
          target: ['[data-testid^=skill-]', '[data-testid=unit-guard]'],
        },
        {
          title: '集火',
          text: '点一个对手，阿铁和小弹会优先打它；再点一次取消。',
          arena: ctx.enemyArea,
          target: ['[data-testid=arena]'],
        },
        {
          title: '回响',
          text: '弹回、弹射、撞墙、撞击、连爆每传一次，回响 +1，伤害越来越高。这里记着本场打出的最长回响。',
          target: ['.echo-line'],
        },
      ];
    case 'result':
      return [
        {
          title: '胜负之后',
          text: '赢了从三张卡里挑一个新招式或进阶；输了可以原样再来，或回到战前改配置、换站位，已经拿到的招式不会丢。',
          target: ['.result-actions'],
        },
      ];
    case 'reward':
      return [
        {
          title: '挑奖励',
          text: '三选一：新招式，或进阶已有的招式。每名队员 2 个槽位、主动招式每人最多 1 个，装不下的会放进招式库，战前可以替换。',
          target: ['.offer-row'],
        },
      ];
  }
}

/** 标题页的“新手指引”：没有真实界面可指，按顺序翻看全部步骤的文字卡片。 */
export function guideOverview(): GuideStep[] {
  return (['prep', 'battle', 'result'] as const).flatMap((part) =>
    guideSteps(part).map((step) => ({ title: step.title, text: step.text })),
  );
}
