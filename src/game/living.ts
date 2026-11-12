import { seededRng } from "./prng";

/**
 * Living portraits: a guardian image that is slightly alive, like a painting
 * in a Harry Potter corridor. Breathes, sways, ripples at the hem, blinks and
 * flinches when the fight lands a blow.
 *
 * NO TELL (hard rule). The idle animation is a pure function of wall-clock
 * time, a seeded per-day phase, and a few discrete kicks (strike began, strike
 * resolved). It must never read impactAt, toImpact, hold, swing or stall
 * values, directly or through anything derived from them: otherwise a player
 * could time the strike from the boss's body language. That is enforced
 * structurally. Nothing in this file imports from generator.ts, and no
 * function here takes strike state in its signature. Do not add one.
 *
 * Everything above LivingPortrait is pure and unit tested. The class is the
 * only part that touches canvas.
 */

export interface Motion {
  /** Fraction of height the body rises and falls. */
  breathAmp: number;
  breathPeriodMs: number;
  /** Fraction of width, horizontal drift. */
  swayAmp: number;
  swayPeriodMs: number;
  /** Fraction of width, cloth / hair / robe ripple. */
  warpAmp: number;
  /** Spatial waves over the height. */
  warpWaves: number;
  tiltDeg: number;
  blinkEveryMs: readonly [number, number];
  /** Ambient dust or ash motes, 0..24. */
  motes: number;
  /** 0..1 x position; the two halves breathe out of phase. */
  split?: number;
}

export interface Accent {
  /** Image-fraction coordinates. */
  x: number;
  y: number;
  /** Radius as a fraction of image width. */
  r: number;
  rgb: readonly [number, number, number];
  pulseMs: number;
}

export const DEFAULT_MOTION: Motion = {
  breathAmp: 0.004,
  breathPeriodMs: 5200,
  swayAmp: 0.003,
  swayPeriodMs: 9000,
  warpAmp: 0.005,
  warpWaves: 2.2,
  tiltDeg: 0.5,
  blinkEveryMs: [2600, 7200],
  motes: 14,
};

export function resolveMotion(over?: Partial<Motion>): Motion {
  return { ...DEFAULT_MOTION, ...(over ?? {}) };
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/* Seeded phases and schedules                                         */
/* ------------------------------------------------------------------ */

export interface Phases {
  breath: number;
  sway: number;
  warp: number;
  light: number;
}

/** A per-day phase so the idle pose differs every day. */
export function phasesFor(seed: string): Phases {
  const rng = seededRng(`${seed}|phase`);
  return {
    breath: rng() * TAU,
    sway: rng() * TAU,
    warp: rng() * TAU,
    light: rng() * TAU,
  };
}

export const DOUBLE_BLINK_CHANCE = 0.15;
const DOUBLE_BLINK_GAP_MS = 260;

export interface BlinkStep {
  /** Ms until the next blink. Always inside blinkEveryMs. */
  gap: number;
  /** Whether this blink is followed by a quick second one. */
  double: boolean;
}

export function blinkStream(
  seed: string,
  every: readonly [number, number],
): () => BlinkStep {
  const rng = seededRng(`${seed}|blink`);
  return () => ({ gap: lerp(every[0], every[1], rng()), double: rng() < DOUBLE_BLINK_CHANCE });
}

/** The first n steps of the blink schedule. Deterministic per seed. */
export function blinkSchedule(
  seed: string,
  every: readonly [number, number],
  n: number,
): BlinkStep[] {
  const next = blinkStream(seed, every);
  return Array.from({ length: n }, next);
}

/** Eye openness 0..1 at `dt` ms after a blink began: shut in 70 ms, open in 110. */
export function blinkOpen(dt: number): number {
  const MIN = 0.08;
  if (dt < 0 || dt >= 180) return 1;
  if (dt < 70) return lerp(1, MIN, dt / 70);
  return lerp(MIN, 1, (dt - 70) / 110);
}

/** Seeded blink clock. Pure given its seed and the times it is asked about. */
export class BlinkClock {
  private next: () => BlinkStep;
  private nextStart = -1;
  private recent: number[] = [];

  constructor(seed: string, private every: readonly [number, number]) {
    this.next = blinkStream(seed, every);
  }

  openAt(now: number): number {
    if (this.nextStart < 0) this.nextStart = now + this.next().gap * 0.5;
    while (now >= this.nextStart) {
      const start = this.nextStart;
      const step = this.next();
      this.recent.push(start);
      // The 'double' flag belongs to the step after this gap; use it for this blink.
      if (step.double) this.recent.push(start + DOUBLE_BLINK_GAP_MS);
      this.nextStart = start + step.gap;
      if (this.recent.length > 6) this.recent.splice(0, this.recent.length - 6);
    }
    let open = 1;
    for (const s of this.recent) {
      if (s <= now) open = Math.min(open, blinkOpen(now - s));
    }
    return open;
  }
}

export const TILT_GAP_MS: readonly [number, number] = [8000, 15000];
export const TILT_IN_MS = 700;
export const TILT_HOLD_MS = 500;
export const TILT_OUT_MS = 900;

/** 0..1 head-tilt envelope `dt` ms after the event began. */
export function tiltEnvelope(dt: number): number {
  if (dt < 0) return 0;
  if (dt < TILT_IN_MS) return smoothstep(0, 1, dt / TILT_IN_MS);
  if (dt < TILT_IN_MS + TILT_HOLD_MS) return 1;
  const out = (dt - TILT_IN_MS - TILT_HOLD_MS) / TILT_OUT_MS;
  return out >= 1 ? 0 : 1 - smoothstep(0, 1, out);
}

const TILT_TOTAL_MS = TILT_IN_MS + TILT_HOLD_MS + TILT_OUT_MS;

export function tiltStream(seed: string): () => { gap: number; dir: 1 | -1 } {
  const rng = seededRng(`${seed}|tilt`);
  return () => ({ gap: lerp(TILT_GAP_MS[0], TILT_GAP_MS[1], rng()), dir: rng() < 0.5 ? -1 : 1 });
}

/* ------------------------------------------------------------------ */
/* Fight coupling: discrete kicks only                                 */
/* ------------------------------------------------------------------ */

export type KickKind =
  | "strikeStart"
  | "true"
  | "clean"
  | "glancing"
  | "grazed"
  | "late"
  | "unanswered"
  /** A strike ended without a hit (voided). Visual no-op, ends engagement. */
  | "release";

export interface KickFx {
  /** Fractions of width / height. */
  dx: number;
  dy: number;
  scale: number;
  /** Extra breath amplitude multiplier minus one. */
  breathBoost: number;
  /** Multiplier on eye glow intensity. */
  eye: number;
  /** 0..1 extra eye menace. */
  menace: number;
}

export function neutralKick(out: KickFx): KickFx {
  out.dx = 0;
  out.dy = 0;
  out.scale = 1;
  out.breathBoost = 0;
  out.eye = 1;
  out.menace = 0;
  return out;
}

/** Writes the effect of a kick `dt` ms after it fired into `out`. */
export function kickFx(kind: KickKind | null, dt: number, out: KickFx): KickFx {
  neutralKick(out);
  if (kind === null || dt < 0) return out;
  switch (kind) {
    case "strikeStart": {
      // 250 ms settle: the boss gathers itself.
      if (dt < 250) out.breathBoost = 0.6 * (1 - dt / 250);
      break;
    }
    case "true":
    case "clean":
    case "glancing": {
      const half = kind === "true" ? 1 : 0.5;
      const r = dt < 300 ? Math.pow(1 - dt / 300, 2) : 0;
      out.dx = 0.012 * half * r;
      out.scale = 1 - 0.01 * half * r;
      if (kind === "true") {
        // Dims for 200 ms, then flares and settles.
        if (dt < 200) out.eye = 1 - 0.7 * (dt / 200);
        else if (dt < 600) out.eye = 0.3 + 1.2 * Math.sin(((dt - 200) / 400) * Math.PI * 0.5);
        else if (dt < 1000) out.eye = lerp(1.5, 1, (dt - 600) / 400);
      }
      break;
    }
    case "grazed":
    case "late":
    case "unanswered": {
      const r = dt < 350 ? Math.pow(1 - dt / 350, 2) : 0;
      out.scale = 1 + 0.03 * r;
      out.dy = 0.006 * r;
      out.dx = -0.004 * r;
      const m = dt < 900 ? 1 - dt / 900 : 0;
      out.menace = m;
      out.eye = 1 + 0.4 * m;
      break;
    }
    case "release":
      break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The pose: pure functions of (t, phases, motion, kick effect)        */
/* ------------------------------------------------------------------ */

export interface PoseState {
  motion: Motion;
  phases: Phases;
  neckY: number;
  /** Current head-tilt in radians (already includes envelope and sign). */
  tiltRad: number;
  kick: KickFx;
  /** False once adaptive quality has dropped the cloth warp. */
  warp: boolean;
}

export function makePoseState(motion: Motion, phases: Phases, neckY: number): PoseState {
  return {
    motion,
    phases,
    neckY,
    tiltRad: 0,
    kick: neutralKick({ dx: 0, dy: 0, scale: 1, breathBoost: 0, eye: 1, menace: 0 }),
    warp: true,
  };
}

/** Which half of a split image a point belongs to. */
export function sideOf(x: number, motion: Motion): 0 | 1 {
  return motion.split !== undefined && x >= motion.split ? 1 : 0;
}

export interface Body {
  /** Fraction of image height. */
  dy: number;
  scale: number;
  /** Fraction of image width. */
  dx: number;
}

/** Whole-body transform: breath plus kick. Scales about the bottom centre. */
export function bodyAt(t: number, st: PoseState, side: 0 | 1): Body {
  const m = st.motion;
  const phase = st.phases.breath + (m.split !== undefined && side === 1 ? 0.7 * Math.PI : 0);
  const s = Math.sin((TAU * t) / m.breathPeriodMs + phase);
  const amp = m.breathAmp * (1 + st.kick.breathBoost);
  return {
    dy: -amp * s + st.kick.dy,
    scale: (1 + 0.6 * amp * s) * st.kick.scale,
    dx: st.kick.dx,
  };
}

/** Sway term of the horizontal offset, as a fraction of width. */
export function swayDx(y: number, t: number, m: Motion, ph: Phases): number {
  return m.swayAmp * Math.sin((TAU * t) / m.swayPeriodMs + ph.sway) * smoothstep(0.15, 0.9, y);
}

/** Cloth warp term. Exactly 0 at y = 0 and continuous everywhere. */
export function warpDx(y: number, t: number, m: Motion, ph: Phases): number {
  const g = smoothstep(0.35, 1, y);
  return m.warpAmp * Math.sin(TAU * (y * m.warpWaves) - (TAU * t) / 3800 + ph.warp) * Math.pow(g, 1.5);
}

/** Head-tilt shear above the neck. */
export function tiltDx(y: number, neckY: number, tiltRad: number): number {
  return y < neckY ? tiltRad * (neckY - y) : 0;
}

/** Horizontal offset of the row at image-fraction y, as a fraction of width. */
export function dxAt(y: number, t: number, st: PoseState): number {
  return (
    swayDx(y, t, st.motion, st.phases) +
    (st.warp ? warpDx(y, t, st.motion, st.phases) : 0) +
    tiltDx(y, st.neckY, st.tiltRad)
  );
}

/** Where an image-fraction point lands, in image-fraction space, under the pose. */
export function mapPoint(x: number, y: number, t: number, st: PoseState): [number, number] {
  const b = bodyAt(t, st, sideOf(x, st.motion));
  return [0.5 + (x - 0.5) * b.scale + b.dx + dxAt(y, t, st), 1 - (1 - y) * b.scale + b.dy];
}

/* ------------------------------------------------------------------ */
/* Ambient motes                                                       */
/* ------------------------------------------------------------------ */

export interface Mote {
  x0: number;
  drift: number;
  period: number;
  phase: number;
  size: number;
}

export function makeMotes(seed: string, count: number): Mote[] {
  const rng = seededRng(`${seed}|motes`);
  return Array.from({ length: Math.max(0, Math.min(24, Math.round(count))) }, () => ({
    x0: 0.15 + rng() * 0.7,
    drift: (rng() - 0.5) * 0.12,
    period: 14000 + rng() * 14000,
    phase: rng(),
    size: 1 + rng() * 1.5,
  }));
}

/** Image-fraction position and alpha of a mote. Pure function of time. */
export function moteAt(m: Mote, t: number, out: { x: number; y: number; a: number }): void {
  const u = (t / m.period + m.phase) % 1;
  out.x = m.x0 + m.drift * u + 0.012 * Math.sin(t / 2600 + m.phase * TAU);
  out.y = 0.86 - u * 0.55;
  out.a = Math.sin(u * Math.PI) * 0.35;
}

/* ------------------------------------------------------------------ */
/* Adaptive quality                                                    */
/* ------------------------------------------------------------------ */

export interface QualityStep {
  slices: number;
  warp: boolean;
}

export const QUALITY_STEPS: readonly QualityStep[] = [
  { slices: 48, warp: true },
  { slices: 24, warp: true },
  { slices: 12, warp: true },
  { slices: 12, warp: false },
];

/**
 * Steps quality down when frames run long. Rolling average of rAF deltas; if
 * it stays above 20 ms for a full second, drop one step. Never steps back up
 * in the same session.
 */
export class AdaptiveQuality {
  private window: number[] = [];
  private overSince: number | null = null;
  private idx = 0;

  static readonly THRESHOLD_MS = 20;
  static readonly SUSTAIN_MS = 1000;
  static readonly WINDOW = 30;

  get level(): number {
    return this.idx;
  }

  get step(): QualityStep {
    return QUALITY_STEPS[this.idx];
  }

  /** Feed the delta between two frames. Returns true when a step was taken. */
  observe(deltaMs: number, now: number): boolean {
    // A tab that was hidden, or a one-off hitch, is not a sustained slowdown.
    if (!(deltaMs > 0) || deltaMs > 250) {
      this.overSince = null;
      return false;
    }
    this.window.push(deltaMs);
    if (this.window.length > AdaptiveQuality.WINDOW) this.window.shift();
    if (this.window.length < 10) return false;
    const avg = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    if (avg <= AdaptiveQuality.THRESHOLD_MS) {
      this.overSince = null;
      return false;
    }
    this.overSince ??= now;
    if (now - this.overSince < AdaptiveQuality.SUSTAIN_MS) return false;
    this.overSince = null;
    this.window.length = 0;
    if (this.idx < QUALITY_STEPS.length - 1) {
      this.idx += 1;
      return true;
    }
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Browser side: image loading and the portrait renderer               */
/* ------------------------------------------------------------------ */

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

/** Load a guardian image once. Resolves null on any failure (silhouette fallback). */
export function loadGuardianImage(src: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(src);
  if (!p) {
    p = (async () => {
      try {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        await img.decode();
        return img;
      } catch {
        return null;
      }
    })();
    imageCache.set(src, p);
  }
  return p;
}

export interface ArtDebug {
  /** ?debug=1&art=off forces the silhouette. */
  artOff: boolean;
  /** ?debug=1&eyes=1 draws crosshairs at the eye anchors. */
  eyes: boolean;
}

export function readArtDebug(): ArtDebug {
  if (typeof window === "undefined") return { artOff: false, eyes: false };
  const q = new URLSearchParams(window.location.search);
  const on = q.get("debug") === "1";
  return { artOff: on && q.get("art") === "off", eyes: on && q.get("eyes") === "1" };
}

let grainTile: HTMLCanvasElement | null = null;
function getGrainTile(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const img = g.createImageData(256, 256);
  const rng = seededRng("deflect-grain");
  for (let i = 0; i < 256 * 256; i++) {
    const v = Math.round(rng() * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

const accentSprites = new Map<string, HTMLCanvasElement>();
function accentSprite(rgb: readonly [number, number, number]): HTMLCanvasElement {
  const key = rgb.join(",");
  let c = accentSprites.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${key},1)`);
    grad.addColorStop(0.35, `rgba(${key},0.4)`);
    grad.addColorStop(1, `rgba(${key},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    accentSprites.set(key, c);
  }
  return c;
}

export interface PortraitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EyeFx {
  /** Multiplier on glow intensity (kick dim and flare). */
  level: number;
  /** 0..1 extra menace from a kick. */
  menace: number;
  /** 0..1 eyelid openness. */
  blink: number;
}

export interface LivingOptions {
  seed: string;
  motion?: Partial<Motion>;
  neckY?: number;
  accents?: readonly Accent[];
  reducedMotion: boolean;
}

const MAX_SLICE_DT = 250;

/**
 * One painting that is slightly alive. Used by the encounter Scene and by the
 * title screen's GuardianPortrait, so the two never drift apart.
 */
export class LivingPortrait {
  private motion: Motion;
  private phases: Phases;
  private neckY: number;
  private accents: readonly Accent[];
  private reduced: boolean;

  private art: HTMLCanvasElement | null = null;
  private artW = 0;
  private artH = 0;
  private off: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private grainPattern: CanvasPattern | null = null;

  private quality = new AdaptiveQuality();
  private blinks: BlinkClock;
  private tiltNext: () => { gap: number; dir: 1 | -1 };
  private nextTiltAt = -1;
  private tiltStart = -1e9;
  private tiltDir: 1 | -1 = 1;
  private engaged = false;
  private kickKind: KickKind | null = null;
  private kickAt = -1e9;
  private motes: Mote[];
  private moteOut = { x: 0, y: 0, a: 0 };
  private lastNow = -1;
  private pose: PoseState;
  private poseT = Number.NaN;
  private grainJitter = { x: 0, y: 0, at: -1e9 };
  private jitterRng = seededRng("deflect-grain-jitter");

  constructor(o: LivingOptions) {
    this.motion = resolveMotion(o.motion);
    this.phases = phasesFor(o.seed);
    this.neckY = o.neckY ?? 0.38;
    this.accents = o.accents ?? [];
    this.reduced = o.reducedMotion;
    this.blinks = new BlinkClock(o.seed, this.motion.blinkEveryMs);
    this.tiltNext = tiltStream(o.seed);
    this.motes = makeMotes(o.seed, this.motion.motes);
    this.pose = makePoseState(this.motion, this.phases, this.neckY);
  }

  get ready(): boolean {
    return this.art !== null;
  }

  get qualityLevel(): number {
    return this.quality.level;
  }

  /**
   * Take the source image, feather its borders with a destination-in mask and
   * composite it onto black once. The result is opaque, so overlapping slices
   * never double-brighten at the seams.
   */
  setArt(img: HTMLImageElement): void {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = "destination-in";
    const hz = g.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, "rgba(0,0,0,0)");
    hz.addColorStop(0.07, "rgba(0,0,0,1)");
    hz.addColorStop(0.93, "rgba(0,0,0,1)");
    hz.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hz;
    g.fillRect(0, 0, w, h);
    const vt = g.createLinearGradient(0, 0, 0, h);
    vt.addColorStop(0, "rgba(0,0,0,0)");
    vt.addColorStop(0.035, "rgba(0,0,0,1)");
    vt.addColorStop(0.84, "rgba(0,0,0,1)");
    vt.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = vt;
    g.fillRect(0, 0, w, h);

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const og = out.getContext("2d")!;
    og.fillStyle = "#000";
    og.fillRect(0, 0, w, h);
    og.drawImage(c, 0, 0);
    this.art = out;
    this.artW = w;
    this.artH = h;
  }

  /** A discrete fight event. The only way the fight ever reaches the portrait. */
  kick(kind: KickKind, now: number): void {
    if (this.reduced) return;
    this.engaged = kind === "strikeStart";
    if (kind === "release") {
      this.kickKind = null;
      return;
    }
    this.kickKind = kind;
    this.kickAt = now;
  }

  /** Where an image-fraction point lands under the current pose. */
  transformPoint(x: number, y: number, t: number): [number, number] {
    this.syncPose(t);
    return mapPoint(x, y, t, this.pose);
  }

  eyeFx(now: number): EyeFx {
    if (this.reduced) return { level: 1, menace: 0, blink: 1 };
    this.syncPose(now);
    return {
      level: this.pose.kick.eye,
      menace: this.pose.kick.menace,
      blink: this.blinks.openAt(now),
    };
  }

  private syncPose(t: number): void {
    if (this.poseT === t) return;
    this.poseT = t;
    const st = this.pose;
    st.warp = this.quality.step.warp;
    if (this.reduced) {
      st.tiltRad = 0;
      neutralKick(st.kick);
      return;
    }
    // Head tilt: seeded schedule. A new tilt never starts while a strike is in
    // flight (raise to resolution). That flag comes from the strikeStart and
    // outcome kicks only, so it says nothing about when the swing lands.
    if (this.nextTiltAt < 0) this.nextTiltAt = t + this.tiltNext().gap;
    if (t >= this.nextTiltAt && !this.engaged && t - this.tiltStart > TILT_TOTAL_MS) {
      const step = this.tiltNext();
      this.tiltStart = t;
      this.tiltDir = step.dir;
      this.nextTiltAt = t + TILT_TOTAL_MS + step.gap;
    }
    st.tiltRad =
      this.tiltDir * ((this.motion.tiltDeg * Math.PI) / 180) * tiltEnvelope(t - this.tiltStart);
    kickFx(this.kickKind, t - this.kickAt, st.kick);
  }

  /**
   * Draw the portrait into `rect` on `ctx`. `pr` is the pixel ratio (clamped
   * to 2 here). `blend` is "screen" over the encounter backdrop, or
   * "source-over" for a canvas the page blends with CSS.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    rect: PortraitRect,
    now: number,
    alpha: number,
    pr: number,
    blend: GlobalCompositeOperation = "screen",
  ): void {
    const art = this.art;
    if (!art || alpha <= 0.003) return;
    if (typeof document !== "undefined" && document.hidden) return;

    if (this.reduced) {
      ctx.save();
      ctx.globalCompositeOperation = blend;
      ctx.globalAlpha = alpha;
      ctx.drawImage(art, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      return;
    }

    if (this.lastNow >= 0 && now - this.lastNow < MAX_SLICE_DT) {
      this.quality.observe(now - this.lastNow, now);
    }
    this.lastNow = now;
    this.syncPose(now);
    const st = this.pose;
    const { slices } = this.quality.step;

    const ratio = Math.min(Math.max(pr, 1), 2);
    const ow = Math.max(2, Math.round(rect.w * ratio));
    const oh = Math.max(2, Math.round(rect.h * ratio));
    let off = this.off;
    if (!off || off.width !== ow || off.height !== oh) {
      off = document.createElement("canvas");
      off.width = ow;
      off.height = oh;
      this.off = off;
      this.offCtx = off.getContext("2d");
      this.grainPattern = null;
    }
    const og = this.offCtx;
    if (!og) return;
    og.globalCompositeOperation = "source-over";
    og.globalAlpha = 1;
    og.fillStyle = "#000";
    og.fillRect(0, 0, ow, oh);
    og.imageSmoothingEnabled = true;

    // Halves: one pass normally, two when the portrait is split (Twins).
    const split = this.motion.split;
    const halves: Array<[number, number, 0 | 1]> =
      split === undefined
        ? [[0, 1, 0]]
        : [
            [0, split, 0],
            [split, 1, 1],
          ];
    for (const [u0, u1, side] of halves) {
      const b = bodyAt(now, st, side);
      const sx = Math.round(u0 * this.artW);
      const sw = Math.max(1, Math.round(u1 * this.artW) - sx);
      for (let i = 0; i < slices; i++) {
        const v0 = i / slices;
        const v1 = (i + 1) / slices;
        const sy = Math.round(v0 * this.artH);
        const sh = Math.max(1, Math.round(v1 * this.artH) - sy);
        const dx = dxAt((v0 + v1) / 2, now, st) + b.dx;
        const destX = (0.5 + (u0 - 0.5) * b.scale + dx) * ow;
        const destY = (1 - (1 - v0) * b.scale + b.dy) * oh;
        const destW = (u1 - u0) * b.scale * ow + (split !== undefined ? 1 : 0);
        const destH = (v1 - v0) * b.scale * oh + 1;
        og.drawImage(art, sx, sy, sw, sh, destX, destY, destW, destH);
      }
    }

    // Film grain: overlay keeps black black and only textures the lit mist.
    if (now - this.grainJitter.at > 120) {
      this.grainJitter.x = Math.floor(this.jitterRng() * 256);
      this.grainJitter.y = Math.floor(this.jitterRng() * 256);
      this.grainJitter.at = now;
    }
    this.grainPattern ??= og.createPattern(getGrainTile(), "repeat");
    if (this.grainPattern) {
      og.save();
      og.globalCompositeOperation = "overlay";
      og.globalAlpha = 0.03;
      og.translate(-this.grainJitter.x, -this.grainJitter.y);
      og.fillStyle = this.grainPattern;
      og.fillRect(0, 0, ow + 256, oh + 256);
      og.restore();
    }

    // Candle-flicker feel: 0.93..1.0 on a 6 s sine plus a little noise.
    const flick =
      0.965 +
      0.035 * Math.sin((TAU * now) / 6000 + this.phases.light) +
      0.015 * Math.sin(now * 0.037) * Math.sin(now * 0.0113 + this.phases.light);

    ctx.save();
    ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = alpha * Math.min(1, flick);
    ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    this.drawExtras(ctx, rect, now, alpha);
  }

  /** Accent glows and ambient motes, additive, following the body. */
  private drawExtras(
    ctx: CanvasRenderingContext2D,
    rect: PortraitRect,
    now: number,
    alpha: number,
  ): void {
    if (this.accents.length === 0 && this.motes.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const a of this.accents) {
      const [px, py] = this.transformPoint(a.x, a.y, now);
      const pulse = 0.55 + 0.45 * Math.sin((TAU * now) / a.pulseMs + a.x * 17);
      const size = a.r * rect.w * 2;
      ctx.globalAlpha = alpha * 0.55 * pulse;
      ctx.drawImage(
        accentSprite(a.rgb),
        rect.x + px * rect.w - size / 2,
        rect.y + py * rect.h - size / 2,
        size,
        size,
      );
    }
    ctx.fillStyle = "rgb(210,200,190)";
    for (const m of this.motes) {
      moteAt(m, now, this.moteOut);
      ctx.globalAlpha = alpha * this.moteOut.a;
      const s = m.size;
      ctx.fillRect(rect.x + this.moteOut.x * rect.w, rect.y + this.moteOut.y * rect.h, s, s);
    }
    ctx.restore();
  }
}
