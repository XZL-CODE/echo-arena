// 战斗记录：只记录实际发生的事，供结算与提示使用。按玩家宠物的 uid 分项。
import type { BossId, DamageSource, Form, SpeciesId, Team } from '../types.js';

/** 开战时玩家军团的快照，结算按 uid 找回名字。 */
export interface PetRecord {
  uid: number;
  species: SpeciesId;
  form: Form;
}

export interface DeathRecord {
  /** 玩家宠物的 uid；对手为 0。 */
  uid: number;
  species: SpeciesId | BossId;
  form: number;
  team: Team;
  time: number;
  /** 最后一击来自谁（没有来源时为 null）。 */
  bySpecies: SpeciesId | BossId | null;
  byForm: number;
  source: DamageSource | null;
}

export interface BattleStats {
  duration: number;
  result: 'win' | 'lose' | null;
  timeout: boolean;
  pets: PetRecord[];
  /** 玩家宠物造成 / 承受的伤害（键为 uid）。 */
  damageByUid: Record<number, number>;
  takenByUid: Record<number, number>;
  /** 玩家一方造成的伤害按来源拆分（技能 id、basic、impact、reflect）。 */
  damageBySkill: Partial<Record<DamageSource, number>>;
  killsByUid: Record<number, number>;
  healingByUid: Record<number, number>;
  shieldByUid: Record<number, number>;
  skillsByUid: Record<number, number>;
  ultsByUid: Record<number, number>;
  enemyUlts: number;
  totalDealt: number;
  totalTaken: number;
  maxEcho: number;
  /** 最长那条回响链里依次出现过的来源。 */
  bestChainSources: DamageSource[];
  /** 带回响的命中次数（玩家一方）。 */
  echoHits: number;
  /** 我方把敌方弹丸弹回去的次数。 */
  reflects: number;
  /** 我方的弹射与连锁跳跃次数。 */
  chains: number;
  /** 我方击飞造成的撞击次数。 */
  impacts: number;
  /** 我方引发的带回响的爆炸（连爆、引爆）次数。 */
  blasts: number;
  focusUsed: number;
  /** 我方克制对手的命中次数与因此多打出的伤害。 */
  counterHits: number;
  counterBonus: number;
  /** 我方被克制的命中次数与因此少打的伤害。 */
  counteredHits: number;
  counteredLoss: number;
  /** 对手克制我方时多打出的伤害。 */
  enemyCounterBonus: number;
  playerHealing: number;
  enemyHealing: number;
  playerDeaths: DeathRecord[];
  enemyDeaths: DeathRecord[];
  /** 对手出场总数与总生命（含召唤物）。 */
  enemyCount: number;
  enemyTotalHp: number;
}

export function createStats(): BattleStats {
  return {
    duration: 0,
    result: null,
    timeout: false,
    pets: [],
    damageByUid: {},
    takenByUid: {},
    damageBySkill: {},
    killsByUid: {},
    healingByUid: {},
    shieldByUid: {},
    skillsByUid: {},
    ultsByUid: {},
    enemyUlts: 0,
    totalDealt: 0,
    totalTaken: 0,
    maxEcho: 0,
    bestChainSources: [],
    echoHits: 0,
    reflects: 0,
    chains: 0,
    impacts: 0,
    blasts: 0,
    focusUsed: 0,
    counterHits: 0,
    counterBonus: 0,
    counteredHits: 0,
    counteredLoss: 0,
    enemyCounterBonus: 0,
    playerHealing: 0,
    enemyHealing: 0,
    playerDeaths: [],
    enemyDeaths: [],
    enemyCount: 0,
    enemyTotalHp: 0,
  };
}

export function addTo<K extends string | number>(
  record: Partial<Record<K, number>>,
  key: K,
  amount: number,
): void {
  record[key] = (record[key] ?? 0) + amount;
}
