import type { GameAudio } from "./audio";
import type { Boss } from "./bosses";
import {
  ANGLE_RAISED_DEG,
  ANGLE_REST_DEG,
  GAP_MS,
  INTRO_MS,
  isPhaseShift,
  isRoundEnd,
  MIN_CYCLE_MS,
  MISS_WINDOW_MS,
  OUTRO_MS,
  RAISE_MS,
  roundOf,
  STRIKES_PER_RUN,
} from "./config";
import { bladePose, generateEncounter, impactOffsetMs, type Strike } from "./generator";
import { MOVES, planDay, type DayPlan } from "./moves";
import { breakAfter } from "./pacing";
import { computeLayout, Scene, type Layout } from "./scene";
import { makeResult, type StrikeResult } from "./scoring";
import {
  DEATHBLOW_DEAF_MS,
  DEATHBLOW_LATE_MS,
  DEATHBLOW_LEAD_MS,
  judgeDeathblow,
  staggerStep,
  type DeathblowResult,
  type StaggerState,
} from "./stagger";

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  boss: Boss;
  seed: string;
  /** Index of the first strike to play (resuming a saved run). */
  startIndex: number;
  attempts: number[];
  /** Consecutive True deflects already banked before this engine started. */
  priorTrueStreak?: number;
  /** Stagger meter rebuilt from the results already banked (see stagger.ts). */
  stagger: StaggerState;
  /** The Deathblow, if this run already played it. */
  deathblow: DeathblowResult | null;
  reducedMotion: boolean;
  audio: GameAudio;
  onStrikeStart: (index: number) => void;
  onResult: (index: number, result: StrikeResult) => void;
  /** The last strike of a round resolved. */
  onRoundEnd?: (round: number) => void;
  /** A strike was voided (tab hidden, or the player paused). `attempts` is the updated counter list. */
  onVoid: (index: number, attempts: number[]) => void;
  /** The meter moved. `broke` is true on the result that filled it. */
  onStagger?: (state: StaggerState) => void;
  /** The guardian staggered and the Deathblow beats began. */
  onDeathblowStart?: () => void;
  onDeathblow?: (result: DeathblowResult) => void;
  onComplete: () => void;
}

export interface DebugInfo {
  phase: string;
  strike: number;
  attempt: number;
  holdMs: number | null;
  swingMs: number | null;
  feintAtMs: number | null;
  stallAtMs: number | null;
  stallDurMs: number | null;
  impactAt: number | null;
  toImpact: number | null;
  lastOffset: number | null;
}

type Mode = "intro" | "gap" | "strike" | "deathblow" | "outro" | "done";
export type HoldReason = "ui" | "hidden";

interface Seg {
  to: number;
  dur: number;
  ease: (t: number) => number;
}

/** Blade animation after a result: a chain of eased segments. */
interface Anim {
  from: number;
  start: number;
  segs: Seg[];
}

const rad = (d: number) => (d * Math.PI) / 180;
const RAISED = rad(ANGLE_RAISED_DEG);
const REST = rad(ANGLE_REST_DEG);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBackC = (c: number) => (t: number) =>
  1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);

function animAngle(a: Anim, now: number): number {
  let t = now - a.start;
  let from = a.from;
  for (const seg of a.segs) {
    if (t < seg.dur) return from + (seg.to - from) * seg.ease(Math.max(0, t) / seg.dur);
    t -= seg.dur;
    from = seg.to;
  }
  return from;
}

/**
 * Runs the encounter: schedules strikes against performance.now(), turns taps
 * into results, and draws every frame. All rules come from the pure modules.
 */
export class Engine {
  private ctx: CanvasRenderingContext2D;
  private scene: Scene;
  private day: DayPlan;
  private layout: Layout = computeLayout(1, 2);
  private dpr = 1;
  private raf = 0;
  private destroyed = false;

  private mode: Mode = "intro";
  private startedAt = 0;
  private nextAt = 0;
  private index: number;
  private attempts: number[];
  private holds = new Set<HoldReason>();
  private trueStreak: number;
  private stagger: StaggerState;
  /** The meter broke and the Deathblow is owed. */
  private owed: boolean;
  private dbT0 = 0;
  private dbMark = 0;
  private dbTapped: number | null = null;

  private strike: Strike | null = null;
  private t0 = 0;
  private impactAt = 0;
  private locked: StrikeResult | null = null;
  private fxDone = false;
  private whooshed = false;
  private feintWhooshed = false;
  private stallDipped = false;
  private resumeWhooshed = false;
  private stalled = false;
  private raiseFrom = REST;

  private angle = REST;
  private anim: Anim | null = null;
  private history: Array<[number, number]> = [];
  private lastOffset: number | null = null;

  constructor(private o: EngineOptions) {
    const ctx = o.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.day = planDay(o.seed, o.boss);
    this.scene = new Scene(o.boss, o.reducedMotion, o.seed, this.day.omen);
    this.index = o.startIndex;
    // Resuming a saved run: the arena already carries the marks of the rounds behind it.
    this.scene.restore(roundOf(o.startIndex));
    this.attempts = [...o.attempts];
    this.trueStreak = o.priorTrueStreak ?? 0;
    this.stagger = o.stagger;
    this.owed = o.stagger.brokeAt !== null && !o.deathblow;
    this.resize();
  }

  start(): void {
    const now = performance.now();
    this.startedAt = now;
    this.nextAt = now + INTRO_MS;
    this.mode = "intro";
    // The first round's motif, near the end of the reveal.
    if (this.index < STRIKES_PER_RUN) {
      this.o.audio.motif(MOVES[this.day.moves[roundOf(this.index)]], this.o.boss.interlude.kind, INTRO_MS / 1000 - 1.25);
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.scene.destroy();
  }

  resize(): void {
    const { canvas } = this.o;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout = computeLayout(w, h);
  }

  /** True while the player or the page has the fight held. */
  get paused(): boolean {
    return this.holds.size > 0;
  }

  /**
   * Hold the fight. An in-flight strike that has not been tapped is voided
   * (its attempt counter is bumped, so it returns with new timing). A strike
   * that is already locked (tapped, waiting for impact) is not voided.
   */
  pause(reason: HoldReason = "ui"): void {
    const now = performance.now();
    this.holds.add(reason);
    if (this.mode === "strike" && this.strike && !this.locked) {
      // Void: bump the attempt so the replay has a fresh, unseen timing.
      this.attempts[this.index] = (this.attempts[this.index] ?? 0) + 1;
      this.strike = null;
      this.anim = {
        from: this.angle,
        start: now,
        segs: [{ to: REST, dur: 300, ease: easeOutCubic }],
      };
      this.mode = "gap";
      this.stalled = false;
      this.scene.kick("release", now);
      this.o.onVoid(this.index, [...this.attempts]);
    }
    if (this.mode === "deathblow" && this.dbTapped === null) {
      // The Deathblow is a fixed rhythm with nothing to reroll: it simply starts again.
      this.mode = "gap";
      this.scene.deathblowCancel();
      this.scene.kick("release", now);
    }
    this.nextAt = Number.POSITIVE_INFINITY;
  }

  /** Release a hold. The fight restarts once no hold is left. */
  resume(reason: HoldReason = "ui"): void {
    this.holds.delete(reason);
    if (this.holds.size > 0) return;
    const now = performance.now();
    if (this.mode === "intro" || this.mode === "gap") {
      this.nextAt = now + GAP_MS;
    } else if (this.mode === "outro") {
      this.nextAt = now + 400;
    }
  }

  /**
   * Register a tap. `timeStamp` is the event's own timestamp (pointerdown or
   * keydown), which shares a clock with performance.now().
   */
  tap(timeStamp: number): void {
    if (this.paused) return;
    const now = performance.now();
    // Guard against browsers that report a different time origin.
    const t = Math.abs(timeStamp - now) < 2000 ? timeStamp : now;
    if (this.mode === "deathblow") {
      if (this.dbTapped !== null || t - this.dbT0 < DEATHBLOW_DEAF_MS) return;
      if (t - this.dbMark > DEATHBLOW_LATE_MS) return;
      this.dbTapped = t;
      this.scene.tapAck(now, this.layout);
      // Resolve on the mark (or now, if the tap was late), like a strike.
      if (t >= this.dbMark) this.resolveDeathblow(now);
      return;
    }
    if (this.mode !== "strike" || !this.strike || this.locked) return;
    const offset = t - this.impactAt;
    // Past the window the strike is already a miss; the frame loop records it.
    if (offset > MISS_WINDOW_MS) return;
    this.lastOffset = offset;
    this.locked = makeResult(offset);

    // Acknowledge every tap at once, whatever its grade: the guard line
    // answers, and a ghost blade shows where the blade was versus the line.
    this.scene.tapAck(now, this.layout);
    if (this.locked.score < 95) this.scene.ghost(now, this.currentAngle(now));
    if (this.locked.score === 0 && offset < 0) {
      this.scene.whiffEarly(now);
      this.o.audio.whiff();
    }

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
    if (this.mode === "deathblow") phase = `deathblow (mark in ${Math.round(this.dbMark - now)} ms)`;
    if (this.paused) phase = `${phase} (held)`;
    return {
      phase,
      strike: this.index + 1,
      attempt: this.attempts[this.index] ?? 0,
      holdMs: s?.holdMs ?? null,
      swingMs: s?.swingMs ?? null,
      feintAtMs: s?.feint?.atMs ?? null,
      stallAtMs: s?.stall?.atMs ?? null,
      stallDurMs: s?.stall?.durMs ?? null,
      impactAt: s ? this.impactAt : null,
      toImpact: s ? this.impactAt - now : null,
      lastOffset: this.lastOffset,
    };
  }

  private beginStrike(now: number): void {
    const strikes = generateEncounter(this.o.seed, this.o.boss, this.attempts, this.day);
    this.strike = strikes[this.index];
    this.t0 = now;
    // The answer is fixed here, before anything moves. A stall is already in it.
    this.impactAt = now + impactOffsetMs(this.strike);
    this.locked = null;
    this.fxDone = false;
    this.whooshed = false;
    this.feintWhooshed = false;
    this.stallDipped = false;
    this.resumeWhooshed = false;
    this.stalled = false;
    this.raiseFrom = this.currentAngle(now);
    this.anim = null;
    this.mode = "strike";
    this.scene.kick("strikeStart", now);
    this.o.onStrikeStart(this.index);
  }

  /** Sparks, sound and blade reaction at the moment steel meets (or fails to). */
  private resolveFx(now: number): void {
    if (this.fxDone) return;
    this.fxDone = true;
    const result = this.locked;
    const score = result?.score ?? 0;
    const offset = result?.offset ?? null;
    const audio = this.o.audio;
    const from = this.angle;
    const impact = this.layout.impactAngle;
    const rest = (ease: (t: number) => number, dur: number): Seg => ({ to: REST, dur, ease });

    if (score >= 95) {
      this.trueStreak += 1;
      this.scene.perfect(now, this.layout, this.trueStreak);
      this.scene.kick("true", now);
      audio.clang(score);
      this.vibrate([18, 30, 36]);
      this.anim = { from, start: now, segs: [rest(easeOutBackC(1.9), 420)] };
    } else {
      this.trueStreak = 0;
      if (score >= 75) {
        this.scene.clean(now, this.layout);
        this.scene.kick("clean", now);
        audio.clang(score);
        this.vibrate(14);
        this.anim = { from, start: now, segs: [rest(easeOutBackC(1.9 * 0.8), 420)] };
      } else if (score >= 40) {
        this.scene.glancing(now, this.layout);
        this.scene.kick("glancing", now);
        audio.scrape();
        // Slides about 4 degrees past the line, then scrapes back.
        this.anim = {
          from,
          start: now,
          segs: [{ to: impact + rad(4), dur: 110, ease: easeOutCubic }, rest(easeOutCubic, 380)],
        };
      } else if (score > 0) {
        this.scene.grazed(now, this.layout);
        this.scene.kick("grazed", now);
        audio.clack();
        // Clips about 8 degrees past the line.
        this.anim = {
          from,
          start: now,
          segs: [{ to: impact + rad(8), dur: 90, ease: easeOutCubic }, rest(easeOutCubic, 420)],
        };
      } else {
        const early = offset !== null && offset < 0;
        if (early) {
          // The tap cut empty air (whiff played at tap time); now the blade lands unopposed.
          this.scene.unopposed(now, this.layout);
          this.scene.kick("late", now);
          audio.thud();
        } else {
          this.scene.bite(now, this.layout);
          this.scene.kick(offset === null ? "unanswered" : "late", now);
          audio.crack();
          audio.thud();
        }
        this.anim = {
          from,
          start: now,
          segs: [{ to: impact + rad(24), dur: 240, ease: easeOutCubic }],
        };
      }
    }

    // Stagger: fold this result into the meter (the same pure step a resume replays).
    const before = this.stagger;
    this.stagger = staggerStep(before, this.index, score);
    if (this.stagger !== before) this.o.onStagger?.(this.stagger);
    if (before.brokeAt === null && this.stagger.brokeAt !== null) this.owed = true;

    // Next strike: never sooner than the cycle floor, plus a beat between rounds
    // (longer before phase two). This is what guarantees the run length (see pacing.ts).
    const floorAt = this.t0 + MIN_CYCLE_MS;
    this.nextAt = Math.max(now + GAP_MS, floorAt) + breakAfter(this.index);
    if (isRoundEnd(this.index)) {
      const round = roundOf(this.index);
      // The between-round beat. It runs inside the break and is fixed before the
      // next strike exists, so it can say nothing about that strike's timing.
      if (this.index < STRIKES_PER_RUN - 1) {
        const shift = isPhaseShift(round + 1);
        this.scene.interlude(round, now, shift);
        this.o.audio.interlude(this.o.boss.interlude.kind, shift);
        // The next round's motif, after the beat (and after the turn, before phase two).
        this.o.audio.motif(MOVES[this.day.moves[round + 1]], this.o.boss.interlude.kind, shift ? 3.75 : 1.8);
      }
      this.o.onRoundEnd?.(round);
    }

    this.strike = null;
    this.stalled = false;
    this.index += 1;
    if (this.index >= STRIKES_PER_RUN && !this.owed) {
      this.mode = "outro";
      this.nextAt = now + OUTRO_MS;
    } else {
      // A Deathblow owed after the final strike still gets its turn before the outro.
      this.mode = "gap";
    }
    // Resolved while the fight is held (a tapped strike that was already locked):
    // wait for the player to come back.
    if (this.paused) this.nextAt = Number.POSITIVE_INFINITY;
  }

  /** The guardian staggers: heartbeat beats count down to the mark. */
  private beginDeathblow(now: number): void {
    this.mode = "deathblow";
    this.dbT0 = now;
    this.dbMark = now + DEATHBLOW_LEAD_MS;
    this.dbTapped = null;
    this.anim = { from: this.angle, start: now, segs: [{ to: REST + rad(10), dur: 420, ease: easeOutCubic }] };
    this.scene.deathblowStart(now);
    this.scene.kick("stagger", now);
    this.o.audio.heartbeats(DEATHBLOW_LEAD_MS / 1000);
    this.o.onDeathblowStart?.();
  }

  private resolveDeathblow(now: number): void {
    if (this.mode !== "deathblow") return;
    const result = judgeDeathblow(this.dbTapped === null ? null : this.dbTapped - this.dbMark);
    this.owed = false;
    if (result.landed) {
      this.scene.deathblowLanded(now, this.layout);
      this.scene.kick("deathblow", now);
      this.o.audio.deathblow(true);
      this.vibrate([30, 40, 80]);
    } else {
      this.scene.deathblowFailed(now, this.layout);
      this.scene.kick("late", now);
      this.o.audio.deathblow(false);
    }
    this.anim = { from: this.angle, start: now, segs: [{ to: REST, dur: 500, ease: easeOutCubic }] };
    this.o.onDeathblow?.(result);
    if (this.index >= STRIKES_PER_RUN) {
      this.mode = "outro";
      this.nextAt = now + OUTRO_MS + 600;
    } else {
      this.mode = "gap";
      // A longer beat after the climax, then the fight goes on.
      this.nextAt = now + GAP_MS + 900;
    }
    if (this.paused) this.nextAt = Number.POSITIVE_INFINITY;
  }

  private vibrate(pattern: number | number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // unsupported
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
    if (this.anim) return animAngle(this.anim, now);
    return this.angle;
  }

  private onVisibility = (): void => {
    if (document.hidden) this.pause("hidden");
    else this.resume("hidden");
  };

  private frame = (frameTime: number): void => {
    if (this.destroyed) return;
    // rAF timestamps can trail performance.now(); never draw the past.
    const now = Math.max(frameTime, performance.now());

    if ((this.mode === "intro" || this.mode === "gap") && now >= this.nextAt) {
      if (this.owed) this.beginDeathblow(now);
      else if (this.index < STRIKES_PER_RUN) this.beginStrike(now);
      else {
        this.mode = "outro";
        this.nextAt = now + OUTRO_MS;
      }
    } else if (this.mode === "outro" && now >= this.nextAt) {
      this.mode = "done";
      this.o.onComplete();
    }

    if (this.mode === "strike" && this.strike) {
      const s = this.strike;
      const holdT = now - this.t0 - RAISE_MS;
      const swingT = holdT - s.holdMs;
      if (s.feint && !this.feintWhooshed && holdT >= s.feint.atMs && holdT < s.holdMs) {
        this.feintWhooshed = true;
        this.o.audio.whoosh(s.feint.durMs * 0.5, 0.45);
      }
      if (!this.whooshed && holdT >= s.holdMs) {
        this.whooshed = true;
        // With a stall the first whoosh only covers the travel before the hang.
        this.o.audio.whoosh(s.stall ? s.stall.atMs : s.swingMs, s.stall ? 0.7 : 1);
      }
      if (s.stall) {
        const pose = bladePose(s, now - this.t0);
        this.stalled = pose.stalled;
        // Audio only: muffle the drone while the blade hangs.
        if (pose.stalled && !this.stallDipped) {
          this.stallDipped = true;
          this.o.audio.dip(s.stall.durMs);
        }
        if (!this.resumeWhooshed && swingT >= s.stall.atMs + s.stall.durMs) {
          this.resumeWhooshed = true;
          this.o.audio.whoosh(s.swingMs - s.stall.atMs, 1.1);
        }
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

    if (this.mode === "deathblow") {
      if (this.dbTapped !== null && now >= this.dbMark) this.resolveDeathblow(now);
      else if (now >= this.dbMark + DEATHBLOW_LATE_MS) this.resolveDeathblow(now);
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
      stalled: this.stalled && inStrike,
      deathblow: this.mode === "deathblow" ? { t0: this.dbT0, mark: this.dbMark } : null,
      pixelRatio: this.dpr,
    });

    this.raf = requestAnimationFrame(this.frame);
  };
}
