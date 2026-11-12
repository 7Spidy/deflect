import { describe, expect, it } from "vitest";
import { BOSSES, bossForWeekday } from "../bosses";
import {
  FEINT_DURATION_MS,
  FEINT_FRACTION,
  FEINT_TAIL_MS,
  LAUNCH_DATE,
  MAX_FEINTS_PER_RUN,
  RAISE_MS,
  STRIKES_PER_RUN,
} from "../config";
import {
  bossForDate,
  dailySeed,
  dayNumber,
  isValidDateString,
  puzzleNumber,
  toDateString,
  weekdayOf,
} from "../daily";
import { bladePose, generateEncounter, generateStrike, impactOffsetMs } from "../generator";
import { hashString, mulberry32 } from "../prng";
import {
  biasOf,
  biasSentence,
  gradeFor,
  makeResult,
  runScore,
  scoreOffset,
  strikeEmoji,
} from "../scoring";
import { buildShareText } from "../share";
import { applyRun, emptyStats, liveStreak } from "../stats";

describe("prng", () => {
  it("mulberry32 is deterministic for a seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, a);
    const seqB = Array.from({ length: 20 }, b);
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("different seeds diverge", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    expect(hashString("2026-11-10")).not.toBe(hashString("2026-11-11"));
  });

  it("same date gives the same encounter, different dates differ", () => {
    const date = "2026-11-13";
    const boss = bossForDate(date);
    const one = generateEncounter(dailySeed(date), boss);
    const two = generateEncounter(dailySeed(date), boss);
    expect(one).toEqual(two);
    const other = generateEncounter(dailySeed("2026-11-20"), boss);
    expect(other).not.toEqual(one);
  });
});

describe("daily", () => {
  it("numbers puzzles from the launch date", () => {
    expect(puzzleNumber(LAUNCH_DATE)).toBe(1);
    expect(puzzleNumber("2026-01-12", "2026-01-01")).toBe(12);
  });

  it("formats and validates local dates", () => {
    expect(toDateString(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-2-3")).toBe(false);
    expect(isValidDateString("2026-12-31")).toBe(true);
    expect(dayNumber("1970-01-02")).toBe(1);
  });

  it("picks the boss by weekday", () => {
    expect(weekdayOf("2026-11-09")).toBe(1); // Monday
    expect(bossForDate("2026-11-09").name).toBe("The Toll Keeper");
    expect(bossForDate("2026-11-10").name).toBe("Thornbound Knight");
    expect(bossForDate("2026-11-15").name).toBe("The Unlit King");
    for (let d = 0; d < 7; d++) expect(bossForWeekday(d).weekday).toBe(d);
  });
});

describe("strike generator", () => {
  const seeds = Array.from({ length: 300 }, (_, i) => `seed-${i}`);

  it("keeps hold and swing inside each boss's ranges", () => {
    for (const boss of BOSSES) {
      for (const seed of seeds) {
        const strikes = generateEncounter(seed, boss);
        expect(strikes).toHaveLength(STRIKES_PER_RUN);
        for (const s of strikes) {
          expect(s.holdMs).toBeGreaterThanOrEqual(boss.holdMs[0]);
          expect(s.holdMs).toBeLessThanOrEqual(boss.holdMs[1]);
          expect(s.swingMs).toBeGreaterThanOrEqual(boss.swingMs[0]);
          expect(s.swingMs).toBeLessThanOrEqual(boss.swingMs[1]);
        }
      }
    }
  });

  it("never exceeds the feint cap, and feints fit inside the hold", () => {
    let total = 0;
    for (const boss of BOSSES) {
      for (const seed of seeds) {
        const strikes = generateEncounter(seed, boss, [0, 3, 1, 0, 7]);
        const feints = strikes.filter((s) => s.feint);
        total += feints.length;
        expect(feints.length).toBeLessThanOrEqual(MAX_FEINTS_PER_RUN);
        if (boss.feintChance === 0) expect(feints).toHaveLength(0);
        for (const s of feints) {
          expect(s.feint!.atMs).toBeGreaterThan(0);
          expect(s.feint!.atMs + FEINT_DURATION_MS + FEINT_TAIL_MS).toBeLessThanOrEqual(
            s.holdMs,
          );
        }
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it("re-derives a different timing when the attempt counter changes", () => {
    const boss = bossForWeekday(3);
    const first = generateStrike("s", boss, 2, 0, true);
    const again = generateStrike("s", boss, 2, 0, true);
    const retry = generateStrike("s", boss, 2, 1, true);
    expect(again).toEqual(first);
    expect([retry.holdMs, retry.swingMs]).not.toEqual([first.holdMs, first.swingMs]);
  });

  it("blade pose follows raise, hold, feint, swing, impact", () => {
    const strike = {
      index: 0,
      attempt: 0,
      holdMs: 1000,
      swingMs: 300,
      feint: { atMs: 200, durMs: FEINT_DURATION_MS },
    };
    expect(impactOffsetMs(strike)).toBe(RAISE_MS + 1300);
    expect(bladePose(strike, 0).phase).toBe("raise");
    expect(bladePose(strike, RAISE_MS + 100)).toMatchObject({ phase: "hold", swing: 0 });
    let peak = 0;
    for (let t = 200; t < 200 + FEINT_DURATION_MS; t += 2) {
      const p = bladePose(strike, RAISE_MS + t);
      expect(p.feinting).toBe(true);
      peak = Math.max(peak, p.swing);
    }
    expect(peak).toBeGreaterThan(FEINT_FRACTION * 0.9);
    expect(peak).toBeLessThanOrEqual(FEINT_FRACTION);
    expect(bladePose(strike, RAISE_MS + 200 + FEINT_DURATION_MS).swing).toBe(0);
    const mid = bladePose(strike, RAISE_MS + 1000 + 150);
    expect(mid.phase).toBe("swing");
    expect(mid.swing).toBeGreaterThan(0);
    expect(mid.swing).toBeLessThan(1);
    expect(bladePose(strike, RAISE_MS + 1300)).toMatchObject({ phase: "impact", swing: 1 });
  });
});

describe("scoring", () => {
  it("scores the 33ms and 300ms boundaries", () => {
    expect(scoreOffset(0)).toBe(100);
    expect(scoreOffset(33)).toBe(100);
    expect(scoreOffset(-33)).toBe(100);
    expect(scoreOffset(35)).toBe(99);
    expect(scoreOffset(-35)).toBe(99);
    expect(scoreOffset(166.5)).toBe(50);
    expect(scoreOffset(-166.5)).toBe(50);
    expect(scoreOffset(300)).toBe(0);
    expect(scoreOffset(-300)).toBe(0);
    expect(scoreOffset(900)).toBe(0);
  });

  it("is monotonic away from zero", () => {
    let prev = 100;
    for (let o = 0; o <= 320; o++) {
      const s = scoreOffset(o);
      expect(s).toBeLessThanOrEqual(prev);
      expect(scoreOffset(-o)).toBe(s);
      prev = s;
    }
  });

  it("treats no tap as a miss", () => {
    expect(scoreOffset(null)).toBe(0);
    expect(makeResult(null)).toEqual({ offset: null, score: 0 });
  });

  it("averages five strikes into a rounded run score", () => {
    const r = [100, 90, 80, 71, 0].map((score) => ({ offset: 0, score }));
    expect(runScore(r)).toBe(68);
    expect(runScore([])).toBe(0);
  });

  it("maps grade thresholds", () => {
    const cases: Array<[number, string]> = [
      [100, "S"], [95, "S"], [94, "A"], [85, "A"], [84, "B"], [70, "B"],
      [69, "C"], [55, "C"], [54, "D"], [40, "D"], [39, "F"], [0, "F"],
    ];
    for (const [score, grade] of cases) expect(gradeFor(score)).toBe(grade);
  });

  it("maps emoji thresholds", () => {
    expect([95, 94, 75, 74, 40, 39].map(strikeEmoji)).toEqual([
      "🟡", "🟢", "🟢", "🟠", "🟠", "⚫",
    ]);
  });

  it("computes bias from taps inside the window only", () => {
    const results = [makeResult(-60), makeResult(-24), makeResult(null), makeResult(-900)];
    const bias = biasOf(results);
    expect(bias.count).toBe(2);
    expect(bias.meanSigned).toBe(-42);
    expect(biasSentence(bias)).toBe("You swing 42ms early on average");
  });
});

describe("share text", () => {
  it("matches the share format with no em dashes", () => {
    const results = [-10, -70, 20, -200, -80].map(makeResult);
    const text = buildShareText(12, results, "https://example.com");
    const lines = text.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Deflect #12 · [SABCDF] \(\d+\)$/);
    expect(lines[1]).toBe("🟡🟢🟡⚫🟢");
    expect(lines[2]).toBe("Avg 76ms off, leaning early");
    expect(lines[3]).toBe("https://example.com");
    expect(text).not.toMatch(/[–—]/);
  });
});

describe("stats", () => {
  const run = [0, 10, -20, 40, null].map(makeResult);

  it("tracks streaks across consecutive days and is idempotent per day", () => {
    let s = applyRun(emptyStats(), "2026-11-10", run);
    s = applyRun(s, "2026-11-10", run);
    expect(s.played).toBe(1);
    s = applyRun(s, "2026-11-11", run);
    expect(s.currentStreak).toBe(2);
    s = applyRun(s, "2026-11-14", run);
    expect(s.currentStreak).toBe(1);
    expect(s.bestStreak).toBe(2);
    expect(s.played).toBe(3);
    expect(s.tapCount).toBe(12);
    expect(liveStreak(s, "2026-11-15")).toBe(1);
    expect(liveStreak(s, "2026-11-16")).toBe(0);
  });
});
