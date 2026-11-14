import { STAGGER_MAX, type DeathblowResult, type StaggerState } from "@/game/stagger";

/**
 * The guardian's stagger meter, under the round bar. Fills from the centre out
 * (as a posture bar does), glows when close, burns red when broken, and turns
 * gold once the Deathblow lands.
 */
export default function StaggerBar({
  state,
  deathblow,
}: {
  state: StaggerState;
  deathblow: DeathblowResult | null;
}) {
  const pct = Math.round((state.value / STAGGER_MAX) * 100);
  const broken = state.brokeAt !== null;
  const near = !broken && pct >= 80;
  let fill = "bg-gradient-to-r from-ember via-gold-bright to-ember";
  let label = "Stagger";
  if (broken && !deathblow) {
    fill = "bg-blood";
    label = "Staggered";
  } else if (deathblow?.landed) {
    fill = "bg-gold-bright";
    label = "Deathblow";
  } else if (deathblow) {
    fill = "bg-ash/60";
    label = "Recovered";
  }
  return (
    <div
      className="flex w-full max-w-[17rem] flex-col items-center gap-1"
      role="meter"
      aria-label={`${label}: ${pct} of 100`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="relative h-1.5 w-full overflow-hidden bg-ash/20">
        <div
          className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-[width] duration-300 ease-out ${fill} ${
            near ? "animate-pulse shadow-[0_0_10px_rgba(243,220,154,0.8)]" : ""
          } ${broken && !deathblow ? "shadow-[0_0_12px_rgba(217,87,74,0.9)]" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="font-display text-xs tracking-[0.2em] text-ash uppercase">{label}</p>
    </div>
  );
}
