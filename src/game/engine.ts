import type { GameAudio } from "./audio";
import type { Boss } from "./bosses";
import {
  ANGLE_RAISED_DEG,
  ANGLE_REST_DEG,
  GAP_MS,
  INTRO_MS,
  MISS_WINDOW_MS,
  OUTRO_MS,
  RAISE_MS,
  STRIKES_PER_RUN,
} from "./config";
import { bladePose, generateEncounter, impactOffsetMs, type Strike } from "./generator";
import { computeLayout, Scene, type Layout } from "./scene";
import { makeResult, type StrikeResult } from "./scoring";

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  boss: Boss;
  seed: string;
  /** Index of the first strike to play (resuming a saved run). */
  startIndex: number;
  attempts: number[];
  reducedMotion: boolean;
  audio: GameAudio;
  onStrikeStart: (index: number) => void;
  onResult: (index: number, result: StrikeResult) => void;
  /** A strike was voided (tab hidden). `attempts` is the updated counter list. */
  onVoid: (index: number, attempts: number[]) => void;
  onComplete: () => void;
}

export interface DebugInfo {
  phase: string;
  strike: number;
  attempt: number;
  holdMs: number | null;
  swingMs: number | null;
  feintAtMs: number | null;
  impactAt: number | null;
  toImpact: number | null;
  lastOffset: number | null;
}

type Mode = "intro" | "gap" | "strike" | "outro" | "done";

interface Anim {
  from: number;
  to: number;
  start: number;
  dur: number;
  ease: (t: number) => number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const RAISED = rad(ANGLE_RAISED_DEG);
const REST = rad(ANGLE_REST_DEG);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/**
 * Runs the encounter: schedules strikes against performance.now(), turns taps
 * into results, and draws every frame. All rules come from the pure modules.
 */
export class Engine {
  private ctx: CanvasRenderingContext2D;
  private scene: Scene;
  private layout: Layout = computeLayout(1, 2);
  private raf = 0;
  private destroyed = false;

  private mode: Mode = "intro";
  private startedAt = 0;
  private nextAt = 0;
  private index: number;
  private attempts: number[];

  private strike: Strike | null = null;
  private t0 = 0;
  private impactAt = 0;
  private locked: StrikeResult | null = null;
  private fxDone = false;
  private whooshed = false;
  private feintWhooshed = false;
  private raiseFrom = REST;

  private angle = REST;
  private anim: Anim | null = null;
  private history: Array<[number, number]> = [];
  private lastOffset: number | null = null;

  constructor(private o: EngineOptions) {
    const ctx = o.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.scene = new Scene(o.boss, o.reducedMotion);
    this.index = o.startIndex;
    this.attempts = [...o.attempts];
    this.resize();
  }

  start(): void {
    const now = performance.now();
    this.startedAt = now;
    this.nextAt = now + INTRO_MS;
    this.mode = "intro";
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  resize(): void {
    const { canvas } = this.o;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout = computeLayout(w, h);
  }

  /**
   * Register a tap. `timeStamp` is the event's own timestamp (pointerdown or
   * keydown), which shares a clock with performance.now().
   */
  tap(timeStamp: number): void {
    if (this.mode !== "strike" || !this.strike || this.locked) return;
    const now = performance.now();
    // Guard against browsers that report a different time origin.
    const t = Math.abs(timeStamp - now) < 2000 ? timeStamp : now;
    const offset = t - this.impactAt;
    // Past the window the strike is already a miss; the frame loop records it.
    if (offset > MISS_WINDOW_MS) return;
    this.lastOffset = offset;
    this.locked = makeResult(offset);
    this.o.onResult(this.index, this.locked);
    // Late taps land on a blade that is already on the line: resolve now.
    // Early taps resolve on the impact frame, when the blade arrives.
    if (t >= this.impactAt) this.resolveFx(now);
  }

  debug(): DebugInfo {
    const now = performance.now();
    const s = this.strike;
    let phase: string = this.mode;
    if (this.mode === "strike" && s) phase = bladePose(s, now - this.t0).phase;
    return {
      phase,
      strike: this.index + 1,
      attempt: this.attempts[this.index] ?? 0,
      holdMs: s?.holdMs ?? null,
      swingMs: s?.swingMs ?? null,
      feintAtMs: s?.feint?.atMs ?? null,
      impactAt: s ? this.impactAt : null,
      toImpact: s ? this.impactAt - now : null,
      lastOffset: this.lastOffset,
    };
  }

  private beginStrike(now: number): void {
    const strikes = generateEncounter(this.o.seed, this.o.boss, this.attempts);
    this.strike = strikes[this.index];
    this.t0 = now;
    // The answer is fixed here, before anything moves.
    this.impactAt = now + impactOffsetMs(this.strike);
    this.locked = null;
    this.fxDone = false;
    this.whooshed = false;
    this.feintWhooshed = false;
    this.raiseFrom = this.currentAngle(now);
    this.anim = null;
    this.mode = "strike";
    this.o.onStrikeStart(this.index);
  }

  /** Sparks, sound and blade reaction at the moment steel meets (or fails to). */
  private resolveFx(now: number): void {
    if (this.fxDone) return;
    this.fxDone = true;
    const score = this.locked?.score ?? 0;
    const { audio } = this.o;
    const from = this.angle;
    if (score > 0) {
      if (score >= 95) this.scene.perfect(now, this.layout);
      else this.scene.hit(now, this.layout, score / 100);
      audio.clang(score);
      try {
        navigator.vibrate?.(score >= 95 ? [18, 30, 36] : 14);
      } catch {
        // unsupported
      }
      this.anim = { from, to: REST, start: now, dur: 420, ease: easeOutBack };
    } else {
      this.scene.miss(now);
      audio.thud();
      this.anim = {
        from,
        to: this.layout.impactAngle + rad(24),
        start: now,
        dur: 240,
        ease: easeOutCubic,
      };
    }
    this.strike = null;
    this.index += 1;
    if (this.index >= STRIKES_PER_RUN) {
      this.mode = "outro";
      this.nextAt = now + OUTRO_MS;
    } else {
      this.mode = "gap";
      this.nextAt = now + GAP_MS;
    }
  }

  private currentAngle(now: number): number {
    if (this.mode === "strike" && this.strike) {
      const elapsed = now - this.t0;
      const pose = bladePose(this.strike, elapsed);
      if (pose.phase === "raise") {
        return this.raiseFrom + (RAISED - this.raiseFrom) * pose.raise;
      }
      if (pose.phase === "impact") {
        // Blade bears down on the line until it is answered or breaks through.
        const press = Math.min(1, (now - this.impactAt) / MISS_WINDOW_MS);
        return this.layout.impactAngle + rad(2.5) * press;
      }
      return RAISED + (this.layout.impactAngle - RAISED) * pose.swing;
    }
    if (this.anim) {
      const u = Math.min(1, (now - this.anim.start) / this.anim.dur);
      return this.anim.from + (this.anim.to - this.anim.from) * this.anim.ease(u);
    }
    return this.angle;
  }

  private onVisibility = (): void => {
    const now = performance.now();
    if (document.hidden) {
      if (this.mode === "strike" && this.strike && !this.locked) {
        // Void: bump the attempt so the replay has a fresh, unseen timing.
        this.attempts[this.index] = (this.attempts[this.index] ?? 0) + 1;
        this.strike = null;
        this.anim = { from: this.angle, to: REST, start: now, dur: 300, ease: easeOutCubic };
        this.mode = "gap";
        this.o.onVoid(this.index, [...this.attempts]);
      }
      this.nextAt = Number.POSITIVE_INFINITY;
    } else if (this.mode === "intro" || this.mode === "gap") {
      this.nextAt = now + GAP_MS;
    } else if (this.mode === "outro") {
      this.nextAt = now + 400;
    }
  };

  private frame = (frameTime: number): void => {
    if (this.destroyed) return;
    // rAF timestamps can trail performance.now(); never draw the past.
    const now = Math.max(frameTime, performance.now());

    if ((this.mode === "intro" || this.mode === "gap") && now >= this.nextAt) {
      this.beginStrike(now);
    } else if (this.mode === "outro" && now >= this.nextAt) {
      this.mode = "done";
      this.o.onComplete();
    }

    if (this.mode === "strike" && this.strike) {
      const s = this.strike;
      const holdT = now - this.t0 - RAISE_MS;
      if (s.feint && !this.feintWhooshed && holdT >= s.feint.atMs && holdT < s.holdMs) {
        this.feintWhooshed = true;
        this.o.audio.whoosh(s.feint.durMs * 0.5, 0.45);
      }
      if (!this.whooshed && holdT >= s.holdMs) {
        this.whooshed = true;
        this.o.audio.whoosh(s.swingMs);
      }
      if (now >= this.impactAt && this.locked) {
        this.angle = this.layout.impactAngle;
        this.resolveFx(now);
      } else if (now >= this.impactAt + MISS_WINDOW_MS) {
        this.angle = this.currentAngle(now);
        this.locked = makeResult(null);
        this.o.onResult(this.index, this.locked);
        this.resolveFx(now);
      }
    }

    this.angle = this.currentAngle(now);

    // Motion trail: where the blade was ~70ms ago, only while it is moving down.
    this.history.push([now, this.angle]);
    while (this.history.length > 2 && this.history[1][0] < now - 70) this.history.shift();
    const old = this.history[0][1];
    const trailFrom = this.angle - old > 0.06 ? old : null;

    const inStrike = this.mode === "strike";
    this.scene.draw(this.ctx, this.layout, {
      now,
      angle: this.angle,
      trailFrom,
      presence: Math.min(1, (now - this.startedAt) / (INTRO_MS * 0.8)),
      menace: inStrike ? 1 : 0.3,
    });

    this.raf = requestAnimationFrame(this.frame);
  };
}
