import type { Boss } from "./bosses";
import {
  FEINT_DURATION_MS,
  FEINT_FRACTION,
  FEINT_LEAD_MS,
  FEINT_MIN_HOLD_MS,
  FEINT_TAIL_MS,
  RAISE_MS,
  ROUNDS_PER_RUN,
  STALL_AT_FRACTION,
  STALL_DURATION_MS,
  STRIKES_PER_ROUND,
  STRIKES_PER_RUN,
  WARMUP_ROUNDS,
} from "./config";
import { seededRng } from "./prng";

export interface Feint {
  /** Start of the twitch, in ms after the hold begins. */
  atMs: number;
  durMs: number;
}

/** A delayed swing: the blade hangs mid-travel, then snaps through. */
export interface Stall {
  /** Moving time into the swing at which the blade hangs. */
  atMs: number;
  durMs: number;
}

export interface Strike {
  index: number;
  attempt: number;
  holdMs: number;
  swingMs: number;
  feint: Feint | null;
  stall: Stall | null;
}

export type Deception = "feint" | "stall" | null;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Which strikes of the run carry a feint or a stall. Decided per round, so
 * deception is spread across the whole run (a run-wide cap would be spent in
 * the first few strikes). Depends on (seed, boss) only, never on attempts.
 * Accepted minor leak: a voided strike keeps its deception kind but gets new
 * timing. At most one deceptive strike per round (MAX_DECEPTIVE_PER_ROUND),
 * none in warm-up rounds.
 */
export function planDeception(seed: string, boss: Boss): Deception[] {
  const plan: Deception[] = new Array<Deception>(STRIKES_PER_RUN).fill(null);
  for (let r = WARMUP_ROUNDS; r < ROUNDS_PER_RUN; r++) {
    const rng = seededRng(`${seed}|${boss.id}|plan|${r}`);
    const feintHit = rng() < boss.feintRoundChance;
    const stallHit = rng() < boss.stallRoundChance;
    const slotRoll = rng();
    const kindRoll = rng();
    let kind: Deception = null;
    if (feintHit && stallHit) kind = kindRoll < 0.5 ? "feint" : "stall";
    else if (feintHit) kind = "feint";
    else if (stallHit) kind = "stall";
    // A feint needs room inside the hold; otherwise it becomes a stall (or nothing).
    if (kind === "feint" && boss.holdMs[1] < FEINT_MIN_HOLD_MS) {
      kind = stallHit ? "stall" : null;
    }
    if (kind) {
      plan[r * STRIKES_PER_ROUND + Math.floor(slotRoll * STRIKES_PER_ROUND)] = kind;
    }
  }
  return plan;
}

/**
 * One strike, derived only from (seed, boss, index, attempt, kind). Bumping
 * the attempt counter re-derives a completely different timing, which is how
 * a voided strike is replayed without giving the player foreknowledge.
 */
export function generateStrike(
  seed: string,
  boss: Boss,
  index: number,
  attempt: number,
  kind: Deception,
): Strike {
  const rng = seededRng(`${seed}|${boss.id}|${index}|${attempt}`);
  // The first roll used to decide feints; the plan does that now. It is still
  // drawn so every other roll keeps its place in the sequence.
  rng();
  const holdRoll = rng();
  const swingRoll = rng();
  const feintPosRoll = rng();
  const atRoll = rng();
  const durRoll = rng();

  const [holdMin, holdMax] = boss.holdMs;
  const [swingMin, swingMax] = boss.swingMs;

  const hasFeint = kind === "feint" && holdMax >= FEINT_MIN_HOLD_MS;
  // A feint needs room inside the hold, so feint strikes draw from the upper
  // part of the boss's hold range. Still always within [holdMin, holdMax].
  const lo = hasFeint ? Math.max(holdMin, FEINT_MIN_HOLD_MS) : holdMin;
  const holdMs = Math.round(lerp(lo, holdMax, holdRoll));
  const swingMs = Math.round(lerp(swingMin, swingMax, swingRoll));

  const feint: Feint | null = hasFeint
    ? {
        atMs: Math.round(
          lerp(
            FEINT_LEAD_MS,
            holdMs - FEINT_DURATION_MS - FEINT_TAIL_MS,
            feintPosRoll,
          ),
        ),
        durMs: FEINT_DURATION_MS,
      }
    : null;

  const stall: Stall | null =
    kind === "stall"
      ? {
          atMs: Math.round(lerp(STALL_AT_FRACTION[0], STALL_AT_FRACTION[1], atRoll) * swingMs),
          durMs: Math.round(lerp(STALL_DURATION_MS[0], STALL_DURATION_MS[1], durRoll)),
        }
      : null;

  return { index, attempt, holdMs, swingMs, feint, stall };
}

/**
 * The full run. `attempts[i]` is how many times strike i has been voided.
 * Deception comes from planDeception, one decision per round.
 */
export function generateEncounter(
  seed: string,
  boss: Boss,
  attempts: readonly number[] = [],
): Strike[] {
  const plan = planDeception(seed, boss);
  const strikes: Strike[] = [];
  for (let i = 0; i < STRIKES_PER_RUN; i++) {
    strikes.push(generateStrike(seed, boss, i, attempts[i] ?? 0, plan[i]));
  }
  return strikes;
}

/** Ms from strike start to impact. Fixed at strike start, stall included. */
export function impactOffsetMs(strike: Strike): number {
  return RAISE_MS + strike.holdMs + strike.swingMs + (strike.stall?.durMs ?? 0);
}

export type StrikePhase = "raise" | "hold" | "swing" | "impact";

export interface BladePose {
  phase: StrikePhase;
  /** 0..1 progress of the raise. */
  raise: number;
  /** 0 = fully raised, 1 = blade on the guard line. */
  swing: number;
  feinting: boolean;
  /** The blade is hanging mid-swing (a stall). */
  stalled: boolean;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Feint twitch: fast out, snap back. Peaks at 1. */
function feintBump(v: number): number {
  const peak = 0.45;
  if (v < peak) return easeOutCubic(v / peak);
  const back = (v - peak) / (1 - peak);
  return 1 - back * back;
}

/**
 * Where the blade is `elapsed` ms after the strike began. Pure, so the
 * renderer and the debug overlay always agree with the timing rules.
 */
export function bladePose(strike: Strike, elapsed: number): BladePose {
  if (elapsed < RAISE_MS) {
    return {
      phase: "raise",
      raise: easeOutCubic(Math.max(0, elapsed) / RAISE_MS),
      swing: 0,
      feinting: false,
      stalled: false,
    };
  }
  const holdT = elapsed - RAISE_MS;
  if (holdT < strike.holdMs) {
    const f = strike.feint;
    if (f && holdT >= f.atMs && holdT < f.atMs + f.durMs) {
      return {
        phase: "hold",
        raise: 1,
        swing: FEINT_FRACTION * feintBump((holdT - f.atMs) / f.durMs),
        feinting: true,
        stalled: false,
      };
    }
    return { phase: "hold", raise: 1, swing: 0, feinting: false, stalled: false };
  }
  const swingT = holdT - strike.holdMs;
  const st = strike.stall;
  if (swingT < strike.swingMs + (st?.durMs ?? 0)) {
    let moving = swingT;
    let stalled = false;
    if (st) {
      if (swingT < st.atMs) {
        moving = swingT;
      } else if (swingT < st.atMs + st.durMs) {
        moving = st.atMs;
        stalled = true;
      } else {
        moving = swingT - st.durMs;
      }
    }
    const u = moving / strike.swingMs;
    return { phase: "swing", raise: 1, swing: u * u, feinting: false, stalled };
  }
  return { phase: "impact", raise: 1, swing: 1, feinting: false, stalled: false };
}
