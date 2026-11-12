/**
 * Boss roster. One boss per weekday, difficulty ramping Monday to Sunday.
 * Everything here is a tuning value: change freely while playtesting.
 *
 *  holdMs      [min, max] time the blade stays raised before the real swing
 *  swingMs     [min, max] time from swing start to impact
 *  feintChance probability (0..1) that a strike contains a false start
 *              (capped at MAX_FEINTS_PER_RUN per run, see config.ts)
 */

export type Range = readonly [min: number, max: number];

export type SilhouetteKind =
  | "keeper"
  | "knight"
  | "warden"
  | "twins"
  | "caller"
  | "mother"
  | "king";

export interface Boss {
  id: string;
  /** 0 = Sunday ... 6 = Saturday (matches Date.getDay). */
  weekday: number;
  name: string;
  epitaph: string;
  holdMs: Range;
  swingMs: Range;
  feintChance: number;
  look: {
    kind: SilhouetteKind;
    /** RGB triplet for the eye glow. */
    eye: readonly [number, number, number];
  };
}

export const BOSSES: readonly Boss[] = [
  {
    id: "toll-keeper",
    weekday: 1,
    name: "The Toll Keeper",
    epitaph: "Every crossing has a price. He counts it slowly.",
    holdMs: [300, 700],
    swingMs: [380, 450],
    feintChance: 0,
    look: { kind: "keeper", eye: [255, 170, 80] },
  },
  {
    id: "thornbound-knight",
    weekday: 2,
    name: "Thornbound Knight",
    epitaph: "Bound in briar, sworn to strike before the question.",
    holdMs: [200, 600],
    swingMs: [240, 320],
    feintChance: 0,
    look: { kind: "knight", eye: [190, 230, 120] },
  },
  {
    id: "warden-vesper",
    weekday: 3,
    name: "Warden Vesper",
    epitaph: "She keeps the dusk gate, and she is good at waiting.",
    holdMs: [600, 1800],
    swingMs: [340, 420],
    feintChance: 0,
    look: { kind: "warden", eye: [170, 160, 255] },
  },
  {
    id: "penitent-twins",
    weekday: 4,
    name: "The Penitent Twins",
    epitaph: "Two confessions, one blade, never the same rhythm.",
    holdMs: [150, 1200],
    swingMs: [260, 440],
    feintChance: 0.1,
    look: { kind: "twins", eye: [255, 120, 90] },
  },
  {
    id: "gravecaller-oswin",
    weekday: 5,
    name: "Gravecaller Oswin",
    epitaph: "He rings for the dead, and not every bell is true.",
    holdMs: [400, 1200],
    swingMs: [300, 400],
    feintChance: 0.5,
    look: { kind: "caller", eye: [120, 230, 210] },
  },
  {
    id: "mother-marrow",
    weekday: 6,
    name: "Mother Marrow",
    epitaph: "Patient as rot. Sudden as the snap of bone.",
    holdMs: [800, 2200],
    swingMs: [220, 300],
    feintChance: 0.2,
    look: { kind: "mother", eye: [240, 225, 170] },
  },
  {
    id: "unlit-king",
    weekday: 0,
    name: "The Unlit King",
    epitaph: "No crown, no candle, no mercy in the dark.",
    holdMs: [200, 2400],
    swingMs: [200, 440],
    feintChance: 0.4,
    look: { kind: "king", eye: [235, 240, 255] },
  },
];

export function bossForWeekday(weekday: number): Boss {
  const boss = BOSSES.find((b) => b.weekday === weekday);
  if (!boss) throw new Error(`No boss for weekday ${weekday}`);
  return boss;
}
