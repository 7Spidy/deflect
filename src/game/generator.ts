import type { Boss } from "./bosses";
import {
  FEINT_DURATION_MS,
  FEINT_FRACTION,
  FEINT_LEAD_MS,
  FEINT_MIN_HOLD_MS,
  FEINT_TAIL_MS,
  MAX_FEINTS_PER_RUN,
  RAISE_MS,
  STRIKES_PER_RUN,
} from "./config";
import { seededRng } from "./prng";

export interface Feint {
  /** Start of the twitch, in ms after the hold begins. */
  atMs: number;
  durMs: number;
}

export interface Strike {
  index: number;
  attempt: number;
  holdMs: number;
  swingMs: number;
  feint: Feint | null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * One strike, derived only from (seed, boss, index, attempt). Bumping the
 * attempt counter re-derives a completely different timing, which is how a
 * voided strike is replayed without giving the player foreknowledge.
 */
export function generateStrike(
  seed: string,
  boss: Boss,
  index: number,
  attempt: number,
  feintAllowed: boolean,
): Strike {
  const rng = seededRng(`${seed}|${boss.id}|${index}|${attempt}`);
  const feintRoll = rng();
  const holdRoll = rng();
  const swingRoll = rng();
  const feintPosRoll = rng();

  const [holdMin, holdMax] = boss.holdMs;
  const [swingMin, swingMax] = boss.swingMs;

  const hasFeint =
    feintAllowed && feintRoll < boss.feintChance && holdMax >= FEINT_MIN_HOLD_MS;
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

  return { index, attempt, holdMs, swingMs, feint };
}

/**
 * The full run. `attempts[i]` is how many times strike i has been voided.
 * Feints are capped at MAX_FEINTS_PER_RUN across the run.
 */
export function generateEncounter(
  seed: string,
  boss: Boss,
  attempts: readonly number[] = [],
): Strike[] {
  const strikes: Strike[] = [];
  let feints = 0;
  for (let i = 0; i < STRIKES_PER_RUN; i++) {
    const strike = generateStrike(
      seed,
      boss,
      i,
      attempts[i] ?? 0,
      feints < MAX_FEINTS_PER_RUN,
    );
    if (strike.feint) feints++;
    strikes.push(strike);
  }
  return strikes;
}

/** Ms from strike start to impact. */
export function impactOffsetMs(strike: Strike): number {
  return RAISE_MS + strike.holdMs + strike.swingMs;
}

export type StrikePhase = "raise" | "hold" | "swing" | "impact";

export interface BladePose {
  phase: StrikePhase;
  /** 0..1 progress of the raise. */
  raise: number;
  /** 0 = fully raised, 1 = blade on the guard line. */
  swing: number;
  feinting: boolean;
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
      };
    }
    return { phase: "hold", raise: 1, swing: 0, feinting: false };
  }
  const swingT = holdT - strike.holdMs;
  if (swingT < strike.swingMs) {
    const u = swingT / strike.swingMs;
    return { phase: "swing", raise: 1, swing: u * u, feinting: false };
  }
  return { phase: "impact", raise: 1, swing: 1, feinting: false };
}
