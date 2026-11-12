/**
 * Global tuning constants. Boss-specific values live in bosses.ts.
 */

/** Local date of puzzle #1 (YYYY-MM-DD). */
export const LAUNCH_DATE = "2026-11-10";

export const STRIKES_PER_RUN = 5;
export const MAX_FEINTS_PER_RUN = 2;

/** Strike phase timings (ms). */
export const RAISE_MS = 500;
export const INTRO_MS = 1500;
export const GAP_MS = 1200;
/** Pause after the final strike before the results screen. */
export const OUTRO_MS = 1400;

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
