// 样张页用的假战斗：两队宠物对冲，按简单规则走位、出手、放技能和大招，产生与规则层同名的事件，
// 用来在真正的规则层接进来之前检查 3D 画面与特效。
import type { FxEvent } from '../gfx/fx/director.js';
import type {
  ElementId,
  ViewProjectile,
  ViewUnit,
  ViewWorld,
  ViewZone,
} from '../gfx/battle/types.js';

const ELEMENT: Record<string, ElementId> = {
  fox: 'fire',
  bird: 'fire',
  otter: 'water',
  turtle: 'water',
  bunny: 'wood',
  deer: 'wood',
  cat: 'thunder',
  wolf: 'thunder',
  bear: 'rock',
  lizard: 'rock',
  dragon: 'fire',
};
const RANGED = new Set(['bird', 'otter', 'bunny', 'deer', 'cat', 'lizard']);

export class MockBattle implements ViewWorld {
  units: ViewUnit[] = [];
  projectiles: ViewProjectile[] = [];
  zones: ViewZone[] = [];
  t = 0;
  focusId = 0;
  result: 'win' | 'lose' | null = null;
  readonly width = 1800;
  readonly height = 1100;
  private events: FxEvent[] = [];
  private nextId = 1;
  private seed = 7;
  /** 每个单位的出手计时与走位（侧移、后撤）状态。 */
  private timers = new Map<
    number,
    {
      atk: number;
      skill: number;
      energyFull: boolean;
      step: number;
      stepDir: number;
      nextStep: number;
    }
  >();

  constructor(left: string[], right: string[]) {
    left.forEach((f, i) => this.add(f, 0, i, left.length));
    right.forEach((f, i) => this.add(f, 1, i, right.length));
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private add(formId: string, team: 0 | 1, i: number, n: number): void {
    const [species, formText] = formId.split('-') as [string, string];
    const form = Number(formText);
    const ranged = RANGED.has(species);
    const row = i % 5;
    const col = Math.floor(i / 5);
    const x = team === 0 ? (ranged ? 330 : 520) - col * 100 : (ranged ? 1470 : 1280) + col * 100;
    const y = 230 + row * 150 + (col % 2) * 60 + (n < 5 ? 100 : 0);
    const id = this.nextId++;
    const u: ViewUnit = {
      id,
      uid: team === 0 ? id : 0,
      team,
      species,
      form,
      element: ELEMENT[species] ?? 'fire',
      role: species === 'dragon' ? 'boss' : 'fighter',
      x,
      y,
      px: x,
      py: y,
      facing: team === 0 ? 0 : Math.PI,
      radius: species === 'dragon' ? (form === 1 ? 64 : 34) : form === 1 ? 20 : 25,
      hp: 300 * form,
      maxHp: 300 * form,
      shield: 0,
      energy: form >= 3 || species === 'dragon' ? 20 + this.rnd() * 60 : -1,
      alive: true,
      diedAt: 0,
      act: 'idle',
      actAt: 0,
      actDur: 0.6,
      stun: 0,
      airborne: 0,
      root: 0,
      burn: 0,
      taunt: 0,
      guard: 0,
      stoneSkin: 0,
      hitAt: -9,
      spawnAt: 0,
    };
    this.units.push(u);
    this.timers.set(id, {
      atk: 0.5 + this.rnd(),
      skill: 3 + this.rnd() * 5,
      energyFull: false,
      step: 0,
      stepDir: 1,
      nextStep: 1 + this.rnd() * 2,
    });
  }

  drainEvents(): FxEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private nearest(u: ViewUnit): ViewUnit | null {
    let best: ViewUnit | null = null;
    let bd = Infinity;
    for (const o of this.units) {
      if (!o.alive || o.team === u.team) continue;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  step(dt: number): void {
    this.t += dt;
    for (const u of this.units) {
      u.px = u.x;
      u.py = u.y;
      u.stun = Math.max(0, u.stun - dt);
      u.airborne = Math.max(0, u.airborne - dt);
      u.burn = Math.max(0, u.burn - dt);
      u.root = Math.max(0, u.root - dt);
      u.guard = Math.max(0, u.guard - dt);
      if (!u.alive) continue;
      const tm = this.timers.get(u.id);
      const target = this.nearest(u);
      if (!tm || !target) continue;
      const dx = target.x - u.x;
      const dy = target.y - u.y;
      const d = Math.hypot(dx, dy);
      u.facing = Math.atan2(dy, dx);
      const ranged = RANGED.has(u.species);
      const reach = ranged ? 320 : u.radius + target.radius + 16;
      const busy =
        (u.act === 'attack' || u.act === 'skill' || u.act === 'ult') && this.t - u.actAt < u.actDur;
      if (!busy) u.act = 'idle';
      if (u.stun > 0) continue;
      if (d > reach && !busy) {
        // 接近时走弧线：往一侧偏，偏移随时间起伏
        const sp = (ranged ? 70 : 95) * dt;
        const weave = Math.sin(this.t * 1.3 + u.id * 1.7) * Math.min(0.7, (d - reach) / 200);
        const mx = dx / d - (dy / d) * weave;
        const my = dy / d + (dx / d) * weave;
        const ml = Math.hypot(mx, my) || 1;
        u.x += (mx / ml) * sp;
        u.y += (my / ml) * sp;
        u.facing = Math.atan2(my, mx);
        u.act = 'move';
        continue;
      }
      // 交手中的步伐：不时绕着对手侧移或后撤一步，面朝对手
      tm.nextStep -= dt;
      if (tm.step <= 0 && tm.nextStep <= 0 && !busy) {
        tm.step = 0.35 + this.rnd() * 0.25;
        tm.stepDir = this.rnd() < 0.5 ? -1 : 1;
        tm.nextStep = 1.2 + this.rnd() * 2;
      }
      if (tm.step > 0 && !busy && u.stun <= 0) {
        tm.step -= dt;
        const sp = (ranged ? 80 : 120) * dt;
        const back = ranged ? 0.3 : -0.25;
        const mx = -(dy / d) * tm.stepDir - (dx / d) * back;
        const my = (dx / d) * tm.stepDir - (dy / d) * back;
        const ml = Math.hypot(mx, my) || 1;
        u.x += (mx / ml) * sp;
        u.y += (my / ml) * sp;
        u.act = 'move';
        continue;
      }
      tm.atk -= dt;
      tm.skill -= dt;
      if (u.energy >= 0 && !busy) u.energy = Math.min(100, u.energy + dt * 9);
      if (u.energy >= 100 && !busy) {
        u.energy = 0;
        u.act = 'ult';
        u.actAt = this.t;
        u.actDur = 1.4;
        this.events.push({
          type: 'ult',
          unitId: u.id,
          skill: 'ult',
          x: u.x,
          y: u.y,
          tx: target.x,
          ty: target.y,
        });
        this.ultPayload(u, target);
        continue;
      }
      if (tm.skill <= 0 && !busy) {
        tm.skill = 6 + this.rnd() * 3;
        u.act = 'skill';
        u.actAt = this.t;
        u.actDur = 0.8;
        this.events.push({
          type: 'skill',
          unitId: u.id,
          skill: 'skill',
          form: u.form,
          x: u.x,
          y: u.y,
          tx: target.x,
          ty: target.y,
        });
        this.skillPayload(u, target);
        continue;
      }
      if (tm.atk <= 0 && !busy) {
        tm.atk = ranged ? 1.2 : 0.9;
        u.act = 'attack';
        u.actAt = this.t;
        u.actDur = 0.55;
        this.events.push({
          type: 'attack',
          unitId: u.id,
          targetId: target.id,
          style: ranged ? 'shoot' : 'melee',
          x: u.x,
          y: u.y,
          tx: target.x,
          ty: target.y,
        });
        if (ranged) this.shoot(u, target);
        else this.damage(target, 22 * u.form, u, 0);
      }
    }
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'crystal')
        p.z = Math.max(
          0,
          140 *
            Math.sin(
              Math.min(1, (this.t - (p as ViewProjectile & { born: number }).born) / 0.9) * Math.PI,
            ),
        );
      const target = this.units.find(
        (o) => o.alive && o.team !== p.team && Math.hypot(o.x - p.x, o.y - p.y) < o.radius + 8,
      );
      if (target) {
        p.alive = false;
        this.damage(target, 18, null, p.echo, p.element);
        if (p.kind === 'fireball' || p.kind === 'crystal')
          this.events.push({
            type: 'explode',
            x: p.x,
            y: p.y,
            radius: 60,
            element: p.element,
            echo: p.echo,
            team: p.team,
          });
      }
      if (p.x < 0 || p.x > this.width) p.alive = false;
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
    for (const z of this.zones) z.t += dt;
    this.zones = this.zones.filter((z) => z.t < z.duration);
  }

  private shoot(u: ViewUnit, target: ViewUnit): void {
    const kind =
      u.species === 'bird'
        ? 'fireball'
        : u.species === 'otter'
          ? 'bubble'
          : u.species === 'bunny'
            ? 'arrow'
            : u.species === 'cat'
              ? 'spark'
              : u.species === 'lizard'
                ? 'crystal'
                : 'fireball';
    const d = Math.hypot(target.x - u.x, target.y - u.y) || 1;
    const speed = kind === 'crystal' ? d / 0.9 : 520;
    const p = {
      id: this.nextId++,
      kind,
      team: u.team,
      x: u.x,
      y: u.y,
      px: u.x,
      py: u.y,
      z: 0,
      vx: ((target.x - u.x) / d) * speed,
      vy: ((target.y - u.y) / d) * speed,
      element: u.element,
      echo: 0,
      alive: true,
      born: this.t,
    };
    this.projectiles.push(p);
  }

  private damage(
    target: ViewUnit,
    amount: number,
    source: ViewUnit | null,
    echo: number,
    element?: ElementId,
  ): void {
    target.hp = Math.max(0, target.hp - amount);
    target.hitAt = this.t;
    const killed = target.hp <= 0 && target.alive;
    const counter = this.rnd() < 0.2 ? 1 : 0;
    this.events.push({
      type: 'hit',
      targetId: target.id,
      x: target.x,
      y: target.y,
      amount,
      echo,
      team: source?.team ?? 0,
      element: element ?? source?.element,
      counter,
      killed,
    });
    if (killed) {
      target.alive = false;
      target.diedAt = this.t;
      target.act = 'dead';
      this.events.push({
        type: 'death',
        unitId: target.id,
        team: target.team,
        x: target.x,
        y: target.y,
      });
    }
  }

  private skillPayload(u: ViewUnit, target: ViewUnit): void {
    switch (u.species) {
      case 'fox':
      case 'wolf': {
        const tx = target.x - Math.cos(u.facing) * 30;
        const ty = target.y - Math.sin(u.facing) * 30;
        this.events.push({ type: 'dash', unitId: u.id, fromX: u.x, fromY: u.y, toX: tx, toY: ty });
        u.x = tx;
        u.y = ty;
        this.damage(target, 40, u, 1);
        this.events.push({ type: 'impact', x: target.x, y: target.y, strength: 500, echo: 1 });
        break;
      }
      case 'cat': {
        let from = u;
        const hitList = this.units.filter((o) => o.alive && o.team !== u.team).slice(0, 4);
        hitList.forEach((o, i) => {
          this.events.push({
            type: 'chain',
            x1: from.x,
            y1: from.y,
            x2: o.x,
            y2: o.y,
            echo: i + 1,
            element: 'thunder',
          });
          this.damage(o, 20, u, i + 1, 'thunder');
          if (i > 0) this.events.push({ type: 'echo', x: o.x, y: o.y, level: i + 1 });
          from = o;
        });
        break;
      }
      case 'bear':
        this.events.push({
          type: 'zone',
          zoneId: this.nextId++,
          kind: 'spikeRing',
          x: target.x,
          y: target.y,
          r: 110,
        });
        target.airborne = 0.9;
        target.stun = 0.9;
        this.damage(target, 30, u, 0);
        break;
      case 'deer': {
        this.events.push({
          type: 'zone',
          zoneId: this.nextId++,
          kind: 'vines',
          x: target.x,
          y: target.y,
          r: 120,
        });
        this.zones.push({
          id: this.nextId++,
          kind: 'vines',
          team: u.team,
          x: target.x,
          y: target.y,
          r: 120,
          t: 0,
          duration: 2,
        });
        target.root = 2;
        break;
      }
      case 'turtle':
        u.guard = 3;
        this.events.push({ type: 'status', unitId: u.id, status: 'guard', duration: 3 });
        break;
      case 'otter': {
        const ally = this.units.find((o) => o.alive && o.team === u.team && o.id !== u.id);
        if (ally) {
          ally.shield = 60;
          this.events.push({ type: 'shield', targetId: ally.id, amount: 60 });
        }
        break;
      }
      case 'bird':
        this.events.push({
          type: 'explode',
          x: target.x,
          y: target.y,
          radius: 90,
          element: 'fire',
          echo: 0,
          team: u.team,
        });
        this.zones.push({
          id: this.nextId++,
          kind: 'burn',
          team: u.team,
          x: target.x,
          y: target.y,
          r: 90,
          t: 0,
          duration: 3,
        });
        target.burn = 3;
        break;
      case 'lizard':
        this.events.push({
          type: 'explode',
          x: target.x,
          y: target.y,
          radius: 80,
          element: 'rock',
          echo: 1,
          team: u.team,
        });
        break;
      case 'bunny':
        this.zones.push({
          id: this.nextId++,
          kind: 'arrowRain',
          team: u.team,
          x: target.x,
          y: target.y,
          r: 110,
          t: 0,
          duration: 1.5,
        });
        break;
      default:
        break;
    }
  }

  private ultPayload(u: ViewUnit, target: ViewUnit): void {
    const foes = this.units.filter((o) => o.alive && o.team !== u.team);
    if (u.species === 'fox') {
      let x = u.x;
      let y = u.y;
      foes.slice(0, 5).forEach((o, i) => {
        this.events.push({ type: 'blink', unitId: u.id, fromX: x, fromY: y, toX: o.x, toY: o.y });
        this.damage(o, 30, u, i + 1, 'fire');
        this.events.push({ type: 'echo', x: o.x, y: o.y, level: i + 1 });
        x = o.x;
        y = o.y;
      });
      for (const o of foes.slice(0, 5))
        this.events.push({
          type: 'explode',
          x: o.x,
          y: o.y,
          radius: 60,
          element: 'fire',
          echo: 3,
          team: u.team,
        });
    } else if (u.species === 'cat') {
      foes.forEach((o, i) => {
        this.events.push({
          type: 'chain',
          x1: o.x,
          y1: o.y - 400,
          x2: o.x,
          y2: o.y,
          echo: i + 1,
          element: 'thunder',
        });
        this.damage(o, 25, u, i + 1, 'thunder');
      });
      this.events.push({
        type: 'explode',
        x: target.x,
        y: target.y,
        radius: 160,
        element: 'thunder',
        echo: 5,
        team: u.team,
      });
    } else {
      this.events.push({
        type: 'explode',
        x: target.x,
        y: target.y,
        radius: 150,
        element: u.element,
        echo: 4,
        team: u.team,
      });
      this.events.push({ type: 'echo', x: target.x, y: target.y, level: 5 });
      for (const o of foes)
        if (Math.hypot(o.x - target.x, o.y - target.y) < 150) this.damage(o, 45, u, 4, u.element);
    }
  }
}
