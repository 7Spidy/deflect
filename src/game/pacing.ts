import type { Boss } from "./bosses";
import {
  GAP_MS,
  HAS_PHASE_TWO,
  INTRO_MS,
  isPhaseShift,
  isRoundEnd,
  MIN_CYCLE_MS,
  OUTRO_MS,
  PHASE_SHIFT_MS,
  RAISE_MS,
  ROUND_BREAK_MS,
  roundOf,
  ROUNDS_PER_RUN,
  STRIKES_PER_RUN,
} from "./config";
import { generateEncounter, impactOffsetMs } from "./generator";

/**
 * The shortest a run can possibly be, whatever the boss rolls. Every strike
 * except the last takes at least MIN_CYCLE_MS from its start to the next
 * strike's start. The last strike has no next strike: the outro starts the
 * moment it resolves, which is never earlier than its raise (RAISE_MS).
 */
export const PACING_FLOOR_MS =
  INTRO_MS +
  (STRIKES_PER_RUN - 1) * MIN_CYCLE_MS +
  (ROUNDS_PER_RUN - 1) * ROUND_BREAK_MS +
  (HAS_PHASE_TWO ? PHASE_SHIFT_MS : 0) +
  RAISE_MS +
  OUTRO_MS;

/** Extra wait after strike i before the next one: round break, phase shift. */
export function breakAfter(i: number): number {
  if (!isRoundEnd(i) || i >= STRIKES_PER_RUN - 1) return 0;
  return ROUND_BREAK_MS + (isPhaseShift(roundOf(i) + 1) ? PHASE_SHIFT_MS : 0);
}

/**
 * Wall-clock length of a run in which every tap lands exactly on impact. It
 * mirrors Engine.resolveFx step for step, so a stopwatch run matches it to
 * within a frame or two per strike. Real runs are never shorter: a late tap or
 * a miss resolves after impact, which only lengthens the gap.
 */
export function simulateRunMs(seed: string, boss: Boss): number {
  const strikes = generateEncounter(seed, boss);
  let t = INTRO_MS;
  strikes.forEach((s, i) => {
    if (i === strikes.length - 1) {
      // Final strike: the outro begins at impact, with no cycle floor.
      t += impactOffsetMs(s) + OUTRO_MS;
      return;
    }
    t += Math.max(impactOffsetMs(s) + GAP_MS, MIN_CYCLE_MS);
    t += breakAfter(i);
  });
  return t;
}
