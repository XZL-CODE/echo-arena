// 场地区域：燃烧地面、藤蔓（定身 + 拉拢）、箭雨、水墙、岩刺、花朵绽放。
// 岩刺与绽放只是画面上的余波，效果在生成时就结算了；水墙的反射与减伤在弹丸和伤害结算里处理。
import { SIM } from '../content/tuning.js';
import { dist, segmentDist2 } from '../math.js';
import type { Unit, Zone } from './entities.js';
import { zoneSegment } from './projectiles.js';
import type { World } from './world.js';

export function updateZones(world: World, dt: number): void {
  if (world.zones.length === 0) return;
  for (const z of world.zones) {
    z.t += dt;
    if (z.kind === 'burn') tickBurn(world, z, dt);
    else if (z.kind === 'vines') pullVines(world, z, dt);
    else if (z.kind === 'arrowRain') tickRain(world, z, dt);
  }
  const ended = world.zones.filter((z) => z.t >= z.duration);
  if (ended.length === 0) return;
  world.zones = world.zones.filter((z) => z.t < z.duration);
  for (const z of ended) {
    if (z.kind === 'vines' && z.damage > 0) blossom(world, z);
  }
}

/** 单位（按边缘）是否在区域内；线形区域按到线段的距离判断。 */
export function insideZone(z: Zone, u: Unit): boolean {
  if (z.angle !== undefined && z.length !== undefined) {
    const [ax, ay, bx, by] = zoneSegment(z);
    const r = z.r + u.radius;
    return segmentDist2(u.x, u.y, ax, ay, bx, by) <= r * r;
  }
  return dist(z.x, z.y, u.x, u.y) <= z.r + u.radius;
}

function opponentsInside(world: World, z: Zone): Unit[] {
  return world.units.filter((u) => u.alive && u.team !== z.team && insideZone(z, u));
}

function tickBurn(world: World, z: Zone, dt: number): void {
  z.tick -= dt;
  if (z.tick > 0) return;
  z.tick += SIM.dotTick;
  for (const u of opponentsInside(world, z)) {
    world.damage(u, z.damage * SIM.dotTick, {
      team: z.team,
      sourceId: z.ownerId,
      source: z.source,
      element: z.element,
      echo: 0,
      chain: z.chain,
      dot: true,
    });
  }
}

/** 藤蔓把圈里的敌人稳稳拉向中心（不算击飞，不会产生撞击），越重拉得越慢。 */
function pullVines(world: World, z: Zone, dt: number): void {
  for (const u of opponentsInside(world, z)) {
    const dx = z.x - u.x;
    const dy = z.y - u.y;
    const d = Math.hypot(dx, dy);
    const stop = u.radius * 0.6;
    if (d <= stop) continue;
    const speed = z.pull * Math.min(1, 1.6 / Math.sqrt(u.mass));
    const step = Math.min(speed * dt, d - stop);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
  }
}

function tickRain(world: World, z: Zone, dt: number): void {
  if (z.waves <= 0) return;
  z.tick -= dt;
  if (z.tick > 0) return;
  z.waves--;
  // 剩下的波次均匀排在剩余时间里，最后一波在箭雨结束前落下。
  z.tick = Math.max(0, z.duration - z.t) / (z.waves + 1);
  for (const u of opponentsInside(world, z)) {
    world.damage(u, z.damage, {
      team: z.team,
      sourceId: z.ownerId,
      source: z.source,
      element: z.element,
      echo: 0,
      chain: z.chain,
    });
  }
}

/** 万花缚结束：花朵绽放爆炸（回响 +1），并治疗全体队友。 */
function blossom(world: World, z: Zone): void {
  world.addZone({
    kind: 'blossom',
    team: z.team,
    x: z.x,
    y: z.y,
    r: z.r,
    duration: 0.8,
    ownerId: z.ownerId,
    source: z.source,
    element: z.element,
    chain: z.chain,
  });
  world.blast({
    x: z.x,
    y: z.y,
    radius: z.r,
    damage: z.damage,
    team: z.team,
    sourceId: z.ownerId,
    source: z.source,
    element: z.element,
    echo: 1,
    chain: z.chain,
    transfer: true,
  });
  for (const ally of world.units) {
    if (ally.alive && ally.team === z.team) world.heal(ally, ally.maxHp * z.heal, z.ownerId);
  }
}
