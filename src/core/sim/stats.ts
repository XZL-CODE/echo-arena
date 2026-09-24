// 战斗记录：只记录实际发生的事，供结算提示使用。
import type { DamageSource, EnemyUnitKind, ModuleId, PlayerUnitKind, UnitKind } from '../types.js';

export interface DeathRecord {
  kind: UnitKind;
  time: number;
  /** 造成最后一击的单位种类；爆炸、撞击等也会记到对应来源。 */
  by: UnitKind | DamageSource | null;
}

export interface BattleStats {
  duration: number;
  result: 'win' | 'lose' | null;
  timeout: boolean;
  /** 玩家对对手造成的伤害，按来源拆分。 */
  damageBySource: Partial<Record<DamageSource, number>>;
  damageDealtByUnit: Record<PlayerUnitKind, number>;
  damageTakenByUnit: Record<PlayerUnitKind, number>;
  /** 对手受到来自对手自身的伤害（反射回去的除外），如爆爆虫炸到同伴。 */
  enemyFriendlyFire: number;
  killsBySource: Partial<Record<DamageSource, number>>;
  playerDeaths: DeathRecord[];
  enemyDeaths: DeathRecord[];
  /** 对手出场总数与总生命（含后续波次）。 */
  enemyCount: number;
  enemyTotalHp: number;
  maxEcho: number;
  /** 最长那条回响链里依次出现过的来源。 */
  bestChainSources: DamageSource[];
  echoHits: number;
  reflects: number;
  ricochets: number;
  bounces: number;
  impacts: number;
  blasts: number;
  /** 我方弹丸被对手正面盾挡下 / 被镜盾反射的次数。 */
  blockedByEnemy: number;
  reflectedByEnemy: number;
  /** 我方挡下的敌方弹丸。 */
  blockedByGuard: number;
  enemyHealing: number;
  healerKinds: EnemyUnitKind[];
  playerHealing: number;
  activesUsed: Partial<Record<ModuleId, number>>;
  focusUsed: number;
}

export function createStats(): BattleStats {
  return {
    duration: 0,
    result: null,
    timeout: false,
    damageBySource: {},
    damageDealtByUnit: { guard: 0, slinger: 0, bell: 0 },
    damageTakenByUnit: { guard: 0, slinger: 0, bell: 0 },
    enemyFriendlyFire: 0,
    killsBySource: {},
    playerDeaths: [],
    enemyDeaths: [],
    enemyCount: 0,
    enemyTotalHp: 0,
    maxEcho: 0,
    bestChainSources: [],
    echoHits: 0,
    reflects: 0,
    ricochets: 0,
    bounces: 0,
    impacts: 0,
    blasts: 0,
    blockedByEnemy: 0,
    reflectedByEnemy: 0,
    blockedByGuard: 0,
    enemyHealing: 0,
    healerKinds: [],
    playerHealing: 0,
    activesUsed: {},
    focusUsed: 0,
  };
}

export function addTo<K extends string>(
  record: Partial<Record<K, number>>,
  key: K,
  amount: number,
): void {
  record[key] = (record[key] ?? 0) + amount;
}
