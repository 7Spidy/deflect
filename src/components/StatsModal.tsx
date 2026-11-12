"use client";

import { useEffect, useRef } from "react";
import { GRADES, leanOf } from "@/game/scoring";
import { liveStreak, type Stats } from "@/game/stats";

export default function StatsModal({
  stats,
  today,
  onClose,
}: {
  stats: Stats;
  today: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const maxGrade = Math.max(1, ...GRADES.map((g) => stats.grades[g]));
  const hasTaps = stats.tapCount > 0;
  const avgAbs = hasTaps ? Math.round(stats.absOffsetSum / stats.tapCount) : 0;
  const avgSigned = hasTaps ? stats.signedOffsetSum / stats.tapCount : 0;
  const lean = leanOf(avgSigned);

  const figures: Array<[label: string, value: string]> = [
    ["Played", String(stats.played)],
    ["Streak", String(liveStreak(stats, today))],
    ["Best streak", String(stats.bestStreak)],
  ];

  return (
    <div
      className="fade-in fixed inset-0 z-30 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
        className="max-h-full w-full max-w-md overflow-y-auto border border-gold/40 bg-pitch p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="stats-title" className="text-center font-display text-2xl font-bold tracking-[0.2em] text-gold-bright uppercase">
          Records
        </h2>

        <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
          {figures.map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse">
              <dt className="text-base text-ash">{label}</dt>
              <dd className="font-display text-4xl text-bone tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-6 font-display text-base tracking-[0.2em] text-ash uppercase">Grades</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {GRADES.map((g) => (
            <li key={g} className="flex items-center gap-3 text-lg">
              <span className="w-5 font-display font-bold text-gold-bright">{g}</span>
              <span className="h-4 flex-1 bg-bone/8">
                <span
                  className="block h-full bg-gold"
                  style={{ width: `${(stats.grades[g] / maxGrade) * 100}%` }}
                />
              </span>
              <span className="w-8 text-right text-bone tabular-nums">{stats.grades[g]}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-6 font-display text-base tracking-[0.2em] text-ash uppercase">Timing</h3>
        {hasTaps ? (
          <p className="mt-2 text-lg text-bone">
            Lifetime average <span className="tabular-nums">{avgAbs}ms</span> from impact.{" "}
            {lean === "even"
              ? "No lean, early or late."
              : `You lean ${Math.round(Math.abs(avgSigned))}ms ${lean}.`}
          </p>
        ) : (
          <p className="mt-2 text-lg text-ash">No taps recorded yet.</p>
        )}

        <div className="mt-6 flex justify-center">
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
