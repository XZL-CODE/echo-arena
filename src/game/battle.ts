// 一场战斗的推进：固定步长跑规则层（按倍速与慢动作折算），事件交给画面、声音与界面；
// 战前预览只摆出双方、不推进。点敌人设集火由界面转过来。
import type { EncounterDef } from '../core/content/encounters.js';
import { SIM } from '../core/content/tuning.js';
import type { SimEvent } from '../core/sim/events.js';
import { World, type BattleConfig } from '../core/sim/world.js';
import { THEME_OF_ELEMENT, type StageTheme } from '../gfx/battle/stage.js';
import type { BattleView } from '../gfx/battle/view.js';
import type { FxEvent } from '../gfx/fx/director.js';

/** 分出胜负后再演多久（胜利动作、慢动作收尾）才交给结算。 */
const OUTRO = 2.4;

export interface BattleHooks {
  /** 每步的事件（声音、界面提示用）。 */
  onEvents?(events: readonly SimEvent[], world: World): void;
  /** 胜负已分、收尾演完。 */
  onEnd?(result: 'win' | 'lose', world: World): void;
}

/** 战场主题：按对手的主题属性；混编队按队名轮换；首领在云上遗迹。 */
export function stageFor(encounter: EncounterDef): StageTheme {
  if (encounter.boss) return 'temple';
  if (encounter.theme !== 'mixed') return THEME_OF_ELEMENT[encounter.theme] ?? 'meadow';
  const themes: StageTheme[] = ['meadow', 'canyon', 'storm', 'lagoon'];
  let h = 0;
  for (const c of encounter.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return themes[h % themes.length] as StageTheme;
}

export class BattleController {
  readonly view: BattleView;
  world: World | null = null;
  /** 倍速（1、2、3）。 */
  speed = 1;
  paused = false;
  /** 只摆出来、不推进（战前预览、测试里冻结开场）。 */
  hold = false;
  hooks: BattleHooks = {};
  private acc = 0;
  private outro = -1;
  private finished = false;

  constructor(view: BattleView) {
    this.view = view;
  }

  /** 开一场新的战斗（或战前预览：hold 为 true 时不推进）。 */
  start(config: BattleConfig, hold = false): World {
    const world = new World(config);
    this.world = world;
    this.acc = 0;
    this.outro = -1;
    this.finished = false;
    this.paused = false;
    this.hold = hold;
    this.view.reset();
    this.view.setStage(stageFor(config.encounter));
    this.view.autoFrame = !hold;
    this.view.sync(world, 1, 0);
    return world;
  }

  stop(): void {
    this.world = null;
    this.view.reset();
  }

  get ended(): boolean {
    return this.finished;
  }

  /** 点到敌人就设为集火目标（再点一次取消）。返回点到的单位 id。 */
  click(clientX: number, clientY: number): number {
    const w = this.world;
    if (!w || this.hold || w.result) return 0;
    const id = this.view.pick(clientX, clientY, 1);
    if (id) w.setFocus(id);
    return id;
  }

  hover(clientX: number, clientY: number): void {
    this.view.hoverId = this.world && !this.world.result ? this.view.pick(clientX, clientY, 1) : 0;
  }

  /**
   * 推进一帧（dt 是封顶后的帧间隔）并同步画面。收尾按 wall 秒（真实经过的时间，
   * 只防长时间卡顿）计时：机器很慢、一帧要画好久时，收尾也不会被拖长。
   */
  update(dt: number, wall = dt): void {
    const w = this.world;
    if (!w) return;
    const running = !this.paused && !this.hold && !this.finished;
    if (running) {
      this.acc += Math.min(0.1, dt) * this.speed * this.view.timeScale;
      let steps = 0;
      while (this.acc >= SIM.dt && steps < 16) {
        w.step();
        this.acc -= SIM.dt;
        steps++;
        const events = w.drainEvents();
        if (events.length > 0) {
          this.view.handle(events as unknown as FxEvent[]);
          this.hooks.onEvents?.(events, w);
        }
      }
      if (steps >= 16) this.acc = 0;
    }
    // 收尾按真实时间演（快进打出结果、测试冻结实时推进时也一样），暂停时停住
    if (w.result && !this.finished && !this.paused) {
      this.outro = Math.max(0, this.outro) + wall;
      if (this.outro >= OUTRO) {
        this.finished = true;
        this.hooks.onEnd?.(w.result, w);
      }
    }
    const frameDt = this.paused ? 0 : dt * (running ? this.speed : 1);
    this.view.sync(w, Math.min(1, this.acc / SIM.dt), frameDt);
  }

  /**
   * 测试与调试：直接快进若干秒（不渲染中间帧，事件照常交给特效与界面；quiet 时不放特效和特写）。
   * 暂停时不动；中途弹出新手指引（会暂停战斗）就停在那一步。
   */
  fastForward(seconds: number, quiet = false): void {
    const w = this.world;
    if (!w) return;
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps && !w.result && !this.paused; i++) {
      w.step();
      const events = w.drainEvents();
      if (events.length > 0) {
        if (!quiet) this.view.handle(events as unknown as FxEvent[]);
        this.hooks.onEvents?.(events, w);
      }
    }
    this.view.sync(w, 1, 0);
  }
}
