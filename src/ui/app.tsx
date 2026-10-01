// 应用外壳：一块 3D 画布（战场或展示台）加上叠在上面的界面。
// 画面：标题、选伙伴、战前军团、战斗、结算、奖励、进化演出、通关、图鉴；设置、暂停与确认是弹窗。
import { AudioEngine } from '../audio/audio.js';
import { counteredBy } from '../core/content/elements.js';
import {
  ALL_FORM_IDS,
  DRAGON,
  FORM_NAME,
  SPECIES,
  formName,
  formStats,
  skillName,
} from '../core/content/species.js';
import { codexFromLegion, codexFromWorld, codexProgress, mergeCodex } from '../core/run/codex.js';
import { clampToPlayerZone } from '../core/run/formation.js';
import {
  formatTime,
  summarizeBattle,
  summarizeRun,
  type BattleSummary,
} from '../core/run/insights.js';
import {
  armyCap,
  battleConfig,
  beginBattle,
  canChooseStarter,
  chooseStarter,
  createPracticeRun,
  createRun,
  currentEncounter,
  finishBattle,
  leaveBattle,
  partnerOf,
  pickReward,
  resetFormation,
  RUN_LENGTH,
  setFormation,
  type RunState,
} from '../core/run/run.js';
import { GUIDE_PARTS, type GuidePart, type Quality, type Settings } from '../core/run/save.js';
import type { SimEvent } from '../core/sim/events.js';
import type { World } from '../core/sim/world.js';
import type { Difficulty, Element, Form, SpeciesId } from '../core/types.js';
import { BattleController } from '../game/battle.js';
import { Persistence } from '../game/persistence.js';
import { BattleView } from '../gfx/battle/view.js';
import type { QualityLevel } from '../gfx/engine.js';
import { Showcase } from '../gfx/showcase.js';
import { bridge } from '../platform/storage.js';
import { cx, h, mount } from './dom.js';
import { Guide } from './guide.js';
import {
  battleLesson,
  echoLesson,
  GUIDE_LABEL,
  prepLesson,
  resultLesson,
  rewardLesson,
  ultLesson,
  type EchoMoment,
  type LessonContext,
} from './guide-steps.js';
import { uiIcon } from './icons.js';
import {
  ELEMENT_CSS,
  elementBadge,
  elementOf,
  formStars,
  petCard,
  petImage,
  roleTag,
} from './parts.js';
import { button, dialog, iconButton, segmented, slider, toggle } from './widgets.js';

type Screen =
  'title' | 'starter' | 'prep' | 'battle' | 'result' | 'reward' | 'evolve' | 'complete' | 'codex';

/** 用战场画面的界面（其余用展示台）。 */
const FIELD_SCREENS = new Set<Screen>(['prep', 'battle', 'result']);

const QUALITY_LEVEL: Record<Exclude<Quality, 'auto'>, QualityLevel> = {
  high: 3,
  medium: 2,
  low: 1,
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '轻松', normal: '标准', hard: '硬核' };

/** 展示台的星云配色（按属性）。 */
const NEBULA: Record<Element | 'default', [number, number, number]> = {
  default: [0x140c30, 0x3a1a6a, 0xd05aa0],
  fire: [0x1e0a10, 0x6a1a1a, 0xff8a3a],
  water: [0x081830, 0x14406a, 0x5ad0ff],
  wood: [0x0a1a14, 0x1a4a2a, 0x9ae07a],
  rock: [0x1a1010, 0x4a2a1a, 0xe0a060],
  thunder: [0x100c28, 0x2a1a6a, 0xffe45a],
};

interface HudRefs {
  time: HTMLElement;
  focus: HTMLElement;
  foes: HTMLElement;
  overtime: HTMLElement;
  chips: Map<number, { root: HTMLElement; hp: HTMLElement; energy: HTMLElement | null }>;
  speed: HTMLElement;
  pause: HTMLElement;
  /** 暂停时画面中间的提示（空格暂停、失焦自动暂停）。 */
  banner: HTMLElement;
}

interface ResultInfo {
  result: 'win' | 'lose';
  summary: BattleSummary;
  world: World;
}

export class App {
  readonly persistence = new Persistence();
  readonly audio = new AudioEngine();
  readonly view: BattleView;
  readonly battle: BattleController;
  readonly showcase = new Showcase();
  readonly guide: Guide;
  private readonly shell: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: HTMLElement;
  private readonly modalLayer: HTMLElement;
  private readonly toastLayer: HTMLElement;
  private screen: Screen = 'title';
  /** 教学战：不写进存档。 */
  private practice = false;
  private practiceRun: RunState | null = null;
  /** 上一次真正画的时刻、上一次屏幕刷新的时刻，以及攒下来还没画的时间（毫秒，见 loop）。 */
  private last = 0;
  private lastTick = 0;
  private frameBudget = 0;
  private modalClose: (() => void) | null = null;
  private hud: HudRefs | null = null;
  private resultInfo: ResultInfo | null = null;
  private pick: { capture?: number; evolve?: number } = {};
  private codexSel = '';
  private starterSel: SpeciesId | null = null;
  private drag: { id: number; uid: number; pointer: number } | null = null;
  private pausedByBlur = false;
  /** 这次打开时，存档里的一轮是在战斗中离开的。 */
  private leftBattle = false;
  private guidePaused = false;
  /** 正在第一次教的课（界面切走时算学过）。 */
  private teaching: GuidePart | null = null;
  /** 教学战里已经教过的课（教学战不管存档里学没学过，从头教一遍）。 */
  private practiceTaught = new Set<GuidePart>();
  /** 战前拖动站位的次数（指引“拖动宠物”一步用）。 */
  private formationMoves = 0;
  private echoMoment: EchoMoment | null = null;
  private titleForm = '';

  constructor(root: HTMLElement) {
    this.canvas = h('canvas', {
      class: 'scene-canvas',
      'data-testid': 'arena',
    }) as HTMLCanvasElement;
    const overlay = h('div', { class: 'scene-overlay' }) as HTMLElement;
    this.ui = h('div', { class: 'ui' }) as HTMLElement;
    this.modalLayer = h('div', { class: 'modal-layer' }) as HTMLElement;
    this.toastLayer = h('div', { class: 'toast-layer', 'aria-live': 'polite' }) as HTMLElement;
    const guideLayer = h('div', { class: 'guide-layer' }) as HTMLElement;
    this.shell = h(
      'div',
      { class: 'app', 'data-screen': 'title' },
      h('div', { class: 'scene', 'data-guide': 'field' }, this.canvas, overlay),
      this.ui,
      guideLayer,
      this.modalLayer,
      this.toastLayer,
    ) as HTMLElement;
    mount(root, this.shell);
    this.view = new BattleView(this.canvas, overlay);
    this.battle = new BattleController(this.view);
    this.guide = new Guide(guideLayer, this.canvas);
    this.view.namer = (u) => {
      if (u.species === 'dragon')
        return { skill: DRAGON.ult.name, name: formName('dragon', u.form) };
      const def = SPECIES[u.species as SpeciesId];
      return { skill: def?.ult.name ?? '大招', name: formName(u.species as SpeciesId, u.form) };
    };
    this.battle.hooks = {
      onEvents: (events, world) => this.onBattleEvents(events, world),
      onEnd: (result, world) => this.onBattleEnd(result, world),
    };
    this.bindInput();
  }

  get settings(): Settings {
    return this.persistence.data.settings;
  }

  /** 当前这一轮（教学战用内存里的那一份）。 */
  private get run(): RunState | null {
    return this.practice ? this.practiceRun : this.persistence.data.run;
  }

  private setRun(run: RunState | null): void {
    if (this.practice) this.practiceRun = run;
    else this.persistence.update((d) => (d.run = run));
  }

  async start(): Promise<void> {
    await this.persistence.load();
    this.applySettings();
    this.resize();
    const run = this.persistence.data.run;
    if (run?.inBattle) {
      // 上次在战斗中关掉了：回到战前，不计这一次（标题页的“继续”下面说明）
      this.leftBattle = true;
      this.setRun(leaveBattle(run));
    }
    if (this.persistence.recovered) this.toast('存档无法读取，已重新开始。');
    if (this.persistence.droppedOldRun) {
      this.toast('游戏已更新为宠物军团玩法：旧版本进行中的一轮无法继续，设置与记录都保留了。');
    }
    this.goTitle();
    requestAnimationFrame(this.loop);
    document.body.dataset.ready = this.persistence.backend.kind;
    if (new URLSearchParams(location.search).get('test') === '1') this.installTestHooks();
  }

  // ------------------------------------------------------------------ 主循环

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    // 战斗进行中与进化演出最多 60 帧，菜单、战前、暂停时 30 帧就够：不跟着高刷新率屏幕把显卡跑满。
    // 按攒下的时间决定这一次刷新画不画（144 赫兹的屏幕上平均也接近 60 帧）。
    const smooth = (this.screen === 'battle' && !this.battle.paused) || this.screen === 'evolve';
    const target = smooth ? 1000 / 60 : 1000 / 30;
    this.view.engine.measure = this.screen === 'battle' && !this.battle.paused;
    const since = this.lastTick ? now - this.lastTick : target;
    this.lastTick = now;
    this.frameBudget = Math.min(this.frameBudget + since, target * 2);
    if (this.frameBudget < target - 1) return;
    this.frameBudget -= target;
    const wall = this.last ? Math.min(0.5, (now - this.last) / 1000) : 1 / 60;
    const dt = Math.min(0.1, wall);
    this.last = now;
    if (FIELD_SCREENS.has(this.screen)) {
      this.battle.update(dt, wall);
      this.view.render(this.battle.paused ? 0 : dt);
      if (this.screen === 'battle') this.tickHud();
    } else {
      this.showcase.update(dt);
      this.showcase.render(this.view.engine, dt);
    }
  };

  private resize(): void {
    this.view.resize(window.innerWidth, window.innerHeight);
  }

  private bindInput(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('blur', () => {
      if (this.screen === 'battle' && this.settings.autoPause && !this.battle.paused) {
        this.pausedByBlur = true;
        this.setPaused(true);
      }
      this.audio.setSuspended(true);
    });
    window.addEventListener('focus', () => {
      this.audio.setSuspended(false);
      if (this.pausedByBlur) {
        this.pausedByBlur = false;
        this.setPaused(false);
      }
    });
    // 第一次点击时才能启动声音
    window.addEventListener('pointerdown', () => this.audio.ensure(), { once: true });
    this.canvas.addEventListener('pointerdown', (e) => this.onCanvasDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onCanvasMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onCanvasUp(e));
    this.canvas.addEventListener('pointercancel', () => (this.drag = null));
  }

  private onKey(e: KeyboardEvent): void {
    // 指引打开时先由它处理按键（这一步提示的按键照常交给游戏）
    if (this.guide.open && !this.modalClose && this.guide.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (this.modalClose) {
        this.modalClose();
        return;
      }
      if (this.screen === 'battle') this.openPauseMenu();
      else if (this.screen === 'prep') this.openPrepMenu();
      else if (this.screen === 'codex') this.goTitle();
      return;
    }
    if (this.modalClose) return;
    if (this.screen === 'prep' && e.key === 'Enter') {
      this.startBattle();
      return;
    }
    if (this.screen === 'reward' && e.key === 'Enter') {
      this.claimReward();
      return;
    }
    if (this.screen === 'battle') {
      if (e.key === ' ') {
        e.preventDefault();
        this.setPaused(!this.battle.paused);
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        this.setSpeed(Number(e.key));
      }
    }
  }

  // ------------------------------------------------------------------ 设置

  private applySettings(): void {
    const s = this.settings;
    this.audio.apply(s);
    this.view.applySettings({
      shake: s.screenShake,
      gentle: s.reduceFlashes,
      numbers: s.damageNumbers,
      cinematics: s.cinematics,
    });
    this.view.engine.pin(s.quality === 'auto' ? null : QUALITY_LEVEL[s.quality]);
  }

  private updateSettings(mutate: (s: Settings) => void): void {
    this.persistence.update((d) => mutate(d.settings));
    this.applySettings();
  }

  seen(part: GuidePart): boolean {
    return this.settings.guideSeen.includes(part);
  }

  markSeen(part: GuidePart | 'all'): void {
    this.updateSettings((s) => {
      s.guideSeen = part === 'all' ? [...GUIDE_PARTS] : [...new Set([...s.guideSeen, part])];
    });
  }

  /** 这一课还要不要教：教学战里看这一场教过没有，平时看存档里学过没有。 */
  private taught(part: GuidePart): boolean {
    return this.practice ? this.practiceTaught.has(part) : this.seen(part);
  }

  /** 学完（或跳过）一课：记进存档；教学战里也记下这一场教过了。 */
  private learned(part: GuidePart | 'all'): void {
    this.markSeen(part);
    if (!this.practice) return;
    for (const p of part === 'all' ? GUIDE_PARTS : [part]) this.practiceTaught.add(p);
  }

  /** 这一课的步骤。 */
  private lessonSteps(part: GuidePart, mode: 'teach' | 'review', ultUnit = 0) {
    const ctx: LessonContext = {
      view: this.view,
      world: () => this.battle.world,
      screen: () => this.screen,
      mode,
      formationMoves: () => this.formationMoves,
      rewardPick: () => this.pick,
    };
    switch (part) {
      case 'prep':
        return prepLesson(ctx);
      case 'battle':
        return battleLesson(ctx);
      case 'echo':
        return echoLesson(ctx, this.echoMoment);
      case 'ult':
        return ultLesson(ctx, ultUnit);
      case 'result':
        return resultLesson();
      case 'reward':
        return rewardLesson(ctx);
    }
  }

  /**
   * 开一课：teach 是第一次教（学过就不再出现，要照做才往下走），review 是点“？”重看。
   * 战斗中打开时战斗停着等，关掉后继续。
   */
  private lesson(part: GuidePart, mode: 'teach' | 'review' = 'teach', ultUnit = 0): void {
    if (mode === 'teach' && this.taught(part)) return;
    if (this.guide.open) return;
    if (this.screen === 'battle' && !this.battle.paused) {
      this.guidePaused = true;
      this.battle.paused = true;
    }
    this.teaching = mode === 'teach' ? part : null;
    this.guide.show({
      label: GUIDE_LABEL[part],
      steps: this.lessonSteps(part, mode, ultUnit),
      mode,
      onDone: () => {
        if (mode === 'teach') this.learned(part);
      },
      onSkip: () => {
        if (mode === 'teach') this.learned('all');
      },
      onClose: () => {
        this.teaching = null;
        if (this.guidePaused) {
          this.guidePaused = false;
          this.battle.paused = false;
        }
      },
    });
    if (!this.guide.open) this.teaching = null;
  }

  /** “？”按钮：重看当前界面的课。 */
  private helpButton(part: GuidePart): HTMLButtonElement {
    return iconButton('help', '重看指引', () => this.lesson(part, 'review'), 'help');
  }

  /** 右上角常驻的“？”（战斗界面放在 HUD 右上角）。 */
  private corner(part: GuidePart): HTMLElement {
    return h('div', { class: 'corner-actions' }, this.helpButton(part)) as HTMLElement;
  }

  // ------------------------------------------------------------------ 画面切换

  private setScreen(screen: Screen): void {
    // 界面切走时正在教的课算学过（照做了“开战”“确认”之类的最后一步也会走到这里）
    if (this.teaching) this.learned(this.teaching);
    this.guide.close();
    this.closeModal();
    this.showcase.zoom = 1;
    if (screen !== 'codex') this.showcase.silhouette(false);
    this.screen = screen;
    this.shell.dataset.screen = screen;
    this.hud = null;
    this.view.engine.resetTiming();
    const music =
      screen === 'battle'
        ? this.run && currentEncounter(this.run).boss
          ? 'boss'
          : 'battle'
        : screen === 'result' && this.resultInfo?.result === 'win'
          ? 'victory'
          : 'menu';
    this.audio.setMusic(music);
  }

  private showcaseColors(e: Element | 'default'): void {
    this.showcase.setColors(NEBULA[e]);
  }

  // ------------------------------------------------------------------ 标题

  goTitle(): void {
    this.practice = false;
    this.practiceRun = null;
    this.battle.stop();
    this.setScreen('title');
    const run = this.persistence.data.run;
    // 展示台：这一轮的伙伴；没有就随机一只人形态
    const partner = run ? partnerOf(run) : undefined;
    const pool = Object.keys(SPECIES) as SpeciesId[];
    const species =
      partner?.species ?? (pool[Math.floor(Math.random() * pool.length)] as SpeciesId);
    const form = partner ? Math.max(partner.form, 3) : 3;
    this.titleForm = `${species}-${form}`;
    this.showcase.show(this.titleForm, 'victory');
    this.showcase.spin = 0.25;
    this.showcase.shift = { x: 0.12, y: 0 };
    this.showcaseColors(SPECIES[species].element);
    const progress = codexProgress(this.persistence.data.codex);
    const electron = !!bridge();
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen title-screen' },
        h(
          'div',
          { class: 'title-logo' },
          h('h1', null, '回声竞技场'),
          h('p', null, '宠物军团 · 五系相克 · 全自动对决'),
        ),
        h(
          'nav',
          { class: 'title-menu' },
          run
            ? button({
                label: `继续征程（第 ${run.matchIndex + 1}/${RUN_LENGTH} 场）`,
                kind: 'primary',
                size: 'big',
                onClick: () => this.continueRun(),
                testId: 'continue',
              })
            : null,
          run
            ? h(
                'p',
                { class: 'resume-note', 'data-testid': 'resume-note' },
                resumeNote(run, this.leftBattle),
              )
            : null,
          button({
            label: '新的征程',
            kind: run ? 'secondary' : 'primary',
            size: 'big',
            onClick: () => this.confirmNewRun(),
            testId: 'new-run',
          }),
          button({
            label: '新手指引',
            icon: 'help',
            title: '进一场教学战，跟着手指从头练一遍（不影响存档）',
            onClick: () => this.startPractice(),
            testId: 'title-guide',
          }),
          button({
            label: `图鉴 ${progress.seen}/${progress.total}`,
            onClick: () => this.goCodex(),
            testId: 'codex',
          }),
          button({ label: '设置', onClick: () => this.openSettings(), testId: 'settings' }),
          electron
            ? button({ label: '退出', kind: 'ghost', onClick: () => void bridge()?.quit() })
            : null,
        ),
        h('div', { class: 'title-foot' }, `通关 ${this.persistence.data.records.runsCompleted} 次`),
      ),
    );
  }

  private confirmNewRun(): void {
    if (!this.persistence.data.run) {
      this.goStarter();
      return;
    }
    this.openModal(
      dialog({
        title: '开始新的征程？',
        body: h('p', null, '当前这一轮的进度会被放弃。'),
        actions: [
          button({ label: '取消', onClick: () => this.closeModal() }),
          button({
            label: '开始新的征程',
            kind: 'danger',
            onClick: () => {
              this.closeModal();
              this.goStarter();
            },
            testId: 'confirm-new-run',
          }),
        ],
        onClose: () => this.closeModal(),
      }),
    );
  }

  private continueRun(): void {
    this.leftBattle = false;
    const run = this.run;
    if (!run) return this.goTitle();
    if (run.phase === 'reward') this.goReward();
    else if (run.phase === 'complete') this.goComplete();
    else this.goPrep();
  }

  /** 标题页的“新手指引”：进一场教学战，在真实界面上从头教一遍，不读写存档里的这一轮。 */
  private startPractice(): void {
    this.audio.ui('start');
    this.practice = true;
    this.practiceRun = createPracticeRun();
    this.practiceTaught = new Set();
    this.goPrep();
  }

  // ------------------------------------------------------------------ 选伙伴

  private goStarter(): void {
    this.leftBattle = false;
    this.practice = false;
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const run = createRun(seed, this.settings.difficulty);
    this.persistence.update((d) => {
      d.run = run;
      d.records.runsStarted++;
      d.codex = mergeCodex(d.codex, codexFromLegion(run.legion));
    });
    this.starterSel = run.starters[0] ?? null;
    this.setScreen('starter');
    this.renderStarter();
  }

  private renderStarter(): void {
    const run = this.run;
    if (!run) return this.goTitle();
    const sel = (this.starterSel ?? run.starters[0]) as SpeciesId;
    const def = SPECIES[sel];
    this.showcase.show(`${sel}-2`, 'idle');
    this.showcase.spin = 0;
    this.showcase.shift = { x: -0.02, y: 0.02 };
    this.showcaseColors(def.element);
    const companions = run.legion.filter((p) => p.uid !== run.partnerUid);
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen starter-screen' },
        h(
          'header',
          { class: 'screen-head' },
          h('h2', null, '选择你的伙伴'),
          h('p', null, '伙伴一开始就是进化形态，会陪你走完整轮征程。'),
        ),
        h(
          'div',
          { class: 'starter-cards' },
          ...run.starters.map((s) =>
            petCard({
              species: s,
              form: 2,
              selected: s === sel,
              onClick: () => {
                this.audio.ui('select');
                this.starterSel = s;
                this.renderStarter();
              },
              testId: `starter-${s}`,
            }),
          ),
        ),
        h(
          'aside',
          { class: 'panel info-panel' },
          h('h3', null, def.names[1], ' ', elementBadge(def.element), ' ', roleTag(def.role)),
          h('p', { class: 'blurb' }, def.blurbs[1]),
          h(
            'div',
            { class: 'evo-path' },
            ...([1, 2, 3] as const).flatMap((f, i) => [
              i > 0 ? h('span', { class: 'evo-arrow' }, '›') : null,
              h(
                'div',
                { class: cx('evo-step', f === 2 && 'on') },
                petImage(`${sel}-${f}`, 64),
                h('span', null, def.names[f - 1]),
              ),
            ]),
          ),
          h('p', { class: 'dim' }, `技能：${def.skill.name}　大招（人形态）：${def.ult.name}`),
          h('h4', null, '同行的伙伴'),
          h(
            'div',
            { class: 'mini-row' },
            ...companions.map((p) =>
              h(
                'div',
                { class: 'mini-pet', title: formName(p.species, p.form) },
                petImage(`${p.species}-${p.form}`, 52),
              ),
            ),
          ),
        ),
        h(
          'footer',
          { class: 'screen-foot' },
          h('span', { class: 'dim' }, '难度'),
          segmented(
            (['easy', 'normal', 'hard'] as Difficulty[]).map((d) => ({
              value: d,
              label: DIFFICULTY_LABEL[d],
            })),
            run.difficulty,
            (d) => {
              this.updateSettings((s) => (s.difficulty = d));
              this.setRun({ ...run, difficulty: d });
              this.renderStarter();
            },
            '难度',
          ),
          button({ label: '返回', kind: 'ghost', onClick: () => this.goTitle() }),
          button({
            label: '出发',
            kind: 'primary',
            size: 'big',
            onClick: () => {
              this.audio.ui('start');
              const cur = this.run;
              if (cur && canChooseStarter(cur)) {
                const next = chooseStarter(cur, sel);
                this.persistence.update((d) => {
                  d.run = next;
                  d.codex = mergeCodex(d.codex, codexFromLegion(next.legion));
                });
              }
              this.goPrep();
            },
            testId: 'depart',
          }),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ 战前准备

  goPrep(): void {
    const run = this.run;
    if (!run) return this.goTitle();
    this.setScreen('prep');
    this.battle.start(battleConfig(run), true);
    this.view.warmup();
    this.renderPrep();
    this.lesson('prep');
  }

  private renderPrep(): void {
    const run = this.run;
    if (!run) return;
    const enc = currentEncounter(run);
    const cap = armyCap(run);
    const foeCounts = new Map<string, { species: SpeciesId; form: Form; n: number }>();
    for (const p of enc.legion) {
      const key = `${p.species}-${p.form}`;
      const cur = foeCounts.get(key);
      if (cur) cur.n++;
      else foeCounts.set(key, { species: p.species, form: p.form, n: 1 });
    }
    const foeElements = [...new Set(enc.legion.map((p) => SPECIES[p.species].element))];
    const good = foeElements.map((e) => counteredBy(e));
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen prep-screen' },
        this.corner('prep'),
        h(
          'header',
          { class: 'prep-head' },
          h(
            'div',
            { class: 'match-tag' },
            this.practice ? '教学战' : `第 ${run.matchIndex + 1} / ${RUN_LENGTH} 场`,
          ),
          h('h2', null, enc.trainer, h('span', { class: 'dim' }, ' 的 '), enc.name),
          h('p', null, enc.intro),
        ),
        h(
          'aside',
          { class: 'panel legion-panel', 'data-guide': 'legion', 'data-testid': 'legion' },
          h('h3', null, '我方军团 ', h('span', { class: 'dim' }, `${run.legion.length}/${cap}`)),
          h(
            'div',
            { class: 'legion-list' },
            ...run.legion.map((p) => {
              const st = formStats(p.species, p.form);
              return h(
                'div',
                {
                  class: cx(
                    'legion-row',
                    `edge-${SPECIES[p.species].element}`,
                    p.uid === run.partnerUid && 'partner',
                  ),
                },
                petImage(`${p.species}-${p.form}`, 48),
                h(
                  'div',
                  { class: 'legion-row-main' },
                  h(
                    'b',
                    null,
                    formName(p.species, p.form),
                    p.uid === run.partnerUid ? h('span', { class: 'partner-tag' }, '伙伴') : null,
                  ),
                  h(
                    'div',
                    { class: 'legion-row-meta' },
                    elementBadge(SPECIES[p.species].element, true),
                    roleTag(SPECIES[p.species].role),
                    formStars(p.form),
                  ),
                ),
                h(
                  'div',
                  { class: 'legion-row-stats' },
                  h('span', null, `生命 ${st.hp}`),
                  h('span', null, `攻击 ${st.atk}`),
                ),
              );
            }),
          ),
        ),
        h(
          'aside',
          { class: 'panel foe-panel', 'data-guide': 'foe', 'data-testid': 'foe' },
          h(
            'h3',
            null,
            '对手军团 ',
            h('span', { class: 'dim' }, `${enc.legion.length + (enc.boss ? 1 : 0)} 只`),
          ),
          enc.boss
            ? h(
                'div',
                { class: 'legion-row edge-fire boss-row' },
                petImage('dragon-1', 48),
                h(
                  'div',
                  { class: 'legion-row-main' },
                  h('b', null, DRAGON.names[0]),
                  h(
                    'div',
                    { class: 'legion-row-meta' },
                    elementBadge('fire', true),
                    roleTag('boss'),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { class: 'foe-grid' },
            ...[...foeCounts.values()].map((f) =>
              h(
                'div',
                {
                  class: cx('foe-chip', `edge-${SPECIES[f.species].element}`),
                  title: formName(f.species, f.form),
                },
                petImage(`${f.species}-${f.form}`, 44),
                f.n > 1 ? h('span', { class: 'foe-n' }, `×${f.n}`) : null,
              ),
            ),
          ),
          h('p', { class: 'counter-tip' }, '克制它们：', ...good.map((e) => elementBadge(e, true))),
        ),
        h(
          'footer',
          { class: 'screen-foot prep-foot' },
          h('span', { class: 'dim hint' }, '拖动场上左侧的我方宠物可以调整站位'),
          button({
            label: '重置站位',
            kind: 'ghost',
            onClick: () => {
              const cur = this.run;
              if (!cur) return;
              this.setRun(resetFormation(cur));
              this.battle.start(battleConfig(this.run as RunState), true);
            },
          }),
          button({ label: '菜单', kind: 'ghost', onClick: () => this.openPrepMenu() }),
          button({
            label: '开战',
            kind: 'primary',
            size: 'big',
            onClick: () => this.startBattle(),
            testId: 'start-battle',
          }),
        ),
      ),
    );
  }

  private openPrepMenu(): void {
    this.openModal(
      dialog({
        title: '菜单',
        body: h(
          'p',
          { class: 'dim' },
          this.practice ? '教学战不会保存进度。' : '进度已自动保存在这一场的战前。',
        ),
        actions: [
          button({ label: '设置', onClick: () => this.openSettings() }),
          button({ label: '回到标题', onClick: () => this.goTitle() }),
          this.practice
            ? button({ label: '继续', kind: 'primary', onClick: () => this.closeModal() })
            : button({ label: '放弃这一轮', kind: 'danger', onClick: () => this.confirmAbandon() }),
        ],
        onClose: () => this.closeModal(),
      }),
    );
  }

  private confirmAbandon(): void {
    this.openModal(
      dialog({
        title: '放弃这一轮？',
        body: h('p', null, '军团和进度都会清空，图鉴会保留。'),
        actions: [
          button({ label: '取消', onClick: () => this.closeModal() }),
          button({
            label: '放弃',
            kind: 'danger',
            onClick: () => {
              this.setRun(null);
              this.goTitle();
            },
            testId: 'confirm-abandon',
          }),
        ],
        onClose: () => this.closeModal(),
      }),
    );
  }

  // 拖动站位（只在战前）
  private onCanvasDown(e: PointerEvent): void {
    this.audio.ensure();
    if (this.screen === 'prep') {
      const id = this.view.pick(e.clientX, e.clientY, 0);
      const u = id ? this.battle.world?.unitById(id) : undefined;
      if (u && u.uid) {
        this.drag = { id, uid: u.uid, pointer: e.pointerId };
        this.canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (this.screen === 'battle') {
      const w = this.battle.world;
      const before = w?.focusId ?? 0;
      const id = this.battle.click(e.clientX, e.clientY);
      if (id && w) this.audio.ui(w.focusId && w.focusId !== before ? 'focus' : 'unfocus');
    }
  }

  private onCanvasMove(e: PointerEvent): void {
    if (this.screen === 'battle') {
      this.battle.hover(e.clientX, e.clientY);
      this.canvas.style.cursor = this.view.hoverId ? 'crosshair' : '';
      return;
    }
    if (this.screen !== 'prep') return;
    if (!this.drag) {
      const id = this.view.pick(e.clientX, e.clientY, 0);
      this.canvas.style.cursor = id ? 'grab' : '';
      return;
    }
    const g = this.view.groundAt(e.clientX, e.clientY);
    const u = this.battle.world?.unitById(this.drag.id);
    if (!g || !u) return;
    const p = clampToPlayerZone(g, u.radius);
    u.x = u.px = p.x;
    u.y = u.py = p.y;
    this.canvas.style.cursor = 'grabbing';
  }

  private onCanvasUp(_e: PointerEvent): void {
    if (!this.drag) return;
    const u = this.battle.world?.unitById(this.drag.id);
    const run = this.run;
    const uid = this.drag.uid;
    this.drag = null;
    this.canvas.style.cursor = '';
    if (!u || !run) return;
    this.setRun(setFormation(run, { [uid]: { x: u.x, y: u.y } }));
    this.formationMoves++;
  }

  // ------------------------------------------------------------------ 战斗

  private startBattle(): void {
    const run = this.run;
    if (!run) return;
    this.audio.ui('start');
    const next = beginBattle(run);
    this.setRun(next);
    this.resultInfo = null;
    this.setScreen('battle');
    this.battle.start(battleConfig(next));
    this.battle.speed = 1;
    this.renderBattleHud();
    this.lesson('battle');
  }

  private renderBattleHud(): void {
    const run = this.run;
    const w = this.battle.world;
    if (!run || !w) return;
    const enc = currentEncounter(run);
    const chips = new Map<
      number,
      { root: HTMLElement; hp: HTMLElement; energy: HTMLElement | null }
    >();
    const strip = h('div', {
      class: 'legion-strip',
      'data-guide': 'strip',
      'data-testid': 'strip',
    }) as HTMLElement;
    for (const u of w.units.filter((x) => x.team === 0 && x.uid)) {
      const hp = h('i', { class: 'bar-fill' }) as HTMLElement;
      const energy = u.energy >= 0 ? (h('i', { class: 'bar-fill' }) as HTMLElement) : null;
      const root = h(
        'div',
        { class: cx('chip', `edge-${u.element}`), title: u.name },
        petImage(`${u.species}-${u.form}`, 46),
        h(
          'div',
          { class: 'chip-bars' },
          h('div', { class: 'bar hp' }, hp),
          energy ? h('div', { class: 'bar energy' }, energy) : null,
        ),
      ) as HTMLElement;
      strip.appendChild(root);
      chips.set(u.id, { root, hp, energy });
    }
    const time = h('div', { class: 'hud-time', 'data-testid': 'time' }, '0:00') as HTMLElement;
    const focus = h('div', { class: 'hud-focus', 'data-testid': 'focus' }) as HTMLElement;
    const foes = h('div', { class: 'foe-count' }) as HTMLElement;
    const overtime = h('div', { class: 'overtime-banner' }, '加时：伤害逐步提高') as HTMLElement;
    const speed = h('div', { class: 'hud-speed', 'data-guide': 'speed' }) as HTMLElement;
    const pause = iconButton('pause', '暂停（空格）', () => this.openPauseMenu(), 'pause');
    const banner = h('div', { class: 'pause-banner', 'data-testid': 'banner' }) as HTMLElement;
    this.hud = { time, focus, foes, overtime, chips, speed, pause, banner };
    this.renderSpeed();
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen battle-screen', 'data-testid': 'battle-hud' },
        h(
          'div',
          { class: 'hud-top' },
          h(
            'div',
            { class: 'hud-match' },
            h(
              'span',
              { class: 'match-tag' },
              this.practice ? '教学战' : `${run.matchIndex + 1}/${RUN_LENGTH}`,
            ),
            h('b', null, enc.trainer),
            h('span', { class: 'dim' }, enc.name),
          ),
          h('div', { class: 'hud-center' }, time, focus),
          h('div', { class: 'hud-actions' }, this.helpButton('battle'), speed, pause),
        ),
        overtime,
        banner,
        h('div', { class: 'hud-bottom' }, strip, foes),
      ),
    );
  }

  private renderSpeed(): void {
    if (!this.hud) return;
    mount(
      this.hud.speed,
      segmented(
        [1, 2, 3].map((n) => ({ value: String(n), label: `${n}×` })),
        String(this.battle.speed),
        (v) => this.setSpeed(Number(v)),
        '倍速',
      ),
    );
  }

  private setSpeed(n: number): void {
    this.battle.speed = Math.max(1, Math.min(3, n));
    this.renderSpeed();
    this.audio.ui('click');
  }

  private setPaused(paused: boolean): void {
    this.battle.paused = paused;
    this.audio.setDucked(paused);
    if (paused) this.audio.ui('pause');
  }

  private tickHud(): void {
    const hud = this.hud;
    const w = this.battle.world;
    if (!hud || !w) return;
    hud.time.textContent = formatTime(w.t);
    for (const [id, chip] of hud.chips) {
      const u = w.unitById(id);
      if (!u) continue;
      chip.hp.style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
      if (chip.energy) {
        chip.energy.style.width = `${Math.max(0, u.energy)}%`;
        chip.root.classList.toggle('ready', u.energy >= 100 && u.alive);
      }
      chip.root.classList.toggle('dead', !u.alive);
    }
    const focus = w.focusId ? w.unitById(w.focusId) : undefined;
    const text = focus && focus.alive ? `集火：${focus.name}` : '点击敌人设为集火目标';
    if (hud.focus.textContent !== text) {
      hud.focus.textContent = text;
      hud.focus.classList.toggle('on', !!focus && focus.alive);
    }
    const alive = w.units.filter((u) => u.team === 1 && u.alive).length;
    const foesText = `敌方剩余 ${alive}`;
    if (hud.foes.textContent !== foesText) hud.foes.textContent = foesText;
    hud.overtime.classList.toggle('on', w.overtimeLevel > 0);
    // 指引和暂停菜单自己会说明；只有空格暂停、失焦自动暂停时在画面中间提示
    const paused = this.battle.paused && !this.guide.open && !this.modalClose;
    const bannerText = this.pausedByBlur ? '窗口失去焦点，已自动暂停' : '已暂停 · 按空格继续';
    if (hud.banner.textContent !== bannerText) hud.banner.textContent = bannerText;
    hud.banner.classList.toggle('on', paused);
  }

  private openPauseMenu(): void {
    if (this.screen !== 'battle' || this.battle.ended) return;
    const wasPaused = this.battle.paused;
    this.setPaused(true);
    const resume = () => {
      this.closeModal();
      if (!wasPaused) this.setPaused(false);
    };
    this.openModal(
      dialog({
        title: '暂停',
        body: h('p', { class: 'dim' }, '空格键暂停 / 继续，1、2、3 切换倍速。'),
        actions: [
          button({ label: '设置', onClick: () => this.openSettings(() => this.openPauseMenu()) }),
          button({ label: '回到战前', onClick: () => this.backToPrep(), testId: 'back-to-prep' }),
          button({ label: '继续', kind: 'primary', onClick: resume, testId: 'resume' }),
        ],
        onClose: resume,
        testId: 'pause-menu',
      }),
    );
  }

  private backToPrep(): void {
    const run = this.run;
    if (run) this.setRun(leaveBattle(run));
    this.goPrep();
  }

  private onBattleEvents(events: readonly SimEvent[], world: World): void {
    this.audio.events(events, 0);
    for (const e of events) {
      if (e.type === 'ult') {
        const u = world.unitById(e.unitId);
        if (u && this.settings.cinematics) this.audio.ult(u.element);
        if (u?.team === 0 && !this.taught('ult')) this.lesson('ult', 'teach', u.id);
      } else if (e.type === 'echo' && e.level >= 2 && !this.taught('echo')) {
        this.echoMoment = { x: e.x, y: e.y, level: e.level };
        this.lesson('echo');
      }
    }
  }

  private onBattleEnd(result: 'win' | 'lose', world: World): void {
    const run = this.run;
    if (!run) return;
    this.audio.ui(result === 'win' ? 'win' : 'lose');
    const summary = summarizeBattle(world.stats, { enemyHpLeft: world.enemyHpRemainingRatio() });
    const next = finishBattle(run, world.stats);
    if (!this.practice) {
      this.persistence.update((d) => {
        d.run = next;
        d.codex = mergeCodex(d.codex, [...codexFromWorld(world), ...codexFromLegion(next.legion)]);
        d.records.bestEcho = Math.max(d.records.bestEcho, world.stats.maxEcho);
      }, true);
    } else {
      this.practiceRun = next;
    }
    this.resultInfo = { result, summary, world };
    this.setScreen('result');
    this.renderResult();
    this.lesson('result');
  }

  // ------------------------------------------------------------------ 结算

  private renderResult(): void {
    const info = this.resultInfo;
    const run = this.run;
    if (!info || !run) return;
    const win = info.result === 'win';
    const mvp = info.summary.mvpUid
      ? run.legion.find((p) => p.uid === info.summary.mvpUid)
      : undefined;
    const mvpDamage = info.summary.mvpUid
      ? Math.round(info.world.stats.damageByUid[info.summary.mvpUid] ?? 0)
      : 0;
    const actions: HTMLButtonElement[] = [];
    if (win) {
      if (run.phase === 'complete') {
        actions.push(
          button({
            label: '查看通关结算',
            kind: 'primary',
            onClick: () => this.goComplete(),
            testId: 'to-complete',
          }),
        );
      } else {
        actions.push(
          button({
            label: '领取奖励',
            kind: 'primary',
            onClick: () => this.goReward(),
            testId: 'to-reward',
          }),
        );
      }
    } else {
      actions.push(
        button({ label: '回到战前调整', onClick: () => this.goPrep(), testId: 'retry-prep' }),
      );
      actions.push(
        button({
          label: '再战一次',
          kind: 'primary',
          onClick: () => this.startBattle(),
          testId: 'retry',
        }),
      );
    }
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen result-screen' },
        this.corner('result'),
        h(
          'div',
          {
            class: cx('panel result-card', win ? 'win' : 'lose'),
            'data-guide': 'result',
            'data-testid': 'result',
          },
          h('h2', { class: 'result-title' }, win ? '胜利！' : '惜败'),
          h('div', { class: 'result-time' }, `用时 ${info.summary.time}`),
          mvp
            ? h(
                'div',
                { class: 'mvp' },
                petImage(`${mvp.species}-${mvp.form}`, 72),
                h(
                  'div',
                  null,
                  h('div', { class: 'mvp-tag' }, 'MVP'),
                  h('b', null, formName(mvp.species, mvp.form)),
                  h('div', { class: 'dim' }, `造成 ${mvpDamage} 点伤害`),
                ),
              )
            : null,
          h(
            'ul',
            { class: 'insights' },
            ...info.summary.lines.map((l) => h('li', { class: `ins ins-${l.icon}` }, l.text)),
          ),
          h('div', { class: 'result-actions' }, ...actions),
        ),
      ),
    );
  }

  /** 教学战挑完奖励：回到标题，说明学会了什么，可以接着开始正式一轮。 */
  private finishPractice(): void {
    this.goTitle();
    const run = this.persistence.data.run;
    this.openModal(
      dialog({
        title: '教学战完成！',
        testId: 'practice-done',
        body: h(
          'div',
          null,
          h('p', null, '学会了这些：'),
          h(
            'ul',
            { class: 'learned' },
            h('li', null, '战前看对手的属性，拖动宠物摆好站位'),
            h('li', null, '开战后全自动：点敌人集火，空格暂停，右上角加速'),
            h('li', null, '击飞的单位撞上别的单位或结界会产生回响，连锁越长伤害越高'),
            h('li', null, '人形态宠物攒满能量自动放大招'),
            h('li', null, '赢了收服新宠物、让宠物进化'),
          ),
        ),
        actions: [
          button({ label: '回到标题', onClick: () => this.closeModal(), testId: 'practice-title' }),
          button({
            label: run ? '继续我的这一轮' : '开始正式一轮',
            kind: 'primary',
            onClick: () => {
              this.closeModal();
              if (run) this.continueRun();
              else this.goStarter();
            },
            testId: 'practice-play',
          }),
        ],
        onClose: () => this.closeModal(),
      }),
    );
  }

  // ------------------------------------------------------------------ 奖励与进化

  private goReward(): void {
    const run = this.run;
    if (!run || run.phase !== 'reward' || !run.rewards) return this.continueRun();
    this.battle.stop();
    this.pick = {};
    this.setScreen('reward');
    this.renderReward();
    this.lesson('reward');
  }

  private renderReward(): void {
    const run = this.run;
    const offer = run?.rewards;
    if (!run || !offer) return;
    // 展示台：选中的那只（收服候选或进化后的样子）
    const showId =
      this.pick.evolve !== undefined
        ? `${offer.evolve[this.pick.evolve]?.species}-${offer.evolve[this.pick.evolve]?.to}`
        : this.pick.capture !== undefined
          ? `${offer.capture[this.pick.capture]?.species}-${offer.capture[this.pick.capture]?.form}`
          : `${partnerOf(run)?.species ?? 'fox'}-${partnerOf(run)?.form ?? 2}`;
    this.showcase.show(showId, 'idle');
    this.showcase.spin = 0.2;
    // 模型放在标题和下面两排卡片之间：拉远一些，免得头顶压到说明文字
    this.showcase.shift = { x: 0, y: -0.15 };
    this.showcase.zoom = 1.75;
    this.showcaseColors(elementOf(showId.split('-')[0] as SpeciesId));
    const cap = armyCap(run, run.matchIndex + 1);
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen reward-screen' },
        this.corner('reward'),
        h(
          'header',
          { class: 'screen-head' },
          h('h2', null, '胜利奖励'),
          h('p', null, '收服与进化各选一个，两项都会生效（也可以不选）。'),
        ),
        h(
          'div',
          { class: 'reward-rows', 'data-guide': 'rewards' },
          h(
            'section',
            {
              class: 'panel reward-row',
              'data-guide': offer.capture.length ? 'capture' : undefined,
            },
            h(
              'h3',
              null,
              '收服 ',
              h('span', { class: 'dim' }, `军团 ${run.legion.length} → 上限 ${cap}`),
            ),
            offer.capture.length === 0
              ? h('p', { class: 'dim' }, '军团已满，这次不能收服。')
              : h(
                  'div',
                  { class: 'reward-cards' },
                  ...offer.capture.map((c, i) =>
                    petCard({
                      species: c.species,
                      form: c.form,
                      selected: this.pick.capture === i,
                      badge: c.form >= 2 ? '进化形态' : null,
                      onClick: () => {
                        this.audio.ui('select');
                        this.pick = {
                          ...this.pick,
                          capture: this.pick.capture === i ? undefined : i,
                        };
                        this.renderReward();
                      },
                      testId: `capture-${i}`,
                    }),
                  ),
                ),
          ),
          h(
            'section',
            {
              class: 'panel reward-row',
              'data-guide': offer.evolve.length ? 'evolve' : undefined,
            },
            h('h3', null, '进化'),
            offer.evolve.length === 0
              ? h('p', { class: 'dim' }, '暂时没有可以进化的宠物。')
              : h(
                  'div',
                  { class: 'reward-cards' },
                  ...offer.evolve.map((v, i) =>
                    petCard({
                      species: v.species,
                      form: v.to,
                      selected: this.pick.evolve === i,
                      badge: v.to === 3 ? '→ 人形态' : '→ 进化',
                      extra: h(
                        'div',
                        { class: 'evo-from' },
                        `由 ${formName(v.species, v.from)} 进化`,
                      ),
                      onClick: () => {
                        this.audio.ui('select');
                        this.pick = {
                          ...this.pick,
                          evolve: this.pick.evolve === i ? undefined : i,
                        };
                        this.renderReward();
                      },
                      testId: `evolve-${i}`,
                    }),
                  ),
                ),
          ),
        ),
        h(
          'footer',
          { class: 'screen-foot' },
          button({
            label: '确认',
            kind: 'primary',
            size: 'big',
            onClick: () => this.claimReward(),
            testId: 'claim',
          }),
        ),
      ),
    );
  }

  private claimReward(): void {
    const run = this.run;
    const offer = run?.rewards;
    if (!run || !offer) return;
    const evolve = this.pick.evolve !== undefined ? offer.evolve[this.pick.evolve] : undefined;
    if (this.pick.capture !== undefined) this.audio.ui('capture');
    const next = pickReward(run, this.pick);
    if (this.practice) {
      this.practiceRun = next;
    } else {
      this.persistence.update((d) => {
        d.run = next;
        d.codex = mergeCodex(d.codex, codexFromLegion(next.legion));
      }, true);
    }
    // 教学战挑完奖励就结束；正式一轮进入下一场的战前准备
    const after = () => (this.practice ? this.finishPractice() : this.goPrep());
    if (evolve) this.playEvolution(evolve.species, evolve.from, evolve.to, after);
    else after();
  }

  /** 进化演出：旧形态汇聚光点、发白旋转，光柱里换成新形态。 */
  private playEvolution(species: SpeciesId, from: Form, to: Form, done: () => void): void {
    this.setScreen('evolve');
    const e = SPECIES[species].element;
    this.showcaseColors(e);
    this.showcase.spin = 0;
    this.showcase.shift = { x: 0, y: 0.04 };
    this.showcase.show(`${species}-${from}`, 'idle');
    const caption = h(
      'div',
      { class: 'evolve-caption' },
      h('b', null, formName(species, from)),
      ' 的样子起了变化……',
    ) as HTMLElement;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    this.audio.ui('evolveCharge');
    this.showcase.startEvolution(`${species}-${to}`, ELEMENT_CSS[e], {
      onSwap: () => {
        this.audio.ui('evolveBurst');
        mount(
          caption,
          h('b', null, formName(species, from)),
          ' 进化成了 ',
          h('b', { class: 'hl' }, formName(species, to)),
          '！',
        );
        caption.classList.add('done');
      },
      onDone: () => {
        mount(
          this.ui.querySelector('.evolve-actions') as HTMLElement,
          button({
            label: '继续',
            kind: 'primary',
            size: 'big',
            onClick: finish,
            testId: 'evolve-done',
          }),
        );
      },
    });
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen evolve-screen', 'data-testid': 'evolve' },
        caption,
        h('div', { class: 'evolve-info' }, to === 3 ? '进化到人形态：获得大招！' : ''),
        h(
          'div',
          { class: 'evolve-actions' },
          button({
            label: '跳过',
            kind: 'ghost',
            onClick: () => this.showcase.skip(),
            testId: 'evolve-skip',
          }),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ 通关

  private goComplete(): void {
    const run = this.run;
    if (!run) return this.goTitle();
    this.battle.stop();
    this.setScreen('complete');
    const sum = summarizeRun(run);
    const partner = partnerOf(run);
    if (partner) {
      this.showcase.show(`${partner.species}-${partner.form}`, 'victory');
      this.showcaseColors(SPECIES[partner.species].element);
    }
    this.showcase.spin = 0.3;
    this.showcase.shift = { x: -0.2, y: 0 };
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen complete-screen' },
        h(
          'div',
          { class: 'panel complete-card', 'data-testid': 'complete' },
          h('h2', null, '征程完成！'),
          h(
            'p',
            { class: 'dim' },
            `难度 ${DIFFICULTY_LABEL[run.difficulty]} · 战斗用时 ${sum.time} · 重试 ${sum.retries} 次 · 最高回响 ${sum.bestEcho} 级`,
          ),
          h('h4', null, '扛起这一轮的宠物'),
          h(
            'div',
            { class: 'top-pets' },
            ...sum.topPets.map((p) => {
              const pet = run.legion.find((x) => x.uid === p.uid);
              return h(
                'div',
                { class: 'top-pet' },
                pet ? petImage(`${pet.species}-${pet.form}`, 72) : null,
                h('b', null, p.name),
                h('span', { class: 'dim' }, `${Math.round(p.share * 100)}%`),
              );
            }),
          ),
          h('h4', null, '最有用的招式'),
          h(
            'ul',
            { class: 'insights' },
            ...sum.topSkills.map((s) => h('li', null, `${s.name} · ${Math.round(s.share * 100)}%`)),
          ),
          h('h4', null, '最终军团'),
          h(
            'div',
            { class: 'mini-row' },
            ...run.legion.map((p) =>
              h(
                'div',
                { class: 'mini-pet', title: formName(p.species, p.form) },
                petImage(`${p.species}-${p.form}`, 52),
              ),
            ),
          ),
          h(
            'div',
            { class: 'result-actions' },
            button({
              label: '回到标题',
              kind: 'primary',
              onClick: () => this.closeRun(),
              testId: 'close-run',
            }),
          ),
        ),
      ),
    );
  }

  private closeRun(): void {
    const run = this.run;
    if (run && !this.practice) {
      this.persistence.update((d) => {
        d.records.runsCompleted++;
        d.records.fastestClear =
          d.records.fastestClear === null
            ? run.battleTime
            : Math.min(d.records.fastestClear, run.battleTime);
        if (!d.records.clearedDifficulties.includes(run.difficulty))
          d.records.clearedDifficulties.push(run.difficulty);
        d.run = null;
      }, true);
    }
    this.goTitle();
  }

  // ------------------------------------------------------------------ 图鉴

  private goCodex(): void {
    this.setScreen('codex');
    if (!this.codexSel) this.codexSel = ALL_FORM_IDS[0] as string;
    this.renderCodex();
  }

  private renderCodex(): void {
    const seen = new Set(this.persistence.data.codex);
    const sel = this.codexSel;
    const [sp, formText] = sel.split('-') as [string, string];
    const form = Number(formText);
    const known = seen.has(sel);
    this.showcase.show(sel, 'idle');
    this.showcase.spin = 0.35;
    this.showcase.shift = { x: -0.02, y: 0.02 };
    this.showcase.silhouette(!known);
    this.showcaseColors(known ? elementOf(sp as SpeciesId) : 'default');
    const progress = codexProgress(this.persistence.data.codex);
    const rows = [...Object.keys(SPECIES), 'dragon'];
    const info = (() => {
      if (!known)
        return h(
          'div',
          null,
          h('h3', null, '？？？'),
          h('p', { class: 'dim' }, '还没见过这个形态。在战斗里遇到或收服、进化出来就会记录。'),
        );
      if (sp === 'dragon') {
        return h(
          'div',
          null,
          h(
            'h3',
            null,
            DRAGON.names[form - 1] as string,
            ' ',
            elementBadge('fire'),
            ' ',
            roleTag('boss'),
          ),
          h('p', { class: 'blurb' }, DRAGON.blurbs[form - 1] as string),
        );
      }
      const def = SPECIES[sp as SpeciesId];
      const st = formStats(sp as SpeciesId, form as Form);
      return h(
        'div',
        null,
        h(
          'h3',
          null,
          def.names[form - 1] as string,
          ' ',
          elementBadge(def.element),
          ' ',
          roleTag(def.role),
        ),
        h('div', { class: 'dim' }, `${FORM_NAME[form as Form]} · 第 ${form} 阶`),
        h('p', { class: 'blurb' }, def.blurbs[form - 1] as string),
        h(
          'div',
          { class: 'stat-grid' },
          h('span', null, `生命 ${st.hp}`),
          h('span', null, `攻击 ${st.atk}`),
          h('span', null, `攻速 ${st.interval}s`),
          h('span', null, `速度 ${st.speed}`),
        ),
        h(
          'p',
          { class: 'dim' },
          `技能：${skillName(def.skill.id)}${form === 3 ? `　大招：${skillName(def.ult.id)}` : ''}`,
        ),
      );
    })();
    mount(
      this.ui,
      h(
        'div',
        { class: 'screen codex-screen' },
        h(
          'header',
          { class: 'screen-head' },
          h(
            'h2',
            null,
            '图鉴 ',
            h('span', { class: 'dim' }, `${progress.seen} / ${progress.total}`),
          ),
          button({
            label: '返回',
            kind: 'ghost',
            onClick: () => this.goTitle(),
            testId: 'codex-back',
          }),
        ),
        h(
          'div',
          { class: 'panel codex-grid', 'data-testid': 'codex-grid' },
          ...rows.map((s) =>
            h(
              'div',
              { class: 'codex-row' },
              ...(s === 'dragon' ? [1, 2] : [1, 2, 3]).map((f) => {
                const id = `${s}-${f}`;
                const has = seen.has(id);
                return h(
                  'button',
                  {
                    type: 'button',
                    class: cx('codex-cell', id === sel && 'selected', !has && 'unknown'),
                    title: has ? formName(s as SpeciesId, f) : '？？？',
                    'data-testid': `codex-${id}`,
                    onClick: () => {
                      this.codexSel = id;
                      this.audio.ui('select');
                      this.renderCodex();
                    },
                  },
                  petImage(id, 56, 'bust', !has),
                );
              }),
            ),
          ),
        ),
        h('aside', { class: 'panel info-panel codex-info' }, info),
      ),
    );
  }

  // ------------------------------------------------------------------ 设置与弹窗

  private openSettings(after?: () => void): void {
    const s = this.settings;
    const close = () => {
      this.closeModal();
      after?.();
    };
    const api = bridge();
    this.openModal(
      dialog({
        title: '设置',
        wide: true,
        testId: 'settings-dialog',
        body: h(
          'div',
          { class: 'settings-grid' },
          h(
            'section',
            null,
            h('h4', null, '声音'),
            slider('总音量', s.masterVolume, (v) =>
              this.updateSettings((x) => (x.masterVolume = v)),
            ),
            slider('音效', s.sfxVolume, (v) => this.updateSettings((x) => (x.sfxVolume = v))),
            slider('音乐', s.musicVolume, (v) => this.updateSettings((x) => (x.musicVolume = v))),
            toggle('静音', s.muted, (v) => this.updateSettings((x) => (x.muted = v))),
          ),
          h(
            'section',
            null,
            h('h4', null, '画面'),
            toggle(
              '技能与大招特写',
              s.cinematics,
              (v) => this.updateSettings((x) => (x.cinematics = v)),
              '放技能时镜头推近，大招有两段特写',
            ),
            toggle('震屏', s.screenShake, (v) => this.updateSettings((x) => (x.screenShake = v))),
            toggle(
              '减少闪烁',
              s.reduceFlashes,
              (v) => this.updateSettings((x) => (x.reduceFlashes = v)),
              '不闪白、光效减弱',
            ),
            toggle('伤害数字', s.damageNumbers, (v) =>
              this.updateSettings((x) => (x.damageNumbers = v)),
            ),
            h(
              'div',
              { class: 'field' },
              h('span', { class: 'field-label' }, '画质'),
              segmented(
                (['auto', 'high', 'medium', 'low'] as Quality[]).map((q) => ({
                  value: q,
                  label: { auto: '自动', high: '高', medium: '中', low: '低' }[q],
                })),
                s.quality,
                (q) => {
                  this.updateSettings((x) => (x.quality = q));
                  this.openSettings(after);
                },
                '画质',
              ),
            ),
          ),
          h(
            'section',
            null,
            h('h4', null, '其他'),
            toggle('窗口失去焦点时暂停', s.autoPause, (v) =>
              this.updateSettings((x) => (x.autoPause = v)),
            ),
            h(
              'div',
              { class: 'field' },
              h('span', { class: 'field-label' }, '新一轮的难度'),
              segmented(
                (['easy', 'normal', 'hard'] as Difficulty[]).map((d) => ({
                  value: d,
                  label: DIFFICULTY_LABEL[d],
                })),
                s.difficulty,
                (d) => {
                  this.updateSettings((x) => (x.difficulty = d));
                  this.openSettings(after);
                },
                '难度',
              ),
            ),
            h(
              'div',
              { class: 'settings-buttons' },
              button({
                label: '重新显示新手指引',
                size: 'small',
                onClick: () => {
                  this.updateSettings((x) => (x.guideSeen = []));
                  this.toast('新手指引会在对应情形再出现一次。');
                },
              }),
              button({
                label: '清除全部存档',
                size: 'small',
                kind: 'danger',
                onClick: () => this.confirmResetAll(after),
                testId: 'reset-all',
              }),
              api
                ? button({
                    label: '打开存档文件夹',
                    size: 'small',
                    onClick: () => void api.openDataDir(),
                  })
                : null,
              api
                ? button({
                    label: '全屏 / 窗口',
                    size: 'small',
                    onClick: () => void api.toggleFullscreen(),
                  })
                : null,
            ),
          ),
        ),
        actions: [
          button({ label: '完成', kind: 'primary', onClick: close, testId: 'settings-done' }),
        ],
        onClose: close,
      }),
    );
  }

  private confirmResetAll(after?: () => void): void {
    this.openModal(
      dialog({
        title: '清除全部存档？',
        body: h(
          'p',
          null,
          '会清除当前进度、设置、图鉴和长期记录，回到第一次打开的状态。原存档会改名为备份保留一次，以防误操作。',
        ),
        actions: [
          button({ label: '取消', onClick: () => this.openSettings(after) }),
          button({
            label: '清除',
            kind: 'danger',
            onClick: () => void this.resetAll(),
            testId: 'confirm-reset',
          }),
        ],
        onClose: () => this.openSettings(after),
      }),
    );
  }

  private async resetAll(): Promise<void> {
    this.closeModal();
    this.battle.stop();
    this.practice = false;
    this.practiceRun = null;
    await this.persistence.reset();
    this.applySettings();
    this.toast('已清除全部存档');
    this.goTitle();
  }

  private openModal(node: HTMLElement): void {
    mount(this.modalLayer, node);
    this.modalLayer.classList.add('on');
    const close = (node.querySelector('.modal-head .icon-btn') as HTMLElement | null) ?? null;
    this.modalClose = () => {
      if (close) close.click();
      else this.closeModal();
    };
    this.audio.setDucked(true);
  }

  private closeModal(): void {
    this.modalLayer.replaceChildren();
    this.modalLayer.classList.remove('on');
    this.modalClose = null;
    if (!this.battle.paused) this.audio.setDucked(false);
  }

  toast(text: string): void {
    const t = h(
      'div',
      { class: 'toast' },
      uiIcon('info', 18),
      h('span', null, text),
    ) as HTMLElement;
    this.toastLayer.appendChild(t);
    window.setTimeout(() => t.classList.add('out'), 3200);
    window.setTimeout(() => t.remove(), 3800);
  }

  // ------------------------------------------------------------------ 测试钩子

  private installTestHooks(): void {
    const hooks = {
      screen: () => this.screen,
      state: () => {
        const run = this.run;
        const w = this.battle.world;
        return {
          screen: this.screen,
          practice: this.practice,
          run: run
            ? {
                matchIndex: run.matchIndex,
                phase: run.phase,
                inBattle: run.inBattle,
                difficulty: run.difficulty,
                attempts: run.records.map((r) => r.attempts),
                legion: run.legion.map((p) => ({
                  uid: p.uid,
                  species: p.species,
                  form: p.form,
                  x: p.x,
                  y: p.y,
                })),
                rewards: run.rewards,
              }
            : null,
          battle: w
            ? {
                t: w.t,
                result: w.result,
                focusId: w.focusId,
                paused: this.battle.paused,
                ended: this.battle.ended,
              }
            : null,
          codex: [...this.persistence.data.codex],
          settings: { ...this.settings },
        };
      },
      /** 新开一轮直接到战前（可指定种子与伙伴）。 */
      newRun: (o: { seed?: number; difficulty?: Difficulty; starter?: SpeciesId } = {}) => {
        this.practice = false;
        let run = createRun(o.seed ?? 12345, o.difficulty ?? 'normal');
        if (o.starter) run = chooseStarter(run, o.starter);
        this.persistence.update((d) => {
          d.run = run;
          d.codex = mergeCodex(d.codex, codexFromLegion(run.legion));
        });
        this.goPrep();
      },
      /** 改这一轮：跳到第几场、换军团。 */
      patchRun: (o: {
        matchIndex?: number;
        legion?: Array<{ species: SpeciesId; form: Form }>;
      }) => {
        const run = this.run;
        if (!run) return;
        const legion = o.legion
          ? resetFormation({
              ...run,
              legion: o.legion.map((p, i) => ({
                uid: i + 1,
                species: p.species,
                form: p.form,
                x: 0,
                y: 0,
              })),
            }).legion
          : run.legion;
        this.setRun({
          ...run,
          matchIndex: o.matchIndex ?? run.matchIndex,
          legion,
          nextUid: legion.length + 1,
          partnerUid: 1,
          phase: 'prep',
          rewards: null,
        });
        this.goPrep();
      },
      startBattle: () => this.startBattle(),
      hold: (on: boolean) => {
        this.battle.hold = on;
      },
      speed: (n: number) => this.setSpeed(n),
      fastForward: (seconds: number, quiet = false) => this.battle.fastForward(seconds, quiet),
      units: () => {
        const w = this.battle.world;
        if (!w) return [];
        return w.units.map((u) => {
          const s = this.view.unitScreen(u.id);
          return {
            id: u.id,
            uid: u.uid,
            team: u.team,
            species: u.species,
            form: u.form,
            alive: u.alive,
            hp: u.hp,
            screen: s,
          };
        });
      },
      focus: (id: number) => this.battle.world?.setFocus(id),
      fxStats: () => this.view.stats(),
      guide: () => this.guide.open,
    };
    (window as unknown as { __echo: unknown }).__echo = hooks;
  }
}

/** 标题页说明从哪里继续。 */
function resumeNote(run: RunState, leftBattle: boolean): string {
  if (run.phase === 'reward') return '上一场赢了，奖励还没领。';
  if (run.phase === 'complete') return '这一轮已经打完，可以查看通关结算。';
  if (leftBattle) return '上次在战斗中离开，会回到这一场的战前准备。';
  return '从这一场的战前准备继续。';
}
