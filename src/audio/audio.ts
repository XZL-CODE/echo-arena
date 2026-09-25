// 程序化声音：全部用 Web Audio 现场合成，不带音频文件。
// 回响等级映射到五声音阶，连锁越长音越高，听起来像一段上行的旋律。
import type { SimEvent } from '../core/sim/events.js';

export interface AudioSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

export type UiSound =
  'click' | 'select' | 'equip' | 'error' | 'start' | 'reward' | 'win' | 'lose' | 'pause';

/** C 大调五声音阶，从 C5 开始。 */
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

const MUSIC_NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const MELODY = [0, 2, 4, -1, 3, 2, 1, -1, 0, 2, 5, -1, 4, 3, 2, -1];
const BASS = [130.81, 98.0, 110.0, 87.31];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: AudioSettings = {
    masterVolume: 0.8,
    sfxVolume: 0.8,
    musicVolume: 0.45,
    muted: false,
  };
  private last = new Map<string, number>();
  private voices = 0;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicTime = 0;
  private musicMode: 'off' | 'menu' | 'battle' = 'off';
  private duck = 1;

  /** 建立音频环境。客户端允许无手势自动播放；普通浏览器里需要在第一次点击时调用。 */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    this.noiseBuffer = buffer;
    this.applyVolumes();
  }

  apply(settings: AudioSettings): void {
    this.settings = { ...settings };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfx || !this.music) return;
    const now = this.ctx.currentTime;
    const m = this.settings.muted ? 0 : this.settings.masterVolume;
    this.master.gain.setTargetAtTime(m, now, 0.03);
    this.sfx.gain.setTargetAtTime(this.settings.sfxVolume, now, 0.03);
    this.music.gain.setTargetAtTime(this.settings.musicVolume * 0.5 * this.duck, now, 0.08);
  }

  /** 窗口隐藏时挂起，回来时恢复。 */
  setSuspended(suspended: boolean): void {
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** 暂停时音乐压低。 */
  setDucked(ducked: boolean): void {
    this.duck = ducked ? 0.35 : 1;
    this.applyVolumes();
  }

  // ---- 合成积木 ----

  private allow(key: string, gapMs: number): boolean {
    if (!this.ctx || this.voices > 36) return false;
    const now = this.ctx.currentTime * 1000;
    const prev = this.last.get(key) ?? -1e9;
    if (now - prev < gapMs) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(
    freq: number,
    duration: number,
    options: {
      type?: OscillatorType;
      gain?: number;
      attack?: number;
      endFreq?: number;
      delay?: number;
      dest?: AudioNode | null;
    } = {},
  ): void {
    const ctx = this.ctx;
    const dest = options.dest ?? this.sfx;
    if (!ctx || !dest) return;
    const t = ctx.currentTime + (options.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (options.endFreq)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFreq), t + duration);
    const peak = options.gain ?? 0.2;
    const attack = options.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    this.voices++;
    osc.onended = () => {
      this.voices--;
      g.disconnect();
    };
  }

  private noise(
    duration: number,
    options: {
      type?: BiquadFilterType;
      freq?: number;
      endFreq?: number;
      q?: number;
      gain?: number;
      delay?: number;
      attack?: number;
    } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noiseBuffer) return;
    const t = ctx.currentTime + (options.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.setValueAtTime(options.freq ?? 1500, t);
    if (options.endFreq)
      filter.frequency.exponentialRampToValueAtTime(options.endFreq, t + duration);
    filter.Q.value = options.q ?? 1;
    const g = ctx.createGain();
    const peak = options.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (options.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.02);
    this.voices++;
    src.onended = () => {
      this.voices--;
      g.disconnect();
    };
  }

  /** 回响音符：木琴般的短音，等级越高音越高。 */
  private echoNote(level: number): void {
    const freq = SCALE[Math.min(SCALE.length - 1, Math.max(0, level - 1))] as number;
    this.tone(freq, 0.42, { gain: 0.16 + Math.min(0.1, level * 0.015), attack: 0.003 });
    this.tone(freq * 4, 0.12, { gain: 0.035, attack: 0.002 });
    this.tone(freq * 2, 0.25, { gain: 0.05, type: 'triangle' });
  }

  // ---- 对外接口 ----

  ui(sound: UiSound): void {
    if (!this.allow(`ui-${sound}`, 40)) return;
    switch (sound) {
      case 'click':
        this.tone(880, 0.06, { type: 'triangle', gain: 0.12 });
        this.tone(1320, 0.04, { gain: 0.05, delay: 0.01 });
        break;
      case 'select':
        this.tone(660, 0.08, { gain: 0.12 });
        break;
      case 'equip':
        this.noise(0.03, { freq: 3000, q: 4, gain: 0.25 });
        this.tone(523, 0.07, { type: 'triangle', gain: 0.14 });
        this.tone(784, 0.1, { type: 'triangle', gain: 0.14, delay: 0.06 });
        break;
      case 'error':
        this.tone(200, 0.16, { type: 'square', gain: 0.05 });
        break;
      case 'start':
        this.tone(392, 0.12, { type: 'triangle', gain: 0.14 });
        this.tone(523, 0.12, { type: 'triangle', gain: 0.14, delay: 0.09 });
        this.tone(784, 0.25, { type: 'triangle', gain: 0.14, delay: 0.18 });
        break;
      case 'reward':
        [0, 2, 4, 5].forEach((n, i) =>
          this.tone(SCALE[n] as number, 0.3, { gain: 0.12, delay: i * 0.07 }),
        );
        break;
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(f, 0.4, { type: 'triangle', gain: 0.16, delay: i * 0.11 }),
        );
        this.tone(1567.98, 0.6, { gain: 0.06, delay: 0.45 });
        break;
      case 'lose':
        [392, 311.13, 261.63].forEach((f, i) =>
          this.tone(f, 0.45, { gain: 0.14, delay: i * 0.16 }),
        );
        break;
      case 'pause':
        this.tone(440, 0.08, { gain: 0.08 });
        break;
    }
  }

  /** 把一批战斗事件变成声音（带限流，激烈场面也不会刺耳）。 */
  events(events: readonly SimEvent[]): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    for (const e of events) {
      switch (e.type) {
        case 'shoot':
          if (e.big) {
            if (this.allow('bigshot', 60)) {
              this.tone(160, 0.25, { type: 'triangle', gain: 0.2, endFreq: 70 });
              this.noise(0.2, { freq: 900, endFreq: 300, gain: 0.12 });
            }
          } else if (this.allow('shoot', 45)) {
            this.tone(900, 0.06, { type: 'triangle', gain: 0.06, endFreq: 520 });
          }
          break;
        case 'volley':
          if (this.allow('volley', 200))
            this.noise(0.3, { type: 'highpass', freq: 2200, endFreq: 700, gain: 0.1 });
          break;
        case 'hit':
          if (e.team === 0) {
            if (this.allow('hit', 35)) {
              this.tone(420 * (0.95 + Math.random() * 0.1), 0.07, { gain: 0.1 });
              this.noise(0.03, { freq: 2500, q: 2, gain: 0.08 });
            }
          } else if (this.allow('hurt', 60)) {
            this.tone(210, 0.12, { type: 'triangle', gain: 0.12, endFreq: 150 });
          }
          if (e.killed && this.allow('pop', 30)) this.tone(700, 0.12, { gain: 0.1, endFreq: 180 });
          break;
        case 'block':
          if (this.allow('block', 50)) {
            for (const [f, g] of [
              [540, 0.08],
              [1370, 0.05],
              [2210, 0.03],
            ] as const) {
              this.tone(f, 0.22, { gain: g });
            }
          }
          break;
        case 'reflect':
          if (this.allow('reflect', 40)) {
            this.tone(1318.5, 0.35, { gain: 0.1 });
            this.tone(2637, 0.15, { gain: 0.03 });
          }
          break;
        case 'ricochet':
          if (this.allow('ricochet', 40)) this.tone(1046.5, 0.12, { type: 'triangle', gain: 0.07 });
          break;
        case 'bounce':
          if (this.allow('bounce', 40)) this.tone(300, 0.1, { gain: 0.1, endFreq: 520 });
          break;
        case 'redirect':
          if (this.allow('redirect', 60)) this.tone(1567.98, 0.3, { gain: 0.08 });
          break;
        case 'echo':
          if (this.allow(`echo-${Math.min(9, e.level)}`, 70)) this.echoNote(e.level);
          break;
        case 'impact':
          if (this.allow('impact', 45)) {
            this.tone(110, 0.16, { gain: e.damaging ? 0.22 : 0.12, endFreq: 60 });
            this.noise(0.08, { type: 'lowpass', freq: 500, gain: e.damaging ? 0.2 : 0.1 });
          }
          break;
        case 'spring':
          if (this.allow('spring', 80)) this.tone(220, 0.28, { gain: 0.14, endFreq: 520 });
          break;
        case 'explode':
          if (this.allow('explode', 60)) {
            this.noise(0.5, { type: 'lowpass', freq: 1400, endFreq: 180, gain: 0.32 });
            this.tone(90, 0.4, { gain: 0.25, endFreq: 38 });
          }
          break;
        case 'heal':
          if (this.allow('heal', 120)) {
            this.tone(784, 0.3, { gain: 0.06 });
            this.tone(1174.66, 0.3, { gain: 0.04, delay: 0.05 });
          }
          break;
        case 'pulse':
          if (e.kind === 'magnet' && this.allow('magnet', 200))
            this.tone(900, 0.3, { gain: 0.1, endFreq: 380 });
          else if (e.kind === 'taunt' && this.allow('taunt', 200))
            this.tone(330, 0.18, { type: 'square', gain: 0.05 });
          else if (e.kind === 'heal' && this.allow('bell', 200)) {
            this.tone(1046.5, 0.5, { gain: 0.07 });
            this.tone(1568, 0.4, { gain: 0.035, delay: 0.02 });
          }
          break;
        case 'death':
          if (e.team === 0) {
            if (this.allow('pdeath', 200))
              this.tone(440, 0.4, { type: 'triangle', gain: 0.14, endFreq: 200 });
          } else if (this.allow('edeath', 40)) {
            this.noise(0.12, { freq: 1200, gain: 0.12 });
          }
          if (e.kind === 'king') this.ui('win');
          break;
        case 'spawn':
          if (this.allow('spawn', 80)) this.tone(700, 0.08, { gain: 0.07, endFreq: 1000 });
          break;
        case 'melee':
          if (this.allow('melee', 50)) {
            if (e.heavy) this.tone(90, 0.2, { gain: 0.22, endFreq: 50 });
            else this.noise(0.06, { freq: 700, q: 1.5, gain: 0.12 });
          }
          break;
        case 'cast':
          if (e.module === 'charge') {
            this.noise(0.35, { freq: 600, endFreq: 2400, gain: 0.16 });
            this.tone(260, 0.3, { type: 'triangle', gain: 0.12, endFreq: 520 });
          } else if (e.module === 'vortex') {
            this.noise(1.2, { freq: 400, endFreq: 1600, q: 6, gain: 0.14, attack: 0.1 });
          }
          break;
        case 'lobLand':
          if (this.allow('lob', 80)) {
            this.noise(0.3, { type: 'lowpass', freq: 900, endFreq: 200, gain: 0.2 });
            this.tone(120, 0.25, { gain: 0.14, endFreq: 60 });
          }
          break;
        case 'fuse':
          if (this.allow('fuse', 150))
            this.noise(0.5, { type: 'highpass', freq: 5000, gain: 0.05 });
          break;
        case 'phase':
          [196, 246.94, 293.66].forEach((f) => this.tone(f, 0.7, { type: 'sawtooth', gain: 0.04 }));
          break;
        case 'stunned':
          this.tone(1200, 0.08, { gain: 0.08 });
          this.tone(1500, 0.08, { gain: 0.06, delay: 0.1 });
          this.tone(1800, 0.08, { gain: 0.05, delay: 0.2 });
          break;
        case 'overtime':
          this.tone(98, 1.2, { gain: 0.14 });
          this.tone(196, 1.0, { gain: 0.05 });
          break;
        case 'end':
          this.ui(e.result === 'win' ? 'win' : 'lose');
          break;
        default:
          break;
      }
    }
  }

  // ---- 背景音乐：八音盒式的循环 ----

  setMusic(mode: 'off' | 'menu' | 'battle'): void {
    this.musicMode = mode;
    if (mode === 'off') {
      if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
      this.musicTimer = null;
      return;
    }
    if (this.musicTimer !== null || !this.ctx) return;
    this.musicTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 120);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.music || ctx.state !== 'running') return;
    const beat = this.musicMode === 'battle' ? 0.24 : 0.3;
    while (this.musicTime < ctx.currentTime + 0.35) {
      const step = this.musicStep % 16;
      const t = this.musicTime - ctx.currentTime;
      const note = MELODY[step] as number;
      if (note >= 0) {
        const freq = (MUSIC_NOTES[note] as number) * (this.musicStep % 64 >= 32 ? 1.5 : 1);
        this.tone(freq * 2, 0.9, {
          gain: 0.05,
          attack: 0.004,
          delay: Math.max(0, t),
          dest: this.music,
        });
      }
      if (step % 4 === 0) {
        const bass = BASS[Math.floor(this.musicStep / 16) % BASS.length] as number;
        this.tone(bass, beat * 3.5, {
          type: 'triangle',
          gain: 0.06,
          attack: 0.03,
          delay: Math.max(0, t),
          dest: this.music,
        });
      }
      this.musicStep++;
      this.musicTime += beat;
    }
  }
}
