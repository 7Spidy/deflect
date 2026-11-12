"use client";

import { useEffect, useRef } from "react";
import type { Boss } from "@/game/bosses";
import { LivingPortrait, loadGuardianImage, readArtDebug } from "@/game/living";

/**
 * Today's guardian on the title screen: the same LivingPortrait as the
 * encounter, on a small canvas. The page blends the canvas with CSS `screen`,
 * so the art's black background is transparent. Renders nothing visible if the
 * art is missing, and stops its rAF loop on unmount.
 */
export default function GuardianPortrait({
  boss,
  seed,
  className = "",
}: {
  boss: Boss;
  seed: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const art = boss.art;
    const canvas = canvasRef.current;
    if (!art || !canvas || readArtDebug().artOff) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const portrait = new LivingPortrait({
      seed,
      motion: art.motion,
      neckY: art.neckY,
      accents: art.accents,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    let cancelled = false;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);

    const tick = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      if (!portrait.ready) return;
      ctx.clearRect(0, 0, w, h);
      portrait.draw(ctx, { x: 0, y: 0, w, h }, performance.now(), 1, dpr, "source-over");
    };
    raf = requestAnimationFrame(tick);

    void loadGuardianImage(art.src).then((img) => {
      if (!img || cancelled) return;
      portrait.setArt(img);
      canvas.style.opacity = "1";
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [boss, seed]);

  if (!boss.art) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ opacity: 0, mixBlendMode: "screen", transition: "opacity 1.2s ease-out" }}
    />
  );
}
