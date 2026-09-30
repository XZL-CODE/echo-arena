// 胜利奖励：同时给出两行——收服（3 只候选宠物，军团未满时才有）与进化（3 个自己宠物的进化）。
// 候选全部由种子决定，同一场重开得到的奖励相同。
import { ARMY_CAPS, encounterById } from '../content/encounters.js';
import { SPECIES_IDS } from '../content/species.js';
import { hashSeed, Rng } from '../rng.js';
import type { Form, LegionPet, SpeciesId } from '../types.js';

export interface CaptureOffer {
  species: SpeciesId;
  form: Form;
}

export interface EvolveOffer {
  uid: number;
  species: SpeciesId;
  from: Form;
  to: Form;
}

export interface RewardOffer {
  capture: CaptureOffer[];
  evolve: EvolveOffer[];
}

export const OFFER_COUNT = 3;

/** 从第几次奖励（0 起）开始允许 2 阶进化到 3 阶人形态。 */
export const FORM3_FROM_REWARD = 1;

/** 生成第 matchIndex 场（0 起）胜利后的奖励。 */
export function generateRewards(
  seed: number,
  matchIndex: number,
  encounterId: string,
  legion: readonly LegionPet[],
): RewardOffer {
  const rng = new Rng(hashSeed(seed, 'rewards', matchIndex));
  const nextCap = ARMY_CAPS[matchIndex + 1] ?? ARMY_CAPS[ARMY_CAPS.length - 1] ?? 10;
  return {
    capture: legion.length < nextCap ? captureOffers(rng, matchIndex, encounterId) : [],
    evolve: evolveOffers(rng, matchIndex, legion),
  };
}

/**
 * 收服候选：先从刚打败的训练家的军团里出，不够再从其他物种里补。
 * 前三次奖励都是幼年；第 4 次起有进化形态的候选（来自训练家的军团）。
 */
function captureOffers(rng: Rng, matchIndex: number, encounterId: string): CaptureOffer[] {
  const beaten = [...new Set(encounterById(encounterId).legion.map((p) => p.species))];
  const trainer = rng.shuffle(beaten);
  const others = rng.shuffle(SPECIES_IDS.filter((s) => !beaten.includes(s)));
  const species = [...trainer, ...others].slice(0, OFFER_COUNT);
  const evolved = matchIndex >= 4 ? 2 : matchIndex === 3 ? 1 : 0;
  return species.map((s, i) => ({ species: s, form: i < evolved ? 2 : 1 }));
}

/**
 * 进化候选：幼年随时可以进化；进化形态从第 2 次奖励起可以进化为人形态。
 * 能进化到人形态时，三个候选里至少有一个是它。
 */
function evolveOffers(rng: Rng, matchIndex: number, legion: readonly LegionPet[]): EvolveOffer[] {
  const allowForm3 = matchIndex >= FORM3_FROM_REWARD;
  const eligible = legion.filter((p) => p.form === 1 || (p.form === 2 && allowForm3));
  const order = rng.shuffle([...eligible]);
  let picked = order.slice(0, OFFER_COUNT);
  const toForm3 = order.find((p) => p.form === 2);
  if (toForm3 && !picked.some((p) => p.form === 2)) {
    picked = [...picked.slice(0, OFFER_COUNT - 1), toForm3];
  }
  return picked.map((p) => ({
    uid: p.uid,
    species: p.species,
    from: p.form,
    to: (p.form + 1) as Form,
  }));
}
