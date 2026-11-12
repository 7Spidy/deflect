"use client";

import { useEffect, useRef, useState } from "react";
import type { Boss } from "@/game/bosses";
import { MISS_WINDOW_MS, PERFECT_WINDOW_MS } from "@/game/config";
import { msUntilNextLocalDay, toDateString } from "@/game/daily";
import {
  biasOf,
  biasSentence,
  GRADE_TITLES,
  gradeFor,
  runScore,
  type StrikeResult,
} from "@/game/scoring";
import { buildShareText } from "@/game/share";
import { renderShareImage, scoreColor } from "@/game/shareImage";
import { Footer, Logo } from "./ui";

export interface ResultsProps {
  mode: "daily" | "practice";
  boss: Boss;
  puzzle: number;
  /** The date this run belongs to (daily only). */
  date: string;
  results: StrikeResult[];
  hasDailyResult: boolean;
  onPractice: () => void;
  onShowDaily: () => void;
  onStats: () => void;
}

function Timeline({ results }: { results: StrikeResult[] }) {
  const W = 600;
  const x0 = 24;
  const x1 = W - 24;
  const mid = W / 2;
  const scale = (x1 - x0) / 2 / MISS_WINDOW_MS;
  const axisY = 96;
  const ticks = [-300, -150, 0, 150, 300];
  return (
    <svg
      viewBox={`0 0 ${W} 150`}
      className="w-full"
      role="img"
      aria-label={`Timeline of taps from 300 milliseconds early to 300 milliseconds late. ${results
        .map((r, i) =>
          r.offset === null
            ? `Strike ${i + 1}: no tap.`
            : `Strike ${i + 1}: ${Math.round(Math.abs(r.offset))} milliseconds ${r.offset < 0 ? "early" : "late"}.`,
        )
        .join(" ")}`}
    >
      <rect
        x={mid - PERFECT_WINDOW_MS * scale}
        y={10}
        width={PERFECT_WINDOW_MS * 2 * scale}
        height={axisY - 10}
        fill="rgba(212,175,55,0.2)"
      />
      <line x1={x0} y1={axisY} x2={x1} y2={axisY} stroke="rgba(222,214,198,0.55)" strokeWidth="2" />
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={mid + t * scale}
            y1={t === 0 ? 6 : axisY - 7}
            x2={mid + t * scale}
            y2={axisY + 7}
            stroke={t === 0 ? "#d4af37" : "rgba(222,214,198,0.55)"}
            strokeWidth="2"
          />
          <text
            x={mid + t * scale}
            y={axisY + 42}
            textAnchor={t === -300 ? "start" : t === 300 ? "end" : "middle"}
            fontSize="30"
            fill="#a39cae"
            fontFamily="var(--font-garamond), serif"
          >
            {t > 0 ? `+${t}` : t}
          </text>
        </g>
      ))}
      {results.map((r, i) => {
        if (r.offset === null) return null;
        const out = Math.abs(r.offset) > MISS_WINDOW_MS;
        const x = mid + Math.max(-MISS_WINDOW_MS, Math.min(MISS_WINDOW_MS, r.offset)) * scale;
        const y = 22 + i * 15;
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={x} y2={axisY} stroke={scoreColor(r.score)} strokeWidth="2" opacity="0.6" />
            {out ? (
              <path
                d={r.offset < 0 ? `M${x + 12} ${y - 10} L${x - 6} ${y} L${x + 12} ${y + 10}z` : `M${x - 12} ${y - 10} L${x + 6} ${y} L${x - 12} ${y + 10}z`}
                fill={scoreColor(r.score)}
              />
            ) : (
              <circle cx={x} cy={y} r="9" fill={scoreColor(r.score)} stroke="#060508" strokeWidth="2" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function Countdown({ date }: { date: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!now) return <p className="text-lg text-ash">&nbsp;</p>;
  if (toDateString(now) !== date) {
    return (
      <button type="button" className="btn" onClick={() => window.location.assign(window.location.pathname)}>
        A new foe waits
      </button>
    );
  }
  return (
    <p className="text-lg text-ash">
      Next foe in{" "}
      <span className="font-display text-xl text-bone tabular-nums">
        {formatCountdown(msUntilNextLocalDay(now))}
      </span>
    </p>
  );
}

export default function Results(props: ResultsProps) {
  const { mode, boss, puzzle, results, date } = props;
  const score = runScore(results);
  const grade = gradeFor(score);
  const bias = biasOf(results);
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const imageRef = useRef<File | null>(null);

  // Pre-render the share card so the share sheet opens inside the tap gesture.
  useEffect(() => {
    if (mode !== "daily") return;
    let cancelled = false;
    renderShareImage({
      puzzle,
      bossName: boss.name,
      results,
      siteLabel: window.location.host,
    })
      .then((file) => {
        if (!cancelled) imageRef.current = file;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, puzzle, boss, results]);

  const share = async () => {
    const text = buildShareText(puzzle, results, window.location.origin);
    if (typeof navigator.share === "function") {
      try {
        const file = imageRef.current;
        if (file && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ text, files: [file] });
        } else {
          await navigator.share({ text });
        }
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // otherwise fall through to the clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
    window.setTimeout(() => setShareState("idle"), 2200);
  };

  return (
    <main className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[32rem] flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)]">
      <div className="rise-in flex flex-1 flex-col items-center gap-6 text-center">
        <Logo small />
        <p className="font-display text-base tracking-[0.2em] text-ash uppercase">
          {mode === "daily" ? `No. ${puzzle}` : "Practice"} · {boss.name}
        </p>

        <section aria-label="Grade" className="flex flex-col items-center">
          <p className="logo text-[7rem] leading-none font-black" style={{ letterSpacing: 0, marginRight: 0 }}>
            {grade}
          </p>
          <h2 className="mt-1 font-display text-3xl font-bold tracking-[0.18em] text-gold-bright uppercase">
            {GRADE_TITLES[grade]}
          </h2>
          <p className="mt-1 text-xl text-bone">
            Score <span className="tabular-nums">{score}</span> of 100
          </p>
        </section>

        <section aria-label="Timing" className="w-full">
          <Timeline results={results} />
          <p className="mt-2 text-xl text-bone italic">{biasSentence(bias)}</p>
        </section>

        <table className="w-full max-w-sm border-collapse text-left text-lg tabular-nums">
          <caption className="sr-only">Each strike</caption>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-bone/10">
                <th scope="row" className="py-1.5 pr-3 font-normal text-ash">
                  <span
                    aria-hidden="true"
                    className="mr-3 inline-block h-3 w-3 rotate-45"
                    style={{ background: scoreColor(r.score) }}
                  />
                  Strike {i + 1}
                </th>
                <td className="py-1.5 text-bone">
                  {r.offset === null
                    ? "no tap"
                    : Math.round(r.offset) === 0
                      ? "dead on"
                      : `${Math.round(Math.abs(r.offset))} ms ${r.offset < 0 ? "early" : "late"}`}
                </td>
                <td className="py-1.5 text-right text-bone">{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col items-center gap-3">
          {mode === "daily" && (
            <button type="button" className="btn btn-primary" onClick={share}>
              {shareState === "copied" ? "Copied" : shareState === "failed" ? "Could not share" : "Share"}
            </button>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" className={mode === "practice" ? "btn btn-primary" : "btn"} onClick={props.onPractice}>
              {mode === "practice" ? "Practice again" : "Practice"}
            </button>
            {mode === "practice" && props.hasDailyResult && (
              <button type="button" className="btn" onClick={props.onShowDaily}>
                Today&apos;s result
              </button>
            )}
            <button type="button" className="btn" onClick={props.onStats}>
              Records
            </button>
          </div>
          <span className="sr-only" role="status">
            {shareState === "copied" ? "Result copied to clipboard" : ""}
          </span>
        </div>

        {mode === "daily" ? (
          <Countdown date={date} />
        ) : (
          <p className="text-lg text-ash">Practice never touches your records or streak.</p>
        )}
      </div>
      <Footer />
    </main>
  );
}
