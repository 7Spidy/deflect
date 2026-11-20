import type { InterludeKind } from "./bosses";

import { BEAT_LAND as BEAT_AT, PHASE_PEAK as PHASE_AT } from "./arena";
import { STRIKES_PER_ROUND } from "./config";
import { motifNotes, type Move } from "./moves";

/** Root note of each guardian's motif (Hz). Low and different per guardian. */
const MOTIF_ROOT: Record<InterludeKind, number> = {
  coins: 220,
  thorns: 246.9,
  stars: 261.6,
  candles: 233.1,
  bell: 196,
  roots: 174.6,
  dark: 146.8,
};


/**
 * All sound is synthesised with the Web Audio API. Audio is feedback only:
 * nothing in the timing rules depends on it.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private drone: { gain: GainNode; filter: BiquadFilterNode; stop: () => void } | null = null;
  private muted: boolean;

  constructor(muted = false) {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture (the first tap). */
  unlock(): void {
    if (typeof window === "undefined") return;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, len);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.02);
    }
  }

  startDrone(): void {
    const { ctx, master } = this;
    if (!ctx || !master || this.drone) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 2.5);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 170;
    filter.Q.value = 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 45;
    lfo.connect(lfoGain).connect(filter.frequency);
    const oscs = [
      { type: "sawtooth" as const, f: 55 },
      { type: "sawtooth" as const, f: 55.6 },
      { type: "sine" as const, f: 82.4 },
      { type: "sine" as const, f: 27.5 },
    ].map(({ type, f }) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    lfo.start();
    filter.connect(gain).connect(master);
    this.drone = {
      gain,
      filter,
      stop: () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.25);
        [...oscs, lfo].forEach((o) => o.stop(now + 1.5));
      },
    };
  }

  stopDrone(): void {
    this.drone?.stop();
    this.drone = null;
  }

  /** Muffle the drone for a moment: the blade is hanging mid-swing. */
  dip(durMs: number): void {
    const { ctx, drone } = this;
    if (!ctx || !drone) return;
    const t = ctx.currentTime;
    const f = drone.filter.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(95, t, 0.04);
    f.setTargetAtTime(170, t + Math.max(0.05, durMs / 1000), 0.09);
  }

  private noiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  /** Air being cut. Lasts roughly as long as the swing. */
  whoosh(durMs: number, strength = 1): void {
    const { ctx, master } = this;
    const src = this.noiseSource();
    if (!ctx || !master || !src) return;
    const t = ctx.currentTime;
    const dur = Math.max(0.08, durMs / 1000);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(260, t);
    band.frequency.exponentialRampToValueAtTime(1900, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.32 * strength, t + dur * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.09);
    src.connect(band).connect(gain).connect(master);
    src.start(t);
    src.stop(t + dur + 0.12);
  }

  /** Metal on metal. Better hits ring higher and longer. */
  clang(score: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const q = Math.max(0, Math.min(1, score / 100));
    const t = ctx.currentTime;
    const base = 430 + 880 * Math.pow(q, 1.6);
    const decay = 0.18 + 1.0 * q * q;
    const out = ctx.createGain();
    out.gain.value = 0.34 + 0.2 * q;
    out.connect(master);
    const partials: Array<[ratio: number, level: number]> = [
      [1, 0.55],
      [2.32, 0.32],
      [3.86, 0.2],
      [5.93, 0.12],
    ];
    for (const [ratio, level] of partials) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay / Math.sqrt(ratio));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    const src = this.noiseSource();
    if (src) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp).connect(g).connect(out);
      src.start(t);
      src.stop(t + 0.07);
    }
  }

  /** A blow that was not answered. */
  thud(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.36);
    const src = this.noiseSource();
    if (src) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      src.connect(lp).connect(ng).connect(master);
      src.start(t);
      src.stop(t + 0.18);
    }
  }

  /** An early tap cutting empty air: a thin high swish, no body. */
  whiff(): void {
    const { ctx, master } = this;
    const src = this.noiseSource();
    if (!ctx || !master || !src) return;
    const t = ctx.currentTime;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 2.2;
    band.frequency.setValueAtTime(3200, t);
    band.frequency.exponentialRampToValueAtTime(900, t + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(band).connect(gain).connect(master);
    src.start(t);
    src.stop(t + 0.2);
  }

  /** Steel dragging along steel: a glancing parry. */
  scrape(): void {
    const { ctx, master } = this;
    const src = this.noiseSource();
    if (!ctx || !master || !src) return;
    const t = ctx.currentTime;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 3.5;
    band.frequency.setValueAtTime(2400, t);
    band.frequency.exponentialRampToValueAtTime(1300, t + 0.26);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
    gain.gain.setValueAtTime(0.3, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(band).connect(gain).connect(master);
    src.start(t);
    src.stop(t + 0.32);
    // A thin ring underneath so it still reads as metal.
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(760, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.1, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.26);
  }

  /** A grazing, barely-there knock: dull and short. */
  clack(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(310, t);
    o.frequency.exponentialRampToValueAtTime(190, t + 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.1);
    const src = this.noiseSource();
    if (src) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.22, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      src.connect(hp).connect(ng).connect(master);
      src.start(t);
      src.stop(t + 0.05);
    }
  }

  /** The guard breaking: a bright shatter over a splintering low crack. */
  crack(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    if (src) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      src.connect(hp).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.24);
    }
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.32, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.2);
    // Falling glints of the shards.
    for (let i = 0; i < 3; i++) {
      const gl = ctx.createOscillator();
      gl.type = "sine";
      gl.frequency.value = 2400 + Math.random() * 2400;
      const gg = ctx.createGain();
      const at = t + 0.05 + i * 0.07;
      gg.gain.setValueAtTime(0.0001, at);
      gg.gain.exponentialRampToValueAtTime(0.08, at + 0.004);
      gg.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      gl.connect(gg).connect(master);
      gl.start(at);
      gl.stop(at + 0.14);
    }
  }

  /** A plain decaying partial, scheduled `at` seconds from now. */
  private tone(
    freq: number,
    at: number,
    level: number,
    decay: number,
    type: OscillatorType = "sine",
    glideTo?: number,
  ): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** Filtered noise: a breath, a puff, a rasp. */
  private hiss(
    at: number,
    dur: number,
    level: number,
    type: BiquadFilterType,
    freq: number,
    freqTo?: number,
  ): void {
    const { ctx, master } = this;
    const src = this.noiseSource();
    if (!ctx || !master || !src) return;
    const t = ctx.currentTime + at;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /**
   * The guardian's between-round beat, quiet under the drone. Timed to the
   * moment the scene's beat lands. With `phaseShift`, a low swell follows.
   */
  interlude(kind: InterludeKind, phaseShift = false): void {
    if (!this.ctx || !this.master) return;
    const at = BEAT_AT[kind];
    switch (kind) {
      case "coins":
        // A coin lands, bounces once, settles.
        this.tone(2350, at, 0.07, 0.35);
        this.tone(3480, at, 0.04, 0.25);
        this.tone(2350, at + 0.16, 0.035, 0.2);
        this.tone(3480, at + 0.27, 0.02, 0.15);
        break;
      case "thorns":
        this.hiss(at - 0.35, 0.5, 0.05, "bandpass", 900, 2600);
        this.tone(180, at, 0.05, 0.25, "sawtooth", 120);
        break;
      case "stars":
        this.tone(1318.5, at, 0.04, 1.6);
        this.tone(1975.5, at + 0.12, 0.025, 1.4);
        break;
      case "candles":
        this.hiss(at, 0.35, 0.08, "lowpass", 700, 240);
        this.tone(660, at + 0.05, 0.015, 0.6);
        break;
      case "bell": {
        // An old, slightly cracked bell: inharmonic partials, long tail.
        const base = 196;
        for (const [r, l, d] of [
          [0.5, 0.07, 3.2],
          [1, 0.09, 2.6],
          [1.19, 0.05, 2.1],
          [1.51, 0.04, 1.8],
          [2.0, 0.035, 1.5],
          [2.74, 0.02, 1.1],
        ] as const) {
          this.tone(base * r * (1 + (Math.random() - 0.5) * 0.003), at, l, d);
        }
        break;
      }
      case "roots":
        for (let i = 0; i < 4; i++) this.tone(900 + i * 140, at + i * 0.09, 0.025, 0.06, "square");
        this.tone(70, at, 0.08, 0.7, "sine", 48);
        break;
      case "dark":
        // A candle pinched out, then a breath that leaves the room colder.
        this.hiss(at, 0.18, 0.06, "highpass", 2000);
        this.hiss(at + 0.1, 1.1, 0.05, "lowpass", 900, 140);
        if (this.drone) this.dip(900);
        break;
    }
    if (phaseShift) {
      this.tone(41, PHASE_AT - 0.9, 0.22, 2.4, "sine", 33);
      this.tone(98, PHASE_AT, 0.09, 2.2, "triangle", 92);
      this.tone(146.8, PHASE_AT + 0.02, 0.05, 1.8);
      this.hiss(PHASE_AT - 0.7, 1.4, 0.06, "lowpass", 300, 90);
    }
  }

  /**
   * A move's motif (see motifNotes): one muted mallet note per strike, in the
   * guardian's own key, `at` seconds from now. Played in the round break
   * before the move, and near the end of the reveal for the first round.
   */
  motif(move: Move, kind: InterludeKind, at: number): void {
    if (!this.ctx || !this.master) return;
    const root = MOTIF_ROOT[kind];
    for (const note of motifNotes(move, STRIKES_PER_ROUND)) {
      const f = root * Math.pow(2, note.semis / 12);
      const t = at + note.at;
      this.tone(f, t, 0.055, 0.32, "triangle");
      this.tone(f * 2.76, t, 0.012, 0.12);
      this.tone(f / 2, t, 0.04, 0.16, "sine", f / 2.6);
    }
  }

  /** The Deathblow count: heartbeats, the last one on the mark (`lead` seconds away). */
  heartbeats(lead: number, beats: number): void {
    if (!this.ctx || !this.master) return;
    const step = lead / beats;
    for (let i = 1; i <= beats; i++) {
      const t = i * step;
      const last = i === beats;
      this.tone(last ? 62 : 54, t - 0.09, last ? 0.2 : 0.14, 0.18, "sine", 38);
      this.tone(last ? 70 : 60, t, last ? 0.28 : 0.18, 0.26, "sine", 40);
    }
  }

  /** A slipped Deathblow beat: a short, soft, dull tick. Nothing like the failure roar. */
  slip(): void {
    this.tone(150, 0, 0.1, 0.12, "triangle", 90);
  }

  /** Deathblow outcome: a ringing gong and a deep cut, or a dull rebound. */
  deathblow(landed: boolean): void {
    if (!this.ctx || !this.master) return;
    if (landed) {
      this.crack();
      for (const [r, l, d] of [
        [1, 0.16, 3.4],
        [2.01, 0.08, 2.6],
        [2.98, 0.05, 2.0],
        [4.1, 0.03, 1.4],
      ] as const) {
        this.tone(110 * r, 0.02, l, d);
      }
      this.tone(55, 0, 0.3, 1.6, "sine", 36);
    } else {
      this.thud();
      this.tone(90, 0.05, 0.12, 0.8, "sawtooth", 60);
    }
  }
}
