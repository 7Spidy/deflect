"use client";

import { useEffect, useRef } from "react";

/**
 * Confirm leaving a fight. The safe button takes focus first. Escape and the
 * backdrop both mean "keep fighting". Everything inside is data-notap so
 * nothing here can register as a parry.
 */
export default function LeaveDialog({
  mode,
  onKeep,
  onLeave,
}: {
  mode: "daily" | "practice";
  onKeep: () => void;
  onLeave: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onKeep();
      } else if (e.key === "Tab") {
        // Two buttons: keep focus inside the dialog.
        const active = document.activeElement;
        if (e.shiftKey && active === keepRef.current) {
          e.preventDefault();
          leaveRef.current?.focus();
        } else if (!e.shiftKey && active === leaveRef.current) {
          e.preventDefault();
          keepRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKeep]);

  return (
    <div
      data-notap
      className="fade-in absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-5"
      onClick={onKeep}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-body"
        className="w-full max-w-sm cursor-default border border-gold/40 bg-pitch p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="leave-title"
          className="font-display text-2xl font-bold tracking-[0.16em] text-gold-bright uppercase"
        >
          Leave the fight?
        </h2>
        <p id="leave-body" className="mt-3 text-xl leading-snug text-bone">
          {mode === "daily"
            ? "Your rounds are saved. The strike in flight is void and will return, changed."
            : "Practice is not saved."}
        </p>
        <div className="mt-6 flex flex-col items-center gap-2">
          <button ref={keepRef} type="button" className="btn btn-primary" onClick={onKeep}>
            Keep fighting
          </button>
          <button ref={leaveRef} type="button" className="btn btn-quiet" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
