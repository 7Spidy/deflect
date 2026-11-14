import { GAME_NAME, STRIKES_PER_ROUND } from "./config";
import {
  biasOf,
  gradeFor,
  leanOf,
  runScore,
  strikeEmoji,
  type StrikeResult,
} from "./scoring";
import type { DeathblowResult } from "./stagger";

/**
 * Plain-text share block. No em dashes. One emoji per round (the round's
 * average, same cut-offs as a strike), so ten rounds make one row of ten,
 * then the Deathblow mark: ⚔️ landed, 💨 missed, nothing if it never came.
 *
 *   Dflect Everywhere #12 · A (88) · Blood Moon
 *   🟡🟢🟢🟠🟢🟡🟢🟢🟡🟢 ⚔️
 *   Avg 41ms off, leaning early
 *   <site url>
 */
export const SHARE_ROW = 10;
export const DEATHBLOW_LANDED = "⚔️";
export const DEATHBLOW_MISSED = "💨";

/** Average score of each round, in order. A partial last round averages what it has. */
export function roundScores(results: readonly StrikeResult[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < results.length; i += STRIKES_PER_ROUND) {
    out.push(runScore(results.slice(i, i + STRIKES_PER_ROUND)));
  }
  return out;
}

export function buildShareText(
  puzzle: number,
  results: readonly StrikeResult[],
  siteUrl: string,
  /** The day's omen name, so shares from different days read differently. */
  omen?: string,
  deathblow: DeathblowResult | null = null,
): string {
  const score = runScore(results);
  const bias = biasOf(results);
  const lean = leanOf(bias.meanSigned);
  const biasLine =
    bias.count === 0
      ? "No clean taps"
      : `Avg ${Math.round(bias.meanAbs)}ms off, ${
          lean === "even" ? "no lean" : `leaning ${lean}`
        }`;
  const emoji = roundScores(results).map(strikeEmoji);
  const rows: string[] = [];
  for (let i = 0; i < emoji.length; i += SHARE_ROW) {
    rows.push(emoji.slice(i, i + SHARE_ROW).join(""));
  }
  if (deathblow && rows.length) {
    rows[rows.length - 1] += ` ${deathblow.landed ? DEATHBLOW_LANDED : DEATHBLOW_MISSED}`;
  }
  const head = `${GAME_NAME} #${puzzle} · ${gradeFor(score)} (${score})${omen ? ` · ${omen}` : ""}`;
  return [head, ...rows, biasLine, siteUrl].join("\n");
}
