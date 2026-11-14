"use client";

import { useEffect, useState } from "react";
import type { Boss } from "@/game/bosses";
import { MISS_WINDOW_MS, PERFECT_WINDOW_MS } from "@/game/config";
import { dailySeed, msUntilNextLocalDay, toDateString } from "@/game/daily";
import { MOVES, planDay } from "@/game/moves";
import {
  bestWorst,
  biasOf,
  biasSentence,
  GRADE_TITLES,
  gradeFor,
  offsetPhrase,
  runScore,
  tierLine,
  type StrikeResult,
} from "@/game/scoring";
import { scoreColor } from "@/game/shareImage";
import { staggerPeak, type DeathblowResult } from "@/game/stagger";
import ShareActions from "./ShareActions";
import { Footer, Logo } from "./ui";

export interface ResultsProps {
  mode: "daily" | "practice";
  boss: Boss;
  puzzle: number;
  /** The date this run belongs to (daily only). */
  date: string;
  results: StrikeResult[];
  deathblow: DeathblowResult | null;
  hasDailyResult: boolean;
  onPractice: () => void;
  onShowDaily: () => void;
  onStats: () => void;
}

/** Dots stagger over 6 rows of 12 units, so any strike count stays on the axis. */
const STAGGER_ROWS = 6;
const ROW_H = 12;

function Timeline({ results }: { results: StrikeResult[] }) {
  const W = 600;
  const x0 = 24;
  const x1 = W - 24;
  const mid = W / 2;
  const scale = (x1 - x0) / 2 / MISS_WINDOW_MS;
  const rows = Math.min(STAGGER_ROWS, Math.max(1, results.length));
  const top = 22;
  const axisY = top + (rows - 1) * ROW_H + 14;
  const height = axisY + 54;
  const r = results.length > 12 ? 6 : 9;
  const k = r / 9;
  const ticks = [-300, -150, 0, 150, 300];
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Timeline of taps from 300 milliseconds early to 300 milliseconds late. ${results
        .map((res, i) =>
          res.offset === null
            ? `Strike ${i + 1}: no tap.`
            : `Strike ${i + 1}: ${Math.round(Math.abs(res.offset))} milliseconds ${res.offset < 0 ? "early" : "late"}.`,
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
      {results.map((res, i) => {
        if (res.offset === null) return null;
        const out = Math.abs(res.offset) > MISS_WINDOW_MS;
        const x = mid + Math.max(-MISS_WINDOW_MS, Math.min(MISS_WINDOW_MS, res.offset)) * scale;
        const y = top + (i % STAGGER_ROWS) * ROW_H;
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={x} y2={axisY} stroke={scoreColor(res.score)} strokeWidth="2" opacity="0.4" />
            {out ? (
              <path
                d={
                  res.offset < 0
                    ? `M${x + 12 * k} ${y - 10 * k} L${x - 6 * k} ${y} L${x + 12 * k} ${y + 10 * k}z`
                    : `M${x - 12 * k} ${y - 10 * k} L${x + 6 * k} ${y} L${x - 12 * k} ${y + 10 * k}z`
                }
                fill={scoreColor(res.score)}
              />
            ) : (
              <circle cx={x} cy={y} r={r} fill={scoreColor(res.score)} stroke="#060508" strokeWidth="2" />
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
  const extremes = bestWorst(results);
  const day = mode === "daily" ? planDay(dailySeed(date), boss) : null;
  const blow = props.deathblow;
  const blowMs = blow?.offset === null || blow?.offset === undefined ? null : Math.round(Math.abs(blow.offset));

  return (
    <main className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[32rem] flex-col px-5 pt-[max(env(safe-area-inset-top),1.25rem)]">
      <div className="rise-in flex flex-1 flex-col items-center gap-4 text-center">
        <Logo small />
        <p className="font-display text-base tracking-[0.2em] text-ash uppercase">
          {mode === "daily" ? `No. ${puzzle}` : "Practice"} · {boss.name}
        </p>
        {day && (
          <p className="-mt-3 text-lg text-ash italic">
            {day.omen.name}, favouring {MOVES[day.signature].name}
          </p>
        )}

        <section aria-label="Grade" className="flex flex-col items-center">
          <p className="logo text-[6rem] leading-none font-black" style={{ letterSpacing: 0, marginRight: 0 }}>
            {grade}
          </p>
          <h2 className="mt-1 font-display text-3xl font-bold tracking-[0.18em] text-gold-bright uppercase">
            {GRADE_TITLES[grade]}
          </h2>
          <p className="mt-1 text-xl text-bone">
            Score <span className="tabular-nums">{score}</span> of 100
          </p>
          <p className={`mt-2 text-xl ${blow?.landed ? "text-gold-bright" : blow ? "text-blood" : "text-ash"}`}>
            {blow?.landed
              ? `⚔ Deathblow landed${blowMs === null ? "" : `, ${blowMs === 0 ? "dead on" : `${blowMs} ms ${(blow.offset ?? 0) < 0 ? "early" : "late"}`}`}`
              : blow
                ? `Staggered it, but the Deathblow ${blowMs === null ? "never came" : "missed"}`
                : `Never staggered (meter peaked at ${staggerPeak(results)})`}
          </p>
        </section>

        <section aria-label="Timing" className="w-full">
          <Timeline results={results} />
          <p className="mt-1 text-xl text-bone italic">{biasSentence(bias)}</p>
        </section>

        <section aria-label="Summary" className="flex flex-col gap-0.5 text-lg text-ash">
          <p className="text-bone tabular-nums">{tierLine(results)}</p>
          {extremes && (
            <>
              <p>
                Best: strike {extremes.best.index + 1},{" "}
                <span className="text-bone">{offsetPhrase(extremes.best.result)}</span>
              </p>
              <p>
                Worst: strike {extremes.worst.index + 1},{" "}
                <span className="text-bone">{offsetPhrase(extremes.worst.result)}</span>
              </p>
            </>
          )}
        </section>

        <div className="flex flex-col items-center gap-3">
          {mode === "daily" && <ShareActions
              puzzle={puzzle}
              bossName={boss.name}
              results={results}
              omen={day?.omen.name}
              deathblow={blow}
            />}
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
        </div>

        <details className="w-full max-w-sm text-left">
          <summary className="cursor-pointer text-center font-display text-base tracking-[0.18em] text-ash uppercase">
            All strikes
          </summary>
          <ol className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1 text-base tabular-nums">
            {results.map((r, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 border-b border-bone/10 py-1">
                <span className="text-ash">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-2.5 w-2.5 rotate-45"
                    style={{ background: scoreColor(r.score) }}
                  />
                  {i + 1}
                </span>
                <span className="text-bone">{offsetPhrase(r)}</span>
                <span className="w-7 text-right text-bone">{r.score}</span>
              </li>
            ))}
          </ol>
        </details>

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
