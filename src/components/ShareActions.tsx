"use client";

import { useEffect, useRef, useState } from "react";
import { buildShareText } from "@/game/share";
import {
  copyText,
  defaultEnv,
  shareCapabilities,
  shareCard,
  shareText,
  siteUrl,
  type ShareOutcome,
} from "@/game/shareClient";
import { renderShareImage } from "@/game/shareImage";
import type { StrikeResult } from "@/game/scoring";

const FEEDBACK_MS = 2200;

type Caps = { native: boolean };

/**
 * Share, Copy and card actions. Every button makes exactly one gesture-bound
 * call (see shareClient.ts); nothing here retries or chains fallbacks.
 */
export default function ShareActions({
  puzzle,
  bossName,
  results,
}: {
  puzzle: number;
  bossName: string;
  results: StrikeResult[];
}) {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [card, setCard] = useState<File | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [cardShareable, setCardShareable] = useState(false);
  const [flash, setFlash] = useState<ShareOutcome | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  const [manualText, setManualText] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // Capabilities are browser-only, so decide after mount.
  useEffect(() => {
    setCaps({ native: shareCapabilities(defaultEnv()).nativeText });
  }, []);

  // Pre-render the card so Share card / Save card respond inside the tap.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    renderShareImage({ puzzle, bossName, results, siteLabel: window.location.host })
      .then((file) => {
        if (cancelled || !file) return;
        setCard(file);
        setCardShareable(shareCapabilities(defaultEnv()).nativeFile(file));
        url = URL.createObjectURL(file);
        setCardUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [puzzle, bossName, results]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const show = (outcome: ShareOutcome) => {
    if (outcome === "cancelled") return;
    setFlash(outcome);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), FEEDBACK_MS);
  };

  const text = () => buildShareText(puzzle, results, siteUrl());

  const onShare = async () => {
    const outcome = await shareText(text());
    if (outcome === "unsupported") setNativeFailed(true);
    show(outcome);
  };
  const onShareCard = async () => {
    if (!card) return;
    const outcome = await shareCard(text(), card);
    if (outcome === "unsupported") setNativeFailed(true);
    show(outcome);
  };
  const onCopy = async () => {
    const t = text();
    const outcome = await copyText(t);
    if (outcome === "manual") setManualText(t);
    show(outcome);
  };

  const native = caps?.native === true && !nativeFailed;
  const copyLabel = flash === "copied" ? "Copied" : native ? "Copy" : "Copy result";
  const status =
    flash === "shared"
      ? "Shared"
      : flash === "copied"
        ? "Result copied to clipboard"
        : flash === "unsupported"
          ? "Sharing is not available here. Use Copy."
          : flash === "manual"
            ? "Copy it from the box"
            : "";

  return (
    <div className="flex flex-col items-center gap-3">
      {native ? (
        <>
          <button type="button" className="btn btn-primary" onClick={onShare}>
            {flash === "shared" ? "Shared" : "Share"}
          </button>
          <div className="flex flex-wrap justify-center gap-3">
            {card && cardShareable && (
              <button type="button" className="btn" onClick={onShareCard}>
                Share card
              </button>
            )}
            <button type="button" className="btn" onClick={onCopy}>
              {copyLabel}
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary" onClick={onCopy} disabled={caps === null}>
            {copyLabel}
          </button>
          {cardUrl && card && (
            <a className="btn" href={cardUrl} download={card.name}>
              Save card
            </a>
          )}
        </>
      )}
      <p role="status" aria-live="polite" className="min-h-6 text-lg text-ash">
        {status}
      </p>

      {manualText !== null && <ManualCopy text={manualText} onClose={() => setManualText(null)} />}
    </div>
  );
}

/** Last resort: a pre-selected, read-only box to copy from by hand. */
function ManualCopy({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = ref.current;
    ta?.focus();
    ta?.select();
    ta?.setSelectionRange(0, text.length);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [text, onClose]);
  return (
    <div
      className="fade-in fixed inset-0 z-30 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-title"
        className="w-full max-w-sm border border-gold/40 bg-pitch p-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="manual-title" className="font-display text-xl font-bold tracking-[0.16em] text-gold-bright uppercase">
          Copy your result
        </h2>
        <p className="mt-1 text-lg text-ash">Press and hold to copy.</p>
        <textarea
          ref={ref}
          readOnly
          value={text}
          rows={Math.min(10, text.split("\n").length + 1)}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 w-full resize-none border border-bone/20 bg-black p-3 text-left text-lg text-bone"
        />
        <button type="button" className="btn mt-4" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
