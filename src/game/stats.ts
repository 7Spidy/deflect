import { dayNumber } from "./daily";
import {
  GRADES,
  gradeFor,
  isCountedTap,
  runScore,
  type Grade,
  type StrikeResult,
} from "./scoring";

export interface Stats {
  played: number;
  currentStreak: number;
  bestStreak: number;
  /** Date (YYYY-MM-DD) of the last completed daily run. */
  lastCompleted: string | null;
  grades: Record<Grade, number>;
  /** Lifetime taps inside the scoring window, and their offset sums (ms). */
  tapCount: number;
  absOffsetSum: number;
  signedOffsetSum: number;
  /** Deathblows landed, lifetime. */
  deathblows: number;
}

export function emptyStats(): Stats {
  return {
    played: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastCompleted: null,
    grades: Object.fromEntries(GRADES.map((g) => [g, 0])) as Record<Grade, number>,
    tapCount: 0,
    absOffsetSum: 0,
    signedOffsetSum: 0,
    deathblows: 0,
  };
}

/** Fold one completed daily run into the stats. Idempotent per date. */
export function applyRun(
  stats: Stats,
  date: string,
  results: readonly StrikeResult[],
  deathblowLanded = false,
): Stats {
  if (stats.lastCompleted === date) return stats;
  const consecutive =
    stats.lastCompleted !== null &&
    dayNumber(date) - dayNumber(stats.lastCompleted) === 1;
  const currentStreak = consecutive ? stats.currentStreak + 1 : 1;
  const grade = gradeFor(runScore(results));
  const taps = results.filter(isCountedTap);
  return {
    played: stats.played + 1,
    currentStreak,
    bestStreak: Math.max(stats.bestStreak, currentStreak),
    lastCompleted: date,
    grades: { ...stats.grades, [grade]: stats.grades[grade] + 1 },
    tapCount: stats.tapCount + taps.length,
    absOffsetSum: stats.absOffsetSum + taps.reduce((s, r) => s + Math.abs(r.offset), 0),
    signedOffsetSum: stats.signedOffsetSum + taps.reduce((s, r) => s + r.offset, 0),
    deathblows: (stats.deathblows ?? 0) + (deathblowLanded ? 1 : 0),
  };
}

/** A streak is only alive if the last run was today or yesterday. */
export function liveStreak(stats: Stats, today: string): number {
  if (!stats.lastCompleted) return 0;
  const gap = dayNumber(today) - dayNumber(stats.lastCompleted);
  return gap === 0 || gap === 1 ? stats.currentStreak : 0;
}
