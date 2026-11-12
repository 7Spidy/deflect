/**
 * Boss roster. One boss per weekday, difficulty ramping Monday to Sunday.
 * Everything here is a tuning value: change freely while playtesting.
 *
 *  holdMs           [min, max] time the blade stays raised before the real swing
 *  swingMs          [min, max] time from swing start to impact
 *  feintRoundChance probability (0..1) per round that one strike has a false start
 *  stallRoundChance probability (0..1) per round that one strike has a delayed swing
 *                   (a round holds at most one feint OR stall, see planDeception)
 *  art              optional guardian image, see public/guardians/README.md
 */
import type { Accent, Motion } from "./living";

export type Range = readonly [min: number, max: number];

export type SilhouetteKind =
  | "keeper"
  | "knight"
  | "warden"
  | "twins"
  | "caller"
  | "mother"
  | "king";

export interface GuardianArt {
  /** Path under /public, e.g. /guardians/toll-keeper.webp */
  src: string;
  /** Multiplier on the base fit (image width = canvas width). */
  scale: number;
  /** Vertical nudge, as a fraction of canvas height (positive = down). */
  offsetY: number;
  /** Eye anchors in image fractions (0..1). Replaces the silhouette eye positions. */
  eyes?: Array<[number, number]>;
  /** Neck line in image fractions; the head-tilt shear is applied above it. */
  neckY?: number;
  motion?: Partial<Motion>;
  accents?: Accent[];
}

export interface Boss {
  id: string;
  /** 0 = Sunday ... 6 = Saturday (matches Date.getDay). */
  weekday: number;
  name: string;
  epitaph: string;
  holdMs: Range;
  swingMs: Range;
  feintRoundChance: number;
  stallRoundChance: number;
  art?: GuardianArt;
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
    feintRoundChance: 0,
    stallRoundChance: 0,
    look: { kind: "keeper", eye: [255, 170, 80] },
    art: {
      src: "/guardians/toll-keeper.webp",
      scale: 1,
      offsetY: 0,
      eyes: [[0.46, 0.2], [0.54, 0.2]],
      neckY: 0.28,
      motion: { breathAmp: 0.005, breathPeriodMs: 6200, swayAmp: 0.004 },
      // The lantern he carries, lit only by a slow amber pulse.
      accents: [{ x: 0.25, y: 0.745, r: 0.05, rgb: [255, 170, 80], pulseMs: 5200 }],
    },
  },
  {
    id: "thornbound-knight",
    weekday: 2,
    name: "Thornbound Knight",
    epitaph: "Bound in briar, sworn to strike before the question.",
    holdMs: [200, 600],
    swingMs: [240, 320],
    feintRoundChance: 0,
    stallRoundChance: 0,
    look: { kind: "knight", eye: [190, 230, 120] },
    art: {
      src: "/guardians/thornbound-knight.webp",
      scale: 1,
      offsetY: 0,
      eyes: [[0.465, 0.172], [0.552, 0.172]],
      neckY: 0.26,
      motion: {
        breathAmp: 0.002,
        swayAmp: 0.0015,
        warpAmp: 0.002,
        tiltDeg: 0.2,
        blinkEveryMs: [5000, 11000],
      },
    },
  },
  {
    id: "warden-vesper",
    weekday: 3,
    name: "Warden Vesper",
    epitaph: "She keeps the dusk gate, and she is good at waiting.",
    holdMs: [600, 1800],
    swingMs: [340, 420],
    feintRoundChance: 0,
    stallRoundChance: 0.5,
    look: { kind: "warden", eye: [170, 160, 255] },
    art: {
      src: "/guardians/warden-vesper.webp",
      scale: 1,
      offsetY: 0,
      eyes: [[0.46, 0.174], [0.54, 0.174]],
      neckY: 0.27,
      motion: {
        breathAmp: 0.002,
        breathPeriodMs: 7000,
        swayAmp: 0.001,
        warpAmp: 0.009,
        warpWaves: 3.0,
        tiltDeg: 0.3,
      },
      // The four stars of the dusk halo, very slowly breathing lavender.
      accents: [
        { x: 0.319, y: 0.09, r: 0.03, rgb: [180, 170, 255], pulseMs: 9000 },
        { x: 0.682, y: 0.09, r: 0.03, rgb: [180, 170, 255], pulseMs: 11000 },
        { x: 0.253, y: 0.183, r: 0.03, rgb: [180, 170, 255], pulseMs: 13000 },
        { x: 0.747, y: 0.183, r: 0.03, rgb: [180, 170, 255], pulseMs: 10000 },
      ],
    },
  },
  {
    id: "penitent-twins",
    weekday: 4,
    name: "The Penitent Twins",
    epitaph: "Two confessions, one blade, never the same rhythm.",
    holdMs: [150, 1200],
    swingMs: [260, 440],
    feintRoundChance: 0.25,
    stallRoundChance: 0.25,
    look: { kind: "twins", eye: [255, 120, 90] },
    art: {
      src: "/guardians/penitent-twins.webp",
      scale: 1,
      offsetY: 0,
      eyes: [[0.329, 0.173], [0.377, 0.1785], [0.631, 0.1775], [0.679, 0.1725]],
      neckY: 0.25,
      motion: { breathAmp: 0.004, breathPeriodMs: 4800, split: 0.5 },
    },
  },
  {
    id: "gravecaller-oswin",
    weekday: 5,
    name: "Gravecaller Oswin",
    epitaph: "He rings for the dead, and not every bell is true.",
    holdMs: [400, 1200],
    swingMs: [300, 400],
    feintRoundChance: 0.6,
    stallRoundChance: 0.2,
    look: { kind: "caller", eye: [120, 230, 210] },
    art: {
      src: "/guardians/gravecaller-oswin.webp",
      scale: 1,
      offsetY: 0,
      eyes: [[0.464, 0.2075], [0.539, 0.2075]],
      neckY: 0.3,
      motion: {
        breathAmp: 0.003,
        breathPeriodMs: 4400,
        swayAmp: 0.006,
        warpAmp: 0.007,
        warpWaves: 2.6,
        tiltDeg: 0.8,
      },
      // A faint teal glint along the crack of the bell in his raised hand.
      accents: [{ x: 0.826, y: 0.225, r: 0.035, rgb: [120, 230, 210], pulseMs: 4400 }],
    },
  },
  {
    id: "mother-marrow",
    weekday: 6,
    name: "Mother Marrow",
    epitaph: "Patient as rot. Sudden as the snap of bone.",
    holdMs: [800, 2200],
    swingMs: [220, 300],
    feintRoundChance: 0.3,
    stallRoundChance: 0.35,
    look: { kind: "mother", eye: [240, 225, 170] },
    art: {
      src: "/guardians/mother-marrow.webp",
      scale: 1,
      // Her face sits low in the image (eyes at 0.31), so the rib dome would run
      // under the HUD label. Nudge the whole figure down a little.
      offsetY: 0.04,
      eyes: [[0.469, 0.311], [0.539, 0.311]],
      neckY: 0.37,
      motion: {
        breathAmp: 0.008,
        breathPeriodMs: 8200,
        swayAmp: 0.002,
        warpAmp: 0.006,
        warpWaves: 1.6,
        blinkEveryMs: [3500, 9000],
      },
    },
  },
  {
    id: "unlit-king",
    weekday: 0,
    name: "The Unlit King",
    epitaph: "No crown, no candle, no mercy in the dark.",
    holdMs: [200, 2400],
    swingMs: [200, 440],
    feintRoundChance: 0.4,
    stallRoundChance: 0.4,
    look: { kind: "king", eye: [235, 240, 255] },
    art: {
      src: "/guardians/unlit-king.webp",
      scale: 1,
      offsetY: 0,
      eyes: [[0.47, 0.21], [0.55, 0.21]],
      neckY: 0.27,
      // The candles stay dead: no accents.
      motion: {
        breathAmp: 0.002,
        breathPeriodMs: 7600,
        swayAmp: 0.001,
        motes: 24,
        tiltDeg: 0.3,
      },
    },
  },
];

export function bossForWeekday(weekday: number): Boss {
  const boss = BOSSES.find((b) => b.weekday === weekday);
  if (!boss) throw new Error(`No boss for weekday ${weekday}`);
  return boss;
}
