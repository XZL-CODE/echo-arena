// 程序化声音：全部用 Web Audio 现场合成，不带音频文件。
// 战斗事件先按类别合并与限流：同一批里相同的声音只响一次（次数越多越响一点），
// 各类声音有最短间隔和单位时间内的次数上限，同时发声的数量按优先级封顶；
// 每次发声带一点随机的音高与音量变化，重复的声音不会显得死板。
// 回响等级映射到五声音阶，连锁越长音越高，听起来像一段上行的旋律。
// 背景音乐用前瞻调度器按拍排音符，换曲时交叉淡入淡出。
import { DRAGON, SPECIES, SPECIES_IDS } from '../core/content/species.js';
import { ARENA } from '../core/content/tuning.js';
import type { ZoneKind } from '../core/sim/entities.js';
import type { AttackStyleEvent, SimEvent, StatusKind } from '../core/sim/events.js';
import type { Element, SkillId, Team } from '../core/types.js';

export interface AudioSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

/**
 * 界面音效。capture 收服新宠物；evolveCharge 进化动画的聚能（约 1.5 秒的渐强），
 * evolveBurst 形态切换的一瞬；focus / unfocus 设定与取消集火目标。
 */
export type UiSound =
  | 'click'
  | 'select'
  | 'error'
  | 'start'
  | 'reward'
  | 'win'
  | 'lose'
  | 'pause'
  | 'capture'
  | 'evolveCharge'
  | 'evolveBurst'
  | 'focus'
  | 'unfocus';

/** 背景音乐：菜单、战斗、首领战、胜利（一段号角后转入平静的循环）。 */
export type MusicMode = 'off' | 'menu' | 'battle' | 'boss' | 'victory';

// ---- 常量 ----

/** MIDI 音高转频率（69 = A4 = 440 Hz）。 */
function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 回响音符：C 大调五声音阶，从 C5 起，回响 1–8 级逐级升高。 */
const ECHO_NOTES = [72, 74, 76, 79, 81, 84, 86, 88];

/** 技能所属的属性（技能事件不带属性，按物种查）。 */
const SKILL_ELEMENT = new Map<SkillId, Element>([
  ...SPECIES_IDS.flatMap((id): [SkillId, Element][] => [
    [SPECIES[id].skill.id, SPECIES[id].element],
    [SPECIES[id].ult.id, SPECIES[id].element],
  ]),
  [DRAGON.breath.id, DRAGON.element],
  [DRAGON.tail.id, DRAGON.element],
  [DRAGON.summon.id, DRAGON.element],
  [DRAGON.ult.id, DRAGON.element],
]);

/** 声像最大偏移：我方在左、对手在右，只给一点方位感。 */
const PAN_WIDTH = 0.35;

/**
 * 优先级：0 普通攻击、持续伤害等轻微的声音，1 常规战斗声，2 回响、击倒、爆炸、撞击，
 * 3 界面、大招与首领变身。
 */
type Priority = 0 | 1 | 2 | 3;

/**
 * 各优先级的上限：[同时在响的次数, 声源（振荡器、噪声）数]，满了先让低优先级的。
 * 次数按“一次发声”（一个声音，含若干层）计。优先级 3 单独计数，不挤占战斗音效；
 * 两边的声源数都有硬上限，节点数量始终有界。
 */
const LIMITS: Record<Priority, readonly [number, number]> = {
  0: [12, 40],
  1: [18, 52],
  2: [24, 64],
  3: [12, 48],
};

/** 音乐同时存在的声源上限（含正在淡出的曲目）。 */
const MUSIC_CAP = 72;
/** 音乐调度：每隔 TICK_MS 毫秒排好接下来 LOOKAHEAD 秒内的音符。 */
const TICK_MS = 80;
const LOOKAHEAD = 0.3;

// ---- 合成积木 ----

/**
 * 一层声音：给了 wave 是振荡器，否则是噪声。时间以秒计，at 相对这次发声的开始时刻。
 * 振荡器的 f 是音高，可另加一个滤波器（截止频率 ff，可滑向 fto）；
 * 噪声的 f 是滤波器（默认带通）的频率。
 * 包络默认是敲击式（起音后指数衰减到结束）；给了 release 就是“起音—保持—释放”。
 */
interface Voice {
  wave?: OscillatorType;
  f: number;
  /** 在 glide 秒内（默认整段，有 then 时为前一半）滑到 to，给了 then 再在结尾滑到 then。 */
  to?: number;
  glide?: number;
  then?: number;
  dur: number;
  /** 峰值增益。 */
  g: number;
  at?: number;
  attack?: number;
  release?: number;
  filter?: BiquadFilterType;
  ff?: number;
  fto?: number;
  q?: number;
  /** 音分。 */
  detune?: number;
  /** 低沉的褐噪声（隆隆声、吼声）。 */
  brown?: boolean;
  /** 把音量切成若干个短脉冲：噼啪声、碎石声、闪光。 */
  crackle?: number;
  /** 颤音：速率（Hz）与深度（音分）。 */
  vib?: readonly [number, number];
}

interface PlayOptions {
  prio?: Priority;
  /** 声像，-1（左）到 1（右）。 */
  pan?: number;
  /** 送进混响的比例。 */
  verb?: number;
  /** 整体音量倍数。 */
  level?: number;
  /** 整体延后（秒）。 */
  delay?: number;
  /** 两个共振峰频率：全部声音先过这组带通，听起来像人声的元音（大招的合唱）。 */
  formant?: readonly [number, number];
}

function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 在 x 附近随机浮动 ±amount（比例）。 */
function vary(x: number, amount: number): number {
  return x * (1 + (Math.random() * 2 - 1) * amount);
}

function safeHz(x: number): number {
  return clamp(finite(x, 440), 10, 20000);
}

/** 按场地横坐标给一点左右声像。 */
function panOf(x: number): number {
  return clamp(finite(x / ARENA.width, 0.5) * 2 - 1, -1, 1) * PAN_WIDTH;
}

/** 频率变化：从 f 出发，按 Voice 里 to / then / glide 的约定滑动。 */
function sweep(
  p: AudioParam,
  f: number,
  to: number | undefined,
  then: number | undefined,
  glide: number | undefined,
  t: number,
  end: number,
): void {
  p.setValueAtTime(safeHz(f), t);
  if (to === undefined) return;
  const span = end - t;
  const mid = t + clamp(glide ?? (then === undefined ? span : span / 2), 0.005, span);
  p.exponentialRampToValueAtTime(safeHz(to), mid);
  if (then !== undefined && mid < end) p.exponentialRampToValueAtTime(safeHz(then), end);
}

/** 音量包络（见 Voice 的说明）；crackle 把整段切成一串逐渐变弱的短脉冲。 */
function envelope(p: AudioParam, v: Voice, t: number, end: number, scale: number): void {
  const peak = Math.max(0.0002, finite(v.g * scale, 0));
  const span = end - t;
  p.setValueAtTime(0.0001, t);
  if (v.crackle) {
    const n = Math.max(1, Math.round(v.crackle));
    const slot = span / n;
    const len = Math.min(0.018, slot * 0.2);
    for (let i = 0; i < n; i++) {
      const at = t + slot * (i + Math.random() * 0.75);
      const level = peak * (0.4 + Math.random() * 0.6) * (1 - (0.6 * i) / n);
      p.setValueAtTime(0.0001, at);
      p.exponentialRampToValueAtTime(Math.max(0.0002, level), at + len * 0.15);
      p.exponentialRampToValueAtTime(0.0001, at + len);
    }
    return;
  }
  const attack = clamp(v.attack ?? 0.004, 0.001, span * 0.9);
  p.exponentialRampToValueAtTime(peak, t + attack);
  if (v.release !== undefined) p.setValueAtTime(peak, Math.max(t + attack, end - v.release));
  p.exponentialRampToValueAtTime(0.0001, end);
}

function biquad(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  q: number | undefined,
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  if (q !== undefined) filter.Q.value = q;
  return filter;
}

/** 噪声样本：白噪声，或低沉的褐噪声（首尾接平，循环时没有咔嗒声）。 */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, brown: boolean): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = brown ? 24691 : 12345;
  let last = 0;
  for (let i = 0; i < length; i++) {
    seed = (seed * 16807) % 2147483647;
    const white = (seed / 2147483647) * 2 - 1;
    if (!brown) {
      data[i] = white;
      continue;
    }
    // 褐噪声：白噪声的“漏积分”，能量集中在低频。
    last = (last + 0.02 * white) / 1.02;
    data[i] = last;
  }
  if (!brown) return buffer;
  const first = data[0] ?? 0;
  const drift = (data[length - 1] ?? 0) - first;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const x = (data[i] ?? 0) - first - (drift * i) / length;
    data[i] = x;
    peak = Math.max(peak, Math.abs(x));
  }
  if (peak > 0) for (let i = 0; i < length; i++) data[i] = ((data[i] ?? 0) / peak) * 0.9;
  return buffer;
}

/** 混响的脉冲响应：越往后越暗、越弱的立体声噪声尾巴。 */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  let seed = 777;
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      const white = (seed / 2147483647) * 2 - 1;
      const k = i / length;
      smooth += (white - smooth) * (0.85 - 0.7 * k);
      data[i] = smooth * Math.pow(1 - k, 2.6) * Math.min(1, i / (rate * 0.004));
    }
  }
  return buffer;
}

/** 让 Promise 的失败安静地过去（挂起、恢复在个别环境会被拒绝）。 */
function quiet(p: Promise<unknown> | undefined): void {
  if (p && typeof p.catch === 'function') p.catch(() => undefined);
}

// ---- 音色 ----

/** 钟声的泛音：[频率倍数, 音量, 时长比例]，不成整数倍，低的长、高的短。 */
const BELL_PARTIALS: readonly (readonly [number, number, number])[] = [
  [0.5, 0.8, 1],
  [1, 1, 0.9],
  [1.19, 0.5, 0.7],
  [1.5, 0.4, 0.6],
  [2, 0.35, 0.5],
  [2.52, 0.25, 0.35],
  [3.01, 0.16, 0.25],
];

function bell(f: number, dur: number, g: number, at = 0): Voice[] {
  return BELL_PARTIALS.map(([mul, gain, len]): Voice => ({
    wave: 'sine',
    f: f * mul,
    dur: dur * len,
    g: g * gain,
    at,
    attack: 0.003,
  }));
}

/** 一串依次响起的音（琶音）：MIDI 音高、间隔与共同的音色。 */
function arp(notes: readonly number[], gap: number, v: Omit<Voice, 'f'>, start = 0): Voice[] {
  return notes.map((m, i): Voice => ({ ...v, f: hz(m), at: start + i * gap }));
}

/** 受击：按属性给音色；克制时加一声清亮的“叮”，被克制时发闷发低；回响越高音越高。 */
function hitVoices(el: Element, counter: 1 | 0 | -1, echo: number): Voice[] {
  const p = (1 + 0.035 * echo) * (counter === -1 ? 0.8 : 1) * vary(1, 0.05);
  const b = counter === 1 ? 1.5 : counter === -1 ? 0.5 : 1;
  const v: Voice[] = [];
  switch (el) {
    case 'fire':
      v.push(
        { wave: 'sine', f: 170 * p, to: 70 * p, dur: 0.14, g: 0.09 },
        { f: 1400 * b, to: 450 * b, q: 0.9, dur: 0.16, g: 0.08 },
        { f: 3600 * b, filter: 'highpass', dur: 0.14, g: 0.05, crackle: 4 },
      );
      break;
    case 'water':
      v.push(
        { f: 2200 * b, to: 700 * b, q: 1.2, dur: 0.2, g: 0.11 },
        { wave: 'sine', f: 380 * p, to: 950 * p, dur: 0.07, g: 0.06 },
        { wave: 'sine', f: 520 * p, to: 1250 * p, dur: 0.06, g: 0.042, at: 0.045 },
        { wave: 'sine', f: 150 * p, to: 80 * p, dur: 0.1, g: 0.06 },
      );
      break;
    case 'wood':
      v.push(
        { wave: 'triangle', f: 200 * p, to: 110 * p, dur: 0.11, g: 0.09 },
        { wave: 'sine', f: 620 * p, dur: 0.05, g: 0.045 },
        { f: 3200 * b, to: 1800 * b, q: 0.7, dur: 0.1, g: 0.05, at: 0.01, crackle: 3 },
      );
      break;
    case 'rock':
      v.push(
        { wave: 'sine', f: 120 * p, to: 55 * p, dur: 0.13, g: 0.1 },
        { f: 1100 * b, to: 400 * b, filter: 'lowpass', dur: 0.14, g: 0.1, crackle: 5 },
        { wave: 'triangle', f: 240 * p, to: 120 * p, dur: 0.06, g: 0.04 },
      );
      break;
    case 'thunder':
      v.push(
        {
          wave: 'sawtooth',
          f: 1800 * p,
          to: 260 * p,
          dur: 0.07,
          g: 0.05,
          filter: 'lowpass',
          ff: 4000 * b,
        },
        { f: 2600 * b, filter: 'highpass', dur: 0.08, g: 0.1, crackle: 3 },
        { wave: 'square', f: 110 * p, dur: 0.06, g: 0.017, filter: 'lowpass', ff: 900 },
        { wave: 'sine', f: 160 * p, to: 80 * p, dur: 0.08, g: 0.085 },
      );
      break;
  }
  if (counter === 1) {
    v.push(
      { wave: 'sine', f: 1568 * p, dur: 0.14, g: 0.04, at: 0.005 },
      { wave: 'triangle', f: 2349 * p, dur: 0.09, g: 0.022, at: 0.025 },
    );
  }
  return v;
}

/** 灼烧等持续伤害：很轻的一下。 */
function dotVoices(el: Element): Voice[] {
  if (el === 'fire') return [{ f: 4200, filter: 'highpass', dur: 0.06, g: 0.022, crackle: 2 }];
  return [{ f: vary(1800, 0.1), q: 1.5, dur: 0.035, g: 0.035 }];
}

/** 击倒：打倒敌人是清脆的“啵”加两声上行的叮；我方倒下是低沉发闷的一声。 */
function koVoices(foe: boolean): Voice[] {
  if (foe) {
    return [
      { wave: 'sine', f: vary(900, 0.05), to: 180, dur: 0.15, g: 0.13 },
      { f: 2600, q: 1.5, dur: 0.05, g: 0.08 },
      { wave: 'sine', f: hz(88), dur: 0.32, g: 0.045, at: 0.05 },
      { wave: 'sine', f: hz(91), dur: 0.36, g: 0.04, at: 0.1 },
    ];
  }
  return [
    { wave: 'sine', f: vary(420, 0.04), to: 110, dur: 0.24, g: 0.12 },
    { f: 700, filter: 'lowpass', dur: 0.14, g: 0.08 },
    { wave: 'triangle', f: hz(55), to: hz(50), dur: 0.4, g: 0.045, at: 0.06 },
  ];
}

/** 倒下后渐弱的一声：我方低回，对手轻轻一“噗”；首领倒下是隆隆的崩塌加钟声。 */
function deathVoices(kind: 'ally' | 'foe' | 'boss'): Voice[] {
  if (kind === 'boss') {
    return [
      { f: 600, to: 80, filter: 'lowpass', brown: true, dur: 2, g: 0.3, attack: 0.02 },
      { wave: 'sawtooth', f: 110, to: 38, dur: 1.5, g: 0.06, filter: 'lowpass', ff: 600, fto: 200 },
      { wave: 'sine', f: 58, to: 30, dur: 1.4, g: 0.24 },
      ...bell(hz(43), 3, 0.05, 0.25),
    ];
  }
  if (kind === 'ally') {
    return [
      { wave: 'triangle', f: hz(67), to: hz(62), glide: 0.5, dur: 0.75, g: 0.065, attack: 0.02 },
      { wave: 'sine', f: hz(55), dur: 0.85, g: 0.045, attack: 0.03 },
    ];
  }
  return [
    { f: 1200, to: 400, q: 0.8, dur: 0.26, g: 0.045 },
    { wave: 'sine', f: hz(76), to: hz(69), dur: 0.36, g: 0.03, attack: 0.01 },
  ];
}

/** 弓弦：射手的默认出手声。 */
function twang(): Voice[] {
  return [
    { wave: 'triangle', f: vary(330, 0.05), to: 290, dur: 0.16, g: 0.06 },
    { wave: 'sine', f: 660, dur: 0.05, g: 0.025 },
    { f: 3200, filter: 'highpass', dur: 0.05, g: 0.03 },
  ];
}

/** 普通攻击出手：近战挥砍、射击与抛投、施法、治疗。射击按出手者的属性换音色（认得出时）。 */
function attackVoices(style: AttackStyleEvent, el: Element | undefined): Voice[] {
  switch (style) {
    case 'melee': {
      const lo = vary(700, 0.15);
      const hi = vary(2600, 0.15);
      const up = Math.random() < 0.5;
      return [{ f: up ? lo : hi, to: up ? hi : lo, q: 1, dur: 0.13, g: 0.13, attack: 0.05 }];
    }
    case 'shoot':
      if (el === 'fire') {
        return [
          { f: 700, to: 1700, q: 1, dur: 0.15, g: 0.055, attack: 0.03 },
          { wave: 'sine', f: vary(220, 0.05), to: 330, dur: 0.1, g: 0.035 },
        ];
      }
      if (el === 'water') {
        return [
          { wave: 'sine', f: vary(300, 0.08), to: 720, dur: 0.08, g: 0.06 },
          { wave: 'sine', f: vary(480, 0.08), to: 1100, dur: 0.06, g: 0.035, at: 0.035 },
        ];
      }
      if (el === 'thunder') {
        return [
          {
            wave: 'square',
            f: vary(1500, 0.06),
            to: 480,
            dur: 0.08,
            g: 0.018,
            filter: 'lowpass',
            ff: 3200,
          },
          { f: 5200, filter: 'highpass', dur: 0.04, g: 0.03 },
        ];
      }
      return twang();
    case 'lob':
      return [
        { f: 450, to: 1200, q: 1.2, dur: 0.2, g: 0.055, attack: 0.07 },
        { wave: 'triangle', f: vary(170, 0.05), to: 130, dur: 0.1, g: 0.065 },
      ];
    case 'cast':
      return [
        { wave: 'sine', f: vary(1100, 0.06), to: 2300, dur: 0.09, g: 0.05 },
        { wave: 'sine', f: 2900, to: 3500, dur: 0.06, g: 0.02, at: 0.04 },
        { f: 3000, q: 0.8, dur: 0.08, g: 0.022, crackle: 2 },
      ];
    case 'heal':
      return [
        { wave: 'sine', f: hz(84), dur: 0.3, g: 0.035 },
        { wave: 'sine', f: hz(91), dur: 0.22, g: 0.018, at: 0.02 },
      ];
    default:
      return [];
  }
}

/** 技能声的合并与限流按属性归类；首领的招式各自单独算。 */
function skillKey(skill: SkillId): string {
  return skill.startsWith('dragon') ? `skill|${skill}` : `skill|${SKILL_ELEMENT.get(skill) ?? ''}`;
}

/** 放技能：一阵渐强的风声，按属性加一层底色；首领的三招各有专门的声音。 */
function skillVoices(skill: SkillId): Voice[] {
  if (skill === 'dragonBreath') {
    return [
      {
        wave: 'sawtooth',
        f: 95,
        to: 68,
        dur: 0.85,
        g: 0.07,
        attack: 0.12,
        filter: 'lowpass',
        ff: 700,
        vib: [24, 45],
      },
      { f: 900, to: 380, filter: 'lowpass', brown: true, dur: 0.85, g: 0.2, attack: 0.15 },
      { f: 3200, filter: 'highpass', dur: 0.7, g: 0.035, crackle: 8, at: 0.1 },
    ];
  }
  if (skill === 'dragonTail') {
    return [
      { f: 250, to: 900, q: 1, dur: 0.45, g: 0.13, attack: 0.22 },
      { wave: 'sine', f: 70, to: 50, dur: 0.4, g: 0.1, at: 0.1 },
    ];
  }
  if (skill === 'dragonSummon') {
    return [
      { wave: 'sine', f: hz(62), to: hz(74), dur: 0.65, g: 0.04, attack: 0.2 },
      { wave: 'sine', f: hz(69), to: hz(81), dur: 0.65, g: 0.03, attack: 0.25 },
      { f: 6000, filter: 'highpass', dur: 0.55, g: 0.02, attack: 0.2, crackle: 6 },
    ];
  }
  const v: Voice[] = [{ f: vary(420, 0.1), to: 2400, q: 1.3, dur: 0.28, g: 0.11, attack: 0.14 }];
  switch (SKILL_ELEMENT.get(skill)) {
    case 'fire':
      v.push(
        { wave: 'sawtooth', f: 110, to: 220, dur: 0.25, g: 0.05, filter: 'lowpass', ff: 900 },
        { f: 3500, filter: 'highpass', dur: 0.2, g: 0.05, crackle: 3, at: 0.05 },
      );
      break;
    case 'water':
      v.push(
        { wave: 'sine', f: 300, to: 900, dur: 0.2, g: 0.045 },
        { wave: 'sine', f: 450, to: 1300, dur: 0.15, g: 0.03, at: 0.08 },
      );
      break;
    case 'wood':
      v.push(
        { wave: 'sine', f: hz(79), to: hz(84), dur: 0.25, g: 0.035, attack: 0.05 },
        { wave: 'triangle', f: hz(86), dur: 0.15, g: 0.018, at: 0.1 },
      );
      break;
    case 'rock':
      v.push(
        { f: 400, filter: 'lowpass', brown: true, dur: 0.3, g: 0.1, attack: 0.08 },
        { wave: 'triangle', f: 80, to: 120, dur: 0.25, g: 0.05 },
      );
      break;
    case 'thunder':
      v.push(
        { wave: 'sawtooth', f: 200, to: 900, dur: 0.2, g: 0.04, filter: 'lowpass', ff: 2500 },
        { f: 4000, filter: 'highpass', dur: 0.12, g: 0.06, crackle: 3, at: 0.08 },
      );
      break;
    default:
      break;
  }
  return v;
}

/** 回响：木琴般的短音加一点闪烁，稍后轻轻再响一次（回声）；等级越高越华丽。 */
function echoVoices(level: number): Voice[] {
  const lv = clamp(Math.round(level), 1, ECHO_NOTES.length);
  const f = hz(ECHO_NOTES[lv - 1] ?? 72);
  const g = 0.11 + lv * 0.008;
  const v: Voice[] = [
    { wave: 'sine', f, dur: 0.6, g, attack: 0.002 },
    { wave: 'sine', f, detune: 7, dur: 0.45, g: g * 0.35, attack: 0.002 },
    { wave: 'triangle', f: f * 2, dur: 0.22, g: 0.04 },
    { wave: 'sine', f: f * 4, dur: 0.07, g: 0.02, attack: 0.001 },
    { wave: 'sine', f, dur: 0.4, g: g * 0.3, at: 0.13 },
  ];
  if (lv >= 4) v.push({ wave: 'sine', f: f * 1.5, dur: 0.42, g: 0.035, at: 0.02 });
  if (lv >= 6) v.push({ f: 9000, filter: 'highpass', dur: 0.3, g: 0.018, crackle: 6 });
  return v;
}

/** 爆炸：半径越大越低、越长、越响，按属性加噼啪、水花、花瓣、碎石或雷鸣。 */
function explodeVoices(el: Element, radius: number, echo: number): Voice[] {
  const s = clamp((finite(radius, 60) - 30) / 170, 0, 1);
  const p = (1 + 0.03 * echo) * vary(1, 0.05);
  const len = 0.3 + 0.55 * s;
  const v: Voice[] = [
    { wave: 'sine', f: (95 - 35 * s) * p, to: 34, dur: len, g: 0.13 + 0.15 * s },
    {
      f: (1600 - 500 * s) * p,
      to: 160,
      filter: 'lowpass',
      dur: len * 1.1,
      g: 0.1 + 0.12 * s,
      brown: s > 0.45,
    },
  ];
  switch (el) {
    case 'fire':
      v.push(
        {
          f: 3000,
          filter: 'highpass',
          dur: len * 0.9,
          g: 0.04 + 0.03 * s,
          crackle: 5 + Math.round(5 * s),
          at: 0.04,
        },
        { f: 900 * p, to: 280, q: 0.8, dur: 0.3, g: 0.06 },
      );
      break;
    case 'water':
      v.push(
        { f: 2400 * p, to: 600, q: 1, dur: 0.35 + 0.2 * s, g: 0.09 },
        { wave: 'sine', f: 400 * p, to: 1000 * p, dur: 0.06, g: 0.04, at: 0.1 },
        { wave: 'sine', f: 600 * p, to: 1300 * p, dur: 0.05, g: 0.03, at: 0.17 },
      );
      break;
    case 'wood':
      v.push(
        { f: 2800, to: 1400, q: 0.8, dur: 0.3 + 0.2 * s, g: 0.05, crackle: 4 },
        { wave: 'sine', f: hz(84) * p, dur: 0.45, g: 0.03, at: 0.05 },
        { wave: 'sine', f: hz(88) * p, dur: 0.4, g: 0.022, at: 0.1 },
      );
      break;
    case 'rock':
      v.push(
        { f: 900, filter: 'lowpass', dur: len, g: 0.09 + 0.04 * s, crackle: 6 + Math.round(4 * s) },
        { wave: 'sine', f: 80 * p, to: 48, dur: 0.22, g: 0.07, at: 0.12 + 0.08 * s },
      );
      break;
    case 'thunder':
      v.push(
        { f: 2500, filter: 'highpass', dur: 0.1, g: 0.12, attack: 0.001 },
        { wave: 'sawtooth', f: 1300 * p, to: 150, dur: 0.15, g: 0.03, filter: 'lowpass', ff: 3000 },
        {
          f: 320,
          filter: 'lowpass',
          brown: true,
          dur: 0.6 + 0.5 * s,
          g: 0.09 + 0.05 * s,
          at: 0.04,
          attack: 0.05,
        },
      );
      break;
  }
  return v;
}

/** 撞击（击飞后撞到单位或墙）：沉重的闷响，撞得越狠越低越响。 */
function impactVoices(strength: number, echo: number): Voice[] {
  const s = clamp((finite(strength, 300) - 150) / 1000, 0, 1);
  const p = (1 + 0.03 * echo) * vary(1, 0.06);
  return [
    { wave: 'sine', f: (135 - 60 * s) * p, to: 45, dur: 0.18 + 0.12 * s, g: 0.12 + 0.12 * s },
    { f: 700 + 500 * s, to: 150, filter: 'lowpass', dur: 0.12 + 0.08 * s, g: 0.09 + 0.1 * s },
    { wave: 'triangle', f: 280 * p, to: 160 * p, dur: 0.05, g: 0.045 },
  ];
}

/** 连锁（闪电跳跃、箭矢弹射等）：按属性的短促一下，回响越高音越高。 */
function chainVoices(el: Element, echo: number): Voice[] {
  const p = (1 + 0.04 * echo) * vary(1, 0.05);
  switch (el) {
    case 'thunder':
      return [
        {
          wave: 'sawtooth',
          f: 2600 * p,
          to: 700 * p,
          dur: 0.06,
          g: 0.06,
          filter: 'lowpass',
          ff: 5000,
        },
        { f: 4500, filter: 'highpass', dur: 0.06, g: 0.11, crackle: 2 },
      ];
    case 'wood':
      return [
        { f: 2500 * p, to: 4200 * p, q: 1.2, dur: 0.07, g: 0.1 },
        { wave: 'triangle', f: 700 * p, to: 1000 * p, dur: 0.05, g: 0.065 },
      ];
    case 'fire':
      return [
        { f: 1200 * p, to: 2400 * p, q: 1, dur: 0.09, g: 0.11 },
        { wave: 'sine', f: 300 * p, to: 450 * p, dur: 0.06, g: 0.055 },
      ];
    case 'water':
      return [{ wave: 'sine', f: 500 * p, to: 1200 * p, dur: 0.06, g: 0.1 }];
    case 'rock':
      return [
        { wave: 'sine', f: 2100 * p, dur: 0.09, g: 0.065 },
        { wave: 'sine', f: 2100 * 2.76 * p, dur: 0.05, g: 0.026 },
      ];
    default:
      return [];
  }
}

/** 反射：玻璃般清脆的一声。 */
function reflectVoices(echo: number): Voice[] {
  const f = 1318.5 * (1 + 0.03 * echo) * vary(1, 0.02);
  return [
    { wave: 'sine', f, dur: 0.42, g: 0.065, attack: 0.002 },
    { wave: 'sine', f: f * 2, dur: 0.2, g: 0.025 },
    { wave: 'sine', f: f * 2.76, dur: 0.14, g: 0.016 },
    { f: 7000, filter: 'highpass', dur: 0.05, g: 0.03 },
  ];
}

/** 泡泡护盾：上扬的气泡声加一层微微颤动的高音。 */
function shieldVoices(): Voice[] {
  return [
    { wave: 'sine', f: vary(350, 0.05), to: 1100, dur: 0.18, g: 0.055 },
    { wave: 'sine', f: hz(96), dur: 0.45, g: 0.018, at: 0.06, vib: [11, 30] },
    { f: 3000, q: 3, dur: 0.22, g: 0.02, attack: 0.05 },
  ];
}

/** 治疗：轻柔上行的两声（接在治疗出手的那一声后面，正好连成琶音）。 */
function healVoices(): Voice[] {
  return [
    { wave: 'sine', f: hz(88), dur: 0.28, g: 0.035, at: 0.05 },
    { wave: 'sine', f: hz(91), dur: 0.34, g: 0.03, at: 0.11 },
  ];
}

/** 眩晕：晃晃悠悠的颤音加两声“啾啾”。 */
function dizzy(at: number): Voice[] {
  return [
    { wave: 'triangle', f: 1100, dur: 0.36, g: 0.045, at, vib: [9, 70] },
    { wave: 'sine', f: 1500, to: 1300, dur: 0.08, g: 0.03, at: at + 0.1 },
    { wave: 'sine', f: 1700, to: 1500, dur: 0.08, g: 0.027, at: at + 0.2 },
  ];
}

/** 状态：眩晕与击飞、藤蔓定身、挑衅、架盾、石肤。灼烧与护盾另有声音，这里不响。 */
function statusVoices(kind: StatusKind): Voice[] {
  switch (kind) {
    case 'stun':
      return dizzy(0);
    case 'knockup':
      return [{ wave: 'sine', f: 180, to: 560, dur: 0.18, g: 0.05 }, ...dizzy(0.14)];
    case 'root':
      // 藤蔓的吱呀声：很低的锯齿波（每秒几十下的“摩擦”）只留中频。
      return [
        {
          wave: 'sawtooth',
          f: 38,
          to: 55,
          dur: 0.38,
          g: 0.14,
          filter: 'bandpass',
          ff: 950,
          q: 2.5,
        },
        { f: 1800, to: 1200, q: 1, dur: 0.26, g: 0.06, crackle: 3 },
      ];
    case 'taunt':
      return [
        {
          wave: 'sawtooth',
          f: 233,
          to: 262,
          glide: 0.06,
          dur: 0.22,
          g: 0.065,
          filter: 'lowpass',
          ff: 1400,
        },
        { wave: 'square', f: 117, dur: 0.2, g: 0.022, filter: 'lowpass', ff: 700 },
      ];
    case 'guard':
      return [
        { wave: 'triangle', f: 520, dur: 0.28, g: 0.06 },
        { wave: 'sine', f: 1370, dur: 0.2, g: 0.045 },
        { wave: 'sine', f: 2210, dur: 0.13, g: 0.03 },
        { wave: 'sine', f: 3050, dur: 0.08, g: 0.02 },
        { f: 5000, filter: 'highpass', dur: 0.03, g: 0.05 },
      ];
    case 'stoneSkin':
      return [
        { f: 900, filter: 'lowpass', dur: 0.2, g: 0.11, crackle: 4 },
        { wave: 'triangle', f: 150, to: 110, dur: 0.12, g: 0.07 },
      ];
    default:
      return [];
  }
}

/** 场地区域出现：箭雨的呼啸、藤蔓生长、水墙涌起、岩刺破土、火焰燃起、花朵绽放。 */
function zoneVoices(kind: ZoneKind): Voice[] {
  switch (kind) {
    case 'arrowRain':
      return [
        { f: 4200, to: 1400, q: 7, dur: 0.55, g: 0.15, attack: 0.1 },
        { f: 3600, to: 1100, q: 7, dur: 0.5, g: 0.11, at: 0.08, attack: 0.1 },
        { f: 3000, to: 900, q: 6, dur: 0.45, g: 0.09, at: 0.15, attack: 0.1 },
      ];
    case 'vines':
      return [
        { f: 500, to: 1600, q: 1.2, dur: 0.42, g: 0.2, crackle: 5 },
        {
          wave: 'sawtooth',
          f: 40,
          to: 60,
          dur: 0.36,
          g: 0.12,
          filter: 'bandpass',
          ff: 800,
          q: 2.5,
        },
      ];
    case 'waterWall':
      return [
        { f: 400, to: 2000, filter: 'lowpass', dur: 0.8, g: 0.12, attack: 0.28 },
        { wave: 'sine', f: 80, to: 110, dur: 0.7, g: 0.07, attack: 0.2 },
        { wave: 'sine', f: 600, to: 1400, dur: 0.1, g: 0.03, at: 0.35 },
      ];
    case 'spikes':
      return [
        ...[0, 1, 2, 3].map((i): Voice => ({
          f: vary(1300, 0.1),
          filter: 'lowpass',
          dur: 0.09,
          g: 0.075,
          crackle: 2,
          at: i * 0.045,
        })),
        { wave: 'sine', f: 110, to: 55, dur: 0.22, g: 0.1 },
      ];
    case 'spikeRing':
      return [
        { wave: 'sine', f: 90, to: 40, dur: 0.38, g: 0.16 },
        { f: 1500, to: 300, filter: 'lowpass', dur: 0.38, g: 0.13, crackle: 7 },
        { f: 3500, filter: 'highpass', dur: 0.1, g: 0.035 },
      ];
    case 'burn':
      return [
        { f: 300, to: 1600, q: 0.9, dur: 0.36, g: 0.2, attack: 0.08 },
        { f: 3500, filter: 'highpass', dur: 0.3, g: 0.07, crackle: 5, at: 0.05 },
      ];
    case 'blossom':
      return [
        ...arp([88, 91, 96], 0.05, { wave: 'sine', dur: 0.5, g: 0.032 }),
        { f: 5000, filter: 'highpass', dur: 0.4, g: 0.018, attack: 0.15 },
      ];
    default:
      return [];
  }
}

/** 冲刺：一阵风声，冲得越远越长。 */
function dashVoices(distance: number): Voice[] {
  const s = clamp(finite(distance, 200) / 400, 0, 1);
  const dur = 0.16 + 0.14 * s;
  return [
    { f: vary(600, 0.1), to: 2200, q: 1, dur, g: 0.13, attack: dur * 0.5 },
    { wave: 'sine', f: 150, to: 90, dur: 0.14, g: 0.045 },
  ];
}

/** 瞬身：急速上扬的一声加一点闪光。 */
function blinkVoices(): Voice[] {
  return [
    { wave: 'sine', f: vary(900, 0.05), to: 2900, dur: 0.07, g: 0.065 },
    { wave: 'sine', f: hz(96), dur: 0.2, g: 0.028, at: 0.05 },
    { f: 6000, filter: 'highpass', dur: 0.08, g: 0.05 },
  ];
}

/** 召唤物出场：“啵”的一声。 */
function spawnVoices(): Voice[] {
  return [
    { wave: 'sine', f: vary(480, 0.06), to: 1100, dur: 0.09, g: 0.065 },
    { f: 2000, q: 1, dur: 0.05, g: 0.035 },
  ];
}

/** 能量满：很轻的三声上行闪光，提示大招就绪。 */
function readyVoices(): Voice[] {
  return [
    ...arp([84, 88], 0.055, { wave: 'sine', dur: 0.16, g: 0.03 }),
    { wave: 'sine', f: hz(91), dur: 0.32, g: 0.03, at: 0.11 },
  ];
}

/** 首领化为人形：低吼扫频（三层失谐的锯齿波加褐噪声）冲上去，接一声大钟。 */
function transformVoices(): Voice[] {
  const roar = [-12, 0, 14].map((detune, i): Voice => ({
    wave: 'sawtooth',
    f: i === 2 ? 130 : 65,
    to: i === 2 ? 280 : 140,
    glide: 0.55,
    then: i === 2 ? 100 : 50,
    dur: 1.9,
    g: i === 2 ? 0.03 : 0.06,
    attack: 0.12,
    release: 0.9,
    detune,
    filter: 'lowpass',
    ff: 700,
    fto: 1400,
    q: 2,
    vib: [6.5 + i, 35],
  }));
  return [
    ...roar,
    { f: 500, to: 1400, then: 300, filter: 'lowpass', brown: true, dur: 1.7, g: 0.22, attack: 0.2 },
    { f: 300, to: 3500, q: 1.5, dur: 1.15, g: 0.07, attack: 0.95 },
    { wave: 'sine', f: 60, to: 32, dur: 1.1, g: 0.24, at: 1.05 },
    ...bell(hz(50), 3.2, 0.09, 1.05),
    { f: 6000, filter: 'highpass', dur: 0.06, g: 0.06, at: 1.05 },
  ];
}

/** 进入加时：一记低沉的鼓，接逐级变急的钟表嘀嗒，底下压着不和谐的低音。 */
function overtimeVoices(level: number): Voice[] {
  const ticks = clamp(1 + Math.round(level), 2, 5);
  const gap = Math.max(0.11, 0.24 - level * 0.02);
  const drone: Omit<Voice, 'f'> = {
    wave: 'sawtooth',
    dur: 1.3,
    g: 0.03,
    attack: 0.35,
    release: 0.6,
    filter: 'lowpass',
    ff: 420,
  };
  const v: Voice[] = [
    { wave: 'sine', f: 95, to: 45, dur: 0.5, g: 0.2 },
    { f: 400, filter: 'lowpass', dur: 0.22, g: 0.1 },
    { ...drone, f: hz(38) },
    { ...drone, f: hz(39), g: 0.018 },
  ];
  for (let i = 0; i < ticks; i++) {
    v.push({ f: 3200, filter: 'highpass', dur: 0.03, g: 0.06, at: 0.28 + i * gap, attack: 0.001 });
  }
  return v;
}

/** 界面音效的声音与混响送出量。 */
function uiVoices(sound: UiSound): { voices: Voice[]; verb: number } {
  switch (sound) {
    case 'click':
      return {
        verb: 0,
        voices: [
          { wave: 'triangle', f: 880, dur: 0.06, g: 0.12 },
          { wave: 'sine', f: 1320, dur: 0.04, g: 0.05, at: 0.01 },
        ],
      };
    case 'select':
      return {
        verb: 0,
        voices: [
          { wave: 'sine', f: 660, dur: 0.09, g: 0.12 },
          { wave: 'sine', f: 1320, dur: 0.05, g: 0.025 },
        ],
      };
    case 'error':
      return {
        verb: 0,
        voices: [
          { wave: 'square', f: 200, dur: 0.16, g: 0.05, filter: 'lowpass', ff: 1600 },
          { wave: 'square', f: 150, dur: 0.12, g: 0.03, at: 0.07, filter: 'lowpass', ff: 1200 },
        ],
      };
    case 'start':
      return {
        verb: 0.15,
        voices: [
          { wave: 'triangle', f: 392, dur: 0.12, g: 0.14 },
          { wave: 'triangle', f: 523.25, dur: 0.12, g: 0.14, at: 0.09 },
          { wave: 'triangle', f: 783.99, dur: 0.25, g: 0.14, at: 0.18 },
          { f: 800, to: 3000, q: 1, dur: 0.25, g: 0.04, attack: 0.12 },
        ],
      };
    case 'reward':
      return {
        verb: 0.25,
        voices: [
          ...arp([72, 76, 81, 84], 0.07, { wave: 'sine', dur: 0.3, g: 0.12 }),
          { wave: 'sine', f: hz(96), dur: 0.35, g: 0.03, at: 0.3 },
        ],
      };
    case 'win':
      return {
        verb: 0.3,
        voices: [
          ...arp([72, 76, 79, 84], 0.11, { wave: 'triangle', dur: 0.4, g: 0.16 }),
          { wave: 'sine', f: hz(91), dur: 0.6, g: 0.06, at: 0.45 },
          { f: 7000, filter: 'highpass', dur: 0.6, g: 0.02, at: 0.45, crackle: 8 },
        ],
      };
    case 'lose':
      return {
        verb: 0.2,
        voices: [
          ...arp([67, 63, 60], 0.16, { wave: 'sine', dur: 0.45, g: 0.14 }),
          { wave: 'triangle', f: hz(48), dur: 0.9, g: 0.05, at: 0.32 },
        ],
      };
    case 'pause':
      return { verb: 0, voices: [{ wave: 'sine', f: 440, dur: 0.08, g: 0.08 }] };
    case 'capture':
      return {
        verb: 0.3,
        voices: [
          { f: 900, to: 3500, q: 1.2, dur: 0.18, g: 0.05, attack: 0.08 },
          { wave: 'sine', f: 300, to: 900, dur: 0.12, g: 0.08 },
          { wave: 'triangle', f: 1400, to: 1000, dur: 0.04, g: 0.05, at: 0.14 },
          ...arp([79, 84, 88, 91], 0.07, { wave: 'sine', dur: 0.38, g: 0.075 }, 0.2),
          { f: 7000, filter: 'highpass', dur: 0.5, g: 0.02, at: 0.25, crackle: 8 },
        ],
      };
    case 'evolveCharge': {
      // 约 1.5 秒：噪声扫频与两层上滑的音一起渐强，五声音阶的小音符越来越密。
      const times = [0, 0.34, 0.6, 0.81, 0.98, 1.11, 1.22, 1.31, 1.38, 1.44];
      const notes = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93];
      return {
        verb: 0.3,
        voices: [
          { f: 300, to: 4500, q: 2, dur: 1.55, g: 0.12, attack: 1.35 },
          {
            wave: 'sawtooth',
            f: 110,
            to: 440,
            dur: 1.55,
            g: 0.045,
            attack: 1.3,
            filter: 'lowpass',
            ff: 700,
            fto: 3200,
            vib: [6, 15],
          },
          { wave: 'sine', f: 220, to: 880, dur: 1.55, g: 0.06, attack: 1.2, vib: [9, 22] },
          ...notes.map((m, i): Voice => ({
            wave: 'sine',
            f: hz(m),
            dur: 0.14,
            g: 0.034 + i * 0.003,
            at: times[i] ?? 0,
          })),
        ],
      };
    }
    case 'evolveBurst':
      return {
        verb: 0.45,
        voices: [
          { wave: 'sine', f: 90, to: 38, dur: 0.7, g: 0.18 },
          { f: 2500, to: 300, filter: 'lowpass', dur: 0.5, g: 0.1 },
          { f: 5000, filter: 'highpass', dur: 1.3, g: 0.03, crackle: 14 },
          ...[72, 76, 79, 84, 86].map((m, i): Voice => ({
            wave: 'triangle',
            f: hz(m),
            detune: (i - 2) * 4,
            dur: 1.5,
            g: 0.04,
            attack: 0.01,
          })),
          { wave: 'sine', f: hz(96), dur: 1.1, g: 0.028, at: 0.05, vib: [6, 12] },
          { wave: 'sine', f: hz(100), dur: 0.9, g: 0.02, at: 0.1 },
        ],
      };
    case 'focus':
      return {
        verb: 0,
        voices: [
          { wave: 'triangle', f: 1175, dur: 0.05, g: 0.08 },
          { wave: 'triangle', f: 1568, dur: 0.08, g: 0.08, at: 0.06 },
          { f: 6000, filter: 'highpass', dur: 0.02, g: 0.035 },
        ],
      };
    case 'unfocus':
      return { verb: 0, voices: [{ wave: 'triangle', f: 1175, to: 784, dur: 0.1, g: 0.065 }] };
    default:
      return { verb: 0, voices: [] };
  }
}

/** 大招合唱的和弦（MIDI）。 */
const ULT_CHORD: Record<Element, readonly number[]> = {
  fire: [60, 64, 67, 74],
  water: [53, 60, 65, 69],
  wood: [55, 62, 64, 69],
  rock: [50, 57, 62, 69],
  thunder: [52, 57, 59, 64],
};

/** 大招合唱的“元音”（两个共振峰）：火“啊”、水“呜”、木“欸”、岩“哦”、雷偏亮。 */
const ULT_FORMANT: Record<Element, readonly [number, number]> = {
  fire: [800, 1200],
  water: [400, 850],
  wood: [550, 1700],
  rock: [500, 900],
  thunder: [700, 1800],
};

/** 大招切入：一记低音冲击，渐强的风声冲上去再落下。 */
function ultWhoosh(): Voice[] {
  return [
    { wave: 'sine', f: 80, to: 40, dur: 0.5, g: 0.16 },
    { f: 350, to: 3200, q: 1.1, dur: 0.9, g: 0.11, attack: 0.6 },
    { f: 3000, to: 600, q: 1, dur: 0.75, g: 0.07, at: 0.8, attack: 0.02 },
  ];
}

/** 大招的合唱：每个和弦音两个失谐的锯齿波，慢起慢收，带一点颤音。 */
function ultChoir(el: Element): Voice[] {
  return ULT_CHORD[el].flatMap((m, i): Voice[] =>
    [-9, 9].map((detune, k): Voice => ({
      wave: 'sawtooth',
      f: hz(m),
      detune,
      dur: 2.1,
      g: 0.03,
      attack: 0.45,
      release: 0.9,
      vib: [5.1 + i * 0.25 + k * 0.4, 16],
    })),
  );
}

/** 大招的属性底色：火的噼啪、水的气泡与浪、木的笛声与沙沙、岩的巨响、雷的电光与雷鸣。 */
function ultColor(el: Element): Voice[] {
  switch (el) {
    case 'fire':
      return [
        { f: 3000, filter: 'highpass', dur: 1.2, g: 0.05, crackle: 12, at: 0.3 },
        { f: 300, to: 1200, filter: 'lowpass', brown: true, dur: 1.2, g: 0.12, attack: 0.5 },
      ];
    case 'water':
      return [
        ...[0.3, 0.45, 0.62, 0.8].map((at): Voice => ({
          wave: 'sine',
          f: vary(400, 0.1),
          to: 1200,
          dur: 0.08,
          g: 0.04,
          at,
        })),
        { f: 900, to: 2000, filter: 'lowpass', dur: 1, g: 0.08, attack: 0.5 },
      ];
    case 'wood':
      return [
        ...arp(
          [79, 81, 84],
          0.25,
          { wave: 'sine', dur: 0.5, g: 0.035, attack: 0.05, vib: [5, 10] },
          0.3,
        ),
        { f: 3000, q: 0.8, dur: 1, g: 0.03, crackle: 8, at: 0.2 },
      ];
    case 'rock':
      return [
        { wave: 'sine', f: 55, to: 35, dur: 1.2, g: 0.16, at: 0.6 },
        { f: 300, filter: 'lowpass', brown: true, dur: 1.2, g: 0.12, attack: 0.4 },
      ];
    case 'thunder':
      return [
        ...[0.35, 0.6, 0.78].map((at): Voice => ({
          wave: 'sawtooth',
          f: vary(2500, 0.1),
          to: 400,
          dur: 0.08,
          g: 0.03,
          at,
          filter: 'lowpass',
          ff: 5000,
        })),
        { f: 2500, filter: 'highpass', dur: 0.12, g: 0.1, at: 0.9 },
        { f: 250, filter: 'lowpass', brown: true, dur: 1.3, g: 0.1, at: 0.9, attack: 0.05 },
      ];
    default:
      return [];
  }
}

// ---- 背景音乐的曲谱 ----

type Song = Exclude<MusicMode, 'off'>;

/** 一个小节的和弦：贝斯根音与和弦音（MIDI）。 */
interface Chord {
  bass: number;
  tones: readonly number[];
}

interface SongDef {
  /** 每一步的时长（秒）。 */
  step: number;
  /** 回声（延迟反馈）的间隔、反馈量与送出量。 */
  echo: number;
  feedback: number;
  wet: number;
  /** 低通一路的截止频率。 */
  soft: number;
  /** 淡入的时间常数。 */
  fade: number;
}

const SONGS: Record<Song, SongDef> = {
  // 74 拍每分，八分音符一步。
  menu: { step: 60 / 74 / 2, echo: 0.608, feedback: 0.38, wet: 0.35, soft: 1800, fade: 0.6 },
  // 120 拍每分，十六分音符一步。
  battle: { step: 60 / 120 / 4, echo: 0.375, feedback: 0.25, wet: 0.18, soft: 1200, fade: 0.25 },
  // 92 拍每分，十六分音符一步。
  boss: { step: 60 / 92 / 4, echo: 0.489, feedback: 0.3, wet: 0.2, soft: 900, fade: 0.25 },
  // 号角之后接菜单式的平静循环。
  victory: { step: 60 / 74 / 2, echo: 0.608, feedback: 0.38, wet: 0.35, soft: 1800, fade: 0.02 },
};

/** 菜单：C 大调，垫音全用五声音阶里的音，贝斯给出和声的色彩。八小节一轮。 */
const MENU_CHORDS: readonly Chord[] = [
  { bass: 48, tones: [60, 64, 67, 74] },
  { bass: 45, tones: [57, 64, 67, 72] },
  { bass: 41, tones: [57, 60, 67, 74] },
  { bass: 43, tones: [55, 62, 64, 69] },
  { bass: 48, tones: [60, 64, 67, 74] },
  { bass: 40, tones: [52, 55, 62, 67] },
  { bass: 41, tones: [57, 60, 67, 74] },
  { bass: 43, tones: [55, 62, 67, 69] },
];

const MENU_SCALE = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93];

/** 菜单旋律：每小节一行、8 步，数字是 MENU_SCALE 的下标，-1 为休止。 */
const MENU_MELODY: readonly (readonly number[])[] = [
  [2, -1, 3, -1, 5, -1, -1, 6],
  [5, -1, 4, -1, 2, -1, -1, 3],
  [4, -1, 5, -1, 4, -1, 3, -1],
  [6, -1, -1, -1, 7, -1, 6, -1],
  [3, -1, 2, -1, 3, -1, 5, -1],
  [7, -1, 6, -1, -1, -1, 3, -1],
  [4, -1, 3, -1, 4, 5, -1, -1],
  [6, -1, -1, -1, -1, -1, -1, -1],
];

/** 战斗：A 小调，Am–F–C–G 推进。八小节一轮，后四小节加主旋律。 */
const BATTLE_CHORDS: readonly Chord[] = [
  { bass: 45, tones: [57, 60, 64, 69] },
  { bass: 41, tones: [57, 60, 65, 69] },
  { bass: 48, tones: [55, 60, 64, 67] },
  { bass: 43, tones: [55, 59, 62, 67] },
  { bass: 45, tones: [57, 60, 64, 69] },
  { bass: 41, tones: [57, 60, 65, 69] },
  { bass: 43, tones: [55, 59, 62, 67] },
  { bass: 40, tones: [52, 55, 59, 64] },
];

/** 贝斯的八分音符：相对根音的半音数。 */
const BATTLE_BASS = [0, 0, 12, 0, 7, 0, 12, 7];
/** 琶音：每个十六分音符取和弦里的第几个音。 */
const BATTLE_ARP = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];
/** 主旋律用的 A 小调五声音阶。 */
const LEAD_SCALE = [69, 72, 74, 76, 79, 81, 84, 86, 88];

/** 战斗主旋律（后四小节，每小节一行、16 步），数字是 LEAD_SCALE 的下标。 */
const BATTLE_LEAD: readonly (readonly number[])[] = [
  [5, -1, -1, 4, -1, -1, 3, -1, 4, -1, -1, -1, 2, -1, 3, -1],
  [1, -1, -1, 2, -1, -1, 3, -1, 2, -1, -1, -1, -1, -1, -1, -1],
  [4, -1, -1, 5, -1, -1, 6, -1, 5, -1, -1, 4, -1, -1, 3, -1],
  [3, -1, -1, -1, 2, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1],
];

/** 首领战：D 小调，低沉的持续音加重鼓。八小节一轮，后四小节加旋律与暗色和声。 */
const BOSS_CHORDS: readonly Chord[] = [
  { bass: 38, tones: [62, 65, 69] },
  { bass: 34, tones: [58, 62, 65] },
  { bass: 36, tones: [60, 64, 67] },
  { bass: 33, tones: [57, 60, 64] },
  { bass: 38, tones: [62, 65, 69] },
  { bass: 34, tones: [58, 62, 65] },
  { bass: 31, tones: [55, 58, 62] },
  { bass: 33, tones: [57, 60, 64] },
];

const BOSS_BASS = [0, 0, 0, 12, 0, 0, 12, 0];

/** 首领战旋律：后四小节里的第几步 → [MIDI, 持续步数]。 */
const BOSS_MELODY = new Map<number, readonly [number, number]>([
  [0, [86, 8]],
  [8, [84, 4]],
  [12, [81, 4]],
  [16, [82, 8]],
  [24, [81, 4]],
  [28, [77, 4]],
  [32, [79, 6]],
  [38, [81, 2]],
  [40, [82, 4]],
  [44, [86, 4]],
  [48, [88, 8]],
  [56, [86, 4]],
  [60, [84, 4]],
]);

/** 胜利号角（132 拍每分）：[第几拍, MIDI, 时值（拍）]。 */
const FANFARE: readonly (readonly [number, number, number])[] = [
  [0, 67, 0.3],
  [0.33, 67, 0.3],
  [0.67, 67, 0.3],
  [1, 72, 0.9],
  [2, 67, 0.3],
  [2.33, 72, 0.3],
  [2.67, 76, 0.3],
  [3, 79, 0.7],
  [3.75, 76, 0.25],
  [4, 84, 2.4],
];

/** 号角的和弦：[第几拍, 和弦音, 时值（拍）]。 */
const FANFARE_CHORDS: readonly (readonly [number, readonly number[], number])[] = [
  [1, [60, 64, 67], 0.9],
  [4, [60, 64, 67, 72], 2.4],
];

// ---- 引擎 ----

/** 同一批事件里同类声音的合并：次数、平均位置与最强的一次。 */
interface Tally {
  e: SimEvent;
  /** 越小越先播（同时发声数量紧张时，重要的声音先排上）。 */
  rank: number;
  /** 受击的细分：击倒、持续伤害；能量满时标明是否确认是我方。 */
  mark: '' | 'ko' | 'dot' | 'mine';
  n: number;
  x: number;
  score: number;
}

/** 音乐音符的去向：直出、走低通、直出并送进回声。 */
type Route = 'dry' | 'soft' | 'echo';

/** 一首曲子的总线：统一淡入淡出，下分直出、低通与回声三路。 */
interface MusicBus {
  song: Song;
  out: GainNode;
  dry: GainNode;
  soft: BiquadFilterNode;
  wet: GainNode;
  nodes: AudioNode[];
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  /** 音乐的入口：大招、变身时在这里短暂压低（与设置里的音量、暂停时的压低相乘）。 */
  private musicIn: GainNode | null = null;
  private verbIn: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private canPan = false;
  private settings: AudioSettings = {
    masterVolume: 0.8,
    sfxVolume: 0.8,
    musicVolume: 0.45,
    muted: false,
  };
  private duck = 1;
  /** 正在响的声音：战斗音效与界面音效各算各的（次数与声源数），音乐只计声源数。 */
  private battlePool = { cues: 0, sources: 0 };
  private uiPool = { cues: 0, sources: 0 };
  private musicLive = 0;
  /** 限流：各类声音上次响起的时刻，以及计数窗口。 */
  private lastAt = new Map<string, number>();
  private windows = new Map<string, { start: number; n: number }>();
  /** 从事件里认出的单位阵营与属性（能量满只提示我方、射击按属性换音色）；每场结束时清空。 */
  private teamOf = new Map<number, Team>();
  private elementOf = new Map<number, Element>();
  private musicMode: MusicMode = 'off';
  private bus: MusicBus | null = null;
  private fading: MusicBus[] = [];
  private clock: number | null = null;
  private seqStep = 0;
  private seqTime = 0;

  /** 建立音频环境。客户端允许无手势自动播放；普通浏览器里需要在第一次点击时调用。 */
  ensure(): void {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') quiet(this.ctx.resume());
        return;
      }
      const scope = globalThis as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      try {
        this.build(ctx);
      } catch {
        quiet(ctx.close());
        return;
      }
      this.ctx = ctx;
      this.applyVolumes();
      if (this.musicMode !== 'off') this.startSong();
    } catch {
      // 没有可用的音频环境时安静地不出声。
    }
  }

  apply(settings: AudioSettings): void {
    const old = this.settings;
    this.settings = {
      masterVolume: volume(settings.masterVolume, old.masterVolume),
      sfxVolume: volume(settings.sfxVolume, old.sfxVolume),
      musicVolume: volume(settings.musicVolume, old.musicVolume),
      muted: Boolean(settings.muted),
    };
    this.applyVolumes();
  }

  /** 窗口隐藏时挂起，回来时恢复。 */
  setSuspended(suspended: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      quiet(suspended ? ctx.suspend() : ctx.resume());
    } catch {
      // 忽略
    }
  }

  /** 对话框、过场时音乐压低。 */
  setDucked(ducked: boolean): void {
    this.duck = ducked ? 0.35 : 1;
    this.applyVolumes();
  }

  ui(sound: UiSound): void {
    if (!this.ctx) return;
    try {
      if (!this.admit(`ui|${sound}`, sound === 'evolveCharge' ? 0.5 : 0.04)) return;
      const { voices, verb } = uiVoices(sound);
      this.play(voices, { prio: 3, verb });
      if (sound === 'evolveBurst') this.dip(0.5, 1.2);
    } catch {
      // 声音出错不影响游戏。
    }
  }

  /** 大招切入画面开始时由界面调用：低音冲击、风声与按属性配色的合唱渐强。 */
  ult(element: Element): void {
    if (!this.ctx) return;
    try {
      const whoosh = ultWhoosh();
      const choir = ultChoir(element);
      const color = ultColor(element);
      // 三层要么一起响，要么都不响：同时放太多大招时，后来的整个让一让，不会只剩半截。
      const [maxCues, maxSources] = LIMITS[3];
      const layers = whoosh.length + choir.length + color.length;
      if (this.uiPool.cues + 3 > maxCues || this.uiPool.sources + layers > maxSources) return;
      if (!this.admit('ult', 0.4)) return;
      this.play(whoosh, { prio: 3, verb: 0.25 });
      this.play(choir, { prio: 3, verb: 0.45, level: 2.2, formant: ULT_FORMANT[element] });
      this.play(color, { prio: 3, verb: 0.3 });
      this.dip(0.45, 1.8);
    } catch {
      // 声音出错不影响游戏。
    }
  }

  /** 把一批战斗事件变成声音（合并、限流，激烈场面也不会刺耳）。playerTeam 是玩家一方。 */
  events(events: readonly SimEvent[], playerTeam: Team = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || events.length === 0) return;
    try {
      this.learn(events);
      this.battle(events, playerTeam);
    } catch {
      // 声音出错不影响游戏。
    }
  }

  /** 切换背景音乐：新曲淡入、旧曲淡出；同一首不会重头开始。 */
  setMusic(mode: MusicMode): void {
    try {
      if (mode === this.musicMode && (mode === 'off' || this.bus !== null)) return;
      this.musicMode = mode;
      this.startSong();
    } catch {
      // 声音出错不影响游戏。
    }
  }

  // ---- 环境 ----

  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const music = ctx.createGain();
    const musicIn = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    musicIn.connect(music);
    sfx.connect(master);
    music.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    this.white = noiseBuffer(ctx, 1, false);
    this.brown = noiseBuffer(ctx, 2, true);
    this.verbIn = null;
    try {
      const verb = ctx.createConvolver();
      verb.buffer = impulse(ctx, 1.6);
      const verbIn = ctx.createGain();
      const verbOut = ctx.createGain();
      verbOut.gain.value = 0.9;
      verbIn.connect(verb);
      verb.connect(verbOut);
      verbOut.connect(sfx);
      this.verbIn = verbIn;
    } catch {
      // 没有混响也照常出声。
    }
    this.canPan = typeof ctx.createStereoPanner === 'function';
    this.master = master;
    this.sfx = sfx;
    this.music = music;
    this.musicIn = musicIn;
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfx || !this.music) return;
    try {
      const s = this.settings;
      const now = ctx.currentTime;
      this.master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume, now, 0.03);
      this.sfx.gain.setTargetAtTime(s.sfxVolume, now, 0.03);
      this.music.gain.setTargetAtTime(s.musicVolume * 0.5 * this.duck, now, 0.08);
    } catch {
      // 忽略
    }
  }

  /** 大招、首领变身、进化时把音乐短暂压低，hold 秒后慢慢回来。 */
  private dip(depth: number, hold: number): void {
    const ctx = this.ctx;
    const gain = this.musicIn?.gain;
    if (!ctx || !gain) return;
    const now = ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setTargetAtTime(depth, now, 0.06);
    gain.setTargetAtTime(1, now + hold, 0.5);
  }

  // ---- 限流与发声 ----

  /**
   * 是否放行：同一个 key 至少间隔 gap 秒；给了 quota [类别, 次数, 秒] 时，
   * 该类别在这段时间里最多响这么多次。两项都通过才记账。
   */
  private admit(key: string, gap: number, quota?: readonly [string, number, number]): boolean {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const prev = this.lastAt.get(key);
    if (prev !== undefined && now >= prev && now - prev < gap) return false;
    if (quota) {
      const [name, max, span] = quota;
      let w = this.windows.get(name);
      if (!w || now < w.start || now - w.start >= span) {
        w = { start: now, n: 0 };
        this.windows.set(name, w);
      }
      if (w.n >= max) return false;
      w.n++;
    }
    this.lastAt.set(key, now);
    return true;
  }

  /** 发出一组声音（一次发声）：共用音量、声像与混响送出，全部结束后整体断开。 */
  private play(voices: readonly Voice[], o: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx || voices.length === 0) return false;
    const prio = o.prio ?? 1;
    const pool = prio === 3 ? this.uiPool : this.battlePool;
    const [maxCues, maxSources] = LIMITS[prio];
    if (pool.cues >= maxCues || pool.sources + voices.length > maxSources) return false;
    // 同时在响的战斗音效越多，每个声音越轻一点，激烈场面不会越叠越响。
    const density = prio === 3 ? 1 : 1 / Math.sqrt(1 + pool.cues / 12);
    const nodes: AudioNode[] = [];
    const close = (): void => {
      for (const node of nodes) node.disconnect();
    };
    try {
      const level = ctx.createGain();
      level.gain.value = clamp(finite((o.level ?? 1) * density, 1), 0, 4);
      nodes.push(level);
      let input: AudioNode = level;
      if (o.formant) {
        // 两个共振峰加一路低通的“胸腔”，锯齿波听起来就像合唱的元音。
        const split = ctx.createGain();
        nodes.push(split);
        for (const f of o.formant) {
          const band = biquad(ctx, 'bandpass', 5);
          band.frequency.value = f;
          split.connect(band);
          band.connect(level);
          nodes.push(band);
        }
        const chest = biquad(ctx, 'lowpass', 0.7);
        chest.frequency.value = o.formant[0];
        const chestGain = ctx.createGain();
        chestGain.gain.value = 0.35;
        split.connect(chest);
        chest.connect(chestGain);
        chestGain.connect(level);
        nodes.push(chest, chestGain);
        input = split;
      }
      let out: AudioNode = level;
      if (o.pan && this.canPan) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(o.pan, -1, 1);
        level.connect(panner);
        nodes.push(panner);
        out = panner;
      }
      out.connect(sfx);
      if (o.verb && this.verbIn) {
        const send = ctx.createGain();
        send.gain.value = o.verb;
        out.connect(send);
        send.connect(this.verbIn);
        nodes.push(send);
      }
      const t0 = ctx.currentTime + (o.delay ?? 0);
      const release = (): void => {
        close();
        pool.cues--;
      };
      pool.cues++;
      let live = 0;
      const done = (): void => {
        pool.sources--;
        live--;
        if (live === 0) release();
      };
      for (const v of voices) {
        if (this.voice(v, t0, input, null, 1, done)) {
          live++;
          pool.sources++;
        }
      }
      if (live === 0) release();
      return live > 0;
    } catch {
      close();
      return false;
    }
  }

  /** 按描述排一层声音，播完后断开它的全部节点并调用 done。返回是否排上。 */
  private voice(
    v: Voice,
    t0: number,
    dest: AudioNode,
    send: AudioNode | null,
    scale: number,
    done: () => void,
  ): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const t = Math.max(ctx.currentTime, t0 + finite(v.at ?? 0, 0));
    const end = t + Math.max(0.01, finite(v.dur, 0.1));
    const nodes: AudioNode[] = [];
    try {
      let src: AudioScheduledSourceNode;
      let head: AudioNode;
      let lfo: OscillatorNode | null = null;
      let noise: AudioBufferSourceNode | null = null;
      let offset = 0;
      if (v.wave) {
        const osc = ctx.createOscillator();
        osc.type = v.wave;
        sweep(osc.frequency, v.f, v.to, v.then, v.glide, t, end);
        if (v.detune) osc.detune.value = v.detune;
        nodes.push(osc);
        if (v.vib) {
          lfo = ctx.createOscillator();
          const depth = ctx.createGain();
          lfo.frequency.value = v.vib[0];
          depth.gain.value = v.vib[1];
          lfo.connect(depth);
          depth.connect(osc.detune);
          nodes.push(lfo, depth);
        }
        src = osc;
        head = osc;
        if (v.filter) {
          const filter = biquad(ctx, v.filter, v.q);
          sweep(filter.frequency, v.ff ?? 1200, v.fto, undefined, undefined, t, end);
          head.connect(filter);
          nodes.push(filter);
          head = filter;
        }
      } else {
        const buffer = v.brown ? this.brown : this.white;
        if (!buffer) return false;
        noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        // 每次从样本里随机的位置开始，重复的噪声听起来不一样。
        offset = Math.random() * buffer.duration * 0.9;
        const filter = biquad(ctx, v.filter ?? 'bandpass', v.q);
        sweep(filter.frequency, v.f, v.to, v.then, v.glide, t, end);
        noise.connect(filter);
        nodes.push(noise, filter);
        src = noise;
        head = filter;
      }
      const amp = ctx.createGain();
      envelope(amp.gain, v, t, end, scale);
      head.connect(amp);
      amp.connect(dest);
      if (send) amp.connect(send);
      nodes.push(amp);
      src.onended = () => {
        for (const node of nodes) node.disconnect();
        done();
      };
      // 全部接好之后再启动：前面出错时不会留下没人停止的声源。
      if (lfo) {
        lfo.start(t);
        lfo.stop(end + 0.02);
      }
      if (noise) noise.start(t, offset);
      else src.start(t);
      src.stop(end + 0.02);
      return true;
    } catch {
      for (const node of nodes) node.disconnect();
      return false;
    }
  }

  // ---- 战斗事件 ----

  /** 记下事件里能看出的单位阵营与属性。受击事件的 team 是攻击方，被打的一定是另一方。 */
  private learn(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'hit') {
        if (e.sourceId > 0) {
          this.teamOf.set(e.sourceId, e.team);
          if (!e.dot && e.source !== 'reflect') this.elementOf.set(e.sourceId, e.element);
        }
        this.teamOf.set(e.targetId, e.team === 0 ? 1 : 0);
      } else if (e.type === 'death') {
        this.teamOf.set(e.unitId, e.team);
      }
    }
    if (this.teamOf.size > 512) this.teamOf.clear();
    if (this.elementOf.size > 512) this.elementOf.clear();
  }

  /** 把一批事件合并成若干次发声，按重要程度依次播放。 */
  private battle(events: readonly SimEvent[], me: Team): void {
    const tallies = new Map<string, Tally>();
    const echoes = new Map<number, number>();
    const booms = new Set<Element>();
    const center = ARENA.width / 2;
    let ended = false;
    const add = (
      key: string,
      rank: number,
      e: SimEvent,
      x: number,
      score = 0,
      mark: Tally['mark'] = '',
    ): void => {
      const t = tallies.get(key);
      if (!t) {
        tallies.set(key, { e, rank, mark, n: 1, x, score });
        return;
      }
      t.n++;
      t.x += (x - t.x) / t.n;
      if (score > t.score) {
        t.e = e;
        t.score = score;
      }
    };
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.killed) add(`ko|${e.team === me ? 'foe' : 'ally'}`, 1, e, e.x, 0, 'ko');
          // 撞击造成的伤害由撞击的闷响代表，这里不再叠一层。
          if (e.dot) add(`dot|${e.element}`, 6, e, e.x, 0, 'dot');
          else if (e.source !== 'impact') add(`hit|${e.element}|${e.counter}`, 4, e, e.x, e.echo);
          break;
        case 'echo':
          if (e.level >= 1) echoes.set(clamp(Math.round(e.level), 1, 8), e.x);
          break;
        case 'explode':
          booms.add(e.element);
          add(`boom|${e.element}`, 2, e, e.x, e.radius + e.echo * 10);
          break;
        case 'impact':
          add('impact', 2, e, e.x, e.strength);
          break;
        case 'death': {
          const who = e.species === 'dragon' ? 'boss' : e.team === me ? 'ally' : 'foe';
          add(`death|${who}`, 1, e, e.x);
          break;
        }
        case 'transform':
        case 'overtime':
          add(e.type, 0, e, center, e.type === 'overtime' ? e.level : 0);
          break;
        case 'attack':
          add(`attack|${e.style}|${this.elementOf.get(e.unitId) ?? ''}`, 8, e, e.x);
          break;
        case 'skill':
          add(skillKey(e.skill), 5, e, e.x);
          break;
        case 'chain':
          add(`chain|${e.element}`, 5, e, (e.x1 + e.x2) / 2, e.echo);
          break;
        case 'reflect':
          add('reflect', 5, e, e.x, e.echo);
          break;
        case 'status':
          if (e.status !== 'burn' && e.status !== 'shield') add(`status|${e.status}`, 6, e, center);
          break;
        case 'zone':
          add(`zone|${e.kind}`, 6, e, e.x);
          break;
        case 'dash':
          add('dash', 7, e, (e.fromX + e.toX) / 2, Math.hypot(e.toX - e.fromX, e.toY - e.fromY));
          break;
        case 'blink':
          add('blink', 7, e, (e.fromX + e.toX) / 2);
          break;
        case 'shield':
          add('shield', 7, e, center);
          break;
        case 'heal':
          add('heal', 7, e, e.x);
          break;
        case 'spawn':
          add('spawn', 7, e, center);
          break;
        case 'energyFull': {
          // 只提示我方；认不出阵营时也响，但更轻。
          const team = this.teamOf.get(e.unitId);
          if (team === undefined) add('energy|?', 7, e, center);
          else if (team === me) add('energy|me', 7, e, center, 1, 'mine');
          break;
        }
        case 'end':
          ended = true;
          break;
        default:
          // 大招由界面在切入时调用 ult()；集火由界面播放 ui('focus')。
          break;
      }
    }
    if (echoes.size > 0) this.echoRun(echoes);
    const list = [...tallies.values()].sort((a, b) => a.rank - b.rank);
    for (const t of list) this.cue(t, me, booms);
    if (ended) {
      this.teamOf.clear();
      this.elementOf.clear();
    }
  }

  /** 一批里的回响按等级从低到高快速连奏（最多三个音），像一小段上行的琶音。 */
  private echoRun(levels: ReadonlyMap<number, number>): void {
    const sorted = [...levels.keys()].sort((a, b) => a - b).slice(-3);
    let delay = 0;
    for (const level of sorted) {
      if (!this.admit(`echo|${level}`, 0.07, ['echo', 4, 0.12])) continue;
      const pan = panOf(levels.get(level) ?? ARENA.width / 2);
      this.play(echoVoices(level), { prio: 2, pan, verb: 0.35, delay });
      delay += 0.035;
    }
  }

  /** 播放合并后的一类声音。 */
  private cue(t: Tally, me: Team, booms: ReadonlySet<Element>): void {
    const e = t.e;
    const pan = panOf(t.x);
    // 同一批里的次数越多越响一点，但有上限。
    const boost = Math.min(1.6, 1 + 0.22 * Math.log2(t.n)) * vary(1, 0.08);
    switch (e.type) {
      case 'hit': {
        if (t.mark === 'ko') {
          const foe = e.team === me;
          if (!this.admit(foe ? 'ko|foe' : 'ko|ally', 0.05, ['ko', 3, 0.12])) return;
          this.play(koVoices(foe), { prio: 2, pan, level: boost, verb: foe ? 0.2 : 0.1 });
          return;
        }
        if (t.mark === 'dot') {
          if (!this.admit(`dot|${e.element}`, 0.12, ['dot', 2, 0.1])) return;
          this.play(dotVoices(e.element), { prio: 0, pan });
          return;
        }
        if (!this.admit(`hit|${e.element}|${e.counter}`, 0.03, ['hit', 4, 0.06])) return;
        let level = boost * (e.counter === 1 ? 1.35 : e.counter === -1 ? 0.65 : 1);
        // 同属性的爆炸已经盖住了这一下，受击声让一让。
        if (booms.has(e.element)) level *= 0.55;
        const prio = e.counter === -1 ? 0 : 1;
        this.play(hitVoices(e.element, e.counter, e.echo), { prio, pan, level });
        return;
      }
      case 'explode':
        if (!this.admit(`boom|${e.element}`, 0.06, ['boom', 3, 0.12])) return;
        this.play(explodeVoices(e.element, e.radius, e.echo), {
          prio: 2,
          pan,
          level: boost,
          verb: 0.12 + 0.1 * clamp((e.radius - 30) / 170, 0, 1),
        });
        return;
      case 'impact':
        if (!this.admit('impact', 0.05, ['impact', 3, 0.12])) return;
        this.play(impactVoices(e.strength, e.echo), { prio: 2, pan, level: boost });
        return;
      case 'death': {
        const kind = e.species === 'dragon' ? 'boss' : e.team === me ? 'ally' : 'foe';
        if (!this.admit(`death|${kind}`, kind === 'foe' ? 0.06 : 0.15)) return;
        const prio = kind === 'boss' ? 3 : 2;
        this.play(deathVoices(kind), { prio, pan, verb: kind === 'foe' ? 0.1 : 0.35 });
        if (kind === 'boss') this.dip(0.4, 2);
        return;
      }
      case 'transform':
        if (!this.admit('transform', 1)) return;
        this.play(transformVoices(), { prio: 3, verb: 0.5 });
        this.dip(0.35, 2.4);
        return;
      case 'overtime':
        if (!this.admit('overtime', 0.5)) return;
        this.play(overtimeVoices(e.level), { prio: 3, verb: 0.2 });
        return;
      case 'attack':
        if (!this.admit(`attack|${e.style}`, 0.04, ['attack', 3, 0.06])) return;
        this.play(attackVoices(e.style, this.elementOf.get(e.unitId)), {
          prio: 0,
          pan,
          level: boost,
          verb: e.style === 'heal' ? 0.2 : 0,
        });
        return;
      case 'skill':
        if (!this.admit(skillKey(e.skill), 0.08, ['skill', 3, 0.15])) return;
        this.play(skillVoices(e.skill), { prio: 1, pan, level: boost, verb: 0.15 });
        return;
      case 'chain':
        if (!this.admit(`chain|${e.element}`, 0.045, ['chain', 3, 0.1])) return;
        this.play(chainVoices(e.element, e.echo), { prio: 1, pan, level: boost });
        return;
      case 'reflect':
        if (!this.admit('reflect', 0.05)) return;
        this.play(reflectVoices(e.echo), { prio: 1, pan, level: boost, verb: 0.25 });
        return;
      case 'status':
        if (!this.admit(`status|${e.status}`, 0.1, ['status', 3, 0.15])) return;
        this.play(statusVoices(e.status), { prio: 1, level: boost });
        return;
      case 'zone':
        if (!this.admit(`zone|${e.kind}`, 0.15, ['zone', 3, 0.2])) return;
        this.play(zoneVoices(e.kind), { prio: 1, pan, verb: e.kind === 'blossom' ? 0.35 : 0.12 });
        return;
      case 'dash':
        if (!this.admit('dash', 0.07)) return;
        this.play(dashVoices(t.score), { prio: 1, pan, level: boost });
        return;
      case 'blink':
        if (!this.admit('blink', 0.06)) return;
        this.play(blinkVoices(), { prio: 1, pan, level: boost, verb: 0.2 });
        return;
      case 'shield':
        if (!this.admit('shield', 0.12)) return;
        this.play(shieldVoices(), { prio: 1, level: boost, verb: 0.25 });
        return;
      case 'heal':
        if (!this.admit('heal', 0.16)) return;
        this.play(healVoices(), { prio: 0, pan, level: boost, verb: 0.3 });
        return;
      case 'spawn':
        if (!this.admit('spawn', 0.08)) return;
        this.play(spawnVoices(), { prio: 1, level: boost });
        return;
      case 'energyFull':
        if (!this.admit('energy', 0.25)) return;
        this.play(readyVoices(), { prio: 1, verb: 0.3, level: t.mark === 'mine' ? 1 : 0.5 });
        return;
      default:
        return;
    }
  }

  // ---- 背景音乐 ----

  /** 按当前曲目重新开始：旧曲淡出，新曲淡入并从头排起。 */
  private startSong(): void {
    const ctx = this.ctx;
    const input = this.musicIn;
    if (!ctx || !input) return;
    this.retireBus();
    const mode = this.musicMode;
    if (mode === 'off') {
      this.stopClock();
      return;
    }
    this.bus = this.makeBus(ctx, input, mode);
    this.seqStep = 0;
    const now = ctx.currentTime;
    // 胜利：稍等界面的胜利音效响过，再吹号角；号角之后接平静的循环。
    this.seqTime = mode === 'victory' ? now + 0.45 + this.fanfare(now + 0.45) : now + 0.1;
    this.startClock();
  }

  private makeBus(ctx: AudioContext, input: AudioNode, song: Song): MusicBus {
    const def = SONGS[song];
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, def.fade);
    out.connect(input);
    const dry = ctx.createGain();
    dry.connect(out);
    const soft = biquad(ctx, 'lowpass', 0.7);
    soft.frequency.value = def.soft;
    soft.connect(out);
    // 回声：延迟接低通再反馈回去，每次重复都更暗一点。
    const wet = ctx.createGain();
    wet.gain.value = def.wet;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = def.echo;
    const damp = biquad(ctx, 'lowpass', 0.5);
    damp.frequency.value = 2400;
    const feedback = ctx.createGain();
    feedback.gain.value = def.feedback;
    wet.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(out);
    return { song, out, dry, soft, wet, nodes: [out, dry, soft, wet, delay, damp, feedback] };
  }

  /** 当前曲目淡出，稍后断开；最多保留两段正在淡出的曲目。 */
  private retireBus(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    this.bus = null;
    if (!ctx || !bus) return;
    const gain = bus.out.gain;
    const now = ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setTargetAtTime(0, now, 0.35);
    this.fading.push(bus);
    globalThis.setTimeout(() => this.dropBus(bus), 2600);
    while (this.fading.length > 2) {
      const old = this.fading.shift();
      if (old) for (const node of old.nodes) node.disconnect();
    }
  }

  private dropBus(bus: MusicBus): void {
    const i = this.fading.indexOf(bus);
    if (i < 0) return;
    this.fading.splice(i, 1);
    for (const node of bus.nodes) node.disconnect();
  }

  private startClock(): void {
    if (this.clock !== null) return;
    this.clock = globalThis.setInterval(() => this.pump(), TICK_MS);
    this.pump();
  }

  private stopClock(): void {
    if (this.clock === null) return;
    globalThis.clearInterval(this.clock);
    this.clock = null;
  }

  /** 前瞻调度：把接下来 LOOKAHEAD 秒内要响的音符按 ctx.currentTime 排好。 */
  private pump(): void {
    try {
      const ctx = this.ctx;
      const bus = this.bus;
      if (!ctx || !bus || ctx.state !== 'running') return;
      const step = SONGS[bus.song].step;
      const now = ctx.currentTime;
      if (this.seqTime < now - 0.1) {
        // 主线程卡顿错过了几拍：直接跳过，不把错过的音符挤在一起补放。
        const missed = Math.ceil((now - this.seqTime) / step);
        this.seqStep += missed;
        this.seqTime += missed * step;
      }
      while (this.seqTime < now + LOOKAHEAD) {
        this.playStep(bus.song, this.seqStep, this.seqTime);
        this.seqStep++;
        this.seqTime += step;
      }
    } catch {
      // 声音出错不影响游戏。
    }
  }

  private playStep(song: Song, i: number, t: number): void {
    switch (song) {
      case 'menu':
        this.menuStep(i, t, 1);
        break;
      case 'battle':
        this.battleStep(i, t);
        break;
      case 'boss':
        this.bossStep(i, t);
        break;
      case 'victory':
        this.menuStep(i, t, 0.7);
        break;
    }
  }

  /** 排一个音乐音符。 */
  private note(v: Voice, t: number, route: Route = 'dry', scale = 1): void {
    const bus = this.bus;
    if (!bus || this.musicLive >= MUSIC_CAP) return;
    const dest = route === 'soft' ? bus.soft : bus.dry;
    const send = route === 'echo' ? bus.wet : null;
    const done = (): void => {
      this.musicLive--;
    };
    if (this.voice(v, t, dest, send, scale, done)) this.musicLive++;
  }

  /** 菜单：梦幻的五声音阶垫音加八音盒旋律；第二遍旋律高八度、只在拍点上响。 */
  private menuStep(i: number, t: number, level: number): void {
    const step = SONGS.menu.step;
    const s = i % 8;
    const bar = Math.floor(i / 8) % 8;
    const chord = MENU_CHORDS[bar];
    if (!chord) return;
    if (s === 0) {
      // 垫音：每个和弦音两个略微错开音高的振荡器，慢起慢收，和下一小节交叠。
      const soft = (v: Voice): void => this.note(v, t, 'soft', level);
      const pad = { dur: step * 8 + 1.4, release: 1.5 };
      chord.tones.forEach((m, k) => {
        const f = hz(m);
        soft({ ...pad, f, wave: 'triangle', g: 0.008, attack: 1.1, detune: k - 5 });
        soft({ ...pad, f, wave: 'sine', g: 0.007, attack: 1.3, detune: 6 - k });
      });
      const bass: Voice = { wave: 'sine', f: hz(chord.bass), dur: step * 8, g: 0.038 };
      this.note({ ...bass, attack: 0.1, release: 1.2 }, t, 'dry', level);
    }
    const idx = MENU_MELODY[bar]?.[s] ?? -1;
    if (idx < 0) return;
    const high = Math.floor(i / 64) % 2 === 1;
    if (high && s % 4 !== 0) return;
    const f = hz((MENU_SCALE[idx] ?? 72) + (high ? 12 : 0));
    const g = high ? 0.018 : 0.03;
    this.note({ wave: 'sine', f, dur: 1.2, g, attack: 0.004 }, t, 'echo', level);
    this.note({ wave: 'sine', f: f * 2, dur: 0.35, g: g * 0.25 }, t, 'echo', level);
  }

  /** 战斗：底鼓、军鼓、踩镲推着走，八分音符的贝斯、十六分音符的琶音，后四小节加主旋律。 */
  private battleStep(i: number, t: number): void {
    const step = SONGS.battle.step;
    const s = i % 16;
    const bar = Math.floor(i / 16) % 8;
    const chord = BATTLE_CHORDS[bar];
    if (!chord) return;
    const fill = bar === 3 || bar === 7;
    if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1) || (s === 14 && bar === 5)) {
      this.kick(t, s === 0 ? 1 : 0.85);
    }
    if (s === 4 || s === 12) this.snare(t, 1);
    if (fill && s >= 13) this.snare(t, 0.4 + (s - 13) * 0.2);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 1 : 0.55);
    else if (fill && s > 8) this.hat(t, 0.4);
    if (s === 0 && bar % 4 === 0) this.crash(t, 0.8);
    if (s % 2 === 0) {
      const f = hz(chord.bass + (BATTLE_BASS[s / 2] ?? 0));
      const bass: Voice = { wave: 'sawtooth', f, dur: 0.2, g: 0.05 };
      this.note({ ...bass, filter: 'lowpass', ff: 1100, fto: 280, q: 3 }, t);
    }
    // 琶音：拍点上重一点；有主旋律的后四小节不送回声，免得糊在一起。
    const tone = chord.tones[BATTLE_ARP[s] ?? 0] ?? chord.bass;
    const pluck: Voice = { wave: 'square', f: hz(tone + 12), dur: 0.09, g: s % 4 ? 0.009 : 0.014 };
    this.note({ ...pluck, filter: 'lowpass', ff: 2400 }, t, bar >= 4 ? 'dry' : 'echo');
    if (s === 0) {
      chord.tones.slice(0, 3).forEach((m, k) => {
        const pad: Voice = { wave: 'sawtooth', f: hz(m), dur: step * 16, g: 0.009 };
        this.note({ ...pad, attack: 0.3, release: 0.6, detune: k * 5 - 5 }, t, 'soft');
      });
    }
    if (bar < 4) return;
    const idx = BATTLE_LEAD[bar - 4]?.[s] ?? -1;
    if (idx < 0) return;
    const f = hz(LEAD_SCALE[idx] ?? 69);
    this.note({ wave: 'triangle', f, dur: 0.3, g: 0.04 }, t, 'echo');
    this.note({ wave: 'square', f, dur: 0.22, g: 0.008, filter: 'lowpass', ff: 2000 }, t, 'echo');
  }

  /** 首领战：沉重的大鼓与低音持续音，锣声开场；后四小节加暗色的和声与旋律。 */
  private bossStep(i: number, t: number): void {
    const step = SONGS.boss.step;
    const s = i % 16;
    const bar = Math.floor(i / 16) % 8;
    const chord = BOSS_CHORDS[bar];
    if (!chord) return;
    const fill = bar === 3 || bar === 7;
    if (s === 0 || s === 10) this.taiko(t, 1);
    else if (s === 6) this.taiko(t, 0.7);
    else if (s === 14 && !fill) this.taiko(t, 0.5);
    if (s === 4 || s === 12) this.clap(t);
    if (s % 2 === 0) this.hat(t, 0.4);
    if (fill && s >= 12) this.tom(t, s - 12);
    if (s === 0 && bar === 0) this.gong(t);
    if (s % 2 === 0) {
      const f = hz(chord.bass + (BOSS_BASS[s / 2] ?? 0));
      const bass: Voice = { wave: 'sawtooth', f, dur: 0.16, g: 0.042 };
      this.note({ ...bass, filter: 'lowpass', ff: 700, fto: 200, q: 2 }, t);
    }
    if (s === 0) {
      const len = step * 16;
      const sub: Voice = { wave: 'sine', f: hz(chord.bass), dur: len * 0.9, g: 0.035 };
      this.note({ ...sub, attack: 0.02, release: 0.4 }, t);
      // 持续音：高八度的根音加五度，走低通，压在底下。
      const drone: Omit<Voice, 'f' | 'g'> = {
        wave: 'sawtooth',
        dur: len + 0.3,
        attack: 0.3,
        release: 0.5,
      };
      this.note({ ...drone, f: hz(chord.bass + 12), g: 0.011 }, t, 'soft');
      this.note({ ...drone, f: hz(chord.bass + 19), g: 0.008 }, t, 'soft');
      if (bar >= 4) {
        for (const m of chord.tones) {
          const pad: Voice = { wave: 'triangle', f: hz(m), dur: len, g: 0.012 };
          this.note({ ...pad, attack: 0.5, release: 0.7 }, t, 'soft');
        }
      }
    }
    if (bar < 4) return;
    const melody = BOSS_MELODY.get((bar - 4) * 16 + s);
    if (!melody) return;
    const [m, steps] = melody;
    const len = steps * step;
    const lead: Voice = { wave: 'sawtooth', f: hz(m), dur: len, g: 0.018, attack: 0.04 };
    this.note({ ...lead, release: 0.2, filter: 'lowpass', ff: 1600, vib: [5, 12] }, t, 'echo');
    this.note({ wave: 'triangle', f: hz(m - 12), dur: len, g: 0.012, release: 0.2 }, t, 'echo');
  }

  /** 胜利号角：三连音引子、上行的主题，结束在带定音鼓滚奏与镲片的长和弦上。返回时长（秒）。 */
  private fanfare(t0: number): number {
    const beat = 60 / 132;
    for (const [at, m, len] of FANFARE) this.brass(hz(m), t0 + at * beat, len * beat, 0.05, true);
    for (const [at, chord, len] of FANFARE_CHORDS) {
      for (const m of chord) this.brass(hz(m), t0 + at * beat, len * beat, 0.022, false);
    }
    for (const at of [1, 3, 4]) {
      this.note({ wave: 'sine', f: 98, to: 82, dur: 0.6, g: 0.14 }, t0 + at * beat);
    }
    for (let k = 0; k < 4; k++) {
      const roll: Voice = { wave: 'sine', f: 98, to: 86, dur: 0.2, g: 0.05 + k * 0.015 };
      this.note(roll, t0 + (3.6 + k * 0.1) * beat);
    }
    this.crash(t0 + 4 * beat, 1);
    const sparkle = arp([84, 86, 88, 91, 93, 96], 0.05, { wave: 'sine', dur: 0.5, g: 0.022 });
    for (const v of sparkle) this.note(v, t0 + 4 * beat + 0.05, 'echo');
    return 6.4 * beat + 0.5;
  }

  /** 铜管：锯齿波过一个慢慢打开的低通；double 时再叠一个失谐的声部。 */
  private brass(f: number, t: number, len: number, g: number, double: boolean): void {
    const tone: Voice = { wave: 'sawtooth', f, dur: len, g, attack: 0.03 };
    const shape = { release: Math.min(0.25, len * 0.4), filter: 'lowpass' as const, ff: 1400 };
    this.note({ ...tone, ...shape, fto: 2400, detune: -6 }, t);
    if (double) this.note({ ...tone, ...shape, g: g * 0.7, fto: 2200, detune: 7 }, t);
  }

  private kick(t: number, g: number): void {
    this.note({ wave: 'sine', f: 150, to: 45, glide: 0.12, dur: 0.24, g: 0.16 * g }, t);
    this.note({ f: 1500, filter: 'lowpass', dur: 0.025, g: 0.05 * g }, t);
  }

  private snare(t: number, g: number): void {
    this.note({ f: 1900, q: 0.8, dur: 0.14, g: 0.08 * g }, t);
    this.note({ wave: 'triangle', f: 190, to: 150, dur: 0.08, g: 0.05 * g }, t);
  }

  private hat(t: number, g: number): void {
    this.note({ f: 7500, filter: 'highpass', dur: 0.035, g: 0.03 * g, attack: 0.001 }, t);
  }

  private crash(t: number, g: number): void {
    this.note({ f: 5000, filter: 'highpass', dur: 1.4, g: 0.04 * g, attack: 0.002 }, t);
  }

  /** 大鼓：低沉的正弦加一点噪声的皮面感。 */
  private taiko(t: number, g: number): void {
    this.note({ wave: 'sine', f: 110, to: 42, glide: 0.25, dur: 0.45, g: 0.14 * g }, t);
    this.note({ f: 500, filter: 'lowpass', dur: 0.15, g: 0.055 * g }, t);
  }

  private clap(t: number): void {
    this.note({ f: 1300, q: 0.7, dur: 0.22, g: 0.065 }, t);
    this.note({ wave: 'triangle', f: 160, to: 120, dur: 0.12, g: 0.042 }, t);
  }

  /** 过门的通通鼓，k 从 0 到 3 越来越低。 */
  private tom(t: number, k: number): void {
    const f = 210 - 30 * k;
    this.note({ wave: 'sine', f, to: f * 0.6, dur: 0.25, g: 0.085 }, t);
    this.note({ f: 900, filter: 'lowpass', dur: 0.06, g: 0.04 }, t);
  }

  private gong(t: number): void {
    for (const v of bell(hz(50), 3, 0.035)) this.note(v, t, 'echo');
  }
}

/** 音量取有限的非负数（界面给的是 0–1）；给了无效值时保留原来的设置。 */
function volume(x: number, fallback: number): number {
  return Number.isFinite(x) ? clamp(x, 0, 2) : fallback;
}
