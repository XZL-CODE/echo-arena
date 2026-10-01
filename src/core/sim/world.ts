// 战斗世界：固定步长推进，所有随机都来自种子，便于重试比较与测试复现。
import type { EncounterDef } from '../content/encounters.js';
import { COUNTER_BONUS, COUNTERED_MULT, counterMult, counterSign } from '../content/elements.js';
import { DRAGON, formId, formName, formStats, SKILLS, SPECIES } from '../content/species.js';
import {
  ARENA,
  BOSS_CC_MULT,
  DIFFICULTY_MULT,
  ENERGY,
  MATCH_DAMAGE_SCALING,
  MATCH_HP_SCALING,
  SIM,
} from '../content/tuning.js';
import { clamp, dist, normalize } from '../math.js';
import { hashSeed, Rng } from '../rng.js';
import type {
  BossId,
  DamageSource,
  Difficulty,
  Element,
  Form,
  LegionPet,
  SpeciesId,
  Team,
} from '../types.js';
import { updateUnit } from './ai.js';
import type { BurstSpec, Projectile, SlideInfo, Unit, UnitAct, Zone } from './entities.js';
import type { SimEvent, StatusKind } from './events.js';
import { integrate } from './physics.js';
import { updateProjectiles } from './projectiles.js';
import { addTo, createStats, type BattleStats } from './stats.js';
import { updateZones } from './zones.js';

export interface BattleConfig {
  encounter: EncounterDef;
  seed: number;
  difficulty: Difficulty;
  /** 本轮第几场（0 起），用于轻微的强度递增。 */
  matchIndex: number;
  /** 玩家军团与站位。 */
  legion: ReadonlyArray<LegionPet>;
}

export interface DamageInfo {
  /** 造成伤害的一方。 */
  team: Team;
  sourceId: number;
  source: DamageSource;
  element: Element;
  echo: number;
  chain: number;
  /** 持续伤害（灼烧、燃烧地面）。 */
  dot?: boolean;
  /** 击倒目标时在原地连环爆炸（凤凰陨）。 */
  burst?: BurstSpec | null;
}

export interface BlastSpec {
  x: number;
  y: number;
  radius: number;
  damage: number;
  team: Team;
  sourceId: number;
  source: DamageSource;
  element: Element;
  echo: number;
  chain: number;
  knock?: number;
  stun?: number;
  /** 击飞到空中（眩晕 + 腾空）。 */
  knockUp?: number;
  burnDps?: number;
  burnTime?: number;
  burst?: BurstSpec | null;
  ignoreId?: number;
  /** 爆炸本身是一次传递（连爆、引爆）：记一次回响并计入统计。 */
  transfer?: boolean;
}

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

/** 首领生命降到一半之前不会掉到这条线以下，保证变身一定发生。 */
const BOSS_FLOOR = 0.49;

export class World {
  readonly width = ARENA.width;
  readonly height = ARENA.height;
  readonly config: BattleConfig;
  readonly rng: Rng;
  readonly enemyHpMult: number;
  readonly enemyDamageMult: number;

  t = 0;
  tick = 0;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  events: SimEvent[] = [];
  stats: BattleStats = createStats();
  result: 'win' | 'lose' | null = null;
  resultTime = 0;
  focusId = 0;
  overtimeLevel = 0;
  /** 本场出现过的全部形态标识（双方，含召唤与变身），图鉴用。 */
  formsSeen: string[] = [];

  private nextId = 1;
  private nextChainId = 1;
  private spawnCount = 0;
  private byId = new Map<number, Unit>();
  private timers: Timer[] = [];
  private timerSeq = 0;
  private chainInfo = new Map<number, { max: number; sources: DamageSource[] }>();

  constructor(config: BattleConfig) {
    this.config = config;
    this.rng = new Rng(hashSeed(config.seed, 'battle', config.encounter.id));
    const diff = DIFFICULTY_MULT[config.difficulty];
    this.enemyHpMult = diff.enemyHp * (1 + MATCH_HP_SCALING * config.matchIndex);
    this.enemyDamageMult = diff.enemyDamage * (1 + MATCH_DAMAGE_SCALING * config.matchIndex);

    for (const pet of config.legion) {
      const r = formStats(pet.species, pet.form).radius;
      const x = clamp(pet.x, r + 4, ARENA.playerZoneMaxX);
      const y = clamp(pet.y, r + 4, ARENA.height - r - 4);
      this.spawnPet(pet.species, pet.form, 0, x, y, pet.uid);
      this.stats.pets.push({ uid: pet.uid, species: pet.species, form: pet.form });
    }
    for (const e of config.encounter.legion) this.spawnPet(e.species, e.form, 1, e.x, e.y);
    const boss = config.encounter.boss;
    if (boss) this.spawnBoss(boss.x, boss.y);
  }

  // ---- 查询 ----

  unitById(id: number): Unit | undefined {
    return this.byId.get(id);
  }

  /** 玩家宠物（按 uid）。 */
  petByUid(uid: number): Unit | undefined {
    return this.units.find((u) => u.team === 0 && u.uid === uid);
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

  /** 剩余对手生命占比（含召唤物），失败结算用。 */
  enemyHpRemainingRatio(): number {
    let remaining = 0;
    for (const u of this.units) if (u.alive && u.team === 1) remaining += u.hp;
    const total = this.stats.enemyTotalHp;
    return total > 0 ? clamp(remaining / total, 0, 1) : 0;
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
    this.updateOvertime();
    this.runTimers();
    for (const u of this.units) {
      if (u.alive) updateUnit(this, u, dt);
    }
    updateZones(this, dt);
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

  /** delay 秒后执行（连锁闪电、依次落雷、连爆都一个接一个发生）。同一时刻按安排的先后执行。 */
  after(delay: number, fn: () => void): void {
    this.timers.push({ at: this.t + Math.max(0, delay), seq: this.timerSeq++, fn });
  }

  private runTimers(): void {
    if (this.timers.length === 0) return;
    const due = this.timers.filter((x) => x.at <= this.t + 1e-9);
    if (due.length === 0) return;
    this.timers = this.timers.filter((x) => x.at > this.t + 1e-9);
    due.sort((a, b) => a.at - b.at || a.seq - b.seq);
    for (const timer of due) timer.fn();
  }

  private updateOvertime(): void {
    if (this.t < SIM.overtimeStart) return;
    const level = Math.floor((this.t - SIM.overtimeStart) / SIM.overtimeStep) + 1;
    if (level !== this.overtimeLevel) {
      this.overtimeLevel = level;
      this.emit({ type: 'overtime', level });
    }
  }

  private compact(): void {
    // 倒下超过 3 秒的对手移出列表，保持遍历成本稳定；玩家宠物始终保留（界面要显示）。
    const keep = this.units.filter((u) => u.alive || u.team === 0 || this.t - u.diedAt < 3);
    if (keep.length === this.units.length) return;
    this.units = keep;
    this.byId = new Map(keep.map((u) => [u.id, u]));
  }

  private checkResult(): void {
    if (this.result) return;
    const enemiesAlive = this.units.some((u) => u.alive && u.team === 1);
    const playersAlive = this.units.some((u) => u.alive && u.team === 0);
    if (!enemiesAlive) this.finish('win');
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

  // ---- 出场 ----

  /** 让一只宠物出场；uid 只有玩家宠物有。 */
  spawnPet(
    species: SpeciesId,
    form: Form,
    team: Team,
    x: number,
    y: number,
    uid = 0,
    summonedBy = 0,
  ): Unit {
    const def = SPECIES[species];
    const st = formStats(species, form);
    const enemy = team === 1;
    const hp = Math.round(st.hp * (enemy ? this.enemyHpMult : 1));
    const u = this.makeUnit(team, species, form, x, y, st.radius);
    u.uid = uid;
    u.element = def.element;
    u.role = def.role;
    u.hp = hp;
    u.maxHp = hp;
    u.mass = st.mass;
    u.atk = st.atk * (enemy ? this.enemyDamageMult : 1);
    u.interval = st.interval;
    u.range = st.range;
    u.speed = st.speed;
    u.energy = form === 3 ? ENERGY.start : -1;
    u.skillCdMax = def.skill.cooldown;
    u.skillCd = def.skill.cooldown * u.rng.range(0.4, 0.7);
    u.summonedBy = summonedBy;
    return this.register(u);
  }

  spawnBoss(x: number, y: number): Unit {
    const st = DRAGON.stats[0];
    const hp = Math.round(st.hp * this.enemyHpMult);
    const u = this.makeUnit(1, 'dragon', 1, x, y, st.radius);
    u.element = DRAGON.element;
    u.role = 'boss';
    u.hp = hp;
    u.maxHp = hp;
    u.mass = st.mass;
    u.atk = st.atk * this.enemyDamageMult;
    u.interval = st.interval;
    u.range = st.range;
    u.speed = st.speed;
    u.energy = -1;
    u.breathCd = 3;
    u.tailCd = 5;
    u.summonCd = 9;
    return this.register(u);
  }

  private makeUnit(
    team: Team,
    species: SpeciesId | BossId,
    form: Form,
    x: number,
    y: number,
    radius: number,
  ): Unit {
    const index = this.spawnCount++;
    return {
      id: this.nextId++,
      uid: 0,
      team,
      species,
      form,
      element: 'fire',
      role: 'tank',
      name: formName(species, form),
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      mvx: 0,
      mvy: 0,
      facing: team === 0 ? 0 : Math.PI,
      radius,
      mass: 1,
      hp: 1,
      maxHp: 1,
      shield: 0,
      shieldTime: 0,
      energy: -1,
      alive: true,
      diedAt: 0,
      act: 'idle',
      actAt: this.t,
      actDur: 0,
      targetId: 0,
      stun: 0,
      airborne: 0,
      root: 0,
      burn: 0,
      burnDps: 0,
      burnBy: 0,
      burnSource: 'basic',
      burnTick: SIM.dotTick,
      taunt: 0,
      tauntBy: 0,
      guard: 0,
      stoneSkin: 0,
      hitAt: -9,
      spawnAt: this.t,
      atk: 1,
      interval: 1,
      range: 18,
      speed: 60,
      attackCd: 0,
      skillCd: 0,
      skillCdMax: 0,
      breathCd: 0,
      tailCd: 0,
      summonCd: 0,
      action: null,
      slide: null,
      impactCooldown: 0,
      summonedBy: 0,
      energyAnnounced: false,
      retargetAt: 0,
      kiteTime: 0,
      spread: 0,
      slot: team === 0 ? Math.PI : 0,
      footwork: 'none',
      foot: null,
      flank: 1,
      weavePhase: 0,
      weaveFreq: 1,
      crossAt: 0,
      strafeDir: 1,
      strafeSwitchAt: 0,
      holdFactor: 0.8,
      rng: new Rng(hashSeed(this.config.seed, this.config.encounter.id, 'unit', index)),
    };
  }

  private register(u: Unit): Unit {
    // 出场时定下各自的走位习惯：偏好的包抄一侧、迂回的节奏、远程保持的距离。
    // 同一目标周围的近战因此各占一个方向，接近时也不会排成一队。
    const rng = u.rng;
    u.flank = rng.next() < 0.5 ? -1 : 1;
    u.spread = rng.range(0.2, 1);
    u.weavePhase = rng.range(0, Math.PI * 2);
    u.weaveFreq = rng.range(1.6, 2.8);
    u.crossAt = this.t + rng.range(3, 6);
    u.strafeDir = rng.next() < 0.5 ? -1 : 1;
    u.strafeSwitchAt = this.t + rng.range(1, 2);
    u.holdFactor = rng.range(0.7, 0.9);
    u.attackCd = rng.range(0, 0.4);
    this.units.push(u);
    this.byId.set(u.id, u);
    this.seeForm(formId(u.species, u.form));
    if (u.team === 1) {
      this.stats.enemyCount++;
      this.stats.enemyTotalHp += u.maxHp;
    }
    return u;
  }

  private seeForm(id: string): void {
    if (!this.formsSeen.includes(id)) this.formsSeen.push(id);
  }

  /** 首领化为人形：体型变小、更快，获得能量与大招。 */
  transformBoss(u: Unit): void {
    const st = DRAGON.stats[1];
    u.form = 2;
    u.name = formName('dragon', 2);
    u.radius = st.radius;
    u.mass = st.mass;
    u.speed = st.speed;
    u.interval = st.interval;
    u.range = st.range;
    u.atk = st.atk * this.enemyDamageMult;
    u.energy = ENERGY.start;
    u.energyAnnounced = false;
    u.stun = 0;
    u.airborne = 0;
    u.root = 0;
    u.burn = 0;
    u.summonCd = Math.max(u.summonCd, 6);
    this.seeForm(formId('dragon', 2));
    this.emit({ type: 'transform', unitId: u.id });
  }

  // ---- 伤害、治疗与状态 ----

  /** 受到的伤害倍率：玄甲、石肤、我方水墙。 */
  reductionOf(u: Unit): number {
    let mult = 1;
    if (u.guard > 0) mult *= 1 - SKILLS.turtle.skill.reduction;
    if (u.stoneSkin > 0) mult *= 1 - SKILLS.bear.ult.skin;
    if (this.zones.some((z) => z.kind === 'waterWall' && z.team === u.team)) {
      mult *= 1 - SKILLS.turtle.ult.reduction;
    }
    return mult;
  }

  damage(target: Unit, base: number, info: DamageInfo): number {
    if (!target.alive || base <= 0) return 0;
    // 变身过程中不会受伤。
    if (target.action?.kind === 'transform') return 0;
    const echo = Math.min(info.echo, SIM.echoCap);
    const counter = counterSign(info.element, target.element);
    let amount = base * counterMult(info.element, target.element);
    amount *= (1 + SIM.echoBonus * echo) * this.overtimeMult() * this.reductionOf(target);

    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      amount -= absorbed;
      if (target.shield <= 0.001) {
        target.shield = 0;
        target.shieldTime = 0;
      }
    }
    let floor = 0;
    if (target.species === 'dragon' && target.form === 1) floor = target.maxHp * BOSS_FLOOR;
    amount = Math.max(0, Math.min(amount, target.hp - floor));
    target.hp -= amount;
    target.hitAt = this.t;
    if (amount > 0) this.gainEnergy(target, (amount / target.maxHp) * ENERGY.perDamageTaken);
    if (!this.result) this.recordDamage(target, amount, info, echo, counter);

    const killed = target.hp <= 0.001;
    this.emit({
      type: 'hit',
      targetId: target.id,
      sourceId: info.sourceId,
      x: target.x,
      y: target.y,
      amount,
      echo,
      team: info.team,
      element: info.element,
      counter,
      killed,
      source: info.source,
      dot: info.dot ?? false,
    });
    if (killed) this.kill(target, info);
    return amount;
  }

  private recordDamage(
    target: Unit,
    amount: number,
    info: DamageInfo,
    echo: number,
    counter: 1 | 0 | -1,
  ): void {
    const s = this.stats;
    if (info.team === 0 && target.team === 1) {
      s.totalDealt += amount;
      addTo(s.damageBySkill, info.source, amount);
      const uid = this.unitById(info.sourceId)?.uid ?? 0;
      if (uid) addTo(s.damageByUid, uid, amount);
      if (echo > 0) s.echoHits++;
      if (counter === 1) {
        s.counterHits++;
        s.counterBonus += amount - amount / COUNTER_BONUS;
      } else if (counter === -1) {
        s.counteredHits++;
        s.counteredLoss += amount / COUNTERED_MULT - amount;
      }
    } else if (target.team === 0 && info.team === 1) {
      s.totalTaken += amount;
      addTo(s.takenByUid, target.uid, amount);
      if (counter === 1) s.enemyCounterBonus += amount - amount / COUNTER_BONUS;
    }
  }

  kill(target: Unit, info: DamageInfo): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.diedAt = this.t;
    target.action = null;
    target.slide = null;
    target.vx = 0;
    target.vy = 0;
    target.stun = 0;
    target.airborne = 0;
    target.root = 0;
    target.burn = 0;
    target.shield = 0;
    target.guard = 0;
    target.foot = null;
    target.footwork = 'none';
    target.mvx = 0;
    target.mvy = 0;
    this.setAct(target, 'dead', 0);
    if (this.focusId === target.id) {
      this.focusId = 0;
      this.emit({ type: 'focus', unitId: 0 });
    }

    if (!this.result) {
      const killer = this.unitById(info.sourceId);
      const record = {
        uid: target.uid,
        species: target.species,
        form: target.form,
        team: target.team,
        time: this.t,
        bySpecies: killer ? killer.species : null,
        byForm: killer ? killer.form : 0,
        source: info.source,
      };
      if (target.team === 0) this.stats.playerDeaths.push(record);
      else {
        this.stats.enemyDeaths.push(record);
        if (info.team === 0 && killer?.uid) addTo(this.stats.killsByUid, killer.uid, 1);
      }
    }
    this.emit({
      type: 'death',
      unitId: target.id,
      species: target.species,
      form: target.form,
      team: target.team,
      x: target.x,
      y: target.y,
    });

    // 连环爆炸：被凤凰陨击倒的敌人原地爆开，炸倒的下一个敌人接着爆（每次回响 +1）。
    const burst = info.burst;
    if (burst && target.team !== info.team) {
      const x = target.x;
      const y = target.y;
      this.after(0.12, () =>
        this.blast({
          x,
          y,
          radius: burst.radius,
          damage: burst.damage,
          team: info.team,
          sourceId: info.sourceId,
          source: info.source,
          element: info.element,
          echo: Math.min(SIM.echoCap, info.echo + 1),
          chain: info.chain,
          burst,
          ignoreId: target.id,
          transfer: true,
        }),
      );
    }
  }

  heal(target: Unit, amount: number, sourceId: number): number {
    if (!target.alive || amount <= 0) return 0;
    const actual = Math.min(amount, target.maxHp - target.hp);
    if (actual <= 0) return 0;
    target.hp += actual;
    if (!this.result) {
      if (target.team === 0) {
        this.stats.playerHealing += actual;
        const uid = this.unitById(sourceId)?.uid ?? 0;
        if (uid) addTo(this.stats.healingByUid, uid, actual);
      } else {
        this.stats.enemyHealing += actual;
      }
    }
    this.emit({
      type: 'heal',
      targetId: target.id,
      sourceId,
      amount: actual,
      x: target.x,
      y: target.y,
    });
    return actual;
  }

  /** 泡泡护盾：取较大的护盾量并刷新时长。 */
  addShield(target: Unit, amount: number, duration: number, sourceId: number): void {
    if (!target.alive || amount <= 0) return;
    const gained = Math.max(0, amount - target.shield);
    target.shield = Math.max(target.shield, amount);
    target.shieldTime = Math.max(target.shieldTime, duration);
    if (!this.result && target.team === 0) {
      const uid = this.unitById(sourceId)?.uid ?? 0;
      if (uid) addTo(this.stats.shieldByUid, uid, gained);
    }
    this.emit({ type: 'shield', targetId: target.id, amount: target.shield });
    this.emitStatus(target, 'shield', duration);
  }

  gainEnergy(u: Unit, amount: number): void {
    if (!u.alive || u.energy < 0 || amount <= 0) return;
    if (u.action?.act === 'ult') return;
    u.energy = Math.min(ENERGY.full, u.energy + amount);
    if (u.energy >= ENERGY.full && !u.energyAnnounced) {
      u.energyAnnounced = true;
      this.emit({ type: 'energyFull', unitId: u.id });
    }
  }

  /** 正在放大招或变身的单位不会被打断。 */
  unstoppable(u: Unit): boolean {
    return u.action !== null && u.action.unstoppable;
  }

  /** 打断正在进行的前摇或冲刺（大招与变身除外）。被打断的技能很快会再放。 */
  interrupt(u: Unit): void {
    u.foot = null;
    const a = u.action;
    if (!a || a.unstoppable) return;
    if (a.kind !== 'basic' && a.kind !== 'heal' && a.phase === 0) {
      u.skillCd = Math.min(u.skillCd, 1);
    }
    u.action = null;
  }

  stunUnit(u: Unit, duration: number, knockUp = false): void {
    if (!u.alive || duration <= 0 || this.unstoppable(u)) return;
    const d = u.role === 'boss' ? duration * BOSS_CC_MULT : duration;
    u.stun = Math.max(u.stun, d);
    if (knockUp) u.airborne = Math.max(u.airborne, d);
    this.interrupt(u);
    this.emitStatus(u, knockUp ? 'knockup' : 'stun', d);
  }

  rootUnit(u: Unit, duration: number): void {
    if (!u.alive || duration <= 0) return;
    const d = u.role === 'boss' ? duration * BOSS_CC_MULT : duration;
    u.root = Math.max(u.root, d);
    this.emitStatus(u, 'root', d);
  }

  burnUnit(u: Unit, dps: number, duration: number, byId: number, source: DamageSource): void {
    if (!u.alive || dps <= 0 || duration <= 0) return;
    if (u.burn <= 0 || dps >= u.burnDps) {
      u.burnDps = dps;
      u.burnBy = byId;
      u.burnSource = source;
    }
    if (u.burn <= 0) u.burnTick = SIM.dotTick;
    u.burn = Math.max(u.burn, duration);
    this.emitStatus(u, 'burn', duration);
  }

  tauntUnit(u: Unit, byId: number, duration: number): void {
    if (!u.alive || u.role === 'boss' || this.unstoppable(u)) return;
    u.tauntBy = byId;
    u.taunt = Math.max(u.taunt, duration);
    u.targetId = byId;
    this.emitStatus(u, 'taunt', duration);
  }

  emitStatus(u: Unit, status: StatusKind, duration: number): void {
    this.emit({ type: 'status', unitId: u.id, status, duration });
  }

  /** 击退：速度变化与质量的平方根成反比；高速滑行期间不能行动，撞到东西会产生撞击。 */
  knock(target: Unit, dx: number, dy: number, power: number, info: SlideInfo): void {
    if (!target.alive || power <= 0 || this.unstoppable(target)) return;
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
      this.interrupt(target);
    }
  }

  /** 爆炸：伤害范围内的对手（中心伤害最高），可附带击退、眩晕、击飞、灼烧。返回波及的单位数。 */
  blast(b: BlastSpec): number {
    this.emit({
      type: 'explode',
      x: b.x,
      y: b.y,
      radius: b.radius,
      element: b.element,
      echo: Math.min(b.echo, SIM.echoCap),
      team: b.team,
      source: b.source,
    });
    if (b.transfer && b.echo > 0) {
      if (!this.result && b.team === 0) this.stats.blasts++;
      this.echoEvent(b.x, b.y, b.echo, b.chain, b.source, b.team);
    }
    const targets = this.units.filter(
      (u) =>
        u.alive &&
        u.team !== b.team &&
        u.id !== b.ignoreId &&
        dist(b.x, b.y, u.x, u.y) <= b.radius + u.radius,
    );
    for (const u of targets) {
      const d = dist(b.x, b.y, u.x, u.y);
      const falloff = 1 - 0.35 * clamp(d / Math.max(1, b.radius), 0, 1);
      this.damage(u, b.damage * falloff, {
        team: b.team,
        sourceId: b.sourceId,
        source: b.source,
        element: b.element,
        echo: b.echo,
        chain: b.chain,
        burst: b.burst ?? null,
      });
      if (!u.alive) continue;
      if (b.burnDps && b.burnTime) this.burnUnit(u, b.burnDps, b.burnTime, b.sourceId, b.source);
      if (b.knockUp) this.stunUnit(u, b.knockUp, true);
      else if (b.stun) this.stunUnit(u, b.stun);
      if (b.knock) {
        const n = normalize(u.x - b.x, u.y - b.y, u.team === 0 ? -1 : 1, 0);
        const owner = this.unitById(b.sourceId);
        this.knock(u, n.x, n.y, b.knock * falloff, {
          team: b.team,
          ownerId: b.sourceId,
          echo: b.echo,
          chain: b.chain,
          source: b.source,
          power: owner?.atk ?? 10,
          element: b.element,
        });
      }
    }
    return targets.length;
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
    const capped = Math.min(level, SIM.echoCap);
    this.emit({ type: 'echo', x, y, level: capped, chain, source });
    if (team !== 0) return;
    const info = this.chainInfo.get(chain) ?? { max: 0, sources: [] };
    if (info.sources[info.sources.length - 1] !== source && info.sources.length < 12) {
      info.sources.push(source);
    }
    info.max = Math.max(info.max, capped);
    this.chainInfo.set(chain, info);
    if (!this.result && capped > this.stats.maxEcho) {
      this.stats.maxEcho = capped;
      this.stats.bestChainSources = info.sources.slice();
    }
  }

  setAct(u: Unit, act: UnitAct, duration: number, restart = false): void {
    if (u.act !== act || restart) {
      u.act = act;
      u.actAt = this.t;
    }
    u.actDur = duration;
  }

  // ---- 弹丸与区域 ----

  spawnProjectile(
    init: Partial<Projectile> &
      Pick<Projectile, 'kind' | 'team' | 'x' | 'y' | 'vx' | 'vy' | 'element' | 'damage'>,
  ): Projectile {
    const p: Projectile = {
      id: this.nextId++,
      px: init.x,
      py: init.y,
      z: 0,
      echo: 0,
      alive: true,
      radius: 6,
      ownerId: 0,
      shooterId: init.ownerId ?? 0,
      source: 'basic',
      chain: this.newChain(),
      hitIds: [],
      ricochet: 0,
      ricochetRange: 240,
      pierce: 0,
      reflects: 0,
      life: 2.5,
      blastAtEnd: false,
      seekId: 0,
      seekTurn: 0,
      splash: 0,
      knock: 0,
      burnDps: 0,
      burnTime: 0,
      groundDps: 0,
      groundTime: 0,
      shards: 0,
      shardDamage: 0,
      shardSpeed: 500,
      shardRange: 260,
      stun: 0,
      lob: false,
      fromX: init.x,
      fromY: init.y,
      tx: init.x,
      ty: init.y,
      flight: 0,
      t: 0,
      peak: 0,
      reflectable: true,
      burst: null,
      trailZoneId: 0,
      ...init,
    };
    if (this.projectiles.length >= SIM.maxProjectiles) {
      const oldest = this.projectiles.find((q) => q.alive);
      if (oldest) oldest.alive = false;
      this.projectiles = this.projectiles.filter((q) => q.alive);
    }
    this.projectiles.push(p);
    return p;
  }

  addZone(
    init: Partial<Zone> &
      Pick<Zone, 'kind' | 'team' | 'x' | 'y' | 'r' | 'duration' | 'ownerId' | 'source'>,
  ): Zone {
    const owner = this.unitById(init.ownerId);
    const zone: Zone = {
      id: this.nextId++,
      t: 0,
      element: owner?.element ?? 'fire',
      chain: this.newChain(),
      damage: 0,
      tick: 0,
      waves: 0,
      root: 0,
      pull: 0,
      heal: 0,
      reduction: 0,
      ...init,
    };
    if (this.zones.length >= SIM.maxZones) this.zones.shift();
    this.zones.push(zone);
    this.emit({
      type: 'zone',
      zoneId: zone.id,
      kind: zone.kind,
      x: zone.x,
      y: zone.y,
      r: zone.r,
      ...(zone.angle !== undefined ? { angle: zone.angle } : {}),
      ...(zone.length !== undefined ? { length: zone.length } : {}),
    });
    return zone;
  }

  // ---- 玩家输入 ----

  /**
   * 点选敌人作为集火目标：我方全体优先攻击它。再点同一个敌人或传 0 取消。
   * 对手一方不理会集火。
   */
  setFocus(id: number): void {
    if (this.result) return;
    if (id === this.focusId) id = 0;
    const target = id ? this.unitById(id) : undefined;
    if (id && (!target || !target.alive || target.team !== 1)) return;
    if (id) this.stats.focusUsed++;
    this.focusId = id;
    for (const u of this.units) if (u.team === 0) u.retargetAt = 0;
    this.emit({ type: 'focus', unitId: id });
  }
}
