import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOSSES, bossForWeekday, type Boss } from "../bosses";
import {
  FEINT_DURATION_MS,
  FEINT_FRACTION,
  FEINT_TAIL_MS,
  isRoundEnd,
  LAUNCH_DATE,
  MAX_DECEPTIVE_PER_ROUND,
  RAISE_MS,
  roundOf,
  ROUNDS_PER_RUN,
  STALL_AT_FRACTION,
  STALL_DURATION_MS,
  STRIKES_PER_ROUND,
  STRIKES_PER_RUN,
  TARGET_RUN_MS,
  WARMUP_ROUNDS,
} from "../config";
import { bannerLine, howToStrikes, numberWord, tagline } from "../copy";
import {
  bossForDate,
  dailySeed,
  dayNumber,
  isValidDateString,
  puzzleNumber,
  toDateString,
  weekdayOf,
} from "../daily";
import {
  bladePose,
  generateEncounter,
  generateStrike,
  impactOffsetMs,
  planDeception,
  type Strike,
} from "../generator";
import {
  AdaptiveQuality,
  blinkOpen,
  blinkSchedule,
  bodyAt,
  dxAt,
  kickFx,
  makePoseState,
  makeMotes,
  mapPoint,
  moteAt,
  neutralKick,
  phasesFor,
  QUALITY_STEPS,
  resolveMotion,
  tiltEnvelope,
  warpDx,
} from "../living";
import { PACING_FLOOR_MS, simulateRunMs } from "../pacing";
import { hashString, mulberry32 } from "../prng";
import {
  bestWorst,
  biasOf,
  biasSentence,
  gradeFor,
  makeResult,
  offsetPhrase,
  runScore,
  scoreOffset,
  strikeEmoji,
  tierCounts,
  tierLine,
} from "../scoring";
import { buildShareText, SHARE_ROW } from "../share";
import {
  copyText,
  shareCapabilities,
  shareCard,
  shareText,
  type ShareEnv,
} from "../shareClient";
import { applyRun, emptyStats, liveStreak } from "../stats";
import { emptyDaily, loadDaily, pruneDaily } from "../storage";

const seeds = (n: number) => Array.from({ length: n }, (_, i) => `seed-${i}`);

/** A strike with explicit fields, for pose tests. */
const strikeOf = (over: Partial<Strike>): Strike => ({
  index: 0,
  attempt: 0,
  holdMs: 1000,
  swingMs: 300,
  feint: null,
  stall: null,
  ...over,
});

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

describe("run structure", () => {
  it("derives the strike count and round helpers from two constants", () => {
    expect(STRIKES_PER_RUN).toBe(ROUNDS_PER_RUN * STRIKES_PER_ROUND);
    expect(roundOf(0)).toBe(0);
    expect(roundOf(STRIKES_PER_ROUND - 1)).toBe(0);
    expect(roundOf(STRIKES_PER_ROUND)).toBe(1);
    expect(roundOf(STRIKES_PER_RUN - 1)).toBe(ROUNDS_PER_RUN - 1);
    expect(isRoundEnd(STRIKES_PER_ROUND - 1)).toBe(true);
    expect(isRoundEnd(0)).toBe(Number(STRIKES_PER_ROUND) === 1);
    expect(isRoundEnd(STRIKES_PER_RUN - 1)).toBe(true);
  });

  it("derives player-facing copy from config", () => {
    expect(tagline()).toContain(numberWord(ROUNDS_PER_RUN).replace(/^./, (c) => c.toUpperCase()));
    expect(howToStrikes()).toContain(numberWord(STRIKES_PER_ROUND));
    expect(bannerLine()).toContain(numberWord(ROUNDS_PER_RUN).toUpperCase());
    expect(`${tagline()}${howToStrikes()}`).not.toMatch(/\d/);
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
  it("keeps hold and swing inside each boss's ranges", () => {
    for (const boss of BOSSES) {
      for (const seed of seeds(300)) {
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

  it("plans at most one deceptive strike per round, none in warm-up", () => {
    for (const boss of BOSSES) {
      for (const seed of seeds(300)) {
        const plan = planDeception(seed, boss);
        expect(plan).toHaveLength(STRIKES_PER_RUN);
        for (let r = 0; r < ROUNDS_PER_RUN; r++) {
          const inRound = plan
            .slice(r * STRIKES_PER_ROUND, (r + 1) * STRIKES_PER_ROUND)
            .filter((k) => k !== null);
          expect(inRound.length).toBeLessThanOrEqual(MAX_DECEPTIVE_PER_ROUND);
          if (r < WARMUP_ROUNDS) expect(inRound).toHaveLength(0);
        }
      }
    }
  });

  it("builds feints inside the hold and stalls inside the configured ranges", () => {
    let feints = 0;
    let stalls = 0;
    for (const boss of BOSSES) {
      for (const seed of seeds(300)) {
        const plan = planDeception(seed, boss);
        const strikes = generateEncounter(seed, boss, [0, 3, 1, 0, 7]);
        strikes.forEach((s, i) => {
          // A strike has at most one of the two, and it matches the plan.
          expect(s.feint !== null && s.stall !== null).toBe(false);
          expect(s.feint !== null).toBe(plan[i] === "feint");
          expect(s.stall !== null).toBe(plan[i] === "stall");
          if (s.feint) {
            feints++;
            expect(s.feint.atMs).toBeGreaterThan(0);
            expect(s.feint.atMs + FEINT_DURATION_MS + FEINT_TAIL_MS).toBeLessThanOrEqual(s.holdMs);
          }
          if (s.stall) {
            stalls++;
            expect(s.stall.durMs).toBeGreaterThanOrEqual(STALL_DURATION_MS[0]);
            expect(s.stall.durMs).toBeLessThanOrEqual(STALL_DURATION_MS[1]);
            expect(s.stall.atMs).toBeGreaterThanOrEqual(Math.round(STALL_AT_FRACTION[0] * s.swingMs));
            expect(s.stall.atMs).toBeLessThanOrEqual(Math.round(STALL_AT_FRACTION[1] * s.swingMs));
          }
        });
        if (boss.feintRoundChance === 0) expect(strikes.some((s) => s.feint)).toBe(false);
        if (boss.stallRoundChance === 0) expect(strikes.some((s) => s.stall)).toBe(false);
      }
    }
    expect(feints).toBeGreaterThan(0);
    expect(stalls).toBeGreaterThan(0);
  });

  it("gives a boss with no chances no deception at all", () => {
    for (const boss of BOSSES.filter((b) => b.feintRoundChance === 0 && b.stallRoundChance === 0)) {
      for (const seed of seeds(300)) {
        expect(planDeception(seed, boss).every((k) => k === null)).toBe(true);
      }
    }
  });

  it("downgrades a feint to a stall (or nothing) when the hold is too short", () => {
    const base = bossForWeekday(5);
    const short: Boss = { ...base, holdMs: [100, 400], feintRoundChance: 1, stallRoundChance: 0 };
    const shortStall: Boss = { ...short, stallRoundChance: 1 };
    for (const seed of seeds(40)) {
      expect(planDeception(seed, short).every((k) => k === null)).toBe(true);
      const plan = planDeception(seed, shortStall);
      expect(plan.includes("feint")).toBe(false);
      expect(plan.filter((k) => k === "stall")).toHaveLength(ROUNDS_PER_RUN - WARMUP_ROUNDS);
    }
  });

  it("plans deterministically from (seed, boss) only", () => {
    for (const boss of BOSSES) {
      for (const seed of seeds(25)) {
        expect(planDeception(seed, boss)).toEqual(planDeception(seed, boss));
        // Attempts re-roll timing but never the plan.
        const a = generateEncounter(seed, boss, []);
        const b = generateEncounter(seed, boss, new Array<number>(STRIKES_PER_RUN).fill(4));
        expect(b.map((s) => [s.feint !== null, s.stall !== null])).toEqual(
          a.map((s) => [s.feint !== null, s.stall !== null]),
        );
      }
    }
  });

  it("does not front-load deception (Oswin, final third of the run)", () => {
    const oswin = bossForWeekday(5);
    let total = 0;
    let late = 0;
    for (const seed of seeds(300)) {
      planDeception(seed, oswin).forEach((kind, i) => {
        if (!kind) return;
        total++;
        if (i >= (STRIKES_PER_RUN * 2) / 3) late++;
      });
    }
    expect(total).toBeGreaterThan(0);
    expect(late / total).toBeGreaterThanOrEqual(0.25);
  });

  it("re-derives a different timing when the attempt counter changes", () => {
    const boss = bossForWeekday(3);
    for (const kind of [null, "stall"] as const) {
      const first = generateStrike("s", boss, 2, 0, kind);
      const again = generateStrike("s", boss, 2, 0, kind);
      const retry = generateStrike("s", boss, 2, 1, kind);
      expect(again).toEqual(first);
      expect([retry.holdMs, retry.swingMs]).not.toEqual([first.holdMs, first.swingMs]);
    }
  });

  it("counts the stall in impactOffsetMs", () => {
    const plain = strikeOf({});
    const stalled = strikeOf({ stall: { atMs: 150, durMs: 300 } });
    expect(impactOffsetMs(plain)).toBe(RAISE_MS + 1300);
    expect(impactOffsetMs(stalled)).toBe(RAISE_MS + 1300 + 300);
  });

  it("blade pose follows raise, hold, feint, swing, impact", () => {
    const strike = strikeOf({ feint: { atMs: 200, durMs: FEINT_DURATION_MS } });
    expect(impactOffsetMs(strike)).toBe(RAISE_MS + 1300);
    expect(bladePose(strike, 0).phase).toBe("raise");
    expect(bladePose(strike, RAISE_MS + 100)).toMatchObject({ phase: "hold", swing: 0 });
    let peak = 0;
    for (let t = 200; t < 200 + FEINT_DURATION_MS; t += 2) {
      const p = bladePose(strike, RAISE_MS + t);
      expect(p.feinting).toBe(true);
      expect(p.stalled).toBe(false);
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

  it("blade pose hangs during a stall and never teleports", () => {
    const hold = 500;
    const swing = 300;
    const at = 150;
    const dur = 300;
    const strike = strikeOf({ holdMs: hold, swingMs: swing, stall: { atMs: at, durMs: dur } });
    const start = RAISE_MS + hold;
    // Fastest the blade can move: derivative of (t/swing)^2 is 2/swing per ms.
    const maxStep = 2 / swing + 1e-9;
    let prev = bladePose(strike, start).swing;
    for (let t = 1; t <= swing + dur + 20; t++) {
      const p = bladePose(strike, start + t);
      expect(p.swing).toBeGreaterThanOrEqual(prev);
      expect(p.swing - prev).toBeLessThanOrEqual(maxStep);
      const inHang = t >= at && t < at + dur;
      expect(p.stalled).toBe(inHang);
      if (t < swing + dur) expect(p.phase).toBe("swing");
      prev = p.swing;
    }
    // Flat across the hang, at the same height it stopped.
    const before = bladePose(strike, start + at - 1).swing;
    const hung = bladePose(strike, start + at + 100).swing;
    expect(hung).toBeCloseTo((at / swing) ** 2, 10);
    expect(hung - before).toBeLessThanOrEqual(maxStep);
    expect(bladePose(strike, start + at + dur - 1).swing).toBe(hung);
    expect(bladePose(strike, start + swing + dur)).toMatchObject({ phase: "impact", swing: 1 });
  });
});

describe("pacing", () => {
  it("guarantees the floor by construction", () => {
    expect(PACING_FLOOR_MS).toBeGreaterThanOrEqual(TARGET_RUN_MS);
  });

  it("every boss runs at least the target and not absurdly long", () => {
    for (const boss of BOSSES) {
      let min = Infinity;
      let max = 0;
      for (const seed of seeds(200)) {
        const ms = simulateRunMs(seed, boss);
        min = Math.min(min, ms);
        max = Math.max(max, ms);
        expect(ms).toBeGreaterThanOrEqual(TARGET_RUN_MS);
        expect(ms).toBeLessThanOrEqual(170_000);
      }
      expect(min).toBeGreaterThanOrEqual(PACING_FLOOR_MS);
      expect(max).toBeGreaterThanOrEqual(min);
    }
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

  it("averages strikes into a rounded run score", () => {
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

  it("counts tiers with the same cut-offs as the fight feedback", () => {
    const results = [100, 95, 94, 75, 74, 40, 39, 1, 0, 0].map((score) => ({ offset: 0, score }));
    expect(tierCounts(results)).toEqual({ true: 2, clean: 2, glancing: 2, grazed: 2, missed: 2 });
    expect(tierLine(results)).toBe("2 true, 2 clean, 2 glancing, 2 grazed, 2 missed");
    expect(tierLine([{ offset: 0, score: 100 }])).toBe("1 true");
  });

  it("finds best and worst strikes and phrases offsets", () => {
    const results = [makeResult(-80), makeResult(2), makeResult(null), makeResult(140)];
    const bw = bestWorst(results)!;
    expect(bw.best.index).toBe(1);
    expect(bw.worst.index).toBe(2);
    expect(bestWorst([])).toBeNull();
    expect(offsetPhrase(makeResult(null))).toBe("no tap");
    expect(offsetPhrase(makeResult(0.2))).toBe("dead on");
    expect(offsetPhrase(makeResult(-42))).toBe("42 ms early");
    expect(offsetPhrase(makeResult(17))).toBe("17 ms late");
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

  it("wraps 30 results into rows of 10, six lines in all", () => {
    const offsets = [-10, -70, 20, -200, -80, 5, -45, 90, 0, -33];
    const results = Array.from({ length: 30 }, (_, i) => makeResult(offsets[i % 10]));
    const lines = buildShareText(7, results, "https://example.com").split("\n");
    expect(SHARE_ROW).toBe(10);
    expect(lines).toHaveLength(6);
    const rows = lines.slice(1, 4);
    for (const row of rows) expect([...row]).toHaveLength(10);
    // Chronological: the grid reads in play order.
    expect(rows.join("")).toBe(results.map((r) => strikeEmoji(r.score)).join(""));
    expect(lines.join("\n")).not.toMatch(/[–—]/);
  });
});

/* ------------------------------ share client ------------------------------ */

function fakeDoc(execResult: boolean | "missing") {
  const textareas: Array<{ value: string; removed: boolean }> = [];
  const doc = {
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => {
      const ta = {
        value: "",
        removed: false,
        style: {} as Record<string, string>,
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
        remove() {
          this.removed = true;
        },
      };
      textareas.push(ta);
      return ta;
    }),
    execCommand: execResult === "missing" ? undefined : vi.fn(() => execResult),
  };
  return { doc: doc as unknown as Document, raw: doc, textareas };
}

function env(
  nav: Record<string, unknown>,
  doc: Document,
  coarsePointer: boolean,
): ShareEnv {
  return { nav: nav as unknown as Navigator, doc, coarsePointer };
}

const abortError = () => Object.assign(new Error("closed"), { name: "AbortError" });

describe("shareClient", () => {
  it("insecure origin (no share, no clipboard): copies via execCommand", async () => {
    const { doc, raw, textareas } = fakeDoc(true);
    const out = await copyText("hello", env({}, doc, false));
    expect(out).toBe("copied");
    expect(raw.execCommand).toHaveBeenCalledWith("copy");
    expect(textareas[0].value).toBe("hello");
    expect(textareas[0].removed).toBe(true);
  });

  it("no execCommand either: falls back to manual", async () => {
    const { doc } = fakeDoc("missing");
    expect(await copyText("hello", env({}, doc, false))).toBe("manual");
    const failing = fakeDoc(false);
    expect(await copyText("hello", env({}, failing.doc, false))).toBe("manual");
  });

  it("uses the clipboard API when present", async () => {
    const writeText = vi.fn(async () => undefined);
    const { doc, raw } = fakeDoc(true);
    expect(await copyText("hi", env({ clipboard: { writeText } }, doc, false))).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("hi");
    expect(raw.execCommand).not.toHaveBeenCalled();
  });

  it("a rejected clipboard write falls through to execCommand", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    const { doc, raw } = fakeDoc(true);
    expect(await copyText("hi", env({ clipboard: { writeText } }, doc, false))).toBe("copied");
    expect(raw.execCommand).toHaveBeenCalledTimes(1);
  });

  it("native share plus a coarse pointer shares, once", async () => {
    const share = vi.fn(async () => undefined);
    const { doc } = fakeDoc(true);
    const e = env({ share }, doc, true);
    expect(shareCapabilities(e).nativeText).toBe(true);
    expect(await shareText("score", e)).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ text: "score" });
  });

  it("AbortError is cancelled, with no fallback of any kind", async () => {
    const share = vi.fn(async () => {
      throw abortError();
    });
    const writeText = vi.fn(async () => undefined);
    const { doc, raw } = fakeDoc(true);
    const e = env({ share, clipboard: { writeText } }, doc, true);
    expect(await shareText("score", e)).toBe("cancelled");
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(raw.execCommand).not.toHaveBeenCalled();
  });

  it("any other native error is unsupported and is not retried", async () => {
    const share = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    const writeText = vi.fn(async () => undefined);
    const { doc } = fakeDoc(true);
    const e = env({ share, clipboard: { writeText } }, doc, true);
    expect(await shareText("score", e)).toBe("unsupported");
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("desktop (fine pointer) never calls navigator.share", async () => {
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn(() => true);
    const { doc } = fakeDoc(true);
    const e = env({ share, canShare }, doc, false);
    const file = new File(["x"], "card.png", { type: "image/png" });
    expect(shareCapabilities(e).nativeText).toBe(false);
    expect(await shareText("score", e)).toBe("unsupported");
    expect(await shareCard("score", file, e)).toBe("unsupported");
    expect(share).not.toHaveBeenCalled();
  });

  it("shares the card only when the browser says files can be shared", async () => {
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn(() => true);
    const { doc } = fakeDoc(true);
    const file = new File(["x"], "card.png", { type: "image/png" });
    expect(await shareCard("score", file, env({ share, canShare }, doc, true))).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "score", files: [file] });
    const noFiles = vi.fn(() => false);
    expect(await shareCard("score", file, env({ share, canShare: noFiles }, doc, true))).toBe(
      "unsupported",
    );
    expect(share).toHaveBeenCalledTimes(1);
  });
});

/* --------------------------------- storage -------------------------------- */

function fakeStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sizes a fresh record from STRIKES_PER_RUN", () => {
    expect(emptyDaily("2026-11-12").attempts).toHaveLength(STRIKES_PER_RUN);
  });

  it("ignores a v1 daily key and prunes it, leaving stats alone", () => {
    const stats = JSON.stringify({ played: 4, currentStreak: 3 });
    const old = JSON.stringify({
      date: "2026-11-12",
      results: [makeResult(0), makeResult(5)],
      attempts: [0, 0, 0, 0, 0],
      inProgress: null,
      done: false,
    });
    const ls = fakeStorage({
      "deflect:v1:daily:2026-11-12": old,
      "deflect:v1:daily:2026-11-01": old,
      "deflect:v2:daily:2026-11-12": "{}",
      "deflect:v2:daily:2026-11-05": "{}",
      "deflect:v1:stats": stats,
      "deflect:v1:muted": "true",
    });
    vi.stubGlobal("window", { localStorage: ls });

    // The old 5-strike record is not read as today's run.
    const rec = loadDaily("2026-11-12");
    expect(rec.results).toHaveLength(0);
    expect(rec.attempts).toHaveLength(STRIKES_PER_RUN);

    pruneDaily("2026-11-12");
    expect([...ls.map.keys()].some((k) => k.startsWith("deflect:v1:daily:"))).toBe(false);
    expect(ls.map.has("deflect:v2:daily:2026-11-12")).toBe(true);
    expect(ls.map.has("deflect:v2:daily:2026-11-05")).toBe(false);
    // Streaks and settings survive the migration.
    expect(ls.map.get("deflect:v1:stats")).toBe(stats);
    expect(ls.map.get("deflect:v1:muted")).toBe("true");
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

/* ---------------------------- living portraits ---------------------------- */

describe("living portrait (pure parts)", () => {
  const artBosses = BOSSES.filter((b) => b.art);

  const stateFor = (boss: Boss, seed = "deflect:2026-11-12") => {
    const art = boss.art!;
    return makePoseState(resolveMotion(art.motion), phasesFor(seed), art.neckY ?? 0.38);
  };

  it("every boss has art wired", () => {
    expect(artBosses).toHaveLength(BOSSES.length);
  });

  it("the pose is deterministic for (t, seed, motion)", () => {
    for (const boss of artBosses) {
      const a = stateFor(boss);
      const b = stateFor(boss);
      for (const t of [0, 1234.5, 98765]) {
        expect(bodyAt(t, a, 0)).toEqual(bodyAt(t, b, 0));
        expect(dxAt(0.7, t, a)).toBe(dxAt(0.7, t, b));
        expect(mapPoint(0.4, 0.2, t, a)).toEqual(mapPoint(0.4, 0.2, t, b));
      }
    }
    expect(phasesFor("a")).toEqual(phasesFor("a"));
    expect(phasesFor("a")).not.toEqual(phasesFor("b"));
  });

  it("takes no strike state: extra arguments are a type error", () => {
    const st = stateFor(artBosses[0]);
    const strike = strikeOf({});
    // The portrait can never see the strike, structurally: nothing in the pose
    // functions accepts one. These must not compile.
    // @ts-expect-error pose functions take no strike state
    bodyAt(0, st, 0, strike);
    // @ts-expect-error pose functions take no strike state
    dxAt(0.5, 0, st, strike);
    // @ts-expect-error pose functions take no strike state
    mapPoint(0.5, 0.5, 0, st, strike);
    expect(true).toBe(true);
  });

  it("living.ts never reads strike timing", () => {
    const src = readFileSync(fileURLToPath(new URL("../living.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']\.\/generator["']/);
    expect(code).not.toMatch(/\b(impactAt|toImpact|holdMs|swingMs|impactOffsetMs|bladePose|stall)\b/);
  });

  it("dx(y, t) is continuous in y and t, and the warp term is 0 at y = 0", () => {
    for (const boss of artBosses) {
      const st = stateFor(boss);
      st.tiltRad = 0.01;
      const m = st.motion;
      for (let t = 0; t < 20_000; t += 997) {
        expect(Math.abs(warpDx(0, t, m, st.phases))).toBe(0);
        for (let y = 0; y < 1; y += 0.01) {
          // Bounded slope in y and in t, so no jump anywhere.
          expect(Math.abs(dxAt(y + 0.001, t, st) - dxAt(y, t, st))).toBeLessThan(0.0015);
          expect(Math.abs(dxAt(y, t + 1, st) - dxAt(y, t, st))).toBeLessThan(0.00005);
        }
      }
    }
  });

  it("an eye anchor drifts under 0.02 of the width over a full breath, tilt included", () => {
    for (const boss of artBosses) {
      const st = stateFor(boss);
      const period = st.motion.breathPeriodMs;
      for (const tilt of [0, st.motion.tiltDeg * (Math.PI / 180), -st.motion.tiltDeg * (Math.PI / 180)]) {
        st.tiltRad = tilt;
        for (const [ex, ey] of boss.art!.eyes!) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = 0; i <= 200; i++) {
            const [x] = mapPoint(ex, ey, (i / 200) * period, st);
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
          expect(hi - lo).toBeLessThan(0.02);
        }
      }
    }
  });

  it("split halves breathe out of phase", () => {
    const twins = artBosses.find((b) => b.art!.motion?.split !== undefined)!;
    const st = stateFor(twins);
    const t = st.motion.breathPeriodMs / 4;
    expect(bodyAt(t, st, 0).dy).not.toBeCloseTo(bodyAt(t, st, 1).dy, 6);
  });

  it("blink schedule is deterministic per seed, every gap inside blinkEveryMs", () => {
    for (const boss of artBosses) {
      const every = resolveMotion(boss.art!.motion).blinkEveryMs;
      const a = blinkSchedule("seed-1", every, 400);
      expect(a).toEqual(blinkSchedule("seed-1", every, 400));
      expect(a).not.toEqual(blinkSchedule("seed-2", every, 400));
      for (const step of a) {
        expect(step.gap).toBeGreaterThanOrEqual(every[0]);
        expect(step.gap).toBeLessThanOrEqual(every[1]);
      }
      const doubles = a.filter((s) => s.double).length / a.length;
      expect(doubles).toBeGreaterThan(0.05);
      expect(doubles).toBeLessThan(0.3);
    }
    expect(blinkOpen(-5)).toBe(1);
    expect(blinkOpen(70)).toBeCloseTo(0.08, 5);
    expect(blinkOpen(180)).toBe(1);
  });

  it("tilt envelope eases in, holds and eases out", () => {
    expect(tiltEnvelope(-1)).toBe(0);
    expect(tiltEnvelope(0)).toBe(0);
    expect(tiltEnvelope(700)).toBe(1);
    expect(tiltEnvelope(1000)).toBe(1);
    expect(tiltEnvelope(2100)).toBe(0);
    let prev = 0;
    for (let t = 0; t <= 700; t += 10) {
      const v = tiltEnvelope(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("kicks are discrete, bounded and settle back to neutral", () => {
    const out = neutralKick({ dx: 0, dy: 0, scale: 1, breathBoost: 0, eye: 1, menace: 0 });
    for (const kind of ["strikeStart", "true", "clean", "glancing", "grazed", "late", "unanswered"] as const) {
      for (let dt = 0; dt < 1500; dt += 25) {
        kickFx(kind, dt, out);
        expect(Math.abs(out.dx)).toBeLessThanOrEqual(0.0125);
        expect(out.scale).toBeGreaterThan(0.98);
        expect(out.scale).toBeLessThan(1.04);
      }
      kickFx(kind, 5000, out);
      // Compare by value: a settled kick may leave a signed zero.
      expect(Math.abs(out.dx)).toBe(0);
      expect(Math.abs(out.dy)).toBe(0);
      expect([out.scale, out.breathBoost, out.eye, out.menace]).toEqual([1, 0, 1, 0]);
    }
    kickFx("true", 0, out);
    const full = Math.abs(out.dx);
    kickFx("clean", 0, out);
    expect(Math.abs(out.dx)).toBeCloseTo(full / 2, 10);
    kickFx("grazed", 0, out);
    expect(out.menace).toBe(1);
    expect(out.scale).toBeCloseTo(1.03, 10);
  });

  it("motes stay inside the portrait and never exceed 24", () => {
    expect(makeMotes("x", 99)).toHaveLength(24);
    expect(makeMotes("x", 0)).toHaveLength(0);
    const out = { x: 0, y: 0, a: 0 };
    for (const m of makeMotes("x", 24)) {
      for (let t = 0; t < 60_000; t += 700) {
        moteAt(m, t, out);
        expect(out.a).toBeGreaterThanOrEqual(0);
        expect(out.a).toBeLessThanOrEqual(0.35 + 1e-9);
        expect(out.y).toBeLessThanOrEqual(0.86 + 1e-9);
        expect(out.y).toBeGreaterThan(0.3);
      }
    }
  });

  it("adaptive quality only steps down", () => {
    const q = new AdaptiveQuality();
    let now = 0;
    let level = q.level;
    // Fast frames: never degrades.
    for (let i = 0; i < 600; i++) {
      now += 16;
      q.observe(16, now);
    }
    expect(q.level).toBe(0);
    // Slow frames: steps down, one level at a time, never up, bottoms out.
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      now += 28;
      q.observe(28, now);
      expect(q.level).toBeGreaterThanOrEqual(level);
      expect(q.level - level).toBeLessThanOrEqual(1);
      level = q.level;
      seen.add(level);
    }
    expect([...seen]).toEqual([0, 1, 2, 3]);
    expect(q.step).toEqual(QUALITY_STEPS[3]);
    expect(q.step.warp).toBe(false);
    // Recovery never steps back up in the same session.
    for (let i = 0; i < 2000; i++) {
      now += 8;
      q.observe(8, now);
    }
    expect(q.level).toBe(3);
  });

  it("adaptive quality ignores a hitch or a hidden tab", () => {
    const q = new AdaptiveQuality();
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now += 16;
      q.observe(16, now);
      if (i % 20 === 0) {
        now += 5000;
        q.observe(5000, now);
      }
    }
    expect(q.level).toBe(0);
  });

  it("art accents are skipped for the Unlit King and sit inside the image", () => {
    const king = BOSSES.find((b) => b.id === "unlit-king")!;
    expect(king.art!.accents ?? []).toHaveLength(0);
    for (const boss of artBosses) {
      for (const a of boss.art!.accents ?? []) {
        expect(a.x).toBeGreaterThan(0);
        expect(a.x).toBeLessThan(1);
        expect(a.y).toBeGreaterThan(0);
        expect(a.y).toBeLessThan(1);
      }
      for (const [x, y] of boss.art!.eyes ?? []) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(1);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(0.6);
      }
    }
  });
});
