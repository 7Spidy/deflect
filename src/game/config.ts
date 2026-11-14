/**
 * Global tuning constants. Boss-specific values live in bosses.ts.
 */

/** Player-facing name. Internal ids, seeds and storage keys keep "deflect". */
export const GAME_NAME = "Dflect Everywhere";
/** The two halves, for layouts that stack them (logo, OG image). */
export const GAME_NAME_PARTS = ["Dflect", "Everywhere"] as const;

/** Local date of puzzle #1 (YYYY-MM-DD). */
export const LAUNCH_DATE = "2026-11-10";

/**
 * Run structure. A run is ROUNDS_PER_RUN rounds of STRIKES_PER_ROUND strikes.
 * Everything keys off these two numbers; nothing else hardcodes a count.
 */
export const ROUNDS_PER_RUN = 10;
export const STRIKES_PER_ROUND = 3;
export const STRIKES_PER_RUN = ROUNDS_PER_RUN * STRIKES_PER_ROUND;
export const roundOf = (i: number) => Math.floor(i / STRIKES_PER_ROUND);
export const isRoundEnd = (i: number) => (i + 1) % STRIKES_PER_ROUND === 0;

/** Strike phase timings (ms). */
export const RAISE_MS = 500;
/** Guardian reveal. */
export const INTRO_MS = 3000;
/** Pause after the final strike before the results screen. */
export const OUTRO_MS = 2000;
/** Minimum recovery after impact. */
export const GAP_MS = 1500;
/** Strike start to next strike start, floor. Guarantees the run length. */
export const MIN_CYCLE_MS = 3600;
/** Extra beat after the last strike of a round (not after the final one). */
export const ROUND_BREAK_MS = 1200;
/** A run must never be shorter than this (see pacing.ts). */
export const TARGET_RUN_MS = 120_000;

/** Rounds before this index have no feints or stalls. */
export const WARMUP_ROUNDS = 1;
/** A feint OR a stall, never both in one strike. */
export const MAX_DECEPTIVE_PER_ROUND = 1;

/**
 * Second phase. From this round (0-based) on, the guardian draws from its
 * phase-two moveset, swings a little faster and lies a little more. The round
 * before it gets an extra beat (PHASE_SHIFT_MS) for the transformation.
 */
export const PHASE_TWO_ROUND = Math.floor(ROUNDS_PER_RUN / 2);
export const HAS_PHASE_TWO = PHASE_TWO_ROUND > WARMUP_ROUNDS && PHASE_TWO_ROUND < ROUNDS_PER_RUN;
export const PHASE_SHIFT_MS = 1800;
export const PHASE_TWO_SWING = 0.94;
export const PHASE_TWO_DECEIT = 1.25;
/** True when `round` (0-based) is the first round of phase two. */
export const isPhaseShift = (round: number) => HAS_PHASE_TWO && round === PHASE_TWO_ROUND;

/** Chance per round (outside the forced slots) that the day's signature move is used. */
export const SIGNATURE_CHANCE = 0.3;

/**
 * Stall (delayed swing): mid-swing the blade hangs, then snaps through.
 * STALL_AT_FRACTION is the fraction of the swing travel time at which it hangs.
 */
export const STALL_DURATION_MS = [260, 420] as const;
export const STALL_AT_FRACTION = [0.45, 0.7] as const;

/** Scoring window (ms). */
export const PERFECT_WINDOW_MS = 33;
export const MISS_WINDOW_MS = 300;

/** Feint shape. A feint only happens when the hold is long enough to fit it. */
export const FEINT_FRACTION = 0.15;
export const FEINT_DURATION_MS = 240;
export const FEINT_MIN_HOLD_MS = 600;
/** Earliest a feint can begin after the hold starts. */
export const FEINT_LEAD_MS = 80;
/** Minimum quiet time between the end of a feint and the real swing. */
export const FEINT_TAIL_MS = 160;

/** Blade angles in degrees, measured clockwise from straight up. */
export const ANGLE_RAISED_DEG = 35;
export const ANGLE_REST_DEG = 112;

export const AUTHOR_NAME = "Avi";
export const AUTHOR_URL = "https://x.com/avi21b";
