import { isRoundEnd, MISS_WINDOW_MS, STRIKES_PER_RUN } from "./config";
import type { StrikeResult } from "./scoring";

/**
 * Stagger (posture, as in Sekiro). Good deflects fill the guardian's stagger
 * meter; misses and the breath it catches between rounds drain it. Fill it and
 * the guardian staggers: one Deathblow, a single fixed-rhythm tap, the same for
 * everyone. One Deathblow per run at most. It never changes the run score; it
 * is the run's climax and its own mark on the share.
 *
 * Pure: the meter is a function of the results, so a resumed run rebuilds it
 * exactly, and the engine and the UI can never disagree.
 */

export const STAGGER_MAX = 100;
/** Meter change per strike, by tier (same cut-offs as the fight feedback). */
export const STAGGER_GAIN = { true: 12, clean: 8, glancing: 4, grazed: 0, miss: -12 } as const;
/** Drained after every round's last strike: the guardian catches its breath. */
export const STAGGER_ROUND_RECOVERY = 8;

/**
 * Deathblow rhythm. DEATHBLOW_BEATS heartbeat pulses, DEATHBLOW_BEAT_MS apart;
 * the last one is the mark. Taps in the first DEATHBLOW_DEAF_MS are ignored
 * (a late tap meant for the strike before must not spend the Deathblow).
 */
export const DEATHBLOW_BEATS = 4;
export const DEATHBLOW_BEAT_MS = 420;
export const DEATHBLOW_LEAD_MS = DEATHBLOW_BEATS * DEATHBLOW_BEAT_MS;
export const DEATHBLOW_WINDOW_MS = 60;
export const DEATHBLOW_DEAF_MS = 450;
/** No tap by mark + this: the guardian recovers. */
export const DEATHBLOW_LATE_MS = MISS_WINDOW_MS;

export interface DeathblowResult {
  /** tap - mark in ms (negative = early), or null for no tap. */
  offset: number | null;
  landed: boolean;
}

export function staggerGain(score: number): number {
  if (score >= 95) return STAGGER_GAIN.true;
  if (score >= 75) return STAGGER_GAIN.clean;
  if (score >= 40) return STAGGER_GAIN.glancing;
  if (score > 0) return STAGGER_GAIN.grazed;
  return STAGGER_GAIN.miss;
}

export interface StaggerState {
  value: number;
  /** Index of the strike whose result filled the meter, or null. */
  brokeAt: number | null;
}

export const emptyStagger = (): StaggerState => ({ value: 0, brokeAt: null });

/** Fold strike `index` (with `score`) into the meter. Once broken it stays full. */
export function staggerStep(s: StaggerState, index: number, score: number): StaggerState {
  if (s.brokeAt !== null) return s;
  let value = Math.max(0, Math.min(STAGGER_MAX, s.value + staggerGain(score)));
  if (value >= STAGGER_MAX) return { value: STAGGER_MAX, brokeAt: index };
  if (isRoundEnd(index)) value = Math.max(0, value - STAGGER_ROUND_RECOVERY);
  return { value, brokeAt: null };
}

/** The meter after every result so far. */
export function staggerTrack(results: readonly StrikeResult[]): StaggerState {
  let s = emptyStagger();
  results.forEach((r, i) => {
    s = staggerStep(s, i, r.score);
  });
  return s;
}

/** Highest the meter reached in a run (100 if it broke). */
export function staggerPeak(results: readonly StrikeResult[]): number {
  let s = emptyStagger();
  let peak = 0;
  results.forEach((r, i) => {
    const before = s.value;
    s = staggerStep(s, i, r.score);
    // The peak is before the round's recovery is taken off.
    peak = Math.max(peak, s.value, Math.min(STAGGER_MAX, before + Math.max(0, staggerGain(r.score))));
  });
  return peak;
}

export function judgeDeathblow(offset: number | null): DeathblowResult {
  if (offset === null || !Number.isFinite(offset)) return { offset: null, landed: false };
  const rounded = Math.round(offset * 10) / 10;
  return { offset: rounded, landed: Math.abs(offset) <= DEATHBLOW_WINDOW_MS };
}

/** The Deathblow is owed: the meter broke and it has not been played yet. */
export function deathblowPending(
  results: readonly StrikeResult[],
  deathblow: DeathblowResult | null | undefined,
): boolean {
  return !deathblow && staggerTrack(results).brokeAt !== null;
}

/** A daily run is over when every strike resolved and no Deathblow is owed. */
export function runFinished(
  results: readonly StrikeResult[],
  deathblow: DeathblowResult | null | undefined,
): boolean {
  return results.length >= STRIKES_PER_RUN && !deathblowPending(results, deathblow);
}
