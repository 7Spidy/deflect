import type { Boss, Range } from "./bosses";
import {
  HAS_PHASE_TWO,
  PHASE_TWO_DECEIT,
  PHASE_TWO_ROUND,
  PHASE_TWO_SWING,
  ROUNDS_PER_RUN,
  SIGNATURE_CHANCE,
  WARMUP_ROUNDS,
} from "./config";
import { seededRng } from "./prng";

/**
 * What makes one day's fight feel unlike another's.
 *
 *  Move       a named attack string: one rhythm shape per round. Learnable
 *             (a Lull is always quick, quick, long), never exact (jitter).
 *  Signature  the move the guardian favours today. Forced twice, then likely.
 *  Omen       a day-wide condition, the same for every guardian that date.
 *  Phase two  from PHASE_TWO_ROUND on, a harder moveset and a faster arm.
 *
 * All of it is a pure function of (seed, boss). Nothing here reads attempts,
 * so voiding a strike never changes the day's shape, only its timing.
 */

export type MoveId =
  | "measured"
  | "quicken"
  | "linger"
  | "flurry"
  | "lull"
  | "rush"
  | "heavy"
  | "waver"
  | "unruly";

export interface Move {
  id: MoveId;
  /** Shown between rounds as the telegraph for the next one. */
  name: string;
  /** One short line on the rhythm, for the title screen and results. */
  hint: string;
  /**
   * Control points across the round, 0 = the boss's shortest hold, 1 = its
   * longest. Interpolated, so any STRIKES_PER_ROUND works.
   */
  hold: readonly number[];
  /** Same, for swing speed (0 = fastest swing, 1 = slowest). */
  swing: readonly number[];
  /** Spread around each control point, as a fraction of the range (max 0.5). */
  jitter: number;
  /** If the round carries a feint or stall, it lands here (0..1 across the round). */
  tell?: { at: number; prefer: "feint" | "stall" };
}

export const MOVES: Readonly<Record<MoveId, Move>> = {
  measured: {
    id: "measured",
    name: "Measured Cuts",
    hint: "even blows, an even count",
    hold: [0.5],
    swing: [0.5],
    jitter: 0.08,
  },
  quicken: {
    id: "quicken",
    name: "The Quickening",
    hint: "each blow sooner than the last",
    hold: [0.85, 0.1],
    swing: [0.7, 0.2],
    jitter: 0.08,
  },
  linger: {
    id: "linger",
    name: "The Long Count",
    hint: "each wait longer than the last",
    hold: [0.1, 0.9],
    swing: [0.4, 0.6],
    jitter: 0.08,
    tell: { at: 1, prefer: "feint" },
  },
  flurry: {
    id: "flurry",
    name: "Flurry",
    hint: "no breath between blows",
    hold: [0.05],
    swing: [0.15],
    jitter: 0.06,
  },
  lull: {
    id: "lull",
    name: "The Lull",
    hint: "quick, quick, and then it waits",
    hold: [0.12, 0.12, 0.95],
    swing: [0.3, 0.3, 0.6],
    jitter: 0.07,
    tell: { at: 1, prefer: "stall" },
  },
  rush: {
    id: "rush",
    name: "The Rush",
    hint: "one long breath, then all at once",
    hold: [0.95, 0.08, 0.08],
    swing: [0.6, 0.15, 0.15],
    jitter: 0.07,
    tell: { at: 0, prefer: "feint" },
  },
  heavy: {
    id: "heavy",
    name: "Heavy Hand",
    hint: "slow blows that hang",
    hold: [0.7, 0.85],
    swing: [0.9],
    jitter: 0.1,
    tell: { at: 0.5, prefer: "stall" },
  },
  waver: {
    id: "waver",
    name: "Wavering",
    hint: "short, long, short",
    hold: [0.15, 0.9, 0.2],
    swing: [0.4, 0.7, 0.3],
    jitter: 0.12,
  },
  unruly: {
    id: "unruly",
    name: "Unruly",
    hint: "no rhythm at all",
    hold: [0.5],
    swing: [0.5],
    jitter: 0.5,
  },
};

export type OmenId = "clear" | "bloodMoon" | "longNight" | "thinVeil" | "steadyHand" | "ashfall";

export interface Omen {
  id: OmenId;
  name: string;
  line: string;
  /** Relative odds of being drawn. */
  weight: number;
  holdScale: number;
  swingScale: number;
  deceitScale: number;
  jitterScale: number;
  /** Scene tint (rgb) and its strength, or null for none. */
  tint: readonly [number, number, number] | null;
  tintAlpha: number;
}

export const OMENS: readonly Omen[] = [
  {
    id: "clear",
    name: "Clear Night",
    line: "Nothing stirs but the foe.",
    weight: 3,
    holdScale: 1,
    swingScale: 1,
    deceitScale: 1,
    jitterScale: 1,
    tint: null,
    tintAlpha: 0,
  },
  {
    id: "bloodMoon",
    name: "Blood Moon",
    line: "Every swing comes quicker.",
    weight: 1.5,
    holdScale: 1,
    swingScale: 0.88,
    deceitScale: 1,
    jitterScale: 1,
    tint: [150, 20, 24],
    tintAlpha: 0.1,
  },
  {
    id: "longNight",
    name: "Long Night",
    line: "The waits run long.",
    weight: 1.5,
    holdScale: 1.15,
    swingScale: 1,
    deceitScale: 1,
    jitterScale: 1,
    tint: [30, 40, 110],
    tintAlpha: 0.12,
  },
  {
    id: "thinVeil",
    name: "Thin Veil",
    line: "Lies come easier tonight.",
    weight: 1.2,
    holdScale: 1,
    swingScale: 1,
    deceitScale: 1.6,
    jitterScale: 1,
    tint: [120, 90, 160],
    tintAlpha: 0.08,
  },
  {
    id: "steadyHand",
    name: "Steady Hand",
    line: "Its rhythm is clean and plain.",
    weight: 1.2,
    holdScale: 1,
    swingScale: 1,
    deceitScale: 0.5,
    jitterScale: 0.4,
    tint: [200, 170, 90],
    tintAlpha: 0.05,
  },
  {
    id: "ashfall",
    name: "Ashfall",
    line: "Its rhythm frays in the ash.",
    weight: 1.2,
    holdScale: 1,
    swingScale: 1,
    deceitScale: 1,
    jitterScale: 1.8,
    tint: [110, 105, 100],
    tintAlpha: 0.1,
  },
];

export interface DayPlan {
  omen: Omen;
  /** The move the guardian favours today. */
  signature: MoveId;
  /** One move per round. */
  moves: MoveId[];
}

export interface RoundRanges {
  hold: Range;
  swing: Range;
  feintChance: number;
  stallChance: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Today's omen. Depends on the date seed only, so every guardian shares it. */
export function omenFor(seed: string): Omen {
  const total = OMENS.reduce((s, o) => s + o.weight, 0);
  let roll = seededRng(`${seed}|omen`)() * total;
  for (const o of OMENS) {
    roll -= o.weight;
    if (roll < 0) return o;
  }
  return OMENS[0];
}

export const isPhaseTwo = (round: number) => HAS_PHASE_TWO && round >= PHASE_TWO_ROUND;

function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))];
}

/**
 * The day's shape: omen, signature move and one move per round. Warm-up
 * rounds are always Measured Cuts. The signature is forced once in each phase
 * (or twice in a run with no phase two), and otherwise turns up with
 * SIGNATURE_CHANCE. Other moves never repeat back to back.
 */
export function planDay(seed: string, boss: Boss): DayPlan {
  const omen = omenFor(seed);
  const rng = seededRng(`${seed}|${boss.id}|moves`);
  // Measured Cuts is the warm-up, too plain to be anyone's favourite.
  const all = [...new Set([...boss.moves.one, ...boss.moves.two])];
  const pool = all.filter((m) => m !== "measured");
  const signature = pick(pool.length ? pool : all, rng());

  const open = Array.from({ length: ROUNDS_PER_RUN }, (_, r) => r).filter((r) => r >= WARMUP_ROUNDS);
  const forced = new Set<number>();
  if (HAS_PHASE_TWO) {
    const one = open.filter((r) => r < PHASE_TWO_ROUND);
    const two = open.filter((r) => r >= PHASE_TWO_ROUND);
    if (one.length) forced.add(pick(one, rng()));
    if (two.length) forced.add(pick(two, rng()));
  } else {
    while (forced.size < Math.min(2, open.length)) forced.add(pick(open, rng()));
  }

  const moves: MoveId[] = [];
  for (let r = 0; r < ROUNDS_PER_RUN; r++) {
    const sigRoll = rng();
    const poolRoll = rng();
    if (r < WARMUP_ROUNDS) {
      moves.push("measured");
      continue;
    }
    if (forced.has(r) || sigRoll < SIGNATURE_CHANCE) {
      moves.push(signature);
      continue;
    }
    const phasePool = isPhaseTwo(r) ? boss.moves.two : boss.moves.one;
    const prev = moves[r - 1];
    const fresh = phasePool.filter((m) => m !== prev && m !== signature);
    moves.push(pick(fresh.length ? fresh : phasePool, poolRoll));
  }
  return { omen, signature, moves };
}

/** The boss's ranges and odds for one round, after the omen and the phase. */
export function roundRanges(boss: Boss, day: DayPlan, round: number): RoundRanges {
  const o = day.omen;
  const two = isPhaseTwo(round);
  const sw = o.swingScale * (two ? PHASE_TWO_SWING : 1);
  const deceit = o.deceitScale * (two ? PHASE_TWO_DECEIT : 1);
  return {
    hold: [Math.round(boss.holdMs[0] * o.holdScale), Math.round(boss.holdMs[1] * o.holdScale)],
    swing: [Math.round(boss.swingMs[0] * sw), Math.round(boss.swingMs[1] * sw)],
    feintChance: clamp01(boss.feintRoundChance * deceit),
    stallChance: clamp01(boss.stallRoundChance * deceit),
  };
}

/** A move's control points sampled at strike k of n. */
export function shapeAt(points: readonly number[], k: number, n: number): number {
  if (points.length === 1) return points[0];
  const t = n <= 1 ? 0.5 : k / (n - 1);
  const x = t * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(x));
  const f = x - i;
  return points[i] + (points[i + 1] - points[i]) * f;
}

/** Position in a range: the shape point, spread by jitter, clamped to 0..1. */
export function spread(shape: number, jitter: number, roll: number): number {
  return clamp01(shape + (roll - 0.5) * 2 * Math.min(0.5, jitter));
}

/** Slot (0..n-1) a move's tell points at. */
export function tellSlot(move: Move, n: number): number | null {
  if (!move.tell) return null;
  return Math.max(0, Math.min(n - 1, Math.round(move.tell.at * (n - 1))));
}

/** Gap before each motif note: base plus the move's hold shape, in seconds. */
export const MOTIF_GAP: readonly [number, number] = [0.06, 0.24];
/** Unruly moves have no shape to sing, so they get a lurching fixed one. */
const UNRULY_GAPS = [0.1, 0.42, 0.18, 0.34];

export interface MotifNote {
  /** Seconds from the motif's start. */
  at: number;
  /** Semitones above the guardian's root: faster swings sing higher. */
  semis: number;
}

/**
 * A move's motif, one note per strike: the gaps follow the move's hold shape
 * and the pitch its swing shape. Built from the move's public shape only,
 * never a strike's real timing, so it teaches a rhythm without giving one away.
 */
export function motifNotes(move: Move, n: number): MotifNote[] {
  const notes: MotifNote[] = [];
  let at = 0;
  for (let k = 0; k < n; k++) {
    at +=
      move.jitter >= 0.3
        ? UNRULY_GAPS[k % UNRULY_GAPS.length]
        : MOTIF_GAP[0] + MOTIF_GAP[1] * shapeAt(move.hold, k, n);
    notes.push({ at, semis: Math.round((1 - shapeAt(move.swing, k, n)) * 7) });
  }
  return notes;
}
