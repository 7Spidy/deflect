/**
 * All sound is synthesised with the Web Audio API. Audio is feedback only:
 * nothing in the timing rules depends on it.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private drone: { gain: GainNode; stop: () => void } | null = null;
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
}
