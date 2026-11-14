"use client";

import { AUTHOR_NAME, AUTHOR_URL, GAME_NAME, GAME_NAME_PARTS } from "@/game/config";

export function MuteToggle({
  muted,
  onToggle,
  compact = false,
}: {
  muted: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={muted}
      aria-label={muted ? "Sound is off. Turn sound on" : "Sound is on. Turn sound off"}
      className={compact ? "btn btn-quiet min-h-11 px-3" : "btn btn-quiet"}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
        {muted ? (
          <path d="M16 9.5l5 5m0-5l-5 5" />
        ) : (
          <path d="M15.5 9a4.2 4.2 0 010 6M18 6.5a7.8 7.8 0 010 11" />
        )}
      </svg>
      {!compact && <span>{muted ? "Sound off" : "Sound on"}</span>}
    </button>
  );
}

export function Footer() {
  return (
    <footer className="relative z-[1] pt-6 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-center text-base text-ash">
      by{" "}
      <a
        href={AUTHOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-bone underline decoration-gold/50 underline-offset-4 hover:text-gold-bright"
      >
        {AUTHOR_NAME}
      </a>
    </footer>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <h1 aria-label={GAME_NAME} className="flex flex-col items-center leading-none">
        <span className={`logo ${small ? "text-4xl" : "text-[clamp(2.75rem,13vw,4.5rem)]"}`}>
          {GAME_NAME_PARTS[0].toUpperCase()}
        </span>
        <span
          className={`logo mt-2 font-semibold ${small ? "text-base" : "text-[clamp(1.1rem,5vw,1.6rem)]"}`}
          style={{ letterSpacing: "0.52em", marginRight: "-0.52em" }}
        >
          {GAME_NAME_PARTS[1].toUpperCase()}
        </span>
      </h1>
      <div className={`guard-rule mt-3 ${small ? "w-48" : "w-[min(78vw,22rem)]"}`} />
    </div>
  );
}
