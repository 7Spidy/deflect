import {
  biasOf,
  gradeFor,
  leanOf,
  runScore,
  strikeEmoji,
  type StrikeResult,
} from "./scoring";

/**
 * Plain-text share block. No em dashes. The emoji grid wraps in rows of
 * SHARE_ROW, chronological, so 30 strikes make three rows:
 *
 *   Deflect #12 · A (88)
 *   🟡🟢🟡🟠🟢🟡🟢🟡🟡🟢
 *   🟡🟢🟡🟠🟢🟡🟢🟡🟡🟢
 *   🟡🟢🟡🟠🟢🟡🟢🟡🟡🟢
 *   Avg 41ms off, leaning early
 *   <site url>
 */
export const SHARE_ROW = 10;

export function buildShareText(
  puzzle: number,
  results: readonly StrikeResult[],
  siteUrl: string,
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
  const emoji = results.map((r) => strikeEmoji(r.score));
  const rows: string[] = [];
  for (let i = 0; i < emoji.length; i += SHARE_ROW) {
    rows.push(emoji.slice(i, i + SHARE_ROW).join(""));
  }
  return [`Deflect #${puzzle} · ${gradeFor(score)} (${score})`, ...rows, biasLine, siteUrl].join("\n");
}
