// 游戏界面：战前准备、战斗面板、结算、奖励与整轮总结。
import type { AudioEngine } from '../audio/audio.js';
import {
  gadgetCount,
  MODULE_DEFS,
  moduleFullName,
  moduleOwnerLabel,
  moduleTypeLabel,
  SLOTS_PER_UNIT,
  STARTING_CHOICES,
} from '../core/content/modules.js';
import { unitDef } from '../core/content/units.js';
import {
  formatTime,
  summarizeBattle,
  summarizeRun,
  type BattleSummary,
} from '../core/run/insights.js';
import { canEquip, equip, findEquipped, unequip } from '../core/run/loadout.js';
import {
  battleConfig,
  beginBattle,
  canChooseStarter,
  chooseStarter,
  currentEncounter,
  defaultFormation,
  finishBattle,
  leaveBattle,
  nextEncounter,
  pickReward,
  RUN_LENGTH,
  setFormation,
  setLoadout,
  type RunState,
} from '../core/run/run.js';
import type { Settings } from '../core/run/save.js';
import type { SimEvent } from '../core/sim/events.js';
import type { World } from '../core/sim/world.js';
import {
  PLAYER_UNITS,
  type Difficulty,
  type EnemyUnitKind,
  type ModuleId,
  type PlayerUnitKind,
} from '../core/types.js';
import type { ArenaController } from '../game/arena.js';
import type { Persistence } from '../game/persistence.js';
import { portrait } from '../render/portrait.js';
import type { Looks } from '../render/renderer.js';
import { cx, h, mount, type Child } from './dom.js';
import { FAMILY_COLORS, moduleIcon, uiIcon } from './icons.js';
import { button, iconButton, kbd } from './widgets.js';

export interface GameHost {
  persistence: Persistence;
  audio: AudioEngine;
  arena: ArenaController;
  topbar: HTMLElement;
  side: HTMLElement;
  overlay: HTMLElement;
  stageTop: HTMLElement;
  stageBottom: HTMLElement;
  toast(text: string): void;
  confirm(title: string, body: string, ok: string): Promise<boolean>;
  openSettings(): void;
  openMenu(
    items: Array<{
      label: string;
      action: () => void;
      hotkey?: string;
      kind?: 'primary' | 'danger';
    }>,
  ): void;
  closeModal(): void;
  goTitle(): void;
  newRun(): void;
  toggleMute(): void;
}

type Selection =
  { kind: 'slot'; unit: PlayerUnitKind; slot: number } | { kind: 'module'; id: ModuleId } | null;

type View = 'prep' | 'battle' | 'result' | 'reward' | 'summary';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '轻松',
  normal: '标准',
  hard: '硬核',
};

const UNIT_KEYS: Record<PlayerUnitKind, string> = { guard: '1', slinger: '2', bell: '3' };

interface UnitHud {
  card: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
  skill: HTMLButtonElement | null;
  cdMask: HTMLElement | null;
  cache: string;
}

export class GameScreen {
  private host: GameHost;
  private view: View = 'prep';
  private selection: Selection = null;
  private summary: BattleSummary | null = null;
  private rewardPick: ModuleId | null = null;
  private pauseReason: 'user' | 'blur' | null = null;
  private hud: {
    timer: HTMLElement | null;
    remaining: HTMLElement | null;
    echo: HTMLElement | null;
    focus: HTMLElement | null;
    overtime: HTMLElement | null;
    pauseBtn: HTMLButtonElement | null;
    speedBtn: HTMLButtonElement | null;
    units: Partial<Record<PlayerUnitKind, UnitHud>>;
    cache: string;
  } = {
    timer: null,
    remaining: null,
    echo: null,
    focus: null,
    overtime: null,
    pauseBtn: null,
    speedBtn: null,
    units: {},
    cache: '',
  };
  private banner: HTMLElement | null = null;
  private hintShown = false;
  private highlight: EnemyUnitKind | null = null;

  constructor(host: GameHost) {
    this.host = host;
    const arena = host.arena;
    arena.hooks = {
      onEvents: (events, world) => this.onEvents(events, world),
      onFormation: (formation) => {
        this.setRun(setFormation(this.run, formation));
      },
      onSelect: (kind) => {
        if (this.view === 'prep') {
          if (kind) this.host.audio.ui('select');
          this.renderPrepSide();
        }
      },
      onBattleEnd: (world) => this.onBattleEnd(world),
      onChange: () => this.refreshBattleChrome(),
    };
    this.enter();
  }

  get run(): RunState {
    const run = this.host.persistence.data.run;
    if (!run) throw new Error('No active run');
    return run;
  }

  private get settings(): Settings {
    return this.host.persistence.data.settings;
  }

  private setRun(run: RunState, immediate = false): void {
    this.host.persistence.update((d) => {
      d.run = run;
    }, immediate);
  }

  destroy(): void {
    this.host.arena.hooks = {};
    this.host.arena.clear();
    mount(this.host.overlay);
    mount(this.host.side);
    mount(this.host.topbar);
    mount(this.host.stageTop);
    mount(this.host.stageBottom);
  }

  // ---- 进入各阶段 ----

  enter(): void {
    const run = this.run;
    if (run.phase === 'reward') this.showReward();
    else if (run.phase === 'complete') this.showSummary();
    else this.enterPrep();
  }

  private looks(): Looks {
    const has = (id: ModuleId) => findEquipped(this.run.loadout, id) !== null;
    return {
      shield: has('reflect'),
      armor: has('bulwark'),
      booster: has('charge'),
      bellCharm: has('magnet') ? 'magnet' : has('mend') ? 'heart' : 'bow',
    };
  }

  enterPrep(): void {
    let run = this.run;
    if (run.inBattle) {
      run = leaveBattle(run);
      this.setRun(run, true);
    }
    this.view = 'prep';
    this.summary = null;
    this.pauseReason = null;
    this.host.arena.looks = this.looks();
    this.host.arena.showPrep(battleConfig(run));
    this.host.audio.setMusic('menu');
    this.host.audio.setDucked(false);
    mount(this.host.overlay);
    mount(this.host.stageBottom);
    this.banner = null;
    this.renderTopbar();
    this.renderPrepHeader();
    this.renderPrepSide();
  }

  private rebuildPreview(): void {
    this.host.arena.looks = this.looks();
    const selected = this.host.arena.selected;
    this.host.arena.showPrep(battleConfig(this.run));
    this.host.arena.selected = selected;
  }

  startBattle(): void {
    if (this.view !== 'prep' && this.view !== 'result') return;
    const run = beginBattle(this.run);
    this.setRun(run, true);
    this.view = 'battle';
    this.selection = null;
    this.pauseReason = null;
    this.host.arena.looks = this.looks();
    this.host.arena.reduceFlashes = this.settings.reduceFlashes;
    this.host.arena.startBattle(battleConfig(run));
    this.host.audio.ui('start');
    this.host.audio.setMusic('battle');
    this.host.audio.setDucked(false);
    mount(this.host.overlay);
    mount(this.host.stageTop);
    mount(this.host.side);
    this.host.side.dataset.mode = 'hidden';
    this.banner = null;
    this.renderTopbar();
    this.renderBattleHud();
    this.maybeBattleHint();
  }

  private onBattleEnd(world: World): void {
    const stats = world.stats;
    let run = finishBattle(this.run, stats);
    this.host.persistence.update((d) => {
      d.run = run;
      d.records.bestEcho = Math.max(d.records.bestEcho, stats.maxEcho);
    }, true);
    run = this.run;
    const survivors = world.units.filter((u) => u.alive && u.team === 1).map((u) => u.kind);
    const actives = PLAYER_UNITS.map((k) => world.playerUnit(k)?.active).filter(
      (m): m is ModuleId => !!m,
    );
    this.summary = summarizeBattle(stats, {
      survivors,
      enemyHpLeft: world.enemyHpRemainingRatio(),
      actives,
    });
    this.view = 'result';
    this.host.audio.setDucked(true);
    this.renderTopbar();
    this.renderResult();
  }

  private retrySame(): void {
    this.startBattle();
  }

  // ---- 顶栏 ----

  private renderTopbar(): void {
    const run = this.run;
    const enc = currentEncounter(run);
    const inBattle = this.view === 'battle';
    this.hud.pauseBtn = null;
    this.hud.speedBtn = null;
    this.hud.timer = null;
    const right: Node[] = [];
    if (inBattle) {
      this.hud.timer = h('span', { class: 'timer', 'data-testid': 'timer' }, '0:00') as HTMLElement;
      this.hud.pauseBtn = button({
        label: this.host.arena.paused ? '继续' : '暂停',
        icon: this.host.arena.paused ? 'play' : 'pause',
        hotkey: '空格',
        size: 'small',
        onClick: () => this.togglePause(),
        testId: 'pause',
      });
      this.hud.speedBtn = button({
        label: `${this.host.arena.speed}×`,
        icon: 'speed',
        size: 'small',
        title: '切换速度（F）',
        onClick: () => {
          this.host.arena.toggleSpeed();
          this.host.audio.ui('click');
        },
      });
      right.push(this.hud.timer, this.hud.pauseBtn, this.hud.speedBtn);
    }
    right.push(
      iconButton(
        this.settings.muted ? 'mute' : 'sound',
        this.settings.muted ? '取消静音（M）' : '静音（M）',
        () => this.host.toggleMute(),
      ),
      iconButton('gear', '设置', () => this.host.openSettings()),
    );
    mount(
      this.host.topbar,
      iconButton('menu', '菜单（Esc）', () => this.openMenu(), 'menu'),
      h(
        'div',
        { class: 'match-title' },
        h('span', { class: 'match-no' }, `第 ${run.matchIndex + 1} / ${RUN_LENGTH} 场`),
        h('span', { class: 'match-name', 'data-testid': 'match-name' }, enc.name),
        h('span', { class: 'chip' }, DIFFICULTY_LABEL[run.difficulty]),
      ),
      h('div', { class: 'topbar-right' }, ...right),
    );
  }

  refreshTopbar(): void {
    this.renderTopbar();
  }

  private refreshBattleChrome(): void {
    if (this.view !== 'battle') return;
    const arena = this.host.arena;
    if (this.hud.pauseBtn) {
      const label = this.hud.pauseBtn.querySelector('.btn-label');
      if (label) label.textContent = arena.paused ? '继续' : '暂停';
      this.hud.pauseBtn.replaceChild(
        uiIcon(arena.paused ? 'play' : 'pause', 18),
        this.hud.pauseBtn.firstChild as Node,
      );
    }
    if (this.hud.speedBtn) {
      const label = this.hud.speedBtn.querySelector('.btn-label');
      if (label) label.textContent = `${arena.speed}×`;
    }
    this.renderBanner();
  }

  // ---- 战前准备 ----

  private enemyGroups(): Array<{ kind: EnemyUnitKind; count: number; waves: number }> {
    const enc = currentEncounter(this.run);
    const map = new Map<EnemyUnitKind, { kind: EnemyUnitKind; count: number; waves: number }>();
    const add = (kind: EnemyUnitKind, wave: boolean) => {
      const g = map.get(kind) ?? { kind, count: 0, waves: 0 };
      g.count++;
      if (wave) g.waves++;
      map.set(kind, g);
    };
    for (const e of enc.enemies) add(e.kind, false);
    for (const w of enc.waves ?? []) for (const e of w.units) add(e.kind, true);
    for (const e of enc.enemies) {
      if (e.kind === 'jack' && !map.has('mouse'))
        map.set('mouse', { kind: 'mouse', count: 0, waves: 0 });
      if (e.kind === 'king') {
        for (const k of ['mouse', 'bomber'] as const)
          if (!map.has(k)) map.set(k, { kind: k, count: 0, waves: 0 });
      }
    }
    return [...map.values()];
  }

  private renderPrepHeader(): void {
    const run = this.run;
    const enc = currentEncounter(run);
    const waves = enc.waves?.length ?? 0;
    const groups = this.enemyGroups();
    mount(
      this.host.stageTop,
      h(
        'div',
        { class: 'match-header', 'data-testid': 'match-header' },
        h(
          'div',
          { class: 'mh-text' },
          h('div', { class: 'card-kicker' }, `第 ${run.matchIndex + 1} 场 · 本场对手`),
          h('h2', null, enc.name),
          h('p', { class: 'intro' }, enc.intro),
          h(
            'p',
            { class: 'goal' },
            uiIcon('target', 16),
            waves > 0 ? `目标：击倒全部对手（共 ${waves + 1} 波）` : '目标：击倒全部对手',
          ),
        ),
        h(
          'ul',
          { class: 'foes' },
          ...groups.map((g) => {
            const def = unitDef(g.kind);
            const count = g.count === 0 ? '援军' : `×${g.count}`;
            return h(
              'li',
              {
                class: cx('foe', this.highlight === g.kind && 'foe-on'),
                onMouseenter: () => this.highlightFoe(g.kind),
                onMouseleave: () => this.highlightFoe(null),
              },
              h('img', { class: 'portrait sm', src: portrait(g.kind), alt: '' }),
              h(
                'div',
                { class: 'foe-text' },
                h('b', null, def.name, h('em', null, count)),
                ...def.traits.map((t) => h('span', null, t)),
              ),
            );
          }),
        ),
      ),
    );
  }

  private renderPrepSide(): void {
    const run = this.run;
    const starter = canChooseStarter(run);
    const sections: Node[] = [];
    if (starter) sections.push(this.starterCard());
    sections.push(this.squadCard());
    if (!starter) sections.push(this.libraryCard());
    const detail = this.detailCard();
    if (detail) sections.push(detail);

    const actions = h(
      'div',
      { class: 'side-actions' },
      button({
        label: '开战',
        kind: 'primary',
        size: 'big',
        icon: 'play',
        hotkey: 'Enter',
        onClick: () => this.startBattle(),
        testId: 'fight',
      }),
      button({
        label: '恢复默认站位',
        kind: 'ghost',
        size: 'small',
        onClick: () => {
          const formation = defaultFormation();
          formation.gadgets = this.run.formation.gadgets.map((g) => ({ ...g }));
          this.setRun(setFormation(this.run, formation));
          this.rebuildPreview();
          this.host.audio.ui('click');
        },
      }),
    );

    mount(this.host.side, h('div', { class: 'side-scroll' }, ...sections), actions);
    this.host.side.dataset.mode = 'prep';
  }

  private highlightFoe(kind: EnemyUnitKind | null): void {
    this.highlight = kind;
    const world = this.host.arena.world;
    if (!world) return;
    const unit = kind ? world.units.find((u) => u.kind === kind && u.alive) : undefined;
    this.host.arena.hoverEnemyId = unit?.id ?? 0;
  }

  private starterCard(): Node {
    const current = STARTING_CHOICES.find((id) => this.run.levels[id]);
    return h(
      'section',
      { class: 'card starter-card' },
      h('div', { class: 'card-kicker' }, '开局招式 · 三选一'),
      h(
        'p',
        { class: 'muted' },
        '三种不同的办法，点一下就换。拿不准就直接开战，之后每赢一场还能再挑新招式。',
      ),
      h(
        'div',
        { class: 'starter-list' },
        ...STARTING_CHOICES.map((id) => {
          const def = MODULE_DEFS[id];
          const on = id === current;
          return h(
            'button',
            {
              type: 'button',
              class: cx('starter', on && 'starter-on'),
              'data-testid': `starter-${id}`,
              'aria-pressed': on ? 'true' : 'false',
              onClick: () => {
                if (on) return;
                this.setRun(chooseStarter(this.run, id));
                this.selection = { kind: 'module', id };
                this.host.audio.ui('equip');
                this.rebuildPreview();
                this.renderPrepSide();
              },
            },
            moduleIcon(id, 40),
            h(
              'span',
              { class: 'starter-text' },
              h('b', null, def.name, h('span', { class: 'starter-type' }, moduleTypeLabel(def))),
              h('span', { class: 'starter-does' }, def.levels[0].does),
            ),
            on ? h('span', { class: 'starter-check' }, '已装备') : null,
          );
        }),
      ),
    );
  }

  private squadCard(): Node {
    const run = this.run;
    const rows = PLAYER_UNITS.map((kind) => {
      const def = unitDef(kind);
      const selectedUnit = this.host.arena.selected === kind;
      const slots = run.loadout[kind].map((id, slot) => {
        const on =
          this.selection?.kind === 'slot' &&
          this.selection.unit === kind &&
          this.selection.slot === slot;
        return h(
          'button',
          {
            type: 'button',
            class: cx('slot', id ? 'slot-full' : 'slot-empty', on && 'slot-on'),
            'data-testid': `slot-${kind}-${slot}`,
            title: id ? moduleFullName(id, run.levels[id] ?? 1) : '空槽位',
            onClick: () => {
              this.selection = { kind: 'slot', unit: kind, slot };
              this.host.arena.select(kind);
              this.host.audio.ui('select');
              this.renderPrepSide();
            },
          },
          id ? moduleIcon(id, 30) : h('span', { class: 'slot-plus' }, '+'),
          h(
            'span',
            { class: 'slot-name' },
            id ? MODULE_DEFS[id].name : '空槽',
            id && run.levels[id] === 2 ? h('i', { class: 'lv2' }, '进阶') : null,
          ),
        );
      });
      return h(
        'div',
        {
          class: cx('unit-row', selectedUnit && 'unit-row-on'),
          onClick: () => {
            this.host.arena.select(kind);
          },
        },
        h('img', { class: 'portrait', src: portrait(kind, this.looks()), alt: '' }),
        h('div', { class: 'unit-name' }, h('b', null, def.name), h('small', null, def.title)),
        h('div', { class: 'slots' }, ...slots),
      );
    });
    return h(
      'section',
      { class: 'card squad-card' },
      h('div', { class: 'card-kicker' }, `队伍配置 · 每人 ${SLOTS_PER_UNIT} 个槽位`),
      ...rows,
    );
  }

  private libraryCard(): Node {
    const run = this.run;
    const owned = (Object.keys(run.levels) as ModuleId[]).filter((id) => id in MODULE_DEFS);
    const free = owned.filter((id) => !findEquipped(run.loadout, id));
    return h(
      'section',
      { class: 'card library-card' },
      h('div', { class: 'card-kicker' }, `招式库 · 已拥有 ${owned.length} 个`),
      free.length === 0
        ? h('p', { class: 'muted' }, '拥有的招式都已装备。点槽位可以卸下或更换。')
        : h(
            'div',
            { class: 'chips' },
            ...free.map((id) => {
              const on = this.selection?.kind === 'module' && this.selection.id === id;
              return h(
                'button',
                {
                  type: 'button',
                  class: cx('chip-btn', on && 'chip-on'),
                  'data-testid': `lib-${id}`,
                  onClick: () => {
                    this.selection = { kind: 'module', id };
                    this.host.audio.ui('select');
                    this.renderPrepSide();
                  },
                },
                moduleIcon(id, 26),
                h('span', null, moduleFullName(id, run.levels[id] ?? 1)),
              );
            }),
          ),
    );
  }

  private detailCard(): Node | null {
    const sel = this.selection;
    const run = this.run;
    if (!sel) {
      const selectedUnit = this.host.arena.selected;
      if (!selectedUnit) {
        return h(
          'section',
          { class: 'card detail-card tip' },
          h(
            'p',
            { class: 'muted' },
            '点槽位或招式查看说明；在场上拖动队员调整站位（也可以先点队员，再点空地）。',
          ),
        );
      }
      const def = unitDef(selectedUnit);
      return h(
        'section',
        { class: 'card detail-card' },
        h('div', { class: 'card-kicker' }, '队员'),
        h('h3', null, `${def.name} · ${def.title}`),
        h('p', null, def.role),
        h('p', { class: 'muted' }, `生命 ${def.hp} · 在场上拖动它调整开场位置`),
      );
    }

    let id: ModuleId | null = null;
    if (sel.kind === 'module') id = sel.id;
    else id = run.loadout[sel.unit][sel.slot] ?? null;

    if (!id && sel.kind === 'slot') {
      // 空槽：列出可以放进来的招式。
      const candidates = (Object.keys(run.levels) as ModuleId[]).filter(
        (m) => m in MODULE_DEFS && canEquip(unequip(run.loadout, m), m, sel.unit, sel.slot).ok,
      );
      return h(
        'section',
        { class: 'card detail-card' },
        h('div', { class: 'card-kicker' }, `${unitDef(sel.unit).name} 的空槽位`),
        candidates.length === 0
          ? h('p', { class: 'muted' }, '还没有能装在这里的招式。赢下对局后可以挑选新招式。')
          : h(
              'div',
              { class: 'chips' },
              ...candidates.map((m) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'chip-btn',
                    onClick: () => this.equipTo(m, sel.unit, sel.slot),
                  },
                  moduleIcon(m, 26),
                  h('span', null, moduleFullName(m, run.levels[m] ?? 1)),
                  findEquipped(run.loadout, m) ? h('small', null, '（从别处移来）') : null,
                ),
              ),
            ),
      );
    }
    if (!id) return null;

    const def = MODULE_DEFS[id];
    const level = run.levels[id] ?? 1;
    const at = findEquipped(run.loadout, id);
    const actions: Node[] = [];
    const starterLocked = canChooseStarter(run) && STARTING_CHOICES.includes(id);
    if (at && !starterLocked) {
      actions.push(
        button({
          label: '卸下',
          size: 'small',
          onClick: () => {
            this.applyLoadout(unequip(run.loadout, id));
            this.selection = { kind: 'module', id };
            this.renderPrepSide();
          },
        }),
      );
    }
    if (!starterLocked) {
      const units = def.owner === 'any' ? PLAYER_UNITS : [def.owner];
      for (const unit of units) {
        for (let slot = 0; slot < SLOTS_PER_UNIT; slot++) {
          if (at && at.unit === unit && at.slot === slot) continue;
          const check = canEquip(unequip(run.loadout, id), id, unit, slot);
          if (!check.ok) continue;
          const occupant = run.loadout[unit][slot];
          const label = occupant
            ? `${unitDef(unit).name}：替换${MODULE_DEFS[occupant].name}`
            : `装到${unitDef(unit).name}的空槽`;
          actions.push(
            button({
              label,
              size: 'small',
              kind: occupant ? 'ghost' : 'primary',
              onClick: () => this.equipTo(id as ModuleId, unit, slot),
            }),
          );
        }
      }
    }

    return h(
      'section',
      { class: 'card detail-card', style: { borderColor: FAMILY_COLORS[def.family] } },
      h(
        'div',
        { class: 'detail-head' },
        moduleIcon(id, 44),
        h(
          'div',
          null,
          h('h3', null, moduleFullName(id, level)),
          h(
            'div',
            { class: 'tags' },
            h('span', { class: 'tag' }, moduleTypeLabel(def)),
            h('span', { class: 'tag' }, moduleOwnerLabel(def)),
          ),
        ),
      ),
      h('p', { class: 'does' }, def.levels[0].does),
      level === 2
        ? h(
            'p',
            { class: 'does lv2-does' },
            `进阶「${def.levels[1].title}」：${def.levels[1].does}`,
          )
        : null,
      h('p', { class: 'changes' }, def.changes),
      level === 1
        ? h('p', { class: 'muted' }, `进阶后「${def.levels[1].title}」：${def.levels[1].does}`)
        : null,
      def.type === 'gadget'
        ? h(
            'p',
            { class: 'muted' },
            `装备后会出现在场上（${gadgetCount(level)} 个），可以拖到我方半场或中场的任意位置。`,
          )
        : null,
      starterLocked ? h('p', { class: 'muted' }, '开局招式在上方三选一里切换。') : null,
      actions.length > 0 ? h('div', { class: 'detail-actions' }, ...actions) : null,
    );
  }

  private equipTo(id: ModuleId, unit: PlayerUnitKind, slot: number): void {
    const next = equip(this.run.loadout, id, unit, slot);
    if (next === this.run.loadout) {
      this.host.audio.ui('error');
      return;
    }
    this.applyLoadout(next);
    this.selection = { kind: 'slot', unit, slot };
    this.host.audio.ui('equip');
    this.renderPrepSide();
  }

  private applyLoadout(loadout: RunState['loadout']): void {
    this.setRun(setLoadout(this.run, loadout));
    this.rebuildPreview();
  }

  // ---- 战斗面板 ----

  private renderBattleHud(): void {
    const arena = this.host.arena;
    const world = arena.world;
    if (!world) return;
    this.hud.units = {};
    const cards = PLAYER_UNITS.map((kind) => {
      const def = unitDef(kind);
      const u = world.playerUnit(kind);
      const active = u?.active ?? null;
      const hpFill = h('i', { class: 'hp-fill' }) as HTMLElement;
      const hpText = h('span', { class: 'hp-text' }, '') as HTMLElement;
      let skill: HTMLButtonElement | null = null;
      let cdMask: HTMLElement | null = null;
      if (active) {
        cdMask = h('span', { class: 'cd-mask' }) as HTMLElement;
        skill = h(
          'button',
          {
            type: 'button',
            class: 'skill',
            'data-testid': `skill-${kind}`,
            title: `${MODULE_DEFS[active].name}：${MODULE_DEFS[active].levels[0].does}`,
            onClick: (e: Event) => {
              e.stopPropagation();
              this.tryTarget(kind);
            },
          },
          moduleIcon(active, 32),
          h('span', { class: 'skill-name' }, MODULE_DEFS[active].name),
          kbd(UNIT_KEYS[kind]),
          cdMask,
        ) as HTMLButtonElement;
      }
      const passives = (this.run.loadout[kind].filter(Boolean) as ModuleId[]).filter(
        (m) => MODULE_DEFS[m].type !== 'active',
      );
      const card = h(
        'div',
        { class: 'unit-card', 'data-testid': `unit-${kind}` },
        h('img', { class: 'portrait', src: portrait(kind, this.looks()), alt: '' }),
        h(
          'div',
          { class: 'uc-main' },
          h(
            'div',
            { class: 'uc-name' },
            h('b', null, def.name),
            ...passives.map((m) => moduleIcon(m, 18)),
          ),
          h('div', { class: 'hp' }, hpFill),
          hpText,
        ),
        skill,
      ) as HTMLElement;
      this.hud.units[kind] = { card, hpFill, hpText, skill, cdMask, cache: '' };
      return card;
    });

    this.hud.remaining = h(
      'span',
      { class: 'remaining', 'data-testid': 'remaining' },
      '',
    ) as HTMLElement;
    this.hud.overtime = h('span', { class: 'overtime' }, '') as HTMLElement;
    this.hud.focus = h('div', { class: 'focus-line' }, '') as HTMLElement;
    this.hud.echo = h('b', null, '0') as HTMLElement;
    this.hud.cache = '';

    mount(
      this.host.stageBottom,
      h(
        'div',
        { class: 'battle-hud', 'data-testid': 'battle-hud' },
        h(
          'div',
          { class: 'hud-block hud-goal' },
          h('div', { class: 'goal-line' }, uiIcon('target', 16), this.hud.remaining),
          this.hud.overtime,
          h(
            'div',
            { class: 'echo-line' },
            uiIcon('echo', 16),
            h('span', null, '最长回响 ×'),
            this.hud.echo,
          ),
        ),
        ...cards,
        h(
          'div',
          { class: 'hud-block hud-focus' },
          this.hud.focus,
          h(
            'p',
            { class: 'keys-hint' },
            kbd('空格'),
            ' 暂停 ',
            kbd('1'),
            kbd('2'),
            kbd('3'),
            ' 招式 ',
            kbd('Esc'),
            ' 菜单',
          ),
        ),
      ),
    );
    this.updateHud(true);
  }

  private tryTarget(kind: PlayerUnitKind): void {
    const arena = this.host.arena;
    if (this.view !== 'battle') return;
    if (!arena.beginTargeting(kind)) {
      this.host.audio.ui('error');
      return;
    }
    this.host.audio.ui('select');
    this.renderBanner();
  }

  /** 每帧刷新战斗面板里会变的数值（只在变化时写 DOM）。 */
  updateHud(force = false): void {
    if (this.view !== 'battle') return;
    const arena = this.host.arena;
    const world = arena.world;
    if (!world) return;
    if (this.hud.timer) {
      const t = formatTime(world.t);
      if (this.hud.timer.textContent !== t) this.hud.timer.textContent = t;
    }
    for (const kind of PLAYER_UNITS) {
      const hud = this.hud.units[kind];
      const u = world.playerUnit(kind);
      if (!hud || !u) continue;
      const cd = u.active ? Math.max(0, u.activeCd) : 0;
      const cooldown = u.active ? (MODULE_DEFS[u.active].cooldown ?? 10) : 1;
      const key = `${Math.ceil(u.hp)}|${u.alive}|${cd.toFixed(1)}|${arena.targeting === kind}`;
      if (!force && key === hud.cache) continue;
      hud.cache = key;
      const k = Math.max(0, u.hp / u.maxHp);
      hud.hpFill.style.width = `${k * 100}%`;
      hud.hpFill.classList.toggle('low', k < 0.3);
      hud.hpText.textContent = u.alive ? `${Math.ceil(u.hp)} / ${u.maxHp}` : '已倒下';
      hud.card.classList.toggle('dead', !u.alive);
      if (hud.skill && hud.cdMask) {
        const ready = u.alive && cd <= 0;
        hud.skill.classList.toggle('ready', ready);
        hud.skill.classList.toggle('aiming', arena.targeting === kind);
        hud.skill.disabled = !u.alive;
        hud.cdMask.style.height = `${u.alive ? (cd / cooldown) * 100 : 100}%`;
        hud.cdMask.textContent = cd > 0 && u.alive ? String(Math.ceil(cd)) : '';
      }
    }
    const enemies = world.units.filter((u) => u.alive && u.team === 1).length;
    const waves = world.wavesLeft();
    const focus = world.focusId ? world.unitById(world.focusId) : undefined;
    const key = `${enemies}|${waves}|${world.overtimeLevel}|${focus?.id ?? 0}|${world.stats.maxEcho}`;
    if (!force && key === this.hud.cache) return;
    this.hud.cache = key;
    if (this.hud.remaining) {
      this.hud.remaining.textContent = `还剩 ${enemies} 个对手${waves > 0 ? ` · 还有 ${waves} 波` : ''}`;
    }
    if (this.hud.overtime) {
      this.hud.overtime.textContent =
        world.overtimeLevel > 0 ? `加时：所有伤害 ×${world.overtimeMult().toFixed(1)}` : '';
    }
    if (this.hud.focus) {
      mount(
        this.hud.focus,
        focus
          ? h(
              'span',
              null,
              uiIcon('target', 16),
              ` 集火：${focus.def.name}　`,
              h(
                'button',
                {
                  type: 'button',
                  class: 'link-btn',
                  onClick: () => {
                    world.setFocus(0);
                    this.updateHud(true);
                  },
                },
                '取消',
              ),
            )
          : h('span', { class: 'muted' }, '点击对手，阿铁和小弹会优先攻击它'),
      );
    }
    if (this.hud.echo) this.hud.echo.textContent = String(world.stats.maxEcho);
  }

  // ---- 暂停与提示 ----

  togglePause(reason: 'user' | 'blur' = 'user'): void {
    const arena = this.host.arena;
    if (this.view !== 'battle' || arena.mode !== 'battle') return;
    const next = !arena.paused;
    arena.setPaused(next);
    this.pauseReason = next ? reason : null;
    this.host.audio.setDucked(next);
    if (reason === 'user') this.host.audio.ui('pause');
    this.refreshBattleChrome();
  }

  pauseForBlur(): void {
    const arena = this.host.arena;
    if (
      this.view === 'battle' &&
      arena.mode === 'battle' &&
      !arena.paused &&
      this.settings.autoPause
    ) {
      this.togglePause('blur');
    }
  }

  private renderBanner(): void {
    const arena = this.host.arena;
    this.banner?.remove();
    this.banner = null;
    let text: Child = null;
    if (this.view === 'battle' && arena.paused) {
      text =
        this.pauseReason === 'blur'
          ? '窗口失去焦点，已自动暂停 · 按空格继续'
          : '已暂停 · 按空格继续 · 暂停时也能发动招式和点选集火';
    } else if (this.view === 'battle' && arena.targeting) {
      const name = arena.activeName(arena.targeting) ?? '';
      text = `选择「${name}」的位置 · 点击场地发动 · 右键或 Esc 取消`;
    }
    if (!text) return;
    this.banner = h(
      'div',
      { class: cx('banner', arena.paused && 'banner-pause'), 'data-testid': 'banner' },
      text,
    ) as HTMLElement;
    this.host.overlay.appendChild(this.banner);
  }

  private maybeBattleHint(): void {
    if (this.hintShown) return;
    const seen = this.settings.seenHints;
    if (seen.includes('battle-basics')) return;
    this.hintShown = true;
    const world = this.host.arena.world;
    const active = PLAYER_UNITS.map((k) => world?.playerUnit(k)).find((u) => u?.active);
    const skill = active?.active
      ? `按 ${UNIT_KEYS[active.kind as PlayerUnitKind]} 发动「${MODULE_DEFS[active.active].name}」，`
      : '';
    this.host.toast(`${skill}空格随时暂停，点击对手可以集火。`);
    this.host.persistence.update((d) => {
      d.settings.seenHints = [...d.settings.seenHints, 'battle-basics'];
    });
  }

  private onEvents(events: SimEvent[], world: World): void {
    this.host.audio.events(events);
    for (const e of events) {
      if (e.type === 'overtime' && e.level === 1) this.host.toast('进入加时：双方伤害逐步提高');
      if (e.type === 'focus') this.updateHud(true);
    }
    void world;
  }

  // ---- 结算 ----

  private renderResult(): void {
    const summary = this.summary;
    if (!summary) return;
    const run = this.run;
    const win = summary.result === 'win';
    const record = run.records[run.matchIndex];
    const attempts = record?.attempts ?? 1;
    const last = run.phase === 'complete';
    const actions: HTMLButtonElement[] = win
      ? [
          button({
            label: last ? '查看整轮结算' : '选择奖励',
            kind: 'primary',
            size: 'big',
            icon: 'play',
            hotkey: 'Enter',
            onClick: () => (last ? this.showSummary() : this.showReward()),
            testId: 'result-next',
          }),
        ]
      : [
          button({
            label: '调整配置再试',
            kind: 'primary',
            size: 'big',
            hotkey: 'Enter',
            onClick: () => this.enterPrep(),
            testId: 'result-adjust',
          }),
          button({
            label: '原样再来',
            size: 'big',
            hotkey: 'R',
            onClick: () => this.retrySame(),
            testId: 'result-retry',
          }),
        ];
    const icons: Record<string, Parameters<typeof uiIcon>[0]> = {
      echo: 'echo',
      source: 'source',
      unit: 'unit',
      warn: 'warn',
      time: 'time',
      info: 'info',
    };
    mount(
      this.host.overlay,
      h(
        'div',
        { class: 'overlay-center' },
        h(
          'div',
          { class: cx('result-card', win ? 'result-win' : 'result-lose'), 'data-testid': 'result' },
          h('h2', null, win ? '胜利！' : '这场没赢'),
          h(
            'p',
            { class: 'result-sub' },
            `${currentEncounter(run).name} · 用时 ${summary.time}${attempts > 1 ? ` · 第 ${attempts} 次尝试` : ''}`,
          ),
          h(
            'ul',
            { class: 'insights' },
            ...summary.lines.map((line) =>
              h('li', null, uiIcon(icons[line.icon] ?? 'info', 18), h('span', null, line.text)),
            ),
          ),
          win
            ? null
            : h('p', { class: 'muted' }, '对手和随机条件与上一次相同，改动的效果可以直接比较。'),
          h('div', { class: 'result-actions' }, ...actions),
        ),
      ),
    );
  }

  showReward(): void {
    const run = this.run;
    if (run.phase !== 'reward' || !run.offers) {
      this.enterPrep();
      return;
    }
    this.view = 'reward';
    this.rewardPick = null;
    this.host.audio.setMusic('menu');
    this.host.audio.setDucked(false);
    if (this.host.arena.mode !== 'ended') {
      // 从存档恢复到奖励阶段时，背景显示刚打过的那一场。
      this.host.arena.looks = this.looks();
      this.host.arena.showPrep(battleConfig(run));
    }
    this.renderTopbar();
    mount(this.host.side);
    mount(this.host.stageTop);
    mount(this.host.stageBottom);
    this.host.side.dataset.mode = 'hidden';
    this.renderReward();
  }

  private renderReward(): void {
    const run = this.run;
    const offers = run.offers ?? [];
    const next = nextEncounter(run);
    const cards = offers.map((offer, i) => {
      const def = MODULE_DEFS[offer.id];
      const upgrade = offer.kind === 'upgrade';
      const on = this.rewardPick === offer.id;
      return h(
        'button',
        {
          type: 'button',
          class: cx('offer', on && 'offer-on', upgrade && 'offer-up'),
          style: { borderColor: on ? FAMILY_COLORS[def.family] : undefined },
          'data-testid': `offer-${offer.id}`,
          'aria-pressed': on ? 'true' : 'false',
          onClick: () => {
            this.rewardPick = offer.id;
            this.host.audio.ui('select');
            this.renderReward();
          },
        },
        h('span', { class: 'offer-badge' }, upgrade ? '进阶' : '新招式'),
        moduleIcon(offer.id, 56),
        h('b', { class: 'offer-name' }, upgrade ? `${def.name}·${def.levels[1].title}` : def.name),
        h('span', { class: 'tags' }, `${moduleTypeLabel(def)} · ${moduleOwnerLabel(def)}`),
        h('p', { class: 'does' }, upgrade ? def.levels[1].does : def.levels[0].does),
        h('p', { class: 'changes' }, def.changes),
        h('span', { class: 'offer-key' }, kbd(String(i + 1))),
      );
    });
    mount(
      this.host.overlay,
      h(
        'div',
        { class: 'overlay-center dim' },
        h(
          'div',
          { class: 'reward', 'data-testid': 'reward' },
          h('div', { class: 'card-kicker' }, `第 ${run.matchIndex + 1} 场胜利 · 奖励`),
          h('h2', null, '选一个招式带进下一场'),
          next
            ? h(
                'p',
                { class: 'reward-next' },
                h('b', null, `下一场：${next.name}`),
                `　${next.intro}`,
              )
            : null,
          h('div', { class: 'offer-row' }, ...cards),
          h(
            'div',
            { class: 'reward-actions' },
            button({
              label: this.rewardPick
                ? `就选「${MODULE_DEFS[this.rewardPick].name}」`
                : '先点一张卡',
              kind: 'primary',
              size: 'big',
              hotkey: 'Enter',
              disabled: !this.rewardPick,
              onClick: () => this.confirmReward(),
              testId: 'reward-confirm',
            }),
          ),
        ),
      ),
    );
  }

  private confirmReward(): void {
    const id = this.rewardPick;
    if (!id) return;
    const before = this.run;
    const run = pickReward(before, id);
    if (run === before) return;
    this.setRun(run, true);
    this.host.audio.ui('reward');
    const def = MODULE_DEFS[id];
    const at = findEquipped(run.loadout, id);
    if (before.levels[id]) this.host.toast(`「${def.name}」已进阶：${def.levels[1].title}`);
    else if (at) this.host.toast(`「${def.name}」已装到${unitDef(at.unit).name}的槽位`);
    else this.host.toast(`「${def.name}」已放进招式库（槽位满了，可以在战前替换）`);
    this.selection = at ? { kind: 'slot', unit: at.unit, slot: at.slot } : { kind: 'module', id };
    this.enterPrep();
  }

  showSummary(): void {
    const run = this.run;
    this.view = 'summary';
    this.host.persistence.update((d) => {
      if (!d.run || d.run.phase !== 'complete' || d.run.inBattle) return;
      // 只在第一次看到结算时计入记录。
      const key = `cleared-${d.run.startedAt}`;
      if (d.settings.seenHints.includes(key)) return;
      d.settings.seenHints = [
        ...d.settings.seenHints.filter((x) => !x.startsWith('cleared-')),
        key,
      ];
      d.records.runsCompleted++;
      d.records.fastestClear =
        d.records.fastestClear === null
          ? d.run.battleTime
          : Math.min(d.records.fastestClear, d.run.battleTime);
      if (!d.records.clearedDifficulties.includes(d.run.difficulty)) {
        d.records.clearedDifficulties = [...d.records.clearedDifficulties, d.run.difficulty];
      }
    }, true);
    this.host.audio.setMusic('menu');
    this.host.audio.setDucked(false);
    this.renderTopbar();
    mount(this.host.side);
    mount(this.host.stageTop);
    mount(this.host.stageBottom);
    this.host.side.dataset.mode = 'hidden';
    const s = summarizeRun(run);
    mount(
      this.host.overlay,
      h(
        'div',
        { class: 'overlay-center dim' },
        h(
          'div',
          { class: 'summary', 'data-testid': 'summary' },
          h(
            'div',
            { class: 'card-kicker' },
            `${DIFFICULTY_LABEL[run.difficulty]} · ${RUN_LENGTH} 场全胜`,
          ),
          h('h2', null, '回声杯冠军！'),
          h(
            'div',
            { class: 'summary-stats' },
            stat('战斗时间', s.time),
            stat('重试次数', String(s.retries)),
            stat('最长回响', `×${s.bestEcho}`),
          ),
          h('h3', null, '你靠什么赢的'),
          h(
            'ul',
            { class: 'bars' },
            ...s.topSources.map((src) =>
              h(
                'li',
                null,
                h('span', null, src.name),
                h('i', { style: { width: `${src.share}%` } }),
                h('b', null, `${src.share}%`),
              ),
            ),
          ),
          h('h3', null, '最终配置'),
          h(
            'div',
            { class: 'final-loadout' },
            ...PLAYER_UNITS.map((kind) =>
              h(
                'div',
                { class: 'final-unit' },
                h('img', { class: 'portrait sm', src: portrait(kind, this.looks()), alt: '' }),
                ...(run.loadout[kind].filter(Boolean) as ModuleId[]).map((m) => moduleIcon(m, 26)),
              ),
            ),
          ),
          s.untried.length > 0 ? h('h3', null, '换个思路再来') : null,
          s.untried.length > 0
            ? h('p', { class: 'muted' }, `这一轮没用过：${s.untried.join('、')}。`)
            : null,
          h(
            'div',
            { class: 'result-actions' },
            button({
              label: '再来一轮',
              kind: 'primary',
              size: 'big',
              onClick: () => this.host.newRun(),
              testId: 'summary-again',
            }),
            button({
              label: '回到标题',
              size: 'big',
              onClick: () => this.host.goTitle(),
              testId: 'summary-title',
            }),
          ),
        ),
      ),
    );
  }

  // ---- 菜单与按键 ----

  openMenu(): void {
    const arena = this.host.arena;
    if (this.view === 'battle' && arena.mode === 'battle' && !arena.paused)
      this.togglePause('user');
    const items: Array<{
      label: string;
      action: () => void;
      hotkey?: string;
      kind?: 'primary' | 'danger';
    }> = [{ label: '继续', action: () => this.host.closeModal(), hotkey: 'Esc', kind: 'primary' }];
    if (this.view === 'battle') {
      items.push({
        label: '重新开始这一场',
        action: () => {
          this.host.closeModal();
          this.startBattle();
        },
      });
      items.push({
        label: '回到战前准备',
        action: () => {
          this.host.closeModal();
          this.enterPrep();
        },
      });
    }
    items.push({ label: '设置', action: () => this.host.openSettings() });
    items.push({
      label: '回到标题（进度已保存）',
      action: () => {
        this.host.closeModal();
        this.host.goTitle();
      },
    });
    this.host.openMenu(items);
  }

  onKey(e: KeyboardEvent): boolean {
    const arena = this.host.arena;
    const key = e.key;
    if (this.view === 'prep') {
      if (key === 'Enter') {
        this.startBattle();
        return true;
      }
      if (key === 'Escape') {
        if (this.selection || arena.selected) {
          this.selection = null;
          arena.select(null);
          this.renderPrepSide();
        } else this.openMenu();
        return true;
      }
      return false;
    }
    if (this.view === 'battle') {
      if (key === ' ' || e.code === 'Space') {
        this.togglePause('user');
        return true;
      }
      if (key === '1' || key === '2' || key === '3') {
        const kind = PLAYER_UNITS[Number(key) - 1] as PlayerUnitKind;
        this.tryTarget(kind);
        return true;
      }
      if (key === 'f' || key === 'F') {
        arena.toggleSpeed();
        return true;
      }
      if (key === 'Escape') {
        if (arena.targeting) {
          arena.cancelTargeting();
          this.renderBanner();
        } else this.openMenu();
        return true;
      }
      return false;
    }
    if (this.view === 'result' && this.summary) {
      if (key === 'Enter') {
        if (this.summary.result === 'win') {
          if (this.run.phase === 'complete') this.showSummary();
          else this.showReward();
        } else this.enterPrep();
        return true;
      }
      if ((key === 'r' || key === 'R') && this.summary.result === 'lose') {
        this.retrySame();
        return true;
      }
      if (key === 'Escape') {
        this.openMenu();
        return true;
      }
    }
    if (this.view === 'reward') {
      const offers = this.run.offers ?? [];
      const index = Number(key) - 1;
      if (index >= 0 && index < offers.length) {
        this.rewardPick = (offers[index] as { id: ModuleId }).id;
        this.host.audio.ui('select');
        this.renderReward();
        return true;
      }
      if (key === 'Enter' && this.rewardPick) {
        this.confirmReward();
        return true;
      }
    }
    if (key === 'Escape') {
      this.openMenu();
      return true;
    }
    return false;
  }

  /** 设置变化后刷新依赖设置的部分。 */
  applySettings(): void {
    this.host.arena.reduceFlashes = this.settings.reduceFlashes;
    this.renderTopbar();
  }

  get currentView(): View {
    return this.view;
  }
}

function stat(label: string, value: string): Node {
  return h('div', { class: 'stat' }, h('span', null, label), h('b', null, value));
}
