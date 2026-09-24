// 竞技场控制器：推进模拟、处理画布上的鼠标/触控板操作、把事件交给画面与声音。
import { MODULE_DEFS } from '../core/content/modules.js';
import { ARENA, SIM } from '../core/content/tuning.js';
import { clamp, dist } from '../core/math.js';
import type { SimEvent } from '../core/sim/events.js';
import { World, type BattleConfig } from '../core/sim/world.js';
import type { Formation, GadgetPlacement, PlayerUnitKind } from '../core/types.js';
import { PLAYER_UNITS } from '../core/types.js';
import type { Looks, Renderer, TargetPreview } from '../render/renderer.js';
import { UNIT_DRAW_SCALE } from '../render/units.js';

export type ArenaMode = 'idle' | 'demo' | 'prep' | 'battle' | 'ended';

export interface ArenaHooks {
  /** 每批模拟事件（声音、界面提示）。 */
  onEvents?(events: SimEvent[], world: World): void;
  /** 战前拖动结束，站位发生变化。 */
  onFormation?(formation: Formation): void;
  /** 选中的队员变化（战前）。 */
  onSelect?(kind: PlayerUnitKind | null): void;
  /** 战斗结束后的慢动作收尾结束。 */
  onBattleEnd?(world: World): void;
  /** 集火、瞄准等状态变化，界面需要刷新。 */
  onChange?(): void;
}

type Drag =
  | { kind: 'unit'; unit: PlayerUnitKind; moved: boolean }
  | { kind: 'gadget'; module: GadgetPlacement['module']; index: number; moved: boolean };

const END_SLOWMO = 1.4;

export class ArenaController {
  readonly renderer: Renderer;
  hooks: ArenaHooks = {};
  world: World | null = null;
  mode: ArenaMode = 'idle';
  paused = false;
  speed = 1;
  targeting: PlayerUnitKind | null = null;
  looks: Looks = { shield: false, armor: false, booster: false, bellCharm: 'bow' };
  reduceFlashes = false;
  selected: PlayerUnitKind | null = null;
  hoverEnemyId = 0;
  private hoverUnitId = 0;
  private pointer = { x: 0, y: 0, inside: false };
  private acc = 0;
  private idleTime = 0;
  private endTimer = 0;
  private endNotified = false;
  private drag: Drag | null = null;
  private formation: Formation | null = null;
  private demoStep: ((world: World) => void) | null = null;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /** 战前准备：只摆放不推进。 */
  showPrep(config: BattleConfig): void {
    this.world = new World(config);
    this.formation = structuredClone(config.formation);
    this.mode = 'prep';
    this.paused = false;
    this.targeting = null;
    this.drag = null;
    this.renderer.resetScene();
  }

  startBattle(config: BattleConfig): void {
    this.world = new World(config);
    this.formation = null;
    this.mode = 'battle';
    this.paused = false;
    this.targeting = null;
    this.selected = null;
    this.acc = 0;
    this.endTimer = 0;
    this.endNotified = false;
    this.renderer.resetScene();
  }

  /** 标题画面背景里的示范对局。 */
  startDemo(config: BattleConfig, step: (world: World) => void): void {
    this.world = new World(config);
    this.demoStep = step;
    this.mode = 'demo';
    this.paused = false;
    this.acc = 0;
    this.renderer.resetScene();
  }

  clear(): void {
    this.world = null;
    this.mode = 'idle';
    this.targeting = null;
    this.renderer.resetScene();
  }

  setPaused(paused: boolean): void {
    if (this.mode !== 'battle') return;
    this.paused = paused;
    this.hooks.onChange?.();
  }

  toggleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : 1;
    this.hooks.onChange?.();
  }

  // ---- 主动招式与集火 ----

  canCast(kind: PlayerUnitKind): boolean {
    const u = this.world?.playerUnit(kind);
    return this.mode === 'battle' && !!u && u.alive && !!u.active && u.activeCd <= 0;
  }

  beginTargeting(kind: PlayerUnitKind): boolean {
    if (!this.canCast(kind)) return false;
    this.targeting = this.targeting === kind ? null : kind;
    this.hooks.onChange?.();
    return true;
  }

  cancelTargeting(): void {
    if (!this.targeting) return;
    this.targeting = null;
    this.hooks.onChange?.();
  }

  private castAt(x: number, y: number): void {
    const kind = this.targeting;
    if (!kind || !this.world) return;
    const ok = this.world.castActive(kind, x, y);
    this.targeting = null;
    this.flushEvents();
    if (ok) this.hooks.onChange?.();
  }

  /** 测试用：立即推进若干秒（仍会产生画面与声音事件）。 */
  fastForward(seconds: number): void {
    const world = this.world;
    if (!world || (this.mode !== 'battle' && this.mode !== 'ended')) return;
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps && !world.result; i++) {
      world.step();
      this.flushEvents();
    }
  }

  // ---- 每帧 ----

  frame(dt: number): void {
    const world = this.world;
    if (!world) {
      this.renderer.draw(null, this.drawOptions());
      return;
    }
    if (this.mode === 'prep' || this.mode === 'idle') {
      this.idleTime += dt;
      this.renderer.fx.update(dt);
    } else if (this.mode === 'demo') {
      this.advance(world, dt, 1);
      if (world.result && world.t - world.resultTime > 2.5) this.demoStep?.(world);
    } else if (this.mode === 'battle' || this.mode === 'ended') {
      if (!this.paused) {
        let scale = this.speed;
        if (this.targeting) scale *= 0.3;
        if (this.renderer.fx.hitstop > 0) scale *= 0.25;
        if (this.mode === 'ended') scale = 0.35;
        this.advance(world, dt, scale);
      }
      if (world.result && this.mode === 'battle') {
        this.mode = 'ended';
        this.targeting = null;
        this.endTimer = 0;
        this.hooks.onChange?.();
      }
      if (this.mode === 'ended' && !this.endNotified) {
        this.endTimer += dt;
        if (this.endTimer >= END_SLOWMO) {
          this.endNotified = true;
          this.hooks.onBattleEnd?.(world);
        }
      }
    }
    this.renderer.draw(world, this.drawOptions());
  }

  private advance(world: World, dt: number, scale: number): void {
    this.acc += dt * scale;
    let steps = 0;
    while (this.acc >= SIM.dt && steps < 10) {
      if (this.mode === 'demo' && world.tick % 12 === 0) this.demoStep?.(world);
      world.step();
      this.acc -= SIM.dt;
      steps++;
      this.flushEvents();
    }
    if (steps === 10) this.acc = 0;
    this.renderer.fx.update(dt * Math.min(1.5, scale || 1));
  }

  private flushEvents(): void {
    const world = this.world;
    if (!world || world.events.length === 0) return;
    const events = world.drainEvents();
    for (const e of events) {
      if (e.type === 'spawn') this.renderer.markSpawn(e.unitId, world.t);
    }
    this.renderer.fx.handle(events, (id) => world.unitById(id)?.kind);
    this.hooks.onEvents?.(events, world);
  }

  private drawOptions() {
    const world = this.world;
    const battle = this.mode === 'battle' || this.mode === 'ended' || this.mode === 'demo';
    let targeting: TargetPreview | null = null;
    if (this.targeting && world && this.pointer.inside) {
      const u = world.playerUnit(this.targeting);
      const module = u?.active;
      if (u && (module === 'charge' || module === 'pierce' || module === 'vortex')) {
        targeting = {
          module,
          fromX: u.x,
          fromY: u.y,
          x: clamp(this.pointer.x, 0, ARENA.width),
          y: clamp(this.pointer.y, 0, ARENA.height),
          level: world.level(module),
        };
      }
    }
    return {
      mode:
        this.mode === 'demo'
          ? ('title' as const)
          : battle
            ? ('battle' as const)
            : ('prep' as const),
      time: battle && world ? world.t + this.acc : this.idleTime,
      alpha: battle ? clamp(this.acc / SIM.dt, 0, 1) : 1,
      looks: this.looks,
      showZones: this.mode === 'prep',
      gadgetZone: this.mode === 'prep' && (this.formation?.gadgets.length ?? 0) > 0,
      selectedId: this.selected && world ? (world.playerUnit(this.selected)?.id ?? 0) : 0,
      hoverId: this.mode === 'prep' ? this.hoverUnitId : this.hoverEnemyId,
      targeting,
      reduceFlashes: this.reduceFlashes,
      showBars: this.mode !== 'demo',
    };
  }

  // ---- 指针 ----

  pointerMove(x: number, y: number, inside: boolean): string {
    this.pointer = { x, y, inside };
    const world = this.world;
    if (!world) return 'default';
    if (this.mode === 'prep') return this.prepMove(world, x, y);
    if (this.mode === 'battle') {
      if (this.targeting) return 'crosshair';
      const enemy = this.enemyAt(world, x, y);
      const id = enemy?.id ?? 0;
      if (id !== this.hoverEnemyId) this.hoverEnemyId = id;
      return enemy ? 'pointer' : 'default';
    }
    return 'default';
  }

  pointerDown(x: number, y: number, button: number): void {
    const world = this.world;
    if (!world) return;
    if (this.mode === 'battle') {
      if (this.targeting) {
        if (button === 0) this.castAt(x, y);
        else this.cancelTargeting();
        return;
      }
      if (button !== 0) return;
      const enemy = this.enemyAt(world, x, y);
      if (enemy) {
        world.setFocus(world.focusId === enemy.id ? 0 : enemy.id);
        this.flushEvents();
        this.hooks.onChange?.();
      }
      return;
    }
    if (this.mode === 'prep' && button === 0) this.prepDown(world, x, y);
  }

  pointerUp(): void {
    if (this.mode !== 'prep' || !this.drag) return;
    const drag = this.drag;
    this.drag = null;
    if (drag.moved && this.formation) this.hooks.onFormation?.(structuredClone(this.formation));
  }

  pointerLeave(): void {
    this.pointer.inside = false;
    this.hoverEnemyId = 0;
    this.hoverUnitId = 0;
  }

  private enemyAt(world: World, x: number, y: number) {
    let best = null;
    let bestD = Infinity;
    for (const u of world.units) {
      if (!u.alive || u.team !== 1) continue;
      const d = dist(x, y, u.x, u.y - u.radius * 0.4);
      if (d < u.radius * UNIT_DRAW_SCALE + 12 && d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  private playerAt(world: World, x: number, y: number): PlayerUnitKind | null {
    for (const kind of PLAYER_UNITS) {
      const u = world.playerUnit(kind);
      if (u && dist(x, y, u.x, u.y - u.radius * 0.4) < u.radius * UNIT_DRAW_SCALE + 10) return kind;
    }
    return null;
  }

  private gadgetAt(world: World, x: number, y: number) {
    return (
      world.obstacles.find((o) => o.kind !== 'pillar' && dist(x, y, o.x, o.y) < o.r + 12) ?? null
    );
  }

  private prepMove(world: World, x: number, y: number): string {
    const drag = this.drag;
    if (drag && this.formation) {
      drag.moved = true;
      if (drag.kind === 'unit') {
        const u = world.playerUnit(drag.unit);
        const px = clamp(x, 30, ARENA.playerZoneMaxX);
        const py = clamp(y, 30, ARENA.height - 30);
        if (u) {
          u.x = u.px = px;
          u.y = u.py = py;
        }
        this.formation.units[drag.unit] = { x: px, y: py };
      } else {
        const gx = clamp(x, ARENA.margin, ARENA.gadgetZoneMaxX);
        const gy = clamp(y, ARENA.margin, ARENA.height - ARENA.margin);
        const placement = this.formation.gadgets.find(
          (g) => g.module === drag.module && g.index === drag.index,
        );
        if (placement) {
          placement.x = gx;
          placement.y = gy;
        }
        const obstacles = world.obstacles.filter((o) => o.kind === drag.module);
        const ob = obstacles[drag.index];
        if (ob) {
          ob.x = gx;
          ob.y = gy;
        }
      }
      return 'grabbing';
    }
    const kind = this.playerAt(world, x, y);
    this.hoverUnitId = kind ? (world.playerUnit(kind)?.id ?? 0) : 0;
    if (kind || this.gadgetAt(world, x, y)) return 'grab';
    if (this.selected && x <= ARENA.playerZoneMaxX) return 'copy';
    return 'default';
  }

  private prepDown(world: World, x: number, y: number): void {
    const kind = this.playerAt(world, x, y);
    if (kind) {
      this.drag = { kind: 'unit', unit: kind, moved: false };
      this.select(kind);
      return;
    }
    const gadget = this.gadgetAt(world, x, y);
    if (gadget && (gadget.kind === 'mirrorpost' || gadget.kind === 'spring')) {
      const index = world.obstacles.filter((o) => o.kind === gadget.kind).indexOf(gadget);
      this.drag = { kind: 'gadget', module: gadget.kind, index, moved: false };
      return;
    }
    // 先点队员、再点空地：把它放过去（触控板上比拖动更省力）。
    if (this.selected && x <= ARENA.playerZoneMaxX + 20 && this.formation) {
      const u = world.playerUnit(this.selected);
      const px = clamp(x, 30, ARENA.playerZoneMaxX);
      const py = clamp(y, 30, ARENA.height - 30);
      if (u) {
        u.x = u.px = px;
        u.y = u.py = py;
      }
      this.formation.units[this.selected] = { x: px, y: py };
      this.hooks.onFormation?.(structuredClone(this.formation));
      return;
    }
    this.select(null);
  }

  select(kind: PlayerUnitKind | null): void {
    if (this.selected === kind) return;
    this.selected = kind;
    this.hooks.onSelect?.(kind);
  }

  /** 当前可发动的主动招式名（界面按钮用）。 */
  activeName(kind: PlayerUnitKind): string | null {
    const id = this.world?.playerUnit(kind)?.active;
    return id ? MODULE_DEFS[id].name : null;
  }
}
