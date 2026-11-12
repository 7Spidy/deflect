import {
  biasOf,
  gradeFor,
  leanOf,
  runScore,
  strikeEmoji,
  type StrikeResult,
} from "./scoring";

/**
 * Plain-text share block. No em dashes.
 *
 *   Deflect #12 · A (88)
 *   🟡🟢🟡🟠🟢
 *   Avg 41ms off, leaning early
 *   <site url>
 */
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
  return [
    `Deflect #${puzzle} · ${gradeFor(score)} (${score})`,
    results.map((r) => strikeEmoji(r.score)).join(""),
    biasLine,
    siteUrl,
  ].join("\n");
}
