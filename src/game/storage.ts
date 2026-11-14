import { STRIKES_PER_RUN } from "./config";
import type { StrikeResult } from "./scoring";
import { runFinished, type DeathblowResult } from "./stagger";
import { emptyStats, type Stats } from "./stats";

const PREFIX = "deflect:v1:";
/**
 * Daily records are v2 (a run is 30 strikes now, 5 before). Stats stay on v1 so
 * streaks survive. Old v1 daily records are dropped by pruneDaily.
 */
const DAILY_PREFIX = "deflect:v2:daily:";
const LEGACY_DAILY_PREFIX = `${PREFIX}daily:`;
const STATS_KEY = `${PREFIX}stats`;
const HOWTO_KEY = `${PREFIX}seenHowTo`;
const MUTED_KEY = `${PREFIX}muted`;

export interface DailyRecord {
  date: string;
  results: StrikeResult[];
  /** Void counter per strike, feeds the re-derived timing. */
  attempts: number[];
  /** Strike that had begun but not resolved when we last saved. */
  inProgress: number | null;
  /** The Deathblow, once played (absent in records from before stagger existed). */
  deathblow?: DeathblowResult | null;
  /** Every strike resolved and no Deathblow is owed (see stagger.ts runFinished). */
  done: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the game still plays, it just will not persist.
  }
}

export function emptyDaily(date: string): DailyRecord {
  return {
    date,
    results: [],
    attempts: new Array<number>(STRIKES_PER_RUN).fill(0),
    inProgress: null,
    deathblow: null,
    done: false,
  };
}

/**
 * Load today's record. A strike that was in flight when the page went away
 * counts as voided: its attempt counter is bumped so it replays with a new
 * timing instead of the one the player already saw.
 */
export function loadDaily(date: string): DailyRecord {
  const rec = read<DailyRecord>(DAILY_PREFIX + date);
  if (!rec || rec.date !== date || !Array.isArray(rec.results)) {
    return emptyDaily(date);
  }
  const attempts = emptyDaily(date).attempts.map((_, i) => rec.attempts?.[i] ?? 0);
  const results = rec.results.slice(0, STRIKES_PER_RUN);
  let inProgress = rec.inProgress ?? null;
  if (inProgress !== null && inProgress >= results.length && inProgress < STRIKES_PER_RUN) {
    attempts[inProgress] += 1;
  }
  inProgress = null;
  const deathblow = rec.deathblow ?? null;
  const fixed: DailyRecord = {
    date,
    results,
    attempts,
    inProgress,
    deathblow,
    // A record finished before stagger existed keeps its finished state.
    done: rec.done === true && results.length >= STRIKES_PER_RUN ? true : runFinished(results, deathblow),
  };
  write(DAILY_PREFIX + date, fixed);
  return fixed;
}

export function saveDaily(rec: DailyRecord): void {
  write(DAILY_PREFIX + rec.date, rec);
}

/** Drop records for other days, and every legacy v1 daily record. */
export function pruneDaily(keepDate: string): void {
  try {
    const ls = window.localStorage;
    const stale: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k) continue;
      if (k.startsWith(LEGACY_DAILY_PREFIX)) stale.push(k);
      else if (k.startsWith(DAILY_PREFIX) && k !== DAILY_PREFIX + keepDate) stale.push(k);
    }
    stale.forEach((k) => ls.removeItem(k));
  } catch {
    // ignore
  }
}

export function loadStats(): Stats {
  return { ...emptyStats(), ...(read<Partial<Stats>>(STATS_KEY) ?? {}) };
}

export function saveStats(stats: Stats): void {
  write(STATS_KEY, stats);
}

export const hasSeenHowTo = () => read<boolean>(HOWTO_KEY) === true;
export const markHowToSeen = () => write(HOWTO_KEY, true);
export const loadMuted = () => read<boolean>(MUTED_KEY) === true;
export const saveMuted = (muted: boolean) => write(MUTED_KEY, muted);

/** Debug only: forget a day's run so it can be replayed while tuning. */
export function clearDaily(date: string): void {
  try {
    window.localStorage.removeItem(DAILY_PREFIX + date);
  } catch {
    // ignore
  }
}
