import type { Boss, Rgb } from "./bosses";
import { PHASE_TWO_ROUND, ROUNDS_PER_RUN } from "./config";
import type { Omen } from "./moves";
import { seededRng } from "./prng";

/**
 * The arena between rounds: each guardian plays a short beat after every
 * round and leaves a mark that stays for the rest of the fight (coins on the
 * floor, briar at the edges, stars in the dusk...). Also the day's omen
 * (sky and tint) and the phase-two transformation.
 *
 * NO TELL (same rule as living.ts). Everything here is a function of the
 * wall clock, the seed, and the time a round resolved. A beat starts when a
 * round ends and is over before the next strike can begin (the round break is
 * at least GAP_MS + ROUND_BREAK_MS = 2.7 s, a beat is 2.4 s; the phase shift
 * gets PHASE_SHIFT_MS more). Nothing here imports generator.ts.
 */

/** Seconds after a round resolves at which each beat lands (audio.ts matches). */
export const BEAT_LAND = {
  coins: 1.35,
  thorns: 0.75,
  stars: 1.05,
  candles: 0.85,
  bell: 0.55,
  roots: 0.8,
  dark: 1.15,
} as const;
/** Seconds after the last phase-one round resolves at which the guardian turns. */
export const PHASE_PEAK = 2.85;
/** Longest a beat runs, in seconds. Must stay under the round break. */
export const BEAT_SECONDS = 2.4;
export const PHASE_SECONDS = 4.2;

/** Image fractions to screen pixels under the living pose, or null for none. */
export type Anchor = (fx: number, fy: number) => [number, number] | null;

interface Geo {
  w: number;
  h: number;
  cx: number;
  /** Fallback head y (silhouette), for beats that start at the guardian. */
  headY: number;
}

interface Path {
  pts: Array<[number, number]>;
  side: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** 0 -> 1 -> 0 over [a, b]. */
const bump = (v: number, a: number, b: number) =>
  v <= a || v >= b ? 0 : Math.sin(((v - a) / (b - a)) * Math.PI);
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
const TAU = Math.PI * 2;

export class Arena {
  /** Rounds whose mark is on the field. */
  private marks = 0;
  /** Resolution time (ms) of each mark's round; -Infinity when restored. */
  private born: number[] = [];
  private phaseAt = Number.NEGATIVE_INFINITY;
  private phaseDone = false;
  private rnd: number[];
  private darkCache: { key: number; w: number; h: number; g: CanvasGradient } | null = null;

  constructor(
    private boss: Boss,
    seed: string,
    private omen: Omen,
    private reduced: boolean,
  ) {
    const rng = seededRng(`${seed}|${boss.id}|arena`);
    this.rnd = Array.from({ length: 64 }, () => rng());
  }

  /** Resume: the marks of `rounds` finished rounds, already settled. */
  restore(rounds: number): void {
    const n = Math.max(0, Math.min(ROUNDS_PER_RUN - 1, rounds));
    this.marks = n;
    this.born = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
    this.phaseDone = n >= PHASE_TWO_ROUND;
  }

  /** A round (0-based) resolved at `now`. `phaseShift`: the next round is phase two. */
  interlude(round: number, now: number, phaseShift: boolean): void {
    if (round >= ROUNDS_PER_RUN - 1) return;
    this.marks = Math.max(this.marks, round + 1);
    this.born[round] = now;
    if (phaseShift) this.phaseAt = now;
  }

  private r(i: number): number {
    return this.rnd[i % this.rnd.length];
  }

  /** Seconds since mark k's beat began. Large for restored marks. */
  private age(k: number, now: number): number {
    const b = this.born[k];
    return b === undefined || !Number.isFinite(b) ? 1e6 : (now - b) / 1000;
  }

  /** 0..1 how far into the phase-two eye colour the guardian is. */
  private eyeMix(now: number): number {
    if (this.phaseDone && !Number.isFinite(this.phaseAt)) return 1;
    if (!Number.isFinite(this.phaseAt)) return 0;
    return clamp01(((now - this.phaseAt) / 1000 - (PHASE_PEAK - 0.3)) / 0.45);
  }

  eyeRgb(now: number): Rgb {
    const t = this.eyeMix(now);
    const a = this.boss.look.eye;
    if (t <= 0) return a;
    const b = this.boss.phaseTwo.eye;
    return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
  }

  /** Extra eye menace while the guardian turns. */
  menace(now: number): number {
    if (!Number.isFinite(this.phaseAt)) return 0;
    const v = (now - this.phaseAt) / 1000;
    return bump(v, PHASE_PEAK - 0.4, PHASE_PEAK + 1.1);
  }

  /** Ambient embers dim as the Unlit King's dark closes in. */
  emberLevel(now: number): number {
    if (this.boss.interlude.kind !== "dark") return 1;
    return Math.max(0.15, 1 - this.darkLevel(now) / 10);
  }

  private darkLevel(now: number): number {
    if (this.marks === 0) return 0;
    const k = this.marks - 1;
    return k + clamp01((this.age(k, now) - BEAT_LAND.dark) / 0.6);
  }

  /** Where a beat starts: the art anchor if there is one, else a fallback. */
  private from(anchor: Anchor, g: Geo, fx: number, fy: number, k = 0): [number, number] {
    const spots = this.boss.interlude.spots;
    const f = spots?.length ? spots[k % spots.length] : this.boss.interlude.from;
    const p = f ? anchor(f[0], f[1]) : null;
    return p ?? [g.w * fx, g.h * fy];
  }

  private face(anchor: Anchor, g: Geo): [number, number] {
    const eyes = this.boss.art?.eyes;
    if (eyes?.length) {
      const fx = eyes.reduce((s, e) => s + e[0], 0) / eyes.length;
      const fy = eyes.reduce((s, e) => s + e[1], 0) / eyes.length;
      const p = anchor(fx, fy);
      if (p) return p;
    }
    return [g.cx, g.headY];
  }

  /* ----------------------------- layers ----------------------------- */

  /** Behind the guardian: omen sky, Vesper's stars. */
  drawBack(ctx: CanvasRenderingContext2D, g: Geo, now: number): void {
    const t = now / 1000;
    const { w, h } = g;
    if (this.omen.id === "bloodMoon") {
      ctx.save();
      ctx.shadowColor = "rgba(200,30,30,0.8)";
      ctx.shadowBlur = w * 0.08;
      ctx.fillStyle = "rgba(150,26,24,0.85)";
      ctx.beginPath();
      ctx.arc(w * 0.82, h * 0.13, w * 0.055, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else if (this.omen.id === "longNight") {
      // A thin crescent: the disc, with an offset disc clipped out of it.
      const x = w * 0.18;
      const y = h * 0.12;
      const r = w * 0.045;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(x + r * 0.45, y - r * 0.28, r * 0.96, 0, TAU, true);
      ctx.clip("evenodd");
      ctx.shadowColor = "rgba(170,190,255,0.55)";
      ctx.shadowBlur = w * 0.05;
      ctx.fillStyle = "rgba(205,215,240,0.75)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    if (this.boss.interlude.kind !== "stars") return;
    const c = this.boss.interlude.rgb;
    for (let k = 0; k < this.marks; k++) {
      const a = this.age(k, now);
      const x = w * lerp(0.07, 0.93, this.r(k * 3));
      const y = h * lerp(0.05, 0.3, this.r(k * 3 + 1));
      const bloom = this.reduced ? 1 : easeOut((a - BEAT_LAND.stars) / 0.15);
      if (bloom <= 0) continue;
      const flare = this.reduced ? 0 : 1.6 * bump(a, BEAT_LAND.stars, BEAT_LAND.stars + 0.7);
      const tw = 0.65 + 0.35 * Math.sin(t * (1.1 + this.r(k * 3 + 2)) + k * 2.1);
      sparkle(ctx, x, y, w * 0.012 * (1 + flare), rgba(c, bloom * tw), w);
    }
  }

  /** In front of the guardian, behind the guard line and blade. */
  drawFront(ctx: CanvasRenderingContext2D, g: Geo, now: number, anchor: Anchor): void {
    switch (this.boss.interlude.kind) {
      case "coins":
        this.drawCoins(ctx, g, now, anchor);
        break;
      case "thorns":
        this.drawThorns(ctx, g, now);
        break;
      case "candles":
        this.drawCandles(ctx, g, now, anchor);
        break;
      case "bell":
        this.drawBell(ctx, g, now, anchor);
        break;
      case "roots":
        this.drawRoots(ctx, g, now);
        break;
      case "dark":
        this.drawSnuff(ctx, g, now, anchor);
        break;
      case "stars":
        this.drawDuskSweep(ctx, g, now);
        break;
    }
    if (this.omen.id === "ashfall" && !this.reduced) drawAsh(ctx, g, now / 1000);
    this.drawPhaseRing(ctx, g, now, anchor);
  }

  /** Over everything but the vignette: omen tint, dusk, dark, the phase dim. */
  drawOverlay(ctx: CanvasRenderingContext2D, g: Geo, now: number): void {
    const { w, h } = g;
    if (this.omen.tint) {
      ctx.fillStyle = rgba(this.omen.tint, this.omen.tintAlpha);
      ctx.fillRect(0, 0, w, h);
    }
    const kind = this.boss.interlude.kind;
    if (kind === "stars" && this.marks > 0) {
      const k = this.marks - 1;
      const level = k + clamp01((this.age(k, now) - 0.2) / 1.2);
      ctx.fillStyle = `rgba(30,18,80,${Math.min(0.2, 0.022 * level)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (kind === "dark") {
      const level = this.darkLevel(now);
      if (level > 0) {
        const key = Math.round(level * 50);
        let c = this.darkCache;
        if (!c || c.key !== key || c.w !== w || c.h !== h) {
          const inner = h * Math.max(0.12, 0.42 - 0.03 * level);
          const grad = ctx.createRadialGradient(g.cx, h * 0.5, inner, g.cx, h * 0.5, h * 0.75);
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.7, 0.075 * level)})`);
          c = { key, w, h, g: grad };
          this.darkCache = c;
        }
        ctx.fillStyle = c.g;
        ctx.fillRect(0, 0, w, h);
      }
      if (this.marks > 0 && !this.reduced) {
        const a = this.age(this.marks - 1, now);
        const dim = 0.22 * bump(a, BEAT_LAND.dark - 0.05, BEAT_LAND.dark + 0.8);
        if (dim > 0) {
          ctx.fillStyle = `rgba(0,0,0,${dim})`;
          ctx.fillRect(0, 0, w, h);
        }
      }
    }
    if (Number.isFinite(this.phaseAt)) {
      const v = (now - this.phaseAt) / 1000;
      let dim = 0;
      if (v > PHASE_PEAK - 0.95 && v < PHASE_PEAK + 1.35) {
        if (v < PHASE_PEAK - 0.25) dim = easeInOut((v - (PHASE_PEAK - 0.95)) / 0.7);
        else if (v < PHASE_PEAK + 0.15) dim = 1;
        else dim = 1 - easeInOut((v - (PHASE_PEAK + 0.15)) / 1.2);
      }
      if (dim > 0) {
        ctx.fillStyle = `rgba(0,0,0,${0.55 * dim})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (v > PHASE_SECONDS) this.phaseDone = true;
    }
  }

  /* ----------------------------- beats ------------------------------ */

  private coinSlot(k: number, g: Geo): [number, number] {
    const stack = Math.floor(k / 5);
    const level = k % 5;
    return [g.w * (0.15 + 0.085 * stack), g.h * 0.972 - level * g.w * 0.017];
  }

  private drawCoins(ctx: CanvasRenderingContext2D, g: Geo, now: number, anchor: Anchor): void {
    const { w } = g;
    const t = now / 1000;
    const c = this.boss.interlude.rgb;
    const src = this.from(anchor, g, 0.25, 0.7);
    const rx = w * 0.03;
    const ry = w * 0.011;
    for (let k = 0; k < this.marks; k++) {
      const a = this.age(k, now);
      const [sx, sy] = this.coinSlot(k, g);
      if (a < BEAT_SECONDS) {
        // The lantern swells, lets a coin go, and the coin falls to the pile.
        const glow = bump(a, 0, 0.9) * 0.55;
        if (glow > 0) radial(ctx, src[0], src[1], w * 0.12, rgba(c, glow));
        if (this.reduced) {
          if (a > BEAT_LAND.coins) coin(ctx, sx, sy, rx, ry, 0, clamp01((a - BEAT_LAND.coins) / 0.3));
          continue;
        }
        const T0 = 0.35;
        if (a < T0) continue;
        if (a < BEAT_LAND.coins) {
          const u = (a - T0) / (BEAT_LAND.coins - T0);
          const x = lerp(src[0], sx, easeInOut(u));
          const y = lerp(src[1], sy, u * u) - g.h * 0.05 * Math.sin(Math.PI * u) * (1 - u);
          coin(ctx, x, y, rx, ry, u * 15, 1);
          continue;
        }
        const after = a - BEAT_LAND.coins;
        const hop = after < 0.3 ? Math.abs(Math.sin((after / 0.3) * Math.PI)) * w * 0.012 * (1 - after / 0.3) : 0;
        coin(ctx, sx, sy - hop, rx, ry, 0, 1);
        if (after < 0.45) ring(ctx, sx, sy, w * (0.02 + 0.09 * easeOut(after / 0.45)), rgba(c, 0.6 * (1 - after / 0.45)), 1.5);
        continue;
      }
      coin(ctx, sx, sy, rx, ry, 0, 1);
      // An occasional glint, each coin on its own slow clock.
      const ph = (t + k * 1.37) % (4.5 + this.r(k) * 2.5);
      if (!this.reduced && ph < 0.22) sparkle(ctx, sx + rx * 0.4, sy - ry * 0.3, w * 0.012 * Math.sin((ph / 0.22) * Math.PI), "rgba(255,240,200,0.9)", w);
    }
  }

  private thornPaths: Path[] = [];
  private thornW = 0;

  private thornPath(k: number, g: Geo): Path {
    if (this.thornW !== g.w) {
      this.thornPaths = [];
      this.thornW = g.w;
    }
    const cached = this.thornPaths[k];
    if (cached) return cached;
    const { w, h } = g;
    const side = k % 2 === 0 ? -1 : 1;
    const edge = side < 0 ? -4 : w + 4;
    const reach = w * lerp(0.08, 0.24, this.r(k * 5));
    const top = h * lerp(0.64, 0.86, this.r(k * 5 + 1));
    const y0 = h * lerp(0.9, 1.01, this.r(k * 5 + 2));
    const p0: [number, number] = [edge, y0];
    const p1: [number, number] = [edge - side * w * 0.04, lerp(y0, top, 0.5)];
    const p2: [number, number] = [edge - side * reach * 1.25, top + h * 0.05];
    const p3: [number, number] = [edge - side * reach, top];
    const pts: Array<[number, number]> = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const m = 1 - s;
      pts.push([
        m * m * m * p0[0] + 3 * m * m * s * p1[0] + 3 * m * s * s * p2[0] + s * s * s * p3[0],
        m * m * m * p0[1] + 3 * m * m * s * p1[1] + 3 * m * s * s * p2[1] + s * s * s * p3[1],
      ]);
    }
    const path = { pts, side };
    this.thornPaths[k] = path;
    return path;
  }

  private drawThorns(ctx: CanvasRenderingContext2D, g: Geo, now: number): void {
    const { w } = g;
    const t = now / 1000;
    const c = this.boss.interlude.rgb;
    ctx.save();
    ctx.lineCap = "round";
    for (let k = 0; k < this.marks; k++) {
      const a = this.age(k, now);
      const grow = this.reduced ? clamp01((a - 0.2) / 0.4) : easeOut((a - 0.15) / (BEAT_LAND.thorns - 0.15));
      if (grow <= 0) continue;
      const { pts, side } = this.thornPath(k, g);
      const last = Math.max(1, Math.floor(grow * (pts.length - 1)));
      const sway = this.reduced ? 0 : w * 0.005;
      const at = (i: number): [number, number] => {
        const f = i / (pts.length - 1);
        return [pts[i][0] + Math.sin(t * 0.7 + k * 1.3) * sway * f * f, pts[i][1]];
      };
      const fade = this.reduced ? grow : 1;
      for (let i = 1; i <= last; i++) {
        const f = i / (pts.length - 1);
        const [x0, y0] = at(i - 1);
        const [x1, y1] = at(i);
        ctx.strokeStyle = `rgba(58,72,40,${0.95 * fade})`;
        ctx.lineWidth = w * lerp(0.02, 0.005, f);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.strokeStyle = rgba(c, 0.4 * fade);
        ctx.lineWidth = w * lerp(0.006, 0.0015, f);
        ctx.stroke();
        if (i % 3 === 0) {
          // A thorn, alternating sides of the stem.
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const s = (i / 3) % 2 === 0 ? 1 : -1;
          const tl = w * lerp(0.028, 0.01, f);
          ctx.fillStyle = `rgba(86,100,56,${fade})`;
          ctx.beginPath();
          ctx.moveTo(x1 - (dx / len) * tl * 0.35, y1 - (dy / len) * tl * 0.35);
          ctx.lineTo(x1 + nx * s * tl + (dx / len) * tl * 0.5, y1 + ny * s * tl + (dy / len) * tl * 0.5);
          ctx.lineTo(x1 + (dx / len) * tl * 0.35, y1 + (dy / len) * tl * 0.35);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (!this.reduced && a < BEAT_LAND.thorns + 0.5) {
        const [tx, ty] = at(last);
        const glow = a < BEAT_LAND.thorns ? 0.7 : 0.7 * (1 - (a - BEAT_LAND.thorns) / 0.5);
        radial(ctx, tx, ty, w * 0.035, rgba(c, glow));
      }
      void side;
    }
    ctx.restore();
  }

  private candleSlot(k: number, g: Geo): [number, number, number] {
    const side = k % 2;
    const idx = Math.floor(k / 2);
    const x = side === 0 ? g.w * (0.07 + 0.07 * idx) : g.w * (0.93 - 0.07 * idx);
    const tall = g.w * lerp(0.03, 0.05, this.r(k * 7));
    return [x, g.h * 0.99, tall];
  }

  private drawCandles(ctx: CanvasRenderingContext2D, g: Geo, now: number, anchor: Anchor): void {
    const { w } = g;
    const t = now / 1000;
    const c = this.boss.interlude.rgb;
    const face = this.face(anchor, g);
    for (let k = 0; k < this.marks; k++) {
      const a = this.age(k, now);
      const [x, base, tall] = this.candleSlot(k, g);
      const top = base - tall;
      // Wax.
      ctx.fillStyle = "rgba(70,48,40,0.95)";
      ctx.fillRect(x - w * 0.011, top, w * 0.022, tall + 4);
      ctx.fillStyle = "rgba(150,110,90,0.35)";
      ctx.fillRect(x - w * 0.011, top, w * 0.005, tall + 4);
      if (!this.reduced && a < BEAT_LAND.candles) {
        // An ember drifts down from the guardian to the wick.
        const u = clamp01((a - 0.15) / (BEAT_LAND.candles - 0.15));
        if (u > 0) {
          const ex = lerp(face[0], x, easeInOut(u)) + Math.sin(u * 9) * w * 0.02 * (1 - u);
          const ey = lerp(face[1], top, u * u);
          radial(ctx, ex, ey, w * 0.025, rgba(c, 0.8));
        }
        continue;
      }
      const lit = this.reduced ? clamp01((a - BEAT_LAND.candles) / 0.3) : 1;
      if (lit <= 0) continue;
      const flare = this.reduced ? 0 : 1.2 * bump(a, BEAT_LAND.candles, BEAT_LAND.candles + 0.6);
      const flick = this.reduced ? 1 : 1 + 0.12 * Math.sin(t * 9 + k) + 0.06 * Math.sin(t * 23 + k * 3);
      const fh = w * 0.032 * flick * (1 + flare) * lit;
      radial(ctx, x, top - fh * 0.4, w * (0.075 + 0.05 * flare), rgba(c, 0.38 * lit));
      flame(ctx, x, top, fh, w * 0.009 * (1 + flare * 0.5), lit);
    }
  }

  private drawBell(ctx: CanvasRenderingContext2D, g: Geo, now: number, anchor: Anchor): void {
    const { w, h } = g;
    const t = now / 1000;
    const c = this.boss.interlude.rgb;
    const src = this.from(anchor, g, 0.78, 0.25);
    for (let k = 0; k < this.marks; k++) {
      const a = this.age(k, now);
      if (a < BEAT_SECONDS && !this.reduced) {
        for (let i = 0; i < 3; i++) {
          const v = (a - BEAT_LAND.bell - i * 0.14) / 1.3;
          if (v > 0 && v < 1) ring(ctx, src[0], src[1], w * (0.03 + 0.55 * easeOut(v)), rgba(c, 0.5 * (1 - v)), 2 - i * 0.4);
        }
        const flash = 0.05 * (1 - clamp01((a - BEAT_LAND.bell) / 0.5));
        if (a > BEAT_LAND.bell && flash > 0) {
          ctx.fillStyle = rgba(c, flash);
          ctx.fillRect(0, 0, w, h);
        }
      }
      // One more soul in the dark, rising from the floor into its drift.
      const x0 = w * lerp(0.1, 0.9, this.r(k * 11));
      const y0 = h * lerp(0.2, 0.68, this.r(k * 11 + 1));
      const p1 = this.r(k * 11 + 2) * TAU;
      const p2 = this.r(k * 11 + 3) * TAU;
      const pos = (tt: number): [number, number] => [
        x0 + w * 0.08 * Math.sin(tt * 0.13 * (1 + k * 0.07) + p1),
        y0 + h * 0.035 * Math.sin(tt * 0.21 + p2),
      ];
      const rise = this.reduced ? 1 : easeInOut((a - 0.9) / 1.3);
      const alpha = this.reduced ? clamp01((a - BEAT_LAND.bell) / 0.4) : clamp01((a - 0.9) / 0.3);
      if (alpha <= 0) continue;
      for (let j = 3; j >= 0; j--) {
        const [px, py] = pos(this.reduced ? 0 : t - j * 0.35);
        const fx = lerp(x0, px, rise);
        const fy = lerp(h * 0.98, py, rise);
        radial(ctx, fx, fy, w * (0.04 - j * 0.007), rgba(c, alpha * (0.36 - j * 0.07)));
      }
    }
  }

  private rootPaths: Path[] = [];
  private rootW = 0;

  private rootPath(k: number, g: Geo): Path {
    if (this.rootW !== g.w) {
      this.rootPaths = [];
      this.rootW = g.w;
    }
    const cached = this.rootPaths[k];
    if (cached) return cached;
    const { w, h } = g;
    const left = k % 2 === 0;
    const x0 = w * (left ? lerp(0.04, 0.34, this.r(k * 13)) : lerp(0.66, 0.96, this.r(k * 13)));
    const climb = h * lerp(0.2, 0.34, this.r(k * 13 + 1));
    const pts: Array<[number, number]> = [[x0, h + 4]];
    const n = 16;
    let x = x0;
    for (let i = 1; i <= n; i++) {
      x += w * 0.022 * (this.r(k * 13 + 2 + i) - 0.5) + (left ? -1 : 1) * w * 0.003;
      pts.push([x, h + 4 - (climb * i) / n]);
    }
    const path = { pts, side: left ? -1 : 1 };
    this.rootPaths[k] = path;
    return path;
  }

  private drawRoots(ctx: CanvasRenderingContext2D, g: Geo, now: number): void {
    const { w } = g;
    const t = now / 1000;
    const c = this.boss.interlude.rgb;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let k = 0; k < this.marks; k++) {
      const a = this.age(k, now);
      const grow = this.reduced ? 1 : easeOut((a - 0.2) / (BEAT_LAND.roots - 0.2));
      const fade = this.reduced ? clamp01((a - 0.2) / 0.5) : 1;
      if (grow <= 0 || fade <= 0) continue;
      const { pts, side } = this.rootPath(k, g);
      const last = Math.max(1, Math.floor(grow * (pts.length - 1)));
      const pulse = this.reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 0.7 + k * 1.9);
      const stroke = (from: number, to: number, x0: number, scale: number) => {
        for (let i = from + 1; i <= to; i++) {
          const f = i / (pts.length - 1);
          ctx.lineWidth = w * lerp(0.009, 0.0025, f) * scale;
          ctx.strokeStyle = rgba(c, 0.5 * pulse * fade);
          ctx.beginPath();
          ctx.moveTo(pts[i - 1][0] + x0 * (i - 1 - from), pts[i - 1][1]);
          ctx.lineTo(pts[i][0] + x0 * (i - from), pts[i][1]);
          ctx.stroke();
        }
      };
      stroke(0, last, 0, 1);
      // A side shoot from a third of the way up.
      const b0 = Math.floor(pts.length / 3);
      if (last > b0 + 1) stroke(b0, Math.min(last, b0 + 7), side * w * 0.012, 0.7);
      if (!this.reduced && a > BEAT_LAND.roots && a < BEAT_LAND.roots + 0.8) {
        const v = (a - BEAT_LAND.roots) / 0.8;
        const [tx, ty] = pts[pts.length - 1];
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * TAU + k;
          radial(ctx, tx + Math.cos(ang) * w * 0.05 * v, ty + Math.sin(ang) * w * 0.03 * v - w * 0.02 * v, w * 0.012, rgba(c, 0.45 * (1 - v)));
        }
      }
    }
    ctx.restore();
  }

  private drawSnuff(ctx: CanvasRenderingContext2D, g: Geo, now: number, anchor: Anchor): void {
    if (this.marks === 0) return;
    const { w } = g;
    const k = this.marks - 1;
    const a = this.age(k, now);
    if (a > BEAT_SECONDS || this.reduced) return;
    const [x, y] = this.from(anchor, g, 0.5, 0.12, k);
    const c = this.boss.interlude.rgb;
    if (a < BEAT_LAND.dark) {
      // A cold flame, the last one, gutters and goes out.
      const life = clamp01(a / 0.25) * (1 - easeInOut((a - 0.5) / (BEAT_LAND.dark - 0.5)) * 0.85);
      const flick = 1 + 0.25 * Math.sin(a * 37) * clamp01((a - 0.5) * 3);
      radial(ctx, x, y - w * 0.015, w * 0.09 * life, rgba(c, 0.45 * life));
      flame(ctx, x, y, w * 0.045 * life * flick, w * 0.011 * life, life, [200, 220, 255]);
      return;
    }
    // Smoke curls up from where it was.
    const v = (a - BEAT_LAND.dark) / (BEAT_SECONDS - BEAT_LAND.dark);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(190,195,210,${0.5 * (1 - v)})`;
    ctx.lineWidth = w * 0.005;
    ctx.beginPath();
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const sy = y - f * w * 0.25 * (0.3 + v);
      const sx = x + Math.sin(f * 7 + a * 3) * w * 0.02 * f;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Vesper: a lavender hush sweeps down the screen before the star appears. */
  private drawDuskSweep(ctx: CanvasRenderingContext2D, g: Geo, now: number): void {
    if (this.marks === 0 || this.reduced) return;
    const a = this.age(this.marks - 1, now);
    if (a < 0.1 || a > 1.4) return;
    const v = (a - 0.1) / 1.3;
    const y = g.h * lerp(-0.1, 1.05, easeInOut(v));
    const band = g.h * 0.16;
    const grad = ctx.createLinearGradient(0, y - band, 0, y + band);
    const c = this.boss.interlude.rgb;
    grad.addColorStop(0, rgba(c, 0));
    grad.addColorStop(0.5, rgba(c, 0.09 * Math.sin(v * Math.PI)));
    grad.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - band, g.w, band * 2);
  }

  private drawPhaseRing(ctx: CanvasRenderingContext2D, g: Geo, now: number, anchor: Anchor): void {
    if (!Number.isFinite(this.phaseAt) || this.reduced) return;
    const v = (now - this.phaseAt) / 1000 - PHASE_PEAK;
    if (v < 0 || v > 1.2) return;
    const [x, y] = this.face(anchor, g);
    const c = this.boss.phaseTwo.eye;
    ring(ctx, x, y, g.w * (0.05 + 0.95 * easeOut(v / 1.2)), rgba(c, 0.6 * (1 - v / 1.2)), 3);
    ring(ctx, x, y, g.w * (0.03 + 0.6 * easeOut(v / 1.0)), rgba(c, 0.35 * (1 - v / 1.2)), 1.5);
  }
}

/* ------------------------------ primitives ------------------------------ */

function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
  if (r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, lw: number): void {
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
  ctx.stroke();
}

/** A four-point star with a soft core. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: string, w: number): void {
  if (s <= 0) return;
  radial(ctx, x, y, s * 2.2, col);
  ctx.fillStyle = col;
  ctx.beginPath();
  const thin = Math.max(0.6, s * 0.14);
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + thin, y - thin);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + thin, y + thin);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - thin, y + thin);
  ctx.lineTo(x - s, y);
  ctx.lineTo(x - thin, y - thin);
  ctx.closePath();
  ctx.fill();
  void w;
}

/** A coin seen edge-on as it spins (`spin` radians), or flat at 0. */
function coin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  spin: number,
  alpha: number,
): void {
  const flat = Math.abs(Math.cos(spin));
  const ex = rx * Math.max(0.12, flat);
  const ey = spin === 0 ? ry : rx * Math.max(0.12, Math.abs(Math.sin(spin))) * 0.55 + ry * 0.5;
  ctx.fillStyle = `rgba(110,68,24,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y + ry * 0.35, ex, ey, 0, 0, TAU);
  ctx.fill();
  const g = ctx.createLinearGradient(x - ex, y - ey, x + ex, y + ey);
  g.addColorStop(0, `rgba(255,222,140,${alpha})`);
  g.addColorStop(0.55, `rgba(212,160,70,${alpha})`);
  g.addColorStop(1, `rgba(140,92,34,${alpha})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, ex, ey, 0, 0, TAU);
  ctx.fill();
}

/** A small teardrop flame, base at (x, y). */
function flame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  r: number,
  alpha: number,
  core: Rgb = [255, 236, 190],
): void {
  if (h <= 0.5) return;
  const g = ctx.createRadialGradient(x, y - h * 0.3, 0, x, y - h * 0.3, h);
  g.addColorStop(0, rgba(core, alpha));
  g.addColorStop(0.45, `rgba(255,170,80,${0.85 * alpha})`);
  g.addColorStop(1, "rgba(200,60,20,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.quadraticCurveTo(x + r * 1.6, y - h * 0.35, x, y);
  ctx.quadraticCurveTo(x - r * 1.6, y - h * 0.35, x, y - h);
  ctx.fill();
}

/** Ashfall omen: slow grey flakes, deterministic in time. */
function drawAsh(ctx: CanvasRenderingContext2D, g: Geo, t: number): void {
  for (let i = 0; i < 18; i++) {
    const s = i * 7.31;
    const period = 11 + (i % 6) * 1.7;
    const u = (t / period + (Math.sin(s) * 0.5 + 0.5)) % 1;
    const x = g.w * ((Math.sin(s * 2.3) * 0.5 + 0.5) + Math.sin(t * 0.5 + i) * 0.03);
    const y = g.h * (-0.05 + u * 1.1);
    ctx.fillStyle = `rgba(170,165,160,${0.35 * Math.sin(u * Math.PI)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.6 + (i % 3), 1 + (i % 2), t + i, 0, TAU);
    ctx.fill();
  }
}
