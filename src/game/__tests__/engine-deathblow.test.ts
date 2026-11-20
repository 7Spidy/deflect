/**
 * Drives the real Engine headlessly (stub scene, audio, canvas and a fake clock)
 * through the Deathblow: one slip is forgiven, a second miss fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sceneCalls: string[] = [];
vi.mock("../scene", () => ({
  computeLayout: () => ({ w: 400, h: 800, cx: 200, gy: 400 }),
  Scene: class {
    constructor() {
      return new Proxy(this, {
        get: (_t, k: string) => () => {
          sceneCalls.push(String(k));
        },
      });
    }
  },
}));

import { Engine } from "../engine";
import { BOSSES } from "../bosses";
import { STRIKES_PER_RUN } from "../config";
import {
  DEATHBLOW_BEAT_MS,
  DEATHBLOW_LATE_MS,
  DEATHBLOW_LEAD_MS,
  DEATHBLOW_WINDOW_MS,
  type DeathblowResult,
} from "../stagger";

let clock = 0;
let rafCb: ((t: number) => void) | null = null;
let startedAt = 0;
let slips = 0;
let starts = 0;
let result: DeathblowResult | null = null;
let engine: Engine;
let audioCalls: Array<[string, unknown[]]> = [];

function advanceTo(t: number) {
  while (clock < t) {
    clock = Math.min(t, clock + 16);
    const cb = rafCb;
    rafCb = null;
    cb?.(clock);
  }
}
function setup() {
  clock = 1000;
  slips = 0;
  starts = 0;
  result = null;
  sceneCalls.length = 0;
  audioCalls = [];
  vi.stubGlobal("performance", { now: () => clock });
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("document", {
    addEventListener() {},
    removeEventListener() {},
    hidden: false,
  });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const canvas = {
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 400, height: 800 }),
    width: 0,
    height: 0,
  };
  const audio = new Proxy(
    {},
    {
      get:
        (_t, k: string) =>
        (...a: unknown[]) => {
          audioCalls.push([k, a]);
        },
    },
  );
  engine = new Engine({
    canvas: canvas as unknown as HTMLCanvasElement,
    boss: BOSSES[0],
    seed: "t",
    startIndex: STRIKES_PER_RUN,
    attempts: [],
    stagger: { value: 100, brokeAt: 5 },
    deathblow: null,
    reducedMotion: false,
    audio: audio as never,
    onStrikeStart() {},
    onResult() {},
    onVoid() {},
    onDeathblowStart: () => {
      starts++;
      startedAt = clock;
    },
    onDeathblowSlip: () => {
      slips++;
    },
    onDeathblow: (r) => {
      result = r;
    },
    onComplete() {},
  });
  engine.start();
  while (starts === 0 && clock < 20000) advanceTo(clock + 16);
  expect(starts).toBe(1);
}
const tapAt = (rel: number) => engine.tap(startedAt + rel);
const run = (rel: number) => advanceTo(startedAt + rel);
const M1 = DEATHBLOW_LEAD_MS,
  M2 = DEATHBLOW_LEAD_MS + DEATHBLOW_BEAT_MS;

describe("engine deathblow (headless)", () => {
  beforeEach(setup);
  afterEach(() => {
    engine.destroy();
    vi.unstubAllGlobals();
  });

  it("heartbeats get explicit beat count", () => {
    expect(audioCalls.find((c) => c[0] === "heartbeats")![1]).toEqual([1.5, 3]);
  });
  it("first-mark hit lands, not slipped", () => {
    run(M1 - 40);
    tapAt(M1 - 40);
    run(M1 + 50);
    expect(result).toMatchObject({ landed: true });
    expect(result!.slipped).toBeFalsy();
    expect(slips).toBe(0);
  });
  it("deaf period ignores an early tap and does not slip", () => {
    run(300);
    tapAt(300);
    run(M1 - 10);
    expect(slips).toBe(0);
    expect(result).toBeNull();
  });
  it("early miss spends slip at once; retry hit lands slipped", () => {
    run(1000);
    tapAt(1000);
    expect(slips).toBe(1);
    expect(result).toBeNull();
    expect(audioCalls.filter((c) => c[0] === "heartbeats")[1][1]).toEqual([
      expect.closeTo((startedAt + M2 - clock) / 1000, 3),
      1,
    ]);
    run(M2 + 30);
    tapAt(M2 + 30);
    run(M2 + 100);
    expect(result).toMatchObject({ landed: true, slipped: true });
  });
  it("no tap on first mark -> retry after window; retry hit lands slipped", () => {
    run(M1 + DEATHBLOW_WINDOW_MS - 20);
    expect(slips).toBe(0);
    run(M1 + DEATHBLOW_WINDOW_MS + 40);
    expect(slips).toBe(1);
    run(M2 - 20);
    tapAt(M2 - 20);
    run(M2 + 60);
    expect(result).toMatchObject({ landed: true, slipped: true });
  });
  it("both miss (no taps) fails slipped with null offset, after mark2+LATE", () => {
    run(M2 + DEATHBLOW_LATE_MS - 30);
    expect(result).toBeNull();
    run(M2 + DEATHBLOW_LATE_MS + 40);
    expect(result).toEqual({ offset: null, landed: false, slipped: true });
  });
  it("late straggler for first mark does not spend the retry", () => {
    run(M1 + 150);
    tapAt(M1 + 150);
    expect(slips).toBe(1);
    expect(result).toBeNull();
    run(M1 + 200);
    tapAt(M1 + 200);
    expect(result).toBeNull();
    run(M2 + 10);
    tapAt(M2 + 10);
    run(M2 + 80);
    expect(result).toMatchObject({ landed: true, slipped: true });
  });
  it("early-miss then re-tap near mark1 cannot re-earn the first mark", () => {
    run(900);
    tapAt(900);
    expect(slips).toBe(1);
    run(M1 - 10);
    tapAt(M1 - 10);
    run(M1 + 200);
    expect(result).toBeNull(); // ignored by retry deaf
    run(M2 + DEATHBLOW_LATE_MS + 40);
    expect(result).toMatchObject({ landed: false, slipped: true });
  });
  it("retry tap that is wrong fails", () => {
    run(1000);
    tapAt(1000);
    run(M2 - 200);
    tapAt(M2 - 200);
    run(M2 + 100);
    expect(result).toMatchObject({
      landed: false,
      slipped: true,
      offset: -200,
    });
  });
  it("late tap on retry (150 late) fails right away", () => {
    run(M1 + 200);
    run(M2 + 150);
    tapAt(M2 + 150);
    expect(result).toMatchObject({ landed: false, slipped: true });
  });
  it("on-time tap delivered after the frame timed it out still lands unslipped", () => {
    run(M1 + DEATHBLOW_WINDOW_MS + 40);
    expect(slips).toBe(1);
    tapAt(M1 + 60);
    run(M1 + 300);
    expect(result).toMatchObject({ landed: true });
    expect(result!.slipped).toBeFalsy();
  });
  it("pause during retry restarts the whole deathblow with slip unused", () => {
    run(M1 + DEATHBLOW_WINDOW_MS + 40);
    expect(slips).toBe(1);
    engine.pause("hidden");
    engine.resume("hidden");
    const before = starts;
    while (starts === before && clock < 40000) advanceTo(clock + 16);
    expect(starts).toBe(2);
    run(M1 + 0); // relative to the new start
    tapAt(M1 - 30);
    run(M1 + 60);
    expect(result).toMatchObject({ landed: true });
    expect(result!.slipped).toBeFalsy();
  });
});
