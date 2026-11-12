"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GameAudio } from "@/game/audio";
import type { Boss } from "@/game/bosses";
import { STRIKES_PER_RUN } from "@/game/config";
import { Engine } from "@/game/engine";
import type { StrikeResult } from "@/game/scoring";
import { MuteToggle } from "./ui";

export interface EncounterProps {
  boss: Boss;
  seed: string;
  mode: "daily" | "practice";
  initialResults: StrikeResult[];
  attempts: number[];
  debug: boolean;
  audio: GameAudio;
  muted: boolean;
  onToggleMute: () => void;
  onStrikeStart: (index: number) => void;
  onResult: (index: number, result: StrikeResult) => void;
  onVoid: (index: number, attempts: number[]) => void;
  onComplete: (results: StrikeResult[]) => void;
}

interface Feedback {
  id: number;
  title: string;
  detail: string;
  tone: string;
}

function feedbackFor(result: StrikeResult, id: number): Feedback {
  const { offset, score } = result;
  if (offset === null) {
    return { id, title: "Unanswered", detail: "No tap", tone: "text-blood" };
  }
  const ms = Math.round(Math.abs(offset));
  const detail = ms === 0 ? "0 ms, dead on" : `${ms} ms ${offset < 0 ? "early" : "late"}`;
  if (score >= 95) return { id, title: "True", detail, tone: "text-gold-bright" };
  if (score >= 75) return { id, title: "Clean", detail, tone: "text-moss" };
  if (score >= 40) return { id, title: "Glancing", detail, tone: "text-ember" };
  if (score > 0) return { id, title: "Grazed", detail, tone: "text-ash" };
  return { id, title: offset < 0 ? "Too early" : "Too late", detail, tone: "text-blood" };
}

function pipClass(result: StrikeResult | undefined, active: boolean): string {
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

export default function Encounter(props: EncounterProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef<HTMLPreElement>(null);
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const [results, setResults] = useState<StrikeResult[]>(props.initialResults);
  const [active, setActive] = useState<number | null>(null);
  const [intro, setIntro] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [voided, setVoided] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    if (!surface || !canvas) return;
    const p = propsRef.current;
    const collected: StrikeResult[] = [...p.initialResults];
    let feedbackId = 0;

    const engine = new Engine({
      canvas,
      boss: p.boss,
      seed: p.seed,
      startIndex: p.initialResults.length,
      attempts: p.attempts,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      audio: p.audio,
      onStrikeStart: (index) => {
        setIntro(false);
        setVoided(false);
        setFeedback(null);
        setActive(index);
        propsRef.current.onStrikeStart(index);
      },
      onResult: (index, result) => {
        collected[index] = result;
        setResults([...collected]);
        setActive(null);
        setFeedback(feedbackFor(result, ++feedbackId));
        propsRef.current.onResult(index, result);
      },
      onVoid: (index, attempts) => {
        setActive(null);
        setFeedback(null);
        setVoided(true);
        propsRef.current.onVoid(index, attempts);
      },
      onComplete: () => propsRef.current.onComplete([...collected]),
    });
    engine.start();
    p.audio.startDrone();

    const isControl = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-notap]") !== null;

    // pointerdown, never click: its timeStamp is when the finger landed.
    const onPointerDown = (e: PointerEvent) => {
      if (isControl(e.target)) return;
      e.preventDefault();
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      propsRef.current.audio.unlock();
      engine.tap(e.timeStamp);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      e.preventDefault();
      if (e.repeat) return;
      propsRef.current.audio.unlock();
      engine.tap(e.timeStamp);
    };
    // Belt and braces against double-tap zoom, scroll, selection, callouts.
    const block = (e: Event) => {
      if (!isControl(e.target)) e.preventDefault();
    };
    const blocked = ["touchstart", "touchmove", "touchend", "dblclick", "contextmenu", "selectstart", "gesturestart"];

    surface.addEventListener("pointerdown", onPointerDown, { passive: false });
    blocked.forEach((type) => surface.addEventListener(type, block, { passive: false }));
    window.addEventListener("keydown", onKeyDown);
    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(canvas);

    let debugRaf = 0;
    if (p.debug) {
      const tick = () => {
        const d = engine.debug();
        const f = (v: number | null, digits = 0) => (v === null ? "-" : v.toFixed(digits));
        if (debugRef.current) {
          debugRef.current.textContent = [
            `phase     ${d.phase}`,
            `strike    ${d.strike} (attempt ${d.attempt})`,
            `hold      ${f(d.holdMs)} ms`,
            `swing     ${f(d.swingMs)} ms`,
            `feint at  ${f(d.feintAtMs)} ms`,
            `impact at ${f(d.impactAt, 1)}`,
            `to impact ${f(d.toImpact)} ms`,
            `raw off   ${f(d.lastOffset, 2)} ms`,
          ].join("\n");
        }
        debugRaf = requestAnimationFrame(tick);
      };
      debugRaf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(debugRaf);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      surface.removeEventListener("pointerdown", onPointerDown);
      blocked.forEach((type) => surface.removeEventListener(type, block));
      engine.destroy();
      p.audio.stopDrone();
    };
  }, []);

  const { boss, mode } = props;

  return (
    <div ref={surfaceRef} className="game-surface fixed inset-0 z-10 flex justify-center bg-ink">
      <div className="relative h-dvh w-[min(100vw,50dvh)] overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 px-12 pt-[max(env(safe-area-inset-top),0.9rem)]">
          <p className="text-center font-display text-base tracking-[0.12em] text-ash uppercase">
            {mode === "practice" ? "Practice · " : ""}
            {boss.name}
          </p>
          <ol className="flex gap-3" aria-label="Strikes">
            {Array.from({ length: STRIKES_PER_RUN }, (_, i) => (
              <li
                key={i}
                aria-label={`Strike ${i + 1}${results[i] ? `: ${results[i].score}` : ""}`}
                className={`h-3.5 w-3.5 rotate-45 border transition-colors ${pipClass(results[i], active === i)}`}
              />
            ))}
          </ol>
        </div>

        <div className="absolute top-[max(env(safe-area-inset-top),0.5rem)] right-2" data-notap>
          <MuteToggle muted={props.muted} onToggle={props.onToggleMute} compact />
        </div>

        <div
          className="pointer-events-none absolute inset-x-0 top-[83%] flex flex-col items-center text-center"
          aria-live="polite"
        >
          {feedback && (
            <div key={feedback.id} className={`feedback-pop ${feedback.tone}`}>
              <p className="font-display text-2xl font-bold tracking-[0.2em] uppercase">
                {feedback.title}
              </p>
              <p className="text-xl text-bone tabular-nums">{feedback.detail}</p>
            </div>
          )}
          {voided && (
            <p className="fade-in px-6 text-lg text-ash italic">
              You looked away. That strike is void and will come again, changed.
            </p>
          )}
          {intro && (
            <div className="fade-in px-5">
              <h2 className="font-display text-2xl font-bold tracking-[0.12em] text-gold-bright uppercase">
                {boss.name}
              </h2>
              <p className="mt-1 text-xl leading-snug text-bone italic">{boss.epitaph}</p>
            </div>
          )}
        </div>

        {props.debug && (
          <pre
            ref={debugRef}
            className="pointer-events-none absolute top-20 left-2 bg-black/70 p-2 font-mono text-base leading-tight text-moss"
          />
        )}
      </div>
    </div>
  );
}
