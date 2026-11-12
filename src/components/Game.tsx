"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameAudio } from "@/game/audio";
import { BOSSES, type Boss } from "@/game/bosses";
import { ROUNDS_PER_RUN, roundOf, STRIKES_PER_RUN } from "@/game/config";
import { howToStrikes, tagline } from "@/game/copy";
import {
  bossForDate,
  dailySeed,
  isValidDateString,
  puzzleNumber,
  toDateString,
  WEEKDAY_NAMES,
  weekdayOf,
} from "@/game/daily";
import type { StrikeResult } from "@/game/scoring";
import { applyRun, emptyStats, type Stats } from "@/game/stats";
import {
  clearDaily,
  hasSeenHowTo,
  loadDaily,
  loadMuted,
  loadStats,
  markHowToSeen,
  pruneDaily,
  saveDaily,
  saveMuted,
  saveStats,
  type DailyRecord,
} from "@/game/storage";
import Encounter from "./Encounter";
import GuardianPortrait from "./GuardianPortrait";
import Results from "./Results";
import StatsModal from "./StatsModal";
import { Footer, Logo, MuteToggle } from "./ui";

type Screen = "loading" | "title" | "howto" | "encounter" | "results";

interface Boot {
  /** The date being played: the local date, or the debug override. */
  date: string;
  debug: boolean;
  /** True when ?date= is overriding the real date. Such runs skip stats. */
  override: boolean;
  boss: Boss;
  puzzle: number;
}

interface Run {
  id: number;
  mode: "daily" | "practice";
  boss: Boss;
  seed: string;
  initialResults: StrikeResult[];
  attempts: number[];
}

interface Finished {
  mode: "daily" | "practice";
  boss: Boss;
  results: StrikeResult[];
}

export default function Game() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [daily, setDaily] = useState<DailyRecord | null>(null);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [run, setRun] = useState<Run | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [muted, setMuted] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const dailyRef = useRef<DailyRecord | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const audio = () => (audioRef.current ??= new GameAudio(loadMuted()));

  // Everything date- and storage-dependent is client only.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const debug = params.get("debug") === "1";
    const requested = params.get("date");
    const override = debug && isValidDateString(requested);
    const date = override ? (requested as string) : toDateString(new Date());
    const boss = bossForDate(date);
    const record = loadDaily(date);
    if (!override) pruneDaily(date);
    dailyRef.current = record;
    setBoot({ date, debug, override, boss, puzzle: puzzleNumber(date) });
    setDaily(record);
    setStats(loadStats());
    setMuted(loadMuted());
    if (record.done) {
      setFinished({ mode: "daily", boss, results: record.results });
      setScreen("results");
    } else {
      setScreen("title");
    }
  }, []);

  const updateDaily = useCallback((fn: (rec: DailyRecord) => DailyRecord) => {
    if (!dailyRef.current) return;
    const next = fn(dailyRef.current);
    dailyRef.current = next;
    saveDaily(next);
    setDaily(next);
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    saveMuted(next);
    audio().setMuted(next);
  };

  const launchDaily = () => {
    const rec = dailyRef.current;
    if (!boot || !rec) return;
    setRun({
      id: Date.now(),
      mode: "daily",
      boss: boot.boss,
      seed: dailySeed(boot.date),
      initialResults: rec.results,
      attempts: rec.attempts,
    });
    setScreen("encounter");
  };

  const begin = () => {
    audio().unlock();
    if (!hasSeenHowTo()) {
      setScreen("howto");
      return;
    }
    launchDaily();
  };

  const startPractice = () => {
    audio().unlock();
    setRun({
      id: Date.now(),
      mode: "practice",
      boss: BOSSES[Math.floor(Math.random() * BOSSES.length)],
      seed: `practice:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      initialResults: [],
      attempts: new Array<number>(STRIKES_PER_RUN).fill(0),
    });
    setScreen("encounter");
  };

  const onStrikeStart = (index: number) => {
    if (run?.mode !== "daily") return;
    updateDaily((rec) => ({ ...rec, inProgress: index }));
  };

  // Saved the moment each strike resolves, so a refresh cannot reroll it.
  const onResult = (index: number, result: StrikeResult) => {
    if (run?.mode !== "daily" || !boot) return;
    updateDaily((rec) => {
      const results = [...rec.results.slice(0, index), result];
      return { ...rec, results, inProgress: null, done: results.length >= STRIKES_PER_RUN };
    });
    const rec = dailyRef.current;
    if (rec?.done && !boot.override) {
      const next = applyRun(loadStats(), boot.date, rec.results);
      saveStats(next);
      setStats(next);
    }
  };

  const onVoid = (_index: number, attempts: number[]) => {
    if (run?.mode !== "daily") return;
    updateDaily((rec) => ({ ...rec, attempts, inProgress: null }));
  };

  const onComplete = (results: StrikeResult[]) => {
    if (!run) return;
    setFinished({ mode: run.mode, boss: run.boss, results });
    setRun(null);
    setScreen("results");
  };

  // Leaving a fight. Daily progress was already saved by onResult/onVoid, so the
  // title screen shows Continue at the right round. Practice just goes home.
  const onCancel = () => {
    const rec = dailyRef.current;
    setRun(null);
    if (run?.mode === "daily" && rec?.done) {
      // The last strike landed while the dialog was open: there is nothing to continue.
      setFinished({ mode: "daily", boss: boot?.boss ?? run.boss, results: rec.results });
      setScreen("results");
      return;
    }
    setScreen("title");
  };

  if (!boot || screen === "loading") {
    return (
      <>
        <div className="fog" aria-hidden="true" />
        <main className="relative z-[1] flex min-h-dvh items-center justify-center opacity-40">
          <Logo />
        </main>
      </>
    );
  }

  const partial = (daily?.results.length ?? 0) > 0;

  return (
    <>
      <div className="fog" aria-hidden="true" />

      {screen === "title" && (
        <main className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[32rem] flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)]">
          <div className="rise-in flex flex-1 flex-col items-center justify-center gap-9 text-center">
            <Logo />
            <p className="-mt-3 text-xl text-ash italic">{tagline()}</p>

            <section aria-label="Today's foe" className="relative isolate flex flex-col items-center gap-1">
              {boot.boss.art && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-[-6rem] left-1/2 -z-10 h-[26rem] w-[22rem] -translate-x-1/2 overflow-hidden opacity-40 [mask-image:linear-gradient(to_bottom,black_40%,transparent)]"
                >
                  <GuardianPortrait
                    boss={boot.boss}
                    seed={dailySeed(boot.date)}
                    className="h-[39rem] w-[22rem]"
                  />
                </div>
              )}
              <p className="font-display text-base tracking-[0.24em] text-ash uppercase">
                No. {boot.puzzle} · {WEEKDAY_NAMES[weekdayOf(boot.date)]}
              </p>
              <h2 className="font-display text-3xl font-bold tracking-[0.1em] text-bone uppercase">
                {boot.boss.name}
              </h2>
              <p className="text-xl text-ash italic">{boot.boss.epitaph}</p>
            </section>

            <div className="relative flex flex-col items-center gap-3">
              <button type="button" className="btn btn-primary" onClick={begin}>
                {partial ? "Continue" : "Begin"}
              </button>
              {partial && (
                <p className="text-lg text-ash">
                  Round {roundOf(daily?.results.length ?? 0) + 1} of {ROUNDS_PER_RUN} awaits.
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" className="btn btn-quiet" onClick={() => setShowStats(true)}>
                  Records
                </button>
                <MuteToggle muted={muted} onToggle={toggleMute} />
              </div>
            </div>

            {boot.debug && <DebugPanel date={boot.date} override={boot.override} />}
          </div>
          <Footer />
        </main>
      )}

      {screen === "howto" && (
        <main className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[32rem] flex-col items-center justify-center gap-8 px-6 text-center">
          <h2 className="rise-in font-display text-2xl font-bold tracking-[0.2em] text-gold-bright uppercase">
            How to deflect
          </h2>
          <ol className="rise-in flex flex-col gap-5 text-2xl leading-snug text-bone">
            <li>The foe raises a blade, waits, then swings.</li>
            <li>
              Tap once, the instant steel meets the <span className="text-gold-bright">gold line</span>.
            </li>
            <li>{howToStrikes()}</li>
          </ol>
          <button
            type="button"
            className="btn btn-primary rise-in"
            onClick={() => {
              markHowToSeen();
              audio().unlock();
              launchDaily();
            }}
          >
            Stand ready
          </button>
          <p className="text-lg text-ash">Tap, click, or press space.</p>
        </main>
      )}

      {screen === "encounter" && run && (
        <Encounter
          key={run.id}
          boss={run.boss}
          seed={run.seed}
          mode={run.mode}
          initialResults={run.initialResults}
          attempts={run.attempts}
          debug={boot.debug}
          audio={audio()}
          muted={muted}
          onToggleMute={toggleMute}
          onStrikeStart={onStrikeStart}
          onResult={onResult}
          onVoid={onVoid}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      )}

      {screen === "results" && finished && (
        <Results
          mode={finished.mode}
          boss={finished.boss}
          puzzle={boot.puzzle}
          date={boot.date}
          results={finished.results}
          hasDailyResult={daily?.done ?? false}
          onPractice={startPractice}
          onShowDaily={() => {
            if (daily?.done) setFinished({ mode: "daily", boss: boot.boss, results: daily.results });
          }}
          onStats={() => setShowStats(true)}
        />
      )}

      {showStats && (
        <StatsModal stats={stats} today={boot.date} onClose={() => setShowStats(false)} />
      )}
    </>
  );
}

function DebugPanel({ date, override }: { date: string; override: boolean }) {
  const [value, setValue] = useState(date);
  const go = (next: string | null) => {
    const params = new URLSearchParams({ debug: "1" });
    if (next) params.set("date", next);
    window.location.assign(`${window.location.pathname}?${params}`);
  };
  return (
    <form
      className="flex flex-col items-center gap-2 border border-moss/40 p-3 font-mono text-base text-moss"
      onSubmit={(e) => {
        e.preventDefault();
        if (isValidDateString(value)) go(value);
      }}
    >
      <label className="flex items-center gap-2">
        debug date
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border border-moss/40 bg-black px-2 py-1 text-base text-bone"
        />
      </label>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="submit" className="underline">go</button>
        {override && (
          <button type="button" className="underline" onClick={() => go(null)}>
            real date
          </button>
        )}
        <button
          type="button"
          className="underline"
          onClick={() => {
            clearDaily(date);
            window.location.reload();
          }}
        >
          reset this day
        </button>
      </div>
    </form>
  );
}
