import type { Boss } from "@/game/bosses";
import { ROUNDS_PER_RUN, roundOf, STRIKES_PER_ROUND, STRIKES_PER_RUN } from "@/game/config";
import type { StrikeResult } from "@/game/scoring";

/** Cell colour for one strike. Active cells glow. */
export function pipClass(result: StrikeResult | undefined, active: boolean): string {
  if (!result) {
    return active
      ? "border-gold-bright bg-gold/30 shadow-[0_0_10px_rgba(243,220,154,0.7)]"
      : "border-ash/50 bg-transparent";
  }
  if (result.score >= 95) return "border-gold-bright bg-gold-bright";
  if (result.score >= 75) return "border-moss bg-moss";
  if (result.score >= 40) return "border-ember bg-ember";
  return "border-blood/80 bg-blood/40";
}

/**
 * Progress for any run shape: ROUNDS_PER_RUN segments, each holding
 * STRIKES_PER_ROUND cells. Nothing here hardcodes a count.
 */
export default function RoundBar({
  boss,
  practice,
  results,
  active,
}: {
  boss: Boss;
  practice: boolean;
  results: StrikeResult[];
  active: number | null;
}) {
  const cursor = active ?? Math.min(results.length, STRIKES_PER_RUN - 1);
  const round = roundOf(cursor) + 1;
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <div className="text-center font-display uppercase">
        <p className="text-sm tracking-[0.2em] text-bone">
          {practice ? "Practice · " : ""}Round {round} of {ROUNDS_PER_RUN}
        </p>
        <p className="text-xs tracking-[0.12em] text-ash">
          <span className="sr-only"> · </span>
          {boss.name}
        </p>
      </div>
      <ol className="flex w-full max-w-[17rem] gap-1.5" aria-label="Rounds">
        {Array.from({ length: ROUNDS_PER_RUN }, (_, r) => (
          <li
            key={r}
            aria-label={`Round ${r + 1}`}
            className={`flex flex-1 gap-0.5 ${r === round - 1 ? "opacity-100" : "opacity-80"}`}
          >
            {Array.from({ length: STRIKES_PER_ROUND }, (_, k) => {
              const i = r * STRIKES_PER_ROUND + k;
              return (
                <span
                  key={i}
                  role="img"
                  aria-label={`Strike ${i + 1}${results[i] ? `: ${results[i].score}` : ""}`}
                  className={`h-2.5 min-w-0 flex-1 border transition-colors ${pipClass(results[i], active === i)}`}
                />
              );
            })}
          </li>
        ))}
      </ol>
    </div>
  );
}
