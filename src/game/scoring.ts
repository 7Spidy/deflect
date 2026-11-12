import { MISS_WINDOW_MS, PERFECT_WINDOW_MS } from "./config";

export interface StrikeResult {
  /** tapTime - impactTime in ms (negative = early). null = no tap at all. */
  offset: number | null;
  /** 0..100, integer. */
  score: number;
}

export type Grade = "S" | "A" | "B" | "C" | "D" | "F";
export const GRADES: readonly Grade[] = ["S", "A", "B", "C", "D", "F"];

/** 100 inside the perfect window, linear down to 0 at the miss window. */
export function scoreOffset(offset: number | null): number {
  if (offset === null || !Number.isFinite(offset)) return 0;
  const abs = Math.abs(offset);
  if (abs <= PERFECT_WINDOW_MS) return 100;
  if (abs >= MISS_WINDOW_MS) return 0;
  return Math.round(
    (100 * (MISS_WINDOW_MS - abs)) / (MISS_WINDOW_MS - PERFECT_WINDOW_MS),
  );
}

export function makeResult(offset: number | null): StrikeResult {
  return {
    offset: offset === null ? null : Math.round(offset * 10) / 10,
    score: scoreOffset(offset),
  };
}

/** Rounded mean of the strike scores. */
export function runScore(results: readonly StrikeResult[]): number {
  if (results.length === 0) return 0;
  return Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
}

export function gradeFor(score: number): Grade {
  if (score >= 95) return "S";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export const GRADE_TITLES: Record<Grade, string> = {
  S: "Blade Unbroken",
  A: "Guard Held",
  B: "Steel Answered",
  C: "Barely Standing",
  D: "Guard Broken",
  F: "Laid Low",
};

export function strikeEmoji(score: number): string {
  if (score >= 95) return "🟡";
  if (score >= 75) return "🟢";
  if (score >= 40) return "🟠";
  return "⚫";
}

export interface Bias {
  /** Taps that landed inside the scoring window. */
  count: number;
  /** Mean absolute offset in ms. */
  meanAbs: number;
  /** Mean signed offset in ms (negative = early). */
  meanSigned: number;
}

/** Only taps inside the +/-300ms window count, so one wild tap cannot skew it. */
export function isCountedTap(r: StrikeResult): r is StrikeResult & { offset: number } {
  return r.offset !== null && Math.abs(r.offset) <= MISS_WINDOW_MS;
}

export function biasOf(results: readonly StrikeResult[]): Bias {
  const taps = results.filter(isCountedTap);
  if (taps.length === 0) return { count: 0, meanAbs: 0, meanSigned: 0 };
  const signed = taps.reduce((s, r) => s + r.offset, 0) / taps.length;
  const abs = taps.reduce((s, r) => s + Math.abs(r.offset), 0) / taps.length;
  return { count: taps.length, meanAbs: abs, meanSigned: signed };
}

/** Below this many ms of lean we call it even. */
export const LEAN_THRESHOLD_MS = 3;

export function leanOf(meanSigned: number): "early" | "late" | "even" {
  if (meanSigned <= -LEAN_THRESHOLD_MS) return "early";
  if (meanSigned >= LEAN_THRESHOLD_MS) return "late";
  return "even";
}

export function biasSentence(bias: Bias): string {
  if (bias.count === 0) return "No blade met yours.";
  const lean = leanOf(bias.meanSigned);
  if (lean === "even") return "Your timing shows no lean, early or late.";
  return `You swing ${Math.round(Math.abs(bias.meanSigned))}ms ${lean} on average`;
}
