// 战斗世界：固定步长推进，所有随机都来自种子，便于重试比较与测试复现。
import type { EncounterDef, Wave } from '../content/encounters.js';
import { gadgetCount, MODULE_DEFS } from '../content/modules.js';
import { ARENA, DIFFICULTY_MULT, MODULE_TUNING, SIM } from '../content/tuning.js';
import { unitDef } from '../content/units.js';
import { clamp, dist, normalize } from '../math.js';
import { hashSeed, Rng } from '../rng.js';
import {
  PLAYER_UNITS,
  type DamageSource,
  type Difficulty,
  type Formation,
  type Loadout,
  type ModuleId,
  type ModuleLevel,
  type PlayerUnitKind,
  type Team,
  type UnitKind,
} from '../types.js';
import { updateUnit } from './ai.js';
import type {
  Lob,
  Obstacle,
  PendingBlast,
  Projectile,
  SlideInfo,
  Unit,
  Vortex,
} from './entities.js';
import type { SimEvent } from './events.js';
import { integrate } from './physics.js';
import { updateProjectiles } from './projectiles.js';
import { addTo, createStats, type BattleStats } from './stats.js';

export interface BattleConfig {
  encounter: EncounterDef;
  seed: number;
  difficulty: Difficulty;
  /** 本轮第几场（0 起），用于轻微的强度递增。 */
  matchIndex: number;
  loadout: Loadout;
  /** 已拥有招式的等级。 */
  levels: Partial<Record<ModuleId, ModuleLevel>>;
  formation: Formation;
}

export interface DamageInfo {
  /** 造成伤害的一方。 */
  team: Team;
  source: DamageSource;
  echo: number;
  chain: number;
  attackerKind?: UnitKind;
}

/** 伤害来源归到哪名队员（团队招式不归属任何人）。 */
const SOURCE_OWNER: Partial<Record<DamageSource, PlayerUnitKind>> = {
  guard: 'guard',
  reflect: 'guard',
  charge: 'guard',
  slinger: 'slinger',
  ricochet: 'slinger',
  rubber: 'slinger',
  heavy: 'slinger',
  pierce: 'slinger',
  bell: 'bell',
  vortex: 'bell',
  magnet: 'bell',
};

export const MATCH_SCALING = 0.04;

export class World {
  readonly width = ARENA.width;
  readonly height = ARENA.height;
  readonly config: BattleConfig;
  readonly rng: Rng;
  /** 已装备招式的等级（没装备的招式不生效）。 */
  readonly equipped: Partial<Record<ModuleId, ModuleLevel>>;
  readonly enemyHpMult: number;
  readonly enemyDamageMult: number;

  t = 0;
  tick = 0;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  obstacles: Obstacle[] = [];
  vortexes: Vortex[] = [];
  lobs: Lob[] = [];
  blasts: PendingBlast[] = [];
  events: SimEvent[] = [];
  stats: BattleStats = createStats();
  result: 'win' | 'lose' | null = null;
  resultTime = 0;
  focusId = 0;
  overtimeLevel = 0;
  /** 木箭手齐射的公共节拍。 */
  volleyClock = 1.4;

  private nextId = 1;
  private nextChainId = 1;
  private spawnCount = 0;
  private waves: Wave[];
  private chainInfo = new Map<number, { max: number; sources: DamageSource[] }>();

  constructor(config: BattleConfig) {
    this.config = config;
    this.rng = new Rng(hashSeed(config.seed, 'battle', config.encounter.id));
    const diff = DIFFICULTY_MULT[config.difficulty];
    this.enemyHpMult = diff.enemyHp * (1 + MATCH_SCALING * config.matchIndex);
    this.enemyDamageMult = diff.enemyDamage;
    this.equipped = equippedLevels(config.loadout, config.levels);
    this.waves = [...(config.encounter.waves ?? [])].sort((a, b) => a.at - b.at);

    for (const o of config.encounter.obstacles ?? []) {
      this.obstacles.push({ id: this.nextId++, kind: 'pillar', x: o.x, y: o.y, r: o.r, hitAt: -9 });
    }
    for (const g of config.formation.gadgets) {
      const level = this.equipped[g.module];
      if (!level || g.index >= gadgetCount(level)) continue;
      const r = MODULE_TUNING[g.module].radius;
      const x = clamp(g.x, ARENA.margin, ARENA.gadgetZoneMaxX);
      const y = clamp(g.y, ARENA.margin, ARENA.height - ARENA.margin);
      this.obstacles.push({ id: this.nextId++, kind: g.module, x, y, r, hitAt: -9 });
    }

    for (const kind of PLAYER_UNITS) {
      const p = config.formation.units[kind];
      const def = unitDef(kind);
      const x = clamp(p.x, def.radius + 8, ARENA.playerZoneMaxX);
      const y = clamp(p.y, def.radius + 8, ARENA.height - def.radius - 8);
      this.spawnUnit(kind, x, y, false);
    }
    for (const e of config.encounter.enemies) {
      this.spawnUnit(e.kind, e.x, e.y, false);
    }
  }

  // ---- 查询 ----

  level(id: ModuleId): number {
    return this.equipped[id] ?? 0;
  }

  unitById(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  playerUnit(kind: PlayerUnitKind): Unit | undefined {
    return this.units.find((u) => u.kind === kind && u.team === 0);
  }

  aliveOf(team: Team): Unit[] {
    return this.units.filter((u) => u.alive && u.team === team);
  }

  overtimeMult(): number {
    return 1 + SIM.overtimeBonus * this.overtimeLevel;
  }

  newChain(): number {
    return this.nextChainId++;
  }

  newId(): number {
    return this.nextId++;
  }

  emit(event: SimEvent): void {
    this.events.push(event);
  }

  /** 取出并清空本批事件（表现层每帧调用）。 */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---- 推进 ----

  step(): void {
    const dt = SIM.dt;
    this.t += dt;
    this.tick++;

    for (const u of this.units) {
      u.px = u.x;
      u.py = u.y;
    }
    this.spawnWaves();
    this.updateOvertime();
    this.updateVolley(dt);

    for (const u of this.units) {
      if (u.alive) updateUnit(this, u, dt);
    }
    this.updateVortexes(dt);
    this.updateLobs(dt);
    this.updateBlasts(dt);
    integrate(this, dt);
    updateProjectiles(this, dt);

    if (this.tick % 60 === 0) this.compact();
    this.checkResult();
  }

  /** 连续推进若干秒（测试和平衡脚本使用）。 */
  run(seconds: number): void {
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps; i++) this.step();
  }

  private spawnWaves(): void {
    while (this.waves.length > 0 && (this.waves[0] as Wave).at <= this.t) {
      const wave = this.waves.shift() as Wave;
      for (const e of wave.units) this.spawnUnit(e.kind, e.x, e.y, true);
    }
  }

  private updateOvertime(): void {
    if (this.t < SIM.overtimeStart) return;
    const level = Math.floor((this.t - SIM.overtimeStart) / SIM.overtimeStep) + 1;
    if (level !== this.overtimeLevel) {
      this.overtimeLevel = level;
      this.emit({ type: 'overtime', level });
    }
  }

  private updateVolley(dt: number): void {
    this.volleyClock -= dt;
    if (this.volleyClock > 0) return;
    this.volleyClock = unitDef('archer').cooldown;
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (const u of this.units) {
      if (!u.alive || u.kind !== 'archer' || u.slide || u.held || u.stun > 0) continue;
      if (u.state === 'windup') continue;
      const target = this.unitById(u.targetId);
      if (!target || !target.alive) continue;
      if (dist(u.x, u.y, target.x, target.y) > u.def.range) continue;
      u.state = 'windup';
      u.stateTime = u.def.windup;
      u.aimX = target.x;
      u.aimY = target.y;
      count++;
      sx += u.x;
      sy += u.y;
    }
    if (count > 0) this.emit({ type: 'volley', x: sx / count, y: sy / count, count });
  }

  private updateVortexes(dt: number): void {
    const tune = MODULE_TUNING.vortex;
    for (const u of this.units) u.held = false;
    for (const v of this.vortexes) {
      v.time += dt;
      for (const u of this.units) {
        if (!u.alive || u.team !== 1 || u.def.immovable) continue;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const d = Math.hypot(dx, dy);
        if (d > v.r + u.radius) continue;
        u.held = true;
        if (u.state === 'windup') this.interrupt(u);
        // 以稳定速度吸向中心（先抵消本步摩擦），越靠近中心越慢，避免来回穿过。
        const n = normalize(dx, dy);
        const falloff = clamp(d / 60, 0.1, 1);
        const speed = (tune.pullSpeed / Math.sqrt(u.mass)) * falloff + SIM.friction * dt;
        u.vx = n.x * speed;
        u.vy = n.y * speed;
        if (!u.slide) u.slide = { team: 0, echo: 0, chain: v.chain, source: 'vortex' };
      }
      if (v.time >= v.duration) {
        const burst = v.level >= 2;
        if (burst) {
          this.blasts.push({
            x: v.x,
            y: v.y,
            radius: v.r * 0.75,
            damage: tune.burstDamage,
            knock: tune.burstKnock,
            delay: 0,
            team: 0,
            echo: 0,
            chain: v.chain,
            source: 'vortex',
            hitsAll: false,
            ignoreId: 0,
          });
        }
        this.emit({ type: 'vortexEnd', x: v.x, y: v.y, burst });
      }
    }
    this.vortexes = this.vortexes.filter((v) => v.time < v.duration);
  }

  private updateLobs(dt: number): void {
    for (const lob of this.lobs) {
      lob.time += dt;
      if (lob.time < lob.duration) continue;
      this.emit({ type: 'lobLand', x: lob.x, y: lob.y, radius: lob.r });
      const chain = this.newChain();
      for (const u of this.units) {
        if (!u.alive || u.team !== 0) continue;
        const d = dist(lob.x, lob.y, u.x, u.y);
        if (d > lob.r + u.radius) continue;
        const falloff = 1 - 0.4 * clamp(d / lob.r, 0, 1);
        this.damage(u, lob.damage * falloff, {
          team: 1,
          source: 'enemy',
          echo: 0,
          chain,
          attackerKind: 'mortar',
        });
        const n = normalize(u.x - lob.x, u.y - lob.y, 1, 0);
        this.knock(u, n.x, n.y, lob.knock * falloff, {
          team: 1,
          echo: 0,
          chain,
          source: 'enemy',
        });
      }
    }
    this.lobs = this.lobs.filter((lob) => lob.time < lob.duration);
  }

  private updateBlasts(dt: number): void {
    if (this.blasts.length === 0) return;
    const ready: PendingBlast[] = [];
    const waiting: PendingBlast[] = [];
    for (const b of this.blasts) {
      b.delay -= dt;
      (b.delay <= 0 ? ready : waiting).push(b);
    }
    this.blasts = waiting;
    for (const b of ready) this.explode(b);
  }

  private compact(): void {
    // 倒下超过 3 秒的对手移出列表，保持遍历成本稳定；我方队员始终保留（界面要显示）。
    this.units = this.units.filter((u) => u.alive || u.team === 0 || this.t - u.diedAt < 3);
  }

  private checkResult(): void {
    if (this.result) return;
    const enemiesAlive = this.units.some((u) => u.alive && u.team === 1);
    const playersAlive = this.units.some((u) => u.alive && u.team === 0);
    if (!enemiesAlive && this.waves.length === 0) this.finish('win');
    else if (!playersAlive) this.finish('lose');
    else if (this.t >= SIM.timeLimit) {
      this.stats.timeout = true;
      this.finish('lose');
    }
  }

  private finish(result: 'win' | 'lose'): void {
    this.result = result;
    this.resultTime = this.t;
    this.stats.result = result;
    this.stats.duration = this.t;
    this.emit({ type: 'end', result });
  }

  /** 剩余对手生命占比（含尚未出场的波次），失败结算用。 */
  enemyHpRemainingRatio(): number {
    let remaining = 0;
    for (const u of this.units) if (u.alive && u.team === 1) remaining += u.hp;
    for (const wave of this.waves) {
      for (const e of wave.units) remaining += unitDef(e.kind).hp * this.enemyHpMult;
    }
    let total = this.stats.enemyTotalHp;
    for (const wave of this.waves) {
      for (const e of wave.units) total += unitDef(e.kind).hp * this.enemyHpMult;
    }
    return total > 0 ? remaining / total : 0;
  }

  // ---- 基本动作 ----

  spawnUnit(kind: UnitKind, x: number, y: number, announce: boolean, spawnedBy = 0): Unit {
    const def = unitDef(kind);
    let hp = def.hp;
    if (def.team === 1) hp *= this.enemyHpMult;
    if (kind === 'guard' && this.level('bulwark') > 0) hp *= 1 + MODULE_TUNING.bulwark.hpBonus;
    hp = Math.round(hp);
    const unit: Unit = {
      id: this.nextId++,
      kind,
      def,
      team: def.team,
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      mvx: 0,
      mvy: 0,
      facing: def.team === 0 ? 0 : Math.PI,
      hp,
      maxHp: hp,
      radius: def.radius,
      mass: def.mass,
      speed: def.speed,
      alive: true,
      diedAt: 0,
      state: 'idle',
      stateTime: 0,
      cooldown: def.team === 1 ? def.cooldown * 0.5 : 0,
      targetId: 0,
      aimX: x,
      aimY: y,
      stun: 0,
      slide: null,
      impactCooldown: 0,
      tauntBy: 0,
      tauntTime: 0,
      resonance: 0,
      shieldHp: 0,
      shieldTime: 0,
      held: false,
      rng: new Rng(hashSeed(this.config.seed, this.config.encounter.id, 'unit', this.spawnCount++)),
      shots: 0,
      timerA: kind === 'jack' ? 1.5 : 2,
      timerB: 0,
      timerC: 0,
      phase: kind === 'king' ? 1 : 0,
      pending: '',
      spawnedBy,
      active: def.team === 0 ? activeFor(kind as PlayerUnitKind, this.config.loadout) : null,
      activeCd: 0,
      dashX: 0,
      dashY: 0,
      dashLeft: 0,
      dashHits: [],
      dashChain: 0,
      hitAt: -9,
      attackAt: -9,
      blockAt: -9,
      healAt: -9,
      castAt: -9,
    };
    if (kind === 'guard') unit.timerA = MODULE_TUNING.bulwark.tauntInterval * 0.5;
    this.units.push(unit);
    if (unit.team === 1) {
      this.stats.enemyCount++;
      this.stats.enemyTotalHp += unit.maxHp;
      if (kind === 'snail' && !this.stats.healerKinds.includes('snail')) {
        this.stats.healerKinds.push('snail');
      }
    }
    if (announce) this.emit({ type: 'spawn', unitId: unit.id, kind, x, y });
    return unit;
  }

  damage(target: Unit, base: number, info: DamageInfo): number {
    if (!target.alive || base <= 0) return 0;
    const echo = Math.min(info.echo, SIM.echoCap);
    let amount = base * (1 + SIM.echoBonus * echo);
    if (echo > 0 && target.resonance > 0) amount *= 1 + MODULE_TUNING.magnet.resonance;
    if (info.team === 1 && target.team === 0) amount *= this.enemyDamageMult;
    if (target.kind === 'king' && target.state === 'stunned') amount *= 1.5;
    amount *= this.overtimeMult();

    if (target.shieldHp > 0) {
      const absorbed = Math.min(target.shieldHp, amount);
      target.shieldHp -= absorbed;
      amount -= absorbed;
    }
    amount = Math.min(amount, target.hp);
    target.hp -= amount;
    target.hitAt = this.t;

    if (!this.result) {
      if (target.team === 1) {
        if (info.team === 0) {
          addTo(this.stats.damageBySource, info.source, amount);
          const owner = SOURCE_OWNER[info.source];
          if (owner) this.stats.damageDealtByUnit[owner] += amount;
          if (echo > 0) this.stats.echoHits++;
        } else {
          this.stats.enemyFriendlyFire += amount;
        }
      } else if (target.kind === 'guard' || target.kind === 'slinger' || target.kind === 'bell') {
        this.stats.damageTakenByUnit[target.kind] += amount;
      }
    }

    const killed = target.hp <= 0.001;
    this.emit({
      type: 'hit',
      targetId: target.id,
      x: target.x,
      y: target.y,
      amount,
      echo,
      team: info.team,
      source: info.source,
      killed,
    });
    if (killed) this.kill(target, info);
    return amount;
  }

  kill(target: Unit, info: DamageInfo): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.diedAt = this.t;
    target.state = 'idle';
    target.slide = null;
    target.vx = 0;
    target.vy = 0;
    target.held = false;
    if (this.focusId === target.id) this.focusId = 0;

    if (!this.result) {
      const record = {
        kind: target.kind,
        time: this.t,
        by: info.team === 1 ? (info.attackerKind ?? info.source) : info.source,
      };
      if (target.team === 0) this.stats.playerDeaths.push(record);
      else {
        this.stats.enemyDeaths.push(record);
        if (info.team === 0) addTo(this.stats.killsBySource, info.source, 1);
      }
    }
    this.emit({
      type: 'death',
      unitId: target.id,
      kind: target.kind,
      team: target.team,
      x: target.x,
      y: target.y,
    });

    if (target.kind === 'bomber') {
      const byPlayer = info.team === 0;
      const def = target.def;
      this.blasts.push({
        x: target.x,
        y: target.y,
        radius: 75,
        damage: def.damage,
        knock: def.knock,
        delay: byPlayer ? 0.1 : 0,
        team: byPlayer ? 0 : 1,
        echo: byPlayer ? info.echo + 1 : 0,
        chain: info.chain,
        source: byPlayer ? 'detonate' : 'enemy',
        hitsAll: true,
        ignoreId: target.id,
      });
      return;
    }

    const burst = this.level('burst');
    if (target.team === 1 && info.team === 0 && burst > 0 && (burst >= 2 || info.echo >= 1)) {
      const tune = MODULE_TUNING.burst;
      this.blasts.push({
        x: target.x,
        y: target.y,
        radius: burst >= 2 ? tune.radiusLv2 : tune.radiusLv1,
        damage: tune.damage,
        knock: tune.knock,
        delay: 0.14,
        team: 0,
        echo: info.echo + 1,
        chain: info.chain,
        source: 'burst',
        hitsAll: false,
        ignoreId: target.id,
      });
    }
  }

  heal(target: Unit, amount: number, fromX: number, fromY: number): number {
    if (!target.alive || amount <= 0) return 0;
    const actual = Math.min(amount, target.maxHp - target.hp);
    if (actual <= 0) return 0;
    target.hp += actual;
    target.healAt = this.t;
    if (!this.result) {
      if (target.team === 1) this.stats.enemyHealing += actual;
      else this.stats.playerHealing += actual;
    }
    this.emit({
      type: 'heal',
      targetId: target.id,
      fromX,
      fromY,
      x: target.x,
      y: target.y,
      amount: actual,
    });
    return actual;
  }

  /** 击退：速度变化与质量的平方根成反比；高速滑行期间不能行动。 */
  knock(target: Unit, dx: number, dy: number, power: number, info: SlideInfo): void {
    if (!target.alive || target.def.immovable || power <= 0) return;
    if (target.kind === 'guard' && this.level('bulwark') > 0) return;
    const dv = power / Math.sqrt(target.mass);
    target.vx += dx * dv;
    target.vy += dy * dv;
    const speed = Math.hypot(target.vx, target.vy);
    if (speed > 1500) {
      target.vx *= 1500 / speed;
      target.vy *= 1500 / speed;
    }
    if (speed > SIM.slideSpeed) {
      target.slide = { ...info };
      if (target.state === 'windup' || target.state === 'fuse') this.interrupt(target);
    }
    // 被重重撞到会打转：朝向被打乱，正面的盾牌暂时转开。
    if (dv > 180 && target.team === 1) {
      const spin = Math.min(1.4, dv / 500) * (target.rng.next() < 0.5 ? -1 : 1);
      target.facing += spin;
    }
  }

  /** 打断蓄力（被击飞、被吸住）。爆爆虫的引信不会被打断。 */
  interrupt(u: Unit): void {
    if (u.state === 'fuse') return;
    if (u.state === 'windup') {
      u.state = 'idle';
      u.pending = '';
      u.cooldown = Math.max(u.cooldown, 0.35);
    }
  }

  explode(b: PendingBlast): void {
    this.emit({
      type: 'explode',
      x: b.x,
      y: b.y,
      radius: b.radius,
      echo: b.echo,
      team: b.team,
      source: b.source,
    });
    if (!this.result && b.team === 0) this.stats.blasts++;
    if (b.echo > 0) this.echoEvent(b.x, b.y, b.echo, b.chain, b.source, b.team);
    const targets = this.units.filter((u) => u.alive && u.id !== b.ignoreId);
    for (const u of targets) {
      if (!b.hitsAll && u.team === b.team) continue;
      const d = dist(b.x, b.y, u.x, u.y);
      if (d > b.radius + u.radius) continue;
      const falloff = 1 - 0.45 * clamp(d / b.radius, 0, 1);
      this.damage(u, b.damage * falloff, {
        team: b.team,
        source: b.source,
        echo: b.echo,
        chain: b.chain,
        attackerKind: b.source === 'enemy' ? 'bomber' : undefined,
      });
      const n = normalize(u.x - b.x, u.y - b.y, u.team === 0 ? -1 : 1, 0);
      this.knock(u, n.x, n.y, b.knock * falloff, {
        team: b.team,
        echo: b.echo,
        chain: b.chain,
        source: b.source,
      });
    }
  }

  /** 记录一次回响（等级提升），并更新本场最长回响链。 */
  echoEvent(
    x: number,
    y: number,
    level: number,
    chain: number,
    source: DamageSource,
    team: Team,
  ): void {
    this.emit({ type: 'echo', x, y, level, chain, source });
    if (team !== 0) return;
    const info = this.chainInfo.get(chain) ?? { max: 0, sources: [] };
    if (info.sources[info.sources.length - 1] !== source && info.sources.length < 12) {
      info.sources.push(source);
    }
    info.max = Math.max(info.max, level);
    this.chainInfo.set(chain, info);
    if (!this.result && level > this.stats.maxEcho) {
      this.stats.maxEcho = level;
      this.stats.bestChainSources = info.sources.slice();
    }
  }

  // ---- 玩家输入 ----

  /** 发动某名队员装备的主动招式。成功返回 true。 */
  castActive(kind: PlayerUnitKind, x: number, y: number): boolean {
    const u = this.playerUnit(kind);
    if (!u || !u.alive || !u.active || u.activeCd > 0 || this.result) return false;
    if (u.slide || u.stun > 0 || u.state === 'dash') return false;
    const module = u.active;
    const def = MODULE_DEFS[module];
    const tx = clamp(x, 10, this.width - 10);
    const ty = clamp(y, 10, this.height - 10);
    const level = this.level(module);

    if (module === 'charge') {
      const tune = MODULE_TUNING.charge;
      const dir = normalize(tx - u.x, ty - u.y, 1, 0);
      const len = Math.min(dist(u.x, u.y, tx, ty), tune.maxDistance);
      if (len < 20) return false;
      u.state = 'dash';
      u.dashX = dir.x;
      u.dashY = dir.y;
      u.dashLeft = len;
      u.dashHits = [];
      u.dashChain = this.newChain();
      u.facing = Math.atan2(dir.y, dir.x);
    } else if (module === 'pierce') {
      const tune = MODULE_TUNING.pierce;
      const dir = normalize(tx - u.x, ty - u.y, 1, 0);
      u.facing = Math.atan2(dir.y, dir.x);
      this.spawnProjectile({
        kind: 'bigshot',
        team: 0,
        x: u.x + dir.x * (u.radius + 4),
        y: u.y + dir.y * (u.radius + 4),
        vx: dir.x * tune.speed,
        vy: dir.y * tune.speed,
        radius: tune.radius,
        damage: tune.damage,
        knock: tune.knock,
        ownerId: u.id,
        source: 'pierce',
        pierce: 99,
        wallBounce: level >= 2 ? 1 : 0,
        life: 3,
      });
      this.emit({ type: 'shoot', unitId: u.id, x: u.x, y: u.y, angle: u.facing, big: true });
    } else if (module === 'vortex') {
      const tune = MODULE_TUNING.vortex;
      this.vortexes.push({
        id: this.nextId++,
        x: tx,
        y: ty,
        r: tune.radius,
        time: 0,
        duration: tune.duration,
        level,
        chain: this.newChain(),
      });
    } else {
      return false;
    }

    u.activeCd = def.cooldown ?? 10;
    u.castAt = this.t;
    addTo(this.stats.activesUsed, module, 1);
    this.emit({ type: 'cast', unitId: u.id, module, x: tx, y: ty });
    return true;
  }

  /** 点选敌人作为集火目标（阿铁与小弹优先攻击它）；传 0 取消。 */
  setFocus(id: number): void {
    const target = id ? this.unitById(id) : undefined;
    if (id && (!target || !target.alive || target.team !== 1)) return;
    if (id && id !== this.focusId) this.stats.focusUsed++;
    this.focusId = id;
    this.emit({ type: 'focus', unitId: id });
  }

  spawnProjectile(
    init: Partial<Projectile> & Pick<Projectile, 'kind' | 'team' | 'x' | 'y' | 'vx' | 'vy'>,
  ): Projectile {
    const p: Projectile = {
      id: this.nextId++,
      px: init.x,
      py: init.y,
      radius: 5,
      damage: 10,
      knock: 0,
      echo: 0,
      chain: this.newChain(),
      ownerId: 0,
      source: init.team === 0 ? 'slinger' : 'enemy',
      hitIds: [],
      ricochet: 0,
      ricochetRange: 260,
      wallBounce: 0,
      homing: false,
      seekId: 0,
      seekTurn: 0,
      pierce: 0,
      reflects: 0,
      life: 2.5,
      alive: true,
      ...init,
    };
    if (this.projectiles.length >= SIM.maxProjectiles) {
      const oldest = this.projectiles.find((q) => q.alive);
      if (oldest) oldest.alive = false;
    }
    this.projectiles.push(p);
    return p;
  }
}

/** 从配置里取出已装备招式及其等级。 */
export function equippedLevels(
  loadout: Loadout,
  levels: Partial<Record<ModuleId, ModuleLevel>>,
): Partial<Record<ModuleId, ModuleLevel>> {
  const out: Partial<Record<ModuleId, ModuleLevel>> = {};
  for (const kind of PLAYER_UNITS) {
    for (const id of loadout[kind]) {
      if (id && levels[id]) out[id] = levels[id];
    }
  }
  return out;
}

function activeFor(kind: PlayerUnitKind, loadout: Loadout): ModuleId | null {
  for (const id of loadout[kind]) {
    if (id && MODULE_DEFS[id].type === 'active') return id;
  }
  return null;
}
