// 演示用的自动操作：标题画面背景里的示范对局会按它发动招式。
import { dist } from '../core/math.js';
import type { World } from '../core/sim/world.js';
import { PLAYER_UNITS } from '../core/types.js';

export function autoCast(world: World): void {
  const enemies = world.aliveOf(1);
  if (enemies.length === 0) return;
  for (const kind of PLAYER_UNITS) {
    const u = world.playerUnit(kind);
    if (!u || !u.alive || !u.active || u.activeCd > 0) continue;
    let best = enemies[0];
    let bestScore = -1;
    for (const e of enemies) {
      let score = 0;
      for (const o of enemies) if (dist(e.x, e.y, o.x, o.y) < 150) score++;
      if (u.active === 'charge' && dist(u.x, u.y, e.x, e.y) > 420) score -= 10;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best || (u.active === 'vortex' && bestScore < 2)) continue;
    world.castActive(kind, best.x, best.y);
  }
}
