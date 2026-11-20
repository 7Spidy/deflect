"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GameAudio } from "@/game/audio";
import type { Boss } from "@/game/bosses";
import { isPhaseShift, ROUNDS_PER_RUN, STRIKES_PER_ROUND } from "@/game/config";
import { deathblowBeat } from "@/game/copy";
import { Engine } from "@/game/engine";
import { MOVES, planDay } from "@/game/moves";
import { runScore, type StrikeResult } from "@/game/scoring";
import { staggerTrack, type DeathblowResult, type StaggerState } from "@/game/stagger";
import LeaveDialog from "./LeaveDialog";
import RoundBar from "./RoundBar";
import StaggerBar from "./StaggerBar";
import { MuteToggle } from "./ui";

export interface EncounterProps {
  boss: Boss;
  seed: string;
  mode: "daily" | "practice";
  initialResults: StrikeResult[];
  /** The Deathblow, if this run already played it. */
  initialDeathblow: DeathblowResult | null;
  attempts: number[];
  debug: boolean;
  audio: GameAudio;
  muted: boolean;
  onToggleMute: () => void;
  onStrikeStart: (index: number) => void;
  onResult: (index: number, result: StrikeResult) => void;
  onVoid: (index: number, attempts: number[]) => void;
  onDeathblow: (result: DeathblowResult) => void;
  onComplete: (results: StrikeResult[], deathblow: DeathblowResult | null) => void;
  /** The player left the fight. Daily progress is already saved by onResult/onVoid. */
  onCancel: () => void;
}

interface Feedback {
  id: number;
  title: string;
  detail: string;
  tone: string;
}

interface Banner {
  id: number;
  round: number;
  avg: number;
  /** Name of the next round's move: the guardian's telegraph. */
  next: string | null;
  leaving: boolean;
}

/** Shown while the guardian turns into its second phase. */
interface PhaseCard {
  id: number;
  line: string;
  rgb: readonly [number, number, number];
  leaving: boolean;
}

/** Consecutive True deflects ending at the last entry. */
function trailingTrue(results: readonly StrikeResult[]): number {
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i]?.score >= 95; i--) n++;
  return n;
}

function feedbackFor(result: StrikeResult, id: number, streak: number): Feedback {
  const { offset, score } = result;
  if (offset === null) {
    return { id, title: "Unanswered", detail: "No tap", tone: "text-blood" };
  }
  const ms = Math.round(Math.abs(offset));
  const detail = ms === 0 ? "0 ms, dead on" : `${ms} ms ${offset < 0 ? "early" : "late"}`;
  if (score >= 95) {
    return {
      id,
      title: "True",
      detail: streak >= 3 ? `${detail}  x${streak}` : detail,
      tone: "text-gold-bright",
    };
  }
  if (score >= 75) return { id, title: "Clean", detail, tone: "text-moss" };
  if (score >= 40) return { id, title: "Glancing", detail, tone: "text-ember" };
  if (score > 0) return { id, title: "Grazed", detail, tone: "text-ash" };
  return { id, title: offset < 0 ? "Too early" : "Too late", detail, tone: "text-blood" };
}

export default function Encounter(props: EncounterProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef<HTMLPreElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const dialogOpenRef = useRef(false);
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const [results, setResults] = useState<StrikeResult[]>(props.initialResults);
  const [active, setActive] = useState<number | null>(null);
  const [intro, setIntro] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [voided, setVoided] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [phaseCard, setPhaseCard] = useState<PhaseCard | null>(null);
  const [stagger, setStagger] = useState<StaggerState>(() => staggerTrack(props.initialResults));
  const [deathblow, setDeathblow] = useState<DeathblowResult | null>(props.initialDeathblow);
  const [staggered, setStaggered] = useState(false);
  const day = useMemo(() => planDay(props.seed, props.boss), [props.seed, props.boss]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Hold the fight and ask. A tapped strike that is already in flight is not voided.
  const openLeave = useCallback(() => {
    if (dialogOpenRef.current) return;
    dialogOpenRef.current = true;
    engineRef.current?.pause();
    setDialogOpen(true);
  }, []);

  const keepFighting = useCallback(() => {
    dialogOpenRef.current = false;
    setDialogOpen(false);
    engineRef.current?.resume();
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    if (!surface || !canvas) return;
    const p = propsRef.current;
    const plan = planDay(p.seed, p.boss);
    const collected: StrikeResult[] = [...p.initialResults];
    let blow: DeathblowResult | null = p.initialDeathblow;
    let feedbackId = 0;
    let bannerId = 0;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const engine = new Engine({
      canvas,
      boss: p.boss,
      seed: p.seed,
      startIndex: p.initialResults.length,
      attempts: p.attempts,
      priorTrueStreak: trailingTrue(p.initialResults),
      stagger: staggerTrack(p.initialResults),
      deathblow: p.initialDeathblow,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      audio: p.audio,
      onStrikeStart: (index) => {
        setIntro(false);
        setVoided(false);
        setFeedback(null);
        setActive(index);
        // The round banner fades as the next strike begins.
        setBanner((b) => (b ? { ...b, leaving: true } : b));
        setPhaseCard((c) => (c ? { ...c, leaving: true } : c));
        later(() => {
          setBanner(null);
          setPhaseCard(null);
        }, 400);
        propsRef.current.onStrikeStart(index);
      },
      onResult: (index, result) => {
        collected[index] = result;
        setResults([...collected]);
        setActive(null);
        setFeedback(feedbackFor(result, ++feedbackId, trailingTrue(collected.slice(0, index + 1))));
        propsRef.current.onResult(index, result);
      },
      onRoundEnd: (round) => {
        const from = round * STRIKES_PER_ROUND;
        const mine = collected.slice(from, from + STRIKES_PER_ROUND);
        const id = ++bannerId;
        const nextRound = round + 1;
        const next = nextRound < ROUNDS_PER_RUN ? MOVES[plan.moves[nextRound]].name : null;
        const shift = isPhaseShift(nextRound);
        setBanner({ id, round: round + 1, avg: runScore(mine), next, leaving: false });
        later(() => setBanner((b) => (b && b.id === id ? { ...b, leaving: true } : b)), shift ? 1700 : 2100);
        if (shift) {
          // The guardian turns (see PHASE_PEAK in arena.ts): its line takes the banner's place.
          const boss = propsRef.current.boss;
          later(() => setPhaseCard({ id, line: boss.phaseTwo.line, rgb: boss.phaseTwo.eye, leaving: false }), 2500);
        }
      },
      onVoid: (index, attempts) => {
        setActive(null);
        setFeedback(null);
        setVoided(true);
        propsRef.current.onVoid(index, attempts);
      },
      onStagger: (st) => setStagger(st),
      onDeathblowStart: () => {
        setIntro(false);
        setVoided(false);
        setFeedback(null);
        setBanner(null);
        setPhaseCard(null);
        setStaggered(true);
      },
      onDeathblowSlip: () => {
        setFeedback({ id: ++feedbackId, title: "Slip", detail: "One more beat", tone: "text-ash" });
      },
      onDeathblow: (result) => {
        blow = result;
        setStaggered(false);
        setDeathblow(result);
        const ms = result.offset === null ? null : Math.round(Math.abs(result.offset));
        setFeedback({
          id: ++feedbackId,
          title: result.landed ? "Deathblow" : "It recovers",
          detail:
            (ms === null
              ? "No tap"
              : ms === 0
                ? "0 ms, dead on"
                : `${ms} ms ${(result.offset ?? 0) < 0 ? "early" : "late"}`) + (result.slipped ? ", one slip" : ""),
          tone: result.landed ? "text-gold-bright" : "text-blood",
        });
        propsRef.current.onDeathblow(result);
      },
      onComplete: () => propsRef.current.onComplete([...collected], blow),
    });
    engineRef.current = engine;
    engine.start();
    p.audio.startDrone();

    const isControl = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-notap]") !== null;

    // pointerdown, never click: its timeStamp is when the finger landed.
    const onPointerDown = (e: PointerEvent) => {
      if (isControl(e.target)) return;
      e.preventDefault();
      if (dialogOpenRef.current) return;
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      propsRef.current.audio.unlock();
      engine.tap(e.timeStamp);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // The dialog handles its own Escape; otherwise Escape asks to leave.
        if (dialogOpenRef.current) return;
        e.preventDefault();
        openLeave();
        return;
      }
      if (e.code !== "Space" && e.key !== " ") return;
      // With the dialog open Space belongs to the focused button, not the blade.
      if (dialogOpenRef.current) return;
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
            `stall     ${f(d.stallAtMs)} + ${f(d.stallDurMs)} ms`,
            `impact at ${f(d.impactAt, 1)}`,
            `to impact ${f(d.toImpact)} ms`,
            `raw off   ${f(d.lastOffset, 2)} ms`,
          ].join("\n");
        }
        debugRaf = requestAnimationFrame(tick);
      };
      debugRaf = requestAnimationFrame(tick);
    }

    // A phone that sleeps mid-fight hides the page and voids the strike.
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const requestLock = async () => {
      try {
        const next = (await navigator.wakeLock?.request("screen")) ?? null;
        if (gone) void next?.release().catch(() => undefined);
        else lock = next;
      } catch {
        // unsupported, or the browser refused: the fight still works
      }
    };
    void requestLock();
    const onVisible = () => {
      if (document.visibilityState === "visible") void requestLock();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
      timers.forEach((id) => window.clearTimeout(id));
      cancelAnimationFrame(debugRaf);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      surface.removeEventListener("pointerdown", onPointerDown);
      blocked.forEach((type) => surface.removeEventListener(type, block));
      engine.destroy();
      engineRef.current = null;
      p.audio.stopDrone();
    };
  }, [openLeave]);

  const { boss, mode } = props;

  return (
    <div ref={surfaceRef} className="game-surface fixed inset-0 z-10 flex justify-center bg-ink">
      <div className="relative h-dvh w-[min(100vw,50dvh)] overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 px-14 pt-[max(env(safe-area-inset-top),0.9rem)]">
          <RoundBar boss={boss} practice={mode === "practice"} results={results} active={active} />
          <StaggerBar state={stagger} deathblow={deathblow} />
          {intro && (
            <p className="fade-in mt-1 text-center text-lg leading-snug text-ash [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">
              <span className="font-display tracking-[0.14em] text-gold uppercase">{day.omen.name}</span>
              <br />
              <span className="italic">{day.omen.line}</span>
            </p>
          )}
        </div>

        <div className="absolute top-[max(env(safe-area-inset-top),0.5rem)] left-2" data-notap>
          <MuteToggle muted={props.muted} onToggle={props.onToggleMute} compact />
        </div>
        <div className="absolute top-[max(env(safe-area-inset-top),0.5rem)] right-2" data-notap>
          <button
            type="button"
            onClick={openLeave}
            aria-label="Leave the fight"
            className="btn btn-quiet min-h-11 min-w-11 px-3"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {banner && (
          <div
            key={banner.id}
            className={`pointer-events-none absolute inset-x-0 top-[40%] flex flex-col items-center text-center transition-opacity duration-300 [text-shadow:0_1px_10px_rgba(0,0,0,0.95),0_0_2px_rgba(0,0,0,0.9)] ${
              banner.leaving ? "opacity-0" : "opacity-100"
            }`}
            aria-live="polite"
          >
            <p className="fade-in font-display text-xl tracking-[0.22em] text-gold-bright uppercase">
              Round {banner.round} of {ROUNDS_PER_RUN}
            </p>
            <p className="fade-in text-xl text-bone tabular-nums">avg {banner.avg}</p>
            {banner.next && (
              <p className="fade-in mt-3 text-lg text-ash italic">
                Next <span className="not-italic text-bone">·</span> {banner.next}
              </p>
            )}
          </div>
        )}

        {staggered && (
          <div
            className="pointer-events-none absolute inset-x-0 top-[40%] flex flex-col items-center px-6 text-center [text-shadow:0_1px_10px_rgba(0,0,0,0.95)]"
            aria-live="assertive"
          >
            <p className="fade-in font-display text-3xl font-bold tracking-[0.2em] text-blood uppercase">Staggered</p>
            <p className="fade-in mt-1 text-xl text-bone italic">Strike on the {deathblowBeat()}.</p>
          </div>
        )}

        {phaseCard && (
          <div
            key={`phase-${phaseCard.id}`}
            className={`pointer-events-none absolute inset-x-0 top-[40%] flex flex-col items-center px-6 text-center [text-shadow:0_1px_10px_rgba(0,0,0,0.95)] transition-opacity duration-300 ${
              phaseCard.leaving ? "opacity-0" : "opacity-100"
            }`}
            aria-live="polite"
          >
            <p className="fade-in font-display text-base tracking-[0.3em] text-ash uppercase">Phase two</p>
            <p
              className="fade-in mt-1 font-display text-2xl font-bold tracking-[0.08em] uppercase"
              style={{ color: `rgb(${phaseCard.rgb.join(",")})`, textShadow: `0 0 18px rgba(${phaseCard.rgb.join(",")},0.55)` }}
            >
              {phaseCard.line}
            </p>
          </div>
        )}

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
              That strike is void and will come again, changed.
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
            className="pointer-events-none absolute top-24 left-2 bg-black/70 p-2 font-mono text-base leading-tight text-moss"
          />
        )}

        {dialogOpen && (
          <LeaveDialog mode={mode} onKeep={keepFighting} onLeave={props.onCancel} />
        )}
      </div>
    </div>
  );
}
