// 应用外壳：布局、标题画面、设置与弹窗、键盘与窗口事件、主循环。
import { AudioEngine } from '../audio/audio.js';
import { encounterById } from '../core/content/encounters.js';
import { autoEquip, emptyLoadout } from '../core/run/loadout.js';
import {
  createRun,
  currentEncounter,
  defaultFormation,
  ensureGadgets,
  RUN_LENGTH,
} from '../core/run/run.js';
import { defaultSettings, type Settings } from '../core/run/save.js';
import type { BattleConfig } from '../core/sim/world.js';
import type { Difficulty, ModuleId, ModuleLevel } from '../core/types.js';
import { ArenaController } from '../game/arena.js';
import { autoCast } from '../game/director.js';
import { Persistence } from '../game/persistence.js';
import { bridge } from '../platform/storage.js';
import { Renderer } from '../render/renderer.js';
import { View } from '../render/view.js';
import { h, mount } from './dom.js';
import { DIFFICULTY_LABEL, GameScreen, type GameHost } from './game.js';
import { button, dialog, segmented, slider, toggle } from './widgets.js';

const DEMOS: Array<{ encounter: string; modules: Array<[ModuleId, ModuleLevel]> }> = [
  {
    encounter: 'volley',
    modules: [
      ['reflect', 2],
      ['burst', 1],
      ['ricochet', 1],
    ],
  },
  {
    encounter: 'swarm',
    modules: [
      ['charge', 1],
      ['ricochet', 2],
      ['vortex', 1],
      ['burst', 1],
    ],
  },
  {
    encounter: 'shellwall',
    modules: [
      ['charge', 2],
      ['impact', 2],
      ['heavy', 1],
    ],
  },
];

export class App {
  readonly persistence = new Persistence();
  readonly audio = new AudioEngine();
  readonly view: View;
  readonly renderer: Renderer;
  readonly arena: ArenaController;
  private readonly root: HTMLElement;
  private readonly topbar: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly stageTop: HTMLElement;
  private readonly stageBottom: HTMLElement;
  private readonly canvasArea: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly side: HTMLElement;
  private readonly modalLayer: HTMLElement;
  private readonly toastLayer: HTMLElement;
  private game: GameScreen | null = null;
  private screen: 'title' | 'game' = 'title';
  private last = 0;
  private demoIndex = 0;
  private modalClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.topbar = h('header', { class: 'topbar' }) as HTMLElement;
    this.canvas = h('canvas', {
      class: 'arena-canvas',
      'data-testid': 'arena',
    }) as HTMLCanvasElement;
    this.overlay = h('div', { class: 'overlay' }) as HTMLElement;
    this.stageTop = h('div', { class: 'stage-top' }) as HTMLElement;
    this.stageBottom = h('div', { class: 'stage-bottom' }) as HTMLElement;
    this.canvasArea = h(
      'div',
      { class: 'canvas-area' },
      h('div', { class: 'canvas-wrap' }, this.canvas),
    ) as HTMLElement;
    this.stage = h(
      'section',
      { class: 'stage' },
      this.stageTop,
      this.canvasArea,
      this.stageBottom,
      this.overlay,
    ) as HTMLElement;
    this.side = h('aside', { class: 'side' }) as HTMLElement;
    this.modalLayer = h('div', { class: 'modal-layer' }) as HTMLElement;
    this.toastLayer = h('div', { class: 'toast-layer', 'aria-live': 'polite' }) as HTMLElement;
    mount(
      root,
      h(
        'div',
        { class: 'app', 'data-screen': 'title' },
        this.topbar,
        h('main', { class: 'main' }, this.stage, this.side),
      ),
      this.modalLayer,
      this.toastLayer,
    );
    this.view = new View(this.canvas);
    this.renderer = new Renderer(this.view);
    this.arena = new ArenaController(this.renderer);
  }

  private get appEl(): HTMLElement {
    return this.root.querySelector('.app') as HTMLElement;
  }

  get settings(): Settings {
    return this.persistence.data.settings;
  }

  async start(): Promise<void> {
    await this.persistence.load();
    this.applySettings();
    this.persistence.onStatus = (status) => {
      if (status === 'error') this.toast('存档写入失败，将在下次改动时重试');
    };
    this.bindEvents();
    this.fit();
    this.audio.ensure();
    this.audio.setMusic('menu');
    if (this.persistence.recovered)
      this.toast('存档无法识别，已从全新状态开始（原文件保留为备份）');
    this.showTitle();
    requestAnimationFrame(this.loop);
    if (new URLSearchParams(location.search).has('test')) this.exposeTestHooks();
    document.body.dataset.ready = this.persistence.backend.kind;
  }

  /** 端到端测试钩子：只在带 ?test=1 启动时存在。 */
  private exposeTestHooks(): void {
    (window as unknown as { __echo: unknown }).__echo = {
      fastForward: (seconds: number) => this.arena.fastForward(seconds),
      mode: () => this.arena.mode,
      result: () => this.arena.world?.result ?? null,
      run: () => this.persistence.data.run,
      cast: (kind: 'guard' | 'slinger' | 'bell', x?: number, y?: number) => {
        const world = this.arena.world;
        const target = world?.aliveOf(1)[0];
        if (!world || !target) return false;
        const ok = world.castActive(kind, x ?? target.x, y ?? target.y);
        return ok;
      },
      /** 直接摆出某场对局与招式组合（用于截图检查与端到端测试）。 */
      setupRun: (encounterId: string, modules: Array<[ModuleId, ModuleLevel]>, matchIndex = 0) => {
        const run = createRun(4321, 'normal');
        run.order[matchIndex] = encounterId;
        run.matchIndex = matchIndex;
        const record = run.records[matchIndex];
        if (record) record.encounterId = encounterId;
        let loadout = emptyLoadout();
        const levels: Partial<Record<ModuleId, ModuleLevel>> = {};
        for (const [id, level] of modules) {
          levels[id] = level;
          loadout = autoEquip(loadout, id) ?? loadout;
        }
        run.levels = levels;
        run.loadout = loadout;
        run.formation = ensureGadgets(run.formation, levels, loadout);
        this.persistence.update((d) => {
          d.run = run;
        }, true);
        this.game?.destroy();
        this.enterGame();
      },
    };
  }

  private loop = (now: number): void => {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.arena.frame(dt);
    this.game?.updateHud();
    requestAnimationFrame(this.loop);
  };

  private fit(): void {
    const rect = this.canvasArea.getBoundingClientRect();
    if (this.view.fit(rect.width - 12, rect.height - 12)) this.renderer.invalidate();
  }

  private bindEvents(): void {
    new ResizeObserver(() => this.fit()).observe(this.canvasArea);
    const toArena = (e: PointerEvent) => this.view.toArena(e.clientX, e.clientY);
    this.canvas.addEventListener('pointermove', (e) => {
      const p = toArena(e);
      this.canvas.style.cursor = this.arena.pointerMove(p.x, p.y, true);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.audio.ensure();
      const p = toArena(e);
      if (e.button === 0) this.canvas.setPointerCapture(e.pointerId);
      this.arena.pointerDown(p.x, p.y, e.button);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      this.arena.pointerUp();
    });
    this.canvas.addEventListener('pointerleave', () => this.arena.pointerLeave());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerdown', () => this.audio.ensure(), { capture: true });

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('blur', () => this.game?.pauseForBlur());
    document.addEventListener('visibilitychange', () => {
      const hidden = document.visibilityState === 'hidden';
      if (hidden) this.game?.pauseForBlur();
      this.audio.setSuspended(hidden);
    });
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
      e.key !== 'Escape'
    )
      return;
    if (this.modalClose) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeModal();
      }
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      this.toggleMute();
      return;
    }
    if (this.screen === 'title') {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.primaryTitleAction();
      }
      return;
    }
    if (this.game?.onKey(e)) e.preventDefault();
  }

  // ---- 设置 ----

  private applySettings(): void {
    const s = this.settings;
    this.audio.apply(s);
    this.renderer.fx.options = {
      damageNumbers: s.damageNumbers,
      screenShake: s.screenShake,
      reduceFlashes: s.reduceFlashes,
    };
    this.arena.reduceFlashes = s.reduceFlashes;
    this.root.classList.toggle('reduce-motion', s.reduceFlashes);
  }

  private updateSettings(mutate: (s: Settings) => void): void {
    this.persistence.update((d) => mutate(d.settings));
    this.applySettings();
  }

  toggleMute(): void {
    this.updateSettings((s) => {
      s.muted = !s.muted;
    });
    this.toast(this.settings.muted ? '已静音（M 键切换）' : '已恢复声音');
    this.game?.refreshTopbar();
    if (this.screen === 'title') this.showTitle();
  }

  openSettings(): void {
    const s = this.settings;
    const api = bridge();
    const location = h('code', { class: 'save-path' }, '读取中……') as HTMLElement;
    void this.persistence.backend.location().then((text) => {
      location.textContent = text;
    });
    const body = h(
      'div',
      { class: 'settings' },
      h(
        'fieldset',
        null,
        h('legend', null, '声音'),
        slider('总音量', s.masterVolume, (v) =>
          this.updateSettings((x) => void (x.masterVolume = v)),
        ),
        slider('音效', s.sfxVolume, (v) => this.updateSettings((x) => void (x.sfxVolume = v))),
        slider('音乐', s.musicVolume, (v) => this.updateSettings((x) => void (x.musicVolume = v))),
        toggle(
          '静音',
          s.muted,
          (v) => {
            this.updateSettings((x) => void (x.muted = v));
            this.game?.refreshTopbar();
          },
          '快捷键 M',
        ),
      ),
      h(
        'fieldset',
        null,
        h('legend', null, '画面'),
        toggle('屏幕震动', s.screenShake, (v) =>
          this.updateSettings((x) => void (x.screenShake = v)),
        ),
        toggle(
          '减少闪烁',
          s.reduceFlashes,
          (v) => this.updateSettings((x) => void (x.reduceFlashes = v)),
          '减弱受击闪白与光环',
        ),
        toggle('显示伤害数字', s.damageNumbers, (v) =>
          this.updateSettings((x) => void (x.damageNumbers = v)),
        ),
        api
          ? button({
              label: '切换全屏',
              size: 'small',
              onClick: () => void api.toggleFullscreen(),
            })
          : null,
      ),
      h(
        'fieldset',
        null,
        h('legend', null, '游戏'),
        toggle('窗口失去焦点时自动暂停', s.autoPause, (v) =>
          this.updateSettings((x) => void (x.autoPause = v)),
        ),
        h(
          'div',
          { class: 'field' },
          h(
            'span',
            { class: 'field-label' },
            '新一轮的难度',
            h('small', null, '当前这一轮不受影响'),
          ),
          segmented<Difficulty>(
            [
              { value: 'easy', label: '轻松' },
              { value: 'normal', label: '标准' },
              { value: 'hard', label: '硬核' },
            ],
            s.difficulty,
            (v) => {
              this.updateSettings((x) => void (x.difficulty = v));
              this.openSettings();
            },
            '新一轮的难度',
          ),
        ),
      ),
      h(
        'fieldset',
        null,
        h('legend', null, '存档'),
        h('p', { class: 'muted' }, '进度、设置和记录都只保存在这台电脑上：'),
        location,
        h(
          'div',
          { class: 'row' },
          this.persistence.backend.openFolder
            ? button({
                label: '打开存档文件夹',
                size: 'small',
                icon: 'folder',
                onClick: () => void this.persistence.backend.openFolder?.(),
              })
            : null,
          button({
            label: '清除全部存档',
            size: 'small',
            kind: 'danger',
            onClick: () => void this.resetAll(),
            testId: 'reset-all',
          }),
        ),
      ),
    );
    this.showModal(
      dialog({
        title: '设置',
        body,
        wide: true,
        testId: 'settings',
        onClose: () => this.closeModal(),
        actions: [button({ label: '完成', kind: 'primary', onClick: () => this.closeModal() })],
      }),
    );
  }

  private async resetAll(): Promise<void> {
    const ok = await this.confirm(
      '清除全部存档？',
      '会清除当前进度、设置和长期记录，回到第一次打开的状态。原存档会被改名为 save.backup.json 保留一次，以防误操作。',
      '清除',
    );
    if (!ok) return;
    this.game?.destroy();
    this.game = null;
    await this.persistence.reset();
    this.persistence.data.settings = defaultSettings();
    this.applySettings();
    this.toast('已清除全部存档');
    this.showTitle();
  }

  // ---- 弹窗与提示 ----

  private showModal(node: HTMLElement, onClose?: () => void): void {
    const previous = this.modalClose;
    this.modalClose = null;
    mount(this.modalLayer, node);
    this.modalClose = () => {
      mount(this.modalLayer);
      this.modalClose = null;
      onClose?.();
    };
    void previous;
    const focusable = node.querySelector<HTMLElement>('.btn-primary, button');
    focusable?.focus({ preventScroll: true });
  }

  closeModal(): void {
    this.modalClose?.();
  }

  confirm(title: string, body: string, ok: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        this.closeModal();
        resolve(value);
      };
      this.showModal(
        dialog({
          title,
          body: h('p', null, body),
          testId: 'confirm',
          onClose: () => finish(false),
          actions: [
            button({ label: '取消', onClick: () => finish(false), testId: 'confirm-cancel' }),
            button({
              label: ok,
              kind: 'danger',
              onClick: () => finish(true),
              testId: 'confirm-ok',
            }),
          ],
        }),
        () => finish(false),
      );
    });
  }

  toast(text: string): void {
    const node = h('div', { class: 'toast' }, text) as HTMLElement;
    this.toastLayer.appendChild(node);
    while (this.toastLayer.children.length > 3) this.toastLayer.firstElementChild?.remove();
    window.setTimeout(() => node.classList.add('toast-out'), 3600);
    window.setTimeout(() => node.remove(), 4000);
  }

  // ---- 标题画面 ----

  private demoConfig(): BattleConfig {
    const demo = DEMOS[this.demoIndex % DEMOS.length] ?? DEMOS[0];
    let loadout = emptyLoadout();
    const levels: Partial<Record<ModuleId, ModuleLevel>> = {};
    for (const [id, level] of demo?.modules ?? []) {
      levels[id] = level;
      loadout = autoEquip(loadout, id) ?? loadout;
    }
    return {
      encounter: encounterById(demo?.encounter ?? 'volley'),
      seed: 1000 + this.demoIndex,
      difficulty: 'easy',
      matchIndex: 0,
      loadout,
      levels,
      formation: defaultFormation(),
    };
  }

  private startDemo(): void {
    const config = this.demoConfig();
    const has = (id: ModuleId) => Object.values(config.loadout).some((slots) => slots.includes(id));
    this.arena.looks = {
      shield: has('reflect'),
      armor: has('bulwark'),
      booster: has('charge'),
      bellCharm: has('magnet') ? 'magnet' : 'bow',
    };
    this.arena.hooks = {};
    this.arena.startDemo(config, (world) => {
      if (world.result && world.t - world.resultTime > 2.5) {
        this.demoIndex++;
        this.startDemo();
        return;
      }
      autoCast(world);
    });
  }

  private primaryTitleAction(): void {
    const run = this.persistence.data.run;
    if (run && run.phase !== 'complete') this.enterGame();
    else this.newRun();
  }

  showTitle(): void {
    this.screen = 'title';
    this.appEl.dataset.screen = 'title';
    this.game = null;
    mount(this.topbar);
    mount(this.side);
    mount(this.stageTop);
    mount(this.stageBottom);
    this.startDemo();
    this.audio.setMusic('menu');
    this.audio.setDucked(false);
    const data = this.persistence.data;
    const run = data.run;
    const active = run && run.phase !== 'complete' ? run : null;
    const records = data.records;

    let resumeNote = '';
    if (active) {
      const enc = currentEncounter(active);
      if (active.phase === 'reward')
        resumeNote = `上次停在第 ${active.matchIndex + 1} 场胜利后的奖励选择。`;
      else if (active.inBattle)
        resumeNote = `上次在「${enc.name}」的战斗中离开。会回到这一场的战前准备，配置和站位都在。`;
      else resumeNote = `会回到「${enc.name}」的战前准备。`;
    }

    const actions: Node[] = [];
    if (active) {
      const enc = currentEncounter(active);
      actions.push(
        button({
          label: `继续 · 第 ${active.matchIndex + 1} / ${RUN_LENGTH} 场「${enc.name}」`,
          kind: 'primary',
          size: 'big',
          icon: 'play',
          hotkey: 'Enter',
          onClick: () => this.enterGame(),
          testId: 'continue',
        }),
        h('p', { class: 'resume-note', 'data-testid': 'resume-note' }, resumeNote),
        button({ label: '新开一轮', onClick: () => void this.confirmNewRun(), testId: 'new-run' }),
      );
    } else {
      actions.push(
        button({
          label: run?.phase === 'complete' ? '再来一轮' : '开始',
          kind: 'primary',
          size: 'big',
          icon: 'play',
          hotkey: 'Enter',
          onClick: () => this.newRun(),
          testId: 'start',
        }),
      );
      if (run?.phase === 'complete') {
        actions.push(
          button({
            label: '查看上一轮结算',
            onClick: () => this.enterGame(),
            testId: 'last-summary',
          }),
        );
      }
    }

    const difficulty = h(
      'div',
      { class: 'title-difficulty' },
      h('span', null, active ? '新一轮难度' : '难度'),
      segmented<Difficulty>(
        [
          { value: 'easy', label: '轻松' },
          { value: 'normal', label: '标准' },
          { value: 'hard', label: '硬核' },
        ],
        data.settings.difficulty,
        (v) => {
          this.updateSettings((s) => void (s.difficulty = v));
          this.audio.ui('click');
          this.showTitle();
        },
        '难度',
      ),
    );

    const api = bridge();
    const recordLine =
      records.runsCompleted > 0 || records.bestEcho > 0
        ? `最佳回响 ×${records.bestEcho}　·　已通关 ${records.runsCompleted} 轮${
            records.clearedDifficulties.length
              ? `（${records.clearedDifficulties.map((d) => DIFFICULTY_LABEL[d]).join('、')}）`
              : ''
          }`
        : '一轮 7 场，大约 15–25 分钟；随时可以停，进度会自动保存。';

    mount(
      this.overlay,
      h(
        'div',
        { class: 'title-screen', 'data-testid': 'title' },
        h(
          'div',
          { class: 'title-card' },
          h(
            'div',
            { class: 'logo' },
            h('span', { class: 'logo-cn' }, '回声竞技场'),
            h('span', { class: 'logo-en' }, 'ECHO ARENA'),
          ),
          h('p', { class: 'tagline' }, '桌面玩具联赛：搭配招式，让每一击都有回响。'),
          h('div', { class: 'title-actions' }, ...actions),
          difficulty,
          h(
            'div',
            { class: 'title-row' },
            button({
              label: '设置',
              kind: 'ghost',
              icon: 'gear',
              onClick: () => this.openSettings(),
              testId: 'title-settings',
            }),
            api
              ? button({ label: '退出游戏', kind: 'ghost', onClick: () => void api.quit() })
              : null,
          ),
          h('p', { class: 'title-foot' }, recordLine),
        ),
      ),
    );
  }

  private async confirmNewRun(): Promise<void> {
    const run = this.persistence.data.run;
    if (run && run.phase !== 'complete') {
      const ok = await this.confirm(
        '新开一轮？',
        `当前这一轮（第 ${run.matchIndex + 1} / ${RUN_LENGTH} 场）的进度会被覆盖。长期记录不受影响。`,
        '新开一轮',
      );
      if (!ok) return;
    }
    this.newRun();
  }

  newRun(): void {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const run = createRun(seed, this.settings.difficulty);
    this.persistence.update((d) => {
      d.run = run;
      d.records.runsStarted++;
    }, true);
    this.audio.ui('start');
    this.enterGame();
  }

  private enterGame(): void {
    if (!this.persistence.data.run) {
      this.newRun();
      return;
    }
    this.closeModal();
    this.screen = 'game';
    this.appEl.dataset.screen = 'game';
    mount(this.overlay);
    const host: GameHost = {
      persistence: this.persistence,
      audio: this.audio,
      arena: this.arena,
      topbar: this.topbar,
      side: this.side,
      overlay: this.overlay,
      stageTop: this.stageTop,
      stageBottom: this.stageBottom,
      toast: (text) => this.toast(text),
      confirm: (title, body, ok) => this.confirm(title, body, ok),
      openSettings: () => this.openSettings(),
      openMenu: (items) => this.openMenu(items),
      closeModal: () => this.closeModal(),
      goTitle: () => {
        this.game?.destroy();
        this.showTitle();
      },
      newRun: () => {
        this.game?.destroy();
        this.newRun();
      },
      toggleMute: () => this.toggleMute(),
    };
    this.game = new GameScreen(host);
    requestAnimationFrame(() => this.fit());
  }

  private openMenu(
    items: Array<{
      label: string;
      action: () => void;
      hotkey?: string;
      kind?: 'primary' | 'danger';
    }>,
  ): void {
    this.showModal(
      dialog({
        title: '菜单',
        testId: 'menu',
        onClose: () => this.closeModal(),
        body: h(
          'div',
          { class: 'menu-list' },
          ...items.map((item) =>
            button({
              label: item.label,
              kind: item.kind ?? 'secondary',
              hotkey: item.hotkey,
              onClick: item.action,
            }),
          ),
        ),
        actions: [],
      }),
    );
  }
}
