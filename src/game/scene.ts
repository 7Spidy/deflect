import type { Boss, SilhouetteKind } from "./bosses";
import {
  LivingPortrait,
  loadGuardianImage,
  readArtDebug,
  type ArtDebug,
  type KickKind,
  type PortraitRect,
} from "./living";

/**
 * Canvas 2D renderer. Knows nothing about rules, only how to draw a frame.
 *
 * Hard rules for everything in here: no effect may change impactAt, tap
 * handling or results. Effects are pooled (150 particles max), gradients are
 * cached per layout, and nothing allocates per frame in the hot paths.
 */

export interface Layout {
  w: number;
  h: number;
  cx: number;
  /** Guard line y. */
  gy: number;
  /** Blade pivot (the boss's hand). */
  px: number;
  py: number;
  /** Blade length. */
  len: number;
  /** Angle (radians, clockwise from up) at which the tip meets the guard line. */
  impactAngle: number;
}

/**
 * Geometry is solved so the blade tip lands exactly on the centre of the
 * guard line at `impactAngle`. Impact is that frame.
 */
export function computeLayout(w: number, h: number): Layout {
  const gy = h * 0.8;
  const px = w * 0.06;
  const len = w * 0.86;
  const impactAngle = Math.PI - Math.asin((w * 0.5 - px) / len);
  const py = gy + len * Math.cos(impactAngle);
  return { w, h, cx: w / 2, gy, px, py, len, impactAngle };
}

export interface FrameState {
  now: number;
  /** Blade angle in radians, clockwise from up. */
  angle: number;
  /** Earlier blade angle for the motion trail, or null for none. */
  trailFrom: number | null;
  /** 0..1 boss presence (fades in during the intro). */
  presence: number;
  /** 0..1 extra eye intensity. */
  menace: number;
  /** The blade is hanging mid-swing. Visual only: adds a tremble. */
  stalled: boolean;
  /** Device pixel ratio, for the portrait's offscreen buffer. */
  pixelRatio: number;
}

const GOLD = "212,175,55";
const MAX_PARTICLES = 150;

const SPARK = 0;
const EMBER = 1;
const ASH = 2;
const SHARD = 3;
const DUST = 4;

interface Particle {
  on: boolean;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  /** Multiplier on h per second squared. */
  gravity: number;
  rot: number;
  vr: number;
  col: string;
}

interface Ring {
  on: boolean;
  start: number;
  dur: number;
  r0: number;
  r1: number;
  lw: number;
  alpha: number;
  col: string;
}

interface Flash {
  rgb: string;
  alpha: number;
  start: number;
  dur: number;
}

interface Cache {
  l: Layout;
  bg: CanvasGradient;
  halo: CanvasGradient;
  vig: CanvasGradient;
  redVig: CanvasGradient;
  guardBase: CanvasGradient;
  guardHot: CanvasGradient;
  steel: CanvasGradient;
  headY: number;
  silEyes: Array<[number, number]>;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export class Scene {
  private pool: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    on: false,
    kind: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    born: 0,
    life: 1,
    size: 1,
    gravity: 1.6,
    rot: 0,
    vr: 0,
    col: "255,220,140",
  }));
  private rings: Ring[] = Array.from({ length: 6 }, () => ({
    on: false,
    start: 0,
    dur: 1,
    r0: 0,
    r1: 0,
    lw: 2,
    alpha: 1,
    col: "255,226,150",
  }));
  private flash: Flash | null = null;
  private edge: { start: number; dur: number; alpha: number } | null = null;
  private shake: { start: number; dur: number; mag: number } | null = null;
  private zoom: { start: number; dur: number } | null = null;
  private rays: { start: number } | null = null;
  private guardPulse = -1e9;
  private ackAt = -1e9;
  private whiffAt = -1e9;
  private bladeSparkUntil = -1;
  private emberTrailUntil = -1;
  private ghostAt = -1e9;
  private ghostAngle = 0;
  private crack: { start: number; pts: number[] } | null = null;
  private slash: { start: number } | null = null;
  private guardBreakAt = -1e9;
  private flareUntil = -1;

  // Hit-stop: a visual clock that stops for 60 ms. Timing never sees it.
  private freezeFrom = -1;
  private freezeUntil = -1;
  private freezeAngle = 0;
  private debt = 0;
  private lastRaw = 0;
  private lastV = 0;

  private fog: HTMLCanvasElement;
  private cache: Cache | null = null;
  private portrait: LivingPortrait | null = null;
  private artDebug: ArtDebug;
  private eyeBuf: Array<[number, number]> = [];
  private destroyed = false;

  constructor(
    private boss: Boss,
    private reducedMotion: boolean,
    private seed: string = "deflect",
  ) {
    this.fog = document.createElement("canvas");
    this.fog.width = this.fog.height = 128;
    const g = this.fog.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(160,155,180,1)");
    grad.addColorStop(0.5, "rgba(140,135,160,0.45)");
    grad.addColorStop(1, "rgba(120,115,140,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);

    this.artDebug = readArtDebug();
    void this.loadArt();
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Assets can land one at a time: on any failure the silhouette stays. */
  private async loadArt(): Promise<void> {
    const art = this.boss.art;
    if (!art || this.artDebug.artOff) return;
    const img = await loadGuardianImage(art.src);
    if (!img || this.destroyed) return;
    const p = new LivingPortrait({
      seed: this.seed,
      motion: art.motion,
      neckY: art.neckY,
      accents: art.accents,
      reducedMotion: this.reducedMotion,
    });
    p.setArt(img);
    this.portrait = p;
  }

  /** Discrete fight events for the living portrait. */
  kick(kind: KickKind, now: number): void {
    this.portrait?.kick(kind, now);
  }

  /** Reduced motion keeps colour and shape cues, at lower strength. */
  private get fxA(): number {
    return this.reducedMotion ? 0.55 : 1;
  }

  private v(now: number): number {
    return now - this.debt;
  }

  /* ----------------------------- effects ----------------------------- */

  /** Every tap, at tap time, grade-neutral: the guard line answers at once. */
  tapAck(now: number, l: Layout): void {
    const t = this.v(now);
    this.ackAt = t;
    this.addRing(t, 260, l.w * 0.014, l.w * 0.06, 2, 0.7, "255,240,200");
  }

  /** Every tap that is not True: where the blade was, fading. */
  ghost(now: number, angle: number): void {
    this.ghostAt = this.v(now);
    this.ghostAngle = angle;
  }

  /** Early tap: the guard arc cuts through empty air. */
  whiffEarly(now: number): void {
    this.whiffAt = this.v(now);
  }

  /** True deflect (score >= 95). */
  perfect(now: number, l: Layout, streak = 1): void {
    const t = this.v(now);
    const hot = streak >= 3;
    this.burst(t, l, 46, 1, SPARK, hot ? "255,246,226" : "255,226,150");
    this.addRing(t, 420, l.w * 0.04, l.w * 0.38, 3, 0.8, hot ? "255,250,240" : "255,226,150");
    this.addRing(t + 90, 520, l.w * 0.05, l.w * 0.52, 2, 0.5, hot ? "255,250,240" : "255,214,120");
    this.flash = { rgb: "255,225,150", alpha: 0.16 * this.fxA, start: t, dur: 260 };
    this.guardPulse = t;
    if (hot) this.emberTrailUntil = t + 400;
    if (!this.reducedMotion) {
      this.shake = { start: t, dur: 260, mag: l.w * 0.018 };
      this.rays = { start: t };
      this.zoom = { start: t, dur: 200 };
      this.freezeFrom = now;
      this.freezeUntil = now + 60;
      this.freezeAngle = l.impactAngle;
    }
  }

  /** Clean (75 to 94): moss-white sparks, one small ring, a small shake. */
  clean(now: number, l: Layout): void {
    const t = this.v(now);
    this.burst(t, l, 20, 0.7, SPARK, "214,238,196");
    this.addRing(t, 420, l.w * 0.03, l.w * 0.2, 2, 0.65, "214,238,196");
    this.guardPulse = t;
    if (!this.reducedMotion) this.shake = { start: t, dur: 180, mag: l.w * 0.006 };
  }

  /** Glancing (40 to 74): ember sparks with gravity, a scrape along the blade. No ring. */
  glancing(now: number, l: Layout): void {
    const t = this.v(now);
    this.burst(t, l, 14, 0.55, EMBER, "255,142,64", 2.6);
    this.bladeSparkUntil = t + 120;
    this.guardPulse = t - 200;
  }

  /** Grazed (1 to 39): an ash puff, weak sparks, the blade barely clips. */
  grazed(now: number, l: Layout): void {
    const t = this.v(now);
    this.burst(t, l, 6, 0.3, SPARK, "170,160,150");
    for (let i = 0; i < 5; i++) {
      this.spawn(
        ASH,
        l.cx + (Math.random() - 0.5) * l.w * 0.08,
        l.gy,
        (Math.random() - 0.5) * l.w * 0.12,
        -l.w * (0.04 + Math.random() * 0.08),
        t,
        520 + Math.random() * 260,
        l.w * (0.015 + Math.random() * 0.012),
        -0.1,
        "120,112,112",
      );
    }
    this.edge = { start: t, dur: 200, alpha: 0.12 * this.fxA };
  }

  /** Early tap resolved: the blade lands on an empty guard. */
  unopposed(now: number, l: Layout): void {
    const t = this.v(now);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.spawn(
        DUST,
        l.cx + Math.cos(a) * l.w * 0.02,
        l.gy + Math.sin(a) * l.w * 0.006,
        Math.cos(a) * l.w * 0.5,
        Math.sin(a) * l.w * 0.14,
        t,
        420,
        l.w * 0.012,
        0.2,
        "150,138,120",
      );
    }
    this.addRing(t, 380, l.w * 0.02, l.w * 0.22, 2.5, 0.5, "160,148,130");
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      pts.push(l.cx + (i - 3.5) * l.w * 0.045, l.gy + (i % 2 === 0 ? -1 : 1) * l.w * (0.008 + Math.random() * 0.012));
    }
    this.crack = { start: t, pts };
    this.edge = { start: t, dur: 300, alpha: 0.3 * this.fxA };
    this.flash = { rgb: "120,14,14", alpha: 0.18 * this.fxA, start: t, dur: 320 };
    this.flareUntil = now + 700;
    if (!this.reducedMotion) this.shake = { start: t, dur: 220, mag: l.w * 0.01 };
  }

  /** Too late or unanswered: the blade bites through the guard. */
  bite(now: number, l: Layout): void {
    const t = this.v(now);
    this.slash = { start: t };
    this.edge = { start: t, dur: 400, alpha: 0.38 * this.fxA };
    this.flash = { rgb: "120,14,14", alpha: 0.42 * this.fxA, start: t, dur: 520 };
    this.guardBreakAt = t;
    this.flareUntil = now + 800;
    const x0 = l.w * 0.13;
    const span = l.w * 0.74;
    for (let i = 0; i < 24; i++) {
      this.spawn(
        SHARD,
        x0 + Math.random() * span,
        l.gy + (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * l.w * 0.5,
        -l.w * (0.1 + Math.random() * 0.35),
        t,
        700 + Math.random() * 500,
        l.w * (0.008 + Math.random() * 0.01),
        1.5,
        "232,196,92",
        (Math.random() - 0.5) * 14,
      );
    }
    if (!this.reducedMotion) this.shake = { start: t, dur: 380, mag: l.w * 0.03 };
  }

  private addRing(
    start: number,
    dur: number,
    r0: number,
    r1: number,
    lw: number,
    alpha: number,
    col: string,
  ): void {
    for (const r of this.rings) {
      if (r.on) continue;
      r.on = true;
      r.start = start;
      r.dur = dur;
      r.r0 = r0;
      r.r1 = r1;
      r.lw = lw;
      r.alpha = alpha * this.fxA;
      r.col = col;
      return;
    }
  }

  private spawn(
    kind: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    born: number,
    life: number,
    size: number,
    gravity: number,
    col: string,
    vr = 0,
  ): void {
    for (const p of this.pool) {
      if (p.on) continue;
      p.on = true;
      p.kind = kind;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.born = born;
      p.life = life;
      p.size = size;
      p.gravity = gravity;
      p.rot = Math.random() * 6.28;
      p.vr = vr;
      p.col = col;
      return;
    }
  }

  private burst(
    t: number,
    l: Layout,
    count: number,
    power: number,
    kind: number,
    col: string,
    gravity = 1.6,
  ): void {
    const n = this.reducedMotion ? Math.ceil(count * 0.5) : count;
    for (let i = 0; i < n; i++) {
      // Mostly upward fan from the point of contact.
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const speed = l.w * (0.5 + Math.random() * 1.9) * power;
      this.spawn(
        kind,
        l.cx,
        l.gy,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        t,
        320 + Math.random() * 520 * power,
        1 + Math.random() * 1.8,
        gravity,
        col,
      );
    }
  }

  /* ------------------------------ drawing ----------------------------- */

  private ensureCache(ctx: CanvasRenderingContext2D, l: Layout): Cache {
    if (this.cache && this.cache.l === l) return this.cache;
    const { w, h, cx } = l;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#08070b");
    bg.addColorStop(0.6, "#0b090e");
    bg.addColorStop(1, "#0d0908");

    const headY = l.py - w * 0.55;
    const halo = ctx.createRadialGradient(cx, headY + w * 0.1, 0, cx, headY + w * 0.1, w * 0.95);
    halo.addColorStop(0, "rgba(96,70,58,0.34)");
    halo.addColorStop(0.5, "rgba(52,40,48,0.2)");
    halo.addColorStop(1, "rgba(0,0,0,0)");

    const vig = ctx.createRadialGradient(cx, h * 0.5, h * 0.25, cx, h * 0.5, h * 0.78);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.72)");

    const redVig = ctx.createRadialGradient(cx, h * 0.5, h * 0.22, cx, h * 0.5, h * 0.8);
    redVig.addColorStop(0, "rgba(150,14,14,0)");
    redVig.addColorStop(1, "rgba(150,14,14,1)");

    const x0 = w * 0.13;
    const x1 = w * 0.87;
    const guard = (pulse: number) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, `rgba(${GOLD},0)`);
      g.addColorStop(0.18, `rgba(${GOLD},${0.75 + 0.25 * pulse})`);
      g.addColorStop(0.5, `rgba(255,${222 + 20 * pulse},${150 + 60 * pulse},1)`);
      g.addColorStop(0.82, `rgba(${GOLD},${0.75 + 0.25 * pulse})`);
      g.addColorStop(1, `rgba(${GOLD},0)`);
      return g;
    };

    const bw = w * 0.022;
    const steel = ctx.createLinearGradient(-bw, 0, bw, 0);
    steel.addColorStop(0, "#15141a");
    steel.addColorStop(0.45, "#34323b");
    steel.addColorStop(1, "#77737c");

    this.cache = {
      l,
      bg,
      halo,
      vig,
      redVig,
      guardBase: guard(0),
      guardHot: guard(1),
      steel,
      headY,
      silEyes: eyePositions(this.boss.look.kind, l, headY),
    };
    return this.cache;
  }

  /** Image rect for the guardian art: head matched to the silhouette's head. */
  private artRect(l: Layout, c: Cache): PortraitRect | null {
    const art = this.boss.art;
    if (!art) return null;
    const iw = l.w * art.scale;
    const ih = iw * (16 / 9);
    const eyeY = art.eyes?.length
      ? art.eyes.reduce((s, e) => s + e[1], 0) / art.eyes.length
      : 0.3;
    const anchor = c.headY + l.w * 0.005;
    return { x: l.cx - iw / 2, y: anchor - eyeY * ih + art.offsetY * l.h, w: iw, h: ih };
  }

  draw(ctx: CanvasRenderingContext2D, l: Layout, s: FrameState): void {
    const { w, h, cx } = l;
    const c = this.ensureCache(ctx, l);
    const raw = s.now;

    // Visual clock: stops during hit-stop, so particles and rings hold still.
    const lastRaw = this.lastRaw || raw;
    const frozenSpan = Math.max(
      0,
      Math.min(raw, this.freezeUntil) - Math.max(lastRaw, this.freezeFrom),
    );
    this.debt += frozenSpan;
    this.lastRaw = raw;
    const now = raw - this.debt;
    const frozen = raw < this.freezeUntil && raw >= this.freezeFrom;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastV) / 1000));
    this.lastV = now;
    const drift = this.reducedMotion ? 0 : raw / 1000;
    const fxA = this.fxA;

    ctx.save();
    if (this.shake) {
      const u = (now - this.shake.start) / this.shake.dur;
      if (u >= 1) this.shake = null;
      else {
        const m = this.shake.mag * (1 - u);
        ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
      }
    }
    if (this.zoom) {
      const u = (now - this.zoom.start) / this.zoom.dur;
      if (u >= 1) this.zoom = null;
      else if (u > 0) {
        const k = 1 + 0.025 * Math.sin(u * Math.PI);
        ctx.translate(cx, l.gy);
        ctx.scale(k, k);
        ctx.translate(-cx, -l.gy);
      }
    }

    // Backdrop
    ctx.fillStyle = c.bg;
    ctx.fillRect(-20, -20, w + 40, h + 40);
    ctx.globalAlpha = s.presence;
    ctx.fillStyle = c.halo;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    this.drawFog(ctx, l, drift, BACK_FOG, 0.6 + 0.4 * s.presence);

    // Boss: living portrait when the art has landed, silhouette otherwise.
    const flare = raw < this.flareUntil ? 1 : 0;
    let menace = Math.max(s.menace, flare);
    const portrait = this.portrait;
    const rect = portrait?.ready ? this.artRect(l, c) : null;
    if (portrait && rect) {
      portrait.draw(ctx, rect, raw, s.presence, s.pixelRatio);
      const fx = portrait.eyeFx(raw);
      menace = Math.max(menace, fx.menace);
      const eyes = this.boss.art?.eyes;
      if (eyes && eyes.length) {
        while (this.eyeBuf.length < eyes.length) this.eyeBuf.push([0, 0]);
        for (let i = 0; i < eyes.length; i++) {
          const [fx0, fy0] = portrait.transformPoint(eyes[i][0], eyes[i][1], raw);
          this.eyeBuf[i][0] = rect.x + fx0 * rect.w;
          this.eyeBuf[i][1] = rect.y + fy0 * rect.h;
        }
        const k = eyes.length > 2 ? 0.75 : 1;
        drawEyes(ctx, this.boss, rect.w * 0.85 * k, this.eyeBuf, eyes.length, s.presence, menace, drift, fx.blink, fx.level);
        if (this.artDebug.eyes) drawCrosshairs(ctx, this.eyeBuf, eyes.length);
      }
    } else {
      ctx.globalAlpha = 0.25 + 0.75 * s.presence;
      drawSilhouette(ctx, this.boss.look.kind, l, c.headY);
      ctx.globalAlpha = 1;
      drawEyes(ctx, this.boss, w, c.silEyes, c.silEyes.length, s.presence, menace, drift, 1, 1);
    }

    this.drawFog(ctx, l, drift, FRONT_FOG, 1);
    if (!this.reducedMotion) drawEmbers(ctx, l, drift);

    this.drawGuard(ctx, l, c, now);
    this.drawCrack(ctx, now);

    // Blade (and its ghost). During hit-stop the blade holds the impact angle.
    let angle = frozen ? this.freezeAngle : s.angle;
    if (s.stalled && !this.reducedMotion) angle += 0.004 * Math.sin((raw / 1000) * Math.PI * 2 * 38);
    if (now - this.ghostAt < 500) {
      ctx.globalAlpha = 0.25 * (1 - (now - this.ghostAt) / 500) * fxA;
      drawBlade(ctx, l, c.steel, this.ghostAngle);
      ctx.globalAlpha = 1;
    }
    if (s.trailFrom !== null && !this.reducedMotion && !frozen) drawTrail(ctx, l, s.trailFrom, angle);
    drawBlade(ctx, l, c.steel, angle);

    if (now < this.bladeSparkUntil && !this.reducedMotion) {
      const along = l.len * (0.78 + Math.random() * 0.22);
      this.spawn(
        EMBER,
        l.px + Math.sin(angle) * along,
        l.py - Math.cos(angle) * along,
        (Math.random() - 0.5) * l.w * 0.5,
        -l.w * (0.1 + Math.random() * 0.3),
        now,
        260 + Math.random() * 200,
        1 + Math.random() * 1.2,
        2.4,
        "255,160,70",
      );
    }
    if (now < this.emberTrailUntil) {
      this.spawn(
        EMBER,
        l.cx + (Math.random() - 0.5) * l.w * 0.5,
        l.gy + (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * l.w * 0.06,
        -l.w * (0.08 + Math.random() * 0.14),
        now,
        500 + Math.random() * 300,
        1.2 + Math.random() * 1.2,
        -0.35,
        "255,176,84",
      );
    }

    this.drawRays(ctx, l, now);
    this.drawRings(ctx, l, now);
    this.drawWhiff(ctx, l, now);
    this.drawSlash(ctx, l, now);
    this.drawParticles(ctx, l, now, dt);
    ctx.restore();

    // Full-screen flash, edge pulse and vignette (not shaken)
    if (this.flash) {
      const u = (now - this.flash.start) / this.flash.dur;
      if (u >= 1) this.flash = null;
      else {
        ctx.fillStyle = `rgba(${this.flash.rgb},${this.flash.alpha * (1 - u) * (1 - u)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
    if (this.edge) {
      const u = (now - this.edge.start) / this.edge.dur;
      if (u >= 1) this.edge = null;
      else {
        ctx.globalAlpha = this.edge.alpha * (1 - u);
        ctx.fillStyle = c.redVig;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = c.vig;
    ctx.fillRect(0, 0, w, h);
  }

  private drawFog(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    t: number,
    blobs: readonly FogBlob[],
    strength: number,
  ): void {
    for (const b of blobs) {
      const size = l.w * b.size;
      const span = l.w + size;
      const x = ((((b.phase * span + t * b.speed * l.w) % span) + span) % span) - size;
      const y = l.h * b.y - size * 0.3 + Math.sin(t * 0.13 + b.phase * 9) * l.h * 0.012;
      ctx.globalAlpha = b.alpha * strength;
      ctx.drawImage(this.fog, x, y, size, size * 0.6);
    }
    ctx.globalAlpha = 1;
  }

  private drawGuard(ctx: CanvasRenderingContext2D, l: Layout, c: Cache, now: number): void {
    const pulse = Math.max(0, 1 - (now - this.guardPulse) / 380);
    const ack = Math.max(0, 1 - (now - this.ackAt) / 80);
    // The guard line shatters on a bite, then knits back before the next strike.
    const sb = (now - this.guardBreakAt) / 1000;
    const alive = sb < 0 || sb > 1.2 ? 1 : sb < 0.1 ? 1 - sb / 0.1 : Math.max(0, (sb - 0.5) / 0.7);
    if (alive <= 0.01) return;
    const x0 = l.w * 0.13;
    const x1 = l.w * 0.87;
    ctx.save();
    ctx.globalAlpha = alive;
    ctx.lineCap = "butt";
    ctx.shadowColor = "rgba(255,200,90,0.7)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = c.guardBase;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, l.gy);
    ctx.lineTo(x1, l.gy);
    ctx.stroke();
    const hot = Math.min(1, pulse + ack * 0.7);
    if (hot > 0.01) {
      ctx.globalAlpha = alive * hot;
      ctx.shadowColor = "rgba(255,210,120,1)";
      ctx.shadowBlur = 10 + 26 * hot;
      ctx.strokeStyle = c.guardHot;
      ctx.lineWidth = 2 + 2.5 * hot;
      ctx.beginPath();
      ctx.moveTo(x0, l.gy);
      ctx.lineTo(x1, l.gy);
      ctx.stroke();
    }
    // Centre diamond marks the exact point of contact.
    ctx.globalAlpha = alive;
    ctx.shadowBlur = 0;
    const d = l.w * 0.014 * (1 + 0.6 * pulse);
    ctx.fillStyle = "rgba(255,232,170,1)";
    ctx.beginPath();
    ctx.moveTo(l.cx, l.gy - d);
    ctx.lineTo(l.cx + d, l.gy);
    ctx.lineTo(l.cx, l.gy + d);
    ctx.lineTo(l.cx - d, l.gy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawCrack(ctx: CanvasRenderingContext2D, now: number): void {
    const k = this.crack;
    if (!k) return;
    const u = (now - k.start) / 600;
    if (u >= 1) {
      this.crack = null;
      return;
    }
    ctx.save();
    ctx.globalAlpha = (1 - u) * this.fxA;
    ctx.strokeStyle = "rgba(255,226,170,1)";
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "miter";
    ctx.beginPath();
    ctx.moveTo(k.pts[0], k.pts[1]);
    for (let i = 2; i < k.pts.length; i += 2) ctx.lineTo(k.pts[i], k.pts[i + 1]);
    ctx.stroke();
    ctx.restore();
  }

  private drawRings(ctx: CanvasRenderingContext2D, l: Layout, now: number): void {
    for (const r of this.rings) {
      if (!r.on) continue;
      const u = (now - r.start) / r.dur;
      if (u >= 1) {
        r.on = false;
        continue;
      }
      if (u < 0) continue;
      ctx.strokeStyle = `rgba(${r.col},${r.alpha * (1 - u)})`;
      ctx.lineWidth = r.lw * (1 - u) + 0.5;
      ctx.beginPath();
      ctx.arc(l.cx, l.gy, r.r0 + (r.r1 - r.r0) * easeOutCubic(u), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawRays(ctx: CanvasRenderingContext2D, l: Layout, now: number): void {
    if (!this.rays) return;
    const u = (now - this.rays.start) / 220;
    if (u >= 1) {
      this.rays = null;
      return;
    }
    if (u < 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,222,150,${0.5 * (1 - u)})`;
    const len = l.w * (0.18 + 0.4 * easeOutCubic(u));
    const half = l.w * 0.012 * (1 - u);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.moveTo(l.cx - dy * half, l.gy + dx * half);
      ctx.lineTo(l.cx + dx * len, l.gy + dy * len);
      ctx.lineTo(l.cx + dy * half, l.gy - dx * half);
    }
    ctx.fill();
    ctx.restore();
  }

  /** Early tap: a pale arc sweeping through empty air along the guard line. */
  private drawWhiff(ctx: CanvasRenderingContext2D, l: Layout, now: number): void {
    const u = (now - this.whiffAt) / 150;
    if (u < 0 || u >= 1) return;
    const x0 = l.w * 0.13;
    const x1 = l.w * 0.87;
    const head = x0 + (x1 - x0) * easeOutCubic(u);
    const tail = Math.max(x0, head - l.w * 0.3);
    ctx.save();
    ctx.globalAlpha = (1 - u) * 0.8 * this.fxA;
    ctx.strokeStyle = "rgba(235,232,240,1)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tail, l.gy - l.w * 0.03);
    ctx.quadraticCurveTo((tail + head) / 2, l.gy - l.w * 0.075, head, l.gy - l.w * 0.03);
    ctx.stroke();
    ctx.restore();
  }

  /** Bite: a diagonal red slash from the blade tip. */
  private drawSlash(ctx: CanvasRenderingContext2D, l: Layout, now: number): void {
    const sl = this.slash;
    if (!sl) return;
    const u = (now - sl.start) / 360;
    if (u >= 1) {
      this.slash = null;
      return;
    }
    if (u < 0) return;
    const sx = l.cx - l.w * 0.3;
    const sy = l.gy - l.w * 0.2;
    const k = easeOutCubic(Math.min(1, u * 2.4));
    const ex = sx + (l.cx + l.w * 0.32 - sx) * k;
    const ey = sy + (l.gy + l.w * 0.2 - sy) * k;
    const nx = 0.55;
    const ny = -0.83;
    const half = l.w * 0.022 * (1 - u);
    ctx.save();
    ctx.globalAlpha = (1 - u) * this.fxA;
    ctx.fillStyle = "rgba(170,24,24,1)";
    ctx.shadowColor = "rgba(255,60,40,0.9)";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo((sx + ex) / 2 + nx * half, (sy + ey) / 2 + ny * half);
    ctx.lineTo(ex, ey);
    ctx.lineTo((sx + ex) / 2 - nx * half, (sy + ey) / 2 - ny * half);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, l: Layout, now: number, dt: number): void {
    ctx.lineCap = "round";
    const fxA = this.fxA;
    for (const p of this.pool) {
      if (!p.on) continue;
      const age = now - p.born;
      if (age >= p.life) {
        p.on = false;
        continue;
      }
      p.vy += l.h * p.gravity * dt;
      p.vx *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const a = 1 - age / p.life;
      ctx.globalAlpha = a * fxA;
      switch (p.kind) {
        case SPARK:
        case EMBER:
          ctx.strokeStyle = `rgb(${p.col})`;
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028);
          ctx.stroke();
          break;
        case ASH:
        case DUST: {
          ctx.fillStyle = `rgb(${p.col})`;
          const r = p.size * (1 + (1 - a) * 1.6);
          ctx.globalAlpha = a * 0.55 * fxA;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case SHARD: {
          ctx.fillStyle = `rgb(${p.col})`;
          const s = p.size;
          const c0 = Math.cos(p.rot);
          const s0 = Math.sin(p.rot);
          ctx.beginPath();
          ctx.moveTo(p.x + c0 * s * 1.6, p.y + s0 * s * 1.6);
          ctx.lineTo(p.x - s0 * s, p.y + c0 * s);
          ctx.lineTo(p.x - c0 * s, p.y - s0 * s);
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

interface FogBlob {
  y: number;
  size: number;
  speed: number;
  alpha: number;
  phase: number;
}

const BACK_FOG: readonly FogBlob[] = [
  { y: 0.2, size: 1.9, speed: 0.012, alpha: 0.2, phase: 0.1 },
  { y: 0.34, size: 2.2, speed: -0.009, alpha: 0.17, phase: 0.55 },
  { y: 0.5, size: 1.7, speed: 0.016, alpha: 0.14, phase: 0.8 },
];

const FRONT_FOG: readonly FogBlob[] = [
  { y: 0.62, size: 1.8, speed: -0.02, alpha: 0.1, phase: 0.3 },
  { y: 0.86, size: 2.3, speed: 0.026, alpha: 0.2, phase: 0.05 },
  { y: 0.95, size: 2.0, speed: -0.032, alpha: 0.24, phase: 0.62 },
  { y: 1.02, size: 2.6, speed: 0.018, alpha: 0.22, phase: 0.9 },
];

function drawEmbers(ctx: CanvasRenderingContext2D, l: Layout, t: number): void {
  for (let i = 0; i < 12; i++) {
    const seed = i * 12.9898;
    const period = 9 + (i % 5) * 2.3;
    const u = (t / period + (Math.sin(seed) * 0.5 + 0.5)) % 1;
    const x = l.w * ((Math.sin(seed * 3.7) * 0.5 + 0.5) + Math.sin(t * 0.4 + i) * 0.02);
    const y = l.h * (1.02 - u * 0.75);
    const a = Math.sin(u * Math.PI) * 0.55;
    ctx.fillStyle = `rgba(255,${130 + (i % 3) * 30},60,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function spike(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  len: number,
  width: number,
): void {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  ctx.beginPath();
  ctx.moveTo(x - dy * width, y + dx * width);
  ctx.lineTo(x + dx * len, y + dy * len);
  ctx.lineTo(x + dy * width, y - dx * width);
  ctx.closePath();
  ctx.fill();
}

const SHOULDER_SCALE: Record<SilhouetteKind, number> = {
  keeper: 1,
  knight: 1.05,
  warden: 0.86,
  twins: 1.12,
  caller: 0.94,
  mother: 1.3,
  king: 1.1,
};

const deg = (d: number) => (d * Math.PI) / 180;

/** The procedural fallback. Unchanged, and never animated. */
function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  kind: SilhouetteKind,
  l: Layout,
  hy: number,
): void {
  const { cx, h } = l;
  const u = l.w;
  const k = SHOULDER_SCALE[kind];
  const sy = hy + 0.17 * u;
  ctx.fillStyle = "#030204";
  ctx.strokeStyle = "#030204";

  // Torso and shoulders, running off the bottom of the screen.
  ctx.beginPath();
  ctx.moveTo(cx - 0.78 * u * k, h + 10);
  ctx.bezierCurveTo(cx - 0.62 * u * k, sy + 0.5 * u, cx - 0.52 * u * k, sy + 0.07 * u, cx - 0.3 * u * k, sy);
  ctx.quadraticCurveTo(cx - 0.12 * u, sy - 0.03 * u, cx - 0.085 * u, sy - 0.08 * u);
  ctx.lineTo(cx + 0.085 * u, sy - 0.08 * u);
  ctx.quadraticCurveTo(cx + 0.12 * u, sy - 0.03 * u, cx + 0.3 * u * k, sy);
  ctx.bezierCurveTo(cx + 0.52 * u * k, sy + 0.07 * u, cx + 0.62 * u * k, sy + 0.5 * u, cx + 0.78 * u * k, h + 10);
  ctx.closePath();
  ctx.fill();

  // Arm reaching to the blade hand.
  ctx.lineCap = "round";
  ctx.lineWidth = 0.12 * u;
  ctx.beginPath();
  ctx.moveTo(cx - 0.3 * u * k, sy + 0.07 * u);
  ctx.quadraticCurveTo(l.px + 0.02 * u, sy + 0.08 * u, l.px, l.py);
  ctx.stroke();

  const head = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx * u, ry * u, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  switch (kind) {
    case "keeper": {
      head(cx, hy, 0.1, 0.125);
      ctx.beginPath();
      ctx.moveTo(cx - 0.2 * u, sy + 0.04 * u);
      ctx.bezierCurveTo(cx - 0.21 * u, hy - 0.05 * u, cx - 0.1 * u, hy - 0.21 * u, cx + 0.03 * u, hy - 0.25 * u);
      ctx.bezierCurveTo(cx + 0.12 * u, hy - 0.17 * u, cx + 0.21 * u, hy - 0.03 * u, cx + 0.2 * u, sy + 0.04 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "knight": {
      head(cx, hy, 0.1, 0.125);
      const top = hy - 0.1 * u;
      for (const [a, len] of [[-58, 0.13], [-28, 0.19], [0, 0.11], [28, 0.19], [58, 0.13]] as const) {
        spike(ctx, cx + Math.sin(deg(a)) * 0.07 * u, top + (1 - Math.cos(deg(a))) * 0.06 * u, deg(a), len * u, 0.022 * u);
      }
      for (const side of [-1, 1]) {
        for (const [off, a, len] of [[0.2, 18, 0.13], [0.3, 34, 0.17], [0.4, 52, 0.12]] as const) {
          spike(ctx, cx + side * off * u * k, sy + 0.03 * u, deg(a * side), len * u, 0.025 * u);
        }
      }
      break;
    }
    case "warden": {
      head(cx, hy, 0.085, 0.14);
      spike(ctx, cx, hy - 0.1 * u, 0, 0.3 * u, 0.03 * u);
      for (const side of [-1, 1]) {
        spike(ctx, cx + side * 0.13 * u, sy + 0.02 * u, deg(side * 8), 0.24 * u, 0.06 * u);
      }
      break;
    }
    case "twins": {
      head(cx - 0.15 * u, hy + 0.02 * u, 0.085, 0.11);
      head(cx + 0.15 * u, hy - 0.03 * u, 0.085, 0.11);
      ctx.lineWidth = 0.1 * u;
      for (const [x, y] of [[-0.15, 0.02], [0.15, -0.03]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + x * u, hy + y * u);
        ctx.lineTo(cx + x * 0.6 * u, sy + 0.04 * u);
        ctx.stroke();
      }
      spike(ctx, cx - 0.15 * u, hy - 0.07 * u, deg(-6), 0.12 * u, 0.05 * u);
      spike(ctx, cx + 0.15 * u, hy - 0.12 * u, deg(6), 0.12 * u, 0.05 * u);
      break;
    }
    case "caller": {
      head(cx, hy, 0.095, 0.125);
      head(cx, hy - 0.075 * u, 0.26, 0.032);
      ctx.beginPath();
      ctx.moveTo(cx - 0.1 * u, hy - 0.07 * u);
      ctx.lineTo(cx - 0.075 * u, hy - 0.28 * u);
      ctx.lineTo(cx + 0.075 * u, hy - 0.26 * u);
      ctx.lineTo(cx + 0.1 * u, hy - 0.07 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "mother": {
      head(cx, sy - 0.02 * u, 0.44, 0.17);
      head(cx, hy + 0.05 * u, 0.085, 0.105);
      for (const a of [-64, -40, -18, 18, 40, 64]) {
        const r = deg(a);
        spike(ctx, cx + Math.sin(r) * 0.3 * u, sy - 0.03 * u - Math.cos(r) * 0.12 * u, r * 0.75, 0.24 * u, 0.028 * u);
      }
      break;
    }
    case "king": {
      head(cx, hy, 0.1, 0.13);
      const lens = [0.15, 0.07, 0.21, 0.1, 0.16];
      lens.forEach((len, i) => {
        const x = cx + (i - 2) * 0.042 * u;
        spike(ctx, x, hy - 0.09 * u, deg((i - 2) * 7), len * u, 0.024 * u);
      });
      for (const side of [-1, 1]) {
        spike(ctx, cx + side * 0.34 * u * k, sy + 0.04 * u, deg(side * 62), 0.2 * u, 0.06 * u);
      }
      break;
    }
  }
}

function eyePositions(kind: SilhouetteKind, l: Layout, hy: number): Array<[number, number]> {
  const u = l.w;
  const { cx } = l;
  const pair = (x: number, y: number, gap = 0.042): Array<[number, number]> => [
    [x - gap * u, y],
    [x + gap * u, y],
  ];
  switch (kind) {
    case "twins":
      return [...pair(cx - 0.15 * u, hy + 0.02 * u, 0.034), ...pair(cx + 0.15 * u, hy - 0.03 * u, 0.034)];
    case "mother":
      return pair(cx, hy + 0.05 * u, 0.034);
    case "warden":
      return pair(cx, hy - 0.01 * u, 0.036);
    default:
      return pair(cx, hy + 0.005 * u);
  }
}

/**
 * Eye glow. `u` is the figure's drawn width, so the glow scales with whatever
 * is behind it. `blink` is eyelid openness (0..1), `level` the kick multiplier.
 */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  boss: Boss,
  u: number,
  eyes: ReadonlyArray<readonly [number, number]>,
  count: number,
  presence: number,
  menace: number,
  t: number,
  blink: number,
  level: number,
): void {
  if (presence <= 0.02) return;
  const [r, g, b] = boss.look.eye;
  const flicker = 0.88 + 0.12 * Math.sin(t * 2.3) * Math.sin(t * 0.7);
  const a = Math.min(1, presence * presence * flicker * (0.8 + 0.2 * menace) * level);
  ctx.save();
  ctx.shadowColor = `rgba(${r},${g},${b},${a})`;
  ctx.shadowBlur = u * (0.035 + 0.03 * menace);
  ctx.fillStyle = `rgba(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(255, b + 30)},${a})`;
  for (let i = 0; i < count; i++) {
    const [x, y] = eyes[i];
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.ellipse(x, y, u * 0.013, u * (0.007 + 0.002 * menace) * Math.max(0.08, blink), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCrosshairs(
  ctx: CanvasRenderingContext2D,
  eyes: ReadonlyArray<readonly [number, number]>,
  count: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(80,255,120,0.9)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const [x, y] = eyes[i];
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x + 9, y);
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y + 9);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, l: Layout, from: number, to: number): void {
  if (to - from < 0.02) return;
  // Canvas arcs measure from +x; our angles measure clockwise from up.
  const a0 = from - Math.PI / 2;
  const a1 = to - Math.PI / 2;
  ctx.fillStyle = "rgba(230,214,180,0.09)";
  ctx.beginPath();
  ctx.arc(l.px, l.py, l.len, a0, a1);
  ctx.arc(l.px, l.py, l.len * 0.3, a1, a0, true);
  ctx.closePath();
  ctx.fill();
}

function drawBlade(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  steel: CanvasGradient,
  angle: number,
): void {
  const { len, w } = l;
  const bw = w * 0.022;
  ctx.save();
  ctx.translate(l.px, l.py);
  ctx.rotate(angle);
  // Blade points "up" in local space.
  ctx.fillStyle = steel;
  ctx.beginPath();
  ctx.moveTo(-bw, -len * 0.06);
  ctx.lineTo(-bw * 0.8, -len * 0.9);
  ctx.lineTo(0, -len);
  ctx.lineTo(bw * 0.8, -len * 0.9);
  ctx.lineTo(bw, -len * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(226,214,190,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bw, -len * 0.06);
  ctx.lineTo(bw * 0.8, -len * 0.9);
  ctx.lineTo(0, -len);
  ctx.stroke();
  // Crossguard, grip, fist
  ctx.fillStyle = "#0c0a0d";
  ctx.fillRect(-w * 0.055, -len * 0.075, w * 0.11, len * 0.022);
  ctx.fillRect(-bw * 0.6, -len * 0.06, bw * 1.2, len * 0.13);
  ctx.fillStyle = "#030204";
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
