import { bossForWeekday, type Boss } from "./bosses";
import { LAUNCH_DATE } from "./config";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Player's local calendar date as YYYY-MM-DD. */
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isValidDateString(s: string | null | undefined): s is string {
  if (!s) return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const back = new Date(t);
  return back.getUTCMonth() === +m[2] - 1 && back.getUTCDate() === +m[3];
}

/** Whole days since the Unix epoch for a calendar date (timezone free). */
export function dayNumber(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Bad date: ${date}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
}

/** Puzzle #1 is LAUNCH_DATE. */
export function puzzleNumber(date: string, launch: string = LAUNCH_DATE): number {
  return dayNumber(date) - dayNumber(launch) + 1;
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: string): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function bossForDate(date: string): Boss {
  return bossForWeekday(weekdayOf(date));
}

/** The daily seed string. Same date, same encounter, for everyone. */
export function dailySeed(date: string): string {
  return `deflect:${date}`;
}

export function msUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
